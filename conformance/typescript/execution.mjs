import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { openLimiter as memory } from '../../packages/core/dist/src/memory.js';
import { openLimiter as sqlite } from '../../packages/core/dist/src/index.js';
import { ScheduledLimiter } from '../../packages/core/dist/src/client.js';
import { openMemoryBackend } from '../../packages/core/dist/src/memory-backend.js';
import { suite } from './fixtures/cases.mjs';
const { test, run } = suite();
await mkdir('.tmp/execution', { recursive: true });
const root = await mkdtemp('.tmp/execution/run-');
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const policy = { classifierId: 'test/1', retry: { baseDelayMs: 10, maxDelayMs: 20, jitter: 0 } };
const classifier = {
  id: 'test/1',
  classify: (result) => ({ kind: result.status === 'fulfilled' ? 'success' : 'service-failure' }),
};
const safe = { retrySafety: 'safe', classifier };
const redisMode = process.env.SEMAPHILE_EXECUTION_BACKEND === 'redis';
const redis = redisMode ? await (await import('../redis/harness.mjs')).server() : undefined;
const redisOpen = redisMode
  ? (await import('../../packages/redis/dist/index.js')).openLimiter
  : undefined;
for (const backend of redisMode ? ['redis'] : ['memory', 'sqlite']) {
  function scenario(name, task, recovery = policy) {
    test(`${backend}: ${name}`, async () => {
      const config = { maxConcurrent: 1, reservoir: 20, recovery };
      const location = `${root}/${randomUUID()}`;
      const options = backend === 'memory' ? { key: location, config } : { path: location, config };
      const open =
        backend === 'memory'
          ? memory
          : backend === 'sqlite'
            ? sqlite
            : (options) =>
                redisOpen({ url: redis.url, pool: options.path, config: options.config });
      const a = await open(options),
        b = await open(options);
      const cleanup = [];
      const gate = () => {
        const item = deferred();
        cleanup.push(item.resolve);
        return item;
      };
      try {
        await task(a, b, gate);
      } finally {
        for (const finish of cleanup) {
          finish();
        }
        await Promise.allSettled([a.close(), b.close()]);
      }
    });
  }
  scenario('safe classified retries spend each admission and preserve final value', async (a) => {
    const contexts = [];
    const value = await a.execute((context) => {
      contexts.push(context);
      if (context.attempt < 3) {
        throw new Error('transient');
      }
      return 42;
    }, safe);
    assert.equal(value, 42);
    assert.deepEqual(
      contexts.map((c) => c.attempt),
      [1, 2, 3],
    );
    assert.equal(new Set(contexts.map((c) => c.operationId)).size, 1);
    assert.equal(new Set(contexts.map((c) => c.admission.leaseId)).size, 3);
    assert.equal(new Set(contexts.map((c) => c.signal)).size, 3);
    assert.ok(contexts.every((c) => Object.isFrozen(c) && Object.isFrozen(c.admission)));
    assert.equal(await a.currentReservoir(), 17);
    assert.equal((await a.maintenance.status()).maintenance.pending, 0);
  });
  scenario(
    'unsafe or unclassified calls never replay, even when retries are configured',
    async (a) => {
      for (const options of [
        { classifier },
        { retrySafety: 'safe' },
        { ...safe, retrySafety: 'unsafe' },
      ]) {
        let attempts = 0;
        await assert.rejects(
          a.execute(() => {
            attempts++;
            throw new Error('failure');
          }, options),
          /failure/,
        );
        assert.equal(attempts, 1);
      }
      assert.equal((await a.inspect()).active, 0);
    },
  );
  scenario(
    'retry:false reports shared failure while preserving the result without replay',
    async (a, b) => {
      let attempts = 0;
      const value = await a.execute(
        () => {
          attempts++;
          return 42;
        },
        {
          ...safe,
          classifier: { id: 'test/1', classify: () => ({ kind: 'service-failure', retry: false }) },
        },
      );
      assert.equal(value, 42);
      assert.equal(attempts, 1);
      assert.equal((await b.maintenance.status()).recovery.circuit, 'open');
    },
    { ...policy, breaker: { failureThreshold: 1 } },
  );
  scenario('retry exhaustion preserves falsy rejection identity', async (a) => {
    for (const reason of [undefined, null, false, 0, '']) {
      let attempts = 0;
      const result = await a
        .execute(() => {
          attempts++;
          return Promise.reject(reason);
        }, safe)
        .then(
          () => 'unexpected',
          (error) => error,
        );
      assert.equal(result, reason);
      assert.equal(attempts, 3);
    }
  });
  scenario('classifier mistakes release neutrally and do not poison later work', async (a) => {
    await assert.rejects(
      a.execute(() => 'done', {
        classifier: { id: 'different', classify: () => ({ kind: 'success' }) },
      }),
      /identifier/,
    );
    for (const classify of [
      () => ({ kind: 'invalid' }),
      () => {
        throw new Error('classifier defect');
      },
    ]) {
      await assert.rejects(a.execute(() => 'done', { classifier: { id: 'test/1', classify } }));
      assert.equal((await a.inspect()).active, 0);
      assert.equal((await a.maintenance.status()).maintenance.pending, 0);
    }
    assert.equal(await a.schedule(() => 7), 7);
  });
  scenario('classifiers preserve prototype methods and private-field receivers', async (a) => {
    class Classifier {
      id = 'test/1';
      #outcome = 'success';
      classify() {
        return { kind: this.#outcome };
      }
    }
    assert.equal(await a.execute(() => 42, { classifier: new Classifier() }), 42);
  });
  scenario(
    'cancellation inside classification cannot supply successful recovery evidence',
    async (a, b) => {
      const controller = new AbortController();
      const original = await b.maintenance.status();
      await assert.rejects(
        a.execute(() => 42, {
          signal: controller.signal,
          classifier: {
            id: 'test/1',
            classify: () => {
              controller.abort();
              return { kind: 'success' };
            },
          },
        }),
        { name: 'AbortError' },
      );
      await a.close();
      const state = await b.maintenance.status();
      assert.deepEqual(state.recovery, original.recovery);
    },
    {
      ...policy,
      breaker: { rule: 'percentage', minimumSamples: 2, failureRatio: 0.5, windowMs: 1000 },
    },
  );
  scenario('retry delay releases concurrency for unrelated callers', async (a, b) => {
    const order = [],
      failed = deferred();
    const job = a.execute(
      ({ attempt }) => {
        order.push(`attempt-${attempt}`);
        if (attempt === 1) {
          failed.resolve();
          throw new Error('again');
        }
        return 2;
      },
      { ...safe, policy: { retry: { baseDelayMs: 200, maxDelayMs: 200 } } },
    );
    await failed.promise;
    await b.schedule(() => order.push('peer'));
    assert.equal(await job, 2);
    assert.deepEqual(order, ['attempt-1', 'peer', 'attempt-2']);
  });
  scenario(
    'drain accepts existing retries, rejects new work, and waits for final completion',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate();
      const job = a.execute(async ({ attempt }) => {
        if (attempt === 1) {
          started.resolve();
          await finish.promise;
          throw new Error('again');
        }
        return 'recovered';
      }, safe);
      await started.promise;
      const drain = await b.maintenance.drain();
      const waiting = b.maintenance.wait({ generation: drain.maintenance.generation });
      await assert.rejects(
        b.execute(() => 'new', safe),
        { name: 'PoolDrainingError' },
      );
      finish.resolve();
      assert.equal(await job, 'recovered');
      assert.equal((await waiting).maintenance.clean, true);
      await b.maintenance.resume(drain.maintenance.generation);
      assert.equal(await b.execute(() => 1), 1);
    },
  );
  scenario(
    'overall deadline rejects promptly while actual work retains its lease',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate();
      let signal;
      const result = a
        .execute(
          async (context) => {
            signal = context.signal;
            started.resolve();
            await finish.promise;
            return 1;
          },
          { policy: { deadlineMs: 100, attemptTimeoutMs: null } },
        )
        .catch((error) => error);
      await started.promise;
      assert.equal((await result).name, 'ExecutionTimeoutError');
      assert.equal(signal.aborted, true);
      assert.equal((await b.inspect()).active, 1);
      const closing = a.close();
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await setImmediate();
      assert.equal(closed, false);
      finish.resolve();
      await closing;
      assert.equal((await b.inspect()).active, 0);
    },
  );
  scenario(
    'attempt timeout is terminal and ignores late success as recovery evidence',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate();
      let attempts = 0,
        reports = 0;
      const result = a
        .execute(
          async () => {
            attempts++;
            started.resolve();
            await finish.promise;
            return 'late';
          },
          {
            ...safe,
            classifier: {
              id: 'test/1',
              classify: () => {
                reports++;
                return { kind: 'success' };
              },
            },
            policy: { deadlineMs: null, attemptTimeoutMs: 30 },
          },
        )
        .catch((error) => error);
      await started.promise;
      assert.equal((await result).name, 'AttemptTimeoutError');
      assert.equal((await b.inspect()).active, 1);
      finish.resolve();
      await a.close();
      assert.equal(attempts, 1);
      assert.equal(reports, 0);
      assert.equal((await b.maintenance.status()).maintenance.pending, 0);
    },
  );
  scenario(
    'abort signals active callback but close still joins actual completion',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate(),
        controller = new AbortController();
      let signal;
      const result = a
        .execute(
          async (context) => {
            signal = context.signal;
            started.resolve();
            await finish.promise;
            return 1;
          },
          { ...safe, signal: controller.signal },
        )
        .catch((error) => error);
      await started.promise;
      controller.abort();
      assert.equal((await result).name, 'AbortError');
      assert.equal(signal.aborted, true);
      assert.equal((await b.inspect()).active, 1);
      finish.resolve();
      await a.close();
      assert.equal((await b.inspect()).active, 0);
    },
  );
  scenario(
    'queue deadline cannot dispatch after capacity becomes available',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate();
      const held = b.schedule(async () => {
        started.resolve();
        await finish.promise;
      });
      await started.promise;
      await assert.rejects(
        a.execute(() => assert.fail('queued callback ran'), { queueTimeoutMs: 20 }),
        { name: 'QueueTimeoutError' },
      );
      finish.resolve();
      await held;
      await a.close();
      assert.equal((await b.maintenance.status()).maintenance.pending, 0);
    },
  );
  for (const drain of [false, true]) {
    scenario(
      `close drain=${drain} selects whether accepted retries continue`,
      async (a, _b, gate) => {
        const started = gate(),
          finish = gate();
        let attempts = 0;
        const job = a
          .execute(async () => {
            attempts++;
            if (attempts === 1) {
              started.resolve();
              await finish.promise;
              throw new Error('first failed');
            }
            return 'ok';
          }, safe)
          .catch((error) => error);
        await started.promise;
        const closing = a.close({ drain });
        finish.resolve();
        const result = await job;
        await closing;
        assert.equal(attempts, drain ? 2 : 1);
        if (drain) {
          assert.equal(result, 'ok');
        } else {
          assert.match(result.message, /first failed/);
        }
      },
    );
  }
  scenario(
    'administrative wait timeout preserves drain, and client close cancels its wait',
    async (a, b, gate) => {
      const started = gate(),
        finish = gate();
      const held = b.execute(async () => {
        started.resolve();
        await finish.promise;
      });
      await started.promise;
      const receipt = await a.maintenance.drain(),
        generation = receipt.maintenance.generation;
      await assert.rejects(a.maintenance.wait({ generation, timeoutMs: 10 }), {
        name: 'DrainTimeoutError',
      });
      assert.equal((await b.maintenance.status()).maintenance.mode, 'draining');
      const waiting = a.maintenance.wait({ generation }).catch((error) => error);
      await a.close();
      assert.equal((await waiting).name, 'AbortError');
      finish.resolve();
      await held;
      assert.equal((await b.maintenance.wait({ generation })).maintenance.clean, true);
    },
  );
}
test('overall deadline is checked after finalization even before an overdue timer runs', async () => {
  const backend = openMemoryBackend(randomUUID(), { maxConcurrent: 1 });
  const call = backend.call.bind(backend);
  backend.call = (action, input, signal) => {
    if (action === 'finish') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
    return call(action, input, signal);
  };
  class Limiter extends ScheduledLimiter {
    constructor() {
      super(backend);
    }
  }
  const limiter = new Limiter();
  try {
    await assert.rejects(
      limiter.execute(() => 42, { policy: { deadlineMs: 10 } }),
      { name: 'ExecutionTimeoutError' },
    );
  } finally {
    await limiter.close();
  }
});
test('failed release prevents replay and close reports its cleanup error', async () => {
  const backend = openMemoryBackend(randomUUID(), { maxConcurrent: 1, recovery: policy });
  const call = backend.call.bind(backend),
    failure = new Error('release reply lost');
  backend.call = async (action, input, signal) => {
    const value = await call(action, input, signal);
    if (action === 'release') {
      throw failure;
    }
    return value;
  };
  class Limiter extends ScheduledLimiter {
    constructor() {
      super(backend);
    }
  }
  const limiter = new Limiter();
  let attempts = 0;
  const result = await limiter
    .execute(() => {
      attempts++;
      throw new Error('transient');
    }, safe)
    .catch((error) => error);
  assert.equal(result, failure);
  assert.equal(attempts, 1);
  await assert.rejects(
    limiter.close(),
    (error) => error instanceof AggregateError && error.errors.includes(failure),
  );
});
test('close waits for an outstanding administrative command before detaching ownership', async () => {
  const backend = openMemoryBackend(randomUUID(), { maxConcurrent: 1 }),
    gate = deferred();
  const call = backend.call.bind(backend),
    detach = backend.detach.bind(backend);
  let detached = false;
  backend.call = async (action, input, signal) => {
    if (action === 'control') {
      await gate.promise;
    }
    return call(action, input, signal);
  };
  backend.detach = async () => {
    detached = true;
    await detach();
  };
  class Limiter extends ScheduledLimiter {
    constructor() {
      super(backend);
    }
  }
  const limiter = new Limiter(),
    status = limiter.maintenance.status(),
    closing = limiter.close();
  await setImmediate();
  assert.equal(detached, false);
  gate.resolve();
  await status;
  await closing;
  assert.equal(detached, true);
});
test('queue deadline includes delayed acceptance and close waits for its late ticket cleanup', async () => {
  const key = randomUUID(),
    backend = openMemoryBackend(key, { maxConcurrent: 1 }),
    peer = openMemoryBackend(key, { maxConcurrent: 1 });
  const gate = deferred(),
    accepted = deferred(),
    call = backend.call.bind(backend);
  backend.call = async (action, input, signal) => {
    const result = await call(action, input, signal);
    if (action === 'accept') {
      accepted.resolve();
      await gate.promise;
    }
    return result;
  };
  class Limiter extends ScheduledLimiter {
    constructor() {
      super(backend);
    }
  }
  const limiter = new Limiter();
  const result = limiter
    .execute(() => assert.fail('expired acceptance dispatched'), { queueTimeoutMs: 20 })
    .catch((error) => error);
  await accepted.promise;
  assert.equal((await result).name, 'QueueTimeoutError');
  const closing = limiter.close();
  let closed = false;
  void closing.then(() => {
    closed = true;
  });
  await setImmediate();
  assert.equal(closed, false);
  gate.resolve();
  await closing;
  assert.equal(
    (await peer.call('control', { command: { action: 'status' } })).maintenance.pending,
    0,
  );
  await peer.detach();
});
try {
  await run();
} finally {
  await redis?.close();
}

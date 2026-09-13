// All transitions are synchronous within one JS runtime. The registry retains
// budgets across client close/reopen; it never coordinates another runtime.
import { randomUUID } from 'node:crypto';
import {
  InputError,
  normalize,
  normalizeExpiration,
  validateWeight,
  type PoolConfig,
} from './config.js';
import type { Admission, Operations } from './protocol.js';
import type { ClientBackend, Snapshot } from './client.js';
import { MemoryControl } from './memory-control.js';
import { CircuitOpenError, type AttemptOptions } from './control-state.js';
import type { Outcome } from './recovery-state.js';

type Lease = Snapshot['leases'][number];
type Waiting = {
  owner: string;
  weight: number;
  expirationMs: number | null;
  options: AttemptOptions;
  resolve: (admission: Admission) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};
const aborted = () =>
  Object.assign(new Error('Memory acquisition aborted'), { name: 'AbortError' });

class MemoryPool {
  readonly canonical: string;
  readonly control: MemoryControl;
  private readonly leases = new Map<string, Lease>();
  private readonly pending: Waiting[] = [];
  private active = 0;
  private remaining: number | null;
  private nextRefreshAt: number | null;
  private nextAllowedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pumping = false;

  constructor(readonly config: ReturnType<typeof normalize>) {
    this.canonical = JSON.stringify(config);
    this.control = new MemoryControl(config);
    this.remaining = config.reservoir;
    this.nextRefreshAt =
      config.reservoirRefreshInterval === null
        ? null
        : Date.now() + config.reservoirRefreshInterval;
  }

  private refresh(now: number): void {
    const interval = this.config.reservoirRefreshInterval;
    if (interval !== null && this.nextRefreshAt !== null && now >= this.nextRefreshAt) {
      const periods = Math.floor((now - this.nextRefreshAt) / interval) + 1;
      this.remaining = this.config.reservoirRefreshAmount;
      this.nextRefreshAt += periods * interval;
    }
  }

  acquire(
    owner: string,
    weight: number,
    expirationMs: number | null,
    signal?: AbortSignal,
    options: AttemptOptions = {},
  ): Promise<Admission> {
    options = { ...options, ...(options.operation ? { operation: { ...options.operation } } : {}) };
    validateWeight(weight, this.config.maxConcurrent);
    normalizeExpiration(expirationMs);
    if (signal?.aborted) {
      return Promise.reject(aborted());
    }
    if (options.circuit === 'fail-fast') {
      this.control.assertCircuitClosed(Date.now());
    }
    if (!options.operation) {
      options = {
        ...options,
        operation: this.control.accept(owner, randomUUID()),
        autoFinish: true,
      };
    }
    const result = new Promise<Admission>((resolve, reject) => {
      const cancel = () => {
        const index = this.pending.indexOf(entry);
        if (index < 0) {
          return;
        }
        this.pending.splice(index, 1);
        entry.cleanup();
        reject(aborted());
        this.pump();
      };
      const entry: Waiting = {
        owner,
        weight,
        expirationMs,
        options,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', cancel),
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.push(entry);
    });
    this.pump();
    return result.catch((error: unknown) => {
      if (options.autoFinish && options.operation) {
        this.control.finish(owner, options.operation);
      }
      throw error;
    });
  }

  private forgetLease(id: string, lease: Lease): void {
    this.leases.delete(id);
    this.active -= lease.weight;
  }

  private pump(): void {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      while (this.pending.length) {
        const now = Date.now();
        this.rejectCircuitWaiters(now);
        if (!this.pending.length) {
          break;
        }
        this.refresh(now);
        for (const [id, lease] of this.leases) {
          if (lease.expires !== null && lease.expires <= now) {
            this.control.expire(id, now);
            this.forgetLease(id, lease);
          }
        }
        const head = this.pending[0];
        let recovery;
        try {
          recovery = this.control.eligibility(head.owner, head.options, now);
        } catch (error) {
          this.rejectHead(error);
          continue;
        }
        if (
          this.config.maxConcurrent === null &&
          this.active > Number.MAX_SAFE_INTEGER - head.weight
        ) {
          this.pending.shift();
          head.cleanup();
          head.reject(new InputError('Capacity accounting overflow'));
          continue;
        }
        const available =
          this.config.maxConcurrent === null ||
          head.weight <= this.config.maxConcurrent - this.active;
        if (
          !recovery.allowed ||
          !available ||
          now < this.nextAllowedAt ||
          (this.remaining !== null && head.weight > this.remaining)
        ) {
          this.armDeadline(head, now, recovery.notBefore);
          return;
        }
        const leaseId = randomUUID();
        const expiresAt = head.expirationMs === null ? null : now + head.expirationMs;
        try {
          this.control.start(head.owner, leaseId, head.options, now);
        } catch (error) {
          this.rejectHead(error);
          continue;
        }
        this.leases.set(leaseId, {
          id: leaseId,
          owner: head.owner,
          expires: expiresAt,
          weight: head.weight,
        });
        this.active += head.weight;
        if (this.remaining !== null) {
          this.remaining -= head.weight;
        }
        this.nextAllowedAt = now + this.config.minTime;
        this.pending.shift();
        head.cleanup();
        head.resolve({ leaseId, leaseGrantedAt: now, expiresAt, weight: head.weight });
      }
    } finally {
      this.pumping = false;
    }
  }
  private rejectHead(error: unknown): void {
    const head = this.pending.shift()!;
    head.cleanup();
    head.reject(error instanceof Error ? error : new Error(String(error)));
  }
  private rejectCircuitWaiters(now: number): void {
    if (!this.pending.some((entry) => entry.options.circuit === 'fail-fast')) {
      return;
    }
    try {
      this.control.assertCircuitClosed(now);
    } catch (error) {
      if (!(error instanceof CircuitOpenError)) {
        throw error;
      }
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].options.circuit !== 'fail-fast') {
          continue;
        }
        const [entry] = this.pending.splice(i, 1);
        entry.cleanup();
        entry.reject(error);
      }
    }
  }

  private armDeadline(head: Waiting, now: number, recoveryDeadline: number | null): void {
    let deadline: number | undefined;
    const consider = (at: number) => {
      deadline = Math.min(deadline ?? Infinity, at);
    };
    if (recoveryDeadline !== null) {
      consider(recoveryDeadline);
    }
    for (const lease of this.leases.values()) {
      if (lease.expires !== null) {
        consider(lease.expires);
      }
    }
    if (this.nextAllowedAt > now) {
      consider(this.nextAllowedAt);
    }
    // Refills too small for this job cannot change its eligibility. No idle poll.
    if (
      this.remaining !== null &&
      this.remaining < head.weight &&
      this.nextRefreshAt !== null &&
      this.config.reservoirRefreshAmount! >= head.weight
    ) {
      consider(this.nextRefreshAt);
    }
    if (deadline !== undefined) {
      const delay = Math.max(0, Math.min(2_147_483_647, deadline - now));
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, delay);
    }
  }

  release(owner: string, id: string, outcome: Outcome = { kind: 'neutral' }): void {
    const lease = this.leases.get(id);
    if (lease && lease.owner !== owner) {
      return;
    }
    this.control.complete(
      owner,
      id,
      outcome,
      lease?.expires !== undefined && lease.expires !== null && lease.expires <= Date.now(),
    );
    if (lease?.owner === owner) {
      this.forgetLease(id, lease);
    }
    this.pump();
  }

  inspect(): Snapshot {
    return {
      active: this.active,
      reservoir: this.reservoir(),
      leases: [...this.leases.values()].map((lease) => ({ ...lease })),
      trace: [],
    };
  }
  reservoir(): number | null {
    this.refresh(Date.now());
    return this.remaining;
  }
  increment(amount: number): number {
    if (!Number.isSafeInteger(amount)) {
      throw new InputError('Invalid reservoir increment');
    }
    const remaining = (this.reservoir() ?? 0) + amount;
    if (!Number.isSafeInteger(remaining)) {
      throw new InputError('Reservoir increment overflow');
    }
    this.remaining = remaining;
    this.pump();
    return remaining;
  }
  detach(owner: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const entry = this.pending[i];
      if (entry.owner === owner) {
        this.pending.splice(i, 1);
        entry.cleanup();
        entry.reject(new Error('Memory client closed'));
      }
    }
    for (const [id, lease] of this.leases) {
      if (lease.owner === owner) {
        this.forgetLease(id, lease);
      }
    }
    this.control.retire(owner);
    this.pump();
  }
}

const registryKey = Symbol.for('semaphile.memory.pools.v2');
const runtime = globalThis as typeof globalThis & { [registryKey]?: Map<string, MemoryPool> };
const registry = (runtime[registryKey] ??= new Map<string, MemoryPool>());

class MemoryBackend implements ClientBackend {
  readonly recovery;
  readonly failure = undefined;
  readonly owner = randomUUID();
  readonly maxConcurrent: number | null;
  readonly expirationMs: number | null;
  private closed = false;
  private readonly closingSignal = new AbortController();
  constructor(private readonly pool: MemoryPool) {
    this.recovery = pool.control.policy;
    this.maxConcurrent = pool.config.maxConcurrent;
    this.expirationMs = pool.config.expirationMs;
  }
  async call<K extends keyof Operations>(
    action: K,
    input: Operations[K]['input'],
    signal?: AbortSignal,
  ): Promise<Operations[K]['output']> {
    if (this.closed) {
      throw new Error('Memory client closed');
    }
    let value: unknown;
    switch (action) {
      case 'acquire': {
        const { weight, expirationMs, ...options } = input as Operations['acquire']['input'];
        value = await this.pool.acquire(this.owner, weight, expirationMs, signal, options);
        break;
      }
      case 'release': {
        const { lease, outcome } = input as Operations['release']['input'];
        this.pool.release(this.owner, lease, outcome);
        value = null;
        break;
      }
      case 'accept':
        value = this.pool.control.accept(
          this.owner,
          (input as Operations['accept']['input']).operationId,
        );
        break;
      case 'finish':
        value = this.pool.control.finish(
          this.owner,
          (input as Operations['finish']['input']).operation,
        );
        break;
      case 'control':
        value = this.pool.control.administer((input as Operations['control']['input']).command);
        break;
      case 'waitDrain':
        value = await this.pool.control.wait(
          (input as Operations['waitDrain']['input']).generation,
          signal ? AbortSignal.any([signal, this.closingSignal.signal]) : this.closingSignal.signal,
        );
        break;
      case 'inspect':
        value = this.pool.inspect();
        break;
      case 'reservoir':
        value = this.pool.reservoir();
        break;
      case 'increment':
        value = this.pool.increment((input as Operations['increment']['input']).amount);
        break;
      case 'close':
        await this.detach();
        value = null;
        break;
    }
    // Operation discriminant pairs each request with its corresponding result.
    return value as Operations[K]['output'];
  }
  async detach(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.closingSignal.abort();
      this.pool.detach(this.owner);
    }
  }
}

export function openMemoryBackend(key: string, config: PoolConfig): ClientBackend {
  if (typeof key !== 'string' || !key.trim() || key.length > 1024) {
    throw new InputError('Invalid memory pool key');
  }
  const normalized = normalize(config);
  let pool = registry.get(key);
  if (pool && pool.canonical !== JSON.stringify(normalized)) {
    throw new Error('Pool config mismatch');
  }
  if (!pool) {
    pool = new MemoryPool(normalized);
    registry.set(key, pool);
  }
  return new MemoryBackend(pool);
}

// The fixed messaging inventory. Every operation runs in a participant
// process under its own OS identity and restricted credential; the
// controller only sequences requests and records what it observed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { configDir, redisUser } from './layout.mjs';

export class Invalid extends Error {}

const expectCode = (reply, codes, label) => {
  assert.equal(reply.ok, false, `${label}: expected refusal, got success`);
  assert.ok(
    [codes].flat().includes(reply.error.code),
    `${label}: expected ${codes}, got ${reply.error.code} ${reply.error.message}`,
  );
};
const cliJson = (reply, label) => {
  assert.equal(reply.ok, true, `${label}: participant error ${reply.error?.message}`);
  assert.equal(reply.result.code, 0, `${label}: exit ${reply.result.code} ${reply.result.stderr}`);
  return reply.result.json;
};
const topicOf = (c) => `sem3.${c.id.toLowerCase()}`;
const suffix = (c) => c.id.toLowerCase();

// A computed wait: the deadline comes from recorded timestamps, never a loop.
export const until = (deadline) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));

async function openAll(p, profile, roles, handle = 'main') {
  const opened = {};
  for (const role of roles) {
    opened[role] = await p[role].ok('open', { handle, profile });
    assert.equal(
      opened[role].file,
      `${configDir(p[role].account.name, profile, p.prefix)}/semaphile.json`,
      `${role} resolved an unexpected configuration file`,
    );
  }
  return opened;
}

async function d1(ctx, c, p) {
  const S = p[c.sender],
    R = p[c.receiver];
  const mailbox = `d1-${suffix(c)}`;
  const created = cliJson(
    await R.request('cli', { profile: 'd1', args: ['message', 'create', '--name', mailbox] }),
    'receiver create',
  );
  assert.equal(created.created, mailbox);
  for (const [role, participant] of [
    [c.receiver, R],
    [c.sender, S],
  ]) {
    const info = cliJson(
      await participant.request('cli', { profile: 'd1', args: ['info'] }),
      'info',
    );
    const expected = `${configDir(participant.account.name, 'd1', p.prefix)}/semaphile.json`;
    assert.equal(info.file, expected, `${role} CLI resolved another configuration`);
    assert.equal(info.stores[0].store, 'd1');
    assert.equal(info.stores[0].namespace, ctx.namespace);
    ctx.observe(`${role}.cliConfig`, info.file);
  }
  const waiting = R.request(
    'cli',
    {
      profile: 'd1',
      args: ['message', 'wait', '--as', mailbox, '--timeout', '30000'],
      timeoutMs: 40000,
    },
    { timeoutMs: 45000 },
  );
  const nonce = randomUUID();
  const sent = cliJson(
    await S.request('cli', {
      profile: 'd1',
      args: [
        'message',
        'send',
        '--to',
        mailbox,
        '--body',
        nonce,
        '--dedupe-key',
        `${mailbox}-once`,
      ],
    }),
    'sender send',
  );
  assert.deepEqual(sent.recipients, [mailbox]);
  const delivery = cliJson(await waiting, 'receiver wait');
  assert.equal(delivery.message.body, nonce);
  assert.equal(delivery.messageId, sent.id);
  const ack = (label) =>
    R.request('cli', {
      profile: 'd1',
      args: ['message', 'ack', '--receipt-file', '-'],
      input: JSON.stringify(delivery),
    }).then((reply) => cliJson(reply, label));
  assert.equal((await ack('ack')).status, 'acked');
  assert.equal((await ack('duplicate ack')).status, 'acked', 'duplicate ack is idempotent');
  const history = cliJson(
    await S.request('cli', { profile: 'd1', args: ['message', 'history', '--to', mailbox] }),
    'sender history',
  );
  const entry = history.find((item) => item.id === sent.id);
  assert.ok(entry, 'sender history lacks the sent message');
  assert.equal(entry.deliveries.length, 1);
  assert.equal(entry.deliveries[0].id, delivery.id);
  assert.equal(entry.deliveries[0].state, 'acked', 'sender observes durable acceptance');
  ctx.observe('identities', {
    sender: { messageId: sent.id, deliveryId: entry.deliveries[0].id },
    receiver: { messageId: delivery.messageId, deliveryId: delivery.id },
    nonce,
  });
}

async function t1(ctx, c, p) {
  const topic = topicOf(c);
  await openAll(p, 't1', ['A', 'B', 'C']);
  const sb = await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`sb-${suffix(c)}`, { topics: [topic] }],
    as: 'sb',
  });
  const sc = await p.C.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`sc-${suffix(c)}`, { topics: [topic] }],
    as: 'sc',
  });
  const publication = { topic, body: randomUUID(), dedupeKey: `t1-${suffix(c)}` };
  const sent = await p.A.ok('call', { handle: 'main', method: 'publish', args: [publication] });
  assert.deepEqual(sent.recipients.toSorted(), [sb.recipient, sc.recipient].toSorted());
  await p.C.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`late-${suffix(c)}`, { topics: [topic] }],
    as: 'late',
  });
  const replay = await p.A.ok('call', { handle: 'main', method: 'publish', args: [publication] });
  assert.deepEqual(
    replay,
    { ...sent, deduplicated: true },
    'dedupe keeps the original fanout snapshot',
  );
  const [fromB] = await p.B.ok('sub', { sub: 'sb', method: 'receive' });
  assert.equal(fromB.message.body, publication.body);
  assert.equal(
    (await p.B.ok('call', { handle: 'main', method: 'ack', args: [fromB.receipt] })).status,
    'acked',
  );
  // C disconnects with its delivery still pending, then reconnects.
  await p.C.ok('close', { handle: 'main' });
  await p.C.ok('open', { handle: 'reopened', profile: 't1' });
  await p.C.ok('call', {
    handle: 'reopened',
    method: 'subscription',
    args: [`sc-${suffix(c)}`],
    as: 'sc2',
  });
  const [fromC] = await p.C.ok('sub', { sub: 'sc2', method: 'receive' });
  assert.equal(fromC.messageId, sent.id, 'offline durable delivery survived the disconnect');
  assert.equal(
    (await p.C.ok('call', { handle: 'reopened', method: 'ack', args: [fromC.receipt] })).status,
    'acked',
  );
  await p.C.ok('call', {
    handle: 'reopened',
    method: 'subscription',
    args: [`late-${suffix(c)}`],
    as: 'late2',
  });
  assert.deepEqual(
    await p.C.ok('sub', { sub: 'late2', method: 'receive' }),
    [],
    'later subscription gets no old event',
  );
  ctx.observe('fanout', {
    messageId: sent.id,
    recipients: sent.recipients,
    deliveries: [fromB.id, fromC.id],
  });
}

async function t2(ctx, c, p) {
  const topic = topicOf(c);
  await openAll(p, 't2', ['A', 'B', 'C']);
  const shared = `w-${suffix(c)}`;
  await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [shared, { topics: [topic] }],
    as: 'w',
  });
  await p.C.ok('call', { handle: 'main', method: 'subscription', args: [shared], as: 'w' });
  await p.C.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`y-${suffix(c)}`, { topics: [topic] }],
    as: 'y',
  });
  const first = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'first' }],
  });
  assert.equal(first.recipients.length, 2);
  const [fromB, fromC] = await Promise.all([
    p.B.ok('sub', { sub: 'w', method: 'receive' }),
    p.C.ok('sub', { sub: 'w', method: 'receive' }),
  ]);
  assert.equal(fromB.length + fromC.length, 1, 'competing workers claimed the same delivery');
  const [holder, claimed] = fromB.length ? [p.B, fromB[0]] : [p.C, fromC[0]];
  ctx.observe('claimedBy', holder.role);
  expectCode(
    await p.A.request('call', {
      handle: 'main',
      method: 'publish',
      args: [{ topic, body: 'second' }],
    }),
    'REFUSED',
    'publish to two full queues',
  );
  await holder.ok('call', { handle: 'main', method: 'ack', args: [claimed.receipt] });
  expectCode(
    await p.A.request('call', {
      handle: 'main',
      method: 'publish',
      args: [{ topic, body: 'third' }],
    }),
    'REFUSED',
    'publish with one full queue',
  );
  assert.deepEqual(
    await p.B.ok('sub', { sub: 'w', method: 'receive' }),
    [],
    'refused publication reached the non-full queue',
  );
  assert.deepEqual(await p.C.ok('sub', { sub: 'w', method: 'receive' }), []);
  const [pendingY] = await p.C.ok('sub', { sub: 'y', method: 'receive' });
  assert.equal(pendingY.messageId, first.id);
  await p.C.ok('call', { handle: 'main', method: 'ack', args: [pendingY.receipt] });
  const fourth = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'fourth' }],
  });
  const [w] = await p.B.ok('sub', { sub: 'w', method: 'receive' });
  const [y] = await p.C.ok('sub', { sub: 'y', method: 'receive' });
  assert.equal(w.messageId, fourth.id);
  assert.equal(y.messageId, fourth.id);
  await p.B.ok('call', { handle: 'main', method: 'ack', args: [w.receipt] });
  await p.C.ok('call', { handle: 'main', method: 'ack', args: [y.receipt] });
}

async function t3(ctx, c, p) {
  const topic = topicOf(c);
  await openAll(p, 't3', ['A', 'B', 'C']);
  const inbox = `inbox-${suffix(c)}`;
  await p.B.ok('call', { handle: 'main', method: 'createMailbox', args: [inbox] });
  const sc = await p.C.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`c-${suffix(c)}`, { topics: [topic] }],
    as: 'c',
  });
  const sent = await p.A.ok('call', {
    handle: 'main',
    method: 'send',
    args: [{ to: inbox, topic, body: 'direct' }],
  });
  assert.deepEqual(sent.recipients, [inbox]);
  const [direct] = await p.B.ok('call', { handle: 'main', method: 'receive', args: [inbox] });
  assert.equal(direct.message.topic, topic);
  await p.B.ok('call', { handle: 'main', method: 'ack', args: [direct.receipt] });
  assert.deepEqual(
    await p.C.ok('sub', { sub: 'c', method: 'receive' }),
    [],
    'topic metadata published implicitly',
  );
  expectCode(
    await p.A.request('call', {
      handle: 'main',
      method: 'send',
      args: [{ to: sc.recipient, body: 'bypass' }],
    }),
    'REFUSED',
    'direct send to a reserved subscription recipient',
  );
}

async function t4(ctx, c, p) {
  const topic = topicOf(c);
  await openAll(p, 't4', ['A', 'B', 'C']);
  const name = `s-${suffix(c)}`;
  const original = await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [name, { topics: [topic] }],
    as: 's',
  });
  const sent = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'old' }],
  });
  const [claimed] = await p.B.ok('sub', { sub: 's', method: 'receive' });
  await p.C.ok('call', { handle: 'main', method: 'subscription', args: [name], as: 's' });
  await p.C.ok('sub', { sub: 's', method: 'remove' });
  const next = await p.C.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [name, { topics: [topic] }],
    as: 's2',
  });
  assert.notEqual(next.id, original.id, 'recreated subscription kept its generation');
  assert.equal(
    (await p.B.ok('call', { handle: 'main', method: 'ack', args: [claimed.receipt] })).status,
    'stale',
  );
  assert.equal(
    (await p.B.request('sub', { sub: 's', method: 'receive' })).ok,
    false,
    'old handle consumed a new generation',
  );
  assert.deepEqual(await p.C.ok('sub', { sub: 's2', method: 'receive' }), []);
  const history = await p.C.ok('call', { handle: 'main', method: 'history', args: [{ topic }] });
  assert.equal(history.find((item) => item.id === sent.id).deliveries[0].state, 'cancelled');
  ctx.observe('generations', { before: original.id, after: next.id });
}

async function t5(ctx, c, p) {
  const topic = topicOf(c);
  const ttl = 4000,
    slack = 600;
  await openAll(p, 't5', ['A', 'B', 'C']);
  const name = `tmp-${suffix(c)}`;
  await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [name, { topics: [topic], inactivityTtlMs: ttl }],
    as: 'tmp',
  });
  const first = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'claimed' }],
  });
  const claim = await p.B.request('sub', { sub: 'tmp', method: 'receive' });
  assert.equal(claim.ok, true);
  const [claimed] = claim.result;
  // B's last activity ends no later than its claim reply.
  const lastActivity = claim.finished;
  const [afterClaim] = (await p.C.ok('call', { handle: 'main', method: 'subscriptions' })).filter(
    (s) => s.name === name,
  );
  await until(lastActivity + ttl / 2);
  const inWindow = await p.A.request('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'in-window' }],
  });
  assert.equal(inWindow.ok, true, 'publish inside the inactivity window');
  const publishStarted = inWindow.started;
  const deadlines = {
    lastActivity,
    activityDeadline: afterClaim.expiresAt,
    wrongRefreshDeadline: publishStarted + ttl,
  };
  ctx.observe('deadlines', deadlines);
  if (!(
    deadlines.activityDeadline <= lastActivity + ttl &&
    deadlines.activityDeadline + slack < deadlines.wrongRefreshDeadline - slack
  )) {
    throw new Invalid('T5 window too narrow for scheduler slack: ' + JSON.stringify(deadlines));
  }
  await until(deadlines.activityDeadline + slack);
  const sweep = await p.C.request('call', { handle: 'main', method: 'history', args: [{ topic }] });
  assert.equal(sweep.ok, true);
  ctx.observe('sweep', { started: sweep.started, finished: sweep.finished });
  if (!(
    sweep.started >= deadlines.activityDeadline + slack &&
    sweep.finished <= deadlines.wrongRefreshDeadline - slack
  )) {
    throw new Invalid(
      'T5 sweep missed its observation window: ' + JSON.stringify({ ...deadlines, sweep }),
    );
  }
  const [retired] = (await p.C.ok('call', { handle: 'main', method: 'subscriptions' })).filter(
    (s) => s.name === name,
  );
  assert.equal(retired.state, 'retired');
  assert.ok(retired.retiredAt, 'history applied the retirement sweep');
  assert.equal(
    retired.expiresAt,
    deadlines.activityDeadline,
    'publication extended the inactivity deadline',
  );
  for (const item of sweep.result.filter((m) => [first.id, inWindow.result.id].includes(m.id))) {
    assert.equal(item.deliveries[0].state, 'cancelled');
  }
  assert.equal(
    (await p.B.ok('call', { handle: 'main', method: 'ack', args: [claimed.receipt] })).status,
    'stale',
  );
  expectCode(
    await p.A.request('call', {
      handle: 'main',
      method: 'publish',
      args: [{ topic, body: 'late' }],
    }),
    'REFUSED',
    'publish with no remaining matches',
  );
  ctx.observe('retired', { retiredAt: retired.retiredAt, expiresAt: retired.expiresAt });
}

async function t6(ctx, c, p) {
  const topic = topicOf(c);
  const ttl = 1500;
  await openAll(p, 't6', ['A', 'B', 'C']);
  const name = `live-${suffix(c)}`;
  const created = await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [name, { topics: [topic], inactivityTtlMs: ttl }],
    as: 'live',
  });
  const waiting = p.B.request(
    'sub',
    { sub: 'live', method: 'wait', args: [{ timeoutMs: ttl * 6 }] },
    { timeoutMs: ttl * 8 },
  );
  await until(created.createdAt + ttl * 2.5);
  const [renewed] = (await p.C.ok('call', { handle: 'main', method: 'subscriptions' })).filter(
    (s) => s.name === name,
  );
  assert.equal(renewed.state, 'active', 'idle waiter failed to renew');
  assert.ok(renewed.expiresAt > created.createdAt + ttl * 2, 'deadline did not advance while idle');
  ctx.observe('renewal', {
    createdAt: created.createdAt,
    originalDeadline: created.expiresAt,
    observedDeadline: renewed.expiresAt,
    observedAt: Date.now(),
  });
  const sent = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'after-idle' }],
  });
  const delivery = await waiting;
  assert.equal(delivery.ok, true);
  assert.equal(delivery.result.messageId, sent.id);
  assert.equal(
    (await p.B.ok('call', { handle: 'main', method: 'ack', args: [delivery.result.receipt] }))
      .status,
    'acked',
  );
}

async function t7(ctx, c, p) {
  const topic = topicOf(c);
  await openAll(p, 't7', ['B', 'C']);
  const name = `s-${suffix(c)}`;
  await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [name, { topics: [topic] }],
    as: 's',
  });
  expectCode(
    await p.C.request('call', {
      handle: 'main',
      method: 'subscribe',
      args: [name, { topics: [topic + '.other'] }],
      as: 'x',
    }),
    'CONFIG_MISMATCH',
    'incompatible creation options',
  );
  expectCode(
    await p.C.request('call', {
      handle: 'main',
      method: 'subscribe',
      args: [`bad-${suffix(c)}`, { topics: [topic, topic] }],
      as: 'y',
    }),
    'INPUT',
    'duplicate topic filters',
  );
}

async function t8(ctx, c, p) {
  const topic = topicOf(c);
  const claimTtl = 1500,
    ttl = 1500,
    handlerMs = 5000;
  await openAll(p, 't8', ['A', 'B', 'C']);
  await p.B.ok('call', {
    handle: 'main',
    method: 'subscribe',
    args: [`tmp-${suffix(c)}`, { topics: [topic], inactivityTtlMs: ttl }],
    as: 'tmp',
  });
  const started = p.B.waitFor('handler-started', () => true, 20000);
  const finished = p.B.waitFor('handler-finished', () => true, 30000);
  const closed = p.B.waitFor('client-closed', () => true, 40000);
  await p.B.ok('listen', { sub: 'tmp', listener: 'l', handlerMs });
  const sent = await p.A.ok('call', {
    handle: 'main',
    method: 'publish',
    args: [{ topic, body: 'long-handler' }],
  });
  const entered = await started;
  await p.B.ok('close-later', { handle: 'main' });
  const [done, shut] = await Promise.all([finished, closed]);
  assert.equal(shut.error, undefined, 'graceful close failed');
  assert.equal(done.aborted, false, 'handler lost its claim during graceful close');
  assert.ok(shut.at >= done.at, 'close returned before the handler finished');
  assert.ok(
    done.at - entered.at >= Math.max(claimTtl, ttl) * 2,
    'handler did not outlive the initial lifetimes',
  );
  const history = await p.C.ok('call', { handle: 'main', method: 'history', args: [{ topic }] });
  assert.equal(
    history.find((item) => item.id === sent.id).deliveries[0].state,
    'acked',
    'C observes acceptance',
  );
  ctx.observe('handler', { started: entered.at, finished: done.at, closed: shut.at });
}

async function l1(ctx, c, p) {
  const expiresInMs = 2000,
    slack = 600;
  await openAll(p, 'l1', ['A', 'B', 'C']);
  const mailbox = `m-${suffix(c)}`;
  await p.B.ok('call', { handle: 'main', method: 'createMailbox', args: [mailbox] });
  const sent = await p.A.request('call', {
    handle: 'main',
    method: 'send',
    args: [{ to: mailbox, body: 'expiring', expiresInMs }],
  });
  assert.equal(sent.ok, true);
  await until(sent.finished + expiresInMs + slack);
  const late = await p.B.request('call', { handle: 'main', method: 'receive', args: [mailbox] });
  assert.equal(late.ok, true);
  assert.deepEqual(late.result, [], 'expired message was still claimable');
  const history = await p.C.request('call', {
    handle: 'main',
    method: 'history',
    args: [{ recipient: mailbox }],
  });
  assert.ok(history.started >= late.finished);
  const entry = history.result.find((item) => item.id === sent.result.id);
  assert.equal(entry.deliveries[0].state, 'expired');
  ctx.observe('expiry', {
    sent: sent.finished,
    claimAttempt: late.started,
    history: history.started,
  });
}

async function l2(ctx, c, p) {
  const claimTtl = 1500,
    retryDelay = 1000;
  await openAll(p, 'l2', ['A', 'B', 'C']);
  const mailbox = `m-${suffix(c)}`;
  await p.B.ok('call', { handle: 'main', method: 'createMailbox', args: [mailbox] });
  const sent = await p.A.ok('call', {
    handle: 'main',
    method: 'send',
    args: [{ to: mailbox, body: 'retry' }],
  });
  const [first] = await p.B.ok('call', { handle: 'main', method: 'receive', args: [mailbox] });
  assert.equal(first.attempt, 1);
  const retried = await p.C.request(
    'call',
    {
      handle: 'main',
      method: 'wait',
      args: [mailbox, { timeoutMs: claimTtl + retryDelay * 4 + 5000 }],
    },
    { timeoutMs: 30000 },
  );
  assert.equal(retried.ok, true);
  const second = retried.result;
  assert.equal(second.id, first.id, 'retry is the same stable delivery');
  assert.notEqual(second.receipt.claimId, first.receipt.claimId, 'retry reused the old receipt');
  assert.equal(second.attempt, 2);
  assert.ok(
    second.claimedAt >= first.claimExpiresAt + retryDelay - 50,
    'retry preceded its deadline',
  );
  assert.equal(
    (await p.B.ok('call', { handle: 'main', method: 'ack', args: [first.receipt] })).status,
    'stale',
  );
  assert.equal(
    (await p.C.ok('call', { handle: 'main', method: 'ack', args: [second.receipt] })).status,
    'acked',
  );
  const history = await p.C.ok('call', {
    handle: 'main',
    method: 'history',
    args: [{ recipient: mailbox }],
  });
  const entry = history.find((item) => item.id === sent.id);
  assert.equal(entry.deliveries[0].state, 'acked');
  assert.equal(entry.deliveries[0].attempts, 2);
  ctx.observe('retry', { firstExpiry: first.claimExpiresAt, secondClaim: second.claimedAt });
}

async function l3(ctx, c, p) {
  const session = 3000,
    slack = 1000;
  await openAll(p, 'l3', ['A', 'B', 'C']);
  const b = `b-${suffix(c)}`,
    cName = `c-${suffix(c)}`;
  await p.B.ok('call', { handle: 'main', method: 'createMailbox', args: [b] });
  await p.B.ok('call', { handle: 'main', method: 'register', args: [b] });
  await p.C.ok('call', { handle: 'main', method: 'createMailbox', args: [cName] });
  await p.C.ok('call', { handle: 'main', method: 'register', args: [cName] });
  const online = (await p.A.ok('call', { handle: 'main', method: 'agents' }))
    .filter((a) => a.online)
    .map((a) => a.name);
  assert.deepEqual(online.toSorted(), [b, cName].toSorted());
  await p.B.request('exit-abrupt', {}, { timeoutMs: 2000 });
  const exit = await p.B.exited;
  const exitedAt = Date.now();
  ctx.observe('abruptExit', { ...exit, at: exitedAt });
  await until(exitedAt + session + slack);
  const broadcast = await p.A.ok('call', {
    handle: 'main',
    method: 'send',
    args: [{ to: '*', body: 'broadcast' }],
  });
  assert.deepEqual(broadcast.recipients, [cName], 'broadcast did not exclude expired presence');
  const [delivered] = await p.C.ok('call', { handle: 'main', method: 'receive', args: [cName] });
  assert.equal(delivered.messageId, broadcast.id);
  await p.C.ok('call', { handle: 'main', method: 'ack', args: [delivered.receipt] });
  const direct = await p.A.ok('call', {
    handle: 'main',
    method: 'send',
    args: [{ to: b, body: 'still-durable' }],
  });
  assert.deepEqual(direct.recipients, [b], 'durable mailbox lost with presence');
  ctx.observe('presence', { broadcast: broadcast.recipients, direct: direct.recipients });
}

// ACL and readiness reruns: one identity and runtime per instance.
async function aclCase(ctx, c, p) {
  const [role] = Object.keys(c.roles);
  const P = p[role];
  const probe = async (profile, commands) => (await P.ok('acl', { profile, commands })).results;
  // The store must exist so an allowed in-store read has something to read.
  await P.ok('open', { handle: 'store', profile: 'acl' });
  switch (c.family) {
    case 'A1': {
      const [inside, outside] = await probe('acl', [
        ['HGET', '{root}', 'format'],
        ['HGET', '{outside}', 'format'],
      ]);
      assert.equal(inside.error, undefined, 'in-store read was denied');
      assert.equal(outside.error, 'NOPERM');
      ctx.observe('replies', { inside, outside });
      break;
    }
    case 'A2': {
      const [inside, outside] = await probe('acl', [
        ['PUBLISH', '{notify}', 'sem3'],
        ['PUBLISH', '{outside-channel}', 'sem3'],
      ]);
      assert.equal(typeof inside.value, 'number');
      assert.equal(outside.error, 'NOPERM');
      ctx.observe('replies', { inside, outside });
      break;
    }
    case 'A3': {
      const [inside, outside] = await probe('acl', [
        ['SUBSCRIBE', '{notify}'],
        ['SUBSCRIBE', '{outside-channel}'],
      ]);
      assert.equal(inside.value?.[0], 'subscribe');
      assert.equal(outside.error, 'NOPERM');
      ctx.observe('replies', { inside, outside });
      break;
    }
    case 'A4': {
      const [computed] = await probe('acl-rootonly', [['HGET', '{computed}', 'missing']]);
      assert.equal(computed.error, 'NOPERM');
      expectCode(
        await P.request('open', { handle: 'root-only', profile: 'acl-rootonly' }),
        'ACCESS',
        'root-only startup',
      );
      break;
    }
    case 'A5':
      expectCode(
        await P.request('open', { handle: 'no-channel', profile: 'acl-nochannel' }),
        'ACCESS',
        'startup without the notification channel',
      );
      break;
    case 'A6': {
      await P.ok('open', { handle: 'live', profile: 'acl-revoke' });
      const user = redisUser(P.account.name, 'acl-revoke');
      const ids = async () =>
        (await ctx.redis.clientList())
          .filter((client) => client.user === user)
          .map((client) => client.id)
          .toSorted();
      const before = await ids();
      assert.ok(before.length > 0, 'live client has no connections');
      for (const command of ['eval', 'time']) {
        await ctx.redis.command('ACL', 'SETUSER', user, '-' + command);
        expectCode(
          await P.request('call', { handle: 'live', method: 'info' }),
          'ACCESS',
          `existing operation without ${command}`,
        );
        expectCode(
          await P.request('open', { handle: `fresh-${command}`, profile: 'acl-revoke' }),
          'ACCESS',
          `fresh startup without ${command}`,
        );
        await ctx.redis.command('ACL', 'SETUSER', user, '+' + command);
        await P.ok('call', { handle: 'live', method: 'info' });
      }
      const after = await ids();
      for (const id of before) {
        assert.ok(after.includes(id), 'permission refusal reconnected an established socket');
      }
      ctx.observe('connections', { before, after });
      break;
    }
    default:
      throw new Error('Unknown ACL case');
  }
}

async function readinessCase(ctx, c, p) {
  const [role] = Object.keys(c.roles);
  const P = p[role];
  if (c.family === 'R1') {
    const opened = await P.ok('open', { handle: 'warn', profile: 'ready-warn' });
    assert.ok(
      opened.warnings.some(
        (w) =>
          w.code === 'SEMAPHILE_REDIS_READINESS' && w.message.includes('could not be inspected'),
      ),
      'warn mode did not report the uninspectable settings',
    );
    ctx.observe('warnings', opened.warnings);
  } else if (c.family === 'R2') {
    expectCode(
      await P.request('open', { handle: 'strict', profile: 'ready-strict' }),
      'READINESS',
      'strict startup without inspection',
    );
  } else {
    const settings = ctx.redis.identity.settings;
    assert.equal(settings.appendonly, 'yes');
    assert.equal(settings.appendfsync, 'always');
    assert.equal(settings['no-appendfsync-on-rewrite'], 'no');
    assert.equal(settings['maxmemory-policy'], 'noeviction');
    assert.equal((await ctx.redis.infoMap('persistence')).aof_last_write_status, 'ok');
    const opened = await P.ok('open', { handle: 'strict', profile: 'ready-inspect' });
    assert.deepEqual(
      opened.warnings.filter((w) => w.code === 'SEMAPHILE_REDIS_READINESS'),
      [],
    );
    ctx.observe('open', opened.open);
  }
}

export const CASES = {
  D1: d1,
  T1: t1,
  T2: t2,
  T3: t3,
  T4: t4,
  T5: t5,
  T6: t6,
  T7: t7,
  T8: t8,
  L1: l1,
  L2: l2,
  L3: l3,
  A1: aclCase,
  A2: aclCase,
  A3: aclCase,
  A4: aclCase,
  A5: aclCase,
  A6: aclCase,
  R1: readinessCase,
  R2: readinessCase,
  R3: readinessCase,
};
// Profiles each family's participants use, for credential corroboration.
export const FAMILY_PROFILE = {
  D1: 'd1',
  A1: 'acl',
  A2: 'acl',
  A3: 'acl',
  A4: 'acl-rootonly',
  A5: 'acl-nochannel',
  A6: 'acl-revoke',
  R1: 'ready-warn',
  R2: 'ready-strict',
  R3: 'ready-inspect',
};
export const profileFor = (family) => FAMILY_PROFILE[family] ?? family.toLowerCase();

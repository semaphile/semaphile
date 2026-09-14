// Independent monitoring connections. Registration never creates an admission
// owner, and sampling projects a private state draft without writing pool state.
import { createClient, createCluster, ErrorReply } from '@redis/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolMeasurement, PoolObserver } from '@semaphile/core/observation';
import { CollectorConflictError } from '@semaphile/core/observation';
export { CollectorConflictError } from '@semaphile/core/observation';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const poolKey = (namespace: string, pool: string) =>
  `semaphile:{${hash(JSON.stringify([namespace, pool]))}}:state`;
const registrationScript = `
local time=redis.call('TIME'); local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
local action,id,ttl=ARGV[1],ARGV[2],tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
local prior=redis.call('ZSCORE',KEYS[1],id)
if action=='close' then redis.call('ZREM',KEYS[1],id); return '[]' end
local owners=redis.call('ZRANGE',KEYS[1],0,-1)
if action=='owners' then return cjson.encode(owners) end
if action=='renew' and (not prior or tonumber(prior)<=now) then return redis.error_reply('Collector registration expired') end
if action=='open' and (prior or (#owners>0 and ARGV[4]~='true')) then return cjson.encode({conflicts=owners}) end
if #owners>=1024 and not prior then return redis.error_reply('Too many collectors') end
redis.call('ZADD',KEYS[1],now+ttl,id); redis.call('PEXPIRE',KEYS[1],ttl)
return cjson.encode(owners)
`;
const projectionScript = `
local null, MAX_SAFE_INTEGER = cjson.null, 9007199254740991
local function integerString(n) return string.format('%.0f',n) end
local function integer(n,minimum,maximum) if n<minimum or n>maximum or n~=math.floor(n) then error('Invalid integer') end; return n end
${readFileSync(new URL('./control.lua', import.meta.url), 'utf8')}
local clock=redis.call('TIME'); local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
local expires=redis.call('ZSCORE',KEYS[2],ARGV[1])
if not expires or tonumber(expires)<=now then return redis.error_reply('Collector registration expired') end
if redis.call('STRLEN',KEYS[1])>1048576 then return redis.error_reply('Pool exceeds observation state bound') end
local raw=redis.call('GET',KEYS[1]); if not raw then return redis.error_reply('Missing pool') end
local state=cjson.decode(raw); if state.format~='2' then return redis.error_reply('Unsupported pool format') end
local config=cjson.decode(state.config); local control=Control.decode(state.control)
for id,owner in pairs(state.owners) do
 if tonumber(owner.deadline)<=now then Control.abandon(control,config.recovery,id,now); state.owners[id]=nil end
end
local active=0
for id,lease in pairs(state.leases) do
 if state.owners[lease.owner] and (lease.expires==null or tonumber(lease.expires)>now) then active=active+tonumber(lease.weight)
 else Control.expire(control,config.recovery,id,now) end
end
Control.eligibility(control,config.recovery,now)
local remaining=state.remaining
if remaining~=null then remaining=tonumber(remaining) end
if state.nextRefresh~=null and tonumber(state.nextRefresh)<=now then remaining=config.reservoirRefreshAmount end
local status=Control.status(control)
return cjson.encode({at=now,active=active,maxConcurrent=config.maxConcurrent,reservoir=remaining,
 pending=status.pending,unconfirmed=status.unconfirmed,maintenance=status.mode,circuit=control.recovery.circuit,
 cooldownUntil=control.recovery.cooldownUntil,openUntil=control.recovery.openUntil})
`;
export type RedisObservationOptions = { url?: string; rootUrls?: string[]; namespace?: string };
export async function openObservationSource(options: RedisObservationOptions) {
  const namespace = options.namespace ?? 'semaphile';
  const defaults = {
    socket: { reconnectStrategy: false as const, connectTimeout: 2000 },
    disableOfflineQueue: true,
    commandOptions: { timeout: 2000 },
  };
  const client = options.rootUrls
    ? createCluster({ rootNodes: options.rootUrls.map((url) => ({ url })), defaults })
    : createClient({ ...defaults, url: options.url });
  client.on('error', () => {});
  let retired = false;
  const retire = () => {
    retired = true;
    try {
      client.destroy();
    } catch {
      /* A failed connect may already be closed. */
    }
  };
  const available = () => {
    if (retired) {
      throw new Error('Redis observation source retired');
    }
  };

  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            retire();
            reject(new Error('Redis observation timed out'));
          }, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await bounded<unknown>(client.connect());
  } catch (error) {
    retire();
    throw error;
  }
  const evaluation = async (script: string, keys: string[], args: string[]) => {
    available();
    const result = await bounded(client.eval(script, { keys, arguments: args }));
    if (typeof result !== 'string') {
      throw new Error('Invalid Redis observation reply');
    }
    return result;
  };
  const observers = new Set<PoolObserver>();
  return {
    async identity(pool: string): Promise<string> {
      available();
      const node =
        'getNodeClientForKey' in client
          ? await bounded(client.getNodeClientForKey(poolKey(namespace, pool)))
          : client;
      const info = await bounded(node.info('server'));
      const runId = /^run_id:([^\r\n]+)/m.exec(info)?.[1];
      if (!runId) {
        throw new Error('Redis server identity unavailable');
      }
      const database = options.rootUrls
        ? '0'
        : String(Number(new URL(options.url ?? 'redis://localhost').pathname.slice(1) || '0'));
      return hash(JSON.stringify([runId, database, namespace, pool]));
    },
    async discover(options: { timeoutMs?: number } = {}): Promise<string[]> {
      available();
      const deadline = performance.now() + Math.min(options.timeoutMs ?? 5000, 30000);
      const nodes =
        'masters' in client
          ? await Promise.all(client.masters.map((node) => client.nodeClient(node)))
          : [client];
      const pools = new Set<string>();
      for (const node of nodes) {
        let cursor = '0',
          pages = 0;
        do {
          if (performance.now() >= deadline) {
            throw new Error('Redis discovery timed out');
          }
          const page = await bounded(
            node.scan(cursor, { MATCH: `semaphile:discovery:${hash(namespace)}:*`, COUNT: 100 }),
          );
          cursor = page.cursor;
          for (const key of page.keys) {
            if (performance.now() >= deadline) {
              throw new Error('Redis discovery timed out');
            }
            const raw = await bounded(client.get(key));
            if (!raw) {
              continue;
            }
            const record = JSON.parse(raw) as {
              format: number;
              namespace: string;
              pool: string;
              key: string;
            };
            if (
              record.format === 1 &&
              record.namespace === namespace &&
              typeof record.pool === 'string' &&
              record.key === poolKey(namespace, record.pool) &&
              (await bounded(client.exists(record.key)))
            ) {
              pools.add(record.pool);
            }
            if (pools.size > 1024) {
              throw new Error('Redis discovery exceeds pool bound');
            }
          }
          if (++pages > 1000) {
            throw new Error('Redis discovery exceeds scan bound');
          }
        } while (cursor !== '0');
      }
      return [...pools].sort();
    },
    async open(pool: string, collectorId: string, allowOverlap = false): Promise<PoolObserver> {
      available();
      if (!/^[a-f0-9-]{36}$/.test(collectorId)) {
        throw new Error('Invalid collector identity');
      }
      const key = poolKey(namespace, pool),
        registry = key + ':collectors-v1',
        ttl = 30000;
      if (!(await bounded(client.exists(key)))) {
        throw new Error('Missing pool');
      }
      const sent = performance.now();
      const opened = JSON.parse(
        await evaluation(
          registrationScript,
          [registry],
          ['open', collectorId, String(ttl), String(allowOverlap)],
        ),
      ) as { conflicts?: string[] };
      if (opened.conflicts) {
        throw new CollectorConflictError(opened.conflicts);
      }
      let validUntil = sent + ttl,
        closed = false,
        failed = false;
      let renewal: ReturnType<typeof setTimeout> | undefined;
      const renew = () => {
        renewal = setTimeout(() => {
          const start = performance.now();
          if (closed || start >= validUntil) {
            failed = true;
            return;
          }
          void evaluation(
            registrationScript,
            [registry],
            ['renew', collectorId, String(ttl), ''],
          ).then(
            () => {
              if (closed || performance.now() >= validUntil) {
                failed = true;
                return;
              }
              validUntil = start + ttl;
              renew();
            },
            () => {
              failed = true;
            },
          );
        }, ttl / 3);
      };
      renew();
      const check = () => {
        if (retired || closed || failed || performance.now() >= validUntil) {
          throw new Error('Collector registration lost');
        }
      };
      const observer: PoolObserver = {
        valid: () => !retired && !closed && !failed && performance.now() < validUntil,
        async sample() {
          check();
          try {
            const result = JSON.parse(
              await evaluation(projectionScript, [key, registry], [collectorId]),
            ) as PoolMeasurement;
            check();
            return result;
          } catch (error) {
            if (
              !(error instanceof ErrorReply) ||
              error.message.includes('Collector registration expired')
            ) {
              failed = true;
            }
            throw error;
          }
        },
        async owners() {
          check();
          const result = JSON.parse(
            await evaluation(
              registrationScript,
              [registry],
              ['owners', collectorId, String(ttl), ''],
            ),
          );
          check();
          if (!Array.isArray(result) || !result.includes(collectorId)) {
            failed = true;
            throw new Error('Collector registration lost');
          }
          return result;
        },
        async close() {
          if (closed) {
            return;
          }
          closed = true;
          clearTimeout(renewal);
          observers.delete(observer);
          await evaluation(registrationScript, [registry], ['close', collectorId, String(ttl), '']);
        },
      };
      observers.add(observer);
      return observer;
    },
    async close() {
      await Promise.allSettled([...observers].map((observer) => observer.close()));
      retire();
    },
  };
}

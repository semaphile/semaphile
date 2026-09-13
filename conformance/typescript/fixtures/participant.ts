import { writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type Stage } from '../../../packages/core/dist/src/backend.js';
const [path, addon, config] = process.argv.slice(2);
const pool = new Pool(path, JSON.parse(config), addon);
const controllers = new Map<string, AbortController>();
const send = (value: unknown) => process.send?.(value);
pool.onWait = () => send({ event: 'waiting', stats: { ...pool.stats } });
process.on('message', async (message: any) => {
  const { id, action } = message;
  try {
    let value: unknown;
    switch (action) {
      case 'acquire': {
        const controller = new AbortController();
        controllers.set(id, controller);
        try {
          value = await pool.acquire(controller.signal);
        } finally {
          controllers.delete(id);
        }
        break;
      }
      case 'abort':
        controllers.get(message.target)?.abort();
        break;
      case 'release':
        pool.release(message.lease);
        break;
      case 'crashRelease':
      case 'crashTouch':
        pool.stage = (stage: Stage) => {
          if (stage === message.stage) {
            writeSync(1, JSON.stringify({ event: 'crash-point', stage }) + '\n');
            process.kill(process.pid, 'SIGSTOP');
          }
        };
        if (action === 'crashTouch') pool.touchForTest();
        else pool.release(message.lease);
        throw new Error('crash fixture unexpectedly resumed');
      case 'demo': {
        const jobs = await Promise.all(
          Array.from({ length: 10 }, async (_, index) => {
            const lease = await pool.acquire();
            const started = Date.now();
            await delay(60 + (index % 3) * 15);
            const completed = Date.now();
            pool.release(lease);
            return { lease, started, completed, pid: process.pid };
          }),
        );
        value = jobs;
        break;
      }
      case 'inspect':
        value = pool.inspect();
        break;
      case 'stats':
        value = { ...pool.stats };
        break;
      case 'close':
        await pool.close();
        send({ id, value: null });
        process.disconnect();
        return;
      default:
        throw new Error('unknown action');
    }
    send({ id, value: value ?? null });
  } catch (error) {
    send({ id, error: String(error) });
  }
});
send({ event: 'ready', pid: process.pid, owner: pool.owner });

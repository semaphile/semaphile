import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { Pool } from '../../packages/core/dist/src/backend.js';
const pool = new Pool(workerData.path, { maxConcurrent: 1 }, workerData.addon);
pool.onWait = () => parentPort.postMessage({ event: 'waiting' });
parentPort.on('message', async ({ id, action, lease }) => {
  try {
    let value = null;
    if (action === 'acquire') {
      value = await pool.acquire();
    } else if (action === 'release') {
      pool.release(lease);
    } else if (action === 'failClose') {
      const originalExec = pool.db.exec.bind(pool.db),
        originalClose = pool.lifetime.close.bind(pool.lifetime);
      let gateHeld = false;
      pool.db.exec = (sql) => {
        if (sql === 'BEGIN IMMEDIATE') {
          throw new Error('injected cleanup transaction failure');
        }
        return originalExec(sql);
      };
      pool.lifetime.close = () => {
        gateHeld = pool.native.alive(join(workerData.path, 'coordination.lock'));
        return originalClose();
      };
      try {
        await pool.close();
        throw new Error('expected cleanup failure');
      } catch (error) {
        value = { error: String(error), gateHeld, pid: process.pid };
      } finally {
        pool.lifetime.close = originalClose;
      }
    } else if (action === 'close') {
      await pool.close();
      parentPort.postMessage({ id, value });
      parentPort.close();
      return;
    } else {
      throw new Error('unknown fault fixture action');
    }
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error) });
  }
});
parentPort.postMessage({ event: 'ready' });

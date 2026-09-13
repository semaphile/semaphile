import { parentPort, workerData } from 'node:worker_threads';
import { openLimiter } from '../../packages/core/dist/src/index.js';
import { setTimeout as delay } from 'node:timers/promises';
try {
  const limiter = await openLimiter({ path: workerData.path, config: { maxConcurrent: 2 } });
  await Promise.all(Array.from({ length: 4 }, () => limiter.schedule(() => delay(30))));
  await limiter.close();
  parentPort.postMessage({ ok: true });
} catch (error) {
  parentPort.postMessage({ error: String(error) });
  process.exitCode = 1;
}
parentPort.close();

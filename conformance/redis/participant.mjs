import { randomUUID } from 'node:crypto';
import { owner, connect, config } from './harness.mjs';
const pool = process.env.POOL,
  url = process.env.REDIS_URL;
const subscriber = await connect(url),
  wakes = new Set();
let version = 0;
await subscriber.subscribe(pool + ':notify', () => {
  version++;
  for (const wake of wakes) {
    wake();
  }
});
const client = await owner(url, pool, config({ ownerTimeoutMs: 10000 }));
const watchdog = setTimeout(() => {
  console.error('Participant timed out');
  process.exit(1);
}, 15000);
try {
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      const lease = randomUUID();
      while (true) {
        const observed = version,
          sent = performance.now();
        const result = await client.invoke('acquire', { lease, weight: 1, expirationMs: null });
        if (result.admission) {
          break;
        }
        if (version !== observed) {
          continue;
        }
        await new Promise((resolve) => {
          let timer;
          const done = () => {
            clearTimeout(timer);
            wakes.delete(done);
            resolve();
          };
          wakes.add(done);
          if (result.deadline !== null) {
            timer = setTimeout(
              done,
              Math.max(0, sent + Number(result.deadline) - Number(result.now) - performance.now()),
            );
          }
        });
      }
      try {
        const response = await fetch(process.env.HTTP_URL);
        if (!response.ok) {
          throw new Error('HTTP fixture failed');
        }
        await response.text();
      } finally {
        await client.invoke('release', { lease });
      }
    }),
  );
  await client.invoke('close');
} finally {
  clearTimeout(watchdog);
  client.destroy();
  subscriber.destroy();
}

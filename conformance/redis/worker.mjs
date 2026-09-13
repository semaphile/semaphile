import { openLimiter } from '../../packages/redis/dist/index.js';
const limiter = await openLimiter({
  url: process.env.REDIS_URL,
  pool: process.env.POOL,
  config: JSON.parse(process.env.CONFIG),
  ownerTimeoutMs: Number(process.env.OWNER_TIMEOUT),
});
try {
  if (process.env.MODE === 'hold') {
    await limiter.schedule(async () => {
      console.log('READY');
      await new Promise(() => {});
    });
  } else {
    const request = async (first) => {
      const response = await fetch(process.env.HTTP_URL + (first ? '?first=1' : ''), {
        headers: { 'x-worker': process.env.WORKER_LABEL ?? 'worker' },
      });
      if (!response.ok) {
        throw new Error('HTTP failed');
      }
      await response.text();
    };
    if (process.env.FIRST_JOB_BARRIER) {
      await limiter.schedule(() => request(true));
    }
    const count = process.env.FIRST_JOB_BARRIER ? 9 : 10;
    await Promise.all(Array.from({ length: count }, () => limiter.schedule(() => request(false))));
  }
} finally {
  await limiter.close();
}

// Shared HTTP counter for limited work and its deliberately unthrottled control.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { deferred } from '../typescript/fixtures/cases.mjs';
export async function httpFixture() {
  const stats = { active: 0, peak: 0, completed: 0 };
  const firstBatch = deferred(),
    held = [],
    timers = new Set(),
    responses = new Set();
  let saturated = false,
    saturationTimeout;
  const finishLater = (response) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      responses.delete(response);
      stats.active--;
      stats.completed++;
      response.end('ok');
    }, 40);
    timers.add(timer);
  };
  const server = createServer((_request, response) => {
    stats.active++;
    stats.peak = Math.max(stats.peak, stats.active);
    responses.add(response);
    if (saturated) {
      finishLater(response);
      return;
    }
    held.push(response);
    if (held.length === 5) {
      saturated = true;
      clearTimeout(saturationTimeout);
      firstBatch.resolve();
      // Keep all five active across later request events, so over-admission
      // remains observable instead of being hidden by immediate completion.
      for (const pending of held.splice(0)) {
        finishLater(pending);
      }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  saturationTimeout = setTimeout(
    () => firstBatch.reject(new Error('HTTP saturation timed out')),
    10000,
  );
  return {
    stats,
    url: `http://127.0.0.1:${server.address().port}`,
    saturated: firstBatch.promise,
    async close() {
      clearTimeout(saturationTimeout);
      for (const timer of timers) {
        clearTimeout(timer);
      }
      for (const response of responses) {
        response.destroy();
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

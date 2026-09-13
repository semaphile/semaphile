// A real TCP blackhole for response-loss/partition tests. No retry or polling.
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
export async function proxy(url) {
  const target = new URL(url),
    pairs = new Set();
  let discard = false,
    subscriberOnly = false,
    stage;
  const server = createServer((downstream) => {
    const upstream = connect({ host: target.hostname, port: Number(target.port) });
    const pair = { upstream, downstream, subscriber: false, discard: false };
    pairs.add(pair);
    const close = () => {
      pairs.delete(pair);
      upstream.destroy();
      downstream.destroy();
    };
    upstream.on('error', close);
    downstream.on('error', close);
    upstream.on('close', close);
    downstream.on('close', close);
    downstream.on('data', (data) => {
      const text = data.toString().toUpperCase();
      if (text.includes('SUBSCRIBE')) {
        pair.subscriber = true;
      }
      if (stage && text.includes(stage)) {
        pair.discard = true;
      }
      upstream.write(data);
    });
    upstream.on('data', (data) => {
      if (!discard && !pair.discard && !(subscriberOnly && pair.subscriber)) {
        downstream.write(data);
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `redis://127.0.0.1:${server.address().port}`,
    blackholeResponses() {
      discard = true;
    },
    blackholeSubscriber() {
      subscriberOnly = true;
    },
    blackholeAt(command) {
      stage = command;
    },
    async close() {
      for (const { upstream, downstream } of pairs) {
        upstream.destroy();
        downstream.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

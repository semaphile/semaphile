import { createInterface } from 'node:readline';
const held = new Map();
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const respond = (id, text) =>
  send({ id, result: { content: [{ type: 'text', text }], _meta: { fixture: true } } });
if (process.argv.includes('--ignore-term')) {
  process.on('SIGTERM', () => {});
}
createInterface({ input: process.stdin })
  .on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params;
      send({ method: 'fixture/started', params: { id: message.id, pid: process.pid, name } });
      if (name === 'hold' || name === 'ignore') {
        held.set(message.id, { message, args });
        return;
      }
      if (name === 'callback') {
        held.set(message.id, { message, args });
        send({ id: message.id, method: 'fixture/client', params: { original: message.id } });
        return;
      }
      if (name === 'exit') {
        process.exit(7);
      }
      if (name === 'huge') {
        respond(message.id, 'x'.repeat(1048576));
        return;
      }
      if (name === 'env') {
        respond(message.id, process.env[args.name] ?? 'unset');
        return;
      }
      send({
        method: 'notifications/progress',
        params: {
          progressToken: message.params._meta?.progressToken ?? 'fixture',
          progress: 1,
          total: 1,
        },
      });
      respond(message.id, JSON.stringify(args));
      return;
    }
    if (message.method === 'notifications/cancelled') {
      send({ method: 'fixture/cancelled', params: message.params });
      const job = held.get(message.params.requestId);
      if (job?.args.cooperate) {
        held.delete(message.params.requestId);
        respond(message.params.requestId, 'cancelled');
      }
      return;
    }
    if (message.method === 'fixture/release') {
      const id = message.params.id;
      held.delete(id);
      respond(id, 'released');
      return;
    }
    if (message.method === 'fixture/exit') {
      process.exit(0);
    }
    if (message.method === 'initialize') {
      send({
        id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'raw-fixture', version: '1' },
        },
      });
      return;
    }
    if (message.method === 'fixture/hang') {
      return;
    }
    if (message.method && message.id !== undefined) {
      send({ id: message.id, result: { echo: message.params ?? {} } });
      return;
    }
    if (message.id !== undefined && held.has(message.id)) {
      held.delete(message.id);
      respond(message.id, JSON.stringify(message.result));
    }
  })
  .on('close', () => process.exit(0));

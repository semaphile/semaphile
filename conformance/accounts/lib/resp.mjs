// Minimal RESP2 connection for probes that must not depend on client retry,
// reconnect or authentication behavior: each reply is returned as observed.
import { connect as netConnect } from 'node:net';
import { once } from 'node:events';

export class RespError extends Error {
  constructor(line) {
    super(line);
    this.code = line.split(' ')[0];
  }
}

function parse(buffer, offset) {
  if (offset >= buffer.length) {
    return undefined;
  }
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) {
    return undefined;
  }
  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString('utf8', offset + 1, end);
  const next = end + 2;
  if (type === '+') {
    return { value: line, next };
  }
  if (type === '-') {
    return { value: new RespError(line), next };
  }
  if (type === ':') {
    return { value: Number(line), next };
  }
  if (type === '$') {
    const length = Number(line);
    if (length < 0) {
      return { value: null, next };
    }
    if (buffer.length < next + length + 2) {
      return undefined;
    }
    return { value: buffer.toString('utf8', next, next + length), next: next + length + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    if (count < 0) {
      return { value: null, next };
    }
    const items = [];
    let cursor = next;
    for (let index = 0; index < count; index++) {
      const item = parse(buffer, cursor);
      if (!item) {
        return undefined;
      }
      items.push(item.value);
      cursor = item.next;
    }
    return { value: items, next: cursor };
  }
  throw new Error('Unsupported RESP type ' + type);
}

const encode = (args) =>
  `*${args.length}\r\n` +
  args.map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`).join('');

export async function open({ host, port, timeoutMs = 5000 }) {
  const socket = netConnect({ host, port });
  const timer = setTimeout(() => socket.destroy(new Error('RESP connect deadline')), timeoutMs);
  try {
    await once(socket, 'connect');
  } finally {
    clearTimeout(timer);
  }
  let buffer = Buffer.alloc(0);
  const waiting = [];
  const pushes = [];
  let failure;
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let parsed;
    while ((parsed = parse(buffer, 0))) {
      buffer = buffer.subarray(parsed.next);
      const receiver = waiting.shift();
      if (receiver) {
        receiver.resolve(parsed.value);
      } else {
        pushes.push(parsed.value);
      }
    }
  });
  const fail = (error) => {
    failure ??= error;
    for (const receiver of waiting.splice(0)) {
      receiver.reject(failure);
    }
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('RESP connection closed')));
  return {
    socket,
    pushes,
    // Resolves to the reply value; a Redis error reply is returned, not thrown.
    command(...args) {
      if (failure) {
        return Promise.reject(failure);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('RESP reply deadline')), timeoutMs);
        waiting.push({
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.write(encode(args));
      });
    },
    close() {
      socket.destroy();
    },
  };
}

export const describe = (value) =>
  value instanceof RespError ? { error: value.code, message: value.message } : { value };

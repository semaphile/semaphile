import type { Writable } from 'node:stream';
import {
  parseJSONRPCMessage,
  serializeMessage,
  type JSONRPCMessage,
} from '@modelcontextprotocol/client';
/** Bound writes handed to a stream, including those waiting for its drain. */
export class MessageWriter {
  private stopped = false;
  private bytes = 0;
  private readonly pending = new Map<
    object,
    { reject: (error: Error) => void; done: Promise<void> }
  >();
  constructor(
    private readonly stream: Writable,
    private readonly maxMessageBytes: number,
    private readonly maxBufferedBytes: number,
  ) {}
  send(message: JSONRPCMessage): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error('MCP writer closed'));
    }
    const bytes = Buffer.from(serializeMessage(message));
    if (bytes.length > this.maxMessageBytes || this.bytes + bytes.length > this.maxBufferedBytes) {
      return Promise.reject(new Error('MCP output limit exceeded'));
    }
    this.bytes += bytes.length;
    const key = {};
    let reject!: (error: Error) => void, resolve!: () => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.pending.set(key, { reject, done });
    const finish = (error?: Error | null) => {
      if (!this.pending.delete(key)) {
        return;
      }
      this.bytes -= bytes.length;
      if (error) {
        reject(new Error('MCP output failed'));
      } else {
        resolve();
      }
    };
    try {
      this.stream.write(bytes, finish);
    } catch {
      finish(new Error('MCP output failed'));
    }
    void done.catch(() => {});
    return done;
  }
  async flush(milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.pending.values()].map((entry) => entry.done)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  stop(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('MCP writer closed'));
    }
    this.pending.clear();
    this.bytes = 0;
  }
}

/** Strict newline framing: malformed JSON is a session failure, not server logging. */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private readonly maxBytes: number) {}
  append(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > this.maxBytes) {
      throw new Error('MCP input limit exceeded');
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }
  readMessage(): JSONRPCMessage | null {
    const newline = this.buffer.indexOf('\n');
    if (newline < 0) {
      return null;
    }
    const line = this.buffer.toString('utf8', 0, newline);
    this.buffer = this.buffer.subarray(newline + 1);
    const message: unknown = JSON.parse(line);
    // Validate with the SDK, but keep the original envelope: schema parsing may
    // strip extension fields inside recognized metadata objects.
    parseJSONRPCMessage(message);
    return message as JSONRPCMessage;
  }
  clear(): void {
    this.buffer = Buffer.alloc(0);
  }
}

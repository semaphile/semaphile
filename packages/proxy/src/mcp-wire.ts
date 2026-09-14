import type { Writable } from 'node:stream';
import { serializeMessage, type JSONRPCMessage } from '@modelcontextprotocol/client';
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

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import type { NativeFile } from './native.js';
import type { Agent } from './types.js';
import { name, refusal, text } from './config.js';
import { event, cleanup, contentBytes } from './storage.js';
export class Presence {
  private readonly held = new Map<string, NativeFile>();
  constructor(private readonly store: Database) {}
  create(recipient: string): void {
    name(recipient);
    if (this.store.db.prepare('SELECT 1 FROM mailboxes WHERE name=?').get(recipient)) {
      return;
    }
    this.store.mutate([], () =>
      cleanup(
        this.store,
        contentBytes(this.store) + Buffer.byteLength(recipient) + 256 >
          this.store.config.maxContentBytes,
      ),
    );
    this.store.ensureNotify(recipient);
    this.store.mutate([recipient], () =>
      this.store.db.prepare('INSERT INTO mailboxes VALUES(?,?)').run(recipient, Date.now()),
    );
  }
  require(recipient: string): void {
    name(recipient);
    if (!this.store.db.prepare('SELECT 1 FROM mailboxes WHERE name=?').get(recipient)) {
      refusal(`Unknown mailbox: ${recipient}`);
    }
  }
  agents(): Agent[] {
    return this.store.db
      .prepare('SELECT * FROM agents ORDER BY registered_at,id')
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        pid: Number(row.pid),
        registeredAt: Number(row.registered_at),
        metadata: String(row.metadata),
        online:
          row.online === 1 &&
          !!this.store.native.alive(join(this.store.path, 'owners', String(row.id) + '.lock')),
      }));
  }
  reclaimDead(): number {
    const dead = this.store.db
      .prepare('SELECT id FROM agents WHERE online=1')
      .all()
      .filter(
        (row) =>
          !this.store.native.alive(join(this.store.path, 'owners', String(row.id) + '.lock')),
      )
      .slice(0, 256);
    if (dead.length) {
      this.store.mutate([], () => {
        for (const row of dead) {
          this.store.db.prepare('UPDATE agents SET online=0 WHERE id=?').run(row.id);
          event(this.store, { kind: 'offline', agent: String(row.id) });
        }
      });
    }
    return dead.length;
  }
  register(recipient: string, metadata = '{}'): Agent {
    this.require(recipient);
    text(metadata, 'metadata', 16384);
    this.reclaimDead();
    const prior = this.agents().filter((a) => a.name === recipient);
    if (prior.some((a) => a.online)) {
      refusal(`Mailbox already online: ${recipient}`);
    }
    this.store.mutate([], () =>
      cleanup(
        this.store,
        contentBytes(this.store) + Buffer.byteLength(metadata) + 2048 >
          this.store.config.maxContentBytes,
      ),
    );
    const id = randomUUID();
    mkdirSync(join(this.store.path, 'owners'), { recursive: true, mode: 0o700 });
    const fd = this.store.native.open(join(this.store.path, 'owners', id + '.lock'), 'lifetime');
    try {
      fd.lockLifetime();
      const agent = {
        id,
        name: recipient,
        pid: process.pid,
        registeredAt: Date.now(),
        metadata,
        online: true,
      };
      this.store.mutate([recipient], () => {
        this.store.db.prepare('UPDATE agents SET online=0 WHERE name=?').run(recipient);
        this.store.db
          .prepare('INSERT INTO agents VALUES(?,?,?,?,?,1)')
          .run(id, recipient, process.pid, agent.registeredAt, metadata);
        event(this.store, { kind: 'registered', agent: id, subject: recipient });
      });
      this.held.set(id, fd);
      return agent;
    } catch (error) {
      fd.close();
      throw error;
    }
  }
  unregister(id: string): void {
    const fd = this.held.get(id);
    if (fd === undefined) {
      refusal('Registration belongs to another client or is already closed');
    }
    try {
      this.store.mutate([], () => {
        this.store.db.prepare('UPDATE agents SET online=0 WHERE id=?').run(id);
        event(this.store, { kind: 'offline', agent: id });
      });
    } finally {
      this.held.delete(id);
      fd.close();
    }
  }
  close(): void {
    const errors: unknown[] = [];
    for (const id of this.held.keys()) {
      try {
        this.unregister(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'Registration cleanup failed');
    }
  }
}

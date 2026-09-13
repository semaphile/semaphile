// A coordinator worker owns this connection and every descriptor. All methods
// that inspect or change SQLite run under its gate, including open and close.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { nativePath } from './native-path.js';
import type { Native, NativeContext, NativeFile } from './native.js';
import { contentBytes, trimEvents } from './storage.js';
import { differences, MessagingError, normalize } from './config.js';
import type { Difference, StoreConfig } from './types.js';
export const FORMAT = 'semaphile-messaging/1.0';
export class Database {
  native: NativeContext = new (
    createRequire(import.meta.url)(nativePath()) as Native
  ).NativeContext();
  gate: NativeFile;
  db!: DatabaseSync;
  config!: StoreConfig;
  differences: Difference[] = [];
  constructor(
    public path: string,
    expected: StoreConfig,
    mismatch: 'warn' | 'error',
    inspect = false,
  ) {
    if (mismatch !== 'warn' && mismatch !== 'error') {
      throw new MessagingError('INPUT', 'Invalid configMismatch');
    }
    if (inspect && !existsSync(join(path, 'state.sqlite'))) {
      throw new MessagingError('STORE', 'Store does not exist');
    }
    mkdirSync(path, { recursive: true, mode: 0o700 });
    this.gate = this.native.open(join(path, 'coordination.lock'), 'gate');
    try {
      this.locked(() => {
        try {
          this.db = new DatabaseSync(join(path, 'state.sqlite'));
          this.db.exec('PRAGMA busy_timeout=0;');
          const exists = this.db
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='config'")
            .get();
          if (exists) {
            const row = this.db.prepare('SELECT format,value FROM config WHERE singleton=1').get();
            if (row?.format !== FORMAT) {
              throw new MessagingError('FORMAT', 'Unsupported messaging store format');
            }
            this.config = normalize(JSON.parse(String(row.value)) as StoreConfig);
            this.differences = differences(expected, this.config);
            if (this.differences.length && mismatch === 'error' && !inspect) {
              throw new MessagingError('CONFIG_MISMATCH', JSON.stringify(this.differences));
            }
          } else {
            if (inspect) {
              throw new MessagingError('FORMAT', 'Not a messaging store');
            }
            const other = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get();
            if (other) {
              throw new MessagingError('FORMAT', 'Refusing to initialize a nonempty database');
            }
            this.config = expected;
            this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
            this.db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE config(singleton INTEGER PRIMARY KEY CHECK(singleton=1),format TEXT NOT NULL,value TEXT NOT NULL);
            CREATE TABLE mailboxes(name TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
            CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,pid INTEGER NOT NULL,registered_at INTEGER NOT NULL,metadata TEXT NOT NULL,online INTEGER NOT NULL);
            CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,dedupe_key TEXT UNIQUE,fingerprint TEXT NOT NULL,envelope TEXT,recipients TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER,terminal_at INTEGER);
            CREATE TABLE deliveries(id TEXT PRIMARY KEY,message_seq INTEGER NOT NULL,recipient TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL,claim_id TEXT,claimed_at INTEGER,claim_expires_at INTEGER,handling_expires_at INTEGER,available_at INTEGER NOT NULL,error TEXT,acked_claim TEXT,UNIQUE(message_seq,recipient));
            CREATE INDEX inbox ON deliveries(recipient,state,available_at,message_seq);
            CREATE INDEX message_deliveries ON deliveries(message_seq);
            CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,kind TEXT NOT NULL,agent TEXT,subject TEXT,topic TEXT,payload TEXT);
          `);
            this.db
              .prepare('INSERT INTO config VALUES(1,?,?)')
              .run(FORMAT, JSON.stringify(expected));
            this.db.exec('COMMIT');
          }
          if (this.db.prepare('PRAGMA journal_mode').get()!.journal_mode !== 'delete') {
            throw new MessagingError('FORMAT', 'Messaging requires rollback journal mode');
          }
          this.db.exec('PRAGMA synchronous=FULL;');
        } catch (error) {
          try {
            if (this.db?.isTransaction) {
              this.db.exec('ROLLBACK');
            }
          } finally {
            this.db?.close();
          }
          throw error;
        }
      });
    } catch (error) {
      this.native.close();
      throw error;
    }
  }
  locked<T>(operation: () => T): T {
    return this.gate.withGate(operation);
  }
  notifyPath(recipient: string): string {
    return join(
      this.path,
      'inboxes',
      createHash('sha256').update(recipient).digest('hex'),
      'notify',
    );
  }
  ensureNotify(recipient: string): void {
    const path = this.notifyPath(recipient);
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    const fd = this.native.open(path, 'notification');
    fd.close();
  }
  mutate<T>(recipients: string[], operation: () => T, validate?: (result: T) => void): T {
    for (const recipient of new Set(recipients)) {
      this.ensureNotify(recipient);
      const fd = this.native.open(this.notifyPath(recipient), 'notification');
      try {
        fd.pulse();
      } finally {
        fd.close();
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      trimEvents(this);
      // Validate retention-sensitive results before commit, after the single trim.
      validate?.(result);
      if (contentBytes(this) > this.config.maxContentBytes) {
        throw new MessagingError('REFUSED', 'maxContentBytes reached');
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }
  close(): void {
    try {
      this.locked(() => this.db.close());
    } finally {
      this.native.close();
    }
  }
}

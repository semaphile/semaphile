/** Shared store policy. Existing stores retain their creation-time values. */
export interface StoreConfig {
  claimTtlMs: number;
  maxHandlingMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  retainHistoryMs: number;
  dedupeRetentionMs: number;
  maxBodyBytes: number;
  maxPendingPerRecipient: number;
  maxMessages: number;
  maxEvents: number;
  maxContentBytes: number;
}
export type AckMode = 'handler-success' | 'manual';
export interface Difference {
  field: string;
  expected: unknown;
  actual: unknown;
}
export interface OpenOptions {
  path: string;
  config?: Partial<StoreConfig>;
  configMismatch?: 'warn' | 'error';
  onWarning?: (differences: Difference[]) => void;
}
export interface SendOptions {
  to: string;
  body: string;
  sender?: string;
  dedupeKey?: string;
  correlationId?: string;
  replyTo?: string;
  topic?: string;
  kind?: string;
  expiresInMs?: number;
  ackMode?: AckMode;
}
export interface SendResult {
  id: string;
  seq: number;
  recipients: string[];
  deduplicated: boolean;
}
export interface Receipt {
  deliveryId: string;
  claimId: string;
}
export interface Delivery {
  id: string;
  messageId: string;
  seq: number;
  recipient: string;
  message: SendOptions;
  receipt: Receipt;
  attempt: number;
  ackMode: AckMode;
  claimedAt: number;
  claimExpiresAt: number;
  handlingExpiresAt: number;
}
export interface ReceiveOptions {
  max?: number;
  claimTtlMs?: number;
  maxHandlingMs?: number;
  ackMode?: AckMode;
  acceptedAckModes?: AckMode[];
}
export interface WaitOptions extends Omit<ReceiveOptions, 'max'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface Agent {
  id: string;
  name: string;
  pid: number;
  registeredAt: number;
  metadata: string;
  online: boolean;
}
export interface EventInput {
  kind: string;
  agent?: string;
  subject?: string;
  topic?: string;
  payload?: string;
}
export interface HistoryOptions {
  after?: number;
  limit?: number;
  recipient?: string;
  sender?: string;
  correlationId?: string;
  topic?: string;
  since?: number;
}
export interface MessageHistory extends SendResult {
  message: SendOptions | null;
  createdAt: number;
  terminalAt: number | null;
  deliveries: {
    id: string;
    recipient: string;
    state: string;
    attempts: number;
    error: string | null;
  }[];
}
export interface EventRecord extends EventInput {
  seq: number;
  at: number;
}
export interface ClaimResult {
  status: 'acked' | 'released' | 'renewed' | 'stale';
  expiresAt?: number;
}
export interface ListenerOptions extends Omit<ReceiveOptions, 'max'> {
  concurrency?: number;
  signal?: AbortSignal;
  onError?: (error: unknown, delivery?: Delivery) => void;
}
export interface HandlerContext {
  signal: AbortSignal;
  ack: () => Promise<ClaimResult>;
  release: () => Promise<ClaimResult>;
}
export type Handler = (delivery: Delivery, context: HandlerContext) => unknown;

export type EventHistoryOptions = Pick<HistoryOptions, 'after' | 'limit' | 'topic' | 'since'>;

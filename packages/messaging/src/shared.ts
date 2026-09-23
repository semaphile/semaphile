// Native-free API for optional messaging backends; no filesystem/store discovery.
export { MessagingClient } from './shared-client.js';
export type { MessagingTransport, MessagingCommand, MessagingReply } from './shared-client.js';
export { MessageListener } from './listener.js';
export { defaults, normalize, differences, MessagingError } from './config.js';
export type * from './types.js';
export { validateEnvelope } from './envelope.js';
export { validateTrace } from './trace.js';
export { integer, text, name, mode } from './config.js';
export { historyOptions } from './validation.js';

export { MessageSubscription } from './subscription.js';

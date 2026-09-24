import { MessagingError } from '@semaphile/messaging/client';
import type { MessagingConnection, MessagingWireReply } from './messaging-connection.js';

type Sweep = (deadline: number, pressure: boolean, signal?: AbortSignal) => Promise<boolean>;

export async function admit(
  connection: MessagingConnection,
  sweep: Sweep,
  action: string,
  input: object,
  deadline: number,
  signal: AbortSignal,
): Promise<MessagingWireReply> {
  try {
    await sweep(deadline, false, signal);
  } catch (error) {
    // Cleanup may have committed, but the requested mutation has not been sent.
    if (!(error instanceof MessagingError) || error.code !== 'UNCERTAIN') {
      throw error;
    }
  }
  for (;;) {
    try {
      return await connection.request(action, input, deadline, false, signal);
    } catch (error) {
      if (!(await reclaimed(sweep, error, deadline, signal))) {
        throw error;
      }
    }
  }
}

async function reclaimed(sweep: Sweep, error: unknown, deadline: number, signal: AbortSignal) {
  if (
    !(error instanceof MessagingError) ||
    error.code !== 'REFUSED' ||
    !['maxMessages reached', 'maxContentBytes reached', 'Recipient full'].includes(error.message)
  ) {
    return false;
  }
  try {
    return await sweep(deadline, error.message !== 'Recipient full', signal);
  } catch {
    // A failed cleanup does not make the definitively refused mutation uncertain.
    return false;
  }
}

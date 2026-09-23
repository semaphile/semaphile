// Optional payload contract. Transport envelopes still own correlation, reply routing and expiry.
import { MessagingError } from './config.js';
export interface QuestionOption {
  id: string;
  label: string;
  example?: string;
}
export interface AgentQuestion {
  version: 1;
  type: 'question';
  question: string;
  options: QuestionOption[];
}
export interface AgentAnswer {
  version: 1;
  type: 'answer';
  selectedOptionId: string;
  notes?: string;
}
export interface AgentTurnCompleted {
  version: 1;
  type: 'turn-completed';
  projectId: string;
  runId: string;
  turnId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  summary?: string;
}
export type AgentMessage = AgentQuestion | AgentAnswer | AgentTurnCompleted;
function invalid(field: string): never {
  throw new MessagingError('INPUT', `Invalid agent message field: ${field}`);
}
function object(input: unknown, fields: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('object');
  }
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) {
      invalid('unexpected field');
    }
  }
  return input as Record<string, unknown>;
}
function required(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    invalid(key);
  }
  return value;
}
function optional(input: Record<string, unknown>, key: string): string | undefined {
  if (input[key] !== undefined && typeof input[key] !== 'string') {
    invalid(key);
  }
  return input[key] as string | undefined;
}
/** Return a validated independent payload; diagnostics never contain the payload. */
export function validateAgentMessage(value: unknown): AgentMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('object');
  }
  const header = value as Record<string, unknown>;
  if (header.version !== 1) {
    invalid('version');
  }
  if (header.type === 'question') {
    const input = object(value, ['version', 'type', 'question', 'options']);
    if (!Array.isArray(input.options) || !input.options.length) {
      invalid('options');
    }
    const seen = new Set<string>();
    const options = input.options.map((entry) => {
      const option = object(entry, ['id', 'label', 'example']);
      const id = required(option, 'id');
      if (seen.has(id)) {
        invalid('options.id');
      }
      seen.add(id);
      const example = optional(option, 'example');
      return {
        id,
        label: required(option, 'label'),
        ...(example === undefined ? {} : { example }),
      };
    });
    return { version: 1, type: 'question', question: required(input, 'question'), options };
  }
  if (header.type === 'answer') {
    const input = object(value, ['version', 'type', 'selectedOptionId', 'notes']);
    const notes = optional(input, 'notes');
    return {
      version: 1,
      type: 'answer',
      selectedOptionId: required(input, 'selectedOptionId'),
      ...(notes === undefined ? {} : { notes }),
    };
  }
  if (header.type === 'turn-completed') {
    const input = object(value, [
      'version',
      'type',
      'projectId',
      'runId',
      'turnId',
      'outcome',
      'summary',
    ]);
    if (
      typeof input.outcome !== 'string' ||
      !['completed', 'failed', 'cancelled'].includes(input.outcome)
    ) {
      invalid('outcome');
    }
    const summary = optional(input, 'summary');
    return {
      version: 1,
      type: 'turn-completed',
      projectId: required(input, 'projectId'),
      runId: required(input, 'runId'),
      turnId: required(input, 'turnId'),
      outcome: input.outcome as AgentTurnCompleted['outcome'],
      ...(summary === undefined ? {} : { summary }),
    };
  }
  return invalid('type');
}
/** Validate selection using the original question, not a label supplied by a respondent. */
export function validateAnswer(question: unknown, answer: unknown): AgentAnswer {
  const q = validateAgentMessage(question),
    a = validateAgentMessage(answer);
  if (q.type !== 'question' || a.type !== 'answer') {
    invalid('question/answer');
  }
  if (!q.options.some((option) => option.id === a.selectedOptionId)) {
    invalid('selectedOptionId');
  }
  return a;
}
export function encodeAgentMessage(value: AgentMessage): string {
  return JSON.stringify(validateAgentMessage(value));
}
export function decodeAgentMessage(body: string): AgentMessage {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return invalid('JSON');
  }
  return validateAgentMessage(value);
}

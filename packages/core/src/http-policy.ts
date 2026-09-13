// HTTP classification is limited to upstream responses and known transport
// failures. Application handler exceptions never enter this classifier.
import type { Outcome } from './recovery-state.js';
export const httpClassifierId = 'semaphile.http/1';
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function httpDate(text: string, now: number): number | undefined {
  let weekday: string,
    day: number,
    month: number,
    year: number,
    hour: number,
    minute: number,
    second: number;
  const standard =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
      text,
    );
  const obsolete =
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
      text,
    );
  const asctime =
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
      text,
    );
  if (standard || obsolete) {
    const match = (standard ?? obsolete)!;
    weekday = match[1].slice(0, 3);
    day = Number(match[2]);
    month = months.indexOf(match[3]);
    year = Number(match[4]);
    hour = Number(match[5]);
    minute = Number(match[6]);
    second = Number(match[7]);
    if (obsolete) {
      const currentYear = new Date(now).getUTCFullYear();
      year += Math.floor(currentYear / 100) * 100;
      if (year > currentYear + 50) {
        year -= 100;
      }
    }
  } else if (asctime) {
    weekday = asctime[1];
    month = months.indexOf(asctime[2]);
    day = Number(asctime[3]);
    hour = Number(asctime[4]);
    minute = Number(asctime[5]);
    second = Number(asctime[6]);
    year = Number(asctime[7]);
  } else {
    return undefined;
  }
  if (month < 0 || day < 1 || hour > 23 || minute > 59 || second > 60) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    weekdays[date.getUTCDay()] !== weekday
  ) {
    return undefined;
  }
  return date.getTime() + (second === 60 ? 1000 : 0);
}
/** RFC 9110 Retry-After: decimal delay-seconds or a validated HTTP-date. */
export function retryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) {
    return undefined;
  }
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const milliseconds = Number(text) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  const parsed = httpDate(text, now);
  if (parsed === undefined) {
    return undefined;
  }
  const delay = Math.max(0, parsed - now);
  return Number.isSafeInteger(delay) ? delay : undefined;
}
export function responseOutcome(response: Response): Outcome {
  const kind =
    response.status === 429
      ? 'throttle'
      : [500, 502, 503, 504].includes(response.status)
        ? 'service-failure'
        : response.ok
          ? 'success'
          : 'neutral';
  const delay = retryAfter(response.headers.get('retry-after'));
  return {
    kind,
    ...((kind === 'throttle' || kind === 'service-failure') && delay !== undefined
      ? { retryAfterMs: delay }
      : {}),
  };
}
const transportCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);
export function transportOutcome(error: unknown, signal: AbortSignal): Outcome {
  if (signal.aborted) {
    return { kind: 'neutral' };
  }
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && transportCodes.has(String(current.code))) {
      return { kind: 'service-failure' };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return { kind: 'neutral' };
}

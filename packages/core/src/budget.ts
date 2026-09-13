// Gate-owned budget calculations. Callers serialize reads and wrap writes in
// their admission/mutation transaction; these helpers never acquire locks.
import type { DatabaseSync } from 'node:sqlite';
import type { normalize } from './config.js';

type Budget = { remaining: number | null; nextRefreshAt: number | null; refreshed: boolean };

export function budgetAt(
  db: DatabaseSync,
  config: ReturnType<typeof normalize>,
  now: number,
): Budget {
  const row = db
    .prepare('SELECT remaining,nextRefreshAt FROM budget WHERE singleton=1')
    .get() as unknown as Omit<Budget, 'refreshed'>;
  if (!row) {
    throw new Error('Missing pool budget state');
  }
  const interval = config.reservoirRefreshInterval;
  if (interval === null || row.nextRefreshAt === null || now < row.nextRefreshAt) {
    return { ...row, refreshed: false };
  }
  const periods = Math.floor((now - row.nextRefreshAt) / interval) + 1;
  // A full balance needs no write or notification just to advance its
  // checkpoint. Recompute the next boundary from the same phase on access.
  // Otherwise slow checks can endlessly wake on their own useless refill.
  return {
    remaining: config.reservoirRefreshAmount,
    nextRefreshAt: row.nextRefreshAt + periods * interval,
    refreshed: row.remaining !== config.reservoirRefreshAmount,
  };
}

export function writeBudget(db: DatabaseSync, budget: Budget) {
  db.prepare('UPDATE budget SET remaining=?,nextRefreshAt=? WHERE singleton=1').run(
    budget.remaining,
    budget.nextRefreshAt,
  );
}

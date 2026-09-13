// Run the public HTTP contract through the real SQLite coordinator worker.
process.env.SEMAPHILE_HTTP_BACKEND = 'sqlite';
await import('./http.mjs');

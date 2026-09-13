// Run the shared public execution contract against an actual Redis backend.
process.env.SEMAPHILE_EXECUTION_BACKEND = 'redis';
await import('../typescript/execution.mjs');

// Run the shared HTTP lifetime contract against an actual Redis backend.
process.env.SEMAPHILE_HTTP_BACKEND = 'redis';
await import('../typescript/http.mjs');

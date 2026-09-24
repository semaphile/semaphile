process.argv.push('--redis');
await import('../messaging/topics.mjs');

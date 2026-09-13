// Test barrier: observe when the CLI installs graceful signal handling after open.
// This does not change dispatch, storage or cancellation behavior.
const once = process.once;
process.once = function (event, listener) {
  const result = once.call(this, event, listener);
  if (event === 'SIGTERM') {
    process.stdout.write('signal-ready\n');
  }
  return result;
};

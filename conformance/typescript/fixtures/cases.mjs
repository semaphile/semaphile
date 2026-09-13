// Run the same scenarios as ordinary programs under Node and Bun. No runtime-
// specific test-runner invocation is required by conformance/run.mjs.
export function suite() {
  const cases = [];
  return {
    test(name, body) {
      cases.push({ name, body });
    },
    async run() {
      let passed = 0;
      for (const { name, body } of cases) {
        try {
          await body();
          passed++;
          console.log(`PASS ${name}`);
        } catch (error) {
          console.error(`FAIL ${name}`);
          throw error;
        }
      }
      console.log(`RESULT ${passed}/${cases.length} passed`);
    },
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

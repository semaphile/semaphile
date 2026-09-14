import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('.tmp/proxy', { recursive: true });
const root = await mkdtemp(resolve('.tmp/proxy/package-'));
function command(bin, args, cwd = root) {
  const output = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      npm_config_offline: 'true',
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  assert.equal(output.status, 0, output.stdout + output.stderr);
  return output.stdout;
}
const dependencies = {};
for (const name of ['core', 'proxy']) {
  const [pack] = JSON.parse(
    command(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      resolve('packages', name),
    ),
  );
  dependencies['@semaphile/' + name] = 'file:' + resolve(root, pack.filename);
  if (name === 'proxy') {
    assert.ok(pack.files.some((file) => file.path === 'dist/index.d.ts'));
    assert.ok(pack.files.some((file) => file.path === 'dist/cli.js'));
    assert.ok(
      pack.files.every(
        (file) =>
          file.path.startsWith('dist/') ||
          ['package.json', 'README.md', 'MCP.md', 'LICENSE'].includes(file.path),
      ),
    );
  }
}
await writeFile(
  resolve(root, 'package.json'),
  JSON.stringify({ private: true, type: 'module', dependencies }),
);
command('npm', ['install', '--offline', '--ignore-scripts']);
console.log(
  'PASS offline installed archive contains declarations and standalone CLI without install hooks',
);
await writeFile(
  resolve(root, 'consumer.mjs'),
  `
import assert from 'node:assert/strict';
import { startHttpProxy } from '@semaphile/proxy';
import { openLimiter } from '@semaphile/core/memory';
import { createServer } from 'node:http';
const upstream = createServer((req, res) => res.end('installed'));
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const limiter = await openLimiter({ key: 'installed', config: { maxConcurrent: 1 } });
const proxy = await startHttpProxy({ port: 0, routes: [{ name: 'api', upstream: 'http://127.0.0.1:' + upstream.address().port, limiter }] });
try { assert.equal(await (await fetch(proxy.url + '/api')).text(), 'installed'); }
finally { await proxy.close(); await limiter.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
`,
);
command(process.execPath, ['consumer.mjs']);
assert.match(
  command(process.execPath, ['node_modules/@semaphile/proxy/dist/cli.js', '--help']),
  /--config FILE/,
);
console.log('PASS installed consumer forwards a request and closes borrowed clients explicitly');
await writeFile(
  resolve(root, 'consumer.ts'),
  `
import { startHttpProxy, type HttpProxyOptions } from '@semaphile/proxy';
import { startMcpProxy, type McpProxyOptions } from '@semaphile/proxy/mcp';
import { openLimiter } from '@semaphile/core/memory';
const limiter = await openLimiter({ key: 'types', config: { maxConcurrent: 1 } });
const options: HttpProxyOptions = { routes: [{ name: 'api', upstream: 'https://example.com', limiter }] };
const proxy = await startHttpProxy(options); await proxy.close({ drain: true });
const mcpOptions: McpProxyOptions = { limiter, command: 'bun', args: ['server.ts'] };
const mcp = await startMcpProxy(mcpOptions); await mcp.close({ drain: true });
// @ts-expect-error executable must be a string
await startMcpProxy({ limiter, command: 7 });
// @ts-expect-error route cannot supply a string instead of a limiter
await startHttpProxy({ routes: [{ name: 'bad', upstream: 'https://example.com', limiter: 'bad' }] });
`,
);
command(process.execPath, [
  resolve('packages/core/node_modules/typescript/bin/tsc'),
  '--noEmit',
  '--strict',
  '--skipLibCheck',
  '--module',
  'NodeNext',
  '--target',
  'ES2022',
  'consumer.ts',
]);
console.log('PASS strict independent consumer accepts public types and rejects invalid routes');

await writeFile(
  resolve(root, 'mcp-consumer.mjs'),
  `
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { startMcpProxy } from '@semaphile/proxy/mcp';
import { openLimiter } from '@semaphile/core/memory';
const limiter = await openLimiter({ key: 'mcp-installed', config: { maxConcurrent: 1 } });
const input = new PassThrough(), output = new PassThrough();
const response = new Promise(resolve => {
  let text = ''; output.on('data', chunk => {
    text += chunk;
    for (const line of text.split('\\n').slice(0, -1)) { const frame = JSON.parse(line); if (frame.id === 1 && frame.result) resolve(frame); }
  });
});
const proxy = await startMcpProxy({ limiter, input, output, command: process.execPath, args: [${JSON.stringify(resolve('conformance/proxy/fixtures/mcp-raw-server.mjs'))}], shutdownGraceMs: 100 });
try {
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { installed: true } } }) + '\\n');
  assert.equal((await response).result.content[0].text, '{"installed":true}');
} finally { await proxy.close(); input.destroy(); output.destroy(); await limiter.close(); }
`,
);
command(process.execPath, ['mcp-consumer.mjs']);
assert.match(
  command(process.execPath, ['node_modules/@semaphile/proxy/dist/mcp-cli.js', '--help']),
  /--config FILE/,
);
console.log('PASS installed MCP consumer loads public entry and standalone CLI');
console.log('RESULT 4/4 passed');

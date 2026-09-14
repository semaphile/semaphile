import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../packages/proxy/package.json', import.meta.url));
const { McpServer, fromJsonSchema } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
serveStdio(() => {
  const server = new McpServer(
    { name: 'semaphile-sdk-fixture', version: '1.0.0' },
    { instructions: 'Fixture instructions survive proxying.' },
  );
  server.registerTool(
    'echo',
    {
      inputSchema: fromJsonSchema({
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      }),
    },
    async ({ text }) => ({ content: [{ type: 'text', text }], _meta: { fixture: true } }),
  );
  return server;
});

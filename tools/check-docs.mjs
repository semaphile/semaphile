// Validate links and reject machine-specific details in the public doc surface.
import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
const files = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SPEC.md',
  'packages/core/README.md',
  'packages/redis/README.md',
  'packages/proxy/README.md',
  'packages/proxy/MCP.md',
  'packages/messaging/README.md',
];
for (const name of await readdir('docs', { recursive: true })) {
  if (name.endsWith('.md')) {
    files.push('docs/' + name);
  }
}
const errors = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (/\/(?:Users|home)\/[^/\s]+\/|\/root\//.test(text)) {
    errors.push(`${file}: private home path`);
  }
  if (/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)) {
    errors.push(`${file}: non-loopback IPv4 address`);
  }
  for (const match of text.matchAll(/\]\(([^()\r\n]*)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:\/\//.test(target)) {
      continue;
    }
    const path = resolve(dirname(file), target);
    const localPath = relative(process.cwd(), path);
    if (
      localPath.startsWith('..') ||
      localPath.split('/').some((part) => part === '.scratch' || part === '.tmp')
    ) {
      errors.push(`${file}: private link ${target}`);
    }
    try {
      await access(path);
    } catch {
      errors.push(`${file}: missing link ${target}`);
    }
  }
}
if (errors.length) {
  throw new Error(errors.join('\n'));
}
console.log(
  `PASS ${files.length} public Markdown documents: local links resolve; no private links or machine details`,
);

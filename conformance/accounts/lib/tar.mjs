// Reads regular files from an npm package tarball (ustar, gzip) so installed
// files can be compared byte-for-byte with the candidate archive.
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const text = (block, start, length) =>
  block.toString('utf8', start, start + length).replace(/\0.*$/s, '');

export function tarEntries(gzipped) {
  const data = gunzipSync(gzipped);
  const entries = new Map();
  let offset = 0,
    longName;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const size = parseInt(text(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(header, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    longName = undefined;
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
    } else if (type === '0' || type === '\0') {
      name = name.replace(/^package\//, '');
      entries.set(name, createHash('sha256').update(body).digest('hex'));
    } else if (type !== '5' && type !== 'x' && type !== 'g') {
      throw new Error(`Unexpected tar entry type ${type} for ${name}`);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

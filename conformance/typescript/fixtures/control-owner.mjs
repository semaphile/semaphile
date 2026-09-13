// Isolated owner whose accepted work can outlive its expiring capacity lease.
import { Pool } from '../../../packages/core/dist/src/backend.js';
import { nativePath } from '../../../packages/core/dist/src/native-path.js';
const pool = new Pool(process.argv[2], { maxConcurrent: 1 }, nativePath());
let token;
if (process.argv[3] === 'implicit') {
  await pool.acquireDetailed(undefined, 1, 15);
  const [id, operation] = Object.entries(pool.control().operations)[0];
  token = { id, generation: operation.generation };
} else {
  token = pool.acceptOperation('child-operation');
  if (process.argv[3] === 'active') {
    await pool.acquireDetailed(undefined, 1, 15, { operation: token });
  }
}
console.log(JSON.stringify({ token }));
process.stdin.resume();

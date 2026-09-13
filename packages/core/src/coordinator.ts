// Own SQLite and blocking gate operations on this worker, keeping application
// callbacks responsive while another process holds the coordination lock.
import { parentPort, workerData } from 'node:worker_threads';
import { Pool } from './backend.ts';
import type { Command } from './protocol.js';
import { InputError } from './config.js';
import { CircuitOpenError } from './control-state.js';
import { PoolDrainingError } from './maintenance-state.js';
const controllers = new Map<number, AbortController>();
let pool: Pool;
let admissionFailure: Error | undefined;
try {
  pool = new Pool(workerData.path, workerData.config, workerData.addon);
  parentPort!.on('message', (command: Command) => {
    // Admissions may wait; later release/abort messages must still be handled.
    void dispatch(command);
  });
  async function dispatch(command: Command): Promise<void> {
    if (command.action === 'abort') {
      controllers.get(command.target)?.abort();
      return;
    }
    const { id, action } = command;
    try {
      let value: unknown = null;
      switch (action) {
        case 'acquire': {
          if (admissionFailure) {
            throw admissionFailure;
          }
          const controller = new AbortController();
          controllers.set(id, controller);
          try {
            value = await pool.acquireDetailed(
              controller.signal,
              command.weight,
              command.expirationMs,
              { operation: command.operation, circuit: command.circuit },
            );
          } finally {
            controllers.delete(id);
          }
          break;
        }
        case 'release':
          pool.release(command.lease, command.outcome);
          break;
        case 'accept':
          value = pool.acceptOperation(command.operationId);
          break;
        case 'finish':
          value = pool.finishOperation(command.operation);
          break;
        case 'control':
          value = pool.control(command.command);
          break;
        case 'waitDrain': {
          const controller = new AbortController();
          controllers.set(id, controller);
          try {
            value = await pool.waitForDrain(command.generation, controller.signal);
          } finally {
            controllers.delete(id);
          }
          break;
        }
        case 'inspect':
          value = pool.inspect();
          break;
        case 'reservoir':
          value = pool.currentReservoir();
          break;
        case 'increment':
          value = pool.incrementReservoir(command.amount);
          break;
        case 'close':
          await pool.close();
          parentPort!.postMessage({ id, value });
          parentPort!.close();
          return;
        default:
          throw new Error('Unknown coordinator operation');
      }
      parentPort!.postMessage({ id, value });
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.message === 'acquire aborted' || error.name === 'AbortError');
      const recoverable =
        error instanceof InputError ||
        error instanceof CircuitOpenError ||
        error instanceof PoolDrainingError;
      if (!aborted && !recoverable && !admissionFailure) {
        admissionFailure = error instanceof Error ? error : new Error(String(error));
        parentPort!.postMessage({ event: 'admission-failure', error: String(error) });
        pool.stopAdmissions(admissionFailure);
      }
      parentPort!.postMessage({
        id,
        error: String(error),
        aborted,
        recoverable,
        errorName: error instanceof Error ? error.name : undefined,
        generation: error instanceof PoolDrainingError ? error.generation : undefined,
        notBefore: error instanceof CircuitOpenError ? error.notBefore : undefined,
      });
      if (action === 'close') {
        process.exitCode = 1;
        parentPort!.close();
      }
    }
  }
  parentPort!.postMessage({ event: 'ready' });
} catch (error) {
  parentPort!.postMessage({ event: 'startup-error', error: String(error) });
  parentPort!.close();
}

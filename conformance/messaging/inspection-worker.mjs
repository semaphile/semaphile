// A single-response worker fixture; no store is opened by this test actor.
import { parentPort, workerData } from 'node:worker_threads';
if (workerData.value) {
  parentPort.postMessage({ value: workerData.value });
  parentPort.close();
} else {
  process.exit(workerData.code);
}

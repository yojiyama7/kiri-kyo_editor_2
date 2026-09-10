import { createPersistenceStore } from './persistenceStore.ts';
import type { PersistenceRequest, PersistenceResponse } from './entryPersistence.ts';

const worker = globalThis as unknown as {
  indexedDB: IDBFactory;
  onmessage: (event: MessageEvent<{ id: number; request: PersistenceRequest }>) => void;
  postMessage(value: PersistenceResponse): void;
};
const store = createPersistenceStore(worker.indexedDB);
let queue = Promise.resolve();
worker.onmessage = ({ data: { id, request } }) => {
  // Initialization, recovery, writes and diagnostic reads share one order.
  queue = queue.then(async () => {
    try {
      if (request.kind === 'write') {
        await store.write(request.batch);
        worker.postMessage({ id });
      } else if (request.kind === 'replace') {
        worker.postMessage({ id, document: await store.replace(request.document) });
      } else if (request.kind === 'discard') {
        await store.discard();
        worker.postMessage({ id });
      } else if (request.kind === 'load') {
        const result = await store.load(request);
        worker.postMessage({ id, ...result });
      } else {
        worker.postMessage({ id, document: await store.read() });
      }
    } catch (error) { worker.postMessage({ id, error: String(error) }); }
  });
};

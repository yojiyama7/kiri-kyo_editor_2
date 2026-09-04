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
      } else {
        const document = request.kind === 'load' ? await store.load(request) : await store.read();
        worker.postMessage({ id, document });
      }
    } catch (error) { worker.postMessage({ id, error: String(error) }); }
  });
};

import type { EntryDocument } from './entryDocument.ts';
import type { PersistenceRequest, PersistenceResponse } from './entryPersistence.ts';

export function createPersistenceClient(factory: () => Worker) {
  let worker: Worker | undefined;
  let sequence = 0;
  let disposed = false;
  const requests = new Map<number, { resolve: (response: PersistenceResponse) => void; reject: (error: Error) => void }>();
  function fail(message: string) {
    worker?.terminate();
    worker = undefined;
    for (const pending of requests.values()) pending.reject(new Error(message));
    requests.clear();
  }
  function request(request: PersistenceRequest): Promise<PersistenceResponse> {
    return new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('保存処理は終了しています')); return; }
      if (!worker) {
        worker = factory();
        worker.onmessage = ({ data }: MessageEvent<PersistenceResponse>) => {
          const pending = requests.get(data.id);
          if (!pending) return;
          requests.delete(data.id);
          if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
        };
        worker.onerror = event => { event.preventDefault(); fail(event.message || '保存Workerを起動できません'); };
        worker.onmessageerror = () => fail('保存Workerとの通信に失敗しました');
      }
      const id = ++sequence;
      requests.set(id, { resolve, reject });
      try { worker.postMessage({ id, request }); }
      catch (error) { requests.delete(id); reject(error); }
    });
  }
  function send(value: PersistenceRequest): Promise<EntryDocument | undefined> {
    return request(value).then(response => response.document);
  }
  function load(value: Extract<PersistenceRequest, { kind: 'load' }>): Promise<{ document: EntryDocument; discardedLegacy: boolean }> {
    return request(value).then(response => {
      if (!response.document) throw new Error('保存データが読み込めません');
      return { document: response.document, discardedLegacy: !!response.discardedLegacy };
    });
  }
  return { send, load, dispose() { disposed = true; fail('保存処理は終了しています'); } };
}

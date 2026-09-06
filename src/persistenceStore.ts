import { readEntryDocument, type Entry, type EntryDocument } from './entryDocument.ts';
import { parseRecovery, type PersistenceRequest, type SaveBatch } from './entryPersistence.ts';

export const DATABASE_NAME = 'kiri-kyo-editor';
type DocumentMetadata = { version: 8; ids: string[] };

export class LegacyDocumentError extends Error {}

function isLegacyRecovery(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as { version?: unknown; documentVersion?: unknown };
    return value?.version === 2 && value.documentVersion !== 8;
  } catch { return false; }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('保存データの読み取りに失敗しました'));
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('保存が中断されました'));
    transaction.onerror = () => { /* onabort reports the final transaction outcome. */ };
  });
}

/** This adapter is used exclusively inside the Worker in production. */
export function createPersistenceStore(factory: IDBFactory, name = DATABASE_NAME) {
  let database: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
    if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
      const opening = factory.open(name, 1);
      let blocked = false;
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('entries', { keyPath: 'id' });
        opening.result.createObjectStore('metadata');
      };
      opening.onerror = () => { database = undefined; reject(opening.error); };
      opening.onblocked = () => { blocked = true; database = undefined; reject(new Error('別のタブが保存データを使用中です。タブを閉じて再試行してください')); };
      opening.onsuccess = () => {
        const db = opening.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); database = undefined; };
        db.onclose = () => { database = undefined; };
        resolve(db);
      };
    });
    return database;
  }
  async function read(): Promise<EntryDocument | undefined> {
    const db = await open();
    const tx = db.transaction(['entries', 'metadata'], 'readonly');
    const done = completed(tx);
    const [metadata, rows] = await Promise.all([
      request(tx.objectStore('metadata').get('document')) as Promise<DocumentMetadata | undefined>,
      request(tx.objectStore('entries').getAll()) as Promise<Entry[]>,
      done,
    ]);
    if (!metadata && !rows.length) return undefined;
    if ((metadata && metadata.version !== 8)
      || rows.some(row => !!row?.document && Object.hasOwn(row.document, 'version'))) {
      throw new LegacyDocumentError('旧形式の保存文書です');
    }
    if (!metadata || !Array.isArray(metadata.ids) || metadata.ids.length !== rows.length) {
      throw new Error('保存データの構成が不正です');
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    const document = readEntryDocument({ version: 8, entries: metadata.ids.map(id => byId.get(id)) });
    if (!document) throw new Error('保存された文を読み込めません');
    return document;
  }
  async function write(batch: SaveBatch): Promise<void> {
    const db = await open();
    const tx = db.transaction(['entries', 'metadata'], 'readwrite');
    const done = completed(tx);
    const metadata = tx.objectStore('metadata');
    const entries = tx.objectStore('entries');
    try {
      const [receipt, current] = await Promise.all([
        request(metadata.get(`receipt:${batch.session}`)) as Promise<number | undefined>,
        request(metadata.get('document')) as Promise<DocumentMetadata | undefined>,
      ]);
      if ((receipt ?? 0) < batch.sequence) {
        // A structural batch must publish exactly the set of surviving IDs.
        const ids = new Set(current?.ids ?? []);
        for (const change of batch.changes) {
          if (change.entry) ids.add(change.id); else ids.delete(change.id);
        }
        const order = batch.order?.ids ?? current?.ids;
        if (!order?.length || ids.size !== order.length || new Set(order).size !== order.length
          || order.some(id => !ids.has(id))) throw new Error('保存する文と並び順が一致しません');
        const previous = await Promise.all(batch.changes.map(change => request(entries.get(change.id))));
        for (const [index, change] of batch.changes.entries()) {
          if (change.entry) {
            // Equality work stays on the Worker and touches only affected rows.
            if (JSON.stringify(previous[index]) !== JSON.stringify(change.entry)) entries.put(change.entry);
          } else if (previous[index] !== undefined) entries.delete(change.id);
        }
        if (batch.order) metadata.put({ version: 8, ids: order } satisfies DocumentMetadata, 'document');
        metadata.put(batch.sequence, `receipt:${batch.session}`);
      }
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* A failed transaction may already have aborted. */ }
      await done.catch(() => {});
      throw error;
    }
  }
  async function discard(): Promise<void> {
    const db = await open();
    const tx = db.transaction(['entries', 'metadata'], 'readwrite');
    const done = completed(tx);
    await Promise.all([
      request(tx.objectStore('entries').clear()),
      request(tx.objectStore('metadata').clear()),
      done,
    ]);
  }
  async function load(input: Extract<PersistenceRequest, { kind: 'load' }>): Promise<{ document: EntryDocument; discardedLegacy: boolean }> {
    let discardedLegacy = input.legacyRaw !== null;
    const currentRecovery = input.recovery.filter(raw => {
      const legacy = isLegacyRecovery(raw);
      discardedLegacy ||= legacy;
      return !legacy;
    });
    const journals = currentRecovery.map(parseRecovery);
    let document: EntryDocument | undefined;
    try { document = await read(); }
    catch (error) {
      if (!(error instanceof LegacyDocumentError)) throw error;
      await discard();
      discardedLegacy = true;
    }
    if (!document) {
      if (input.legacyError) throw new Error(input.legacyError);
      document = input.initial;
      await write({
        session: 'initial-migration', sequence: 1,
        changes: document.entries.map(entry => ({ id: entry.id, entry, generation: 1 })),
        order: { generation: 1, ids: document.entries.map(entry => entry.id) },
      });
    }
    // The receipt and document change are atomic, so replay is safe even if an
    // acknowledgement or removal of the journal was interrupted by shutdown.
    for (const journal of journals) {
      const batches = [...journal.batches].sort((a, b) => a.session.localeCompare(b.session) || a.sequence - b.sequence);
      for (const batch of batches) await write(batch);
    }
    return { document: (await read())!, discardedLegacy };
  }
  return { read, write, load, discard };
}

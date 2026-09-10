import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createPersistenceStore } from '../src/persistenceStore.ts';
import { createEntryPersistence } from '../src/entryPersistence.ts';

const entry = (id, text = '') => ({ id, document: {
  tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });
const document = (...entries) => ({ version: 8, entries });
const change = value => ({ id: value.id, generation: 1, entry: value });
const loadResult = (store, initial, extras = {}) => store.load({ kind: 'load', initial, legacyRaw: null, recovery: [], ...extras });
const load = async (store, initial, extras = {}) => (await loadResult(store, initial, extras)).document;

test('legacy localStorage and IndexedDB are discarded and replaced with the sample', async () => {
  for (const legacyRaw of [JSON.stringify({ ...entry('a', 'legacy').document, version: 5 }),
    JSON.stringify({ version: 7, entries: [{ ...entry('a', 'legacy'), document: { ...entry('a', 'legacy').document, version: 6 } }] })]) {
    const store = createPersistenceStore(new IDBFactory());
    const initial = document(entry('example'));
    const first = await loadResult(store, initial, { legacyRaw });
    assert.deepEqual(first, { document: initial, discardedLegacy: true });
  }
  const store = createPersistenceStore(new IDBFactory());
  const old = entry('seed', 'legacy');
  old.document.version = 6;
  await load(store, document(entry('seed')));
  await store.write({ session: 'legacy', sequence: 1, changes: [change(old)] });
  const initial = document(entry('replacement'));
  assert.deepEqual(await loadResult(store, initial), { document: initial, discardedLegacy: true });
});

test('malformed current recovery and storage errors preserve data instead of initializing the sample', async () => {
  for (const extras of [
    { legacyError: 'storage disabled' }, { recovery: ['{'] },
    { recovery: [JSON.stringify({ version: 2, documentVersion: 8, batches: [{}] })] },
  ]) {
    const store = createPersistenceStore(new IDBFactory());
    await assert.rejects(load(store, document(entry('example')), extras));
    assert.equal(await store.read(), undefined);
  }
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('kept'));
  await load(store, initial);
  const malformed = entry('kept');
  malformed.document.translation = 42;
  await store.write({ session: 'bad', sequence: 1, changes: [change(malformed)] });
  await assert.rejects(load(store, document(entry('replacement'))), /読み込めません/);
  await assert.rejects(store.read(), /読み込めません/);
});

test('discard clears entries, metadata and receipts so the store can be initialized again', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const first = document(entry('a', 'saved'));
  await load(store, first);
  await store.write({ session: 'test', sequence: 1, changes: [change(entry('a', 'edited'))] });
  await store.discard();
  assert.equal(await store.read(), undefined);
  const replacement = document(entry('sample'));
  assert.deepEqual(await load(store, replacement), replacement);
});

test('writes alter only the targeted entry and leave all other records and order intact', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(...Array.from({ length: 50 }, (_, i) => entry(String(i))));
  await load(store, initial);
  const touched = [];
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (this.name === 'entries') touched.push(value.id);
    return original.call(this, value, ...args);
  };
  try {
    await store.write({ session: 'test', sequence: 1, changes: [change(entry('3', 'edited'))] });
    assert.deepEqual(touched, ['3']);
    const expected = structuredClone(initial);
    expected.entries[3].document.translation = 'edited';
    assert.deepEqual(await store.read(), expected);
    // A new request with an equal snapshot acknowledges without rewriting the row.
    await store.write({ session: 'test', sequence: 2, changes: [change(entry('3', 'edited'))] });
    assert.deepEqual(touched, ['3']);
  } finally { IDBObjectStore.prototype.put = original; }
});

test('structure transactions support bulk insertion, reorder, deletion and undo/redo', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const a = entry('a'), b = entry('b'), c = entry('c');
  await load(store, document(a));
  await store.write({ session: 'test', sequence: 1, changes: [change(b), change(c)], order: { generation: 1, ids: ['a', 'b', 'c'] } });
  assert.deepEqual(await store.read(), document(a, b, c));
  await store.write({ session: 'test', sequence: 2, changes: [], order: { generation: 2, ids: ['c', 'a', 'b'] } });
  assert.deepEqual(await store.read(), document(c, a, b));
  await store.write({ session: 'test', sequence: 3, changes: [{ id: 'b', entry: null, generation: 3 }], order: { generation: 3, ids: ['c', 'a'] } });
  assert.deepEqual(await store.read(), document(c, a));
  await store.write({ session: 'test', sequence: 4, changes: [change(b)], order: { generation: 4, ids: ['c', 'a', 'b'] } });
  assert.deepEqual(await store.read(), document(c, a, b));
  await store.write({ session: 'test', sequence: 5, changes: [{ id: 'b', entry: null, generation: 5 }], order: { generation: 5, ids: ['c', 'a'] } });
  assert.deepEqual(await store.read(), document(c, a));
});

test('failed transaction rolls back every entry, order and receipt, permitting the same retry', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'));
  await load(store, initial);
  const batch = { session: 'test', sequence: 1, changes: [change(entry('a', 'edited')), change(entry('b'))], order: { generation: 1, ids: ['b', 'a'] } };
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (this.name === 'entries' && value.id === 'b') {
      this.transaction.abort();
      throw new Error('quota exceeded');
    }
    return original.call(this, value, ...args);
  };
  try { await assert.rejects(store.write(batch), /quota/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await store.read(), initial);
  await store.write(batch);
  assert.deepEqual(await store.read(), document(entry('b'), entry('a', 'edited')));
});

test('replace atomically validates and replaces every entry and its order', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'), entry('b'));
  await load(store, initial);
  const replacement = document(entry('c', '日本語'), entry('a', 'new'));
  assert.deepEqual(await store.replace(replacement), replacement);
  assert.deepEqual(await store.read(), replacement);
  await assert.rejects(store.replace({ version: 8, entries: [] }), /不正/);
  assert.deepEqual(await store.read(), replacement);
});

test('failed replacement transaction preserves the complete previous document', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'), entry('b'));
  await load(store, initial);
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (this.name === 'entries' && value.id === 'c') {
      this.transaction.abort();
      throw new Error('quota exceeded');
    }
    return original.call(this, value, ...args);
  };
  try { await assert.rejects(store.replace(document(entry('c'), entry('d'))), /quota/); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.deepEqual(await store.read(), initial);
});

test('recovery skips committed requests, restores outstanding changes and is repeatable', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'), entry('b'));
  await load(store, initial);
  const queue = createEntryPersistence(() => new Promise(() => {}), () => {}, 'test');
  queue.mark(entry('a', 'already committed'));
  queue.saveEntry('a');
  const first = queue.journal().batches[0];
  await store.write(first);
  queue.mark(entry('a', 'newer, not yet sent'));
  queue.saveStructure(initial.entries, [entry('a')]);
  const raw = JSON.stringify(queue.journal());
  assert.deepEqual(await load(store, initial, { recovery: [raw] }), document(entry('a', 'newer, not yet sent')));
  // Simulate a crash after recovery committed but before removing localStorage.
  assert.deepEqual(await load(store, initial, { recovery: [raw] }), document(entry('a', 'newer, not yet sent')));
  queue.dispose();
});

test('an old uncertain request cannot resurrect a deleted entry', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'), entry('b'));
  await load(store, initial);
  const old = { session: 'test', sequence: 1, changes: [change(entry('b', 'old'))] };
  await store.write(old);
  await store.write({ session: 'test', sequence: 2, changes: [{ id: 'b', entry: null, generation: 2 }], order: { generation: 2, ids: ['a'] } });
  await load(store, initial, { recovery: [JSON.stringify({ version: 2, documentVersion: 8, batches: [old] })] });
  assert.deepEqual(await store.read(), document(entry('a')));
});

test('a mismatched structural transaction is rejected without corrupting existing data', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'));
  await load(store, initial);
  await assert.rejects(store.write({ session: 'test', sequence: 1, changes: [change(entry('b'))] }), /一致/);
  assert.deepEqual(await store.read(), initial);
});

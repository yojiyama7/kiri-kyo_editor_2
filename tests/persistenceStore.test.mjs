import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createPersistenceStore } from '../src/persistenceStore.ts';
import { createEntryPersistence } from '../src/entryPersistence.ts';

const entry = (id, text = '') => ({ id, document: {
  version: 6, tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });
const document = (...entries) => ({ version: 7, entries });
const change = value => ({ id: value.id, generation: 1, entry: value });
const load = (store, initial, extras = {}) => store.load({ kind: 'load', initial, legacyRaw: null, recovery: [], ...extras });

test('initialization migrates legacy v5/v6 and prefers IndexedDB after successful migration', async () => {
  for (const legacy of [entry('a', 'legacy').document, document(entry('a', 'legacy'), entry('b'))]) {
    const store = createPersistenceStore(new IDBFactory());
    const first = await load(store, document(entry('example')), { legacyRaw: JSON.stringify(legacy) });
    assert.equal(first.entries[0].document.translation, 'legacy');
    const second = await load(store, document(entry('different')), { legacyRaw: '{broken legacy data' });
    assert.deepEqual(second, first);
  }
});

test('invalid legacy or recovery never initializes the database with the sample', async () => {
  for (const extras of [
    { legacyRaw: '{' }, { legacyRaw: JSON.stringify({ version: 7, entries: [] }) },
    { legacyError: 'storage disabled' }, { recovery: ['{'] },
  ]) {
    const store = createPersistenceStore(new IDBFactory());
    await assert.rejects(load(store, document(entry('example')), extras));
    assert.equal(await store.read(), undefined);
  }
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
  await load(store, initial, { recovery: [JSON.stringify({ version: 2, batches: [old] })] });
  assert.deepEqual(await store.read(), document(entry('a')));
});

test('a mismatched structural transaction is rejected without corrupting existing data', async () => {
  const store = createPersistenceStore(new IDBFactory());
  const initial = document(entry('a'));
  await load(store, initial);
  await assert.rejects(store.write({ session: 'test', sequence: 1, changes: [change(entry('b'))] }), /一致/);
  assert.deepEqual(await store.read(), initial);
});

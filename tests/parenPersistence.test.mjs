import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { isSavedState, readSavedState, effectiveSlotMarker } from '../src/model.ts';
import { readSavedDocument } from '../src/groupEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { parseRecovery } from '../src/entryPersistence.ts';
import { createPersistenceStore } from '../src/persistenceStore.ts';
import { connectArrow } from '../src/arrowEditing.ts';

const current = () => ({ translation: '訳', groups: [], splits: [], arrows: [],
  tokens: [
    { id: 'open', kind: 'paren-open', text: '(', slotId: 'open-slot' },
    { id: 'word', text: 'word', slotId: 'word-slot' },
    { id: 'close', kind: 'paren-close', text: ')' },
  ], slots: [{ id: 'open-slot' }, { id: 'word-slot' }],
});
const entries = document => ({ version: 8, entries: [{ id: 'entry', document }] });
const batch = document => ({ session: 'recovery', sequence: 1,
  changes: [{ id: 'entry', generation: 1, entry: { id: 'entry', document } }],
  order: { generation: 1, ids: ['entry'] },
});
const journal = document => JSON.stringify({ version: 2, documentVersion: 8, batches: [batch(document)] });

test('current parentheses round-trip unchanged and opening parentheses retain arrow semantics', () => {
  const document = current();
  assert.equal(isSavedState(document), true);
  assert.equal(readSavedState(document), document);
  assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(document))), document);
  assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(entries(document)))), entries(document));
  assert.equal(effectiveSlotMarker(document, 'open-slot'), 'marker.adverb');
  const connected = connectArrow(document, 'open-slot', 'word-slot');
  assert.deepEqual(readEntryDocument(entries(connected)), entries(connected));
});

test('slotless legacy parentheses and inner document versions are rejected without migration', () => {
  const slotless = current();
  delete slotless.tokens[0].slotId;
  slotless.slots.shift();
  assert.equal(readSavedState(slotless), undefined);
  assert.equal(readSavedDocument(slotless), undefined);
  assert.equal(readEntryDocument(entries(slotless)), undefined);
  assert.throws(() => parseRecovery(journal(slotless)));
  assert.equal(readEntryDocument(entries({ ...current(), version: 7 })), undefined);
});

test('current recovery and IndexedDB preserve selectable parentheses', async () => {
  const initial = entries({ translation: '', groups: [], splits: [], arrows: [], tokens: [], slots: [] });
  const store = createPersistenceStore(new IDBFactory());
  const loaded = await store.load({ kind: 'load', initial, legacyRaw: null, recovery: [journal(current())] });
  assert.deepEqual(loaded.document, entries(current()));
  assert.equal(loaded.discardedLegacy, false);
  assert.deepEqual(await store.read(), entries(current()));
  assert.deepEqual(parseRecovery(journal(current())).batches[0], batch(current()));
});

test('old recovery format is discarded and initializes the sample', async () => {
  const initial = entries(current());
  const old = JSON.stringify({ version: 2, batches: [batch({ ...current(), version: 6 })] });
  const store = createPersistenceStore(new IDBFactory());
  const loaded = await store.load({ kind: 'load', initial, legacyRaw: null, recovery: [old] });
  assert.deepEqual(loaded.document, initial);
  assert.equal(loaded.discardedLegacy, true);
});

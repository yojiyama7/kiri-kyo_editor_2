import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { isSavedState, readSavedState, effectiveSlotMarker } from '../src/model.ts';
import { readSavedDocument } from '../src/groupEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { parseRecovery } from '../src/entryPersistence.ts';
import { createPersistenceStore } from '../src/persistenceStore.ts';
import { connectArrow } from '../src/arrowEditing.ts';

const legacy = () => ({ version: 6, translation: '訳', groups: [], splits: [], arrows: [],
  tokens: [
    { id: 'open', kind: 'paren-open', text: '(' },
    { id: 'word', text: 'word', slotId: 'word-slot' },
    { id: 'close', kind: 'paren-close', text: ')' },
  ], slots: [{ id: 'word-slot' }],
});
const entries = document => ({ version: 7, entries: [{ id: 'entry', document }] });
const batch = document => ({ session: 'recovery', sequence: 1,
  changes: [{ id: 'entry', generation: 1, entry: { id: 'entry', document } }],
  order: { generation: 1, ids: ['entry'] },
});
const journal = document => JSON.stringify({ version: 2, batches: [batch(document)] });

test('slotless parentheses migrate immutably through v5/v6 and remain stable on repeated reads', () => {
  const old = legacy(), before = structuredClone(old);
  assert.equal(isSavedState(old), false);
  const migrated = readSavedDocument(old);
  const id = migrated.tokens[0].slotId;
  assert.equal(typeof id, 'string');
  assert.deepEqual(migrated.slots, [...old.slots, { id }]);
  assert.deepEqual(migrated.tokens.map(t => t.id), old.tokens.map(t => t.id));
  assert.equal(migrated.tokens[2].slotId, undefined);
  assert.equal(effectiveSlotMarker(migrated, id), 'marker.adverb');
  assert.equal(isSavedState(migrated), true);
  assert.deepEqual(old, before);
  assert.deepEqual(readSavedDocument(old), migrated);
  assert.equal(readSavedState(migrated), migrated);
  for (const value of [old, entries(old), migrated, entries(migrated)]) {
    assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(value))).entries[0].document, migrated);
  }
  const connected = connectArrow(migrated, id, 'word-slot');
  assert.equal(connected.arrows.length, 1);
  assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(entries(connected)))), entries(connected));
});

test('migration supports mixed old/new parentheses and avoids existing IDs', () => {
  const old = legacy();
  old.tokens.push({ id: 'new-open', kind: 'paren-open', text: '(', slotId: 'paren:open' });
  old.slots.push({ id: 'paren:open' });
  const migrated = readSavedState(old);
  assert.equal(migrated.tokens[3].slotId, 'paren:open');
  assert.notEqual(migrated.tokens[0].slotId, 'paren:open');
  assert.equal(migrated.slots.length, 3);
  assert.deepEqual(readSavedState(old), migrated);
  assert.deepEqual(readSavedState(migrated), migrated);
});

test('migration does not accept malformed brackets, duplicate owners or dangling references', () => {
  for (const mutate of [
    d => { d.tokens[0].text = ')'; },
    d => { d.tokens[0].form = 'form.base'; },
    d => { d.tokens[0].slotId = ''; },
    d => { d.tokens[0].slotId = null; },
    d => { d.tokens[0].slotId = 'missing'; },
    d => { d.tokens[0].slotId = 'word-slot'; },
    d => { d.tokens[0].id = 'word'; },
    d => { d.tokens[2].slotId = 'extra'; d.slots.push({ id: 'extra' }); },
    d => { d.groups.push({ id: 'g', slotId: 'g', kind: 'composite', slots: ['paren:open'] }); d.slots.push({ id: 'g' }); },
    d => { d.arrows.push({ sourceSlotId: 'paren:open', targetSlotId: 'word-slot' }); },
  ]) {
    const invalid = legacy(); mutate(invalid);
    assert.equal(readSavedDocument(invalid), undefined);
    assert.equal(readEntryDocument(entries(invalid)), undefined);
    assert.throws(() => parseRecovery(journal(invalid)));
  }
});

test('IndexedDB, legacy import and recovery replay all expose selectable parentheses', async () => {
  for (const source of ['stored', 'v5', 'v6', 'recovery']) {
    const store = createPersistenceStore(new IDBFactory());
    const old = legacy();
    if (source === 'stored') await store.write(batch(old));
    const initial = entries({ version: 6, translation: '', groups: [], splits: [], arrows: [], tokens: [], slots: [] });
    const loaded = await store.load({ kind: 'load', initial,
      legacyRaw: source === 'v5' ? JSON.stringify(old) : source === 'v6' ? JSON.stringify(entries(old)) : null,
      recovery: source === 'recovery' ? [journal(old)] : [],
    });
    assert.deepEqual(loaded.entries[0].document, readSavedDocument(old));
    if (source !== 'v5') assert.equal(loaded.entries[0].id, 'entry');
    assert.deepEqual(await store.read(), loaded);
    if (source === 'recovery') {
      const parsed = parseRecovery(journal(old));
      assert.deepEqual(parsed.batches[0].changes[0].entry, loaded.entries[0]);
      assert.deepEqual(await store.load({ kind: 'load', initial, legacyRaw: null, recovery: [journal(old)] }), loaded);
    }
  }
});

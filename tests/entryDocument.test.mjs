import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEntry, isEntryDocument, readEntryDocument, insertEntry, insertEnglishEntries, parseEnglishLines, removeEntry, reorderEntry, withEntrySnapshot,
} from '../src/entryDocument.ts';
import { createExampleDocument } from '../src/example.ts';
import { EditHistory } from '../src/history.ts';
import { splitSlot } from '../src/tEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { connectArrow } from '../src/arrowEditing.ts';

const initial = () => {
  const entries = Array.from({ length: 3 }, () => createEntry(createExampleDocument()));
  return { document: { version: 7, entries }, activeEntryId: entries[1].id, cursor: { x: 1, y: 1 } };
};

test('v5 migration preserves token, slot, structure and arrow IDs in a single entry', () => {
  let document = createExampleDocument();
  document.slots[0].marker = 'marker.adverb';
  document = connectArrow(document, document.slots[0].id, document.slots[1].id);
  document = splitSlot(document, document.tokens[0].slotId);
  const migrated = readEntryDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(migrated.version, 7);
  assert.equal(migrated.entries.length, 1);
  assert.ok(migrated.entries[0].id);
  assert.deepEqual(migrated.entries[0].document, document);
  assert.equal(isEntryDocument(migrated), true);
});

test('v6 reload preserves entry order, IDs, translations, and independent structures', () => {
  const state = initial();
  state.document.entries[0].document.translation = 'first';
  state.document.entries[2].document = splitSlot(state.document.entries[2].document, state.document.entries[2].document.tokens[0].slotId);
  assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(state.document))), state.document);
});

test('unsupported formats and invalid entry containers are rejected', () => {
  for (const version of [3, 4]) {
    const legacy = JSON.parse(readFileSync(new URL(`./fixtures/empty-composite.v${version}.json`, import.meta.url)));
    assert.equal(readEntryDocument(legacy), undefined);
  }
  const state = initial();
  for (const invalid of [null, {}, [], { version: 7 }, { version: 7, entries: [] },
    { version: 7, entries: [null] }, { version: 7, entries: [{ id: '', document: createExampleDocument() }] },
    { version: 7, entries: [state.document.entries[0], state.document.entries[0]] }]) {
    assert.equal(readEntryDocument(invalid), undefined);
  }
});

test('old schema versions and key-derived marker or form values are rejected without migration', () => {
  const current = createExampleDocument();
  assert.equal(readEntryDocument({ ...current, version: 5 }), undefined);
  assert.equal(readEntryDocument({ version: 6, entries: [{ id: 'old', document: current }] }), undefined);
  const oldMarker = structuredClone(current);
  oldMarker.slots[0].marker = 's';
  assert.equal(readEntryDocument(oldMarker), undefined);
  const oldForm = structuredClone(current);
  oldForm.tokens[0].form = 'pp';
  assert.equal(readEntryDocument(oldForm), undefined);
});

test('cross-entry group, arrow, T and token references are rejected', () => {
  for (const type of ['group', 'arrow', 'split', 'token']) {
    const { document } = initial();
    const own = document.entries[0].document;
    const foreign = document.entries[1].document.tokens[0].slotId;
    if (type === 'group') own.groups[0].slots[0] = foreign;
    if (type === 'arrow') {
      own.slots[0].marker = 'marker.adverb';
      own.arrows.push({ sourceSlotId: own.slots[0].id, targetSlotId: foreign });
    }
    if (type === 'split') {
      const split = splitSlot(own, own.tokens[0].slotId);
      split.splits[0].slotId = foreign;
      document.entries[0].document = split;
    }
    if (type === 'token') own.tokens[0].slotId = foreign;
    assert.equal(isEntryDocument(document), false, type);
  }
});

test('adding inserts an independent blank entry directly after the chosen entry', () => {
  const before = initial();
  const after = insertEntry(before, before.activeEntryId);
  assert.equal(before.document.entries.length, 3);
  assert.equal(after.document.entries.length, 4);
  assert.equal(after.activeEntryId, after.document.entries[2].id);
  assert.deepEqual(after.cursor, { x: 0, y: 0 });
  assert.deepEqual(after.document.entries[2].document, createEntry().document);
  assert.deepEqual(after.document.entries.filter((entry) => entry.id !== after.activeEntryId), before.document.entries);
});

test('English lines normalize line endings and whitespace, skip blanks, and retain duplicates', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    assert.deepEqual(parseEnglishLines(`  She\t likes   music.  ${newline}${newline} \t ${newline}He plays.\u3000${newline}She likes music.${newline}`),
      ['She likes music.', 'He plays.', 'She likes music.']);
  }
  assert.deepEqual(parseEnglishLines(' \r\n \t\n\u3000'), []);
  assert.deepEqual(parseEnglishLines(''), []);
});

test('bulk insertion retains all existing structures and inserts independent entries in order', () => {
  const before = initial();
  const existing = before.document.entries[1].document;
  existing.slots[0].marker = 'marker.adverb';
  before.document.entries[1].document = splitSlot(
    connectArrow(existing, existing.slots[0].id, existing.slots[1].id), existing.tokens[2].slotId);
  before.document.entries[1].document.translation = '既存の訳文';
  const original = structuredClone(before);
  let id = 0;
  const after = insertEnglishEntries(before, before.activeEntryId,
    ' She\tlikes music.\r\n\r\n He plays. \nShe likes music.', () => `bulk-${++id}`);
  assert.deepEqual(before, original);
  assert.deepEqual(after.document.entries.slice(0, 2), before.document.entries.slice(0, 2));
  assert.deepEqual(after.document.entries.slice(5), before.document.entries.slice(2));
  const added = after.document.entries.slice(2, 5);
  assert.deepEqual(added.map(({ document }) => document.tokens.map(({ text }) => text).join(' ')),
    ['She likes music.', 'He plays.', 'She likes music.']);
  assert.equal(after.activeEntryId, added[0].id);
  assert.deepEqual(after.cursor, { x: 0, y: 0 });
  const allIds = added.flatMap(({ id, document }) => [id, ...document.tokens.map(({ id }) => id), ...document.slots.map(({ id }) => id)]);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const { document } of added) {
    assert.deepEqual(document.slots, document.tokens.map(({ slotId }) => ({ id: slotId })));
    assert.deepEqual(document.groups, []);
    assert.deepEqual(document.splits, []);
    assert.deepEqual(document.arrows, []);
    assert.equal(document.translation, '');
    assert.equal(document.version, 6);
  }
  assert.equal(isEntryDocument(after.document), true);
  assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(after.document))), after.document);
});

test('bulk insertion works after the first, last, and only empty entry', () => {
  for (const index of [0, 2]) {
    const before = initial();
    const after = insertEnglishEntries(before, before.document.entries[index].id, 'First.\nSecond.');
    assert.equal(after.document.entries.length, 5);
    assert.equal(after.activeEntryId, after.document.entries[index + 1].id);
    assert.deepEqual(after.document.entries.slice(index + 1, index + 3)
      .map(({ document }) => document.tokens[0].text), ['First.', 'Second.']);
  }
  const empty = createEntry();
  const before = { document: { version: 7, entries: [empty] }, activeEntryId: empty.id, cursor: { x: 0, y: 0 } };
  const after = insertEnglishEntries(before, empty.id, 'First.\nSecond.');
  assert.equal(after.document.entries.length, 3);
  assert.deepEqual(after.document.entries[0], empty);
});

test('bulk insertion is one undo/redo transaction preserving IDs, active entry and cursor', () => {
  const before = initial();
  const after = insertEnglishEntries(before, before.activeEntryId, 'First.\nSecond.\nThird.');
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  assert.equal(history.redo(), undefined);
});

test('blank bulk input and unknown insertion targets create no IDs or history and preserve redo', () => {
  const before = initial();
  const after = insertEnglishEntries(before, before.activeEntryId, 'A sentence.');
  const history = new EditHistory();
  history.record(before, after);
  history.undo();
  const unexpectedId = () => { throw new Error('No IDs should be generated for no-op input'); };
  for (const [id, text] of [[before.activeEntryId, ' \r\n\t\n'], [before.activeEntryId, ''], ['missing', 'Sentence.']]) {
    const result = insertEnglishEntries(before, id, text, unexpectedId);
    assert.equal(result, before);
    history.record(before, result);
  }
  assert.deepEqual(history.redo(), after);
});

test('deleting active entries selects the following entry, or the previous at the end', () => {
  const before = initial();
  const after = removeEntry(before, before.activeEntryId);
  assert.equal(after.activeEntryId, before.document.entries[2].id);
  assert.deepEqual(after.cursor, { x: 0, y: 0 });
  const last = removeEntry(after, after.activeEntryId);
  assert.equal(last.activeEntryId, before.document.entries[0].id);
  assert.equal(before.document.entries.length, 3);
});

test('deleting the final entry leaves a new empty entry and undo restores all original data', () => {
  const entry = createEntry(createExampleDocument());
  const before = { document: { version: 7, entries: [entry] }, activeEntryId: entry.id, cursor: { x: 1, y: 1 } };
  const after = removeEntry(before, entry.id);
  assert.equal(after.document.entries.length, 1);
  assert.notEqual(after.activeEntryId, entry.id);
  assert.equal(after.document.entries[0].document.tokens.length, 0);
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), after);
});

test('reordering swaps adjacent entries and preserves the active entry, cursor, and data', () => {
  const before = initial();
  const after = reorderEntry(before, before.activeEntryId, 1);
  assert.deepEqual(after.document.entries, [before.document.entries[0], before.document.entries[2], before.document.entries[1]]);
  assert.equal(after.activeEntryId, before.activeEntryId);
  assert.deepEqual(after.cursor, before.cursor);
  assert.deepEqual(reorderEntry(after, after.activeEntryId, -1), before);
});

test('boundary reorder and unknown entries are no-ops that preserve redo', () => {
  const before = initial();
  const history = new EditHistory();
  const after = reorderEntry(before, before.activeEntryId, 1);
  history.record(before, after);
  history.undo();
  for (const result of [reorderEntry(before, before.document.entries[0].id, -1),
    reorderEntry(before, before.document.entries[2].id, 1), reorderEntry(before, 'missing', 1),
    removeEntry(before, 'missing'), insertEntry(before, 'missing')]) {
    assert.equal(result, before);
    history.record(before, result);
  }
  assert.deepEqual(history.redo(), after);
});

test('structural edits change only the chosen entry, including T creation and cascading deletion', () => {
  const before = initial();
  const chosen = before.document.entries[1];
  let edited = splitSlot(chosen.document, chosen.document.tokens[0].slotId);
  edited = deleteGroup(edited, edited.groups[0].id);
  const after = withEntrySnapshot(before.document, chosen.id, { document: edited, cursor: { x: 0, y: 0 } });
  assert.deepEqual(after.document.entries[0], before.document.entries[0]);
  assert.deepEqual(after.document.entries[2], before.document.entries[2]);
  assert.equal(after.document.entries[1].document.splits.length, 1);
  assert.equal(after.document.entries[1].document.groups.length, 1);
  assert.equal(isEntryDocument(after.document), true);
});

test('global undo traverses edits in different entries, additions, swaps, and deletions in order', () => {
  const before = initial();
  const history = new EditHistory();
  const first = before.document.entries[0];
  const second = before.document.entries[1];
  const changes = [];
  let state = before;
  function record(next) { history.record(state, next); changes.push([structuredClone(state), structuredClone(next)]); state = next; }
  record(withEntrySnapshot(state.document, first.id, {
    document: { ...first.document, translation: 'edited first' }, cursor: { x: 0, y: 0 },
  }));
  record(withEntrySnapshot(state.document, second.id, {
    document: splitSlot(second.document, second.document.tokens[0].slotId), cursor: { x: 1, y: 0 },
  }));
  record(insertEntry(state, first.id));
  record(reorderEntry(state, state.activeEntryId, 1));
  record(removeEntry(state, state.activeEntryId));
  for (const [previous] of [...changes].reverse()) assert.deepEqual(history.undo(), previous);
  assert.equal(history.undo(), undefined);
  for (const [, next] of changes) assert.deepEqual(history.redo(), next);
  assert.equal(history.redo(), undefined);
});

test('switching entries without edits neither creates history nor invalidates redo', () => {
  const before = initial();
  const after = insertEntry(before, before.activeEntryId);
  const history = new EditHistory();
  history.record(before, after);
  history.undo();
  history.record(before, { ...before, activeEntryId: before.document.entries[2].id, cursor: { x: 0, y: 0 } });
  assert.deepEqual(history.redo(), after);
});

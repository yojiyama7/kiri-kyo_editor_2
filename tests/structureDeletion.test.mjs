import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroup, isSavedState } from '../src/model.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { computeLayout, normalizeCursorY, slotAt } from '../src/layout.ts';
import { readSavedDocument, settleBasicGroups } from '../src/groupEditing.ts';
import { EditHistory } from '../src/history.ts';
import { setSlotMarker } from '../src/markers.ts';

const initial = () => ({ version: 6, arrows: [], splits: [], groups: [], translation: '訳',
  tokens: [...'abcd'].map((text) => ({ id: `token:${text}`, text, slotId: text })),
  slots: [...'abcd'].map((id) => ({ id })),
});
function addGroup(document, slots) {
  const group = createGroup(document.tokens, document.slots, slots, document.splits);
  document.groups.push(group);
  document.slots.push({ id: group.slotId });
  return group;
}
const layoutOf = (document) => computeLayout(document.tokens, document.groups, document.splits);
function assertRoundTrip(document) {
  assert.equal(isSavedState(document), true);
  assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(document))), document);
  assert.doesNotThrow(() => layoutOf(document));
}

test('normal deletion removes whole consumers and ancestors but preserves inputs and unrelated overlapping groups', () => {
  const document = initial();
  const child = addGroup(document, ['a']);
  const source = addGroup(document, [child.slotId, 'b']);
  const parent = addGroup(document, [source.slotId, 'c']);
  addGroup(document, [parent.slotId, 'd']);
  const unrelated = addGroup(document, ['b', 'c']);
  const childConsumer = addGroup(document, [child.slotId, 'd']);
  document.slots = setSlotMarker(setSlotMarker(document.slots, child.slotId, 'marker.subject'), 'b', 'marker.object');
  const original = structuredClone(document);
  const result = deleteGroup(document, source.id);
  assert.deepEqual(result.groups, [child, unrelated, childConsumer]);
  const expectedIds = new Set(['a', 'b', 'c', 'd', child.slotId, unrelated.slotId, childConsumer.slotId]);
  assert.deepEqual(result.slots, document.slots.filter((slot) => expectedIds.has(slot.id)));
  assert.deepEqual(result.tokens, document.tokens);
  assert.equal(result.translation, document.translation);
  assert.deepEqual(document, original);
  assertRoundTrip(result);
});

test('branching and shared ancestors are deleted regardless of saved order, even with surviving other references', () => {
  const document = initial();
  const source = addGroup(document, ['a']);
  const first = addGroup(document, [source.slotId, 'b']);
  const second = addGroup(document, [source.slotId, 'c']);
  addGroup(document, [first.slotId, second.slotId, 'd']);
  document.groups.reverse();
  const result = deleteGroup(document, source.id);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.slots, initial().slots);
  assertRoundTrip(result);
});

test('normal deletion follows T ownership, nested D children and consumers of whole source slots', () => {
  let document = initial();
  const source = addGroup(document, ['a', 'b']);
  document = splitSlot(document, source.slotId);
  const split = document.splits[0];
  const dependent = addGroup(document, [split.leftSlotId]);
  document = splitSlot(document, dependent.slotId, 'd');
  const nested = document.splits[1];
  addGroup(document, [nested.rightSlotId, 'c']);
  addGroup(document, [source.slotId, 'd']);
  const survivor = addGroup(document, ['c', 'd']);
  document = splitSlot(document, survivor.slotId);
  document.groups.reverse();
  assertRoundTrip(document);
  const result = deleteGroup(document, source.id);
  assert.deepEqual(result.groups, [survivor]);
  assert.deepEqual(result.splits, [document.splits[2]]);
  assertRoundTrip(result);
});

test('deleting a consumer preserves its T inputs, while unsplitting preserves the surviving whole source', () => {
  let document = splitSlot(initial(), 'a');
  const split = document.splits[0];
  const childConsumer = addGroup(document, [split.leftSlotId]);
  const wholeConsumer = addGroup(document, ['a', 'b']);
  document.slots = setSlotMarker(setSlotMarker(document.slots, split.leftSlotId, 'marker.subject'), split.rightSlotId, 'marker.object');
  const deleted = deleteGroup(document, childConsumer.id);
  assert.deepEqual(deleted.splits, document.splits);
  assert.deepEqual(deleted.groups, [wholeConsumer]);
  assert.equal(deleted.slots.find((slot) => slot.id === split.leftSlotId).marker, 'marker.subject');
  const unsplit = unsplitSlot(document, split.rightSlotId);
  assert.deepEqual(unsplit.groups, [wholeConsumer]);
  assert.equal(unsplit.slots.find((slot) => slot.id === 'a').marker, 'marker.subject');
  assert.equal(unsplit.splits.length, 0);
  assert.equal(isSavedState(deleted), true);
  assert.equal(isSavedState(unsplit), true);
});

test('cascade deletion is a single undo/redo step and its cursor remains valid after rows disappear', () => {
  let document = initial();
  document.slots = setSlotMarker(document.slots, 'a', 'marker.subject');
  const source = addGroup(document, ['a', 'b']);
  const parent = addGroup(document, [source.slotId]);
  addGroup(document, [parent.slotId, 'c']);
  const layout = layoutOf(document);
  const before = { document, cursor: { x: 0, y: layout.slotY.get(source.slotId) } };
  const deleted = deleteGroup(document, source.id);
  const nextLayout = layoutOf(deleted);
  const result = settleBasicGroups(deleted, { x: before.cursor.x,
    y: normalizeCursorY(nextLayout, before.cursor.x, Math.max(0, before.cursor.y - 1)),
  });
  const after = { document: result.document, cursor: result.cursor };
  assert.deepEqual(after.cursor, { x: 0, y: 0 });
  assert.equal(slotAt(layoutOf(after.document), after.cursor.x, after.cursor.y), 'a');
  assertRoundTrip(after.document);
  const history = new EditHistory();
  history.record(before, after);
  const restored = history.undo();
  assert.deepEqual(restored, before);
  assertRoundTrip(restored.document);
  assert.equal(slotAt(layoutOf(restored.document), restored.cursor.x, restored.cursor.y), source.slotId);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  assert.equal(history.redo(), undefined);
});

test('a missing deletion target is a no-op and creates no history entry', () => {
  const document = initial();
  const next = deleteGroup(document, 'missing');
  assert.equal(next, document);
  const history = new EditHistory();
  history.record({ document, cursor: { x: 0, y: 0 } }, { document: next, cursor: { x: 0, y: 0 } });
  assert.equal(history.undo(), undefined);
});

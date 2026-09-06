import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enterBasicGroup, groupsForEditing, readSavedDocument, reclassifyGroups, settleOpenedGroups,
} from '../src/groupEditing.ts';
import { createExampleDocument } from '../src/example.ts';
import { hasBasicContents, isSavedState } from '../src/model.ts';
import { computeLayout, moveRight, slotAt, slotPosition } from '../src/layout.ts';
import { setSlotMarker } from '../src/markers.ts';
import { EditHistory } from '../src/history.ts';
import { splitSlot } from '../src/tEditing.ts';

const effectiveLayout = (document, opened) => computeLayout(
  document.tokens, groupsForEditing(document.groups, opened), document.splits, document.arrows);

test('opening a basic group changes only transient editing state', () => {
  const document = createExampleDocument();
  const before = structuredClone(document);
  const opened = enterBasicGroup(document, { x: 2, y: 0 }, new Set());
  assert.deepEqual(document, before);
  assert.equal(opened.openedGroupIds.has(document.groups[0].id), true);
  assert.equal(document.groups[0].kind, 'basic');
  assert.equal(groupsForEditing(document.groups, opened.openedGroupIds)[0].kind, 'composite');
  assert.equal(slotAt(effectiveLayout(document, opened.openedGroupIds), opened.cursor.x, opened.cursor.y),
    document.tokens[2].slotId);
  assert.equal(isSavedState(document), true);
});

test('movement inside keeps a temporary group open and leaving closes it while preserving destination identity', () => {
  const document = createExampleDocument();
  const opened = enterBasicGroup(document, { x: 2, y: 0 }, new Set());
  const layout = effectiveLayout(document, opened.openedGroupIds);
  const inside = moveRight(layout, opened.cursor);
  const stayed = settleOpenedGroups(document, inside, null, opened.openedGroupIds);
  assert.equal(stayed.openedGroupIds.has(document.groups[0].id), true);
  const targetGroup = document.groups[2];
  const target = slotPosition(layout, targetGroup.slotId);
  const closed = settleOpenedGroups(document, target, target, opened.openedGroupIds);
  const closedLayout = effectiveLayout(document, closed.openedGroupIds);
  assert.equal(closed.openedGroupIds.size, 0);
  assert.equal(slotAt(closedLayout, closed.cursor.x, closed.cursor.y), targetGroup.slotId);
  assert.equal(slotAt(closedLayout, closed.anchor.x, closed.anchor.y), targetGroup.slotId);
});

test('closeAll clears every temporary opening without changing persisted groups', () => {
  const document = createExampleDocument();
  const before = structuredClone(document.groups);
  const ids = new Set(document.groups.filter(group => group.kind === 'basic').map(group => group.id));
  const result = settleOpenedGroups(document, { x: 2, y: 0 }, null, ids, true);
  assert.equal(result.openedGroupIds.size, 0);
  assert.deepEqual(document.groups, before);
});

test('split basic groups cannot be opened', () => {
  const document = createExampleDocument();
  const split = splitSlot(document, document.groups[0].slotId);
  const result = enterBasicGroup(split, { x: 2, y: 0 }, new Set());
  assert.equal(result.openedGroupIds.size, 0);
  assert.deepEqual(result.cursor, { x: 2, y: 0 });
});

test('overlapping basic groups can be opened successively and closed together', () => {
  const document = createExampleDocument();
  const a = document.groups[0];
  const b = { ...document.groups[1], slots: [...a.slots], kind: 'basic' };
  document.groups = [a, b];
  const openedB = enterBasicGroup(document, { x: 2, y: 1 }, new Set());
  const openedA = enterBasicGroup(document, openedB.cursor, openedB.openedGroupIds);
  assert.deepEqual([...openedA.openedGroupIds].sort(), [a.id, b.id].sort());
  const closed = settleOpenedGroups(document, { x: 0, y: 0 }, null, openedA.openedGroupIds, true);
  assert.equal(closed.openedGroupIds.size, 0);
  assert.deepEqual(document.groups.map(group => group.kind), ['basic', 'basic']);
});

test('content edits and persisted kind reclassification form one undo step', () => {
  const original = createExampleDocument();
  const group = original.groups[0];
  assert.equal(hasBasicContents(original.tokens, original.slots, group.slots, original.splits), true);
  const marked = { ...original, slots: setSlotMarker(original.slots, original.tokens[2].slotId, 'marker.subject') };
  const edited = reclassifyGroups(marked);
  assert.equal(edited.groups[0].kind, 'composite');
  const before = { document: original, cursor: { x: 0, y: 0 } };
  const after = { document: edited, cursor: before.cursor };
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  assert.equal(reclassifyGroups(edited), edited);
});

test('temporary open and close are not history entries', () => {
  const document = createExampleDocument();
  const state = { document, cursor: { x: 2, y: 0 } };
  const opened = enterBasicGroup(document, state.cursor, new Set());
  const history = new EditHistory();
  history.record(state, { document, cursor: opened.cursor });
  assert.equal(history.undo(), undefined);
});

test('reload rejects legacy inner versions and normalizes stale persisted kinds', () => {
  const document = createExampleDocument();
  document.groups[0].kind = 'composite';
  const loaded = readSavedDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(loaded.groups[0].kind, 'basic');
  assert.equal(Object.hasOwn(loaded, 'version'), false);
  assert.equal(readSavedDocument({ ...document, version: 7 }), undefined);
});

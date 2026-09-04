import assert from 'node:assert/strict';
import test from 'node:test';
import { enterBasicGroup, readSavedDocument, settleBasicGroups } from '../src/groupEditing.ts';
import { createExampleDocument } from '../src/example.ts';
import { hasBasicContents, isSavedState } from '../src/model.ts';
import { computeLayout, slotAt, moveLeft, moveRight, moveToRowEdge, moveVertical } from '../src/layout.ts';
import { setSlotMarker } from '../src/markers.ts';
import { EditHistory } from '../src/history.ts';
import { readFileSync } from 'node:fs';

const openExample = (x = 2) => enterBasicGroup(createExampleDocument(), { x, y: 0 });
const reportedDocument = () => JSON.parse(readFileSync(new URL('./fixtures/empty-composite.v5.json', import.meta.url), 'utf8'));

test('reported empty the-student composite stays open inside, then returns to basic on every exit route', () => {
  const document = reportedDocument();
  const layout = computeLayout(document.tokens, document.groups);
  const current = { x: 2, y: 0 };
  assert.equal(isSavedState(document), true);
  assert.equal(settleBasicGroups(document, current).document, document);
  const group = document.groups[2];
  const destinations = [
    moveLeft(layout, current),
    moveRight(layout, { x: 3, y: 0 }),
    moveVertical(layout, current, 1),
    moveToRowEdge(layout, current, 'start'),
    moveToRowEdge(layout, current, 'end'),
    { x: 2, y: layout.slotY.get(document.groups[1].slotId) },
  ];
  for (const destination of destinations) {
    const id = slotAt(layout, destination.x, destination.y);
    const result = settleBasicGroups(document, destination, destination);
    assert.equal(result.document.groups[2].kind, 'basic');
    assert.deepEqual(result.document.groups[2], { ...group, kind: 'basic' });
    assert.deepEqual(result.document.groups.slice(0, 2), document.groups.slice(0, 2));
    assert.deepEqual(result.document.tokens, document.tokens);
    assert.deepEqual(result.document.slots, document.slots);
    const updatedLayout = computeLayout(result.document.tokens, result.document.groups);
    assert.equal(slotAt(updatedLayout, result.cursor.x, result.cursor.y), id);
    assert.equal(slotAt(updatedLayout, result.anchor.x, result.anchor.y), id);
    assert.equal(settleBasicGroups(result.document, result.cursor).document, result.document);
  }
  assert.equal(document.groups[2].kind, 'composite');
});

test('loading repairs the reported v5 document and strips legacy flags without resetting data', () => {
  const document = reportedDocument();
  document.groups[0].revertToBasicOnExit = true;
  document.groups[2].revertToBasicOnExit = true;
  const original = structuredClone(document);
  const loaded = readSavedDocument(document);
  assert.equal(loaded.version, 6);
  assert.deepEqual(loaded.groups.map(({ kind }) => kind), ['composite', 'composite', 'basic']);
  assert.deepEqual(loaded.groups.map(({ id, slotId, slots }) => ({ id, slotId, slots })),
    document.groups.map(({ id, slotId, slots }) => ({ id, slotId, slots })));
  assert.deepEqual(loaded.tokens, document.tokens);
  assert.deepEqual(loaded.slots, document.slots);
  assert.equal(loaded.translation, document.translation);
  assert.equal(JSON.stringify(loaded).includes('revertToBasicOnExit'), false);
  assert.deepEqual(document, original);
  assert.equal(readSavedDocument({ ...document, version: 2 }), undefined);
});

test('document edits and their reclassification share an undo step and restored states are normalized', () => {
  const original = reportedDocument();
  const before = { document: original, cursor: { x: 0, y: 0 } };
  const edited = { ...original, slots: setSlotMarker(original.slots, original.tokens[0].slotId, 'marker.noun') };
  const settled = settleBasicGroups(edited, before.cursor);
  const history = new EditHistory();
  history.record(before, { document: settled.document, cursor: settled.cursor });
  const undo = history.undo();
  const restored = settleBasicGroups(undo.document, undo.cursor);
  assert.equal(restored.document.groups[2].kind, 'basic');
  assert.deepEqual(restored.document.slots, original.slots);
  assert.equal(history.undo(), undefined);
  const redo = history.redo();
  assert.deepEqual(settleBasicGroups(redo.document, redo.cursor).document, settled.document);
});

test('k converts a basic underline and enters its interior at the same X', () => {
  const original = createExampleDocument();
  const before = structuredClone(original);
  const opened = enterBasicGroup(original, { x: 3, y: 0 });
  assert.deepEqual(opened.cursor, { x: 3, y: 0 });
  assert.equal(opened.document.groups[0].kind, 'composite');
  assert.equal('revertToBasicOnExit' in opened.document.groups[0], false);
  assert.deepEqual(opened.document.groups[0].slots, original.groups[0].slots);
  assert.equal(opened.document.groups[0].id, original.groups[0].id);
  assert.equal(slotAt(computeLayout(opened.document.tokens, opened.document.groups), 3, 0), original.tokens[3].slotId);
  assert.equal(isSavedState(opened.document), true);
  assert.deepEqual(original, before);
  assert.deepEqual(opened.document.tokens, original.tokens);
  assert.deepEqual(opened.document.slots, original.slots);
});

test('internal movement and blocked movement keep it open; leaving to the side closes it', () => {
  const opened = openExample();
  const layout = computeLayout(opened.document.tokens, opened.document.groups);
  const inside = moveRight(layout, opened.cursor);
  assert.equal(settleBasicGroups(opened.document, inside).document, opened.document);
  assert.equal(settleBasicGroups(opened.document, moveVertical(layout, opened.cursor, -1)).document, opened.document);
  const outside = moveRight(layout, inside);
  const closed = settleBasicGroups(opened.document, outside);
  assert.equal(closed.document.groups[0].kind, 'basic');
  assert.equal(closed.document.groups[0].revertToBasicOnExit, undefined);
  assert.equal(slotAt(computeLayout(closed.document.tokens, closed.document.groups), closed.cursor.x, closed.cursor.y), opened.document.groups[1].slotId);
});

test('returning to the temporary group or clicking its parent preserves destination identity after reflow', () => {
  const opened = openExample();
  const layout = computeLayout(opened.document.tokens, opened.document.groups);
  for (const group of [opened.document.groups[0], opened.document.groups[2]]) {
    const target = { x: 2, y: layout.slotY.get(group.slotId) };
    const closed = settleBasicGroups(opened.document, target, target);
    const next = computeLayout(closed.document.tokens, closed.document.groups);
    assert.equal(slotAt(next, closed.cursor.x, closed.cursor.y), group.slotId);
    assert.equal(slotAt(next, closed.anchor.x, closed.anchor.y), group.slotId);
    assert.equal(closed.document.groups[0].kind, 'basic');
  }
});

test('markers left inside prevent reversion; removed markers permit reversion', () => {
  const opened = openExample();
  const marked = { ...opened.document, slots: setSlotMarker(opened.document.slots, opened.document.tokens[2].slotId, 'marker.subject') };
  assert.equal(settleBasicGroups(marked, opened.cursor).document.groups[0].kind, 'composite');
  const stayedComposite = settleBasicGroups(marked, { x: 0, y: 0 }).document;
  assert.equal(stayedComposite.groups[0].kind, 'composite');
  assert.equal(stayedComposite.groups[0].revertToBasicOnExit, undefined);
  const clearedInside = { ...marked, slots: setSlotMarker(marked.slots, marked.tokens[2].slotId) };
  assert.equal(settleBasicGroups(clearedInside, { x: 0, y: 0 }).document.groups[0].kind, 'basic');
  const clearedLater = { ...stayedComposite, slots: setSlotMarker(stayedComposite.slots, stayedComposite.tokens[2].slotId) };
  assert.equal(settleBasicGroups(clearedLater, { x: 2, y: 0 }).document.groups[0].kind, 'composite');
  assert.equal(settleBasicGroups(clearedLater, { x: 0, y: 0 }).document.groups[0].kind, 'basic');
});

test('group markers do not affect eligibility, but group children and missing or empty contents do', () => {
  const opened = openExample();
  assert.equal(hasBasicContents(opened.document.tokens, opened.document.slots, opened.document.groups[0].slots), true);
  const withChild = structuredClone(opened.document);
  withChild.groups[0].slots = [withChild.groups[1].slotId];
  assert.equal(settleBasicGroups(withChild, { x: 0, y: 0 }).document.groups[0].kind, 'composite');
  assert.equal(hasBasicContents(opened.document.tokens, opened.document.slots, []), false);
  assert.equal(hasBasicContents(opened.document.tokens, opened.document.slots, ['missing']), false);
});

test('a gap in a noncontiguous group is outside even within its bounding span', () => {
  const original = createExampleDocument();
  original.groups = [{ ...original.groups[0], slots: [original.tokens[2].slotId, original.tokens[4].slotId] }];
  const opened = enterBasicGroup(original, { x: 2, y: 0 });
  assert.equal(settleBasicGroups(opened.document, { x: 4, y: 0 }).document.groups[0].kind, 'composite');
  assert.equal(settleBasicGroups(opened.document, { x: 3, y: 0 }).document.groups[0].kind, 'basic');
});

test('overlapping basics can be opened successively and settle without losing the selected group', () => {
  const original = createExampleDocument();
  const a = original.groups[0];
  const b = { ...original.groups[1], slots: [...a.slots] };
  original.groups = [a, b];
  const openedB = enterBasicGroup(original, { x: 2, y: 1 });
  assert.equal(openedB.document.groups[1].kind, 'composite');
  assert.deepEqual(openedB.cursor, { x: 2, y: 0 });
  const openedA = enterBasicGroup(openedB.document, openedB.cursor);
  const closed = settleBasicGroups(openedA.document, { x: 0, y: 0 });
  assert.deepEqual(closed.document.groups.map(({ kind }) => kind), ['basic', 'basic']);
  assert.deepEqual(computeLayout(closed.document.tokens, closed.document.groups).groups.map(({ y }) => y), [0, 1]);
});

test('unflagged composites stay open inside and reclassify after ordinary upward movement and exit', () => {
  const original = createExampleDocument();
  original.groups[0].kind = 'composite';
  const up = enterBasicGroup(original, { x: 2, y: 1 });
  assert.equal(up.document, original);
  assert.deepEqual(up.cursor, { x: 2, y: 0 });
  assert.equal(settleBasicGroups(original, up.cursor).document, original);
  assert.equal(settleBasicGroups(original, { x: 0, y: 0 }).document.groups[0].kind, 'basic');
});

test('editing state round-trips through undo/redo and reload settles it by current contents', () => {
  const original = createExampleDocument();
  const before = { document: original, cursor: { x: 2, y: 0 } };
  const opened = enterBasicGroup(original, before.cursor);
  const after = { document: opened.document, cursor: opened.cursor };
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), after);
  const saved = JSON.parse(JSON.stringify(opened.document));
  assert.equal(isSavedState(saved), true);
  assert.equal(settleBasicGroups(saved, { x: 2, y: 0 }, null, true).document.groups[0].kind, 'basic');
  const marked = { ...saved, slots: setSlotMarker(saved.slots, saved.tokens[2].slotId, 'marker.subject') };
  assert.equal(settleBasicGroups(marked, { x: 0, y: 0 }, null, true).document.groups[0].kind, 'composite');
  assert.equal(readSavedDocument(saved).groups[0].kind, 'basic');
  assert.equal(readSavedDocument(marked).groups[0].kind, 'composite');
});

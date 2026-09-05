import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroup, isSavedState } from '../src/model.ts';
import { canSplit, splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { computeLayout, slotAt, slotPosition, moveLeft, moveRight, selectSlotRange, toggleSlotSelection } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { enterBasicGroup, settleBasicGroups } from '../src/groupEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { setSlotMarker } from '../src/markers.ts';
import { connectArrow } from '../src/arrowEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { EditHistory } from '../src/history.ts';

const initial = () => ({ version: 6, arrows: [], splits: [], groups: [], translation: '',
  tokens: [...'abcd'].map(text => ({ id: `token:${text}`, text, slotId: text })),
  slots: [...'abcd'].map(id => ({ id })) });
const addGroup = (d, ids) => {
  const group = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(group); d.slots.push({ id: group.slotId }); return group;
};
const layoutOf = d => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const marker = (d, id) => d.slots.find(slot => slot.id === id)?.marker;
const at = (layout, cursor) => slotAt(layout, cursor.x, cursor.y);

test('D accepts tokens and continuous basic/composite slots without expanding T eligibility', () => {
  const d = initial();
  const basic = addGroup(d, ['a', 'b']);
  const composite = addGroup(d, [basic.slotId, 'c']);
  const sparse = addGroup(d, ['a', 'c']);
  const sparseComposite = addGroup(d, [sparse.slotId]);
  for (const id of ['a', basic.slotId, composite.slotId]) {
    assert.equal(canSplit(d, id, 'd'), true);
    const next = splitSlot(d, id, 'd');
    assert.equal(next.splits[0].kind, 'd');
    assert.equal(isSavedState(next), true);
  }
  assert.equal(canSplit(d, composite.slotId), false);
  for (const id of [sparse.slotId, sparseComposite.slotId, 'missing']) {
    assert.equal(canSplit(d, id, 'd'), false);
    assert.equal(splitSlot(d, id, 'd'), d);
  }
});

test('neither split kind permits splitting an existing parent or either child', () => {
  for (const kind of ['t', 'd']) {
    const d = splitSlot(initial(), 'b', kind);
    const split = d.splits[0];
    for (const id of [split.slotId, split.leftSlotId, split.rightSlotId]) {
      for (const requested of ['t', 'd']) assert.equal(splitSlot(d, id, requested), d);
    }
  }
});

test('D keeps source references and transfers marker plus outgoing and incoming arrows left', () => {
  let d = initial();
  d.slots = setSlotMarker(setSlotMarker(d.slots, 'a', 'marker.adverb'), 'd', 'marker.adjective');
  const parent = addGroup(d, ['a', 'b']);
  d = connectArrow(connectArrow(d, 'a', 'c'), 'd', 'a');
  const next = splitSlot(d, 'a', 'd');
  const split = next.splits[0];
  assert.equal(marker(next, 'a'), undefined);
  assert.equal(marker(next, split.leftSlotId), 'marker.adverb');
  assert.equal(marker(next, split.rightSlotId), undefined);
  assert.equal(marker(d, 'a'), 'marker.adverb');
  assert.deepEqual(next.groups[0], parent);
  assert.deepEqual(next.arrows, [
    { sourceSlotId: split.leftSlotId, targetSlotId: 'c' },
    { sourceSlotId: 'd', targetSlotId: split.leftSlotId },
  ]);
  assert.equal(isSavedState(next), true);
  assert.equal(settleBasicGroups(next, { x: 4, y: 0 }).document.groups[0].kind, 'composite');
});

test('D halves support navigation, range/individual selection and independent groups', () => {
  const d = splitSlot(initial(), 'b', 'd');
  const { leftSlotId: left, rightSlotId: right } = d.splits[0];
  const layout = layoutOf(d);
  const lp = slotPosition(layout, left), rp = slotPosition(layout, right);
  assert.deepEqual(lp, { x: 1, y: 0 });
  assert.deepEqual(rp, { x: 2, y: 0 });
  assert.equal(at(layout, moveRight(layout, lp)), right);
  assert.equal(at(layout, moveLeft(layout, rp)), left);
  assert.equal(at(layout, moveRight(layout, rp)), 'c');
  assert.deepEqual(selectSlotRange(layout, lp, rp), [left, right]);
  assert.deepEqual(toggleSlotSelection(layout, [right], lp), [left, right]);
  const lg = addGroup(d, [left]), rg = addGroup(d, [right]);
  assert.equal(lg.kind, 'basic'); assert.equal(rg.kind, 'basic');
  assert.equal(isSavedState(d), true);
});

test('D uses the cursor boundary for unequal multi-token splits and persists the ratio', () => {
  const original = initial();
  const source = addGroup(original, ['a', 'b', 'c']);
  const d = splitSlot(original, source.slotId, 'd', 0);
  const split = d.splits[0];
  assert.equal(split.ratio, 1 / 3);
  assert.deepEqual(layoutOf(d).rangesBySlot.get(split.leftSlotId), [{ start: 0, end: 1 }]);
  assert.deepEqual(layoutOf(d).rangesBySlot.get(split.rightSlotId), [{ start: 1, end: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(d)).splits[0], split);
  assert.equal(isSavedState(d), true);

  const fromEnd = splitSlot(structuredClone(original), source.slotId, 'd', 2);
  assert.equal(fromEnd.splits[0].ratio, 2 / 3);
  const equalSource = initial();
  const equalGroup = addGroup(equalSource, ['a', 'b', 'c', 'd']);
  const equal = splitSlot(equalSource, equalGroup.slotId, 'd', 1);
  assert.equal(equal.splits[0].ratio, undefined);

  const nested = initial();
  const nestedGroup = addGroup(nested, ['a', 'b']);
  const withInnerCut = splitSlot(nested, 'a', 't');
  const nestedD = splitSlot(withInnerCut, nestedGroup.slotId, 'd', 0);
  assert.equal(nestedD.splits[1].ratio, 0.25);
});

test('D basic slots block internal editing while composite slots keep normal up navigation', () => {
  const d = initial();
  const basic = addGroup(d, ['a', 'b']);
  const composite = addGroup(d, [basic.slotId]);
  for (const source of [basic, composite]) {
    const next = splitSlot(d, source.slotId, 'd');
    const layout = layoutOf(next);
    for (const id of [next.splits[0].leftSlotId, next.splits[0].rightSlotId]) {
      const cursor = slotPosition(layout, id);
      assert.equal(cursor.y, layout.slotY.get(source.slotId));
      const entered = enterBasicGroup(next, cursor);
      assert.equal(entered.document, next);
      assert.equal(entered.cursor.x, cursor.x);
      assert.equal(entered.cursor.y, source.kind === 'basic' ? cursor.y : cursor.y - 1);
    }
  }
});

test('D removal cascades through mixed splits and arrows but retains whole-source consumers', () => {
  let d = initial();
  const source = addGroup(d, ['a', 'b']);
  const survivor = addGroup(d, [source.slotId, 'd']);
  d = splitSlot(d, source.slotId, 'd');
  const split = d.splits[0];
  const consumer = addGroup(d, [split.leftSlotId]);
  d = splitSlot(d, consumer.slotId);
  addGroup(d, [d.splits[1].rightSlotId, 'c']);
  d.slots = setSlotMarker(setSlotMarker(setSlotMarker(d.slots, split.leftSlotId, 'marker.adverb'), split.rightSlotId, 'marker.object2'), 'd', 'marker.adjective');
  d = connectArrow(connectArrow(d, split.leftSlotId, 'c'), 'd', source.slotId);
  const next = unsplitSlot(d, split.rightSlotId);
  assert.deepEqual(next.groups.map(g => g.id), [source.id, survivor.id]);
  assert.deepEqual(next.splits, []);
  assert.equal(marker(next, source.slotId), 'marker.adverb');
  assert.deepEqual(next.arrows, [{ sourceSlotId: 'd', targetSlotId: source.slotId }]);
  assert.equal(isSavedState(next), true);
  const deleted = deleteGroup(d, source.id);
  assert.deepEqual(deleted.groups, []);
  assert.deepEqual(deleted.splits, []);
  assert.deepEqual(deleted.arrows, []);
  assert.equal(isSavedState(deleted), true);
});

test('D creation and cascade deletion each round-trip with IDs and cursor in one undo/redo step', () => {
  const history = new EditHistory();
  const before = { document: initial(), cursor: { x: 1, y: 0 } };
  const d = splitSlot(before.document, 'b', 'd');
  const split = d.splits[0];
  const after = { document: d, cursor: slotPosition(layoutOf(d), split.leftSlotId) };
  history.record(before, after);
  assert.deepEqual(history.undo(), before); assert.deepEqual(history.redo(), after);
  addGroup(d, [split.rightSlotId]);
  const ready = structuredClone(after);
  const removed = { document: unsplitSlot(d, split.rightSlotId), cursor: { x: 1, y: 0 } };
  history.record(ready, removed);
  assert.deepEqual(history.undo(), ready); assert.deepEqual(history.redo(), removed);
});

test('v6 and single-entry v5 preserve mixed T/D saves including composite D and reject invalid kinds/references', () => {
  let d = splitSlot(initial(), 'd');
  const basic = addGroup(d, ['a', 'b']);
  const composite = addGroup(d, [basic.slotId]);
  d = splitSlot(d, composite.slotId, 'd');
  const full = { version: 7, entries: [{ id: 'entry', document: d }] };
  assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(full))), full);
  assert.deepEqual(readEntryDocument(d).entries[0].document, d);
  for (const mutate of [
    v => { v.splits[1].kind = 'unknown'; },
    v => { v.splits[1].kind = 't'; },
    v => { delete v.splits[1].kind; },
    v => { v.splits[1].slotId = v.splits[0].leftSlotId; },
    v => { v.splits[1].rightSlotId = v.splits[1].leftSlotId; },
    v => { v.splits[1].ratio = 1; },
    v => { v.splits[0].ratio = 0.25; },
    v => { v.groups[0].slots = ['a', 'c']; },
    v => { v.groups[1].slots = [v.splits[1].leftSlotId]; },
  ]) {
    const invalid = structuredClone(d); mutate(invalid);
    assert.equal(isSavedState(invalid), false);
  }
});

test('wrapped D keeps full logical halves, displays both in the last region and preserves original lines/connections', () => {
  const original = initial();
  const basic = addGroup(original, ['a', 'b', 'c']);
  const composite = addGroup(original, [basic.slotId]);
  for (const source of [basic, composite]) {
    const d = splitSlot(structuredClone(original), source.slotId, 'd');
    const split = d.splits[0];
    const child = addGroup(d, [split.rightSlotId]);
    const logical = layoutOf(d).rangesBySlot;
    assert.deepEqual(logical.get(split.leftSlotId), [{ start: 0, end: 2 }]);
    assert.deepEqual(logical.get(split.rightSlotId), [{ start: 2, end: 4 }]);
    for (const width of [1000, 200, 90]) {
      const view = computeRenderLayout(d.tokens, d.groups, d.splits, [100, 80, 60, 40], width);
      const regions = view.regionsBySlot.get(source.slotId), last = regions.at(-1);
      const left = view.regionsBySlot.get(split.leftSlotId), right = view.regionsBySlot.get(split.rightSlotId);
      assert.equal(left.length, 1); assert.equal(right.length, 1);
      assert.equal(left[0].row, last.row); assert.equal(right[0].row, last.row);
      assert.equal(left[0].left, last.left); assert.equal(right[0].right, last.right);
      assert.equal(left[0].right, (last.left + last.right) / 2);
      assert.equal(right[0].left, left[0].right);
      assert.deepEqual(view.regionsBySlot.get(child.slotId), right);
      for (let i = 1; i < regions.length; i++) {
        assert.ok(regions[i].startConnection);
        assert.equal(regions[i - 1].endConnection, regions[i].startConnection);
      }
    }
  }
});

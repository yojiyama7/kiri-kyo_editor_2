import assert from 'node:assert/strict';
import test from 'node:test';
import { getSlotGeometry, getSlotRanges } from '../src/slotGeometry.ts';
import { createGroup, isSavedState } from '../src/model.ts';
import { createExampleDocument } from '../src/example.ts';
import { splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { connectArrow } from '../src/arrowEditing.ts';
import { setSlotMarker } from '../src/markers.ts';
import { computeLayout, slotAt, slotPosition, relocateCursor, tokenIndexAt,
  groupLineSegments, selectSlotRange, intervalsIntersect } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { readSavedDocument } from '../src/groupEditing.ts';
import { EditHistory } from '../src/history.ts';

const initial = () => ({ arrows: [], splits: [], groups: [], translation: '',
  tokens: [...'abcdefgh'].map((text) => ({ id: `token:${text}`, text, slotId: text })),
  slots: [...'abcdefgh'].map((id) => ({ id })),
});
const layoutOf = (d) => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const rangesOf = (d) => getSlotRanges(d.tokens, d.groups, d.splits);
function addGroup(d, ids, marker) {
  const group = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(group);
  d.slots.push({ id: group.slotId, ...(marker ? { marker } : {}) });
  return group.slotId;
}
const range = (start, end) => [{ start, end }];
const interval = (start, end, startClosed, endClosed) => ({ start, end, startClosed, endClosed });
function assertIntegerPartition(d) {
  const { atoms, rangesBySlot } = getSlotGeometry(d.tokens, d.groups, d.splits);
  atoms.forEach((atom, i) => {
    assert.equal(atom.start, i);
    assert.equal(atom.end, i + 1);
    assert.equal(atom.tokenSlotId, d.tokens[atom.tokenIndex].slotId);
  });
  for (const regions of rangesBySlot.values()) for (const r of regions) {
    assert.ok(Number.isInteger(r.start) && Number.isInteger(r.end) && r.start < r.end);
  }
  assert.deepEqual(atoms.map((atom) => tokenIndexAt(layoutOf(d), atom.start)), atoms.map((atom) => atom.tokenIndex));
}

test('reported O1 and O2 half-open ranges share row zero and their parent is on row one', () => {
  const d = createExampleDocument();
  const l = layoutOf(d);
  assert.deepEqual(l.rangesBySlot.get(d.groups[0].slotId), range(2, 4));
  assert.deepEqual(l.rangesBySlot.get(d.groups[1].slotId), range(4, 7));
  assert.deepEqual(l.groups.map(({ y }) => y), [0, 0, 1]);
  assert.equal(slotAt(l, 3, 0), d.groups[0].slotId);
  assert.equal(slotAt(l, 4, 0), d.groups[1].slotId);
});

test('single-token T creates integer atoms and shifts subsequent tokens without changing IDs', () => {
  const d = initial();
  const next = splitSlot(d, 'b');
  const { leftSlotId, rightSlotId } = next.splits[0];
  const r = rangesOf(next);
  assert.deepEqual(r.get('a'), range(0, 1));
  assert.deepEqual(r.get('b'), range(1, 3));
  assert.deepEqual(r.get(leftSlotId), range(1, 2));
  assert.deepEqual(r.get(rightSlotId), range(2, 3));
  assert.deepEqual(r.get('c'), range(3, 4));
  assert.deepEqual(next.tokens, d.tokens);
  assert.equal(layoutOf(next).logicalSize, 9);
  assert.equal(layoutOf(next).tokenCount, 8);
  assertIntegerPartition(next);
  assert.deepEqual(rangesOf(unsplitSlot(next, rightSlotId)), rangesOf(d));
});

test('multi-token T preserves geometric bisection before global integer renumbering', () => {
  const d = initial();
  const source = addGroup(d, ['a', 'b', 'c']);
  const next = splitSlot(d, source);
  const { leftSlotId, rightSlotId } = next.splits[0];
  const r = rangesOf(next);
  assert.deepEqual(r.get(source), range(0, 4));
  assert.deepEqual(r.get('b'), range(1, 3));
  assert.deepEqual(r.get(leftSlotId), range(0, 2));
  assert.deepEqual(r.get(rightSlotId), range(2, 4));
  assert.deepEqual(r.get('d'), range(4, 5));
  assertIntegerPartition(next);
  const even = initial();
  const evenSource = addGroup(even, ['a', 'b']);
  assert.equal(layoutOf(splitSlot(even, evenSource)).logicalSize, 8); // cut already at a token boundary
});

test('multiple and nested T cuts are independent of split saving order and leave no gaps on removal', () => {
  let d = splitSlot(splitSlot(initial(), 'b'), 'f');
  const innerSource = addGroup(d, [d.splits[0].leftSlotId]);
  d = splitSlot(d, innerSource);
  assertIntegerPartition(d);
  const reversed = { ...d, splits: [...d.splits].reverse() };
  assert.deepEqual([...rangesOf(reversed)].sort(), [...rangesOf(d)].sort());
  assert.deepEqual(layoutOf(reversed).atoms, layoutOf(d).atoms);
  const removed = unsplitSlot(d, d.splits[0].rightSlotId);
  assert.equal(removed.splits.length, 1);
  assertIntegerPartition(removed);
  assert.equal(layoutOf(removed).logicalSize, 9);
  assert.equal(isSavedState(removed), true);
});

test('an unrelated T does not move an existing cut in token space', () => {
  let d = initial();
  const source = addGroup(d, ['b', 'c', 'd']);
  d = splitSlot(d, source);
  const original = layoutOf(d).atoms.filter((atom) => atom.tokenIndex >= 1).map((atom) => atom.id);
  d = splitSlot(d, 'a');
  assert.deepEqual(layoutOf(d).atoms.filter((atom) => atom.tokenIndex >= 1).map((atom) => atom.id), original);
  assertIntegerPartition(d);
});

test('cursor and selection endpoints keep their slot IDs and sparse regions across renumbering', () => {
  const d = initial();
  const sparse = addGroup(d, ['c', 'f']);
  const before = layoutOf(d);
  const next = splitSlot(d, 'a');
  const after = layoutOf(next);
  const cursor = relocateCursor(before, after, { x: 5, y: 0 });
  const anchor = relocateCursor(before, after, { x: 7, y: 0 });
  assert.deepEqual(cursor, { x: 6, y: 0 });
  assert.deepEqual(anchor, { x: 8, y: 0 });
  assert.equal(slotAt(after, cursor.x, cursor.y), sparse);
  assert.equal(slotAt(after, anchor.x, anchor.y), 'h');
  assert.deepEqual(selectSlotRange(after, cursor, anchor), selectSlotRange(before, { x: 5, y: 0 }, { x: 7, y: 0 }));
  assert.deepEqual(relocateCursor(after, before, cursor), { x: 5, y: 0 });
  assert.deepEqual(relocateCursor(after, before, anchor), { x: 7, y: 0 });
});

test('cascade removal renumbers atoms and keeps a surviving cursor and arrows on their slots', () => {
  let d = initial();
  const source = addGroup(d, ['a', 'b', 'c']);
  d = splitSlot(d, source);
  d.slots = setSlotMarker(d.slots, 'f', 'marker.adverb');
  d = connectArrow(d, 'f', 'h');
  const before = layoutOf(d);
  const next = deleteGroup(d, d.groups[0].id);
  const after = layoutOf(next);
  const cursor = relocateCursor(before, after, slotPosition(before, 'h'));
  assert.deepEqual(cursor, { x: 7, y: 0 });
  assert.deepEqual(next.arrows, d.arrows);
  assert.deepEqual(after.arrows[0].interval, interval(5.5, 7.5, false, true));
  assertIntegerPartition(next);
});

test('current reload and one-step undo/redo reproduce integer ranges and cursor positions', () => {
  const before = { document: initial(), cursor: { x: 1, y: 0 } };
  const document = splitSlot(before.document, 'b');
  const after = { document, cursor: slotPosition(layoutOf(document), document.splits[0].rightSlotId) };
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), after);
  const loaded = readSavedDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(loaded, document);
  assert.deepEqual(layoutOf(loaded), layoutOf(document));
  assert.equal(JSON.stringify(document).includes('rangesBySlot'), false);
});

test('rendering keeps token indices separate from logical atoms after T renumbering', () => {
  let d = splitSlot(initial(), 'b');
  const sparse = addGroup(d, ['d', 'f']);
  const l = layoutOf(d);
  const placement = l.groups.find(({ group }) => group.slotId === sparse);
  assert.deepEqual([placement.start, placement.end], [3, 5]);
  assert.deepEqual(groupLineSegments(l, placement).map(({ start, end }) => [start, end]), [[3, 3], [5, 5]]);
  for (const width of [1000, 250, 90]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 80), width);
    assert.deepEqual(view.regionsBySlot.get('d')[0].logicalRanges, range(4, 5));
    assert.deepEqual(view.regionsBySlot.get(sparse).flatMap((r) => r.logicalRanges), [...range(4, 5), ...range(6, 7)]);
  }
});

test('specified source [2,4) and target [5,7) produce (3,6] and reverse [3,6)', () => {
  let d = initial();
  const source = addGroup(d, ['c', 'd'], 'marker.adverb');
  const target = addGroup(d, ['f', 'g'], 'marker.adjective');
  d = connectArrow(d, source, target);
  assert.deepEqual(layoutOf(d).arrows[0].interval, interval(3, 6, false, true));
  assert.deepEqual(layoutOf(d).arrows[0].slotInterval, interval(2, 7, true, false));
  const reversed = connectArrow({ ...d, arrows: [] }, target, source);
  assert.deepEqual(layoutOf(reversed).arrows[0].interval, interval(3, 6, true, false));
});

test('sparse arrow endpoints use the final logical region, unaffected by wrapping', () => {
  let d = initial();
  const source = addGroup(d, ['a', 'f', 'g'], 'marker.adverb');
  d = connectArrow(d, source, 'h');
  const before = layoutOf(d);
  assert.deepEqual(before.arrows[0].interval, interval(6, 7.5, false, true));
  for (const width of [1000, 250, 90]) {
    computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 80), width);
    assert.deepEqual(layoutOf(d), before);
  }
});

test('point collisions, empty intervals and half-open adjacency are symmetric', () => {
  const occupied = interval(2, 4, true, false);
  for (const [point, expected] of [[2, true], [3, true], [4, false]]) {
    const p = interval(point, point, true, true);
    assert.equal(intervalsIntersect(occupied, p), expected);
    assert.equal(intervalsIntersect(p, occupied), expected);
    for (const [left, right] of [[false, false], [false, true], [true, false]]) {
      const empty = interval(point, point, left, right);
      assert.equal(intervalsIntersect(occupied, empty), false);
      assert.equal(intervalsIntersect(empty, occupied), false);
    }
  }
  assert.equal(intervalsIntersect(occupied, interval(4, 7, true, false)), false);
  assert.equal(intervalsIntersect(occupied, interval(3.5, 5, false, false)), true);
  assert.equal(intervalsIntersect(occupied, interval(3, 2, true, true)), false);
});

test('shared-center source and target form a closed point and wait for both slots', () => {
  let d = initial();
  const source = addGroup(d, ['c'], 'marker.adverb');
  d = connectArrow(d, source, 'c');
  const l = layoutOf(d);
  assert.deepEqual(l.arrows[0].interval, interval(2.5, 2.5, true, true));
  assert.equal(l.arrows[0].y, Math.max(l.slotY.get(source), l.slotY.get('c')) + 1);
  assert.equal(isSavedState(d), true);
});

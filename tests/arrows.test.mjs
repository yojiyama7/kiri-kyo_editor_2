import assert from 'node:assert/strict';
import test from 'node:test';
import { isSavedState } from '../src/model.ts';
import { connectArrow, deleteArrow, pruneArrows } from '../src/arrowEditing.ts';
import { computeLayout, intervalsIntersect, moveVertical, moveLeft, moveRight, moveToRowEdge, slotPosition, slotAt } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { setSlotMarker } from '../src/markers.ts';
import { splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { enterBasicGroup, readSavedDocument, settleBasicGroups } from '../src/groupEditing.ts';
import { EditHistory } from '../src/history.ts';

const initial = () => ({ version: 6, arrows: [], splits: [], groups: [], translation: '',
  tokens: [...'abcdefgh'].map((text) => ({ id: `token:${text}`, text, slotId: text })),
  slots: [...'abcdefgh'].map((id) => ({ id, marker: 'marker.adverb' })),
});
const layoutOf = (d) => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const group = (d, id, slots, kind = 'composite') => {
  const g = { id, slotId: `slot:${id}`, slots, kind };
  d.groups.push(g); d.slots.push({ id: g.slotId, marker: 'marker.adjective' }); return g.slotId;
};
const interval = (start, end, startClosed = true, endClosed = true) => ({ start, end, startClosed, endClosed });

test('endpoint contact requires both ends closed, with symmetric fractional and containment tests', () => {
  for (const closedA of [false, true]) for (const closedB of [false, true]) {
    const a = interval(0, 1.5, true, closedA), b = interval(1.5, 3, closedB, true);
    assert.equal(intervalsIntersect(a, b), closedA && closedB);
    assert.equal(intervalsIntersect(b, a), closedA && closedB);
  }
  assert.equal(intervalsIntersect(interval(0, 4, false, false), interval(1, 2)), true);
  assert.equal(intervalsIntersect(interval(0, 1), interval(2, 3)), false);
  assert.equal(intervalsIntersect(interval(0, 3, false, false), interval(0, 3, false, false)), true);
});

test('arrow collision interval uses logical region centers in both directions', () => {
  let d = initial();
  const source = group(d, 'source', ['b', 'c']);
  d = connectArrow(d, source, 'f');
  assert.deepEqual(layoutOf(d).arrows[0].interval, interval(2, 5.5, false, true));
  d = deleteArrow(d, source);
  d = connectArrow(d, 'f', source);
  assert.deepEqual(layoutOf(d).arrows[0].interval, interval(2, 5.5, true, false));
});

test('a shared target produces one horizontal with open source extremes and a closed tie', () => {
  let d = connectArrow(connectArrow(initial(), 'a', 'd'), 'h', 'd');
  assert.equal(layoutOf(d).arrows.length, 1);
  assert.deepEqual(layoutOf(d).arrows[0].sourceSlotIds, ['a', 'h']);
  assert.deepEqual(layoutOf(d).arrows[0].interval, interval(0.5, 7.5, false, false));
  const target = group(d, 'target', ['a']);
  d = connectArrow(d, 'a', target);
  assert.deepEqual(layoutOf(d).arrows.find((a) => a.targetSlotId === target).interval, interval(0.5, 0.5));
});

test('short arrows and underlines compete in one queue; underline wins equal length', () => {
  let d = initial();
  const long = group(d, 'long', ['a', 'b', 'c', 'd']);
  d = connectArrow(d, 'b', 'c');
  assert.equal(layoutOf(d).arrows[0].y, 1);
  assert.equal(layoutOf(d).slotY.get(long), 2);
  const tie = group(d, 'tie', ['b']);
  const l = layoutOf(d);
  assert.equal(l.slotY.get(tie), 1);
  assert.equal(l.arrows[0].y, 2);
  assert.equal(l.slotY.get(long), 3);
});

test('newly ready dependencies join the shortest queue and arrow rows follow every endpoint', () => {
  let d = initial();
  const parent = group(d, 'parent', ['slot:child']);
  const child = group(d, 'child', ['a']);
  const competitor = group(d, 'competitor', ['a', 'b']);
  d = connectArrow(d, 'a', parent);
  const l = layoutOf(d);
  assert.equal(l.slotY.get(child), 1);
  assert.equal(l.slotY.get(parent), 2);
  assert.equal(l.arrows[0].y, 3);
  assert.equal(l.slotY.get(competitor), 4);
});

test('interval predicate preserves open ends while adjacent arrow-slot envelopes do not overlap', () => {
  const underline = interval(2, 3, true, false);
  assert.equal(intervalsIntersect(interval(0.5, 2, true, false), underline), false);
  assert.equal(intervalsIntersect(interval(0.5, 2, false, true), underline), true);
  assert.equal(intervalsIntersect(underline, interval(3, 4, true, false)), false);
  let d = initial(); group(d, 'neighbor', ['c']);
  assert.equal(layoutOf(connectArrow(d, 'b', 'a')).arrows[0].y, 1);
  assert.equal(layoutOf(connectArrow(d, 'a', 'b')).arrows[0].y, 1);
});

test('arrow-slot collisions cover the full source even when the underline was placed first', () => {
  let d = initial();
  d.slots = setSlotMarker(setSlotMarker(d.slots, 'g'), 'h');
  const neighbor = group(d, 'neighbor', ['f', 'g']); // [5,7), Y=1
  const source = group(d, 'source', ['g', 'h'], 'basic'); // [6,8), Y=0
  d = connectArrow(d, source, 'h');
  const l = layoutOf(d);
  assert.equal(isSavedState(d), true);
  assert.equal(l.slotY.get(source), 0);
  assert.equal(l.slotY.get(neighbor), 1);
  assert.deepEqual(l.arrows[0].interval, interval(7, 7.5, false, true));
  assert.deepEqual(l.arrows[0].slotInterval, interval(6, 8, true, false));
  assert.equal(l.arrows[0].y, 2); // midpoint span alone would wrongly fit at Y=1
});

test('a later underline checks the already placed arrow using its full endpoint envelope', () => {
  let d = initial();
  d.slots = setSlotMarker(setSlotMarker(d.slots, 'a'), 'b');
  const source = group(d, 'source', ['a', 'b'], 'basic');
  const neighbor = group(d, 'neighbor', ['a', 'h']); // [0,1) and [7,8)
  d = connectArrow(d, source, 'b');
  const l = layoutOf(d);
  assert.equal(isSavedState(d), true);
  assert.deepEqual(l.arrows[0].interval, interval(1, 1.5, false, true));
  assert.deepEqual(l.arrows[0].slotInterval, interval(0, 2, true, false));
  assert.equal(l.arrows[0].y, 1); // short midpoint span still determines priority
  assert.equal(l.slotY.get(neighbor), 2); // [0,1) overlaps the enlarged footprint
  const removed = layoutOf(deleteArrow(d, source));
  assert.equal(removed.slotY.get(neighbor), 1);
});

test('arrow-arrow checks retain midpoint spans even when full slot envelopes overlap', () => {
  const d = connectArrow(connectArrow(initial(), 'a', 'b'), 'b', 'c');
  const l = layoutOf(d);
  assert.deepEqual(l.arrows.map(({ y }) => y), [1, 1]);
  assert.equal(intervalsIntersect(l.arrows[0].slotInterval, l.arrows[1].slotInterval), true);
  assert.equal(intervalsIntersect(l.arrows[0].interval, l.arrows[1].interval), false);
});

test('shared arrow envelopes contain every region of every source and target slot', () => {
  let d = initial();
  const source = group(d, 'source', ['a', 'f']);
  const target = group(d, 'target', ['c', 'd']);
  d = connectArrow(connectArrow(d, source, target), 'h', target);
  const arrow = layoutOf(d).arrows[0];
  assert.deepEqual(arrow.slotInterval, interval(0, 8, true, false));
  assert.deepEqual(arrow.interval, interval(3, 7.5, true, false));
  const single = layoutOf(deleteArrow(d, 'h')).arrows[0];
  assert.deepEqual(single.slotInterval, interval(0, 6, true, false));
  assert.deepEqual(single.interval, interval(3, 5.5, true, false));
  assert.equal(intervalsIntersect(single.slotInterval, interval(6, 8, true, false)), false);
  const reverse = layoutOf(connectArrow({ ...d, arrows: [] }, target, source)).arrows[0];
  assert.deepEqual(reverse.slotInterval, single.slotInterval);
});

test('arrow-slot envelopes follow integer T renumbering and are derived, not saved', () => {
  let d = splitSlot(initial(), 'b');
  d = connectArrow(d, d.splits[0].leftSlotId, 'h');
  const l = layoutOf(d);
  assert.deepEqual(l.arrows[0].slotInterval, interval(1, 9, true, false));
  assert.deepEqual(l.arrows[0].interval, interval(1.5, 8.5, false, true));
  assert.equal(JSON.stringify(d).includes('slotInterval'), false);
  assert.deepEqual(layoutOf(JSON.parse(JSON.stringify(d))).arrows, l.arrows);
});

test('arrow-arrow contact, saved order ties, and deletion reflow are deterministic', () => {
  let d = connectArrow(connectArrow(initial(), 'a', 'c'), 'd', 'b');
  assert.deepEqual(layoutOf(d).arrows.map((a) => a.y), [1, 2]);
  assert.equal(layoutOf(deleteArrow(d, 'a')).arrows[0].y, 1);
  const original = structuredClone(d);
  assert.deepEqual(layoutOf(d), layoutOf(d)); assert.deepEqual(d, original);
  d = connectArrow(connectArrow(initial(), 'b', 'a'), 'c', 'd');
  assert.deepEqual(layoutOf(d).arrows.map((a) => a.y), [1, 1]);
});

test('noncontiguous underline gaps remain free but arrow horizontal fills its entire interval', () => {
  let d = initial();
  const sparse = group(d, 'sparse', ['a', 'h']);
  const inside = group(d, 'inside', ['d']);
  assert.equal(layoutOf(d).slotY.get(sparse), 1);
  assert.equal(layoutOf(d).slotY.get(inside), 1);
  d = connectArrow(d, 'b', 'g');
  assert.equal(layoutOf(d).arrows[0].y, 2);
});

test('arrow-only rows are skipped by slot navigation, including arrows between group rows', () => {
  let d = initial(); const g = group(d, 'wide', ['a', 'b', 'c']);
  d = connectArrow(d, 'a', 'b'); const l = layoutOf(d);
  assert.deepEqual(moveVertical(l, { x: 0, y: 0 }, 1), { x: 0, y: 2 });
  assert.equal(slotAt(l, 0, 1), undefined);
  assert.deepEqual(moveVertical(l, slotPosition(l, g), -1), { x: 0, y: 0 });
});

test('connect, replace and delete preserve one arrow per source, order and input immutability', () => {
  const d = initial(); const original = structuredClone(d);
  const connected = connectArrow(connectArrow(d, 'a', 'b'), 'c', 'b');
  const replaced = connectArrow(connected, 'a', 'd');
  assert.deepEqual(replaced.arrows, [{ sourceSlotId: 'a', targetSlotId: 'd' }, { sourceSlotId: 'c', targetSlotId: 'b' }]);
  assert.equal(connectArrow(replaced, 'a', 'd'), replaced);
  assert.equal(connectArrow(replaced, 'a', 'a'), replaced);
  assert.equal(connectArrow(replaced, 'missing', 'a'), replaced);
  assert.equal(connectArrow(replaced, 'a', 'missing'), replaced);
  for (const marker of [undefined, 'marker.subject', 'marker.auxiliary', 'marker.adjectiveComplement']) {
    const invalid = { ...d, slots: setSlotMarker(d.slots, 'a', marker) };
    assert.equal(connectArrow(invalid, 'a', 'b'), invalid);
  }
  for (const marker of ['marker.adjective', 'marker.adverb', 'marker.adverbialObjective', 'marker.sentenceAdverb']) {
    assert.equal(connectArrow({ ...d, slots: setSlotMarker(d.slots, 'a', marker) }, 'a', 'b').arrows.length, 1);
  }
  assert.deepEqual(deleteArrow(replaced, 'a').arrows, [replaced.arrows[1]]);
  assert.equal(deleteArrow(replaced, 'h'), replaced); assert.deepEqual(d, original);
});

test('pruning happens at the marker transaction boundary and shares its history', () => {
  const original = connectArrow(initial(), 'a', 'b');
  let edited = { ...original, slots: setSlotMarker(original.slots, 'a', 'marker.subject') };
  assert.equal(edited.arrows.length, 1); // incomplete sad input
  edited = { ...edited, slots: setSlotMarker(edited.slots, 'a', 'marker.sentenceAdverb') };
  assert.equal(pruneArrows(edited), edited);
  const cleared = pruneArrows({ ...edited, slots: setSlotMarker(edited.slots, 'a') });
  const history = new EditHistory();
  const before = { document: edited, cursor: { x: 0, y: 0 } };
  const after = { document: cleared, cursor: { x: 0, y: 0 } };
  history.record(before, after);
  assert.equal(cleared.arrows.length, 0);
  assert.deepEqual(history.undo(), before); assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
});

test('T transfers outgoing arrows left, preserves parent targets and removes disappearing endpoints on undo split', () => {
  const original = connectArrow(connectArrow(initial(), 'a', 'b'), 'c', 'a');
  const split = splitSlot(original, 'a'); const left = split.splits[0].leftSlotId;
  assert.deepEqual(split.arrows, [{ sourceSlotId: left, targetSlotId: 'b' }, { sourceSlotId: 'c', targetSlotId: 'a' }]);
  assert.equal(isSavedState(split), true);
  const next = connectArrow(split, 'd', left);
  const restored = unsplitSlot(next, left);
  assert.deepEqual(restored.arrows, [{ sourceSlotId: 'c', targetSlotId: 'a' }]);
  assert.equal(isSavedState(restored), true);
});

test('structural cascade removes incident arrows only and preserves surviving shared-target sources', () => {
  let d = initial(); const child = group(d, 'child', ['a']); const parent = group(d, 'parent', [child]);
  const independent = group(d, 'independent', ['g']);
  d = connectArrow(connectArrow(connectArrow(connectArrow(d, child, 'f'), 'h', 'f'), 'b', parent), 'c', independent);
  const next = deleteGroup(d, 'child');
  assert.deepEqual(next.arrows, [{ sourceSlotId: 'h', targetSlotId: 'f' }, { sourceSlotId: 'c', targetSlotId: independent }]);
  assert.deepEqual(next.groups.map((g) => g.id), ['independent']);
  assert.equal(isSavedState(next), true);
});

test('v5 validates arrows and round-trips while v4 and malformed arrow states are rejected', () => {
  const d = connectArrow(initial(), 'a', 'b');
  assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(d))), d);
  for (const mutate of [
    (s) => { s.version = 4; }, (s) => { delete s.arrows; }, (s) => { s.arrows = null; },
    (s) => { s.arrows.push({ ...s.arrows[0] }); }, (s) => { s.arrows[0] = null; },
    (s) => { s.arrows[0].sourceSlotId = 'missing'; }, (s) => { s.arrows[0].targetSlotId = 'missing'; },
    (s) => { s.arrows[0].targetSlotId = 'a'; }, (s) => { s.slots[0].marker = 'marker.auxiliary'; },
  ]) { const invalid = structuredClone(d); mutate(invalid); assert.equal(isSavedState(invalid), false); }
});

test('rendering handles shared targets, both directions and empty versus marked target edges', () => {
  let d = connectArrow(connectArrow(initial(), 'a', 'd'), 'h', 'd');
  const l = layoutOf(d); const view = computeRenderLayout(d.tokens, d.groups, d.splits, Array(8).fill(50), 1000);
  const [segment] = renderArrows(l, view.regionsBySlot, d.slots);
  assert.equal(segment.left, 25); assert.equal(segment.right, 445);
  assert.equal(segment.stems.length, 3); assert.equal(segment.stems.filter((s) => s.target).length, 1);
  assert.equal(segment.stems.find((s) => s.target).y, 28);
  const [empty] = renderArrows(l, view.regionsBySlot, setSlotMarker(d.slots, 'd'));
  assert.equal(empty.stems.find((s) => s.target).y, -8);
  assert.deepEqual(empty.stems.filter((s) => !s.target).map((s) => s.y), [28, 28]);
});

test('wrapping produces matching connection dots, one target stem, and invariant logical placement', () => {
  const d = connectArrow(initial(), 'h', 'a'); const l = layoutOf(d);
  for (const width of [1000, 170, 50]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, Array(8).fill(50), width);
    const segments = renderArrows(l, view.regionsBySlot, d.slots);
    assert.equal(segments.length, view.rows.length);
    assert.equal(segments.flatMap((s) => s.stems).length, 2);
    for (let i = 1; i < segments.length; i++) assert.equal(segments[i - 1].endConnection, segments[i].startConnection);
    assert.deepEqual(layoutOf(d), l);
    assert.equal(segments.every((s) => s.logicalY === l.arrows[0].y && s.y === s.logicalY * 38 + 14), true);
  }
});

test('noncontiguous and T endpoints attach to the final displayed region after reflow', () => {
  let d = initial(); const sparse = group(d, 'sparse', ['a', 'f']);
  d = splitSlot(d, 'b'); const left = d.splits[0].leftSlotId;
  d = connectArrow(d, left, sparse);
  for (const width of [1000, 110, 50]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, Array(8).fill(50), width);
    const stems = renderArrows(layoutOf(d), view.regionsBySlot, d.slots).flatMap((s) => s.stems);
    for (const id of [left, sparse]) {
      const last = view.regionsBySlot.get(id).at(-1), stem = stems.find((s) => s.slotId === id);
      assert.equal(stem.row, last.row); assert.equal(stem.x, (last.left + last.right) / 2);
    }
  }
});

test('reclassification with arrows relocates cursor and selection anchor by slot ID', () => {
  let d = initial(); d.slots = d.slots.map(({ id }) => ({ id }));
  const child = group(d, 'child', ['a', 'b']); const parent = group(d, 'parent', [child]);
  d = connectArrow(d, child, 'e');
  const cursor = slotPosition(layoutOf(d), parent);
  const next = settleBasicGroups(d, cursor, cursor);
  const l = layoutOf(next.document);
  assert.equal(slotAt(l, next.cursor.x, next.cursor.y), parent);
  assert.equal(slotAt(l, next.anchor.x, next.anchor.y), parent);
  assert.equal(next.document.groups[0].kind, 'basic');
  assert.equal(l.arrows.length, 1);
});

const arrowBasicDocument = () => {
  let d = initial();
  d.slots = d.slots.map(({ id }) => id === 'a' ? { id, marker: 'marker.adverb' } : { id });
  const basic = group(d, 'basic', ['c', 'd'], 'basic');
  const parent = group(d, 'parent', [basic, 'e']);
  d = connectArrow(d, 'a', 'h');
  return { d, basic, parent };
};

test('arrow endpoints can enter a basic at the same X, with every exit route settling and retaining IDs', () => {
  const { d, basic, parent } = arrowBasicDocument();
  const source = d.arrows[0].sourceSlotId;
  const opened = enterBasicGroup(d, { x: 3, y: layoutOf(d).slotY.get(basic) });
  const l = layoutOf(opened.document);
  assert.equal(opened.cursor.x, 3);
  assert.equal(slotAt(l, opened.cursor.x, opened.cursor.y), 'd');
  assert.equal(opened.document.groups[0].kind, 'composite');
  assert.deepEqual(opened.document.arrows, d.arrows);
  assert.equal(settleBasicGroups(opened.document, moveLeft(l, opened.cursor)).document, opened.document);
  assert.equal(settleBasicGroups(opened.document, moveVertical(l, opened.cursor, -1)).document, opened.document);
  const destinations = [
    moveLeft(l, { x: 2, y: 0 }), moveRight(l, opened.cursor),
    moveVertical(l, opened.cursor, 1),
    moveToRowEdge(l, opened.cursor, 'start'), moveToRowEdge(l, opened.cursor, 'end'),
    slotPosition(l, parent), slotPosition(l, basic),
  ];
  for (const destination of destinations) {
    const target = slotAt(l, destination.x, destination.y);
    const settled = settleBasicGroups(opened.document, destination);
    assert.equal(settled.document.groups[0].kind, 'basic');
    assert.equal(slotAt(layoutOf(settled.document), settled.cursor.x, settled.cursor.y), target);
    assert.deepEqual(settled.document.arrows, d.arrows);
    assert.equal(settled.document.arrows[0].sourceSlotId, source);
    assert.equal(isSavedState(settled.document), true);
  }
});

test('connecting and retargeting to an interior token preserves the endpoint after closing and reload', () => {
  const { d, basic } = arrowBasicDocument();
  for (const original of [d, { ...d, arrows: [] }]) {
    const opened = enterBasicGroup(original, slotPosition(layoutOf(original), basic));
    const target = slotAt(layoutOf(opened.document), opened.cursor.x, opened.cursor.y);
    const connected = connectArrow(opened.document, 'a', target);
    assert.deepEqual(connected.arrows, [{ sourceSlotId: 'a', targetSlotId: 'c' }]);
    assert.equal(settleBasicGroups(connected, opened.cursor).document.groups[0].kind, 'composite');
    const closed = settleBasicGroups(connected, slotPosition(layoutOf(connected), basic));
    assert.equal(closed.document.groups[0].kind, 'basic');
    assert.deepEqual(closed.document.arrows, connected.arrows);
    assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(closed.document))).arrows, connected.arrows);
    assert.equal(isSavedState(closed.document), true);
    const history = new EditHistory();
    const before = { document: original, cursor: slotPosition(layoutOf(original), basic) };
    history.record(before, opened);
    history.record(opened, { document: connected, cursor: opened.cursor });
    history.record({ document: connected, cursor: opened.cursor }, closed);
    assert.deepEqual(history.undo().document, connected);
    assert.deepEqual(history.undo().document, opened.document);
    assert.deepEqual(history.undo(), before);
    assert.deepEqual(history.redo().document, opened.document);
    assert.deepEqual(history.redo().document, connected);
    assert.deepEqual(history.redo().document, closed.document);
  }
});

test('arrow navigation retains split restrictions and treats a sparse underline gap as outside', () => {
  const { d, basic } = arrowBasicDocument();
  for (const kind of ['t', 'd']) {
    const split = splitSlot(d, basic, kind);
    for (const id of [split.splits[0].leftSlotId, split.splits[0].rightSlotId]) {
      const cursor = slotPosition(layoutOf(split), id);
      const result = enterBasicGroup(split, cursor);
      assert.equal(result.document, split);
      assert.deepEqual(result.cursor, cursor);
    }
  }
  const sparse = { ...d, groups: d.groups.map(g => g.slotId === basic ? { ...g, slots: ['c', 'e'] } : g) };
  const opened = enterBasicGroup(sparse, slotPosition(layoutOf(sparse), basic));
  const closed = settleBasicGroups(opened.document, { x: 3, y: 0 });
  assert.equal(closed.document.groups[0].kind, 'basic');
  assert.deepEqual(closed.document.arrows, d.arrows);
});

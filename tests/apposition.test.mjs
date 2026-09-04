import assert from 'node:assert/strict';
import test from 'node:test';
import { isSavedState } from '../src/model.ts';
import { connectArrow, connectApposition, deleteArrow, pruneArrows } from '../src/arrowEditing.ts';
import { computeLayout, slotPosition, relocateCursor } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { setSlotMarker } from '../src/markers.ts';
import { splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { EditHistory } from '../src/history.ts';

const initial = () => ({ version: 6, groups: [], splits: [], arrows: [], translation: '',
  tokens: [...'abcdefgh'].map((id) => ({ id: `token:${id}`, text: id, slotId: id })),
  slots: [...'abcdefgh'].map((id) => ({ id, marker: 'marker.noun' })),
});
const mark = (d, id, marker) => ({ ...d, slots: setSlotMarker(d.slots, id, marker) });
const edge = (sourceSlotId, targetSlotId) => ({ kind: 'apposition', sourceSlotId, targetSlotId });
const layoutOf = (d) => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const render = (d, width = 1000) => {
  const layout = layoutOf(d);
  const view = computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 50), width);
  return { layout, view, segments: renderArrows(layout, view.regionsBySlot, d.slots) };
};

test('apposition starts only at exact noun markers and accepts those markers or empty at the other end', () => {
  for (const source of ['marker.noun', 'marker.subject', 'marker.object', 'marker.nounComplement']) {
    for (const target of ['marker.noun', 'marker.subject', 'marker.object', 'marker.nounComplement', undefined]) {
      const d = mark(mark(initial(), 'a', source), 'b', target);
      const next = connectApposition(d, 'a', 'b');
      assert.deepEqual(next.arrows, [edge('a', 'b')]);
      assert.equal(isSavedState(next), true);
      assert.deepEqual(d.arrows, []);
    }
  }
  for (const marker of [undefined, 'marker.adjective', 'marker.adverb', 'marker.adverbialObjective', 'marker.sentenceAdverb', 'marker.introductoryAdverb', 'marker.adjectiveComplement', 'marker.object1', 'marker.object2', 'marker.subjectPrime', 'marker.verb']) {
    const d = mark(initial(), 'a', marker);
    assert.equal(connectApposition(d, 'a', 'b'), d);
    if (marker !== undefined) assert.equal(connectApposition(d, 'b', 'a'), d);
  }
  const d = initial();
  for (const [a, b] of [['a', 'a'], ['missing', 'a'], ['a', 'missing']]) {
    assert.equal(connectApposition(d, a, b), d);
  }
});

test('replacement from either end removes both prior partners atomically, preserving unrelated directed arrows', () => {
  let d = connectApposition(connectApposition(initial(), 'a', 'b'), 'c', 'd');
  d = connectArrow(mark(d, 'e', 'marker.adverb'), 'e', 'b');
  const original = structuredClone(d);
  assert.equal(connectApposition(d, 'b', 'a'), d);
  const next = connectApposition(d, 'b', 'd');
  assert.deepEqual(next.arrows, [edge('b', 'd'), { sourceSlotId: 'e', targetSlotId: 'b' }]);
  assert.equal(isSavedState(next), true);
  assert.deepEqual(d, original);
  for (const id of ['b', 'd']) assert.deepEqual(deleteArrow(next, id).arrows, [next.arrows[1]]);
  const empty = mark(next, 'd');
  assert.equal(connectApposition(empty, 'd', 'f'), empty);
  assert.deepEqual(deleteArrow(empty, 'd').arrows, [next.arrows[1]]);
  assert.deepEqual(connectApposition(d, 'f', 'b').arrows, [edge('c', 'd'), d.arrows[2], edge('f', 'b')]);
});

test('validation is symmetric, permits empty pairs, and rejects unknown kinds and duplicate participation', () => {
  const d = connectApposition(initial(), 'a', 'b');
  const empty = mark(mark(d, 'a'), 'b');
  assert.equal(isSavedState(empty), true);
  for (const extra of [edge('c', 'a'), edge('b', 'c'), edge('b', 'a')]) {
    assert.equal(isSavedState({ ...d, arrows: [...d.arrows, extra] }), false);
  }
  for (const arrow of [edge('a', 'a'), edge('a', 'missing'), { ...edge('a', 'b'), kind: 'unknown' }]) {
    assert.equal(isSavedState({ ...d, arrows: [arrow] }), false);
  }
  for (const id of ['a', 'b']) assert.equal(isSavedState(mark(d, id, 'marker.adverb')), false);
  const directed = connectArrow(mark(initial(), 'c', 'marker.adverb'), 'c', 'b');
  assert.equal(isSavedState(directed), true);
  assert.equal(isSavedState({ ...d, arrows: [{ sourceSlotId: 'a', targetSlotId: 'b' }] }), false);
});

test('marker pruning preserves empty endpoints but removes disallowed markers at either end at commit', () => {
  const d = connectApposition(initial(), 'a', 'b');
  assert.equal(pruneArrows(d), d);
  const empty = mark(mark(d, 'a'), 'b');
  assert.equal(pruneArrows(empty), empty);
  for (const id of ['a', 'b']) {
    const pending = mark(d, id, 'marker.sentenceAdverb');
    assert.equal(pending.arrows.length, 1);
    assert.deepEqual(pruneArrows(pending).arrows, []);
  }
  assert.deepEqual(pruneArrows({ ...d, slots: d.slots.filter((s) => s.id !== 'b') }).arrows, []);
});

test('both T and D move either apposition endpoint left and unsplit removes that connection', () => {
  for (const kind of ['t', 'd']) for (const id of ['a', 'b']) {
    let d = connectApposition(initial(), 'a', 'b');
    d = connectArrow(mark(d, 'c', 'marker.adverb'), 'c', id);
    const next = splitSlot(d, id, kind);
    const left = next.splits[0].leftSlotId;
    assert.deepEqual(next.arrows, [edge(id === 'a' ? left : 'a', id === 'b' ? left : 'b'), d.arrows[1]]);
    assert.equal(isSavedState(next), true);
    assert.deepEqual(unsplitSlot(next, left).arrows, [d.arrows[1]]);
  }
});

test('deleting a group removes incident apposition without cascading into its other endpoint', () => {
  const d = initial();
  d.groups.push({ id: 'g', slotId: 'group', kind: 'composite', slots: ['c'] });
  d.slots.push({ id: 'group', marker: 'marker.noun' });
  for (const [a, b] of [['group', 'a'], ['a', 'group']]) {
    const next = deleteGroup(connectApposition(d, a, b), 'g');
    assert.deepEqual(next.arrows, []);
    assert.ok(next.slots.some((s) => s.id === 'a'));
    assert.equal(isSavedState(next), true);
  }
});

test('replacement and deletion each form one undo step and round-trip through v5/v6', () => {
  const d = connectApposition(connectApposition(initial(), 'a', 'b'), 'c', 'd');
  const next = connectApposition(d, 'b', 'c');
  const history = new EditHistory();
  const snapshot = (document, x) => ({ document, cursor: { x, y: 0 } });
  const before = snapshot(d, 1), after = snapshot(next, 2);
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  const deleted = snapshot(deleteArrow(next, 'c'), 2);
  history.record(after, deleted);
  assert.deepEqual(history.undo(), after);
  assert.deepEqual(history.redo(), deleted);
  const json = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(readEntryDocument(json(next)).entries[0].document, next);
  const wrapped = { version: 7, entries: [{ id: 'entry', document: next }] };
  assert.deepEqual(readEntryDocument(json(wrapped)), wrapped);
  const crossEntry = json(wrapped);
  crossEntry.entries[0].document.arrows[0].targetSlotId = 'other-entry-slot';
  assert.equal(readEntryDocument(crossEntry), undefined);
});

test('apposition and directed arrows sharing a target remain separate; closed endpoint contact collides', () => {
  let d = connectApposition(initial(), 'a', 'b');
  d = connectArrow(mark(d, 'c', 'marker.adverb'), 'c', 'b');
  d = connectArrow(mark(d, 'd', 'marker.adjective'), 'd', 'b');
  const l = layoutOf(d);
  assert.equal(l.arrows.length, 2);
  assert.equal(new Set(l.arrows.map((a) => a.key)).size, 2);
  assert.deepEqual(l.arrows[0].interval, { start: 0.5, end: 1.5, startClosed: true, endClosed: true });
  assert.deepEqual(l.arrows.map((a) => a.y), [1, 2]);
  assert.deepEqual(l.arrows[1].sourceSlotIds, ['c', 'd']);
  assert.equal(l.arrows[0].kind, 'apposition');
  assert.equal(l.arrows[1].kind, undefined);
});

test('apposition follows endpoint levels and full slot envelopes, and preserves cursor across reflow', () => {
  const d = initial();
  d.groups.push({ id: 'source', slotId: 'source', slots: ['g', 'h'], kind: 'basic' },
    { id: 'neighbor', slotId: 'neighbor', slots: ['f', 'g'], kind: 'composite' });
  d.slots = [...setSlotMarker(setSlotMarker(d.slots, 'g'), 'h'), { id: 'source', marker: 'marker.noun' }, { id: 'neighbor' }];
  const next = connectApposition(d, 'source', 'h');
  const l = layoutOf(next);
  assert.equal(l.slotY.get('source'), 0);
  assert.equal(l.slotY.get('neighbor'), 2);
  assert.equal(l.arrows[0].y, 1);
  const underlineFirst = layoutOf({ ...next, groups: [...next.groups].reverse() });
  assert.equal(underlineFirst.slotY.get('neighbor'), 1);
  assert.equal(underlineFirst.arrows[0].y, 2);
  assert.deepEqual(l.arrows[0].slotInterval, { start: 6, end: 8, startClosed: true, endClosed: false });
  const pos = slotPosition(l, 'neighbor');
  const removed = layoutOf(deleteArrow(next, 'h'));
  assert.deepEqual(relocateCursor(l, removed, pos), slotPosition(removed, 'neighbor'));
  const marked = mark(d, 'neighbor', 'marker.subject');
  const higher = layoutOf(connectApposition(marked, 'source', 'neighbor'));
  assert.ok(higher.arrows[0].y > higher.slotY.get('neighbor'));
});

test('same-X apposition is a closed point and reversing ends preserves geometry', () => {
  const d = initial();
  d.groups.push({ id: 'g', slotId: 'group', slots: ['a'], kind: 'composite' });
  d.slots.push({ id: 'group', marker: 'marker.noun' });
  const forward = render(connectApposition(d, 'a', 'group'));
  const reverse = render(connectApposition(d, 'group', 'a'));
  assert.deepEqual(forward.layout.arrows[0].interval, { start: 0.5, end: 0.5, startClosed: true, endClosed: true });
  assert.equal(forward.layout.arrows[0].y, 2);
  assert.deepEqual(forward.segments[0].label, reverse.segments[0].label);
});

test('rendering uses +3px and symmetric marked/empty edges without arrowheads or outgoing offsets', () => {
  let d = connectApposition(mark(initial(), 'b'), 'a', 'b');
  d = connectArrow(mark(d, 'c', 'marker.adverb'), 'c', 'a');
  const r = render(d);
  const segment = r.segments.find((s) => s.kind === 'apposition');
  assert.equal(segment.y, segment.logicalY * 38 + 3);
  assert.equal(segment.stems.every((s) => !s.target), true);
  for (const stem of segment.stems) {
    const region = r.view.regionsBySlot.get(stem.slotId).at(-1);
    assert.equal(stem.x, (region.left + region.right) / 2);
    assert.equal(stem.y, stem.slotId === 'a' ? 28 : -8);
  }
  assert.deepEqual(segment.label, { text: '同格', x: (segment.left + segment.right) / 2, y: segment.y + 18 });
  const normal = r.segments.find((s) => !s.kind);
  assert.equal(normal.y, normal.logicalY * 38 + 14);
  assert.equal(normal.stems.filter((s) => s.target).length, 1);
});

test('wrapped sparse endpoints attach at final regions and label appears only on the last segment regardless of direction', () => {
  const d = initial();
  d.groups.push({ id: 'sparse', slotId: 'sparse', slots: ['c', 'h'], kind: 'composite' });
  d.slots.push({ id: 'sparse', marker: 'marker.nounComplement' });
  for (const [a, b] of [['a', 'sparse'], ['sparse', 'a']]) {
    const connected = connectApposition(d, a, b);
    const expected = layoutOf(connected);
    for (const width of [1000, 110, 50]) {
      const r = render(connected, width);
      assert.deepEqual(r.layout, expected);
      assert.equal(r.segments.filter((s) => s.label).length, 1);
      const last = r.segments.at(-1);
      assert.deepEqual(last.label, { text: '同格', x: (last.left + last.right) / 2, y: last.y + 18 });
      const region = r.view.regionsBySlot.get('sparse').at(-1);
      assert.equal(last.row, region.row);
      assert.equal(last.stems.find((s) => s.slotId === 'sparse').x, (region.left + region.right) / 2);
      for (let i = 0; i < r.segments.length; i++) {
        const s = r.segments[i];
        assert.equal(s.y, s.logicalY * 38 + 3);
        if (i > 0) assert.equal(r.segments[i - 1].endConnection, s.startConnection);
        if (s.label) assert.ok(s.label.y < s.logicalY * 38 + 28);
      }
    }
  }
});

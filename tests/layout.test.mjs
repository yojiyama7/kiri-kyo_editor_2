import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLayout, groupAt, slotAt, groupForDeletion, groupLineSegments, moveLeft, moveRight, moveToRowEdge, moveVertical,
  normalizeCursorY, regionAt, selectSlotRange, toggleSlotSelection, wrapTokenRows,
} from '../src/layout.ts';

const tokens = ['a', 'b', 'c', 'd'].map((text) => ({ id: `token:${text}`, text, slotId: text }));
// Existing upper-row navigation fixtures explicitly exercise composite groups.
const group = (id, slots, kind = 'composite') => ({ id, slotId: `slot:${id}`, slots, kind });
const basic = (id, slots) => group(id, slots, 'basic');
const ys = (layout) => Object.fromEntries(layout.groups.map(({ group, y }) => [group.id, y]));

test('basic underlines start at zero, collisions advance rows, and composite parents follow children', () => {
  const groups = [basic('A', ['a', 'b']), basic('B', ['b', 'c']), basic('C', ['d']), group('P', ['slot:B', 'slot:C'])];
  const before = structuredClone(groups);
  const layout = computeLayout(tokens, groups);
  assert.deepEqual(ys(layout), { A: 0, B: 1, C: 0, P: 2 });
  assert.equal(layout.slotY.get('a'), 0);
  assert.equal(layout.slotY.get('slot:A'), 0);
  assert.equal(slotAt(layout, 1, 0), 'slot:A');
  assert.equal(slotAt(layout, 1, 1), 'slot:B');
  assert.equal(slotAt(layout, 2, 0), 'c');
  assert.deepEqual(groups, before);
  const afterDeletion = computeLayout(tokens, groups.filter(({ id }) => id !== 'A'));
  assert.deepEqual(ys(afterDeletion), { B: 0, C: 0, P: 1 });
  assert.equal(slotAt(afterDeletion, 1, 0), 'slot:B');
  assert.deepEqual(ys(computeLayout(tokens, [group('P', ['slot:A']), basic('A', ['a']), basic('B', ['a'])])),
    { P: 1, A: 0, B: 2 });
});

test('zero-row resolution hides only actual members and rejects invalid coordinates', () => {
  const layout = computeLayout(tokens, [basic('Sparse', ['a', 'c']), basic('Gap', ['b'])]);
  assert.deepEqual(ys(layout), { Sparse: 0, Gap: 0 });
  assert.deepEqual(tokens.map((_, x) => slotAt(layout, x, 0)), ['slot:Sparse', 'slot:Gap', 'slot:Sparse', 'd']);
  assert.equal(slotAt(layout, 0, 1), undefined);
  assert.equal(slotAt(layout, 1, 1), undefined);
  assert.equal(slotAt(layout, 3, 1), undefined);
  assert.equal(slotAt(layout, -1, 0), undefined);
  assert.equal(slotAt(layout, 4, 0), undefined);
  assert.equal(slotAt(computeLayout([], []), 0, 0), undefined);
});

test('zero-row horizontal moves use the entire basic region and preserve boundaries', () => {
  const layout = computeLayout(tokens, [basic('A', ['b', 'c'])]);
  for (const x of [1, 2]) {
    assert.deepEqual(moveLeft(layout, { x, y: 0 }), { x: 0, y: 0 });
    assert.deepEqual(moveRight(layout, { x, y: 0 }), { x: 3, y: 0 });
  }
  assert.equal(slotAt(layout, moveRight(layout, { x: 0, y: 0 }).x, 0), 'slot:A');
  const sparse = computeLayout(tokens, [basic('Sparse', ['a', 'c'])]);
  assert.deepEqual(moveRight(sparse, { x: 0, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(moveLeft(sparse, { x: 2, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 0 }, 'start'), { x: 0, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 0 }, 'end'), { x: 3, y: 0 });
});

test('vertical movement reaches the basic group at zero without a hidden token step', () => {
  const layout = computeLayout(tokens, [basic('A', ['b', 'c']), group('P', ['slot:A'])]);
  const origin = { x: 2, y: 0 };
  assert.deepEqual(moveVertical(layout, origin, 1), { x: 2, y: 1 });
  assert.deepEqual(moveVertical(layout, { x: 2, y: 1 }, -1), origin);
  assert.deepEqual(moveVertical(layout, origin, -1), origin);
  assert.equal(slotAt(layout, 2, normalizeCursorY(layout, 2, 9)), 'slot:P');
  const basicOnly = computeLayout(tokens, [basic('A', ['b', 'c'])]);
  assert.equal(slotAt(basicOnly, 2, normalizeCursorY(basicOnly, 2, 9)), 'slot:A');
});

test('zero-row range and individual selection reference groups and keep gaps selectable', () => {
  const layout = computeLayout(tokens, [basic('A', ['a', 'b'])]);
  assert.deepEqual(selectSlotRange(layout, { x: 0, y: 0 }, { x: 3, y: 0 }), ['slot:A', 'c', 'd']);
  assert.deepEqual(selectSlotRange(layout, { x: 1, y: 0 }, { x: 0, y: 0 }), ['slot:A']);
  const selected = toggleSlotSelection(layout, [], { x: 0, y: 0 });
  assert.deepEqual(selected, ['slot:A']);
  assert.deepEqual(toggleSlotSelection(layout, selected, { x: 1, y: 0 }), []);
  assert.deepEqual(toggleSlotSelection(layout, selected, { x: 2, y: 0 }), ['slot:A', 'c']);
  const sparse = computeLayout(tokens, [basic('Sparse', ['a', 'c'])]);
  assert.deepEqual(selectSlotRange(sparse, { x: 0, y: 0 }, { x: 2, y: 0 }), ['slot:Sparse', 'b']);
  assert.deepEqual(toggleSlotSelection(sparse, [], { x: 1, y: 0 }), ['b']);
});

test('deletion prefers the current zero-row group over its newer composite parent', () => {
  const layout = computeLayout(tokens, [basic('A', ['a', 'b']), group('P', ['slot:A', 'c'])]);
  assert.equal(groupForDeletion(layout, { x: 0, y: 0 })?.id, 'A');
  assert.equal(groupForDeletion(layout, { x: 0, y: 1 })?.id, 'P');
  assert.equal(groupForDeletion(layout, { x: 2, y: 0 })?.id, 'P');
  assert.equal(groupForDeletion(layout, { x: 3, y: 0 }), undefined);
  assert.equal(groupForDeletion(layout, { x: 0, y: 2 }), undefined);
});

test('wrapping fits measured token widths including gaps and reflows on resize', () => {
  const widths = [30, 60, 40, 50];
  assert.deepEqual(wrapTokenRows(widths, 100), [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  assert.deepEqual(wrapTokenRows(widths, 210), [{ start: 0, end: 3 }]);
  assert.deepEqual(wrapTokenRows([300, 30], 100), [{ start: 0, end: 0 }, { start: 1, end: 1 }]);
  assert.deepEqual(wrapTokenRows([], 100), []);
});

test('underlines crossing multiple rows connect every split, including nested groups', () => {
  const layout = computeLayout(tokens, [group('Child', ['a', 'b', 'c', 'd']), group('Parent', ['slot:Child'])]);
  const starts = new Set([0, 1, 3]);
  const colors = [];
  for (const placement of layout.groups) {
    const segments = groupLineSegments(layout, placement, starts);
    assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[0, 0], [1, 2], [3, 3]]);
    assert.equal(segments[0].startConnection, undefined);
    assert.equal(segments[2].endConnection, undefined);
    for (let x = 1; x < segments.length; x += 1) {
      assert.ok(segments[x].startConnection);
      assert.equal(segments[x - 1].endConnection, segments[x].startConnection);
      colors.push(segments[x].startConnection);
    }
    assert.deepEqual(groupLineSegments(layout, placement), [{ start: 0, end: 3 }]);
  }
  assert.equal(new Set(colors).size, colors.length);
});

test('row breaks and membership gaps share markers without filling skipped tokens', () => {
  const layout = computeLayout(tokens, [group('Sparse', ['a', 'c', 'd'])]);
  const segments = groupLineSegments(layout, layout.groups[0], new Set([0, 1, 3]));
  assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[0, 0], [2, 2], [3, 3]]);
  assert.equal(segments[0].endConnection, segments[1].startConnection);
  assert.equal(segments[1].endConnection, segments[2].startConnection);
  assert.notEqual(segments[0].endConnection, segments[1].endConnection);
});

test('individual selection keeps only toggled slots, sorts them, and supports removing all', () => {
  const layout = computeLayout(tokens, []);
  let selected = toggleSlotSelection(layout, [], { x: 3, y: 0 });
  selected = toggleSlotSelection(layout, selected, { x: 0, y: 0 });
  assert.deepEqual(selected, ['a', 'd']);
  selected = toggleSlotSelection(layout, selected, { x: 3, y: 0 });
  assert.deepEqual(selected, ['a']);
  assert.deepEqual(toggleSlotSelection(layout, selected, { x: 0, y: 0 }), []);
  assert.deepEqual(toggleSlotSelection(computeLayout([], []), [], { x: 0, y: 0 }), []);
});

test('individual selection mixes recursive group slots with bases without filling gaps', () => {
  const child = group('Child', ['a', 'c']);
  const layout = computeLayout(tokens, [child]);
  const selected = toggleSlotSelection(layout, ['d'], { x: 0, y: 1 });
  assert.deepEqual(selected, ['slot:Child', 'd']);
  const nested = computeLayout(tokens, [child, group('Parent', selected)]);
  assert.deepEqual([...nested.groups[1].baseSlotIds], ['a', 'c', 'd']);
  assert.deepEqual(toggleSlotSelection(layout, selected, { x: 2, y: 1 }), ['d']);
});

test('continuous underlines stay solid and need no connection dots', () => {
  const layout = computeLayout(tokens, [group('A', ['a', 'b', 'c'])]);
  assert.deepEqual(groupLineSegments(layout, layout.groups[0]), [{ start: 0, end: 2 }]);
});

test('each gap has a matching endpoint color, distinct from other gaps and groups', () => {
  const manyTokens = ['a', 'b', 'c', 'd', 'e'].map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const layout = computeLayout(manyTokens, [group('A', ['a', 'c', 'e']), group('B', ['slot:A'])]);
  const first = groupLineSegments(layout, layout.groups[0]);
  assert.deepEqual(first.map(({ start, end }) => [start, end]), [[0, 0], [2, 2], [4, 4]]);
  assert.equal(first[0].startConnection, undefined);
  assert.equal(first[2].endConnection, undefined);
  assert.ok(first[0].endConnection);
  assert.equal(first[0].endConnection, first[1].startConnection);
  assert.equal(first[1].endConnection, first[2].startConnection);
  assert.notEqual(first[0].endConnection, first[1].endConnection);
  const second = groupLineSegments(layout, layout.groups[1]);
  assert.equal(second[0].endConnection, second[1].startConnection);
  assert.equal(new Set([...first, ...second].flatMap((part) => part.endConnection ? [part.endConnection] : [])).size, 4);
  assert.deepEqual(groupLineSegments(layout, layout.groups[0]), first);
});

test('visual selection on a group creates a parent referencing that group slot', () => {
  const child = group('Child', ['a', 'b']);
  const layout = computeLayout(tokens, [child]);
  const selected = selectSlotRange(layout, { x: 1, y: 1 }, { x: 1, y: 1 });
  assert.deepEqual(selected, ['slot:Child']);
  const nested = computeLayout(tokens, [child, group('Parent', selected)]);
  assert.equal(nested.groups[1].y, 2);
  assert.deepEqual([...nested.groups[1].baseSlotIds], ['a', 'b']);
});

test('visual selection expands and shrinks across group slots in either direction', () => {
  const layout = computeLayout(tokens, [group('L', ['a', 'b']), group('R', ['c', 'd'])]);
  const left = { x: 1, y: 1 };
  // Adjacent half-open underlines share the same row.
  const right = moveRight(layout, left);
  assert.deepEqual(selectSlotRange(layout, left, right), ['slot:L', 'slot:R']);
  assert.deepEqual(selectSlotRange(layout, right, left), ['slot:L', 'slot:R']);
  assert.deepEqual(selectSlotRange(layout, left, moveLeft(layout, right)), ['slot:L']);
});

test('visual selection retains group references when movement falls back to a base slot', () => {
  const layout = computeLayout(tokens, [group('L', ['a', 'b'])]);
  const anchor = { x: 0, y: 1 };
  const cursor = moveRight(layout, anchor);
  assert.deepEqual(cursor, { x: 2, y: 0 });
  assert.deepEqual(selectSlotRange(layout, anchor, cursor), ['slot:L', 'c']);
  assert.deepEqual(selectSlotRange(layout, anchor, { x: 3, y: 0 }), ['slot:L', 'c', 'd']);
});

test('visual selection includes intermediate groups once and preserves base-row ranges', () => {
  const layout = computeLayout(tokens, [group('L', ['a']), group('M', ['b', 'c']), group('R', ['d'])]);
  assert.deepEqual(selectSlotRange(layout, { x: 0, y: 1 }, { x: 3, y: 1 }), ['slot:L', 'slot:M', 'slot:R']);
  assert.deepEqual(selectSlotRange(layout, { x: 0, y: 1 }, { x: 2, y: 1 }), ['slot:L', 'slot:M']);
  assert.deepEqual(selectSlotRange(layout, { x: 3, y: 0 }, { x: 0, y: 0 }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selectSlotRange(computeLayout([], []), { x: 0, y: 0 }, { x: 0, y: 0 }), []);
});

test('half-open endpoint contact shares a row while partial overlap advances it', () => {
  const layout = computeLayout(tokens, [group('A', ['a', 'b']), group('B', ['b', 'c']), group('C', ['c', 'd'])]);
  assert.deepEqual(ys(layout), { A: 1, B: 2, C: 1 });
});

test('identical selections get separate rows, regardless of range containment', () => {
  const layout = computeLayout(tokens, [group('A', ['a', 'b']), group('B', ['a', 'b']), group('C', ['a', 'b'])]);
  assert.deepEqual(ys(layout), { A: 1, B: 2, C: 3 });
});

test('recursive expansion catches collisions without shared direct references', () => {
  const layout = computeLayout(tokens, [
    group('A', ['a', 'b']), group('B', ['c', 'd']),
    group('C', ['slot:A']), group('D', ['a', 'b', 'slot:B']),
  ]);
  assert.deepEqual(ys(layout), { A: 1, B: 1, C: 2, D: 3 });
  assert.deepEqual([...layout.groups[2].baseSlotIds], ['a', 'b']);
  assert.deepEqual([...layout.groups[3].baseSlotIds], ['a', 'b', 'c', 'd']);
  assert.equal(layout.slotY.get('slot:D'), 3);
  assert.equal(layout.groups[3].start, 0);
  assert.equal(layout.groups[3].end, 3);
});

test('ready groups follow saved order, including newly ready parents', () => {
  const layout = computeLayout(tokens, [group('P', ['slot:A']), group('A', ['a']), group('Q', ['a'])]);
  assert.deepEqual(ys(layout), { P: 2, A: 1, Q: 3 });
  assert.equal(layout.slotY.get('a'), 0);
});

test('dependencies wait for the greatest direct slot Y, including displaced children', () => {
  const layout = computeLayout(tokens, [
    group('A', ['a']), group('B', ['a']), group('C', ['b']),
    group('P', ['slot:B', 'slot:C']), group('G', ['slot:P']),
  ]);
  assert.deepEqual(ys(layout), { A: 1, B: 2, C: 1, P: 3, G: 4 });
});

test('shared and repeated descendants expand to a deduplicated base set', () => {
  const layout = computeLayout(tokens, [
    group('A', ['a', 'b']), group('B', ['slot:A', 'slot:A', 'b', 'c']),
  ]);
  assert.deepEqual([...layout.groups[1].baseSlotIds], ['a', 'b', 'c']);
  assert.equal(layout.groups[1].y, 2);
});

test('a region strictly inside a noncontiguous gap does not collide', () => {
  const many = [...'abcde'].map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const layout = computeLayout(many, [group('A', ['a', 'e']), group('B', ['c'])]);
  assert.deepEqual(ys(layout), { A: 1, B: 1 });
});

test('empty input is valid and unknown, empty, or cyclic dependencies are rejected', () => {
  assert.equal(computeLayout([], []).maxY, 0);
  assert.throws(() => computeLayout(tokens, [group('A', ['missing'])]), /Unknown slot/);
  assert.throws(() => computeLayout(tokens, [group('A', [])]), /no base slots/);
  assert.throws(() => computeLayout(tokens, [group('A', ['slot:A'])]), /Cyclic slot/);
  assert.throws(() => computeLayout(tokens, [group('A', ['slot:B']), group('B', ['slot:A'])]), /Cyclic slot/);
});

test('layout is deterministic and does not change saved input', () => {
  const groups = [group('A', ['a']), group('B', ['slot:A', 'b']), group('C', ['b', 'c'])];
  const before = JSON.stringify({ tokens, groups });
  assert.deepEqual(computeLayout(tokens, groups), computeLayout(tokens, groups));
  assert.equal(JSON.stringify({ tokens, groups }), before);
});

test('j/k round trip preserves X even when the first reachable row is not row 1', () => {
  const layout = computeLayout(tokens, [group('A', ['a']), group('B', ['a', 'b'])]);
  const origin = { x: 1, y: 0 };
  const down = moveVertical(layout, origin, 1);
  assert.deepEqual(down, { x: 1, y: 2 });
  assert.equal(groupAt(layout, down.x, down.y)?.group.id, 'B');
  assert.deepEqual(moveVertical(layout, down, -1), origin);
});

test('every successful vertical move has an inverse; boundaries leave the cursor unchanged', () => {
  const layout = computeLayout(tokens, [group('A', ['a']), group('B', ['a', 'b']), group('C', ['slot:B'])]);
  for (let x = 0; x < tokens.length; x += 1) {
    for (let y = 0; y <= layout.maxY; y += 1) {
      if (y && !groupAt(layout, x, y)) continue;
      for (const direction of [-1, 1]) {
        const origin = { x, y };
        const target = moveVertical(layout, origin, direction);
        assert.equal(target.x, x);
        if (target.y !== y) assert.deepEqual(moveVertical(layout, target, -direction), origin);
      }
    }
  }
  assert.deepEqual(moveVertical(layout, { x: 0, y: 0 }, -1), { x: 0, y: 0 });
  assert.deepEqual(moveVertical(layout, { x: 0, y: 3 }, 1), { x: 0, y: 3 });
  assert.deepEqual(moveVertical(layout, { x: 3, y: 0 }, 1), { x: 3, y: 0 });
});

test('0/$ use the same row placement as hit-testing', () => {
  const layout = computeLayout(tokens, [group('A', ['a', 'b']), group('B', ['c', 'd'])]);
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 0 }, 'start'), { x: 0, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 0 }, 'end'), { x: 3, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 1 }, 'start'), { x: 0, y: 1 });
  assert.deepEqual(moveToRowEdge(layout, { x: 1, y: 1 }, 'end'), { x: 3, y: 1 });
  assert.deepEqual(moveToRowEdge(layout, { x: 2, y: 1 }, 'end'), { x: 3, y: 1 });
  assert.equal(groupAt(layout, 3, 1)?.group.id, 'B');
  assert.deepEqual(moveToRowEdge(computeLayout([], []), { x: 0, y: 0 }, 'end'), { x: 0, y: 0 });
});

test('cursor normalization handles removal and reduced layout height', () => {
  const layout = computeLayout(tokens, [group('A', ['a'])]);
  assert.equal(normalizeCursorY(layout, 0, 4), 1);
  assert.equal(normalizeCursorY(layout, 1, 4), 0);
  assert.equal(normalizeCursorY(computeLayout(tokens, []), 0, 4), 0);
});

test('left movement retains token-row behavior, including the left boundary and empty input', () => {
  const layout = computeLayout(tokens, []);
  assert.deepEqual(moveLeft(layout, { x: 2, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(moveLeft(computeLayout([], []), { x: 0, y: 0 }), { x: 0, y: 0 });
});

test('left movement lands just outside the region, retaining Y only when valid there', () => {
  const layout = computeLayout(tokens, [group('L', ['a']), group('R', ['c', 'd'])]);
  // b is just outside R; the farther same-row group at a is not a destination.
  assert.deepEqual(moveLeft(layout, { x: 3, y: 1 }), { x: 1, y: 0 });
  const multiple = computeLayout(tokens, [group('L', ['a']), group('M', ['b']), group('R', ['c', 'd'])]);
  assert.deepEqual(moveLeft(multiple, { x: 3, y: 1 }), { x: 1, y: 1 });
  assert.deepEqual(moveLeft(multiple, { x: 1, y: 1 }), { x: 0, y: 1 });
});

test('fallback skips the current recursively expanded bases and lands on the external base X', () => {
  const layout = computeLayout(tokens, [
    group('L', ['a', 'b']), group('R', ['c', 'd']), group('Parent', ['slot:R']),
  ]);
  assert.deepEqual(ys(layout), { L: 1, R: 1, Parent: 2 });
  // Both c and d belong to Parent through R; do not land on its child R.
  for (const x of [2, 3]) {
    assert.deepEqual(moveLeft(layout, { x, y: 2 }), { x: 1, y: 1 });
  }
});

test('fallback picks the greatest eligible Y and excludes candidates deeper than the cursor', () => {
  const layout = computeLayout(tokens, [
    group('A', ['a', 'b', 'c']), group('A2', ['slot:A']),
    group('Current', ['c', 'd']), group('A3', ['slot:A2']),
  ]);
  assert.deepEqual(ys(layout), { A: 2, A2: 3, Current: 1, A3: 4 });
  const target = moveLeft(layout, { x: 3, y: 1 });
  assert.deepEqual(target, { x: 1, y: 0 });
  assert.equal(groupAt(layout, target.x, target.y), undefined);
});

test('fallback chooses the nearest external base before considering candidate Y', () => {
  const layout = computeLayout(tokens, [
    group('Left', ['a']), group('Right', ['c', 'd']), group('Current', ['slot:Right']),
  ]);
  // a has a Group at Y=1, but b is the nearest external base and must win.
  assert.deepEqual(moveLeft(layout, { x: 3, y: 2 }), { x: 1, y: 0 });
});

test('fallback uses the base itself if all containing Groups exceed the current Y', () => {
  const layout = computeLayout(tokens, [group('Current', ['c', 'd']), group('Higher', ['a', 'b', 'c'])]);
  assert.deepEqual(ys(layout), { Current: 1, Higher: 2 });
  assert.deepEqual(moveLeft(layout, { x: 3, y: 1 }), { x: 1, y: 0 });
});

test('left movement is unchanged when all bases to the left belong to the current slot', () => {
  const layout = computeLayout(tokens, [group('Child', ['a', 'b']), group('Current', ['slot:Child'])]);
  assert.deepEqual(moveLeft(layout, { x: 1, y: 2 }), { x: 1, y: 2 });
  assert.deepEqual(moveLeft(layout, { x: 0, y: 2 }), { x: 0, y: 2 });
});

test('left movement uses only the current recursive region and can land in an internal gap', () => {
  const layout = computeLayout(tokens, [
    group('Middle', ['c']), group('Sparse', ['b', 'd']), group('Current', ['slot:Sparse']),
  ]);
  assert.deepEqual(moveLeft(layout, { x: 1, y: 2 }), { x: 0, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 3, y: 2 }), { x: 2, y: 1 });
  assert.equal(groupAt(layout, 2, 1)?.group.id, 'Middle');
});

test('right movement handles tokens, the right boundary, and empty input', () => {
  const layout = computeLayout(tokens, []);
  assert.deepEqual(moveRight(layout, { x: 1, y: 0 }), { x: 2, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 3, y: 0 }), { x: 3, y: 0 });
  assert.deepEqual(moveRight(computeLayout([], []), { x: 0, y: 0 }), { x: 0, y: 0 });
});

test('right movement lands just outside the region, retaining Y only when valid there', () => {
  const layout = computeLayout(tokens, [group('L', ['a']), group('R', ['c', 'd'])]);
  assert.deepEqual(moveRight(layout, { x: 0, y: 1 }), { x: 1, y: 0 });
  const multiple = computeLayout(tokens, [group('L', ['a']), group('M', ['b']), group('R', ['c', 'd'])]);
  assert.deepEqual(moveRight(multiple, { x: 0, y: 1 }), { x: 1, y: 1 });
  assert.deepEqual(moveRight(multiple, { x: 1, y: 1 }), { x: 2, y: 1 });
});

test('right fallback skips recursive bases and chooses the greatest Y within the limit', () => {
  const layout = computeLayout(tokens, [
    group('A', ['b', 'c', 'd']), group('A2', ['slot:A']),
    group('Current', ['a', 'b']), group('A3', ['slot:A2']),
  ]);
  assert.deepEqual(ys(layout), { A: 2, A2: 3, Current: 1, A3: 4 });
  assert.deepEqual(moveRight(layout, { x: 0, y: 1 }), { x: 2, y: 0 });
  const recursive = computeLayout(tokens, [
    group('L', ['a', 'b']), group('R', ['c', 'd']), group('Current', ['slot:L']),
  ]);
  assert.deepEqual(moveRight(recursive, { x: 0, y: 2 }), { x: 2, y: 1 });
});

test('right fallback prioritizes the nearest base over a farther group and can land at Y=0', () => {
  const layout = computeLayout(tokens, [
    group('L', ['a', 'b']), group('R', ['d']), group('Current', ['slot:L']),
  ]);
  assert.deepEqual(moveRight(layout, { x: 0, y: 2 }), { x: 2, y: 0 });
});

test('right movement stops when the current slot recursively covers everything to its right', () => {
  const layout = computeLayout(tokens, [group('Child', ['c', 'd']), group('Current', ['slot:Child'])]);
  assert.deepEqual(moveRight(layout, { x: 2, y: 2 }), { x: 2, y: 2 });
  assert.deepEqual(moveRight(layout, { x: 3, y: 2 }), { x: 3, y: 2 });
});

test('both directions use each recursive region independently across gaps and wrapped segments', () => {
  const wideTokens = 'abcdefg'.split('').map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const layout = computeLayout(wideTokens, [
    group('Child', ['b', 'd']), group('Current', ['slot:Child', 'f']),
    group('Left', ['a']), group('Right', ['g']),
  ]);
  const current = layout.groups.find(({ group }) => group.id === 'Current');
  const rows = wrapTokenRows(wideTokens.map(() => 30), 70);
  const segments = groupLineSegments(layout, current, new Set(rows.map(({ start }) => start)));
  assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[1, 1], [3, 3], [5, 5]]);
  for (const x of [1, 3, 5]) {
    assert.deepEqual(moveLeft(layout, { x, y: current.y }), { x: x - 1, y: x === 1 ? 1 : 0 });
    assert.deepEqual(moveRight(layout, { x, y: current.y }), { x: x + 1, y: x === 5 ? 1 : 0 });
  }
});

test('both directions decrement Y across multiple empty levels at a fixed X', () => {
  for (const move of [moveLeft, moveRight]) {
    const orderedTokens = move === moveLeft ? tokens : [...tokens].reverse();
    const layout = computeLayout(orderedTokens, [
      group('Target', ['b']), group('Child', ['c', 'd']),
      group('Parent', ['slot:Child']), group('Current', ['slot:Parent']),
    ]);
    const x = move === moveLeft ? 3 : 0;
    const targetX = move === moveLeft ? 1 : 2;
    assert.deepEqual(move(layout, { x, y: 3 }), { x: targetX, y: 1 });
    const withoutTarget = computeLayout(orderedTokens, layout.groups
      .filter(({ group }) => group.id !== 'Target').map(({ group }) => group));
    assert.deepEqual(move(withoutTarget, { x, y: 3 }), { x: targetX, y: 0 });
  }
});

test('reported sentence visits every region and gap while selection still targets whole slots', () => {
  const sentence = 'She gave the student a careful explanation.'.split(' ')
    .map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const layout = computeLayout(sentence, [
    group('Articles', ['the', 'a']), basic('Sparse', ['gave', 'student', 'careful']),
  ]);
  const expectedSlots = ['She', 'slot:Sparse', 'the', 'slot:Sparse', 'a', 'slot:Sparse', 'explanation.'];
  for (const direction of [-1, 1]) {
    const move = direction === 1 ? moveRight : moveLeft;
    let cursor = { x: direction === 1 ? 0 : 6, y: 0 };
    for (let step = 0; step < 7; step += 1) {
      const x = direction === 1 ? step : 6 - step;
      assert.deepEqual(cursor, { x, y: 0 });
      assert.equal(slotAt(layout, cursor.x, cursor.y), expectedSlots[x]);
      cursor = move(layout, cursor);
    }
    assert.deepEqual(cursor, { x: direction === 1 ? 6 : 0, y: 0 });
  }
  const anchor = { x: 1, y: 0 };
  const secondRegion = moveRight(layout, moveRight(layout, anchor));
  assert.deepEqual(selectSlotRange(layout, anchor, secondRegion), ['slot:Sparse', 'the']);
  const selected = toggleSlotSelection(layout, [], anchor);
  assert.deepEqual(selected, ['slot:Sparse']);
  assert.deepEqual(toggleSlotSelection(layout, selected, secondRegion), []);
  assert.equal(groupForDeletion(layout, secondRegion)?.id, 'Sparse');
  for (const x of [2, 4]) {
    assert.deepEqual(moveVertical(layout, { x, y: 0 }, 1), { x, y: 1 });
    assert.deepEqual(moveVertical(layout, { x, y: 1 }, -1), { x, y: 0 });
  }
  for (const x of [1, 3, 5]) {
    assert.deepEqual(moveVertical(layout, { x, y: 0 }, 1), { x, y: 0 });
  }
});

test('a continuous logical region stays one navigation unit at every display width', () => {
  const layout = computeLayout(tokens, [basic('Wide', ['b', 'c'])]);
  const placement = layout.groups[0];
  for (const width of [30, 70, 200]) {
    const rows = wrapTokenRows(tokens.map(() => 30), width);
    const segments = groupLineSegments(layout, placement, new Set(rows.map(({ start }) => start)));
    assert.equal(segments.length, width === 200 ? 1 : 2);
    for (const x of [1, 2]) {
      assert.deepEqual(regionAt(layout, x, 0), { start: 1, end: 3 });
      assert.deepEqual(moveLeft(layout, { x, y: 0 }), { x: 0, y: 0 });
      assert.deepEqual(moveRight(layout, { x, y: 0 }), { x: 3, y: 0 });
    }
  }
});

test('regions respect renumbered integer T boundaries and stop at the adjacent half slot', () => {
  const splits = [{ slotId: 'b', leftSlotId: 'L', rightSlotId: 'R' }];
  const layout = computeLayout(tokens, [group('Sparse', ['L', 'd'])], splits);
  assert.deepEqual(regionAt(layout, 1, 1), { start: 1, end: 2 });
  assert.equal(regionAt(layout, 2, 1), undefined);
  assert.deepEqual(regionAt(layout, 2, 0), { start: 2, end: 3 });
  assert.deepEqual(moveRight(layout, { x: 1, y: 1 }), { x: 2, y: 0 });
  assert.equal(slotAt(layout, 2, 0), 'R');
  assert.deepEqual(moveLeft(layout, { x: 2, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 2, y: 0 }), { x: 3, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 4, y: 1 }), { x: 3, y: 0 });
  assert.deepEqual(moveVertical(layout, { x: 1, y: 0 }, 1), { x: 1, y: 1 });
  assert.deepEqual(moveVertical(layout, { x: 2, y: 0 }, 1), { x: 2, y: 0 });
});

test('selection preserves group endpoints when edge movement lands in a gap between groups', () => {
  const layout = computeLayout(tokens, [group('Left', ['a']), group('Right', ['c', 'd'])]);
  const anchor = { x: 3, y: 1 };
  const cursor = moveLeft(layout, anchor);
  assert.deepEqual(selectSlotRange(layout, anchor, cursor), ['b', 'slot:Right']);
  const selected = toggleSlotSelection(layout, [], anchor);
  assert.deepEqual(selected, ['slot:Right']);
  assert.deepEqual(toggleSlotSelection(layout, selected, cursor), ['b', 'slot:Right']);
});

test('right and left movement are mirror-symmetric for every valid cursor in representative layouts', () => {
  const fixtures = [
    [],
    [basic('A', ['a', 'b']), basic('B', ['c', 'd']), group('P', ['slot:A', 'slot:B'])],
    [basic('A', ['a', 'c']), basic('B', ['b', 'c'])],
    [group('L', ['a']), group('R', ['c', 'd'])],
    [group('L', ['a', 'b']), group('R', ['c', 'd']), group('Parent', ['slot:R'])],
    [group('A', ['a', 'b', 'c']), group('A2', ['slot:A']), group('Current', ['c', 'd']), group('A3', ['slot:A2'])],
    [group('L', ['a']), group('R', ['c', 'd']), group('Current', ['slot:R'])],
    [group('Current', ['c', 'd']), group('Higher', ['a', 'b', 'c'])],
    [group('Child', ['a', 'b']), group('Current', ['slot:Child'])],
    [group('Middle', ['c']), group('Sparse', ['b', 'd']), group('Current', ['slot:Sparse'])],
  ];
  const reflect = ({ x, y }) => ({ x: tokens.length - 1 - x, y });
  for (const groups of fixtures) {
    const layout = computeLayout(tokens, groups);
    const mirrored = computeLayout([...tokens].reverse(), groups);
    for (let x = 0; x < tokens.length; x += 1) {
      for (let y = 0; y <= layout.maxY; y += 1) {
        if (y && !groupAt(layout, x, y)) continue;
        const cursor = { x, y };
        assert.deepEqual(moveRight(mirrored, reflect(cursor)), reflect(moveLeft(layout, cursor)));
      }
    }
  }
});

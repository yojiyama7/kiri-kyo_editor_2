import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLayout } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { connectArrow, connectApposition, deleteArrow } from '../src/arrowEditing.ts';
import { splitSlot } from '../src/tEditing.ts';

const initial = () => ({ arrows: [], splits: [], groups: [], translation: '',
  tokens: [...'abcdefgh'].map((text) => ({ id: `token:${text}`, text, slotId: text })),
  slots: [...'abcdefgh'].map((id) => ({ id, marker: 'marker.adverb' })),
});
function render(d, width = 1000, tokenWidth = 50) {
  const layout = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
  const view = computeRenderLayout(d.tokens, d.groups, d.splits, Array(8).fill(tokenWidth), width);
  return { layout, view, segments: renderArrows(layout, view.regionsBySlot, d.slots) };
}
const stems = (r, id) => r.segments.flatMap((s) => s.stems).filter((s) => s.slotId === id);
const center = (r, id) => {
  const region = r.view.regionsBySlot.get(id).at(-1);
  return (region.left + region.right) / 2;
};

test('entry 89 wraps the ad connector left of its stem when only of moves to the next row', () => {
  // Reduced from the reported entry: measured columns and the affected T/arrow.
  const words = '89. A person ( who had a white elephant ) had to pay a lot of money to take care of it.'.split(' ');
  const tokens = words.map((text, i) => text === '(' || text === ')'
    ? { id: `token:${i}`, text, kind: text === '(' ? 'paren-open' : 'paren-close', ...(text === '(' ? { slotId: `s${i}` } : {}) }
    : { id: `token:${i}`, text, slotId: `s${i}`, kind: 'real' });
  const groups = [{ id: 'g', slotId: 'phrase', kind: 'basic', slots: ['s17', 's18', 's19', 's20'] }];
  const splits = [{ slotId: 'phrase', leftSlotId: 'ad', rightSlotId: 'verb' }];
  const slots = [...tokens.filter((t) => t.slotId).map((t) => ({ id: t.slotId })),
    { id: 'phrase' }, { id: 'ad', marker: 'marker.adverb' }, { id: 'verb', marker: 'marker.number3' }];
  const widths = [41.9296875, 16.6484375, 79.859375, 10, 41.9296875, 42, 16.6484375,
    67.21875, 105.1484375, 10, 41.9296875, 29.2890625, 42, 16.6484375, 41.9296875,
    29.2890625, 67.21875, 29.2890625, 54.578125, 54.578125, 29.2890625, 41.9296875];
  const layout = computeLayout(tokens, groups, splits, [{ sourceSlotId: 'ad', targetSlotId: 's12' }]);
  for (const available of [1033, 1200]) {
    const view = computeRenderLayout(tokens, groups, splits, widths, available, new Map([['phrase', 84]]));
    for (const columns of [view.columns, undefined]) {
      const segments = renderArrows(layout, view.regionsBySlot, slots, columns);
      if (available === 1033) {
        assert.deepEqual(view.rows, [{ start: 0, end: 19 }, { start: 20, end: 21 }]);
        assert.equal(view.columns[20].left, 27.35546875);
        assert.equal(segments.length, 2);
        assert.deepEqual([segments[1].left, segments[1].right], [0, 21]);
        assert.equal(segments[1].stems[0].x, 21);
        assert.equal(segments[0].endConnection, segments[1].startConnection);
      } else {
        assert.equal(view.rows.length, 1);
        assert.equal(segments.length, 1);
        assert.deepEqual([segments[0].left, segments[0].right], [643.6015625, 919.12109375]);
      }
    }
  }
});

test('wrapped connectors reach the expanded underline at the right edge of a row', () => {
  const tokens = [...'abc'].map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const groups = [{ id: 'g', slotId: 'group', kind: 'basic', slots: ['b'] }];
  const splits = [{ slotId: 'group', leftSlotId: 'left', rightSlotId: 'right' }];
  const slots = ['a', 'b', 'c', 'group', 'left', 'right'].map((id) => ({ id }));
  const layout = computeLayout(tokens, groups, splits, [{ sourceSlotId: 'right', targetSlotId: 'c' }]);
  const view = computeRenderLayout(tokens, groups, splits, [20, 20, 20], 114, new Map([['group', 84]]));
  assert.deepEqual(view.rows, [{ start: 0, end: 1 }, { start: 2, end: 2 }]);
  assert.equal(view.columns[1].right, 82);
  assert.equal(view.regionsBySlot.get('group')[0].right, 114);
  for (const columns of [view.columns, undefined]) {
    const segments = renderArrows(layout, view.regionsBySlot, slots, columns);
    assert.equal(segments.length, 2);
    assert.deepEqual([segments[0].left, segments[0].right], [93, 114]);
    assert.equal(segments[0].stems[0].x, 93);
    assert.equal(segments[0].endConnection, segments[1].startConnection);
  }
});

test('horizontal height is the center of its logical slot row, including arrow-only rows', () => {
  const d = connectArrow(connectArrow(initial(), 'a', 'c'), 'd', 'b');
  const r = render(d);
  assert.deepEqual(r.segments.map((s) => [s.logicalY, s.y]), [[1, 52], [2, 90]]);
  assert.equal(r.layout.groups.length, 0);
  for (const segment of r.segments) {
    assert.equal(segment.y, segment.logicalY * 38 + 28 / 2);
    for (const stem of segment.stems) {
      assert.equal(stem.y, 28);
      assert.equal(segment.y - stem.y, segment.logicalY * 38 - 14);
    }
  }
});

test('a horizontal and an unrelated slot on the same logical row share the same center height', () => {
  const d = connectArrow(initial(), 'a', 'b');
  d.groups.push({ id: 'g', slotId: 'group', slots: ['f'], kind: 'composite' });
  d.slots.push({ id: 'group' });
  const r = render(d);
  assert.equal(r.layout.slotY.get('group'), 1);
  assert.equal(r.segments[0].logicalY, 1);
  assert.equal(r.segments[0].y, r.layout.slotY.get('group') * 38 + 14);
});

test('ordinary empty targets attach at the slot top while marked targets stay at the bottom', () => {
  const d = connectArrow(initial(), 'a', 'b');
  for (const marked of [true, false]) {
    const document = { ...d, slots: d.slots.map((s) => s.id === 'b' && !marked ? { id: s.id } : s) };
    const r = render(document);
    const segment = r.segments[0];
    assert.equal(segment.y, 52);
    assert.equal(segment.stems.find((s) => !s.target).y, 28);
    const target = segment.stems.find((s) => s.target);
    assert.equal(target.y, marked ? 28 : 0);
    assert.equal(segment.y - target.y, marked ? 24 : 52);
    assert.equal(Math.min(7, segment.y - target.y), 7); // arrowhead remains at the target edge
  }
});

test('empty T and D half targets attach at the slot top outside the inset case', () => {
  for (const kind of [undefined, 't', 'd']) {
    for (const owner of ['b', 'inner']) {
      let d = initial();
      if (owner === 'inner') {
        d.slots = d.slots.map(slot => ['b', 'c'].includes(slot.id) ? { id: slot.id } : slot);
        // Overlap raises the split owner above Y=0's coordinate origin.
        d.groups.push({ id: 'blocking-group', slotId: 'blocking', kind: 'basic', slots: ['b'] },
          { id: 'inner-group', slotId: 'inner', kind: 'basic', slots: ['b', 'c'] });
        d.slots.push({ id: 'blocking' }, { id: 'inner' });
      }
      d = splitSlot(d, owner, kind ?? 't');
      if (kind === 't') d.splits[0].kind = 't';
      const split = d.splits[0];
      for (const targetId of [split.leftSlotId, split.rightSlotId]) {
        for (const marker of [undefined, 'o']) {
          const document = { ...d,
            slots: d.slots.map(slot => slot.id === targetId ? { id: targetId, marker } : slot),
            arrows: [{ sourceSlotId: 'h', targetSlotId: targetId }],
          };
          for (const width of [1000, 110]) {
            const r = render(document, width);
            const target = stems(r, targetId)[0];
            const y = owner === 'inner' ? 1 : 0;
            assert.equal(r.layout.slotY.get(targetId), y);
            assert.equal(target.y, y * 38 + (marker === undefined ? 0 : 28));
            assert.equal(target.row, r.view.regionsBySlot.get(targetId).at(-1).row);
            assert.equal(target.x, center(r, targetId));
            assert.equal(target.target, true);
          }
        }
      }
    }
  }
});

test('empty T halves attach apposition at the bottom in either endpoint order while D keeps its upper attachment', () => {
  for (const kind of ['t', 'd']) {
    const d = splitSlot(initial(), 'b', kind);
    const split = d.splits[0];
    for (const half of [split.leftSlotId, split.rightSlotId]) {
      for (const sourceSlotId of [half, 'h']) {
        const document = { ...d,
          slots: d.slots.map(slot => [half, 'h'].includes(slot.id) ? { id: slot.id } : slot),
          arrows: [{ sourceSlotId, targetSlotId: sourceSlotId === half ? 'h' : half, kind: 'apposition' }],
        };
        for (const width of [1000, 110]) {
          const r = render(document, width);
          assert.equal(stems(r, half)[0].y, kind === 't' ? 28 : -8);
          assert.equal(stems(r, 'h')[0].y, -8);
          assert.equal(stems(r, half)[0].target, false);
        }
      }
    }
  }
});

test('empty endpoints cross their basic underline by 3px, including wrapped and both-empty apposition', () => {
  for (const kind of ['directed', 'apposition', 'empty-apposition']) {
    let d = initial();
    d.slots = d.slots.map((slot) => ['g', 'h'].includes(slot.id) ? { id: slot.id }
      : slot.id === 'a' && kind !== 'directed' ? { ...slot, marker: 'marker.noun' } : slot);
    d.groups.push({ id: 'g1', slotId: 'group', slots: ['g', 'h'], kind: 'basic' });
    d.slots.push({ id: 'group' });
    d = kind === 'directed' ? connectArrow(d, 'a', 'h') : connectApposition(d, 'a', 'h');
    if (kind === 'empty-apposition') d.slots = d.slots.map((slot) => slot.id === 'a' ? { id: 'a' } : slot);
    const expectedLayout = render(d).layout;
    for (const width of [1000, 110, 50]) {
      const r = render(d, width);
      assert.deepEqual(r.layout, expectedLayout);
      assert.equal(r.segments.length > 1, width < 1000);
      const target = stems(r, 'h')[0];
      const underline = r.layout.groups.find((placement) => placement.group.id === 'g1');
      assert.equal(underline.y * 38 - 5 - target.y, 3);
      const targetRegion = r.view.regionsBySlot.get('h').at(-1);
      assert.equal(target.row, targetRegion.row);
      assert.equal(target.x, kind === 'directed' ? targetRegion.left + 7 : center(r, 'h'));
      assert.equal(target.target, kind === 'directed');
      assert.equal(stems(r, 'a')[0].y, kind === 'empty-apposition' ? -8 : 28);
    }
  }
});

function withBasicTarget(target = 'd') {
  const d = initial();
  d.slots = d.slots.map((slot) => slot.id === target ? { id: target } : slot);
  d.groups.push({ id: 'basic', slotId: 'group', kind: 'basic', slots: [target] });
  d.slots.push({ id: 'group', marker: 'marker.adverb' });
  return d;
}

test('basic targets use the opposite inset only at right and left edges, keeping interiors centered', () => {
  for (const [sources, x, y, extent] of [
    [['a'], 187, -8, [25, 187]],
    [['h'], 223, -8, [223, 445]],
    [['a', 'h'], 205, 0, [25, 445]],
    [['a', 'b'], 187, -8, [25, 187]],
  ]) {
    const d = withBasicTarget();
    d.arrows = sources.map((sourceSlotId) => ({ sourceSlotId, targetSlotId: 'd' }));
    const r = render(d);
    assert.equal(stems(r, 'd')[0].x, x);
    assert.equal(stems(r, 'd')[0].y, y);
    assert.deepEqual([r.segments[0].left, r.segments[0].right], extent);
    for (const source of sources) assert.equal(stems(r, source)[0].x, center(r, source));
  }
});

test('underlines made only of basic slots inset empty targets but center marked targets regardless of token kind', () => {
  for (const tokenKind of [undefined, 'real', 'pseudo']) {
    for (const marker of [undefined, 'o']) {
      for (const [source, insetFromLeft] of [['a', true], ['h', false]]) {
        const d = initial();
        d.tokens[3] = { ...d.tokens[3], ...(tokenKind ? { kind: tokenKind } : {}) };
        d.slots = d.slots.map((slot) => slot.id === 'd' ? { id: 'd', ...(marker ? { marker } : {}) } : slot);
        // c remains marked, so this is composite even when d is empty.
        d.groups.push({ id: 'g', slotId: 'group', kind: 'composite', slots: ['c', 'd'] });
        d.slots.push({ id: 'group', marker: 'marker.adverb' });
        d.arrows = [{ sourceSlotId: source, targetSlotId: 'd' }];
        for (const width of [1000, 110]) {
          const r = render(d, width);
          const target = stems(r, 'd')[0];
          const region = r.view.regionsBySlot.get('d').at(-1);
          assert.equal(target.x, marker ? center(r, 'd')
            : insetFromLeft ? region.left + 7 : region.right - 7);
          assert.equal(target.y, marker ? 28 : -8);
          const segment = r.segments.find((s) => s.row === target.row);
          assert.equal(insetFromLeft ? segment.right : segment.left, target.x);
        }
      }
    }
  }
});

test('marked, internal and interior targets stay centered; external sources inset only empty edge targets', () => {
  for (const kind of ['basic', 'composite']) {
    const d = initial();
    const members = ['b', 'd', 'f'];
    if (kind === 'basic') d.slots = d.slots.map((slot) => members.includes(slot.id) ? { id: slot.id } : slot);
    d.groups.push({ id: 'g', slotId: 'group', kind, slots: members });
    d.slots.push({ id: 'group' });
    for (const width of [1000, 110]) {
      for (const [sources, side] of [
        [['b'], 'center'], [['f'], 'center'], [['b', 'f'], 'center'],
        [['b', 'a'], 'left'], [['f', 'h'], 'right'], [['b', 'f', 'h'], 'center'],
      ]) {
        const document = { ...d, arrows: sources.map((sourceSlotId) => ({ sourceSlotId, targetSlotId: 'd' })) };
        const r = render(document, width);
        const target = stems(r, 'd')[0];
        const region = r.view.regionsBySlot.get('d').at(-1);
        const expected = kind === 'composite' || side === 'center'
          ? center(r, 'd') : side === 'left' ? region.left + 7 : region.right - 7;
        assert.equal(target.x, expected);
        const segment = r.segments.find((s) => s.row === target.row);
        assert.ok(segment.left <= target.x && target.x <= segment.right);
        if (width === 1000) {
          assert.equal(segment.left, Math.min(...segment.stems.map((s) => s.x)));
          assert.equal(segment.right, Math.max(...segment.stems.map((s) => s.x)));
        }
        if (side !== 'center') {
          const internal = { ...document, arrows: document.arrows.filter((arrow) => members.includes(arrow.sourceSlotId)) };
          const restored = render(internal, width);
          assert.equal(stems(restored, 'd')[0].x, center(restored, 'd'));
        }
      }
    }
  }
});

test('T and D halves use an inset only with an external source and a target at an edge', () => {
  for (const kind of ['t', 'd']) {
    const d = splitSlot(initial(), 'b', kind);
    const { leftSlotId, rightSlotId } = d.splits[0];
    d.groups.push({ id: 'g', slotId: 'group', kind: 'composite', slots: [leftSlotId, rightSlotId] });
    d.slots.push({ id: 'group' });
    for (const [sources, side] of [
      [[leftSlotId], 'center'], [[leftSlotId, 'h'], 'center'],
      [[leftSlotId, 'a'], 'left'], [['h'], 'right'],
    ]) {
      d.arrows = sources
        .map((sourceSlotId) => ({ sourceSlotId, targetSlotId: rightSlotId }));
      const r = render(d);
      const region = r.view.regionsBySlot.get(rightSlotId).at(-1);
      assert.equal(stems(r, rightSlotId)[0].x, side === 'center' ? center(r, rightSlotId)
        : side === 'left' ? region.left + 7 : region.right - 7);
      assert.equal(stems(r, rightSlotId)[0].y, side === 'center' ? 0 : -8);
    }
  }
});

test('marked T and D half targets stay centered, including halves of underlines', () => {
  for (const kind of ['t', 'd']) {
    for (const owner of ['b', 'inner']) {
      let d = initial();
      if (owner === 'inner') {
        d.slots = d.slots.map((slot) => slot.id === 'b' ? { id: 'b' } : slot);
        d.groups.push({ id: 'inner-group', slotId: 'inner', kind: 'basic', slots: ['b'] });
        d.slots.push({ id: 'inner' });
      }
      d = splitSlot(d, owner, kind);
      const split = d.splits[0];
      for (const targetId of [split.leftSlotId, split.rightSlotId]) {
        const document = { ...d,
          slots: [...d.slots.map((slot) => slot.id === targetId ? { ...slot, marker: 'marker.object' } : slot), { id: 'outer' }],
          groups: [...d.groups, { id: 'outer-group', slotId: 'outer', kind: 'composite', slots: [targetId, 'c'] }],
          arrows: [{ sourceSlotId: 'h', targetSlotId: targetId }],
        };
        const r = render(document);
        const target = stems(r, targetId)[0];
        const region = r.view.regionsBySlot.get(targetId).at(-1);
        assert.equal(target.x, (region.left + region.right) / 2);
        assert.equal(target.y, r.layout.slotY.get(targetId) * 38 + 28);
        assert.equal(r.segments[0].left, target.x);
      }
    }
  }
});

test('nested underlines and split owners disqualify the whole direct-content list', () => {
  for (const nested of [true, false]) {
    const d = initial();
    if (nested) {
      d.groups.push({ id: 'inner-group', slotId: 'inner', kind: 'composite', slots: ['b'] });
      d.slots.push({ id: 'inner' });
    } else {
      d.splits.push({ slotId: 'b', leftSlotId: 'left', rightSlotId: 'right' });
      d.slots.push({ id: 'left' }, { id: 'right' });
    }
    const member = nested ? 'inner' : 'b';
    d.groups.push({ id: 'outer-group', slotId: 'outer', kind: 'composite', slots: [member, 'd'] });
    d.slots.push({ id: 'outer' });
    for (const targetSlotId of ['d', member, 'outer']) {
      const document = { ...d,
        slots: d.slots.map((slot) => slot.id === targetSlotId ? { id: slot.id } : slot),
        arrows: [{ sourceSlotId: 'h', targetSlotId }],
      };
      const r = render(document);
      assert.equal(stems(r, targetSlotId)[0].x, center(r, targetSlotId));
      assert.equal(stems(r, targetSlotId)[0].y, r.layout.slotY.get(targetSlotId) * 38);
    }
    if (nested) {
      // b is marked, so its own immediate underline does not trigger the empty-target inset.
      const r = render({ ...d, arrows: [{ sourceSlotId: 'h', targetSlotId: 'b' }] });
      assert.equal(stems(r, 'b')[0].x, center(r, 'b'));
    }
  }
});

test('bracket slots disqualify underlines even after split atoms renumber token ranges', () => {
  for (const [kind, text] of [['bracket-open', '['], ['angle-open', '<']]) {
    const d = splitSlot(initial(), 'a');
    d.tokens[1] = { id: 'token:b', slotId: 'b', kind, text };
    d.groups.push({ id: 'g', slotId: 'group', kind: 'composite', slots: ['b', 'd'] });
    d.slots.push({ id: 'group' });
    d.arrows = [{ sourceSlotId: 'h', targetSlotId: 'd' }];
    d.slots = d.slots.map((slot) => slot.id === 'd' ? { id: 'd' } : slot);
    const r = render(d);
    assert.equal(stems(r, 'd')[0].x, center(r, 'd'));
    assert.equal(stems(r, 'd')[0].y, 0);
    assert.equal(r.segments[0].left, center(r, 'd'));
  }
});

test('wrapped basic targets use full-arrow edges and leave interior targets centered', () => {
  for (const [target, sources, x] of [
    ['c', ['b'], 7], // Previous row's source has a larger pixel X.
    ['d', ['a'], 67],
    ['d', ['e'], 103], // Later row's source has a smaller pixel X.
    ['d', ['a', 'e'], 85],
  ]) {
    const d = withBasicTarget(target);
    d.arrows = sources.map((sourceSlotId) => ({ sourceSlotId, targetSlotId: target }));
    const r = render(d, 110);
    const stem = stems(r, target)[0];
    const segment = r.segments.find((s) => s.row === stem.row);
    assert.equal(stem.x, x);
    if (sources.includes('e')) {
      assert.equal(segment.right, 110);
      assert.equal(segment.left, sources.includes('a') ? 0 : x);
    } else {
      assert.deepEqual([segment.left, segment.right], [0, x]);
    }
    for (let i = 1; i < r.segments.length; i++) {
      assert.equal(r.segments[i - 1].endConnection, r.segments[i].startConnection);
    }
  }
});

test('being the first or last stem on a wrapped row does not make an interior target an edge', () => {
  for (const [targetSlotId, sources, extent] of [
    ['b', ['a', 'c'], [25, 110]], // Last stem on the first row, but the arrow continues.
    ['c', ['b', 'd'], [0, 85]], // First stem on the last row, but the arrow starts earlier.
  ]) {
    const d = withBasicTarget(targetSlotId);
    d.arrows = sources.map((sourceSlotId) => ({ sourceSlotId, targetSlotId }));
    const r = render(d, 110);
    const target = stems(r, targetSlotId)[0];
    const segment = r.segments.find((s) => s.row === target.row);
    assert.equal(target.x, center(r, targetSlotId));
    assert.equal(target.y, 0);
    assert.deepEqual([segment.left, segment.right], extent);
    assert.equal(r.segments[0].endConnection, r.segments[1].startConnection);
  }
});

test('basic targets include ties at the right edge and decide after existing source offsets', () => {
  for (const incoming of [false, true]) {
    const d = withBasicTarget('b');
    d.arrows = [{ sourceSlotId: 'group', targetSlotId: 'b' },
      ...(incoming ? [{ sourceSlotId: 'h', targetSlotId: 'group' }] : [])];
    const r = render(d);
    const segment = r.segments.find((s) => s.targetSlotId === 'b');
    assert.equal(segment.stems.find((s) => s.target).x, incoming ? 103 : 67);
    assert.equal(segment.stems.find((s) => !s.target).x, incoming ? 91 : 85);
    assert.deepEqual([segment.left, segment.right], incoming ? [91, 103] : [67, 85]);
    if (incoming) assert.equal(stems(r, 'group').find((s) => s.target).x, 85);
  }
});

test('basic targets use their split region edges and center regions narrower than 14px', () => {
  for (const tokenWidth of [50, 28, 8]) {
    for (const side of ['left', 'right']) {
      for (const source of ['a', 'h']) {
        const d = withBasicTarget(side);
        d.splits = [{ slotId: 'b', leftSlotId: 'left', rightSlotId: 'right' }];
        d.slots.push({ id: 'left' }, { id: 'right' });
        d.slots = d.slots.map((slot) => slot.id === 'b' ? { id: 'b' } : slot);
        d.arrows = [{ sourceSlotId: source, targetSlotId: side }];
        const r = render(d, 1000, tokenWidth);
        const region = r.view.regionsBySlot.get(side)[0];
        const target = stems(r, side)[0];
        const expected = tokenWidth <= 28 ? center(r, side)
          : source === 'a' ? region.left + 7 : region.right - 7;
        assert.equal(target.x, expected);
        assert.equal(target.y, -8);
        assert.ok(target.x > region.left && target.x < region.right);
      }
    }
  }
});

test('entry 167 keeps the palms target clear of the ad center when palms begins row two', () => {
  const words = '167. The lecture was boring, so I pressed my fingernails painfully into the palms of my hands. It was all I could do not to fall asleep.'.split(' ');
  const tokens = words.map((text, i) => ({ id: `t${i}`, slotId: `s${i}`, text }));
  const groups = [
    { id: 'into', slotId: 'ad', kind: 'basic', slots: ['s11', 's12', 's13'] },
    { id: 'of', slotId: 'a', kind: 'composite', slots: ['s14', 's15', 's16'] },
  ];
  const markers = { s2: 's', s3: '2', s4: 'ac', s5: '+', s6: 's', s7: '3',
    s8: 'a', s9: 'o', s10: 'ad', s15: 'a' };
  const slots = [...tokens.map(({ slotId: id }) => ({ id, ...(markers[id] ? { marker: markers[id] } : {}) })),
    { id: 'ad', marker: 'marker.adverb' }, { id: 'a', marker: 'marker.adjective' }];
  const arrows = [['s8', 's9'], ['s10', 's7'], ['ad', 's7'], ['s15', 's16'], ['a', 's13']]
    .map(([sourceSlotId, targetSlotId]) => ({ sourceSlotId, targetSlotId }));
  const widths = [54.578125, 41.9296875, 92.5078125, 42, 92.5078125, 29.2890625, 18,
    92.5078125, 29.2890625, 143.078125, 117.7890625, 54.578125, 41.9296875, 67.21875,
    29.2890625, 29.2890625, 79.859375, 29.2890625, 41.9296875, 41.9296875,
    16.6484375, 67.21875, 29.2890625, 41.9296875, 29.2890625, 54.578125, 92.5078125];
  const layout = computeLayout(tokens, groups, [], arrows);
  const view = computeRenderLayout(tokens, groups, [], widths, 973, new Map([['ad', 30], ['a', 18]]));
  const before = structuredClone({ layout, view });
  assert.deepEqual(view.rows, [{ start: 0, end: 12 }, { start: 13, end: 26 }]);
  for (const columns of [view.columns, undefined]) {
    const segments = renderArrows(layout, view.regionsBySlot, slots, columns);
    const palms = segments.find((s) => s.targetSlotId === 's13');
    const target = palms.stems.find((s) => s.target);
    assert.equal(target.x, 60.21875);
    assert.equal(target.y, -8);
    assert.deepEqual([palms.left, palms.right, palms.y], [60.21875, 156.4375, 128]);
    const ad = segments.flatMap((s) => s.stems).find((s) => s.slotId === 'ad');
    assert.equal(ad.x, 33.609375);
    assert.ok(target.x > ad.x + 30 / 2); // Outside the measured ad label.
    const hands = segments.find((s) => s.targetSlotId === 's16');
    assert.equal(hands.stems.find((s) => s.target).x, 195.7265625); // Internal my → hands stays centered.
    assert.equal(hands.right, 195.7265625);
  }
  assert.deepEqual({ layout, view }, before);
});

test('wrapped shared T connections keep center height and fit inside the final slot bottom', () => {
  let d = splitSlot(initial(), 'b');
  const source = d.splits[0].leftSlotId;
  d = connectArrow(connectArrow(connectArrow(d, 'a', source), source, 'h'), 'd', 'h');
  const expected = render(d).layout;
  for (const width of [1000, 110, 50]) {
    const r = render(d, width);
    assert.deepEqual(r.layout, expected);
    for (const segment of r.segments) {
      assert.equal(segment.y, segment.logicalY * 38 + 14);
      const rowMaxY = Math.max(...r.segments.filter((s) => s.row === segment.row).map((s) => s.logicalY));
      assert.ok(segment.y + 3.5 < rowMaxY * 38 + 28);
      for (const stem of segment.stems) assert.ok(stem.y < segment.y);
    }
    for (const target of [source, 'h']) {
      const bundle = r.segments.filter((s) => s.targetSlotId === target);
      for (let i = 1; i < bundle.length; i++) {
        assert.equal(bundle[i - 1].endConnection, bundle[i].startConnection);
        assert.equal(bundle[i - 1].y, bundle[i].y);
      }
    }
  }
});

test('an incoming target stays centered while its outgoing rightward source and open horizontal edge move together', () => {
  const d = connectArrow(connectArrow(initial(), 'a', 'b'), 'b', 'd');
  const r = render(d);
  assert.equal(stems(r, 'b').find((s) => s.target).x, 85);
  assert.equal(stems(r, 'b').find((s) => !s.target).x, 91);
  const outgoing = r.segments.find((s) => s.targetSlotId === 'd');
  assert.equal(outgoing.left, 91);
  assert.equal(outgoing.right, 205);
  assert.equal(stems(r, 'a')[0].x, 25); // source-only slots stay centered
});

test('leftward outgoing sources move left and shorten the right horizontal edge', () => {
  const d = connectArrow(connectArrow(initial(), 'h', 'd'), 'd', 'b');
  const r = render(d);
  assert.equal(stems(r, 'd').find((s) => s.target).x, 205);
  assert.equal(stems(r, 'd').find((s) => !s.target).x, 199);
  const outgoing = r.segments.find((s) => s.targetSlotId === 'b');
  assert.equal(outgoing.left, 85);
  assert.equal(outgoing.right, 199);
});

test('an interior source in a shared bundle moves without shortening unrelated outer edges', () => {
  const d = connectArrow(connectArrow(connectArrow(initial(), 'c', 'd'), 'a', 'h'), 'd', 'h');
  const r = render(d);
  const outgoing = r.segments.find((s) => s.targetSlotId === 'h');
  assert.equal(stems(r, 'd').find((s) => !s.target).x, 211);
  assert.deepEqual([outgoing.left, outgoing.right], [25, 445]);
  assert.equal(outgoing.stems.filter((s) => s.target).length, 1);
});

test('wrapped outgoing arrows use row order rather than pixel X for direction', () => {
  for (const [incomingSource, shared, target, direction] of [['a', 'b', 'c', 1], ['h', 'c', 'b', -1]]) {
    const d = connectArrow(connectArrow(initial(), incomingSource, shared), shared, target);
    const r = render(d, 110);
    const ownStems = stems(r, shared);
    assert.equal(ownStems.find((s) => s.target).x, center(r, shared));
    const source = ownStems.find((s) => !s.target);
    assert.equal(source.x, center(r, shared) + direction * 6);
    const outgoing = r.segments.filter((s) => s.targetSlotId === target);
    assert.equal(outgoing.length, 2);
    assert.equal(outgoing[0].endConnection, outgoing[1].startConnection);
    const sourceSegment = outgoing.find((s) => s.row === source.row);
    assert.equal(direction === 1 ? sourceSegment.left : sourceSegment.right, source.x);
  }
});

test('offsets stay inside narrow T half slots', () => {
  let d = splitSlot(initial(), 'b');
  const source = d.splits[0].leftSlotId;
  d = connectArrow(connectArrow(d, 'a', source), source, 'h');
  const r = render(d, 1000, 8);
  const region = r.view.regionsBySlot.get(source).at(-1);
  const sourceStem = stems(r, source).find((s) => !s.target);
  assert.equal(sourceStem.x, center(r, source) + 1);
  assert.ok(sourceStem.x > region.left && sourceStem.x < region.right);
  assert.equal(stems(r, source).find((s) => s.target).x, center(r, source));
});

test('a marked target inside a one-slot composite underline stays centered after source separation', () => {
  let d = initial();
  d.groups.push({ id: 'g', slotId: 'group', slots: ['b'], kind: 'composite' });
  d.slots.push({ id: 'group', marker: 'marker.adverb' });
  d = connectArrow(connectArrow(d, 'a', 'group'), 'group', 'b');
  const r = render(d);
  const outgoing = r.segments.find((s) => s.targetSlotId === 'b');
  assert.equal(outgoing.stems.find((s) => s.target).x, center(r, 'b'));
  assert.equal(outgoing.stems.find((s) => !s.target).x, 91);
  assert.deepEqual([outgoing.left, outgoing.right], [center(r, 'b'), 91]);
});

test('another unshifted source at the old extreme keeps the shared horizontal connected', () => {
  let d = initial();
  d.groups.push({ id: 'g', slotId: 'group', slots: ['b'], kind: 'composite' });
  d.slots.push({ id: 'group', marker: 'marker.adverb' });
  d = connectArrow(connectArrow(connectArrow(d, 'a', 'group'), 'group', 'h'), 'b', 'h');
  const r = render(d);
  const outgoing = r.segments.find((s) => s.targetSlotId === 'h');
  assert.equal(outgoing.left, 85);
  assert.equal(outgoing.stems.find((s) => s.slotId === 'group').x, 91);
  assert.equal(outgoing.stems.find((s) => s.slotId === 'b').x, 85);
});

test('removing incoming arrows restores the source center and rendering never mutates logical geometry', () => {
  const d = connectArrow(connectArrow(initial(), 'a', 'b'), 'b', 'h');
  const r = render(d);
  const beforeLayout = structuredClone(r.layout);
  const beforeView = structuredClone(r.view);
  for (const width of [1000, 170, 50]) {
    const next = render(d, width);
    assert.deepEqual(next.layout, beforeLayout);
  }
  renderArrows(r.layout, r.view.regionsBySlot, d.slots);
  assert.deepEqual(r.layout, beforeLayout);
  assert.deepEqual(r.view, beforeView);
  const noIncoming = render(deleteArrow(d, 'a'));
  assert.equal(stems(noIncoming, 'b')[0].x, center(noIncoming, 'b'));
  const oldArrow = r.layout.arrows.find((a) => a.targetSlotId === 'h');
  const newArrow = noIncoming.layout.arrows.find((a) => a.targetSlotId === 'h');
  assert.deepEqual(newArrow.interval, oldArrow.interval);
  assert.deepEqual(newArrow.slotInterval, oldArrow.slotInterval);
});

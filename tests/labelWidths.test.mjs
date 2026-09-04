import assert from 'node:assert/strict';
import test from 'node:test';
import { measureLabels } from '../src/labelMeasurements.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { computeLayout } from '../src/layout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { splitSlot } from '../src/tEditing.ts';
import { EditHistory } from '../src/history.ts';
import { createGroup } from '../src/model.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS } from '../src/inputConfig.ts';

const markerId = (sequence) => DEFAULT_MARKER_INPUT_BINDINGS.find(binding => binding.sequence === sequence)?.value;

function document(words = 'a b c d', specs = [['g', ['b', 'c'], 'ado']]) {
  const tokens = words.split(' ').map((text) => ({ id: `token:${text}`, text, slotId: text }));
  return { version: 6, tokens, slots: [
    ...tokens.map(({ slotId: id }) => ({ id })), ...specs.map(([id, , marker]) => ({ id, ...(marker && { marker: markerId(marker) }) })),
  ], groups: specs.map(([slotId, slots]) => ({ id: `group:${slotId}`, slotId, slots,
    kind: slots.every((id) => tokens.some((token) => token.slotId === id)) ? 'basic' : 'composite' })),
  splits: [], arrows: [], translation: '' };
}
const measurement = (d, pending, buffer) => measureLabels(d.tokens, d.slots, d.groups, d.splits, d.arrows, pending, buffer);
const render = (d, widths, labels = [], available = 1000, pending) =>
  computeRenderLayout(d.tokens, d.groups, d.splits, widths, available, new Map(labels), pending);
const region = (v, id) => v.regionsBySlot.get(id).at(-1);
const width = (r) => r.right - r.left;
const center = (r) => (r.left + r.right) / 2;
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a} != ${b}`);

test('22: ado is measured on its underline, never on every or day.', () => {
  const d = document('22. The man had meals at regular times every day.', [
    ['ad-group', ['at', 'regular', 'times'], 'ad'], ['ado-group', ['every', 'day.'], 'ado'],
  ]);
  const m = measurement(d);
  assert.deepEqual(m.groups.map(({ labels }) => labels), [['ad'], ['副詞的目的格']]);
  assert.ok(m.tokens.every(({ labels }) => labels.every((label) => label === '')));
  assert.deepEqual(measurement(d, 'ado-group', 'ad').tokens, m.tokens);
  const widths = [41.9296875, 41.9296875, 41.9296875, 42, 67.21875, 29.2890625, 92.5078125, 67.21875, 67.21875, 54.578125];
  const v = render(d, widths, [['ad-group', 30], ['ado-group', 150]]);
  near(width(region(v, 'day.')), 54.578125);
  near(width(region(v, 'every')), 67.21875);
  near(region(v, 'day.').left - region(v, 'every').right, 10);
  near(width(region(v, 'ado-group')), 150);
  near(center(region(v, 'ado-group')), (region(v, 'every').left + region(v, 'day.').right) / 2);
  near(region(v, 'ado-group').left - region(v, 'ad-group').right, 10);
});

test('underline width is max(content, label), with symmetric external padding', () => {
  const d = document();
  for (const required of [0, 60, 90, 150]) {
    const v = render(d, [40, 40, 40, 40], [['g', required]]);
    const g = region(v, 'g'), b = region(v, 'b'), c = region(v, 'c');
    near(width(g), Math.max(90, required));
    near(b.left - g.left, g.right - c.right);
    near(c.left - b.right, 10);
    near(g.left - region(v, 'a').right, 10);
    near(region(v, 'd').left - g.right, 10);
    v.columns.forEach((column) => near(width(column), 40));
  }
});

test('adjacent expanded underlines keep a 10px gap and center their contents', () => {
  const d = document('a b c d', [['g', ['a', 'b'], 'ado'], ['h', ['c', 'd'], 'ado']]);
  const v = render(d, [20, 20, 20, 20], [['g', 150], ['h', 150]]);
  near(region(v, 'g').left, 0);
  near(region(v, 'h').left - region(v, 'g').right, 10);
  near(v.rowWidths[0], 310);
  near(region(v, 'b').left - region(v, 'a').right, 10);
  near(region(v, 'd').left - region(v, 'c').right, 10);
});

test('nested labels expand only their own outside, with child widths inherited by parents', () => {
  const d = document('a b c d', [['g', ['b', 'c'], 'ado'], ['parent', ['g'], 'ado']]);
  for (const reverse of [false, true]) {
    if (reverse) d.groups.reverse();
    const v = render(d, [20, 20, 20, 20], [['g', 150], ['parent', 200]]);
    near(width(region(v, 'g')), 150);
    near(width(region(v, 'parent')), 200);
    near(center(region(v, 'g')), center(region(v, 'parent')));
    near(region(v, 'c').left - region(v, 'b').right, 10);
    near(region(v, 'parent').left - region(v, 'a').right, 10);
    near(region(v, 'd').left - region(v, 'parent').right, 10);
  }
});

test('sparse labels do not join logical gaps and pending labels use the active region', () => {
  const d = document('a b c d', [['g', ['a', 'c'], 'ado']]);
  for (const pending of [undefined, { slotId: 'g', x: 0 }]) {
    const v = render(d, [20, 20, 20, 20], [['g', 150]], 1000, pending);
    const [first, last] = v.regionsBySlot.get('g');
    assert.equal(v.regionsBySlot.get('g').length, 2);
    near(width(first), pending ? 150 : 20);
    near(width(last), pending ? 20 : 150);
    near(region(v, 'b').left - first.right, 10);
    near(last.left - region(v, 'b').right, 10);
    assert.equal(first.endConnection, last.startConnection);
    assert.deepEqual(first.logicalRanges, [{ start: 0, end: 1 }]);
    assert.deepEqual(last.logicalRanges, [{ start: 2, end: 3 }]);
  }
});

test('external padding participates in wrapping without changing logical layout or token widths', () => {
  const d = document('a b c d', [['g', ['a', 'b'], 'ado'], ['h', ['c', 'd'], 'ado']]);
  const logical = computeLayout(d.tokens, d.groups, d.splits);
  for (const available of [310, 180, 150, 90]) {
    const v = render(d, [20, 20, 20, 20], [['g', 150], ['h', 150]], available);
    assert.deepEqual(v.rows.flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, i) => start + i)), [0, 1, 2, 3]);
    v.rows.forEach((row, i) => assert.ok(v.rowWidths[i] <= available + 0.02 || row.start === row.end));
    v.columns.forEach((column) => near(width(column), 20));
    for (const id of ['g', 'h']) {
      const regions = v.regionsBySlot.get(id);
      near(width(regions.at(-1)), 150);
      for (let i = 1; i < regions.length; i++) assert.equal(regions[i - 1].endConnection, regions[i].startConnection);
    }
    assert.deepEqual(computeLayout(d.tokens, d.groups, d.splits), logical);
  }
});

test('T/D group labels are measured on the source and halves follow the expanded final region', () => {
  for (const kind of ['t', 'd']) {
    const d = splitSlot(document(), 'g', kind);
    const m = measurement(d), split = d.splits[0];
    assert.deepEqual(m.groups[0].splitLabels, [['副詞的目的格', '']]);
    assert.ok(m.tokens.every(({ splitLabels }) => splitLabels.length === 0));
    for (const available of [1000, 170]) {
      const v = render(d, [30, 30, 30, 30], [['g', 300]], available);
      const source = region(v, 'g'), left = region(v, split.leftSlotId), right = region(v, split.rightSlotId);
      near(width(source), 300);
      near(width(left), 150); near(width(right), 150);
      near(left.left, source.left); near(left.right, right.left); near(right.right, source.right);
      v.columns.forEach((column) => near(width(column), 30));
    }
  }
});

test('unequal D render regions follow their saved ratio', () => {
  const d = document('a b c d', [['g', ['a', 'b', 'c'], 'ado']]);
  const divided = splitSlot(d, 'g', 'd', 0);
  const ratio = divided.splits[0].ratio;
  assert.equal(ratio, 1 / 3);
  const v = render(divided, [30, 30, 30, 30], [['g', 300]], 1000);
  const source = region(v, 'g');
  const left = region(v, divided.splits[0].leftSlotId);
  const right = region(v, divided.splits[0].rightSlotId);
  near(width(left), width(source) * ratio);
  near(width(right), width(source) * (1 - ratio));
  near(left.right, right.left);
});

test('token-owned markers and token T/D measurements stay on the token', () => {
  const d = document('a b', []);
  d.slots[0].marker = 'marker.adverbialObjective';
  assert.deepEqual(measurement(d).tokens[0].labels, ['副詞的目的格']);
  for (const kind of ['t', 'd']) {
    const split = splitSlot(d, 'a', kind);
    assert.deepEqual(measurement(split).tokens[0].splitLabels, [['副詞的目的格', '']]);
  }
});

test('custom and live free-input labels use the same token and group measurement paths', () => {
  const d = document('a b', [['g', ['b']]]);
  d.slots.find(({ id }) => id === 'a').marker = { kind: 'custom', text: '自由標識' };
  d.slots.find(({ id }) => id === 'g').marker = { kind: 'custom', text: '保存済み' };
  const saved = measurement(d);
  assert.deepEqual(saved.tokens[0].labels, ['自由標識']);
  assert.deepEqual(saved.groups[0].labels, ['保存済み']);
  assert.deepEqual(measurement(d, 'g', '入力中').groups[0].labels, ['入力中']);
});

test('arrows attach to the centered expanded group, not the last word', () => {
  const d = document();
  d.arrows.push({ sourceSlotId: 'g', targetSlotId: 'a' });
  const logical = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
  const v = render(d, [40, 40, 40, 40], [['g', 150]]);
  const arrows = renderArrows(logical, v.regionsBySlot, d.slots);
  near(arrows[0].stems.find((stem) => !stem.target).x, center(region(v, 'g')));
});

test('deleting a marker and undo/redo restore geometry without accumulated padding or saved dimensions', () => {
  const d = document(), before = structuredClone(d);
  const labels = [['g', 150]], widths = [40, 40, 40, 40];
  const original = render(d, widths, labels);
  const cleared = structuredClone(d);
  delete cleared.slots.find(({ id }) => id === 'g').marker;
  const history = new EditHistory();
  history.record({ document: d, cursor: { x: 1, y: 0 } }, { document: cleared, cursor: { x: 1, y: 0 } });
  near(width(region(render(cleared, widths), 'g')), 90);
  assert.deepEqual(render(history.undo().document, widths, labels), original);
  assert.deepEqual(render(history.redo().document, widths), render(cleared, widths));
  assert.deepEqual(d, before);
});

test('overlapping and shared groups remain deterministic and keep all token widths', () => {
  const d = document('a b c d e f', [
    ['g', ['a', 'b', 'c'], 'ado'], ['h', ['b', 'c', 'd'], 'ado'],
    ['i', ['c', 'd', 'e'], 'ado'], ['parent', ['g', 'h', 'i'], 'ado'],
  ]);
  const labels = [['g', 150], ['h', 180], ['i', 240], ['parent', 400]];
  const v = render(d, Array(6).fill(20), labels);
  assert.deepEqual(render(d, Array(6).fill(20), labels), v);
  v.columns.forEach((column) => near(width(column), 20));
  for (const [id, required] of labels) assert.ok(width(region(v, id)) >= required - 0.02);
});

test('sparse consumers of opposite split halves do not repeatedly reserve the same token gap', () => {
  const d = document('s0 s1 s2 s3 s4 s5 s6 s7', [
    ['g0', ['s2', 's1']], ['g1', ['s5']], ['g2', ['s7', 's6', 'g1']],
    ['g3', ['g0', 's1']], ['g4', ['g3L', 'g1R']], ['g5', ['g3R', 'g1']],
  ]);
  d.splits = ['g1', 'g2', 'g3'].map((slotId) => ({ slotId, leftSlotId: `${slotId}L`, rightSlotId: `${slotId}R`, kind: 'd' }));
  d.slots.push(...d.splits.flatMap((s) => [{ id: s.leftSlotId }, { id: s.rightSlotId }]));
  const labels = [['g0', 33], ['g1', 152], ['g2', 183], ['g3', 162], ['g4', 189], ['g5', 72]];
  const v = render(d, Array(8).fill(30), labels, 841);
  assert.equal(v.rows.length, 1);
  assert.ok(v.rowWidths[0] < 841);
  v.columns.forEach((column) => near(width(column), 30));
  near(region(v, 's2').left - region(v, 's1').right, 10);
  for (const [id, required] of labels) assert.ok(width(region(v, id)) >= required - 0.02);
});

test('500 seeded nested, intersecting, sparse and split layouts settle without changing word widths', () => {
  let seed = 22;
  const random = (n) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  for (let trial = 0; trial < 500; trial++) {
    let d = document('s0 s1 s2 s3 s4 s5 s6 s7', []);
    for (let k = 0; k < 6; k++) {
      const ids = [...new Set(Array.from({ length: 1 + random(3) }, () => d.slots[random(d.slots.length)].id))];
      const group = createGroup(d.tokens, d.slots, ids, d.splits);
      d.groups.push(group);
      d.slots.push({ id: group.slotId });
      if (random(3) === 0) d = splitSlot(d, group.slotId, 'd');
    }
    const labels = d.groups.map((g) => [g.slotId, 30 + random(300)]);
    const available = 100 + random(800);
    const v = render(d, Array(8).fill(30), labels, available);
    v.columns.forEach((column) => near(width(column), 30));
    v.rows.forEach((row, i) => assert.ok(v.rowWidths[i] <= available + 0.02 || row.start === row.end));
    for (const [id, required] of labels) assert.ok(width(region(v, id)) >= required - 0.02);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { pseudoPreview, widthsByToken, inputOverlayOffset } from '../src/pseudoPreview.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { computeLayout } from '../src/layout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { splitSlot } from '../src/tEditing.ts';
import { insertPseudoToken } from '../src/pseudoEditing.ts';
import { measureLabels } from '../src/labelMeasurements.ts';

const initial = (words = ['a', 'b', 'c']) => ({ version: 6, tokens: words.map(text => ({ id: text, slotId: `slot:${text}`, text })),
  slots: words.map(text => ({ id: `slot:${text}` })), groups: [], splits: [], arrows: [], translation: '訳文' });
const newSession = (document, index = 1, text = '') => ({ kind: 'create', borderIndex: index, text, composing: false,
  token: { id: 'pseudo', slotId: 'slot:pseudo', kind: 'pseudo', text: ' ' },
  before: { document: structuredClone(document), cursor: { x: 0, y: 0 } } });
function render(preview, widths, availableWidth = 1000, labels = new Map()) {
  const { document: d, inputTokenId } = preview;
  const layout = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
  const view = computeRenderLayout(d.tokens, d.groups, d.splits, widths, availableWidth, labels, undefined,
    { unclampedTokenId: inputTokenId });
  return { layout, view, arrows: renderArrows(layout, view.regionsBySlot, d.slots) };
}

test('a new draft occupies one token at every border, including empty documents, without changing saved state', () => {
  for (const words of [[], ['a'], ['a', 'b', 'c']]) {
    const d = initial(words);
    for (let index = 0; index <= words.length; index++) {
      const session = newSession(d, index);
      const before = structuredClone({ d, session });
      const preview = pseudoPreview(d, session);
      assert.equal(preview.inputTokenId, session.token.id);
      assert.equal(preview.document.tokens[index].text, '');
      assert.equal(preview.document.tokens[index].id, session.token.id);
      assert.equal(preview.document.tokens.length, d.tokens.length + 1);
      assert.equal(preview.document.slots.length, d.slots.length + 1);
      assert.deepEqual(preview.document.groups, d.groups);
      const rendered = render(preview, preview.document.tokens.map(() => 24));
      assert.equal(rendered.layout.tokenCount, d.tokens.length + 1);
      assert.equal(rendered.view.columns.length, d.tokens.length + 1);
      assert.deepEqual({ d, session }, before);
      assert.equal(pseudoPreview(d, null).document, d);
    }
  }
});

test('draft changes keep the same ID, preserve literal text and never touch the document or history snapshot', () => {
  const d = initial();
  const session = newSession(d);
  const before = JSON.stringify({ d, before: session.before });
  for (const text of ['', ' ', '   ', '日本語', 'a  b', '😀 <>&', 'IME変換候補']) {
    session.text = text;
    session.composing = true;
    const preview = pseudoPreview(d, session);
    assert.equal(preview.document.tokens[1].text, text);
    assert.equal(preview.document.tokens[1].id, 'pseudo');
    assert.equal(JSON.stringify({ d, before: session.before }), before);
  }
});

test('reediting replaces only display text and retains the token, slots, splits and structures even with an empty draft', () => {
  const token = newSession(initial()).token;
  let d = insertPseudoToken(initial(), 1, token).document;
  d = splitSlot(d, token.slotId, 't');
  const before = structuredClone(d);
  const session = { kind: 'edit', tokenId: token.id, text: '', composing: false,
    before: { document: structuredClone(d), cursor: { x: 2, y: 0 } } };
  const preview = pseudoPreview(d, session);
  assert.equal(preview.document.tokens.length, d.tokens.length);
  assert.equal(preview.document.tokens.filter(t => t.id === token.id).length, 1);
  assert.equal(preview.document.tokens[1].text, '');
  assert.deepEqual(preview.document.splits, d.splits);
  assert.deepEqual(preview.document.slots, d.slots);
  assert.equal(render(preview, [30, 24, 30, 30]).layout.logicalSize, 5);
  assert.deepEqual(d, before);
});

test('widths are keyed by token ID rather than shifted indices, and unknown drafts never borrow a neighbor width', () => {
  const d = initial();
  const widths = new Map([['a', 20], ['b', 40], ['c', 60]]);
  const preview = pseudoPreview(d, newSession(d, 1));
  assert.deepEqual(widthsByToken(preview.document.tokens, widths), [20, 1, 40, 60]);
  widths.set('pseudo', 100);
  assert.deepEqual(widthsByToken(preview.document.tokens, widths), [20, 100, 40, 60]);
  assert.deepEqual(widthsByToken(d.tokens, widths), [20, 40, 60]);
  assert.deepEqual(widthsByToken([...d.tokens].reverse(), widths), [60, 40, 20]);
});

test('growing and shrinking the draft pushes neighbors and reflows rows without accumulated padding', () => {
  const d = initial();
  const preview = pseudoPreview(d, newSession(d));
  const small = render(preview, [40, 24, 40, 40], 180).view;
  const large = render(preview, [40, 120, 40, 40], 180).view;
  assert.deepEqual(small.rows, [{ start: 0, end: 3 }]);
  assert.deepEqual(large.rows, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  assert.equal(small.columns[2].left, 84);
  assert.equal(large.columns[2].row, 1);
  const wider = render(preview, [40, 120, 40, 40], 1000).view;
  assert.equal(wider.columns[2].left, 180);
  assert.deepEqual(render(preview, [40, 24, 40, 40], 180).view, small);
});

test('only the active draft escapes the viewport clamp and an oversized input gets its own scrollable row', () => {
  const d = initial();
  const preview = pseudoPreview(d, newSession(d));
  const view = render(preview, [400, 900, 40, 40], 180).view;
  assert.equal(view.columns[0].right - view.columns[0].left, 180);
  assert.equal(view.columns[1].right - view.columns[1].left, 900);
  assert.equal(view.rowWidths[view.columns[1].row], 900);
  assert.deepEqual(view.rows, [{ start: 0, end: 0 }, { start: 1, end: 1 }, { start: 2, end: 3 }]);
  const withoutOverride = computeRenderLayout(preview.document.tokens, [], [], [400, 900, 40, 40], 180);
  assert.equal(withoutOverride.columns[1].right, 180);
});

test('underlines skip the provisional token and arrow endpoints follow the displaced real tokens and wrapping', () => {
  const d = initial();
  d.slots[0].marker = 'marker.adverb';
  d.arrows = [{ sourceSlotId: 'slot:a', targetSlotId: 'slot:c' }];
  d.groups.push({ id: 'g', slotId: 'group', kind: 'composite', slots: ['slot:a', 'slot:b', 'slot:c'] });
  d.slots.push({ id: 'group' });
  const preview = pseudoPreview(d, newSession(d));
  const small = render(preview, [40, 24, 40, 40]);
  const large = render(preview, [40, 124, 40, 40]);
  for (const r of [small, large]) {
    assert.equal(r.view.regionsBySlot.get('group').length, 2);
    assert.equal(r.layout.rangesBySlot.get('group').some(range => range.start <= 1 && range.end > 1), false);
  }
  const target = r => r.arrows.flatMap(a => a.stems).find(s => s.slotId === 'slot:c');
  assert.equal(target(large).x - target(small).x, 100);
  const wrapped = render(preview, [40, 124, 40, 40], 180);
  assert.ok(wrapped.arrows.length > 1);
  assert.equal(wrapped.view.columns[3].row, 1);
  // Both endpoints belong to this underline, even when they wrap onto different rows.
  assert.equal(target(wrapped).x, 70);
  assert.equal(wrapped.arrows.at(-1).right, 70);
});

test('existing label measurements include edit-preview text and retain split label widths independently', () => {
  const token = newSession(initial()).token;
  let d = insertPseudoToken(initial(), 1, token).document;
  d = splitSlot(d, token.slotId, 'd');
  d.slots.find(s => s.id === d.splits[0].leftSlotId).marker = 'marker.adverbialObjective';
  const session = { kind: 'edit', tokenId: token.id, text: '短', composing: false,
    before: { document: d, cursor: { x: 1, y: 0 } } };
  const preview = pseudoPreview(d, session);
  const measurements = measureLabels(preview.document.tokens, d.slots, d.groups, d.splits, d.arrows);
  assert.equal(measurements.tokens[1].token.text, '短');
  assert.equal(measurements.tokens[1].splitLabels[0][0], '副詞的目的格');
  // A 200px split label column surrounds the smaller 40px input anchor.
  const column = render(preview, [40, 200, 40, 40]).view.columns[1];
  const inputLeft = column.left + (column.right - column.left - 40) / 2;
  assert.equal(inputLeft, column.left + 80);
  assert.equal(column.right - column.left, 200);
});

test('persistent overlay coordinates follow the anchor across rows and scroll positions, not a fixed row edge', () => {
  const diagram = { left: 100, top: 200 };
  assert.deepEqual(inputOverlayOffset({ left: 230, top: 212 }, diagram, 0, 0), { left: 130, top: 12 });
  assert.deepEqual(inputOverlayOffset({ left: 150, top: 352 }, diagram, 0, 0), { left: 50, top: 152 });
  assert.deepEqual(inputOverlayOffset({ left: -70, top: 252 }, diagram, 200, 100), { left: 30, top: 152 });
  assert.deepEqual(inputOverlayOffset({ left: 115, top: 225 }, diagram, 0, 0, 1, 2), { left: 14, top: 23 });
});

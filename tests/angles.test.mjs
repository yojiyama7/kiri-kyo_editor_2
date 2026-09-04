import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { insertBracket, deleteBracket, bracketBorderFromRegion } from '../src/bracketEditing.ts';
import { isSavedState, isBracket, isBracketText, hasTokenSlot, isBasicToken, isSlotEditable, effectiveSlotMarker, createGroup, groupContentSlotIds } from '../src/model.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { realSentence } from '../src/pseudoEditing.ts';
import { computeLayout, slotPosition, slotAt, moveLeft, moveRight, selectSlotRange, toggleSlotSelection, relocateCursor } from '../src/layout.ts';
import { computeRenderLayout, CLOSE_BRACKET_WIDTH } from '../src/renderLayout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { connectArrow, connectApposition, deleteArrow, pruneArrows } from '../src/arrowEditing.ts';
import { settleBasicGroups } from '../src/groupEditing.ts';
import { splitSlot } from '../src/tEditing.ts';
import { setFormAtSlot } from '../src/formEditing.ts';
import { measureLabels } from '../src/labelMeasurements.ts';

const initial = () => ({ version: 6, translation: '', groups: [], splits: [], arrows: [],
  tokens: ['a', 'b', 'c'].map(text => ({ id: `token:${text}`, text, slotId: text })),
  slots: ['a', 'b', 'c'].map(id => ({ id })) });
const layoutOf = d => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
for (const [openText, closeText, kind] of [['<', '>', 'angle'], ['(', ')', 'paren']]) {
const brackets = () => insertBracket(insertBracket(initial(), 1, openText).document, 3, closeText).document;
function addGroup(d, ids) {
  const group = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(group); d.slots.push({ id: group.slotId });
  return group;
}

test(`${kind}: virtual brackets round-trip in v5/v6 with intrinsic ad and no editable label`, () => {
  const d = brackets();
  const open = d.tokens[1], close = d.tokens[3];
  assert.equal(open.kind, `${kind}-open`); assert.equal(close.kind, `${kind}-close`);
  for (const token of [open, close]) {
    assert.equal(isBracket(token), true);
    assert.equal(isBracketText(token.text), true);
    assert.equal(isBasicToken(token), false);
  }
  assert.equal(hasTokenSlot(open), true); assert.equal(hasTokenSlot(close), false);
  assert.equal(d.slots.length, 4);
  assert.equal(isSlotEditable(d, open.slotId), false);
  assert.equal(isSlotEditable(d, 'a'), true);
  assert.equal(isSlotEditable(d, 'missing'), false);
  assert.equal(effectiveSlotMarker(d, open.slotId), 'marker.adverb');
  assert.equal(effectiveSlotMarker(d, 'missing'), undefined);
  assert.deepEqual(d.slots.find(s => s.id === open.slotId), { id: open.slotId });
  assert.equal(realSentence(d.tokens), 'a b c');
  const labels = measureLabels(d.tokens, d.slots, d.groups, d.splits, d.arrows);
  assert.deepEqual(labels.tokens[1].labels, ['']);
  const connected = connectArrow(d, open.slotId, 'b');
  for (const value of [connected, { version: 7, entries: [{ id: 'entry', document: connected }] }]) {
    assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(value))).entries[0].document, connected);
  }
  assert.equal(isSavedState(initial()), true);
  for (const mutate of [
    d => { d.slots.find(s => s.id === open.slotId).marker = 'marker.adverb'; },
    d => { d.tokens[1].form = 'form.base'; },
    d => { d.tokens[3].form = 'form.base'; },
    d => { d.tokens[1].text = closeText; },
    d => { delete d.tokens[1].slotId; },
    d => { d.tokens[3].slotId = 'extra'; d.slots.push({ id: 'extra' }); },
  ]) {
    const invalid = structuredClone(d); mutate(invalid);
    assert.equal(isSavedState(invalid), false);
  }
});

test(`${kind}: navigation and selection include <, skip >, and support standalone brackets`, () => {
  const d = brackets(), id = d.tokens[1].slotId, layout = layoutOf(d);
  assert.deepEqual(moveRight(layout, { x: 0, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 2, y: 0 }), { x: 4, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 4, y: 0 }), { x: 2, y: 0 });
  assert.equal(slotAt(layout, 1, 0), id);
  assert.equal(slotAt(layout, 3, 0), undefined);
  assert.deepEqual(selectSlotRange(layout, { x: 0, y: 0 }, { x: 4, y: 0 }), ['a', id, 'b', 'c']);
  const selected = toggleSlotSelection(layout, [], { x: 1, y: 0 });
  assert.deepEqual(selected, [id]);
  assert.deepEqual(toggleSlotSelection(layout, selected, { x: 1, y: 0 }), []);
  assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, { x: 2, y: 0 }, openText), { ok: true, index: 2 });
  assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, { x: 2, y: 0 }, closeText), { ok: true, index: 3 });
  assert.equal(bracketBorderFromRegion(d.tokens, layout, { x: 1, y: 0 }, openText).ok, false);
  const empty = { ...initial(), tokens: [], slots: [] };
  for (const text of [openText, closeText]) {
    const only = insertBracket(empty, 0, text).document;
    assert.equal(isSavedState(only), true);
    assert.equal(layoutOf(only).slotY.size, text === openText ? 1 : 0);
    assert.deepEqual(deleteBracket(only, 0), empty);
  }
});

test(`${kind}: underline creation excludes selected virtual brackets before classifying the remaining contents`, () => {
  let d = brackets(); const id = d.tokens[1].slotId;
  const group = addGroup(d, [id, 'b']);
  assert.deepEqual(group.slots, ['b']);
  assert.equal(group.kind, 'basic');
  d = settleBasicGroups(d, { x: 0, y: 0 }, null, true).document;
  assert.equal(d.groups[0].kind, 'basic');
  assert.equal(slotAt(layoutOf(d), 1, 0), id);
  assert.equal(isSavedState(d), true);
  assert.equal(setFormAtSlot(d, id, 'form.base'), d);
  for (const kind of ['t', 'd']) {
    assert.equal(splitSlot(d, id, kind), d);
    const invalid = structuredClone(d);
    invalid.splits.push({ slotId: id, leftSlotId: 'left', rightSlotId: 'right', kind });
    invalid.slots.push({ id: 'left' }, { id: 'right' });
    assert.equal(isSavedState(invalid), false);
  }
  const view = computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 50), 1000);
  assert.equal(view.regionsBySlot.get(group.slotId)[0].arrowAttachment, undefined);
});

test(`${kind}: range and individual selections retain virtual brackets, but underline contents omit all of them`, () => {
  const d = insertBracket(brackets(), 3, openText).document;
  const first = d.tokens[1].slotId, second = d.tokens[3].slotId;
  const layout = layoutOf(d);
  const range = selectSlotRange(layout, { x: 0, y: 0 }, { x: 5, y: 0 });
  let individual = [];
  for (const x of [0, 1, 2, 3, 5]) individual = toggleSlotSelection(layout, individual, { x, y: 0 });
  for (const selected of [range, individual]) {
    assert.ok(selected.includes(first) && selected.includes(second));
    const group = createGroup(d.tokens, d.slots, selected);
    assert.deepEqual(group.slots, ['a', 'b', 'c']);
    assert.equal(group.kind, 'basic');
    assert.ok(selected.includes(first) && selected.includes(second));
  }
  assert.deepEqual(groupContentSlotIds(d.tokens, [first, second]), []);
  assert.throws(() => createGroup(d.tokens, d.slots, [first, second]));
  d.slots.find(s => s.id === 'b').marker = 'marker.subject';
  assert.equal(createGroup(d.tokens, d.slots, [first, 'b']).kind, 'composite');
  const square = insertBracket(d, 0, '[').document;
  const squareId = square.tokens[0].slotId;
  assert.deepEqual(createGroup(square.tokens, square.slots, [first, squareId]).slots, [squareId]);
});

test(`${kind}: virtual bracket arrows accept incoming/outgoing modifiers, replace destinations, and survive pruning`, () => {
  let d = brackets(); const id = d.tokens[1].slotId;
  d.slots[0].marker = 'marker.adverb';
  d = connectArrow(connectArrow(d, 'a', id), id, 'b');
  assert.equal(isSavedState(d), true);
  assert.equal(pruneArrows(d), d);
  assert.equal(connectArrow(d, id, id), d);
  assert.equal(connectArrow(d, id, 'missing'), d);
  assert.equal(connectArrow(d, 'missing', id), d);
  d = connectArrow(d, id, 'c');
  assert.deepEqual(d.arrows, [{ sourceSlotId: 'a', targetSlotId: id }, { sourceSlotId: id, targetSlotId: 'c' }]);
  d = deleteArrow(d, id);
  assert.deepEqual(d.arrows, [{ sourceSlotId: 'a', targetSlotId: id }]);
  assert.equal(effectiveSlotMarker(d, id), 'marker.adverb');
  assert.equal(connectArrow(d, id, 'b').arrows.length, 2);
});

test(`${kind}: intrinsic ad rejects apposition both in editing and saved-state validation`, () => {
  const d = brackets(), id = d.tokens[1].slotId;
  d.slots[0].marker = 'marker.noun';
  assert.equal(connectApposition(d, 'a', id), d);
  assert.equal(connectApposition(d, id, 'a'), d);
  for (const [sourceSlotId, targetSlotId] of [['a', id], [id, 'a']]) {
    const invalid = { ...d, arrows: [{ sourceSlotId, targetSlotId, kind: 'apposition' }] };
    assert.equal(isSavedState(invalid), false);
    assert.deepEqual(pruneArrows(invalid).arrows, []);
  }
});

test(`${kind}: saved explicit membership still loads and deletes dependent groups, splits and arrows`, () => {
  let d = brackets(); const id = d.tokens[1].slotId;
  d.slots[0].marker = 'marker.adverb';
  d = connectArrow(connectArrow(d, 'a', id), id, 'b');
  const child = addGroup(d, [id, 'b']);
  // Existing explicit memberships keep their saved structures.
  child.slots = [id, 'b']; child.kind = 'composite';
  assert.deepEqual(readEntryDocument(d).entries[0].document, d);
  d = splitSlot(d, child.slotId, 'd');
  addGroup(d, [d.splits[0].leftSlotId, 'c']);
  const next = deleteBracket(d, 1);
  assert.equal(isSavedState(next), true);
  assert.deepEqual(next.arrows, []); assert.deepEqual(next.groups, []); assert.deepEqual(next.splits, []);
  assert.deepEqual(next.slots, d.slots.filter(s => ['a', 'b', 'c'].includes(s.id)));
  assert.equal(next.tokens[2].text, closeText);
  assert.deepEqual(relocateCursor(layoutOf(d), layoutOf(next), slotPosition(layoutOf(d), id)), { x: 1, y: 0 });
});

test(`${kind}: narrow virtual brackets attach arrows at the glyph bottom across wrapping and simultaneous input/output`, () => {
  for (const destination of ['a', 'c']) {
    let d = brackets(); const id = d.tokens[1].slotId;
    d.slots[0].marker = 'marker.adverb';
    d = connectArrow(connectArrow(d, 'a', id), id, destination);
    for (const width of [1000, 50, 1]) {
      const view = computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 50), width);
      for (const index of [1, 3]) assert.equal(view.columns[index].right - view.columns[index].left, CLOSE_BRACKET_WIDTH);
      const region = view.regionsBySlot.get(id)[0];
      assert.equal(region.left, view.columns[1].left);
      const arrows = renderArrows(layoutOf(d), view.regionsBySlot, d.slots, view.columns);
      const stems = arrows.flatMap(a => a.stems).filter(s => s.slotId === id);
      const incoming = stems.find(s => s.target), outgoing = stems.find(s => !s.target);
      assert.equal(incoming.x, region.right - 1);
      assert.equal(incoming.y, 28); assert.equal(outgoing.y, 28);
      assert.notEqual(incoming.x, outgoing.x);
      assert.equal(outgoing.attachmentX, incoming.x);
      assert.ok(arrows.every(a => a.logicalY > 0 && Number.isFinite(a.left) && Number.isFinite(a.right)));
      if (destination === 'c' && width <= 50) {
        assert.ok(arrows.some(a => a.row === view.columns[3].row && a.stems.length === 0));
      }
    }
  }
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.token\.angle-open, \.token\.angle-close\s*\{[^}]*align-self: stretch/);
  assert.match(css, /\.angle-selection\s*\{[^}]*inset: 0;[^}]*height: 100%/);
  for (const state of ['current', 'selected', 'arrow-source']) assert.ok(css.includes(`.angle-selection.${state}`));
});

}

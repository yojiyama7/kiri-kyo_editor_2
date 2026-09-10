import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { bracketBorderFromRegion, insertBracket, deleteBracket } from '../src/bracketEditing.ts';
import { createGroup, isSavedState, hasBasicContents, hasTokenSlot, isBasicToken, isBracket, isBracketText } from '../src/model.ts';
import { computeLayout, slotAt, slotPosition, moveLeft, moveRight, moveToRowEdge, nearestCursor, selectSlotRange, groupLineSegments, relocateCursor } from '../src/layout.ts';
import { cursorFromBorder } from '../src/borderNavigation.ts';
import { computeRenderLayout, BRACKET_GUTTER, BRACKET_SLOT_MIN_WIDTH } from '../src/renderLayout.ts';
import { renderArrows } from '../src/arrowRender.ts';
import { splitSlot } from '../src/tEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { insertPseudoToken, realSentence, replaceEnglishSentence } from '../src/pseudoEditing.ts';
import { connectArrow, connectApposition } from '../src/arrowEditing.ts';
import { setSlotMarker } from '../src/markers.ts';

const initial = (words = ['a', 'b', 'c']) => ({ translation: '訳文', groups: [], splits: [], arrows: [],
  tokens: words.map(text => ({ id: `token:${text}`, text, slotId: text })), slots: words.map(id => ({ id })) });
const layoutOf = d => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
function insert(d, x, text) {
  const result = insertBracket(d, x, text);
  assert.equal(result.ok, true, result.message);
  assert.equal(isSavedState(result.document), true);
  return result.document;
}
function group(d, ids) {
  const g = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(g);
  d.slots.push({ id: g.slotId });
  return g;
}

test('brackets round-trip in v8 without a dummy closing slot and never enter English source', () => {
  for (const words of [[], ['a', 'b', 'c']]) {
    const d = insert(insert(initial(words), 0, '['), words.length + 1, ']');
    assert.equal(d.slots.length, words.length + 1);
    assert.equal(d.tokens.at(-1).slotId, undefined);
    assert.equal(readEntryDocument(JSON.parse(JSON.stringify(d))), undefined);
    assert.deepEqual(readEntryDocument({ version: 8, entries: [{ id: 'entry', document: d }] }).entries[0].document, d);
    assert.equal(realSentence(d.tokens), words.join(' '));
    assert.equal(replaceEnglishSentence(d, words.join(' ')), d);
    const replaced = replaceEnglishSentence(d, 'new sentence');
    assert.equal(replaced.tokens.length, 2);
    assert.ok(replaced.tokens.every(t => t.kind === 'real'));
    assert.equal(replaced.translation, d.translation);
  }
  assert.equal(isSavedState(initial()), true);
  const close = insert(initial(), 0, ']');
  close.tokens[0].slotId = 'fake'; close.slots.push({ id: 'fake' });
  assert.equal(isSavedState(close), false);
  const wrong = insert(initial(), 0, '['); wrong.tokens[0].text = ']';
  assert.equal(isSavedState(wrong), false);
});

test('normal navigation stops on [ but skips consecutive closing brackets at all edges', () => {
  let d = insert(initial(['a', 'b']), 0, ']');
  d = insert(d, 2, '['); d = insert(d, 3, ']'); d = insert(d, 4, ']'); d = insert(d, 6, ']');
  const layout = layoutOf(d);
  const opening = d.tokens[2].slotId;
  assert.equal(layout.logicalSize, 7);
  assert.equal(slotAt(layout, 0, 0), undefined);
  assert.equal(slotAt(layout, 2, 0), opening);
  assert.deepEqual(moveRight(layout, { x: 1, y: 0 }), { x: 2, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 2, y: 0 }), { x: 5, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 5, y: 0 }), { x: 2, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 5, y: 0 }), { x: 5, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 2, y: 0 }, 'start'), { x: 1, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 2, y: 0 }, 'end'), { x: 5, y: 0 });
  assert.deepEqual(selectSlotRange(layout, { x: 1, y: 0 }, { x: 5, y: 0 }), ['a', opening, 'b']);
  assert.deepEqual(cursorFromBorder(layout, 0), { x: 1, y: 0 });
  assert.deepEqual(cursorFromBorder(layout, 3), { x: 5, y: 0 });
  assert.deepEqual(cursorFromBorder(layout, 7), { x: 5, y: 0 });
  const onlyClose = layoutOf(insert(insert(initial([]), 0, ']'), 0, ']'));
  assert.equal(onlyClose.logicalSize, 2);
  assert.equal(onlyClose.slotY.size, 0);
  assert.deepEqual(nearestCursor(onlyClose, { x: 1, y: 0 }), { x: 0, y: 0 });
  assert.equal(slotAt(onlyClose, 0, 0), undefined);
});

test('[ groups stay composite with a visible y=0 dedicated slot and cannot split', () => {
  let d = insert(initial(), 1, '[');
  const opening = d.tokens[1].slotId;
  assert.equal(hasBasicContents(d.tokens, d.slots, [opening, 'b']), false);
  const g = group(d, [opening, 'b']);
  assert.equal(g.kind, 'composite');
  const layout = layoutOf(d);
  assert.equal(d.groups[0].kind, 'composite');
  assert.equal(layout.slotY.get(g.slotId), 1);
  assert.equal(slotAt(layout, 1, 0), opening);
  assert.equal(slotAt(layout, 1, 1), g.slotId);
  assert.deepEqual(layout.bracketRanges, [{ start: 1, end: 2 }]);
  for (const kind of ['t', 'd']) {
    assert.equal(splitSlot(d, opening, kind), d);
    const invalid = structuredClone(d);
    invalid.splits.push({ slotId: opening, leftSlotId: 'left', rightSlotId: 'right', kind });
    invalid.slots.push({ id: 'left' }, { id: 'right' });
    assert.equal(isSavedState(invalid), false);
  }
  const invalidBasic = structuredClone(d); invalidBasic.groups[0].kind = 'basic';
  assert.equal(isSavedState(invalidBasic), false);
  // Occupancy is also honored by the layout itself, regardless of caller classification.
  assert.equal(layoutOf(invalidBasic).groups[0].y, 1);
});

test('inserting any bracket preserves sparse groups, allows sparse T sources, rejects sparse D sources and deletes dependents only', () => {
  for (const char of ['[', ']', '(', ')', '<', '>']) {
    const d = initial(); const g = group(d, ['a', 'b', 'c']);
    const inserted = insert(d, 1, char);
    assert.deepEqual(inserted.groups, d.groups);
    const layout = layoutOf(inserted);
    assert.equal(slotAt(layout, 1, 0), inserted.tokens[1].slotId);
    assert.deepEqual(groupLineSegments(layout, layout.groups[0]).map(s => [s.start, s.end]), [[0, 0], [2, 3]]);
    for (const kind of ['t', 'd']) {
      const split = splitSlot(d, g.slotId, kind);
      assert.equal(insertBracket(split, 1, char).ok, kind === 't');
      assert.equal(insertBracket(split, 0, char).ok, true);
      assert.equal(insertBracket(split, 3, char).ok, true);
    }
    assert.deepEqual(deleteBracket(inserted, 1), d);
  }
  let d = insert(initial(), 1, '['); const opening = d.tokens[1].slotId;
  const child = group(d, [opening, 'b']);
  d = splitSlot(d, child.slotId, 'd');
  group(d, [d.splits[0].leftSlotId, 'c']);
  d.slots = setSlotMarker(d.slots, opening, 'marker.adverb'); d = connectArrow(d, opening, 'a');
  const next = deleteBracket(d, 1);
  assert.deepEqual(next.tokens, initial().tokens);
  assert.deepEqual(next.slots, initial().slots);
  assert.deepEqual(next.groups, []); assert.deepEqual(next.arrows, []); assert.deepEqual(next.splits, []);
  assert.equal(isSavedState(next), true);
  assert.equal(deleteBracket(d, 0), d);
  for (const index of [-1, 100, 0.5, NaN]) assert.equal(insertBracket(d, index, '[').ok, false);
  const before = layoutOf(d); const after = layoutOf(next);
  assert.deepEqual(relocateCursor(before, after, slotPosition(before, opening)), { x: 1, y: 0 });
});

test('parentheses are non-basic brackets with a virtual opening slot and round-trip without forms in v8', () => {
  for (const text of ['(', ')']) {
    for (const words of [[], ['a', 'b']]) {
      const before = initial(words);
      const d = insert(before, 0, text);
      const token = d.tokens[0];
      assert.equal(token.kind, text === '(' ? 'paren-open' : 'paren-close');
      assert.equal(isBracket(token), true);
      assert.equal(isBracketText(text), true);
      assert.equal(hasTokenSlot(token), text === '(');
      assert.equal(isBasicToken(token), false);
      assert.equal(Object.hasOwn(token, 'slotId'), text === '(');
      assert.deepEqual(d.slots, text === '(' ? [...before.slots, { id: token.slotId }] : before.slots);
      assert.deepEqual(deleteBracket(d, 0), before);
      assert.equal(readEntryDocument(JSON.parse(JSON.stringify(d))), undefined);
      assert.deepEqual(readEntryDocument({ version: 8, entries: [{ id: 'entry', document: d }] }).entries[0].document, d);
      assert.equal(realSentence(d.tokens), words.join(' '));
      assert.equal(replaceEnglishSentence(d, words.join(' ')), d);
      assert.ok(replaceEnglishSentence(d, 'new sentence').tokens.every(t => t.kind === 'real'));
      for (const fields of [text === '(' ? { slotId: undefined } : { slotId: 'fake' }, { form: 'form.base' }, { text: text === '(' ? ')' : '(' }, { text: '[' }]) {
        const invalid = structuredClone(d);
        Object.assign(invalid.tokens[0], fields);
        if (fields.slotId) invalid.slots.push({ id: fields.slotId });
        assert.equal(isSavedState(invalid), false);
      }
    }
  }
  for (const text of ['', 'a', '（', '）', '{}']) assert.equal(isBracketText(text), false);
});

test('navigation and selection stop on opening parentheses and skip closing parentheses', () => {
  const d = initial([]);
  for (const text of ['(', 'a', ')', '(', '[', ')', 'b', ')', '(']) {
    if (text === 'a' || text === 'b') {
      d.tokens.push({ id: `token:${text}`, text, slotId: text }); d.slots.push({ id: text });
    } else Object.assign(d, insert(d, d.tokens.length, text));
  }
  const layout = layoutOf(d);
  const squareSlot = d.tokens[4].slotId;
  assert.deepEqual(new Set(d.slots.map(s => s.id)), new Set([d.tokens[0].slotId, 'a', d.tokens[3].slotId, squareSlot, 'b', d.tokens[8].slotId]));
  assert.deepEqual(moveRight(layout, { x: 1, y: 0 }), { x: 3, y: 0 });
  assert.deepEqual(moveRight(layout, { x: 4, y: 0 }), { x: 6, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 6, y: 0 }), { x: 4, y: 0 });
  assert.deepEqual(moveLeft(layout, { x: 4, y: 0 }), { x: 3, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 4, y: 0 }, 'start'), { x: 0, y: 0 });
  assert.deepEqual(moveToRowEdge(layout, { x: 4, y: 0 }, 'end'), { x: 8, y: 0 });
  assert.deepEqual(selectSlotRange(layout, { x: 1, y: 0 }, { x: 6, y: 0 }), ['a', d.tokens[3].slotId, squareSlot, 'b']);
  for (const [border, x] of [[0, 0], [2, 3], [5, 6], [9, 8]]) assert.deepEqual(cursorFromBorder(layout, border), { x, y: 0 });
  for (const index of [2, 5, 7]) assert.equal(slotAt(layout, index, 0), undefined);
  const only = layoutOf(insert(insert(initial([]), 0, '('), 1, ')'));
  assert.equal(only.slotY.size, 1);
  assert.deepEqual(nearestCursor(only, { x: 1, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(selectSlotRange(only, { x: 0, y: 0 }, { x: 1, y: 0 }), [slotAt(only, 0, 0)]);
});

test('parentheses reserve narrow columns and y=0 occupancy, including wrapped slotless rows', () => {
  let d = insert(insert(initial(['a', 'b']), 1, '('), 2, ')');
  d.slots = setSlotMarker(d.slots, 'a', 'marker.adverb'); d = connectArrow(d, 'a', 'b');
  const layout = layoutOf(d);
  assert.deepEqual(layout.bracketRanges, [{ start: 1, end: 2 }, { start: 2, end: 3 }]);
  assert.ok(layout.arrows[0].y > 0);
  for (const width of [1000, 50, 1]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, [50, 999, 999, 50], width);
    for (const index of [1, 2]) assert.equal(view.columns[index].right - view.columns[index].left, 10);
    assert.deepEqual([...view.regionsBySlot.keys()], ['a', d.tokens[1].slotId, 'b']);
    const arrows = renderArrows(layout, view.regionsBySlot, d.slots, view.columns);
    assert.ok(arrows.every(a => a.logicalY > 0 && Number.isFinite(a.left) && Number.isFinite(a.right)));
    if (width <= 50) assert.ok(arrows.some(a => a.row === view.columns[1].row && a.stems.length === 0));
  }
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.token\.paren-open, \.token\.paren-close\s*\{[^}]*align-self: stretch/);
  assert.match(css, /\.paren-open > \.bracket-glyph\s*\{[^}]*border-right: 0;[^}]*border-radius:/);
  assert.match(css, /\.paren-close > \.bracket-glyph\s*\{[^}]*border-left: 0;[^}]*border-radius:/);
  assert.doesNotMatch(css, /\.token\.paren-(?:open|close)\s*\{[^}]*padding/);
});

test('bracket slots reserve outer width on the left for markers, lines and arrow stems; slotless rows carry wrapped arrows', () => {
  let d = insert(insert(initial(['a', 'b']), 1, '['), 2, ']');
  const opening = d.tokens[1].slotId;
  d.slots = setSlotMarker(d.slots, opening, 'marker.adverb');
  d = connectArrow(d, opening, 'b');
  for (const width of [1000, 50, 1]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, [50, 90, 10, 50], width);
    const outer = view.regionsBySlot.get(opening)[0]; const column = view.columns[1];
    assert.equal(outer.left, column.left);
    assert.equal(outer.right, column.right - BRACKET_GUTTER);
    assert.ok(outer.right - outer.left >= BRACKET_SLOT_MIN_WIDTH);
    assert.equal(view.columns[2].right - view.columns[2].left, 10);
    assert.equal(view.regionsBySlot.has(undefined), false);
    const layout = layoutOf(d);
    const arrows = renderArrows(layout, view.regionsBySlot, d.slots, view.columns);
    const stem = arrows.flatMap(a => a.stems).find(s => s.slotId === opening);
    assert.equal(stem.x, (outer.left + outer.right) / 2);
    assert.ok(arrows.every(a => a.logicalY > 0 && Number.isFinite(a.left) && Number.isFinite(a.right)));
    if (width <= 50) assert.ok(arrows.some(a => a.row === view.columns[2].row && a.stems.length === 0));
  }
  d = insert(initial(['a', 'b']), 1, '[');
  const emptyOpening = d.tokens[1].slotId;
  d.slots = setSlotMarker(d.slots, 'b', 'marker.noun');
  d = connectApposition(d, 'b', emptyOpening);
  assert.equal(isSavedState(d), true);
  assert.equal(layoutOf(d).arrows[0].y, 1);
  const g = group(d, [emptyOpening, 'b']);
  const view = computeRenderLayout(d.tokens, d.groups, d.splits, [50, 36, 50], 1000);
  assert.equal(view.regionsBySlot.get(g.slotId)[0].left, view.columns[1].left);
});

test('bracket drawing stretches with the first grid track and keeps the slot outside the glyph', () => {
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  const glyph = css.match(/\.bracket-glyph\s*\{([^}]+)\}/)[1];
  assert.match(glyph, /position: absolute/); assert.match(glyph, /top: 0/); assert.match(glyph, /bottom: 0/);
  assert.doesNotMatch(glyph, /(?:^|;)\s*height:/);
  assert.match(css, /\.token\.bracket-open, \.token\.bracket-close\s*\{[^}]*align-self: stretch/);
  assert.match(css, /\.token\.bracket-open\s*\{[^}]*padding-right: var\(--bracket-gutter\)/);
  assert.match(css, /\.bracket-open > \.bracket-glyph\s*\{[^}]*right: 0;/);
});

test('normal bracket borders use recursive members of the current logical region, regardless of wrapping or renumbering', () => {
  let d = initial(['a', 'b', 'c', 'd', 'e', 'f']);
  const child = group(d, ['b', 'c']);
  const parent = group(d, [child.slotId, 'e']);
  const outer = group(d, [parent.slotId]);
  for (const split of [false, true]) {
    if (split) d = splitSlot(d, 'a');
    const layout = layoutOf(d);
    for (const [tokenId, expectedLeft, expectedRight] of [['c', 1, 3], ['e', 4, 5]]) {
      const cursor = { x: slotPosition(layout, tokenId).x, y: layout.slotY.get(outer.slotId) };
      for (const width of [1000, 50]) {
        computeRenderLayout(d.tokens, d.groups, d.splits, d.tokens.map(() => 40), width);
        assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, cursor, '['), { ok: true, index: expectedLeft });
        assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, cursor, ']'), { ok: true, index: expectedRight });
      }
    }
  }
});

test('normal bracket borders accept real and pseudo tokens, but refuse bracket endpoints independently by direction', () => {
  let d = insertPseudoToken(initial(), 1, { id: 'pseudo', slotId: 'pseudo-slot', kind: 'pseudo', text: '補足' }).document;
  for (const [slot, index] of [['a', 0], ['pseudo-slot', 1], ['c', 3]]) {
    const layout = layoutOf(d); const cursor = slotPosition(layout, slot);
    assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, cursor, '['), { ok: true, index });
    assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, cursor, ']'), { ok: true, index: index + 1 });
  }
  d = insert(initial(), 1, '['); const opening = d.tokens[1].slotId;
  const g = group(d, [opening, 'b']); const other = group(d, ['a', opening]);
  const layout = layoutOf(d);
  assert.equal(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, g.slotId), '[').ok, false);
  assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, g.slotId), ']'), { ok: true, index: 3 });
  assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, other.slotId), '['), { ok: true, index: 0 });
  assert.equal(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, other.slotId), ']').ok, false);
  for (const text of ['[', ']', '(', ')', '<', '>']) {
    assert.match(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, opening), text).message, /基礎スロット/);
    for (const empty of [initial([]), insert(initial([]), 0, ']')]) {
      assert.match(bracketBorderFromRegion(empty.tokens, layoutOf(empty), { x: 0, y: 0 }, text).message, /選択されていません/);
    }
  }
});

test('normal bracket borders reject fractional T/D edges without rounding and allow aligned edges through preflight', () => {
  for (const [open, close] of [['[', ']'], ['(', ')']]) {
  for (const kind of ['t', 'd']) {
    let d = splitSlot(initial(), 'b', kind);
    let layout = layoutOf(d);
    const split = d.splits[0];
    assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, split.leftSlotId), open), { ok: true, index: 1 });
    assert.deepEqual(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, split.rightSlotId), close), { ok: true, index: 2 });
    assert.match(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, split.leftSlotId), close).message, /途中/);
    assert.match(bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, split.rightSlotId), open).message, /途中/);
    d = initial(); const g = group(d, ['a', 'b']); d = splitSlot(d, g.slotId, kind); layout = layoutOf(d);
    const aligned = bracketBorderFromRegion(d.tokens, layout, slotPosition(layout, d.splits[0].leftSlotId), close);
    assert.deepEqual(aligned, { ok: true, index: 1 });
    assert.equal(insertBracket(d, aligned.index, close).ok, kind === 't');
    assert.equal(insertBracket(d, 0, open).ok, true);
  }
  }
});

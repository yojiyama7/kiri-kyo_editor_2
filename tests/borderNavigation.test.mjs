import assert from 'node:assert/strict';
import test from 'node:test';
import { borderFromCursor, cursorFromBorder, moveBorder, borderPosition } from '../src/borderNavigation.ts';
import { computeLayout, slotAt } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { splitSlot } from '../src/tEditing.ts';
import { EditHistory } from '../src/history.ts';
import { isSavedState } from '../src/model.ts';
import { readEntryDocument } from '../src/entryDocument.ts';

const documentOf = (words = ['a', 'b', 'c', 'd']) => ({
  version: 6, translation: '', groups: [], splits: [], arrows: [],
  tokens: words.map(text => ({ id: `token:${text}`, text, slotId: text })),
  slots: words.map(id => ({ id })),
});
const layoutOf = d => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const slotAtCursor = (layout, cursor) => slotAt(layout, cursor.x, cursor.y);
const keyInput = key => ({ key });
function addGroup(d, id, slots, kind = 'basic') {
  d.groups.push({ id, slotId: id, slots, kind });
  d.slots.push({ id });
  return d;
}

test('b starts before the current token regardless of normal cursor height', () => {
  const layout = layoutOf(addGroup(documentOf(), 'group', ['b', 'c'], 'composite'));
  for (const y of [0, 1]) {
    assert.equal(borderFromCursor(layout, { x: 2, y }), 2);
    assert.deepEqual(cursorFromBorder(layout, 2), { x: 2, y: 0 });
  }
});

test('left/right visit exactly N+1 borders, clamp at the ends and allow repeats', () => {
  for (const n of [0, 1, 4]) {
    for (const [right, left] of [['l', 'h'], ['ArrowRight', 'ArrowLeft']]) {
      let index = 0;
      const visited = [index];
      for (let step = 0; step < n; step++) visited.push(index = moveBorder(index, n, keyInput(right)));
      assert.deepEqual(visited, Array.from({ length: n + 1 }, (_, i) => i));
      assert.equal(moveBorder(index, n, keyInput(right)), n);
      for (let step = n; step > 0; step--) assert.equal(index = moveBorder(index, n, keyInput(left)), step - 1);
      assert.equal(moveBorder(index, n, keyInput(left)), 0);
      assert.equal(moveBorder(0, n, keyInput('$')), n);
      assert.equal(moveBorder(n, n, keyInput('0')), 0);
    }
  }
});

test('vertical navigation and slot-edit keys do not move a border', () => {
  for (const key of ['j', 'k', 'ArrowUp', 'ArrowDown', 'a', 't', 'd', 'x', 'X', 'v', 'r', 'R', 'i', 'Tab', 'Enter', ' ', 'b']) {
    assert.equal(moveBorder(2, 4, keyInput(key)), 2, key);
  }
});

test('empty and one-token documents return a valid normal cursor', () => {
  const empty = layoutOf(documentOf([]));
  assert.equal(borderFromCursor(empty, { x: 0, y: 0 }), 0);
  assert.deepEqual(cursorFromBorder(empty, 0), { x: 0, y: 0 });
  assert.equal(slotAtCursor(empty, cursorFromBorder(empty, 0)), undefined);
  const single = layoutOf(documentOf(['a']));
  for (const index of [0, 1]) assert.equal(slotAtCursor(single, cursorFromBorder(single, index)), 'a');
});

for (const kind of ['t', 'd']) {
  test(`${kind}: split halves are not borders; Esc selects the nearest side`, () => {
    let d = splitSlot(documentOf(), 'b', kind);
    d = splitSlot(d, 'd', kind);
    const layout = layoutOf(d);
    assert.ok(layout.logicalSize > layout.tokenCount);
    for (const atom of layout.atoms) {
      assert.equal(borderFromCursor(layout, { x: atom.start, y: 0 }), atom.tokenIndex);
    }
    assert.equal(slotAtCursor(layout, cursorFromBorder(layout, 1)), d.splits[0].leftSlotId);
    assert.equal(slotAtCursor(layout, cursorFromBorder(layout, 4)), d.splits[1].rightSlotId);
    assert.equal(moveBorder(3, layout.tokenCount, keyInput('l')), 4);
    assert.equal(moveBorder(4, layout.tokenCount, keyInput('l')), 4);
  });

  test(`${kind}: a split basic underline stays closed on return`, () => {
    const d = splitSlot(addGroup(documentOf(), 'group', ['a', 'b', 'c', 'd']), 'group', kind);
    const before = structuredClone(d);
    const layout = layoutOf(d);
    assert.equal(slotAtCursor(layout, cursorFromBorder(layout, 0)), d.splits[0].leftSlotId);
    assert.equal(slotAtCursor(layout, cursorFromBorder(layout, 4)), d.splits[0].rightSlotId);
    assert.deepEqual(d, before);
    assert.equal(d.groups[0].kind, 'basic');
  });
}

test('basic, sparse and composite underlines do not skip token borders or change structure', () => {
  const d = addGroup(addGroup(documentOf(), 'sparse', ['a', 'c']), 'parent', ['sparse', 'd'], 'composite');
  const before = structuredClone(d);
  const layout = layoutOf(d);
  assert.deepEqual([0, 1, 2, 3, 4].map(index => slotAtCursor(layout, cursorFromBorder(layout, index))),
    ['sparse', 'b', 'sparse', 'd', 'd']);
  for (const atom of layout.atoms) assert.equal(borderFromCursor(layout, { x: atom.start, y: 1 }), atom.tokenIndex);
  assert.deepEqual(d, before);
});

test('rendering uses gap midpoints, right-hand row starts at wraps, and the final token edge', () => {
  const d = documentOf();
  const view = computeRenderLayout(d.tokens, [], [], [30, 40, 50, 60], 100);
  assert.deepEqual(borderPosition(view.columns, 0), { row: 0, left: 0 });
  assert.deepEqual(borderPosition(view.columns, 1), { row: 0, left: 35 });
  assert.deepEqual(borderPosition(view.columns, 2), { row: 1, left: 0 });
  assert.deepEqual(borderPosition(view.columns, 3), { row: 2, left: 0 });
  assert.deepEqual(borderPosition(view.columns, 4), { row: 2, left: 60 });
  assert.deepEqual(borderPosition([], 0), { row: 0, left: 0 });
});

test('reflow and label padding change geometry, not the logical border', () => {
  const d = addGroup(documentOf(), 'group', ['b', 'c'], 'composite');
  const widths = [30, 40, 50, 60];
  const narrow = computeRenderLayout(d.tokens, d.groups, [], widths, 100);
  const wide = computeRenderLayout(d.tokens, d.groups, [], widths, 500, new Map([['group', 240]]));
  const index = 2;
  assert.equal(borderPosition(narrow.columns, index).row, 1);
  assert.deepEqual(borderPosition(wide.columns, index), {
    row: 0, left: (wide.columns[1].right + wide.columns[2].left) / 2,
  });
  assert.equal(index, 2);
  assert.deepEqual(cursorFromBorder(layoutOf(d), index), { x: 2, y: 0 });
});

test('border navigation leaves document, saved schema, undo and redo intact', () => {
  const document = documentOf();
  const edited = { ...structuredClone(document), translation: 'translation' };
  const before = { document, cursor: { x: 0, y: 0 } };
  const after = { document: edited, cursor: { x: 1, y: 0 } };
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  const serialized = JSON.stringify(document);
  const layout = layoutOf(document);
  let prior = before;
  let border = borderFromCursor(layout, before.cursor);
  for (const key of ['l', '$', 'h', '0']) {
    border = moveBorder(border, document.tokens.length, keyInput(key));
    const next = { document, cursor: cursorFromBorder(layout, border) };
    history.record(prior, next);
    prior = next;
  }
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  assert.equal(history.redo(), undefined);
  assert.equal(JSON.stringify(document), serialized);
  assert.equal(isSavedState(document), true);
  assert.deepEqual(readEntryDocument({ version: 7, entries: [{ id: 'entry', document }] }).entries[0].document, document);
});

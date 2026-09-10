import assert from 'node:assert/strict';
import test from 'node:test';
import { insertPseudoToken, insertPseudoTokens, deletePseudoToken, editPseudoToken, pseudoTokenAtSlot, realSentence, replaceEnglishSentence, splitPseudoInput, pseudoInputAction } from '../src/pseudoEditing.ts';
import { isSavedState, createGroup } from '../src/model.ts';
import { computeLayout, slotAt } from '../src/layout.ts';
import { splitSlot } from '../src/tEditing.ts';
import { readEntryDocument, insertEnglishEntries } from '../src/entryDocument.ts';
import { createExampleDocument } from '../src/example.ts';
import { setSlotMarker } from '../src/markers.ts';
import { connectArrow } from '../src/arrowEditing.ts';
import { resolveInput } from '../src/keybindings.ts';
import { EditHistory } from '../src/history.ts';

const initial = (words = ['a', 'b', 'c']) => ({
  translation: '', groups: [], splits: [], arrows: [],
  tokens: words.map(text => ({ id: `token:${text}`, text, slotId: text })),
  slots: words.map(id => ({ id })),
});
const pseudo = (text = ' 疑似 token / <>& 😀 ', id = 'pseudo') => ({ id, slotId: `slot:${id}`, kind: 'pseudo', text });
function insert(d, index, token = pseudo()) {
  const result = insertPseudoToken(d, index, token);
  assert.equal(result.ok, true);
  return result.document;
}
function group(d, ids) {
  const g = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(g);
  d.slots.push({ id: g.slotId });
  return g;
}
const layoutOf = d => computeLayout(d.tokens, d.groups, d.splits, d.arrows);
const key = (key, extra = {}) => ({ key, code: '', keyCode: 0, isComposing: false, repeat: false,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

test('insertion at each border adds exactly one independent token and slot without mutating the source', () => {
  for (const words of [[], ['a'], ['a', 'b', 'c']]) {
    for (let index = 0; index <= words.length; index++) {
      const d = initial(words);
      const before = structuredClone(d);
      const token = pseudo();
      const next = insert(d, index, token);
      assert.deepEqual(d, before);
      assert.deepEqual(next.tokens[index], token);
      assert.deepEqual(next.tokens.filter(t => t.id !== token.id), d.tokens);
      assert.equal(next.slots.length, d.slots.length + 1);
      assert.equal(next.slots.at(-1).id, token.slotId);
      assert.equal(isSavedState(next), true);
    }
  }
});

test('new pseudo input splits whitespace and inserts independent tokens atomically', () => {
  assert.deepEqual(splitPseudoInput('  日本語\t/  a\nb <>& 😀  '), ['日本語', '/', 'a', 'b', '<>&', '😀']);
  assert.deepEqual(splitPseudoInput(' \t\n '), []);
  assert.deepEqual(splitPseudoInput('single'), ['single']);

  const d = initial();
  const tokens = ['日本語', '/', 'a'].map((text, index) => pseudo(text, `pseudo:${index}`));
  const result = insertPseudoTokens(d, 1, tokens);
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.tokens.slice(1, 4), tokens);
  assert.deepEqual(result.document.slots.slice(-3).map(slot => slot.id), tokens.map(token => token.slotId));
  assert.equal(isSavedState(result.document), true);
  assert.deepEqual(d, initial());
});

test('batch insertion can make a T source sparse without mutating the original', () => {
  const d = initial();
  const basic = group(d, ['a', 'b']);
  const split = splitSlot(d, basic.slotId, 't');
  const before = structuredClone(split);
  const tokens = [pseudo('x', 'pseudo:x'), pseudo('y', 'pseudo:y')];
  const result = insertPseudoTokens(split, 1, tokens);
  assert.equal(result.ok, true);
  assert.equal(isSavedState(result.document), true);
  assert.deepEqual(result.document.splits, split.splits);
  assert.deepEqual(split, before);
  assert.equal(insertPseudoTokens(split, 0, []).ok, false);
});

test('reediting retains spaces and symbols; only the empty string is deletion, not whitespace', () => {
  const d = insert(initial(), 1);
  for (const text of ['日本語', '  ', ' x  y ', '<script>alert(1)</script>', 'a/b 😀']) {
    const next = editPseudoToken(d, 'pseudo', text);
    assert.equal(next.tokens[1].text, text);
    assert.equal(next.tokens.length, 4);
    assert.equal(next.tokens[1].kind, 'pseudo');
    assert.equal(isSavedState(next), true);
  }
  assert.equal(editPseudoToken(d, 'pseudo', '').tokens.length, 3);
  assert.equal(editPseudoToken(d, 'pseudo', d.tokens[1].text), d);
  assert.equal(editPseudoToken(d, 'token:a', ''), d);
  assert.equal(editPseudoToken(d, 'missing', 'x'), d);
  assert.equal(deletePseudoToken(d, 'token:a'), d);
  assert.equal(deletePseudoToken(d, 'missing'), d);
});

test('ordinary and sparse underlines retain their memberships and skip the inserted pseudo token', () => {
  const d = initial();
  const basic = group(d, ['a', 'b']);
  const sparse = group(d, ['a', 'c']);
  const composite = group(d, [basic.slotId, 'c']);
  const next = insert(d, 1);
  assert.deepEqual(next.groups, d.groups);
  const layout = layoutOf(next);
  for (const g of [basic, sparse, composite]) {
    assert.equal(layout.rangesBySlot.get(g.slotId).some(r => r.start <= 1 && 1 < r.end), false);
  }
  assert.equal(slotAt(layout, 1, 0), 'slot:pseudo');
});

test('inserting into a T source may make it sparse while a D source remains continuous-only', () => {
  for (const kind of ['t', 'd']) {
    const d = initial();
    const basic = group(d, ['a', 'b']);
    const source = kind === 'd' ? group(d, [basic.slotId, 'c']) : basic;
    const split = splitSlot(d, source.slotId, kind);
    const before = structuredClone(split);
    const result = insertPseudoToken(split, 1, pseudo());
    assert.equal(result.ok, kind === 't');
    if (kind === 'd') assert.match(result.message, /T\/D/);
    else assert.equal(isSavedState(result.document), true);
    assert.deepEqual(split, before);
    assert.equal(insertPseudoToken(split, 0, pseudo()).ok, true);
    assert.equal(insertPseudoToken(split, 3, pseudo()).ok, true);
  }
});

test('insertion adjacent to a split token remains valid and IDs survive renumbering', () => {
  const d = splitSlot(initial(), 'b', 't');
  const next = insert(d, 1);
  assert.equal(isSavedState(next), true);
  assert.deepEqual(next.splits, d.splits);
  assert.equal(layoutOf(next).tokenCount, 4);
  assert.ok(layoutOf(next).logicalSize > 4);
});

test('invalid index, empty text, and duplicate IDs fail closed', () => {
  const d = initial();
  for (const index of [-1, 4, 0.5, NaN]) assert.equal(insertPseudoToken(d, index, pseudo()).ok, false);
  assert.equal(insertPseudoToken(d, 0, pseudo('')).ok, false);
  assert.equal(insertPseudoToken(d, 0, pseudo('x', 'token:a')).ok, false);
  assert.equal(insertPseudoToken(d, 0, { ...pseudo(), slotId: 'a' }).ok, false);
});

test('only a pseudo token and its own split children select the pseudo editor', () => {
  for (const kind of ['t', 'd']) {
    const d = insert(initial(), 1);
    const g = group(d, ['slot:pseudo', 'b']);
    let next = splitSlot(d, 'slot:pseudo', kind);
    const own = next.splits[0];
    next = splitSlot(next, g.slotId, kind);
    for (const id of ['slot:pseudo', own.leftSlotId, own.rightSlotId]) assert.equal(pseudoTokenAtSlot(next, id)?.id, 'pseudo');
    for (const id of ['a', 'missing', undefined, g.slotId, next.splits[1].leftSlotId, next.splits[1].rightSlotId]) {
      assert.equal(pseudoTokenAtSlot(next, id), undefined);
    }
  }
});

test('pseudo tokens accept markers, grouping, arrows, and T/D just like real tokens', () => {
  for (const kind of ['t', 'd']) {
    let d = insert(initial(), 1);
    d.slots = setSlotMarker(d.slots, 'slot:pseudo', 'marker.adverb');
    d = connectArrow(d, 'slot:pseudo', 'a');
    const parent = group(d, ['slot:pseudo', 'b']);
    assert.equal(parent.kind, 'composite');
    d = splitSlot(d, 'slot:pseudo', kind);
    assert.equal(isSavedState(d), true);
    assert.equal(d.arrows[0].sourceSlotId, d.splits[0].leftSlotId);
    assert.equal(d.tokens[1].kind, 'pseudo');
  }
});

test('deleting a pseudo token cascades to its split, dependent groups and arrows but not other tokens', () => {
  let d = insert(insert(initial(), 1), 3, pseudo('second', 'other'));
  const child = group(d, ['slot:pseudo', 'b']);
  group(d, [child.slotId, 'c']);
  const surviving = group(d, ['a']);
  d = splitSlot(d, 'slot:pseudo', 'd');
  const half = d.splits[0].leftSlotId;
  d.slots = setSlotMarker(d.slots, half, 'marker.adverb');
  d = connectArrow(d, half, 'slot:other');
  group(d, [d.splits[0].rightSlotId]);
  const next = editPseudoToken(d, 'pseudo', '');
  assert.equal(isSavedState(next), true);
  assert.deepEqual(next.tokens, d.tokens.filter(t => t.id !== 'pseudo'));
  assert.deepEqual(next.groups, [surviving]);
  assert.deepEqual(next.splits, []);
  assert.deepEqual(next.arrows, []);
  assert.deepEqual(new Set(next.slots.map(s => s.id)), new Set(['a', 'b', 'c', 'slot:other', surviving.slotId]));
});

test('create, update and cascade deletion each round-trip as one undo/redo step', () => {
  let document = initial();
  const history = new EditHistory();
  for (const operation of [d => insert(d, 1), d => editPseudoToken(d, 'pseudo', '変更'), d => editPseudoToken(d, 'pseudo', '')]) {
    const before = { document, cursor: { x: 0, y: 0 } };
    const after = { document: operation(document), cursor: { x: 1, y: 0 } };
    history.record(before, after);
    assert.deepEqual(history.undo(), before);
    assert.deepEqual(history.redo(), after);
    document = after.document;
  }
});

test('explicit real/pseudo kinds survive v8 loading; unwrapped and unknown kinds are rejected', () => {
  const d = insert(initial(), 1);
  d.tokens[0].kind = 'real';
  assert.equal(readEntryDocument(JSON.parse(JSON.stringify(d))), undefined);
  const restored = readEntryDocument(JSON.parse(JSON.stringify({ version: 8, entries: [{ id: 'entry', document: d }] })));
  assert.deepEqual(restored.entries[0].document, d);
  for (const kind of ['unknown', '', null, 3]) {
    const invalid = structuredClone(d);
    invalid.tokens[0].kind = kind;
    assert.equal(isSavedState(invalid), false);
  }
  assert.equal(isSavedState(initial()), true);
});

test('English source includes only real tokens; all new English token paths tag them real', () => {
  const d = insert(initial(), 1);
  assert.equal(realSentence(d.tokens), 'a b c');
  assert.equal(realSentence([pseudo()]), '');
  assert.ok(createExampleDocument().tokens.every(t => t.kind === 'real'));
  const state = { document: { version: 8, entries: [{ id: 'entry', document: initial() }] }, activeEntryId: 'entry', cursor: { x: 0, y: 0 } };
  const next = insertEnglishEntries(state, 'entry', 'new text');
  assert.ok(next.document.entries[1].document.tokens.every(t => t.kind === 'real'));
});

test('unchanged English preserves pseudo tokens and annotations; changed English resets them in one document', () => {
  const d = insert(initial(), 1);
  group(d, ['slot:pseudo', 'a']);
  d.translation = '訳文';
  assert.equal(replaceEnglishSentence(d, ' a   b c '), d);
  const replaced = replaceEnglishSentence(d, 'new  sentence');
  assert.deepEqual(replaced.tokens.map(t => [t.text, t.kind]), [['new', 'real'], ['sentence', 'real']]);
  assert.deepEqual(replaced.groups, []);
  assert.deepEqual(replaced.splits, []);
  assert.deepEqual(replaced.arrows, []);
  assert.equal(replaced.slots.length, 2);
  assert.equal(replaced.translation, '訳文');
  assert.equal(isSavedState(replaced), true);
  const onlyPseudo = insert(initial([]), 0);
  assert.equal(replaceEnglishSentence(onlyPseudo, ''), onlyPseudo);
  assert.equal(replaceEnglishSentence(onlyPseudo, 'word').tokens.length, 1);
  assert.equal(replaceEnglishSentence(d, '').tokens.length, 0);
});

test('composition flags, modifiers, and repeat protect IME and native text editing keys', () => {
  assert.equal(pseudoInputAction(key('Enter'), false), 'pseudo.commit');
  assert.equal(pseudoInputAction(key('Escape'), false), 'editor.cancel');
  for (const name of ['Enter', 'Escape']) {
    assert.equal(pseudoInputAction(key(name), true), undefined);
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      assert.equal(pseudoInputAction(key(name, extra), false), undefined);
    }
  }
  for (const name of ['/', 'i', 'u', 'h', 'ArrowLeft', 'Backspace', 'Tab']) assert.equal(pseudoInputAction(key(name), false), undefined);
  for (const event of [key('n', { ctrlKey: true }), key('p', { ctrlKey: true }), key('j', { altKey: true }), key('k', { altKey: true })]) {
    assert.equal(resolveInput(event, { mode: 'PSEUDO_INPUT' }).winner, undefined);
  }
});

test('Ctrl+[ cancels pseudo input with the same composition and repeat guards as Escape', () => {
  assert.equal(pseudoInputAction(key('[', { ctrlKey: true }), false), 'editor.cancel');
  assert.equal(pseudoInputAction(key('[', { ctrlKey: true }), true), undefined);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(pseudoInputAction(key('[', { ctrlKey: true, ...extra }), false), undefined);
  }
});

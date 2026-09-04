import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { EditHistory } from '../src/history.ts';
import { splitSlot } from '../src/tEditing.ts';
import { insertBracket } from '../src/bracketEditing.ts';
import { insertPseudoToken } from '../src/pseudoEditing.ts';
import { computeLayout, slotPosition, selectSlotRange, toggleSlotSelection } from '../src/layout.ts';
import { entryShortcut } from '../src/entryShortcuts.ts';
import { matchesKeyboardInput } from '../src/keyboard.ts';
import { resolveKeyboardOperation } from '../src/keyboardOperations.ts';
import ts from 'typescript';

// Exercise the component's actual exported handlers without a browser or real
// timers. SSR does not rerun reactive declarations after these calls: assertions
// cover synchronous handlers/snapshot(), not DOM updates or measurements.
let Editor;
let appNavigation;
before(async () => {
  const source = readFileSync(new URL('../src/EntryEditor.svelte', import.meta.url), 'utf8');
  // SSR does not recompute selection declarations after movement. Inject the
  // selection computed by the real layout helpers before testing Enter.
  const testSource = source.replace('function clickSlotId(', 'export function clickSlotId(')
    .replace('</script>', `
      export function setSelectionForTest(ids: string[], selectionMode: 'VISUAL' | 'VISUAL_MULTI') {
        selectedSlots = ids; selecting = true; mode = selectionMode;
      }
    </script>`);
  const { js } = compile(testSource, { generate: 'server' });
  const code = js.code.replace(/from '([^']+)'/g, (_, specifier) => {
    const url = specifier.startsWith('./')
      ? new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href
      : import.meta.resolve(specifier);
    return `from '${url}'`;
  });
  const domGuards = `
    const Element = class {};
    const HTMLInputElement = class {};
    const HTMLTextAreaElement = class {};
    const document = { activeElement: null };
  `;
  Editor = (await import(`data:text/javascript;base64,${Buffer.from(domGuards + code).toString('base64')}`)).default;

  // Run the actual app dispatch/move functions with real editor handles, but
  // replace scrolling and DOM guards so entry switching requires no browser.
  const appSource = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
  const ast = ts.createSourceFile('App.ts', appSource, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['handleKeydown', 'moveEntry', 'finishEditing', 'closeEntryMenu', 'activate', 'saveCurrentEntry'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  assert.equal(functions.includes('function moveEntry'), true);
  const body = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  appNavigation = new Function('entryShortcut', 'matchesKeyboardInput', 'resolveKeyboardOperation', 'editors', 'initialIndex', `
    ${body}
    const Element = class {};
    const HTMLButtonElement = class extends Element {};
    const entries = editors.map((_, i) => ({ id: String(i) }));
    let activeEntryId = String(initialIndex);
    let openEntryMenuId = null;
    const ready = true, restoring = false, bulkAfterId = null;
    const updates = { schedule() {} };
    const persistence = { saveEntry() {} };
    const published = [];
    const currentEditor = () => editors[Number(activeEntryId)];
    const updateEntry = (id, snapshot) => published.push({ id, snapshot });
    const scrollToActive = () => {};
    const swapEntry = () => { throw new Error('FORM must not reorder entries'); };
    return { handleKeydown, published, activeIndex: () => Number(activeEntryId) };
  `);
});

const initialDocument = () => ({
  version: 6, translation: '', groups: [], splits: [], arrows: [],
  tokens: ['a', 'b', 'c'].map(text => ({ id: `token:${text}`, text, slotId: text })),
  slots: ['a', 'b', 'c'].map(id => ({ id })),
});

function setup(initial = initialDocument()) {
  const api = {};
  const records = [];
  const undoCalls = [];
  const history = new EditHistory();
  let state;
  const props = {
    initial, active: true,
    onrecord(before, after) { records.push({ before, after }); history.record(before, after); },
    onstate(next) { state = next; },
    onactivate() {}, ontranslationactivity() {},
    onundo(redo) {
      undoCalls.push({ redo, mode: state.getDisplay().mode });
      const next = redo ? history.redo() : history.undo();
      if (next) api.restore(next);
    },
  };
  for (const name of ['snapshot', 'restore', 'handleKeydown', 'finishEditing', 'canSave', 'finishFormEditing', 'startInput', 'getInputMode', 'selectFirst', 'clickSlotId', 'finishMarkerInput', 'setSelectionForTest']) {
    Object.defineProperty(props, name, { set(value) { api[name] = value; } });
  }
  // Access body to force the lazy synchronous server render.
  const html = render(Editor, { props }).body;
  assert.ok(html.includes('diagram'));
  function key(key, extra = {}) {
    let prevented = false;
    api.handleKeydown({
      key, target: null, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      repeat: false, isComposing: false, keyCode: 0,
      preventDefault() { prevented = true; }, ...extra,
    });
    return prevented;
  }
  return { api, key, records, undoCalls, html, display: () => state.getDisplay() };
}

const withPseudo = (index = 1, document = initialDocument()) => insertPseudoToken(document, index,
  { id: 'pseudo', slotId: 'pseudo-slot', kind: 'pseudo', text: '日本語' }).document;

test('plus marker starts apposition and accepts plus at the other endpoint through editor handlers', () => {
  const initial = initialDocument();
  initial.slots[1].marker = 'marker.plus';
  const { api, key, display } = setup(initial);
  key('+');
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.plus');
  key('r');
  assert.equal(display().mode, 'ARROW');
  key('l'); key('Enter');
  assert.deepEqual(api.snapshot().document.arrows, [{ kind: 'apposition', sourceSlotId: 'a', targetSlotId: 'b' }]);
});

test('FORM handlers preview every code without saving, then commit one undoable edit', () => {
  const formByInput = { b: 'form.base', c: 'form.present', p: 'form.past', pp: 'form.pastParticiple', ing: 'form.ing' };
  for (const [confirm, extra] of [['Enter', {}], ['Escape', {}], ['[', { ctrlKey: true }]]) {
  for (const code of ['b', 'c', 'p', 'pp', 'ing']) {
    const { api, key, display, records } = setup();
    const before = api.snapshot();
    key('f');
    assert.equal(api.getInputMode(), 'FORM');
    assert.equal(display().mode, 'FORM');
    assert.equal(display().formSession.tokenId, 'token:a');
    for (const char of code) {
      key(char);
      assert.deepEqual(api.snapshot(), before);
      assert.equal(records.length, 0);
    }
    assert.equal(display().formSession.buffer, code);
    key(confirm, extra);
    const after = api.snapshot();
    assert.equal(after.document.tokens[0].form, formByInput[code]);
    assert.equal(records.length, 1);
    assert.equal(display().mode, 'NORMAL');
    assert.equal(display().formSession, null);
    assert.equal(api.getInputMode(), null);
    assert.deepEqual(after.cursor, before.cursor);
    key('u');
    assert.deepEqual(api.snapshot(), before);
    key('r', { ctrlKey: true });
    assert.deepEqual(api.snapshot(), after);
  }
  }
});

test('FORM handles partial input, replacements, backspace and no-op commits', () => {
  const initial = initialDocument();
  initial.tokens[0].form = 'form.base';
  const { api, key, display, records } = setup(initial);
  const before = api.snapshot();
  for (const code of ['', 'b', 'i', 'in']) {
    key('f');
    for (const char of code) key(char);
    key('Escape');
    assert.deepEqual(api.snapshot(), before);
    assert.equal(records.length, 0);
    assert.equal(display().mode, 'NORMAL');
  }
  key('f'); key('i'); key('Enter');
  assert.equal(display().mode, 'FORM');
  key('n'); key('Enter');
  assert.equal(display().mode, 'FORM');
  assert.deepEqual(api.snapshot(), before);
  key('g'); key('Backspace');
  assert.equal(display().formSession.buffer, 'in');
  key('p'); key('p'); key('Backspace');
  assert.equal(display().formSession.buffer, 'p');
  key('c'); key('Enter');
  assert.equal(api.snapshot().document.tokens[0].form, 'form.present');
  assert.equal(records.length, 1);
  key('f'); key('p'); key('Backspace'); key('Enter');
  assert.equal(api.snapshot().document.tokens[0].form, 'form.present');
  assert.equal(records.length, 1);
});

test('FORM x immediately clears only form and restores it with undo, even after a draft', () => {
  const initial = initialDocument();
  initial.tokens[0].form = 'form.pastParticiple';
  initial.slots[0].marker = 'marker.subject';
  const { api, key, display, records } = setup(initial);
  const before = api.snapshot();
  key('f'); key('i'); key('x');
  const cleared = api.snapshot();
  assert.equal(display().mode, 'NORMAL');
  assert.equal(Object.hasOwn(cleared.document.tokens[0], 'form'), false);
  assert.deepEqual(cleared.document.slots, before.document.slots);
  assert.equal(records.length, 1);
  key('u'); assert.deepEqual(api.snapshot(), before);
  key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot(), cleared);
  key('f'); key('x');
  assert.equal(records.length, 1);
});

test('FORM blocks marker editing, undo/redo, repeated form input and modified or composing input', () => {
  const { api, key, display, records, undoCalls } = setup();
  const before = api.snapshot();
  key('f'); key('p');
  for (const command of ['v', 't', 'd', 's', 'u', 'r', 'Tab', '[', ']', 'Delete', 'q', 'f']) {
    assert.equal(key(command), true);
    assert.equal(display().formSession.buffer, 'p');
  }
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    for (const command of ['p', 'x', 'Enter', 'Escape']) key(command, extra);
    assert.equal(display().formSession.buffer, 'p');
    assert.equal(display().mode, 'FORM');
  }
  assert.equal(key('r', { ctrlKey: true }), true);
  assert.deepEqual(api.snapshot(), before);
  assert.equal(records.length, 0);
  assert.deepEqual(undoCalls, []);
  key('Enter');
  assert.equal(api.snapshot().document.tokens[0].form, 'form.past');
});

test('FORM movement matches Escape then normal movement, including partial input, boundaries and Shift+$', () => {
  const movements = ['h', 'j', 'k', 'l', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight', '0', '$'];
  for (const movement of movements) {
    for (const buffer of ['', 'pp', 'i', 'in']) {
      const initial = initialDocument();
      initial.tokens[0].form = 'form.base';
      const direct = setup(initial), explicit = setup(initial);
      for (const e of [direct, explicit]) {
        e.key('f');
        for (const char of buffer) e.key(char);
      }
      const extra = movement === '$' ? { shiftKey: true } : {};
      assert.equal(direct.key(movement, extra), true);
      explicit.key('Escape'); explicit.key(movement, extra);
      assert.equal(direct.display().mode, 'NORMAL');
      assert.equal(direct.display().formSession, null);
      assert.deepEqual(direct.api.snapshot(), explicit.api.snapshot());
      assert.deepEqual(direct.records, explicit.records);
      assert.equal(direct.api.snapshot().document.tokens[0].form, buffer === 'pp' ? 'form.pastParticiple' : 'form.base');
    }
  }
});

test('FORM movement commits the original owner for tokens, D halves, T and basic groups before navigation', () => {
  const cases = [[initialDocument(), 'a'], [withPseudo(), 'pseudo-slot']];
  const grouped = initialDocument();
  grouped.groups = [{ id: 'g', slotId: 'g', kind: 'basic', slots: ['a', 'b'] }];
  grouped.slots.push({ id: 'g' });
  cases.push([grouped, 'g']);
  for (const kind of ['t', 'd']) {
    for (const [document, owner] of [[initialDocument(), 'a'], [grouped, 'g']]) {
      const split = splitSlot(document, owner, kind);
      cases.push([split, split.splits[0].leftSlotId], [split, split.splits[0].rightSlotId]);
    }
  }
  for (const [document, slotId] of cases) {
    for (const movement of ['l', 'k', 'j']) {
      const direct = setup(document), explicit = setup(document);
      for (const e of [direct, explicit]) {
        e.api.clickSlotId(slotId);
        e.key('f'); e.key('p');
      }
      direct.key(movement);
      explicit.key('Escape'); explicit.key(movement);
      assert.equal(direct.display().mode, 'NORMAL');
      assert.deepEqual(direct.api.snapshot(), explicit.api.snapshot());
      assert.deepEqual(direct.records, explicit.records);
      direct.key('u'); explicit.key('u');
      assert.deepEqual(direct.api.snapshot(), explicit.api.snapshot());
      direct.key('r', { ctrlKey: true }); explicit.key('r', { ctrlKey: true });
      assert.deepEqual(direct.api.snapshot(), explicit.api.snapshot());
    }
  }
});

test('FORM navigation allows normal repeats, preserves redo on no-op exit and protects IME/modifier commands', () => {
  const e = setup();
  e.key('f'); e.key('p');
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    e.key('l', extra);
    assert.equal(e.display().mode, 'FORM');
    assert.equal(e.api.snapshot().document.tokens[0].form, undefined);
  }
  e.key('l', { repeat: true });
  assert.equal(e.display().mode, 'NORMAL');
  assert.deepEqual(e.api.snapshot().cursor, { x: 1, y: 0 });
  e.key('l', { repeat: true });
  assert.deepEqual(e.api.snapshot().cursor, { x: 2, y: 0 });
  e.key('u');
  assert.equal(e.api.snapshot().document.tokens[0].form, undefined);
  e.key('f'); e.key('i'); e.key('h');
  assert.equal(e.display().mode, 'NORMAL');
  e.key('r', { ctrlKey: true });
  assert.equal(e.api.snapshot().document.tokens[0].form, 'form.past');
});

test('actual app Ctrl+n/p routing commits FORM before moving or hitting an entry boundary', () => {
  for (const [input, index, expected] of [['n', 0, 1], ['p', 1, 0], ['n', 1, 1], ['p', 0, 0]]) {
    for (const [buffer, repeat] of ['pp', '', 'i', 'in'].flatMap(buffer => [false, true].map(repeat => [buffer, repeat]))) {
      const editors = [setup(), setup()];
      const e = editors[index];
      e.api.clickSlotId('b');
      e.key('f');
      for (const char of buffer) e.key(char);
      const router = appNavigation(entryShortcut, matchesKeyboardInput, resolveKeyboardOperation, editors.map(e => e.api), index);
      let prevented = false;
      router.handleKeydown({ key: input, target: null, ctrlKey: true, repeat, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(router.activeIndex(), expected);
      assert.equal(e.display().mode, 'NORMAL');
      assert.equal(e.api.snapshot().document.tokens[1].form, buffer === 'pp' ? 'form.pastParticiple' : undefined);
      if (expected !== index) {
        assert.deepEqual(editors[expected].api.snapshot().cursor, { x: 0, y: 0 });
        assert.equal(router.published.at(-1).snapshot.document.tokens[1].form, buffer === 'pp' ? 'form.pastParticiple' : undefined);
        assert.ok(editors[expected].api.snapshot().document.tokens.every(t => t.form === undefined));
      }
      e.key('u');
      assert.equal(e.api.snapshot().document.tokens[1].form, undefined);
      if (buffer === 'pp') {
        e.key('r', { ctrlKey: true });
        assert.equal(e.api.snapshot().document.tokens[1].form, 'form.pastParticiple');
      }
    }
  }
});

test('app Ctrl+n/p follows native key repeats one entry at a time and clamps at boundaries', () => {
  for (const [key, initialIndex, expectedIndices] of [
    ['n', 0, [1, 2, 3, 3, 3]],
    ['p', 3, [2, 1, 0, 0, 0]],
  ]) {
    const editors = Array.from({ length: 4 }, () => setup());
    for (const editor of editors) editor.api.clickSlotId('b');
    const router = appNavigation(entryShortcut, matchesKeyboardInput, resolveKeyboardOperation, editors.map(e => e.api), initialIndex);
    for (const [index, expected] of expectedIndices.entries()) {
      let prevented = false;
      router.handleKeydown({ key, target: null, ctrlKey: true, repeat: index > 0,
        preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(router.activeIndex(), expected);
      assert.deepEqual(editors[expected].api.snapshot().cursor, { x: 0, y: 0 });
      assert.equal(editors[expected].display().mode, 'NORMAL');
    }
  }
});

test('app suppresses repeated Alt+j/k reorder in NORMAL mode', () => {
  const editors = [setup(), setup(), setup()];
  const router = appNavigation(entryShortcut, matchesKeyboardInput, resolveKeyboardOperation, editors.map(e => e.api), 1);
  for (const key of ['j', 'k']) {
    let prevented = false;
    // The router stub throws if swapEntry is called.
    router.handleKeydown({ key, code: `Key${key.toUpperCase()}`, target: null, altKey: true,
      repeat: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(router.activeIndex(), 1);
  }
});

test('app rejects modified/composing entry commands and FORM reorder without committing', () => {
  const editors = [setup(), setup()];
  const e = editors[0];
  e.key('f'); e.key('p');
  const router = appNavigation(entryShortcut, matchesKeyboardInput, resolveKeyboardOperation, editors.map(e => e.api), 0);
  for (const extra of [{ isComposing: true }, { keyCode: 229 },
    { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
    router.handleKeydown({ key: 'n', target: null, ctrlKey: true, preventDefault() {}, ...extra });
    assert.equal(router.activeIndex(), 0);
    assert.equal(e.display().mode, 'FORM');
    assert.equal(e.display().formSession.buffer, 'p');
  }
  for (const key of ['j', 'k']) router.handleKeydown({ key, code: `Key${key.toUpperCase()}`, target: null, altKey: true, preventDefault() {} });
  assert.equal(e.display().mode, 'FORM');
  assert.equal(e.api.snapshot().document.tokens[0].form, undefined);
});

test('FORM targets real and pseudo tokens through T owners or individual D halves, excluding brackets and empty entries', () => {
  for (const kind of ['t', 'd']) {
    for (const [document, slotId, tokenId] of [[initialDocument(), 'b', 'token:b'], [withPseudo(), 'pseudo-slot', 'pseudo']]) {
      const split = splitSlot(document, slotId, kind);
      for (const target of [split.splits[0].leftSlotId, split.splits[0].rightSlotId]) {
        const { api, key, display } = setup(split);
        api.clickSlotId(target);
        const cursor = api.snapshot().cursor;
        key('f');
        assert.equal(display().formSession.tokenId, tokenId);
        assert.equal(display().formSession.slotId, kind === 'd' ? target : slotId);
        key('b'); key('Enter');
        const next = api.snapshot().document;
        if (kind === 'd') {
          assert.equal(next.splits[0][target === split.splits[0].leftSlotId ? 'leftForm' : 'rightForm'], 'form.base');
          assert.equal(next.tokens.find(t => t.id === tokenId).form, undefined);
        } else assert.equal(next.tokens.find(t => t.id === tokenId).form, 'form.base');
        assert.deepEqual(api.snapshot().cursor, cursor);
      }
    }
  }
  const grouped = initialDocument();
  grouped.groups = [{ id: 'g', slotId: 'g', kind: 'composite', slots: ['a', 'b'] }];
  grouped.slots[0].marker = 'marker.subject';
  grouped.slots.push({ id: 'g' });
  const bracketed = insertBracket(initialDocument(), 0, '[').document;
  const cases = [[grouped, 'g'], [bracketed, bracketed.tokens[0].slotId],
    [{ ...initialDocument(), tokens: [], slots: [] }, undefined]];
  for (const [document, slotId] of cases) {
    const { api, key, display, records } = setup(document);
    if (slotId) api.clickSlotId(slotId);
    const before = api.snapshot();
    const recordCount = records.length;
    key('f');
    assert.equal(display().mode, 'NORMAL');
    assert.deepEqual(api.snapshot(), before);
    assert.equal(records.length, recordCount);
  }
});

test('FORM edits a basic underline as one owner, shares its T form, and separates its D forms with undo/redo', () => {
  for (const kind of [null, 't', 'd']) {
    let document = initialDocument();
    document.groups = [{ id: 'g', slotId: 'g', kind: 'basic', slots: ['a', 'b'] }];
    document.slots.push({ id: 'g' });
    if (kind) document = splitSlot(document, 'g', kind);
    const left = kind ? document.splits[0].leftSlotId : 'g';
    const right = kind ? document.splits[0].rightSlotId : 'g';
    const e = setup(document);
    e.api.clickSlotId(left);
    e.key('f'); e.key('b'); e.key('Escape');
    e.api.clickSlotId(right);
    const before = e.api.snapshot();
    e.key('f');
    assert.equal(e.display().formSession.slotId, kind === 'd' ? right : 'g');
    e.key('p'); e.key('p');
    assert.deepEqual(e.api.snapshot(), before);
    e.key('Escape');
    const after = e.api.snapshot();
    if (kind === 'd') {
      assert.equal(after.document.splits[0].leftForm, 'form.base');
      assert.equal(after.document.splits[0].rightForm, 'form.pastParticiple');
    } else assert.equal(after.document.groups[0].form, 'form.pastParticiple');
    assert.deepEqual(after.document.tokens, document.tokens);
    e.key('u'); assert.deepEqual(e.api.snapshot(), before);
    e.key('r', { ctrlKey: true }); assert.deepEqual(e.api.snapshot(), after);
    e.key('f'); e.key('x');
    if (kind === 'd') {
      assert.equal(e.api.snapshot().document.splits[0].leftForm, 'form.base');
      assert.equal(e.api.snapshot().document.splits[0].rightForm, undefined);
    } else assert.equal(e.api.snapshot().document.groups[0].form, undefined);
  }
});

test('FORM cancels drafts on click, finishEditing, text input and restoration; pending markers settle before f', () => {
  for (const leave of [e => e.api.clickSlotId('b'), e => e.api.finishEditing(),
    e => e.api.startInput(), e => e.api.startInput(true), e => e.api.restore(e.api.snapshot())]) {
    const e = setup();
    e.key('f'); e.key('c');
    leave(e);
    assert.equal(e.display().formSession, null);
    assert.notEqual(e.display().mode, 'FORM');
    assert.ok(e.api.snapshot().document.tokens.every(t => t.form === undefined));
    // Existing navigation reports snapshots even for moves without document edits.
    for (const record of e.records) assert.deepEqual(record.before.document, record.after.document);
  }
  const e = setup();
  e.key('a'); e.key('f');
  assert.equal(e.records.length, 1);
  assert.equal(e.display().formSession.before.document.slots[0].marker, 'marker.adjective');
  e.key('p'); e.key('Enter');
  assert.equal(e.records.length, 2);
  e.key('u');
  assert.equal(e.api.snapshot().document.slots[0].marker, 'marker.adjective');
  assert.equal(e.api.snapshot().document.tokens[0].form, undefined);
});

test('saved form labels render above real/pseudo words in both diagram and intrinsic measurement', () => {
  const document = withPseudo();
  document.tokens[0].form = 'form.present';
  document.tokens[1].form = 'form.pastParticiple';
  const { html } = setup(document);
  for (const label of ['現在形', 'p.p.']) {
    assert.equal(html.split(`>${label}</span>`).length - 1, 2);
  }
  assert.ok(html.indexOf('>現在形</span>') < html.indexOf('>a</span>'));
  assert.equal(html.includes('form-pending'), false);
});

test('covered word forms are measured and rendered with only the required annotation height', () => {
  const document = initialDocument();
  document.tokens[0].form = 'form.present';
  document.tokens[1].kind = 'pseudo';
  document.tokens[1].form = 'form.ing';
  document.groups = [{ id: 'g', slotId: 'g', slots: ['a', 'b'], kind: 'basic', form: 'form.pastParticiple' }];
  document.slots.push({ id: 'g' });
  const annotated = setup(document);
  for (const label of ['現在形', 'ing', 'p.p.']) {
    // Once in the intrinsic-width mirror, once in the visible annotation layer.
    assert.equal(annotated.html.split(`>${label}</span>`).length - 1, 2);
  }
  assert.equal(annotated.display().formRegions.find(f => f.slotId === 'g').lane, 1);
  assert.equal(Math.max(...annotated.display().displayRows.map(row => row.formHeight)), 36);
  const wordsOnly = structuredClone(document);
  delete wordsOnly.groups[0].form;
  assert.equal(Math.max(...setup(wordsOnly).display().displayRows.map(row => row.formHeight)), 18);
  const groupOnly = structuredClone(document);
  for (const token of groupOnly.tokens) delete token.form;
  assert.equal(Math.max(...setup(groupOnly).display().displayRows.map(row => row.formHeight)), 18);
  delete groupOnly.groups[0].form;
  assert.equal(Math.max(...setup(groupOnly).display().displayRows.map(row => row.formHeight)), 0);
});

test('FORM entry guards and unchanged sessions preserve redo history', () => {
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const e = setup();
    e.key('f', extra);
    assert.equal(e.display().mode, 'NORMAL');
  }
  for (const modeKey of ['v', 'b', 'i', 'Tab']) {
    const e = setup();
    e.key(modeKey);
    const mode = e.display().mode;
    e.key('f');
    assert.equal(e.display().mode, mode);
  }
  for (const cancel of ['Escape', 'Enter', 'x']) {
    const e = setup();
    e.key('f'); e.key('p'); e.key('Enter');
    const after = e.api.snapshot();
    e.key('u');
    e.key('f');
    if (cancel === 'Escape') { e.key('i'); e.key('n'); }
    e.key(cancel);
    e.key('r', { ctrlKey: true });
    assert.deepEqual(e.api.snapshot(), after);
    assert.equal(e.records.length, 1);
  }
});

// The SSR handler harness cannot dispatch DOM input events. Assign the same
// session.text / composing properties that the template binds to native events.
function typePseudo(editor, text) {
  assert.equal(editor.display().mode, 'PSEUDO_INPUT');
  editor.display().pseudoInput.text = text;
}

function typeCustomMarker(editor, text) {
  assert.equal(editor.display().mode, 'MARKER_INPUT');
  editor.display().customMarkerInput.text = text;
}

test('NORMAL slash edits a free marker interactively and commits one trimmed undoable change', () => {
  const editor = setup();
  const { api, key, display, records } = editor;
  const before = api.snapshot();
  assert.equal(key('/'), true);
  assert.equal(api.getInputMode(), 'MARKER_INPUT');
  assert.equal(display().customMarkerInput.slotId, 'a');
  assert.equal(display().customMarkerInput.text, '');
  typeCustomMarker(editor, '  自由 / <>& 😀  ');
  assert.deepEqual(api.snapshot(), before);
  assert.equal(records.length, 0);
  key('Enter');
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().document.slots[0].marker, { kind: 'custom', text: '自由 / <>& 😀' });
  assert.equal(records.length, 1);
  key('u');
  assert.deepEqual(api.snapshot(), before);
  key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot().document.slots[0].marker, { kind: 'custom', text: '自由 / <>& 😀' });
});

test('free marker input reopens existing labels, maps canonical text and deletes on trimmed empty input', () => {
  const d = initialDocument();
  d.slots[0].marker = 'marker.adverb';
  const editor = setup(d);
  const { api, key, display, records } = editor;
  key('/');
  assert.equal(display().customMarkerInput.text, 'ad');
  typeCustomMarker(editor, '  S  '); key('Enter');
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.subject');
  key('/'); typeCustomMarker(editor, '   '); key('Enter');
  assert.equal(api.snapshot().document.slots[0].marker, undefined);
  assert.equal(records.length, 2);
  key('/'); key('Enter');
  assert.equal(records.length, 2);
});

test('free marker cancel, restore and IME guards never leak drafts or dispatch editor commands', () => {
  const editor = setup();
  const { api, key, display, records, undoCalls } = editor;
  const before = api.snapshot();
  key('/'); typeCustomMarker(editor, '取消');
  display().customMarkerInput.composing = true;
  key('Enter'); key('Escape');
  display().customMarkerInput.composing = false;
  for (const [input, extra] of [['Enter', { isComposing: true }], ['Escape', { keyCode: 229 }],
    ['Enter', { repeat: true }], ['u', {}], ['r', { ctrlKey: true }], ['/', {}], ['ArrowLeft', {}]]) {
    key(input, extra);
    assert.equal(api.getInputMode(), 'MARKER_INPUT');
  }
  assert.equal(undoCalls.length, 0);
  key('Escape');
  assert.deepEqual(api.snapshot(), before);
  key('/'); typeCustomMarker(editor, 'stale'); api.restore(before);
  assert.equal(display().mode, 'NORMAL');
  assert.equal(display().customMarkerInput, null);
  assert.deepEqual(api.snapshot(), before);
  assert.equal(records.length, 0);
});

test('custom markers have no arrow semantics, while canonical free input retains them', () => {
  for (const [text, marker, arrowCount] of [['自由', { kind: 'custom', text: '自由' }, 0], ['ad', 'marker.adverb', 1]]) {
    const d = initialDocument();
    d.slots[0].marker = 'marker.adverb';
    d.arrows.push({ sourceSlotId: 'a', targetSlotId: 'b' });
    const editor = setup(d);
    editor.key('/'); typeCustomMarker(editor, text); editor.key('Enter');
    assert.deepEqual(editor.api.snapshot().document.slots[0].marker, marker);
    assert.equal(editor.api.snapshot().document.arrows.length, arrowCount);
  }
});

test('free marker input targets groups and split halves but not virtual brackets or empty documents', () => {
  const grouped = initialDocument();
  grouped.groups.push({ id: 'g', slotId: 'g', kind: 'basic', slots: ['a', 'b'] });
  grouped.slots.push({ id: 'g' });
  let editor = setup(grouped);
  editor.key('/');
  assert.equal(editor.display().customMarkerInput.slotId, 'g');

  const divided = splitSlot(initialDocument(), 'a', 'd');
  editor = setup(divided);
  editor.api.restore({ document: divided, cursor: slotPosition(computeLayout(divided.tokens, divided.groups, divided.splits), divided.splits[0].rightSlotId) });
  editor.key('/');
  assert.equal(editor.display().customMarkerInput.slotId, divided.splits[0].rightSlotId);

  for (const document of [{ ...initialDocument(), tokens: [], slots: [] }, insertBracket(initialDocument(), 0, '(').document]) {
    editor = setup(document);
    assert.equal(editor.key('/'), true);
    assert.equal(editor.display().mode, 'NORMAL');
    assert.equal(editor.display().customMarkerInput, null);
  }
});

test('actual BORDER handlers block slot edits and store normal return cursors only', () => {
  const { api, key, display, records } = setup();
  const document = api.snapshot().document;
  assert.equal(key('b'), true);
  assert.equal(display().mode, 'BORDER');
  assert.equal(display().borderIndex, 0);
  assert.equal(key('l'), true);
  assert.equal(key('l', { repeat: true }), true);
  assert.equal(display().borderIndex, 2);
  assert.deepEqual(api.snapshot(), { document, cursor: { x: 2, y: 0 } });
  for (const input of ['j', 'k', 'ArrowUp', 'ArrowDown', 'a', 'v', 't', 'd', 'x', 'X', 'r', 'R', 'i', 'Tab', 'Enter', ' ', 'b']) {
    assert.equal(key(input), true);
    assert.equal(display().mode, 'BORDER');
    assert.equal(display().borderIndex, 2);
    assert.deepEqual(api.snapshot().document, document);
  }
  key('Escape');
  assert.equal(display().mode, 'NORMAL');
  assert.equal(display().borderIndex, null);
  assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
  assert.equal(records.length, 0);
});

test('mode entry uses the token behind either T/D half, and mode exit preserves the split', () => {
  for (const kind of ['t', 'd']) {
    const initial = splitSlot(initialDocument(), 'c', kind);
    const { api, key, display, records } = setup(initial);
    api.restore({ document: initial, cursor: { x: 3, y: 0 } });
    key('b');
    assert.equal(display().borderIndex, 2);
    key('Escape');
    assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
    key('b'); key('$'); key('Escape');
    assert.deepEqual(api.snapshot().cursor, { x: 3, y: 0 });
    assert.deepEqual(api.snapshot().document, initial);
    assert.equal(records.length, 0);
  }
});

test('saving is blocked by live marker state until finishEditing, including before reactive publication', () => {
  const { api, key } = setup();
  assert.equal(api.canSave(), true);
  key('a');
  assert.equal(api.canSave(), false);
  assert.equal(api.canSave(true), false);
  api.finishEditing();
  assert.equal(api.canSave(), true);
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.adjective');
});

test('pending marker commits before b; border movement preserves redo and undo exits BORDER first', () => {
  const { api, key, display, records, undoCalls } = setup();
  key('a');
  key('b');
  assert.equal(display().mode, 'BORDER');
  assert.equal(records.length, 1);
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.adjective');
  key('l'); key('$');
  key('u');
  assert.deepEqual(undoCalls, [{ redo: false, mode: 'NORMAL' }]);
  assert.equal(display().mode, 'NORMAL');
  assert.equal(api.snapshot().document.slots[0].marker, undefined);
  key('b'); key('l');
  key('r', { ctrlKey: true });
  assert.deepEqual(undoCalls[1], { redo: true, mode: 'NORMAL' });
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.adjective');
  assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
  assert.equal(display().mode, 'NORMAL');
  assert.equal(records.length, 1);
});

test('border transitions preserve both closed basic and temporarily open composite groups', () => {
  for (const kind of ['basic', 'composite']) {
    const initial = initialDocument();
    initial.groups.push({ id: 'group', slotId: 'group', slots: ['a', 'b'], kind });
    initial.slots.push({ id: 'group' });
    const { api, key, records, display } = setup(initial);
    key('b'); key('l'); key('Escape');
    assert.equal(display().mode, 'NORMAL');
    assert.deepEqual(api.snapshot(), { document: initial, cursor: { x: 1, y: 0 } });
    key('b'); key('$'); api.finishEditing();
    assert.deepEqual(api.snapshot().document, initial);
    assert.equal(records.length, 0);
  }
});

test('finishEditing, text input and restore discard border state without stale-cursor overwrite', () => {
  const { api, key, display } = setup();
  key('b'); key('l');
  api.finishEditing();
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().cursor, { x: 1, y: 0 });
  for (const translation of [false, true]) {
    key('b'); key('$');
    api.startInput(translation);
    assert.equal(api.getInputMode(), translation ? 'TRANSLATION' : 'INSERT');
    assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
    api.finishEditing();
  }
  key('b'); key('$');
  api.restore({ document: initialDocument(), cursor: { x: 0, y: 0 } });
  assert.equal(display().mode, 'NORMAL');
  assert.equal(display().borderIndex, null);
  assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
});

test('b respects modifiers, composition and repeat, and an empty entry has one border', () => {
  const initial = { ...initialDocument(), tokens: [], slots: [] };
  const { api, key, display } = setup(initial);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
    key('b', extra);
    assert.equal(display().mode, 'NORMAL');
  }
  key('b');
  for (const input of ['l', 'h', '$', '0']) key(input);
  assert.equal(display().borderIndex, 0);
  key('Escape');
  assert.deepEqual(api.snapshot(), { document: initial, cursor: { x: 0, y: 0 } });
});

test('slash creates one native-input session; drafts do not reach snapshots, and commits continue BORDER on the right', () => {
  for (const empty of [false, true]) {
    const d = empty ? { ...initialDocument(), tokens: [], slots: [] } : initialDocument();
    const editor = setup(d);
    const { api, key, display, records } = editor;
    key('b');
    if (!empty) key('l');
    const border = display().borderIndex;
    const before = api.snapshot();
    assert.equal(key('/'), true);
    assert.equal(api.getInputMode(), 'PSEUDO_INPUT');
    typePseudo(editor, '  日本語 / a b <>& 😀  ');
    assert.deepEqual(api.snapshot(), before);
    assert.equal(records.length, 0);
    key('Enter');
    assert.equal(display().mode, 'BORDER');
    assert.equal(display().borderIndex, border + 6);
    const after = api.snapshot();
    assert.deepEqual(after.document.tokens.slice(border, border + 6).map(token => token.text), ['日本語', '/', 'a', 'b', '<>&', '😀']);
    assert.ok(after.document.tokens.slice(border, border + 6).every(token => token.kind === 'pseudo'));
    assert.equal(new Set(after.document.tokens.slice(border, border + 6).map(token => token.id)).size, 6);
    assert.equal(new Set(after.document.tokens.slice(border, border + 6).map(token => token.slotId)).size, 6);
    assert.equal(after.document.tokens.length, d.tokens.length + 6);
    assert.equal(records.length, 1);
    key('/'); typePseudo(editor, 'second'); key('Enter');
    assert.equal(display().borderIndex, border + 7);
    assert.equal(records.length, 2);
    key('u');
    assert.deepEqual(api.snapshot().document, after.document);
    key('r', { ctrlKey: true });
    assert.equal(api.snapshot().document.tokens[border + 6].text, 'second');
  }
});

test('IME Enter/Esc, ordinary typing, undo keys and repeated Enter do not commit the session', () => {
  const editor = setup();
  const { api, key, display, records, undoCalls } = editor;
  key('b'); key('/');
  typePseudo(editor, '変換');
  display().pseudoInput.composing = true;
  key('Enter'); key('Escape');
  display().pseudoInput.composing = false;
  for (const [input, extra] of [['Enter', { isComposing: true }], ['Escape', { keyCode: 229 }], ['Enter', { repeat: true }],
    ['u', {}], ['/', {}], ['i', {}], ['ArrowLeft', {}], ['n', { ctrlKey: true }], ['r', { ctrlKey: true }]]) {
    key(input, extra);
    assert.equal(api.getInputMode(), 'PSEUDO_INPUT');
  }
  assert.equal(records.length, 0);
  assert.equal(undoCalls.length, 0);
  key('Enter');
  assert.equal(display().mode, 'BORDER');
  assert.equal(records.length, 1);
});

test('empty creation, Esc and leaving discard drafts without changing history or redo', () => {
  const editor = setup();
  const { api, key, display, records } = editor;
  key('a'); key('b'); key('u'); // Establish a redo entry.
  const unchanged = api.snapshot().document;
  key('b'); key('l'); key('/'); typePseudo(editor, '   \t   '); key('Enter');
  assert.equal(display().mode, 'BORDER');
  assert.equal(display().borderIndex, 1);
  key('/'); typePseudo(editor, '取消'); key('Escape');
  assert.equal(display().borderIndex, 1);
  key('/'); typePseudo(editor, '離れる'); api.finishEditing();
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().document, unchanged);
  assert.equal(records.length, 1);
  key('r', { ctrlKey: true });
  assert.equal(api.snapshot().document.slots[0].marker, 'marker.adjective');
});

test('i edits pseudo slots and their own split halves, preserving ID, split and selected slot', () => {
  for (const kind of [null, 't', 'd']) {
    let d = withPseudo();
    if (kind) d = splitSlot(d, 'pseudo-slot', kind);
    const layout = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
    const slotIds = kind ? [d.splits[0].leftSlotId, d.splits[0].rightSlotId] : ['pseudo-slot'];
    for (const slot of slotIds) {
      const editor = setup(d);
      const { api, key, display, records } = editor;
      const cursor = slotPosition(layout, slot);
      api.restore({ document: d, cursor });
      key('i');
      assert.equal(api.getInputMode(), 'PSEUDO_INPUT');
      assert.equal(display().pseudoInput.text, '日本語');
      typePseudo(editor, ' modified text '); key('Enter');
      assert.equal(display().mode, 'NORMAL');
      assert.deepEqual(api.snapshot().cursor, cursor);
      assert.deepEqual(api.snapshot().document.tokens[1], { ...d.tokens[1], text: ' modified text ' });
      assert.deepEqual(api.snapshot().document.splits, d.splits);
      assert.equal(records.length, 1);
      key('u'); assert.deepEqual(api.snapshot(), { document: d, cursor });
      key('r', { ctrlKey: true });
      assert.equal(api.snapshot().document.tokens[1].text, ' modified text ');
    }
  }
});

test('unchanged reediting and cancel create no history, and real/group slots keep whole-English i', () => {
  const d = withPseudo();
  const editor = setup(d);
  const { api, key, records, display } = editor;
  api.restore({ document: d, cursor: { x: 1, y: 0 } });
  key('i'); key('Enter');
  assert.equal(records.length, 0);
  key('i'); typePseudo(editor, 'discard'); key('Escape');
  assert.deepEqual(api.snapshot().document, d);
  assert.equal(display().mode, 'NORMAL');
  assert.equal(records.length, 0);
  api.restore({ document: d, cursor: { x: 0, y: 0 } });
  key('i');
  assert.equal(api.getInputMode(), 'INSERT');
  assert.equal(display().sentenceDraft, 'a b c');
  api.finishEditing();
  assert.deepEqual(api.snapshot().document, d);
  const grouped = structuredClone(d);
  grouped.groups.push({ id: 'g', slotId: 'g', kind: 'basic', slots: ['pseudo-slot', 'b'] });
  grouped.slots.push({ id: 'g' });
  api.restore({ document: grouped, cursor: { x: 1, y: 0 } });
  key('i');
  assert.equal(api.getInputMode(), 'INSERT');
  api.finishEditing();
  assert.deepEqual(api.snapshot().document, grouped);
});

test('empty reedit deletes, returning to the right token or left at the end, with one undo step', () => {
  for (const [index, empty] of [[0, false], [1, false], [3, false], [0, true]]) {
    const d = withPseudo(index, empty ? { ...initialDocument(), tokens: [], slots: [] } : initialDocument());
    const editor = setup(d);
    const { api, key, display, records } = editor;
    api.restore({ document: d, cursor: { x: index, y: 0 } });
    key('i'); typePseudo(editor, ''); key('Enter');
    assert.equal(display().mode, 'NORMAL');
    assert.equal(api.snapshot().document.tokens.some(t => t.kind === 'pseudo'), false);
    assert.deepEqual(api.snapshot().cursor, { x: empty ? 0 : Math.min(index, 2), y: 0 });
    assert.equal(records.length, 1);
    key('u'); assert.deepEqual(api.snapshot(), { document: d, cursor: { x: index, y: 0 } });
  }
});

test('creation preflight keeps BORDER and reports a message when a split source would become discontinuous', () => {
  let d = initialDocument();
  d.groups.push({ id: 'g', slotId: 'g', kind: 'basic', slots: ['a', 'b'] });
  d.slots.push({ id: 'g' });
  d = splitSlot(d, 'g', 't');
  const { api, key, display, records } = setup(d);
  key('b'); key('l'); key('/');
  assert.equal(display().mode, 'BORDER');
  assert.equal(display().pseudoInput, null);
  assert.match(display().pseudoMessage, /T\/D/);
  assert.deepEqual(api.snapshot().document, d);
  assert.equal(records.length, 0);
});

test('switching to sentence/translation input and restoring cancel pseudo sessions without leaking draft data', () => {
  const editor = setup(withPseudo());
  const { api, key, display } = editor;
  const before = api.snapshot();
  for (const translation of [false, true]) {
    key('b'); key('/'); typePseudo(editor, 'not saved');
    api.startInput(translation);
    assert.equal(api.getInputMode(), translation ? 'TRANSLATION' : 'INSERT');
    assert.equal(display().pseudoInput, null);
    assert.deepEqual(api.snapshot().document, before.document);
    api.finishEditing();
  }
  key('b'); key('$'); key('/'); typePseudo(editor, 'stale');
  api.restore(before);
  assert.equal(display().mode, 'NORMAL');
  assert.equal(display().pseudoInput, null);
  assert.deepEqual(api.snapshot(), before);
});

test('BORDER inserts independent brackets once and undo/redo restores their IDs and slots', () => {
  const { api, key, display, records } = setup();
  key('b'); key('['); key('[', { repeat: true });
  const opening = api.snapshot().document.tokens[0];
  assert.equal(opening.kind, 'bracket-open');
  assert.equal(display().mode, 'BORDER');
  assert.equal(display().borderIndex, 1);
  key(']'); key(']', { repeat: true });
  const after = api.snapshot().document;
  assert.equal(after.tokens[1].kind, 'bracket-close');
  assert.equal(after.tokens[1].slotId, undefined);
  assert.equal(display().borderIndex, 2);
  assert.equal(records.length, 2);
  key('u');
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().document.tokens[0], opening);
  key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot().document, after);
  key('0');
  assert.equal(api.snapshot().cursor.x, 0);
  key('l');
  assert.equal(api.snapshot().cursor.x, 2); // skips the closing bracket
  key('h');
  assert.equal(api.snapshot().cursor.x, 0);
});

test('normal [ slot supports click, markers and arrows, but neither T nor D', () => {
  const initial = insertBracket(initialDocument(), 1, '[').document;
  const opening = initial.tokens[1].slotId;
  const { api, key, html } = setup(initial);
  assert.match(html, /aria-label="開き角括弧 に対応するスロット/);
  api.clickSlotId(opening);
  assert.deepEqual(api.snapshot().cursor, { x: 1, y: 0 });
  key('t'); key('d');
  assert.deepEqual(api.snapshot().document.splits, []);
  key('a'); key('d'); api.finishMarkerInput();
  assert.equal(api.snapshot().document.slots.find(s => s.id === opening).marker, 'marker.adverb');
  key('r'); key('l'); key('Enter');
  assert.deepEqual(api.snapshot().document.arrows, [{ sourceSlotId: opening, targetSlotId: 'b' }]);
  key('h'); key('x');
  assert.equal(api.snapshot().document.slots.find(s => s.id === opening).marker, undefined);
  assert.deepEqual(api.snapshot().document.arrows, []);
  const grouped = structuredClone(initial);
  grouped.groups.push({ id: 'g', slotId: 'g', kind: 'composite', slots: [opening, 'b'] });
  grouped.slots.push({ id: 'g' });
  const nested = setup(grouped);
  nested.api.clickSlotId(opening); nested.key('j');
  assert.deepEqual(nested.api.snapshot().cursor, { x: 1, y: 1 });
  nested.key('k');
  assert.deepEqual(nested.api.snapshot().cursor, { x: 1, y: 0 });
  nested.key('0');
  assert.equal(nested.api.snapshot().document.groups[0].kind, 'composite');
});

test('BORDER deletion removes only neighboring brackets, suppresses repeat and retains history', () => {
  const { api, key, display, records } = setup();
  key('b'); key('['); key(']');
  const inserted = api.snapshot().document;
  key('Backspace', { repeat: true });
  assert.deepEqual(api.snapshot().document, inserted);
  key('Backspace');
  assert.equal(display().borderIndex, 1);
  assert.equal(api.snapshot().document.tokens[0].kind, 'bracket-open');
  key('Delete'); // real token to the right is preserved
  assert.equal(records.length, 3);
  key('h'); key('Delete', { repeat: true }); key('Delete');
  assert.equal(records.length, 4);
  assert.equal(display().borderIndex, 0);
  assert.deepEqual(api.snapshot().document, initialDocument());
  key('u');
  assert.equal(api.snapshot().document.tokens[0].kind, 'bracket-open');
  key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot().document, initialDocument());
});

test('BORDER deletion removes neighboring pseudo tokens and their dependents but preserves real tokens', () => {
  for (const direction of ['Backspace', 'Delete']) {
    let d = withPseudo();
    d = splitSlot(d, 'pseudo-slot', 'd');
    const left = d.splits[0].leftSlotId;
    d.groups.push({ id: 'dependent', slotId: 'dependent-slot', kind: 'composite', slots: [left, 'b'] });
    d.slots.push({ id: 'dependent-slot' });
    const editor = setup(d);
    const { api, key, display, records } = editor;
    key('b'); key('l');
    if (direction === 'Backspace') key('l');
    key(direction, { repeat: true });
    assert.deepEqual(api.snapshot().document, d);
    key(direction);
    assert.equal(display().mode, 'BORDER');
    assert.equal(display().borderIndex, 1);
    assert.deepEqual(api.snapshot().document.tokens.map(token => token.text), ['a', 'b', 'c']);
    assert.deepEqual(api.snapshot().document.splits, []);
    assert.deepEqual(api.snapshot().document.groups, []);
    assert.equal(records.length, 1);
    key('Delete');
    assert.deepEqual(api.snapshot().document.tokens.map(token => token.text), ['a', 'b', 'c']);
    assert.equal(records.length, 1);
    key('u');
    assert.deepEqual(api.snapshot().document, d);
  }
});

test('NORMAL X does not delete an ungrouped pseudo token', () => {
  const d = withPseudo();
  const editor = setup(d);
  editor.api.restore({ document: d, cursor: { x: 1, y: 0 } });
  editor.key('X');
  assert.deepEqual(editor.api.snapshot().document, d);
  assert.equal(editor.records.length, 0);
});

test('closing-only documents are unselected and initial/restore/first cursors skip leading closings', () => {
  const empty = { ...initialDocument(), tokens: [], slots: [] };
  const only = insertBracket(empty, 0, ']').document;
  const editor = setup(only);
  assert.equal(editor.display().currentRegion, null);
  editor.key('a'); editor.key('t'); editor.key('d'); editor.key('v'); editor.key('Enter');
  assert.deepEqual(editor.api.snapshot().document, only);
  editor.key('Escape'); editor.key('b'); editor.key('$'); editor.key('Backspace');
  assert.deepEqual(editor.api.snapshot().document, empty);
  const initial = insertBracket(initialDocument(), 0, ']').document;
  const other = setup(initial);
  assert.deepEqual(other.api.snapshot().cursor, { x: 1, y: 0 });
  other.api.restore({ document: initial, cursor: { x: 0, y: 0 } });
  assert.deepEqual(other.api.snapshot().cursor, { x: 1, y: 0 });
  other.key('$'); other.api.selectFirst();
  other.key('l');
  assert.deepEqual(other.api.snapshot().cursor, { x: 2, y: 0 });
});

test('bracket insertion rejects discontinuous T/D sources without history and ignores modified/IME keys', () => {
  for (const kind of ['t', 'd']) {
    let initial = initialDocument();
    initial.groups = [{ id: 'group', slotId: 'group', kind: 'basic', slots: ['a', 'b'] }];
    initial.slots.push({ id: 'group' });
    initial = splitSlot(initial, 'group', kind);
    const { api, key, display, records } = setup(initial);
    key('b'); key('l');
    for (const bracket of ['[', ']', '(', ')', '<', '>']) {
      key(bracket);
      assert.equal(display().mode, 'BORDER');
      assert.match(display().pseudoMessage, /T\/D/);
      assert.deepEqual(api.snapshot().document, initial);
    }
    key('0');
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) key('[', extra);
    assert.equal(records.length, 0);
  }
});

test('NORMAL brackets surround the current token while retaining its cursor, membership, and one undo step per insertion', () => {
  for (const initial of [initialDocument(), withPseudo()]) {
    const { api, key, display, records } = setup(initial);
    key('l');
    const before = api.snapshot();
    const slotId = initial.tokens[1].slotId;
    const recordCount = records.length;
    key('[');
    assert.equal(display().mode, 'NORMAL');
    assert.equal(api.snapshot().document.tokens[1].kind, 'bracket-open');
    assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
    key(']');
    const after = api.snapshot();
    assert.equal(after.document.tokens[3].kind, 'bracket-close');
    assert.equal(after.document.tokens[2].slotId, slotId);
    assert.deepEqual(after.cursor, { x: 2, y: 0 });
    assert.deepEqual(after.document.groups, before.document.groups);
    assert.equal(records.length - recordCount, 2);
    key('u'); key('u');
    assert.deepEqual(api.snapshot(), before);
    key('r', { ctrlKey: true }); key('r', { ctrlKey: true });
    assert.deepEqual(api.snapshot(), after);
  }
});

test('NORMAL brackets keep the selected sparse region and its internal split atom through insertion', () => {
  let initial = splitSlot(initialDocument(), 'c');
  initial.groups = [{ id: 'g', slotId: 'g', kind: 'composite', slots: ['a', 'c'] }];
  initial.slots.push({ id: 'g' });
  const { api, key, display } = setup(initial);
  api.restore({ document: initial, cursor: { x: 3, y: 1 } }); // c's right half, in g's second region
  const before = api.snapshot();
  key('[');
  assert.equal(api.snapshot().document.tokens[2].kind, 'bracket-open');
  assert.deepEqual(api.snapshot().cursor, { x: 4, y: 1 });
  key(']');
  const after = api.snapshot();
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(after.document.tokens.map(t => t.text), ['a', 'b', '[', 'c', ']']);
  assert.deepEqual(after.cursor, { x: 4, y: 1 });
  assert.deepEqual(after.document.groups, initial.groups);
  assert.deepEqual(after.document.splits, initial.splits);
  key('u'); key('u');
  assert.deepEqual(api.snapshot(), before);
  key('r', { ctrlKey: true }); key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot(), after);
});

test('NORMAL refuses the bracket side of a group without moving the cursor or clearing redo, then allows the other side', () => {
  const initial = insertBracket(initialDocument(), 1, '[').document;
  const opening = initial.tokens[1].slotId;
  initial.groups = [{ id: 'g', slotId: 'g', kind: 'composite', slots: [opening, 'b'] }];
  initial.slots.push({ id: 'g' });
  const { api, key, display, records } = setup(initial);
  api.clickSlotId('g');
  const recordCount = records.length;
  const before = api.snapshot();
  key(']'); const after = api.snapshot(); key('u');
  assert.deepEqual(api.snapshot(), before);
  key('[');
  assert.match(display().pseudoMessage, /左端.*基礎スロット/);
  assert.deepEqual(api.snapshot(), before);
  assert.equal(records.length - recordCount, 1);
  assert.equal(display().mode, 'NORMAL');
  key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot(), after);
  key(']');
  assert.equal(display().pseudoMessage, '');
});

test('NORMAL refuses missing regions, standalone [ and fractional/aligned-but-invalid T/D insertions without edits', () => {
  const cases = [];
  for (const kind of ['t', 'd']) {
    const d = splitSlot(initialDocument(), 'b', kind);
    const layout = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
    cases.push([d, slotPosition(layout, d.splits[0].leftSlotId), ']', /途中/]);
    cases.push([d, slotPosition(layout, d.splits[0].rightSlotId), '[', /途中/]);
    const grouped = initialDocument();
    grouped.groups = [{ id: 'g', slotId: 'g', kind: 'basic', slots: ['a', 'b'] }];
    grouped.slots.push({ id: 'g' });
    const split = splitSlot(grouped, 'g', kind);
    cases.push([split, { x: 0, y: 0 }, ']', /T\/D/]);
  }
  const empty = { ...initialDocument(), tokens: [], slots: [] };
  for (const key of ['[', ']']) {
    cases.push([empty, { x: 0, y: 0 }, key, /選択されていません/]);
    cases.push([insertBracket(empty, 0, '[').document, { x: 0, y: 0 }, key, /基礎スロット/]);
  }
  for (const [initial, cursor, bracket, message] of cases) {
    const { api, key, records, display } = setup(initial);
    api.restore({ document: initial, cursor });
    const before = api.snapshot();
    key(bracket);
    assert.deepEqual(api.snapshot(), before);
    assert.equal(records.length, 0);
    assert.match(display().pseudoMessage, message);
  }
});

test('NORMAL brackets commit pending markers first, ignore repeat/modifiers/IME, and do not run in visual/arrow modes', () => {
  const { api, key, records } = setup();
  key('a'); key('[');
  assert.equal(records.length, 2);
  assert.equal(records[0].after.document.slots[0].marker, 'marker.adjective');
  assert.equal(records[0].after.document.tokens.length, 3);
  assert.equal(records[1].before.document.slots[0].marker, 'marker.adjective');
  assert.equal(records[1].after.document.tokens.length, 4);
  const before = api.snapshot();
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    key('[', extra); key(']', extra);
    assert.deepEqual(api.snapshot(), before);
  }
  assert.equal(records.length, 2);
  for (const modeKey of ['v', 'r']) {
    const other = setup();
    if (modeKey === 'r') { other.key('a'); other.key('d'); }
    other.key(modeKey);
    const before = other.api.snapshot();
    other.key('['); other.key(']');
    assert.deepEqual(other.api.snapshot(), before);
  }
});

test('NORMAL parentheses accept Shift, preserve real/pseudo slots and undo each independent insertion', () => {
  for (const initial of [initialDocument(), withPseudo()]) {
    const { api, key, display, records } = setup(initial);
    key('l');
    const before = api.snapshot();
    const recordCount = records.length;
    key('(', { shiftKey: true });
    assert.equal(api.snapshot().document.tokens.length, initial.tokens.length + 1);
    assert.equal(api.snapshot().document.tokens[1].kind, 'paren-open');
    assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
    key(')', { shiftKey: true });
    const after = api.snapshot();
    assert.equal(display().mode, 'NORMAL');
    assert.equal(after.document.tokens[3].kind, 'paren-close');
    assert.equal(after.document.tokens[2].slotId, initial.tokens[1].slotId);
    assert.deepEqual(after.cursor, { x: 2, y: 0 });
    assert.deepEqual(after.document.slots, [...initial.slots, { id: after.document.tokens[1].slotId }]);
    assert.deepEqual(after.document.groups, initial.groups);
    assert.equal(records.length - recordCount, 2);
    key('u'); key('u'); assert.deepEqual(api.snapshot(), before);
    key('r', { ctrlKey: true }); key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot(), after);
  }
});

test('NORMAL angles accept Shift, preserve the selected real/pseudo slot and undo each insertion', () => {
  for (const initial of [initialDocument(), withPseudo()]) {
    const { api, key, display, records } = setup(initial);
    key('l'); const before = api.snapshot(); const count = records.length;
    key('<', { shiftKey: true });
    assert.equal(api.snapshot().document.tokens[1].kind, 'angle-open');
    assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
    key('>', { shiftKey: true });
    const after = api.snapshot();
    assert.equal(after.document.tokens[3].kind, 'angle-close');
    assert.equal(after.document.tokens[2].slotId, initial.tokens[1].slotId);
    assert.equal(after.document.slots.length, initial.slots.length + 1);
    assert.deepEqual(after.cursor, { x: 2, y: 0 });
    assert.equal(display().mode, 'NORMAL');
    assert.equal(records.length - count, 2);
    key('u'); key('u'); assert.deepEqual(api.snapshot(), before);
    key('r', { ctrlKey: true }); key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot(), after);
  }
});

for (const [openText, closeText, kind] of [['<', '>', 'angle'], ['(', ')', 'paren']]) {
test(`${kind}: virtual bracket selection highlights the glyph and ignores marker edits without history or mode changes`, () => {
  const empty = { ...initialDocument(), tokens: [], slots: [] };
  const only = insertBracket(insertBracket(empty, 0, openText).document, 1, closeText).document;
  const { api, key, display, html, records } = setup(only);
  assert.match(html, /class="angle-selection current"/);
  assert.ok(html.includes(`aria-label="開き${kind === 'paren' ? '丸' : '山'}括弧（ad系統・標識入力不可）"`));
  assert.ok(html.includes(`class="token ${kind}-close"`));
  assert.doesNotMatch(html, /class="slot(?: |")/);
  api.clickSlotId(only.tokens[0].slotId);
  assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
  const before = api.snapshot(), count = records.length;
  for (const command of ['a', 'd', 's', 'n', 'V', '1', 'x', 't', 'd', 'f']) key(command);
  api.finishMarkerInput();
  assert.deepEqual(api.snapshot(), before);
  assert.equal(display().mode, 'NORMAL');
  assert.equal(records.length, count);
  assert.equal(api.canSave(), true);
});

test(`${kind}: Enter excludes virtual brackets from both selection modes and bracket-only selection creates no edit`, () => {
  const initial = insertBracket(initialDocument(), 1, openText).document;
  const opening = initial.tokens[1].slotId;
  const layout = computeLayout(initial.tokens, initial.groups, initial.splits, initial.arrows);
  for (const mode of ['VISUAL', 'VISUAL_MULTI']) {
    for (const onlyBracket of [false, true]) {
      const { api, key, records, display } = setup(initial);
      let selected = onlyBracket ? [opening] : selectSlotRange(layout, { x: 0, y: 0 }, { x: 2, y: 0 });
      if (mode === 'VISUAL_MULTI') {
        selected = [];
        for (const x of onlyBracket ? [1] : [0, 1, 2]) selected = toggleSlotSelection(layout, selected, { x, y: 0 });
      }
      api.setSelectionForTest(selected, mode);
      const before = api.snapshot();
      key('Enter');
      assert.equal(display().mode, 'NORMAL');
      if (onlyBracket) {
        assert.deepEqual(api.snapshot(), before);
        assert.equal(records.length, 0);
      } else {
        const after = api.snapshot();
        assert.deepEqual(after.document.groups[0].slots, ['a', 'b']);
        assert.equal(after.document.groups[0].kind, 'basic');
        assert.equal(records.length, 1);
        key('u'); assert.deepEqual(api.snapshot(), before);
        key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot(), after);
      }
    }
  }
});

test(`${kind}: virtual bracket arrow handlers create, cancel, replace and remove outgoing arrows while retaining incoming arrows`, () => {
  const initial = insertBracket(initialDocument(), 1, openText).document;
  const opening = initial.tokens[1].slotId;
  initial.slots[0].marker = 'marker.adverb';
  initial.arrows = [{ sourceSlotId: 'a', targetSlotId: opening }];
  const { api, key, display } = setup(initial);
  api.clickSlotId(opening);
  key('r'); assert.equal(display().mode, 'ARROW');
  key('Escape'); assert.equal(display().mode, 'NORMAL');
  assert.deepEqual(api.snapshot().document.arrows, initial.arrows);
  key('r'); key('l');
  const beforeArrow = api.snapshot();
  key('Enter');
  assert.equal(display().mode, 'NORMAL');
  const withArrow = api.snapshot();
  key('u'); assert.deepEqual(api.snapshot(), beforeArrow);
  key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot(), withArrow);
  assert.deepEqual(api.snapshot().document.arrows, [...initial.arrows, { sourceSlotId: opening, targetSlotId: 'b' }]);
  api.clickSlotId(opening); key('x'); key('a'); key('d'); api.finishMarkerInput();
  assert.equal(api.snapshot().document.arrows.length, 2);
  key('r'); key('l'); key('l'); key('Enter');
  assert.deepEqual(api.snapshot().document.arrows, [...initial.arrows, { sourceSlotId: opening, targetSlotId: 'c' }]);
  api.clickSlotId(opening); key('R', { shiftKey: true });
  assert.deepEqual(api.snapshot().document.arrows, initial.arrows);
  key('u'); assert.equal(api.snapshot().document.arrows.length, 2);
  key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot().document.arrows, initial.arrows);
  key('r'); key('l'); key('Enter');
  api.clickSlotId(opening);
  const beforeDelete = api.snapshot().document;
  key('b'); key('Delete');
  const deleted = api.snapshot().document;
  assert.deepEqual(deleted.arrows, []);
  assert.ok(!deleted.slots.some(slot => slot.id === opening));
  key('u'); assert.deepEqual(api.snapshot().document, beforeDelete);
  key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot().document, deleted);
});

test(`${kind}: virtual bracket is a modifier target but never an apposition target through editor handlers`, () => {
  for (const marker of ['marker.adverb', 'marker.noun']) {
    const initial = insertBracket(initialDocument(), 1, openText).document;
    const opening = initial.tokens[1].slotId;
    initial.slots[0].marker = marker;
    const { api, key, display } = setup(initial);
    key('r'); api.clickSlotId(opening); key('Enter');
    if (marker === 'marker.adverb') {
      assert.equal(display().mode, 'NORMAL');
      assert.deepEqual(api.snapshot().document.arrows, [{ sourceSlotId: 'a', targetSlotId: opening }]);
    } else {
      assert.equal(display().mode, 'ARROW');
      assert.deepEqual(api.snapshot().document.arrows, []);
      assert.match(display().arrowMessage, /同格の相手/);
    }
  }
});

test(`${kind}: BORDER creates independent brackets, skips the closing glyph on return and deletes with undo/redo`, () => {
  const { api, key, display } = setup();
  key('b'); key(openText, { shiftKey: true }); key(closeText, { shiftKey: true });
  const added = api.snapshot().document;
  assert.deepEqual(added.tokens.slice(0, 2).map(t => t.text), [openText, closeText]);
  assert.equal(added.slots.length, 4);
  key('Escape'); api.selectFirst();
  assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
  key('l'); assert.deepEqual(api.snapshot().cursor, { x: 2, y: 0 });
  key('h'); assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
  assert.equal(display().mode, 'NORMAL');
  key('b'); key('0'); key('Delete'); key('Delete');
  assert.deepEqual(api.snapshot().document, initialDocument());
  key('u'); key('u'); assert.deepEqual(api.snapshot().document, added);
  key('r', { ctrlKey: true }); key('r', { ctrlKey: true });
  assert.deepEqual(api.snapshot().document, initialDocument());
});

}

test('angles suppress repeat/modifiers/IME and never insert in visual or arrow modes', () => {
  for (const commands of [[], ['b']]) {
    const editor = setup(); commands.forEach(command => editor.key(command));
    const before = editor.api.snapshot();
    for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      editor.key('<', { shiftKey: true, ...extra }); editor.key('>', { shiftKey: true, ...extra });
      assert.deepEqual(editor.api.snapshot(), before);
    }
    assert.equal(editor.records.length, 0);
  }
  for (const commands of [['v'], ['v', 'v'], ['a', 'r'], ['i'], ['f'], ['b', '/']]) {
    const editor = setup(); commands.forEach(command => editor.key(command));
    const before = editor.api.snapshot();
    editor.key('<', { shiftKey: true }); editor.key('>', { shiftKey: true });
    assert.deepEqual(editor.api.snapshot(), before);
  }
});

test('NORMAL parentheses preserve the selected sparse region and split atom', () => {
  const initial = splitSlot(initialDocument(), 'c');
  initial.groups = [{ id: 'g', slotId: 'g', kind: 'composite', slots: ['a', 'c'] }];
  initial.slots.push({ id: 'g' });
  const { api, key } = setup(initial);
  api.restore({ document: initial, cursor: { x: 3, y: 1 } });
  key('('); key(')');
  const after = api.snapshot();
  assert.deepEqual(after.document.tokens.map(t => t.text), ['a', 'b', '(', 'c', ')']);
  assert.deepEqual(after.cursor, { x: 4, y: 1 });
  assert.deepEqual(after.document.slots, [...initial.slots, { id: after.document.tokens[2].slotId }]);
  assert.deepEqual(after.document.groups, initial.groups);
  assert.deepEqual(after.document.splits, initial.splits);
});

test('BORDER parentheses mix with square brackets, delete adjacent glyphs only, and retain undo/redo', () => {
  const { api, key, display, records } = setup();
  key('b'); key('(', { shiftKey: true }); key(')'); key('['); key(']');
  const inserted = api.snapshot().document;
  assert.deepEqual(inserted.tokens.slice(0, 4).map(t => t.text), ['(', ')', '[', ']']);
  assert.equal(inserted.slots.length, initialDocument().slots.length + 2);
  assert.equal(display().borderIndex, 4);
  assert.equal(records.length, 4);
  key('0'); key('Delete', { repeat: true });
  assert.deepEqual(api.snapshot().document, inserted);
  key('Delete');
  assert.equal(display().borderIndex, 0);
  assert.equal(api.snapshot().document.tokens[0].text, ')');
  key('l'); key('Backspace', { repeat: true }); key('Backspace');
  const deleted = api.snapshot().document;
  assert.equal(display().borderIndex, 0);
  assert.equal(deleted.tokens[0].text, '[');
  assert.deepEqual(deleted.slots, inserted.slots.filter(s => s.id !== inserted.tokens[0].slotId));
  key('u'); key('u'); assert.deepEqual(api.snapshot().document, inserted);
  key('r', { ctrlKey: true }); key('r', { ctrlKey: true }); assert.deepEqual(api.snapshot().document, deleted);
  key('b'); key('$'); key('Backspace');
  assert.deepEqual(api.snapshot().document, deleted); // real token must not be deleted
});

test('parenthesis-only documents have a virtual opening selection and can be edited from BORDER', () => {
  const empty = { ...initialDocument(), tokens: [], slots: [] };
  const only = insertBracket(insertBracket(empty, 0, '(').document, 1, ')').document;
  const { api, key, display, html } = setup(only);
  assert.deepEqual(display().currentRegion, { start: 0, end: 1 });
  assert.match(html, /class="token paren-open"/);
  assert.match(html, /class="token paren-close"/);
  assert.doesNotMatch(html, /に対応するスロット/);
  for (const command of ['h', 'l', '0', '$', 'a', 't', 'd', '(', ')']) key(command);
  assert.deepEqual(api.snapshot().document, only);
  key('b'); key('$'); key('Backspace'); key('Backspace');
  assert.deepEqual(api.snapshot().document, empty);
  key('(', { shiftKey: true }); key(')', { shiftKey: true });
  assert.deepEqual(api.snapshot().document.tokens.map(t => t.text), ['(', ')']);
  assert.deepEqual(api.snapshot().document.slots, [{ id: api.snapshot().document.tokens[0].slotId }]);
  key('Escape'); assert.deepEqual(api.snapshot().cursor, { x: 0, y: 0 });
});

test('parentheses commit markers first, suppress repeat/modifiers/IME, and never insert in other modes', () => {
  const { key, records } = setup();
  key('a'); key('(', { shiftKey: true });
  assert.equal(records.length, 2);
  assert.equal(records[0].after.document.slots[0].marker, 'marker.adjective');
  assert.equal(records[1].before.document.slots[0].marker, 'marker.adjective');
  for (const commands of [[], ['b']]) {
    const editor = setup();
    commands.forEach(command => editor.key(command));
    const before = editor.api.snapshot();
    for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      editor.key('(', { shiftKey: true, ...extra }); editor.key(')', { shiftKey: true, ...extra });
      assert.deepEqual(editor.api.snapshot(), before);
    }
    assert.equal(editor.records.length, 0);
  }
  for (const commands of [['v'], ['v', 'v'], ['a', 'r'], ['i'], ['f'], ['b', '/']]) {
    const editor = setup();
    commands.forEach(command => editor.key(command));
    const before = editor.api.snapshot();
    editor.key('(', { shiftKey: true }); editor.key(')', { shiftKey: true });
    assert.deepEqual(editor.api.snapshot(), before);
  }
});

// Compare actual handlers so cancellation keeps the same cursor and history.
for (const commands of [[], ['a'], ['b', 'l'], ['v', 'l'], ['v', 'v', 'l'], ['a', 'r', 'l'], ['f', 'p'], ['b', '/', 'a']]) {
  test(`Ctrl+[ matches Escape after ${commands.join(' ') || 'NORMAL'}`, () => {
    const escape = setup();
    const shortcut = setup();
    for (const command of commands) {
      escape.key(command);
      shortcut.key(command);
    }
    assert.equal(shortcut.key('[', { ctrlKey: true }), escape.key('Escape'));
    assert.equal(shortcut.display().mode, escape.display().mode);
    assert.deepEqual(shortcut.api.snapshot(), escape.api.snapshot());
    assert.deepEqual(shortcut.records, escape.records);
  });
}

test('Ctrl+[ respects IME guards in selection, form and pseudo input modes', () => {
  for (const commands of [['v'], ['b'], ['f'], ['b', '/']]) {
    const editor = setup();
    for (const command of commands) editor.key(command);
    const mode = editor.display().mode;
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      editor.key('[', { ctrlKey: true, ...extra });
      assert.equal(editor.display().mode, mode);
    }
  }
});

test('Ctrl+[ finishes English and translation editing without inserting a bracket', () => {
  for (const translation of [false, true]) {
    const editor = setup();
    const before = editor.api.snapshot();
    editor.api.startInput(translation);
    assert.equal(editor.display().mode, translation ? 'TRANSLATION' : 'INSERT');
    assert.equal(editor.key('[', { ctrlKey: true }), true);
    assert.equal(editor.display().mode, 'NORMAL');
    assert.deepEqual(editor.api.snapshot(), before);
    const finished = setup();
    finished.api.startInput(translation);
    finished.api.finishEditing();
    assert.deepEqual(editor.records, finished.records);
  }
});

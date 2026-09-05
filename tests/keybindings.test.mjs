import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { OPERATIONS, compareOperations, defaultSettings, resolveInput, findConflicts, captureKey,
  validateSettings, bindingLabel, getSettings, applySettings, loadSettings, saveSettings, SETTINGS_STORAGE_KEY,
  subscribeSettings, sequenceBindings } from '../src/keybindings.ts';
import { operationKeyLabel } from '../src/inputConfig.ts';
import { nextMarkerInput } from '../src/markers.ts';
import { formIdForInput } from '../src/formEditing.ts';
import { pseudoInputAction } from '../src/pseudoEditing.ts';
import { customMarkerInputAction } from '../src/customMarkerEditing.ts';
import { moveBorder } from '../src/borderNavigation.ts';
import { entryShortcut } from '../src/entryShortcuts.ts';
import { resolveKeyboardOperation } from '../src/keyboardOperations.ts';

const chord = (key, extra = {}) => captureKey({ key, ...extra });
const sequence = sequence => ({ kind: 'sequence', sequence });
const winner = (settings, key, mode = 'NORMAL', buffer = '', extra = {}) => resolveInput({ key, ...extra }, { mode, buffer }, settings).winner;
afterEach(() => applySettings(defaultSettings()));

test('every pair of operations has a fixed total order; categories and Undo before Redo are explicit', () => {
  const ids = OPERATIONS.map(op => op.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    assert.equal(Math.sign(compareOperations(ids[i], ids[j])), Math.sign(i - j));
    if (j + 1 < ids.length && i < j) assert.ok(compareOperations(ids[i], ids[j + 1]) < 0);
  }
  assert.ok(compareOperations('history.undo', 'history.redo') < 0);
  assert.ok(compareOperations('cursor.left', 'entry.reorderDown') < 0);
  const bindings = ['selection.commit', 'arrow.commit'].map(operation => ({ operation, rules: [{ key: 'Enter' }] }));
  assert.equal(resolveKeyboardOperation({ key: 'Enter' }, bindings), 'arrow.commit');
  assert.equal(resolveKeyboardOperation({ key: 'Enter' }, bindings.reverse()), 'arrow.commit');
});

test('same-mode conflicts choose one operation independent of binding order; excluded modes are not conflicts', () => {
  const settings = defaultSettings();
  settings.bindings['cursor.right'] = [chord('s')];
  assert.equal(winner(settings, 's').operation, 'cursor.right');
  assert.equal(winner(settings, '/').operation, 'marker.customStart');
  assert.equal(winner(settings, '/', 'BORDER').operation, 'pseudo.start');
  const warnings = findConflicts(settings);
  assert.ok(warnings.some(w => w.mode === 'NORMAL' && w.input === 's' && w.winner === 'cursor.right' && w.operations.includes('marker.subject')));
  assert.ok(!warnings.some(w => w.operations.includes('pseudo.start') && w.operations.includes('marker.customStart')));
});

test('prefixes and valid continuations are not competing new inputs; only executable duplicates conflict', () => {
  const settings = defaultSettings();
  const s = winner(settings, 's');
  assert.equal(s.operation, 'marker.subject'); assert.equal(s.complete, true); assert.equal(s.hasLonger, true);
  const sa = winner(settings, 'a', 'MARKER_SEQUENCE', s.buffer);
  assert.equal(sa.operation, 'marker.sentenceAdverb'); assert.equal(sa.complete, false);
  assert.equal(winner(settings, 'd', 'MARKER_SEQUENCE', sa.buffer).operation, 'marker.sentenceAdverb');
  assert.equal(winner(settings, 'p', 'FORM').operation, 'form.past');
  assert.equal(winner(settings, 'p', 'FORM', 'p').operation, 'form.pastParticiple');
  const warnings = findConflicts(settings);
  assert.ok(!warnings.some(w => w.operations.includes('marker.subject') && w.operations.includes('marker.sentenceAdverb')));
  assert.ok(!warnings.some(w => w.operations.includes('form.past') && w.operations.includes('form.pastParticiple')));
  assert.ok(!warnings.some(w => w.buffer === 's' && w.input === 'a'));
  settings.bindings['marker.verb'] = [sequence('s')];
  assert.equal(winner(settings, 's').operation, 'marker.subject');
  assert.ok(findConflicts(settings).some(w => w.operations.includes('marker.subject') && w.operations.includes('marker.verb')));
});

test('mid-sequence movement is warned and wins, while Undo, clear and structural commands are excluded', () => {
  const settings = defaultSettings();
  assert.equal(findConflicts(settings).length, 0);
  settings.bindings['cursor.left'] = [chord('a')];
  assert.equal(winner(settings, 'a', 'MARKER_SEQUENCE', 's').operation, 'cursor.left');
  assert.ok(findConflicts(settings).some(w => w.buffer === 's' && w.input === 'a' && w.affectedSequences.includes('sad')));
  assert.equal(winner(settings, 'u', 'MARKER_SEQUENCE', 'a').operation, 'marker.auxiliary');
  assert.ok(!findConflicts(settings).some(w => w.buffer === 'a' && w.input === 'u'));
  assert.equal(winner(settings, 'd', 'MARKER_SEQUENCE', 'sa').operation, 'marker.sentenceAdverb');
  assert.ok(!findConflicts(settings).some(w => w.buffer === 'sa' && w.input === 'd' && w.operations.includes('split.d')));
});

test('different pending suffixes share one parsing state, but identical completed suffixes warn', () => {
  const settings = defaultSettings();
  settings.bindings['marker.verb'] = [sequence('zzq')];
  settings.bindings['marker.object'] = [sequence('zzp')];
  assert.equal(winner(settings, 'z').complete, false);
  assert.ok(!findConflicts(settings).some(w => w.operations.includes('marker.verb') && w.operations.includes('marker.object')));
  settings.bindings['marker.object'] = [sequence('zzq')];
  assert.ok(findConflicts(settings).some(w => w.buffer === 'zz' && w.input === 'q' && w.operations.includes('marker.verb') && w.operations.includes('marker.object')));
});

test('marker sequence mode retries only failed continuations as NORMAL and ignores repeated characters', () => {
  const settings = defaultSettings();
  let result = resolveInput({ key: 'x' }, { mode: 'MARKER_SEQUENCE', buffer: 'a' }, settings);
  assert.equal(result.interpretedAsNormal, true);
  assert.equal(result.winner.operation, 'marker.clear');
  result = resolveInput({ key: 'u' }, { mode: 'MARKER_SEQUENCE', buffer: 'a' }, settings);
  assert.equal(result.interpretedAsNormal, false);
  assert.equal(result.winner.operation, 'marker.auxiliary');
  assert.equal(result.winner.complete, false);
  assert.deepEqual(resolveInput({ key: 'u', repeat: true }, { mode: 'MARKER_SEQUENCE', buffer: 'a' }, settings),
    { candidates: [], interpretedAsNormal: false });
  result = resolveInput({ key: 'Shift' }, { mode: 'MARKER_SEQUENCE', buffer: 'a' }, settings);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.interpretedAsNormal, false);
});

test('modified keys, Shift case and symbols, and Option physical keys use the same normalization for matching and warnings', () => {
  const settings = defaultSettings();
  settings.bindings['cursor.left'] = [chord('K', { ctrlKey: true, shiftKey: true }), chord('(', { shiftKey: true }), chord('∆', { altKey: true, code: 'KeyJ' })];
  assert.equal(winner(settings, 'K', 'NORMAL', '', { ctrlKey: true, shiftKey: true }).operation, 'cursor.left');
  assert.notEqual(winner(settings, 'k', 'NORMAL', '', { ctrlKey: true })?.operation, 'cursor.left');
  assert.equal(winner(settings, '(', 'NORMAL', '', { shiftKey: true }).operation, 'cursor.left');
  assert.equal(winner(settings, '∆', 'NORMAL', '', { altKey: true, code: 'KeyJ' }).operation, 'cursor.left');
  assert.ok(findConflicts(settings).some(w => w.operations.includes('cursor.left') && w.operations.includes('entry.reorderDown')));
  assert.equal(bindingLabel(chord('R', { shiftKey: true })), 'R');
  assert.equal(captureKey({ key: 'Shift' }), undefined);
  assert.equal(captureKey({ key: 'Process', isComposing: true }), undefined);
  assert.equal(winner(settings, '(', 'NORMAL', '', { isComposing: true }), undefined);
  assert.equal(winner(settings, '(', 'NORMAL', '', { keyCode: 229 }), undefined);
});

test('settings validate count, unassigned operations, fixed Esc, duplicates, malformed input and versions', () => {
  const settings = defaultSettings();
  assert.deepEqual(validateSettings(settings), []);
  settings.bindings['cursor.left'] = [];
  assert.deepEqual(validateSettings(settings), []);
  settings.bindings['cursor.left'] = ['q', 'w', 'e', 'y'].map(key => chord(key));
  assert.ok(validateSettings(settings).some(error => error.includes('3件')));
  settings.bindings['cursor.left'] = [chord('Escape')];
  assert.ok(validateSettings(settings).some(error => error.includes('取消専用')));
  settings.bindings['cursor.left'] = [chord('q'), chord('q')];
  assert.ok(validateSettings(settings).some(error => error.includes('重複')));
  settings.bindings['editor.cancel'] = [chord('q')];
  assert.ok(validateSettings(settings).some(error => error.includes('固定Esc')));
  settings.bindings['marker.subject'] = [sequence('')];
  assert.ok(validateSettings(settings).some(error => error.includes('文字列')));
  assert.ok(validateSettings({ version: 2, bindings: {} }).length);
  assert.ok(validateSettings({ version: 1, bindings: [] }).length);
  assert.ok(validateSettings(null).length);
  const fresh = defaultSettings();
  fresh.bindings['editor.cancel'].push(chord('q'));
  assert.deepEqual(validateSettings(fresh), []);
  fresh.bindings['editor.cancel'].push(chord('w'));
  assert.ok(validateSettings(fresh).length);
});

test('saving a conflicting draft updates guides and sequence consumers and survives reload', () => {
  const settings = defaultSettings(), data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  settings.bindings['cursor.left'] = [chord('s')];
  settings.bindings['marker.verb'] = [sequence('zz')];
  const notices = [];
  const unsubscribe = subscribeSettings(settings => notices.push(settings));
  saveSettings(storage, settings);
  assert.equal(operationKeyLabel('cursor.left'), 's');
  assert.equal(nextMarkerInput('z', { key: 'z' }).marker, 'marker.verb');
  assert.ok(sequenceBindings('marker').some(binding => binding.sequence === 'zz'));
  assert.equal(notices.length, 2);
  applySettings(defaultSettings());
  assert.equal(loadSettings(storage), undefined);
  assert.equal(operationKeyLabel('cursor.left'), 's');
  assert.deepEqual(JSON.parse(data.get(SETTINGS_STORAGE_KEY)), settings);
  unsubscribe();
});

test('failed writes retain active settings and draft; corrupt reads retain raw storage and recover defaults', () => {
  const initial = structuredClone(getSettings()), draft = defaultSettings();
  draft.bindings['cursor.left'] = [chord('q')];
  assert.throws(() => saveSettings({ setItem() { throw new Error('quota'); } }, draft), /quota/);
  assert.deepEqual(getSettings(), initial);
  assert.equal(bindingLabel(draft.bindings['cursor.left'][0]), 'q');
  let writes = 0;
  assert.match(loadSettings({ getItem() { return '{broken'; }, setItem() { writes++; } }), /読み込めません/);
  assert.equal(writes, 0);
  assert.deepEqual(getSettings(), defaultSettings());
  assert.match(loadSettings({ getItem() { throw new Error('denied'); } }), /denied/);
});

test('all input helpers use remapped actions; native text modes do not take normal-mode letters', () => {
  const settings = defaultSettings();
  settings.bindings['pseudo.commit'] = [chord('q', { metaKey: true })];
  settings.bindings['marker.customCommit'] = [chord('q', { altKey: true, code: 'KeyQ' })];
  settings.bindings['cursor.left'] = [chord('q')];
  settings.bindings['entry.next'] = [chord('w', { metaKey: true })];
  settings.bindings['form.past'] = [sequence('zz')];
  applySettings(settings);
  assert.equal(pseudoInputAction({ key: 'q', metaKey: true }, false), 'pseudo.commit');
  assert.equal(customMarkerInputAction({ key: 'q', code: 'KeyQ', altKey: true }, false), 'marker.customCommit');
  assert.equal(moveBorder(2, 3, { key: 'q' }), 1);
  assert.equal(entryShortcut({ key: 'w', metaKey: true }, 'FORM'), 'entry.next');
  assert.equal(formIdForInput('zz'), 'form.past');
  for (const mode of ['INSERT', 'TRANSLATION', 'PSEUDO_INPUT', 'MARKER_INPUT']) assert.equal(winner(settings, 'q', mode), undefined);
});


test('duplicate logical and physical Option aliases are invalid, and duplicate marker completions do not leave a phantom prefix', () => {
  const settings = defaultSettings();
  settings.bindings['cursor.left'] = [chord('j', { altKey: true }), chord('j', { altKey: true, code: 'KeyJ' })];
  assert.ok(validateSettings(settings).some(error => error.includes('重複')));
  const result = nextMarkerInput('', { key: 'z' }, [
    { sequence: 'z', value: 'marker.subject' }, { sequence: 'z', value: 'marker.verb' },
  ]);
  assert.equal(result.marker, 'marker.subject');
  assert.equal(result.buffer, '');
});

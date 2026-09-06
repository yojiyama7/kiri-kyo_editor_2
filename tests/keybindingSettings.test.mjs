import assert from 'node:assert/strict';
import { before, afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { OPERATIONS, SETTINGS_OPERATIONS, defaultSettings, applySettings, getSettings, captureKey, SETTINGS_STORAGE_KEY } from '../src/keybindings.ts';
import { lockDocumentScroll } from '../src/documentScroll.ts';

let Settings;
before(async () => {
  let source = readFileSync(new URL('../src/KeybindingSettings.svelte', import.meta.url), 'utf8');
  for (const name of ['editableBindings', 'setSlot', 'clearSlot', 'updateSequence', 'reset', 'openHelp', 'closeHelp', 'closeHelpOnBackdrop', 'assignmentSummary', 'operationMatchesFilter', 'modeDescription', 'save', 'close', 'record']) source = source.replace(`  function ${name}(`, `  export function ${name}(`);
  source = source.replace('</script>', `
    export function draftForTest() { return { draft, saveError }; }
    export function setDialogForTest(value: HTMLDialogElement) { dialog = value; }
    export function helpForTest() { return selectedHelp; }
    export function setHelpDialogForTest(value: HTMLDialogElement) { helpDialog = value; }
    export function setModeFilterForTest(value: InputMode | '') { modeFilter = value; }
    export function visibleOperationsForTest() { return SETTINGS_OPERATIONS.filter(operationMatchesFilter); }
  </script>`);
  const { js } = compile(source, { generate: 'server' });
  const code = js.code.replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('./') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : import.meta.resolve(specifier)}'`);
  Settings = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
});
afterEach(() => { applySettings(defaultSettings()); delete globalThis.localStorage; });
function setup() {
  const api = {}, events = [];
  const props = { onclose: () => events.push('cancel'), onsaved: () => events.push('save') };
  for (const name of ['editableBindings', 'setSlot', 'clearSlot', 'updateSequence', 'reset', 'openHelp', 'closeHelp', 'closeHelpOnBackdrop', 'assignmentSummary', 'operationMatchesFilter', 'modeDescription', 'save', 'close', 'record', 'draftForTest', 'setDialogForTest', 'helpForTest', 'setHelpDialogForTest', 'setModeFilterForTest', 'visibleOperationsForTest']) Object.defineProperty(props, name, { set(value) { api[name] = value; } });
  const html = render(Settings, { props }).body;
  api.setDialogForTest({ close() { events.push('close'); }, querySelector() {} });
  api.setHelpDialogForTest({ showModal() { events.push('help-open'); }, close() { events.push('help-close'); } });
  return { api, events, html };
}

test('settings renders three editable slots without fixed Esc or add/remove buttons', () => {
  const { html } = setup();
  const source = readFileSync(new URL('../src/KeybindingSettings.svelte', import.meta.url), 'utf8');
  assert.ok(source.includes('{@const binding = editableBindings(operation.id, draft)[index]}'),
    'binding fields must explicitly depend on draft so Svelte redraws them after recording');
  assert.equal(source.split('class:recording={recording === `${operation.id}:${index}`}').length - 1, 2,
    'both shortcut and sequence fields must highlight the active recording slot');
  assert.match(source, /input\.recording \{[^}]*outline: 3px solid[^}]*background:/s);
  assert.ok(html.includes('固定優先順位順の操作'));
  assert.ok(html.includes('前提モード'));
  assert.ok(html.includes('通常編集（N）'));
  assert.ok(!html.includes('モードアイコンの説明'));
  assert.ok(html.includes('role="table"'));
  assert.ok(html.includes('キーバインド1'));
  assert.ok(html.includes('キーバインド2'));
  assert.ok(html.includes('キーバインド3'));
  assert.match(source, /\.binding-header, \.binding-row \{[^}]*grid-template-columns: minmax\(185px, 1fr\) 28px repeat\(3, 118px\) max-content/s);
  assert.equal(html.match(/role="tooltip"/g)?.length, SETTINGS_OPERATIONS.length);
  assert.equal(html.match(/aria-haspopup="dialog"/g)?.length, SETTINGS_OPERATIONS.length);
  assert.ok(source.includes('<h3>何をする操作か</h3>'));
  assert.ok(source.includes('<h3>利用可能なモード</h3>'));
  assert.ok(source.includes('<h3>使い方の例</h3>'));
  assert.ok(html.includes('競合警告'));
  assert.ok(html.includes('aria-label="通常編集 (NORMAL)"'));
  assert.ok(html.includes('aria-label="定型標識の連続入力 (MARKER_SEQUENCE)"'));
  assert.ok(html.includes('Escは設定欄には表示されません'));
  assert.ok(html.includes('保存'));
  assert.ok(html.includes('編集の終了・取消 割り当て1'));
  assert.ok(html.includes('編集の終了・取消 割り当て2'));
  assert.ok(html.includes('編集の終了・取消 割り当て3'));
  assert.ok(html.includes('value="Ctrl+['));
  assert.equal(html.match(/placeholder="empty"/g)?.length, SETTINGS_OPERATIONS.length * 3);
  assert.ok(!html.includes('次の項目へ'));
  assert.ok(!html.includes('前の項目へ'));
  assert.ok(!html.includes(' 固定'));
  assert.ok(!html.includes('>追加<'));
  assert.ok(!html.includes('>削除<'));
});

test('help modal closes only when the backdrop outside its bounds is clicked', () => {
  const { api, events } = setup();
  const source = readFileSync(new URL('../src/KeybindingSettings.svelte', import.meta.url), 'utf8');
  assert.ok(source.includes('aria-label="詳細説明を閉じる" on:click={closeHelp}>×</button>'));
  const dialog = { getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }) };
  api.closeHelpOnBackdrop({ target: dialog, currentTarget: dialog, clientX: 300, clientY: 250 }, api.closeHelp);
  api.closeHelpOnBackdrop({ target: {}, currentTarget: dialog, clientX: 50, clientY: 50 }, api.closeHelp);
  assert.deepEqual(events, []);
  api.closeHelpOnBackdrop({ target: dialog, currentTarget: dialog, clientX: 50, clientY: 250 }, api.closeHelp);
  assert.deepEqual(events, ['help-close']);
});

test('mode filter shows operations containing the selected prerequisite mode', () => {
  const { api } = setup();
  assert.equal(api.visibleOperationsForTest().length, SETTINGS_OPERATIONS.length);
  api.setModeFilterForTest('NORMAL');
  assert.deepEqual(api.visibleOperationsForTest().map(operation => operation.id),
    SETTINGS_OPERATIONS.filter(operation => operation.modes.includes('NORMAL')).map(operation => operation.id));
  assert.ok(api.visibleOperationsForTest().some(operation => operation.modes.length > 1));
  assert.ok(!api.visibleOperationsForTest().some(operation => operation.id === 'form.commit'));
  api.setModeFilterForTest('FORM');
  assert.ok(api.visibleOperationsForTest().some(operation => operation.id === 'form.commit'));
  assert.ok(!api.visibleOperationsForTest().some(operation => operation.id === 'marker.clear'));
});

test('slot edits stay dense, per-operation reset restores defaults and cancellation discards them', () => {
  const { api, events } = setup();
  api.setSlot('cursor.left', 0, captureKey({ key: 'q' }));
  assert.notDeepEqual(api.draftForTest().draft, getSettings());
  api.reset('cursor.left');
  assert.deepEqual(api.draftForTest().draft, getSettings());
  api.setSlot('cursor.left', 0); api.setSlot('cursor.left', 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'], []);
  assert.equal(api.setSlot('cursor.left', 2, captureKey({ key: 'q' })), 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'], [captureKey({ key: 'q' })]);
  api.close();
  assert.deepEqual(events, ['close', 'cancel']);
  assert.deepEqual(getSettings(), defaultSettings());
});

test('operation help opens and closes independently with the current assignments', () => {
  const { api, events } = setup();
  const operation = OPERATIONS.find(operation => operation.id === 'editor.cancel');
  api.openHelp(operation);
  assert.equal(api.helpForTest().id, 'editor.cancel');
  assert.match(api.assignmentSummary(operation), /^Esc（固定） \/ Ctrl\+\[$/);
  api.closeHelp();
  assert.equal(api.helpForTest(), null);
  assert.deepEqual(events, ['help-open', 'help-close']);
});

test('recording captures modified keys, ends by blurring, and Escape clears and left-packs the selected binding', () => {
  const { api } = setup(); let prevented = 0, stopped = 0, blurred = 0;
  const event = { key: 'q', metaKey: true, preventDefault() { prevented++; }, stopPropagation() { stopped++; }, currentTarget: { blur() { blurred++; } } };
  api.record(event, 'cursor.left', 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'][0], captureKey(event));
  api.setSlot('cursor.left', 2, captureKey({ key: 'w' }));
  api.record({ ...event, key: 'Escape', metaKey: false }, 'cursor.left', 1);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'].map(binding => binding.key), ['q', 'w']);
  assert.equal(prevented, 2); assert.equal(stopped, 2); assert.equal(blurred, 2);
});

test('sequence fields append from later slots, clear on Escape, and ignore composing Escape', () => {
  const { api } = setup(); let blurred = 0, prevented = 0, stopped = 0;
  api.setSlot('marker.subject', 0);
  api.updateSequence({ currentTarget: { value: 'zz', blur() { blurred++; } } }, 'marker.subject', 2);
  assert.deepEqual(api.draftForTest().draft.bindings['marker.subject'], [{ kind: 'sequence', sequence: 'zz' }]);
  const escape = { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; }, currentTarget: { blur() { blurred++; } } };
  assert.equal(api.clearSlot(escape, 'marker.subject', 0), true);
  assert.deepEqual(api.draftForTest().draft.bindings['marker.subject'], []);
  api.setSlot('marker.subject', 0, { kind: 'sequence', sequence: 's' });
  assert.equal(api.clearSlot({ ...escape, isComposing: true }, 'marker.subject', 0), false);
  assert.equal(api.draftForTest().draft.bindings['marker.subject'][0].sequence, 's');
  assert.equal(blurred, 1); assert.equal(prevented, 1); assert.equal(stopped, 1);
});

test('cancel operations retain hidden fixed Escape and accept three editable bindings', () => {
  const { api } = setup();
  api.setSlot('editor.cancel', 1, captureKey({ key: 'q' }));
  api.setSlot('editor.cancel', 2, captureKey({ key: 'w' }));
  const bindings = api.draftForTest().draft.bindings['editor.cancel'];
  assert.equal(bindings.length, 4);
  assert.equal(bindings[0].key, 'Escape');
  assert.deepEqual(bindings.slice(1).map(binding => binding.key), ['[', 'q', 'w']);
});

test('failed save keeps the dialog draft, retry saves conflicts and closes once', () => {
  const { api, events } = setup();
  api.setSlot('cursor.left', 0, captureKey({ key: 's' }));
  globalThis.localStorage = { setItem() { throw new Error('quota'); } };
  api.save();
  assert.match(api.draftForTest().saveError, /quota/);
  assert.deepEqual(events, []);
  assert.deepEqual(getSettings(), defaultSettings());
  const writes = [];
  globalThis.localStorage = { setItem(key, value) { writes.push([key, value]); } };
  api.save();
  assert.equal(writes[0][0], SETTINGS_STORAGE_KEY);
  assert.equal(getSettings().bindings['cursor.left'][0].key, 's');
  assert.deepEqual(events, ['close', 'save']);
});

test('settings scroll lock freezes and restores the background document', () => {
  const document = {
    documentElement: { style: { overflow: 'scroll' } },
    body: { style: { overflow: '' } },
  };
  const unlock = lockDocumentScroll(document);
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.body.style.overflow, 'hidden');
  unlock();
  assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(document.body.style.overflow, '');
});

test('settings scroll unlock does not overwrite a newer scroll policy', () => {
  const document = {
    documentElement: { style: { overflow: '' } },
    body: { style: { overflow: '' } },
  };
  const unlock = lockDocumentScroll(document);
  document.body.style.overflow = 'clip';
  unlock();
  assert.equal(document.documentElement.style.overflow, '');
  assert.equal(document.body.style.overflow, 'clip');
});

test('mobile settings scroll the heading, filter, and table header with the whole dialog', () => {
  const source = readFileSync(new URL('../src/KeybindingSettings.svelte', import.meta.url), 'utf8');
  const mobile = source.slice(source.indexOf('@media (max-width: 700px)'));
  assert.ok(mobile.includes('.keybinding-settings { max-height: 90dvh; overflow-y: auto; }'));
  assert.ok(mobile.includes('.settings-content { display: block; height: auto; overflow: visible; }'));
  assert.ok(mobile.includes('.binding-list { overflow-x: auto; }'));
  assert.ok(mobile.includes('.binding-header { position: static; }'));
  assert.ok(mobile.includes('aside { overflow: visible; border-left: 0; }'));
});

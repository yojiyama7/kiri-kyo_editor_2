import assert from 'node:assert/strict';
import { before, afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { defaultSettings, applySettings, getSettings, captureKey, SETTINGS_STORAGE_KEY } from '../src/keybindings.ts';

let Settings;
before(async () => {
  let source = readFileSync(new URL('../src/KeybindingSettings.svelte', import.meta.url), 'utf8');
  for (const name of ['replace', 'remove', 'add', 'reset', 'save', 'close', 'record']) source = source.replace(`  function ${name}(`, `  export function ${name}(`);
  source = source.replace('</script>', `
    export function draftForTest() { return { draft, saveError }; }
    export function setDialogForTest(value: HTMLDialogElement) { dialog = value; }
  </script>`);
  const { js } = compile(source, { generate: 'server' });
  const code = js.code.replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('./') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : import.meta.resolve(specifier)}'`);
  Settings = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
});
afterEach(() => { applySettings(defaultSettings()); delete globalThis.localStorage; });
function setup() {
  const api = {}, events = [];
  const props = { onclose: () => events.push('cancel'), onsaved: () => events.push('save') };
  for (const name of ['replace', 'remove', 'add', 'reset', 'save', 'close', 'record', 'draftForTest', 'setDialogForTest']) Object.defineProperty(props, name, { set(value) { api[name] = value; } });
  const html = render(Settings, { props }).body;
  api.setDialogForTest({ close() { events.push('close'); } });
  return { api, events, html };
}

test('settings renders fixed Esc, ranked modes and warnings without launching a browser', () => {
  const { html } = setup();
  assert.ok(html.includes('固定優先順位順の操作'));
  assert.ok(html.includes('競合警告'));
  assert.ok(html.includes('NORMAL'));
  assert.ok(html.includes('MARKER_SEQUENCE'));
  assert.ok(html.includes('固定'));
  assert.ok(html.includes('保存'));
  assert.ok(!html.includes('編集の終了・取消 割り当て1を削除'));
});

test('edits are a draft, per-operation reset restores defaults and cancellation discards them', () => {
  const { api, events } = setup();
  api.replace('cursor.left', 0, captureKey({ key: 'q' }));
  assert.notDeepEqual(api.draftForTest().draft, getSettings());
  api.reset('cursor.left');
  assert.deepEqual(api.draftForTest().draft, getSettings());
  api.remove('cursor.left', 0); api.remove('cursor.left', 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'], []);
  api.close();
  assert.deepEqual(events, ['close', 'cancel']);
  assert.deepEqual(getSettings(), defaultSettings());
});

test('recording captures modified keys, stops propagation, and Escape ends recording without changing binding', () => {
  const { api } = setup(); let prevented = 0, stopped = 0, blurred = 0;
  const event = { key: 'q', metaKey: true, preventDefault() { prevented++; }, stopPropagation() { stopped++; }, target: { blur() { blurred++; } } };
  api.record(event, 'cursor.left', 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'][0], captureKey(event));
  api.record({ ...event, key: 'Escape', metaKey: false }, 'cursor.left', 0);
  assert.deepEqual(api.draftForTest().draft.bindings['cursor.left'][0], captureKey(event));
  assert.equal(prevented, 2); assert.equal(stopped, 2); assert.equal(blurred, 1);
});

test('failed save keeps the dialog draft, retry saves conflicts and closes once', () => {
  const { api, events } = setup();
  api.replace('cursor.left', 0, captureKey({ key: 's' }));
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

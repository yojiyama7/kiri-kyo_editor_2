import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEntryPersistence, RECOVERY_PREFIX, LEGACY_STORAGE_KEY } from '../src/entryPersistence.ts';
import { createEditorUpdates } from '../src/editorUpdates.ts';

const entry = (id, text = '') => ({ id, document: {
  version: 6, tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let createApp;
before(() => {
  const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
  const ast = ts.createSourceFile('App.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['initialize', 'currentEditor', 'updateEntry', 'receiveState', 'translationActivity',
    'finishEditing', 'closeEntryMenu', 'activate', 'moveEntry', 'saveCurrentEntry', 'flushBeforeLeaving', 'retrySave',
    'discardSavedData', 'undo'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(ast)).join('\n');
  const body = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  createApp = new Function('dependencies', `
    const { initial, editors, persistence, createEditorUpdates, storage: localStorage, client, history,
      RECOVERY_PREFIX, LEGACY_STORAGE_KEY, confirm } = dependencies;
    let entries = initial, activeEntryId = entries[0].id, rowStates = {}, ready = true, restoring = false;
    let openEntryMenuId = null;
    let saveError = null, loadFailed = false, loading = false, destroyed = false;
    const updates = createEditorUpdates({ debug() {}, save: saveCurrentEntry }, { setTimeout() {}, clearTimeout() {} });
    const tick = async () => {};
    const scrollToActive = async () => {};
    ${body}
    return { activate, moveEntry, saveCurrentEntry, flushBeforeLeaving, receiveState, initialize, discardSavedData, undo,
      state: () => ({ entries, activeEntryId, ready, saveError, loadFailed }),
      unready() { ready = false; } };
  `);
});

function setup() {
  const initial = [entry('a'), entry('b')];
  const states = Object.fromEntries(initial.map(value => [value.id, { document: structuredClone(value.document), blocked: false }]));
  const editors = Object.fromEntries(initial.map(value => [value.id, {
    finishEditing() { states[value.id].blocked = false; },
    finishFormEditing() {}, settleGroupsBeforeEntryMove() {}, selectFirst() {},
    snapshot() { return { document: structuredClone(states[value.id].document), cursor: { x: 0, y: 0 } }; },
    restore(snapshot) { states[value.id].document = structuredClone(snapshot.document); },
    canSave() { return !states[value.id].blocked; },
    getInputMode() { return 'TRANSLATION'; },
  }]));
  const requests = [];
  const persistence = createEntryPersistence(batch => new Promise((resolve, reject) => {
    requests.push({ batch, resolve, reject });
  }), () => {}, 'app-test');
  const stored = new Map();
  const storage = {
    get length() { return stored.size; }, key(index) { return [...stored.keys()][index]; },
    getItem(key) { return stored.get(key) ?? null; }, setItem(key, value) { stored.set(key, value); },
    removeItem(key) { stored.delete(key); },
  };
  const client = { async send() { return { version: 7, entries: initial }; } };
  const history = { undo() {}, redo() {} };
  const app = createApp({ initial, editors, persistence, createEditorUpdates, storage, client, history,
    RECOVERY_PREFIX, LEGACY_STORAGE_KEY, confirm: () => true });
  return { app, requests, states, stored, client, history, editors, initial };
}

test('actual click and keyboard activation save the source after finishing editing, without waiting', async () => {
  for (const keyboard of [false, true]) {
    const { app, requests, states, editors } = setup();
    states.a.document.translation = 'draft';
    editors.a.finishEditing = () => { states.a.document.translation = 'committed'; };
    if (keyboard) app.moveEntry(1); else app.activate('b');
    assert.equal(app.state().activeEntryId, 'b');
    await drain();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].batch.changes[0].id, 'a');
    assert.equal(requests[0].batch.changes[0].entry.document.translation, 'committed');
    // The outstanding Promise has deliberately not resolved.
    app.activate('a');
    assert.equal(app.state().activeEntryId, 'a');
  }
});

test('idle save guards only the active editor, including live state before a reactive flush', async () => {
  const { app, states, requests } = setup();
  states.a.document.translation = 'changed';
  app.receiveState('a', { snapshot: { document: states.a.document, cursor: { x: 0, y: 0 } }, pendingMarker: false });
  states.a.blocked = true;
  app.saveCurrentEntry();
  await drain();
  assert.equal(requests.length, 0);
  states.a.blocked = false;
  states.b.blocked = true;
  app.receiveState('b', { snapshot: { document: states.b.document, cursor: { x: 0, y: 0 } }, pendingMarker: true });
  app.saveCurrentEntry();
  await drain();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].batch.changes[0].id, 'a');
});

test('departure captures the latest translation before the reactive flush and does no normal sync writes', async () => {
  const { app, states, requests, stored } = setup();
  states.a.document.translation = 'last keystroke';
  app.saveCurrentEntry();
  assert.equal(stored.size, 0);
  app.flushBeforeLeaving();
  const journal = JSON.parse(stored.get(RECOVERY_PREFIX + 'app-test'));
  assert.equal(journal.batches[0].changes[0].entry.document.translation, 'last keystroke');
  await drain();
  requests[0].resolve();
  await drain();
  app.flushBeforeLeaving();
  assert.equal(stored.size, 0);
});

test('initialization removes only recovered, unchanged journals and never replaces data on load failure', async () => {
  const { app, client, stored, initial } = setup();
  app.unready();
  const key = RECOVERY_PREFIX + 'old-session';
  stored.set(key, 'old journal');
  client.send = async request => {
    assert.deepEqual(request.recovery, ['old journal']);
    stored.set(key, 'new journal');
    return { version: 7, entries: [entry('restored')] };
  };
  await app.initialize();
  assert.equal(app.state().ready, true);
  assert.equal(app.state().entries[0].id, 'restored');
  assert.equal(stored.get(key), 'new journal');
  app.unready();
  client.send = async () => { throw new Error('load failed'); };
  await app.initialize();
  assert.equal(app.state().ready, false);
  assert.equal(app.state().entries[0].id, 'restored');
  assert.match(app.state().saveError, /load failed/);
  client.send = async () => ({ version: 7, entries: initial });
  await app.initialize();
  assert.equal(stored.has(key), false);
});

test('a failed load can discard IndexedDB, legacy data and every recovery journal before reinitializing', async () => {
  const { app, client, stored, initial } = setup();
  app.unready();
  stored.set(LEGACY_STORAGE_KEY, 'invalid legacy');
  stored.set(RECOVERY_PREFIX + 'one', 'invalid recovery');
  stored.set(RECOVERY_PREFIX + 'two', 'other recovery');
  let failed = true;
  const requests = [];
  client.send = async request => {
    requests.push(request.kind);
    if (request.kind === 'discard') return undefined;
    if (failed) { failed = false; throw new Error('以前の保存データを読み込めません。元のデータは保持しています'); }
    assert.equal(request.legacyRaw, null);
    assert.deepEqual(request.recovery, []);
    return { version: 7, entries: initial };
  };
  await app.initialize();
  assert.equal(app.state().loadFailed, true);
  await app.discardSavedData();
  assert.deepEqual(requests, ['load', 'discard', 'load']);
  assert.equal(stored.size, 0);
  assert.equal(app.state().ready, true);
  assert.equal(app.state().loadFailed, false);
});

test('actual Undo restores editor states and persists only changed entries; Redo restores them again', async () => {
  const { app, states, requests, history, initial } = setup();
  states.a.document.translation = 'edited';
  app.receiveState('a', { snapshot: { document: states.a.document, cursor: { x: 0, y: 0 } }, pendingMarker: false });
  history.undo = () => ({ document: { version: 7, entries: structuredClone(initial) }, activeEntryId: 'a', cursor: { x: 0, y: 0 } });
  history.redo = () => ({ document: { version: 7, entries: [entry('a', 'edited'), entry('b')] }, activeEntryId: 'a', cursor: { x: 0, y: 0 } });
  await app.undo(false);
  await drain();
  requests[0].resolve();
  await drain();
  assert.equal(requests[1].batch.changes.length, 1);
  assert.equal(requests[1].batch.changes[0].entry.document.translation, '');
  requests[1].resolve();
  await drain();
  await app.undo(true);
  await drain();
  assert.equal(requests[2].batch.changes.length, 1);
  assert.equal(requests[2].batch.changes[0].entry.document.translation, 'edited');
});

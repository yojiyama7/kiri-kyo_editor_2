import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEntryPersistence, RECOVERY_PREFIX, LEGACY_STORAGE_KEY } from '../src/entryPersistence.ts';
import { createEditorUpdates } from '../src/editorUpdates.ts';
import { withEntrySnapshot } from '../src/entryDocument.ts';
import { entryDocumentsEqual, readImportedDocument } from '../src/documentImport.ts';

const entry = (id, text = '') => ({ id, document: {
  tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let createApp;
before(() => {
  const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
  const ast = ts.createSourceFile('App.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['initialize', 'currentEditor', 'updateEntry', 'receiveState', 'translationActivity',
    'snapshot', 'finishEditing', 'closeEntryMenu', 'activate', 'moveEntry', 'saveCurrentEntry', 'flushBeforeLeaving', 'retrySave',
    'exportSavedDocument', 'chooseImportFile', 'selectImportFile', 'closeImportDialog', 'confirmImport', 'discardSavedData', 'undo'];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(ast)).join('\n');
  const body = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  createApp = new Function('dependencies', `
    const { initial, editors, persistence, createEditorUpdates, storage: localStorage, client, history,
      RECOVERY_PREFIX, LEGACY_STORAGE_KEY, confirm, downloadEntryDocument, withEntrySnapshot } = dependencies;
    const { entryDocumentsEqual, readImportedDocument } = dependencies;
    let entries = initial, activeEntryId = entries[0].id, rowStates = {}, ready = true, restoring = false;
    let openEntryMenuId = null;
    let saveError = null, loadFailed = false, loading = false, destroyed = false, legacyDiscarded = false;
    let exporting = false, exportStatus = '', exportError = null;
    let importing = false, importStatus = '', importError = null, pendingImport = null;
    let importFileInput, importDialog;
    const updates = createEditorUpdates({ debug() {}, save: saveCurrentEntry }, { setTimeout() {}, clearTimeout() {} });
    const tick = async () => {};
    const scrollToActive = async () => {};
    ${body}
    return { activate, moveEntry, saveCurrentEntry, flushBeforeLeaving, receiveState, initialize, discardSavedData, undo, exportSavedDocument,
      chooseImportFile, closeImportDialog, confirmImport,
      selectImportFile,
      state: () => ({ entries, activeEntryId, ready, saveError, loadFailed, exporting, exportStatus, exportError,
        importing, importStatus, importError, pendingImport }),
      setPendingImport(value, dialog) { pendingImport = value; importDialog = dialog; },
      setImportFileInput(value) { importFileInput = value; },
      unready() { ready = false; } };
  `);
});

function setup(downloadEntryDocument = () => {}) {
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
  const client = {
    async load() { return { document: { version: 8, entries: initial }, discardedLegacy: false }; },
    async send() { return undefined; },
  };
  const history = { records: [], record(before, after) { this.records.push({ before, after }); }, undo() {}, redo() {} };
  const app = createApp({ initial, editors, persistence, createEditorUpdates, storage, client, history,
    RECOVERY_PREFIX, LEGACY_STORAGE_KEY, confirm: () => true, downloadEntryDocument, withEntrySnapshot,
    entryDocumentsEqual, readImportedDocument });
  return { app, requests, states, stored, client, history, editors, initial };
}

test('export flushes saveable UI state, waits for storage, then downloads the Worker read result', async () => {
  const downloads = [];
  const { app, requests, states, client } = setup(document => downloads.push(document));
  states.a.document.translation = '保存対象';
  app.receiveState('a', { snapshot: { document: states.a.document, cursor: { x: 0, y: 0 } }, pendingMarker: false });
  const saved = { version: 8, entries: [entry('a', '保存対象'), entry('b')] };
  const reads = [];
  client.send = async request => { reads.push(request.kind); return saved; };
  const exporting = app.exportSavedDocument();
  await drain();
  assert.equal(app.state().exporting, true);
  assert.equal(downloads.length, 0);
  assert.equal(reads.length, 0);
  requests[0].resolve();
  await exporting;
  assert.deepEqual(reads, ['read']);
  assert.deepEqual(downloads, [saved]);
  assert.equal(app.state().exportStatus, '保存済み文書をJSONでexportしました');
});

test('export neither finishes blocked input nor downloads after save failure', async () => {
  const downloads = [];
  const { app, requests, states } = setup(document => downloads.push(document));
  states.a.document.translation = 'pending';
  app.receiveState('a', { snapshot: { document: states.a.document, cursor: { x: 0, y: 0 } }, pendingMarker: true });
  states.a.blocked = true;
  await app.exportSavedDocument();
  assert.equal(requests.length, 0);
  assert.equal(downloads.length, 0);
  assert.match(app.state().exportError, /入力中/);

  states.a.blocked = false;
  const exporting = app.exportSavedDocument();
  await drain();
  requests[0].reject(new Error('quota'));
  await exporting;
  assert.equal(downloads.length, 0);
  assert.match(app.state().exportError, /quota/);
});

test('export control is disabled outside ready state and excluded from input-finalizing pointer and focus handlers', () => {
  const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(source, /class="document-export"[^>]*disabled=\{!ready \|\| exporting \|\| importing\}/);
  assert.match(source, /closest\('\.debug-panel, \.document-export, \.document-import, \.import-dialog'\)/);
  assert.match(source, /closest\('\.diagram, \.debug-panel, \.document-export, \.document-import, \.import-dialog'\)/);
  assert.match(source, /on:pointerdown\|preventDefault/);
});

test('import refuses to open a file picker while an editor input is active', () => {
  const { app, editors } = setup();
  let clicks = 0;
  app.setImportFileInput({ click() { clicks++; } });
  editors.a.getInputMode = () => 'FORM';
  app.chooseImportFile();
  assert.equal(clicks, 0);
  assert.match(app.state().importError, /入力中/);
  editors.a.getInputMode = () => null;
  editors.b.getInputMode = () => null;
  app.chooseImportFile();
  assert.equal(clicks, 1);
});

test('selected import files are parsed, reset for reselection, and shown for confirmation', async () => {
  const { app } = setup();
  let shown = 0;
  app.setPendingImport(null, { showModal() { shown++; }, close() {} });
  const imported = { version: 8, entries: [entry('c', '日本語')] };
  const input = { files: [{ name: 'save.json', text: async () => JSON.stringify(imported) }], value: 'fake-path' };
  await app.selectImportFile({ currentTarget: input });
  assert.equal(input.value, '');
  assert.equal(shown, 1);
  assert.equal(app.state().pendingImport.filename, 'save.json');
  assert.deepEqual(app.state().pendingImport.document, imported);
});

test('confirmed import waits for current saves, replaces storage, and records one whole-document history step', async () => {
  const { app, requests, states, client, history, editors } = setup();
  editors.a.getInputMode = () => null;
  editors.b.getInputMode = () => null;
  states.a.document.translation = 'before import';
  app.receiveState('a', { snapshot: { document: states.a.document, cursor: { x: 3, y: 0 } }, pendingMarker: false });
  const current = { version: 8, entries: [entry('a', 'before import'), entry('b')] };
  const replacement = { version: 8, entries: [entry('c', 'imported'), entry('d', '日本語')] };
  const kinds = [];
  client.send = async request => {
    kinds.push(request.kind);
    if (request.kind === 'read') return current;
    if (request.kind === 'replace') { assert.deepEqual(request.document, replacement); return replacement; }
  };
  let closes = 0;
  app.setPendingImport({ filename: 'save.json', document: replacement }, { close() { closes++; } });
  const importing = app.confirmImport();
  await drain();
  assert.equal(app.state().importing, true);
  assert.deepEqual(kinds, []);
  requests[0].resolve();
  await importing;
  assert.deepEqual(kinds, ['read', 'replace']);
  assert.equal(closes, 1);
  assert.deepEqual(app.state().entries, replacement.entries);
  assert.equal(app.state().activeEntryId, 'c');
  assert.equal(history.records.length, 1);
  assert.deepEqual(history.records[0].before.document, current);
  assert.deepEqual(history.records[0].after.document, replacement);
  assert.match(app.state().importStatus, /2組/);

  history.undo = () => structuredClone(history.records[0].before);
  await app.undo(false);
  await drain();
  assert.deepEqual(app.state().entries, current.entries);
  assert.deepEqual(requests[1].batch.order.ids, ['a', 'b']);
  requests[1].resolve();
  await drain();
  history.redo = () => structuredClone(history.records[0].after);
  await app.undo(true);
  await drain();
  assert.deepEqual(app.state().entries, replacement.entries);
  assert.deepEqual(requests[2].batch.order.ids, ['c', 'd']);
  requests[2].resolve();
});

test('identical and failed imports do not change the screen or history', async () => {
  const { app, client, history, initial, editors } = setup();
  editors.a.getInputMode = () => null;
  editors.b.getInputMode = () => null;
  const current = { version: 8, entries: initial };
  let replacements = 0;
  client.send = async request => {
    if (request.kind === 'read') return current;
    replacements++;
    throw new Error('quota');
  };
  let closes = 0;
  app.setPendingImport({ filename: 'same.json', document: structuredClone(current) }, { close() { closes++; } });
  await app.confirmImport();
  assert.equal(replacements, 0);
  assert.equal(closes, 1);
  assert.equal(history.records.length, 0);
  assert.match(app.state().importStatus, /変更はありません/);

  const replacement = { version: 8, entries: [entry('c')] };
  app.setPendingImport({ filename: 'other.json', document: replacement }, { close() { closes++; } });
  await app.confirmImport();
  assert.equal(replacements, 1);
  assert.deepEqual(app.state().entries, initial);
  assert.equal(history.records.length, 0);
  assert.match(app.state().importError, /quota/);
  assert.equal(app.state().pendingImport.filename, 'other.json');
});

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
  client.load = async request => {
    assert.deepEqual(request.recovery, ['old journal']);
    stored.set(key, 'new journal');
    return { document: { version: 8, entries: [entry('restored')] }, discardedLegacy: false };
  };
  await app.initialize();
  assert.equal(app.state().ready, true);
  assert.equal(app.state().entries[0].id, 'restored');
  assert.equal(stored.get(key), 'new journal');
  app.unready();
  client.load = async () => { throw new Error('load failed'); };
  await app.initialize();
  assert.equal(app.state().ready, false);
  assert.equal(app.state().entries[0].id, 'restored');
  assert.match(app.state().saveError, /load failed/);
  client.load = async () => ({ document: { version: 8, entries: initial }, discardedLegacy: false });
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
  client.load = async request => {
    requests.push(request.kind);
    if (failed) { failed = false; throw new Error('以前の保存データを読み込めません。元のデータは保持しています'); }
    assert.equal(request.legacyRaw, null);
    assert.deepEqual(request.recovery, []);
    return { document: { version: 8, entries: initial }, discardedLegacy: false };
  };
  client.send = async request => { requests.push(request.kind); };
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
  history.undo = () => ({ document: { version: 8, entries: structuredClone(initial) }, activeEntryId: 'a', cursor: { x: 0, y: 0 } });
  history.redo = () => ({ document: { version: 8, entries: [entry('a', 'edited'), entry('b')] }, activeEntryId: 'a', cursor: { x: 0, y: 0 } });
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

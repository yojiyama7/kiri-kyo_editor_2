<script lang="ts">
  import KeybindingSettings from './KeybindingSettings.svelte';
  import { loadSettings, getSettings, subscribeSettings, resolveInput, sequenceBindings, operationMatches, type BindingSettings } from './keybindings';
  import { matchesKeyboardInput } from './keyboard';
  import { onMount, onDestroy, tick } from 'svelte';
  import EntryEditor from './EntryEditor.svelte';
  import { createExampleDocument } from './example';
  import { EditHistory, type EditorSnapshot } from './history';
  import { markerLabel, type MarkerId } from './markers';
  import { operationKeyLabel } from './inputConfig';
  import { createEditorUpdates } from './editorUpdates';
  import { createEntryPersistence, LEGACY_STORAGE_KEY, RECOVERY_PREFIX, type PersistenceStatus } from './entryPersistence';
  import { createPersistenceClient } from './persistenceClient';
  import {
    createEntry, insertEntry, insertEnglishEntries, parseEnglishLines, removeEntry, reorderEntry, withEntrySnapshot,
    type Entry, type EntryDocument, type DocumentSnapshot, type EntryEditorState, type EntryEditorHandle,
  } from './entryDocument';

  let settingsOpen = false;
  let settingsError: string | undefined;
  let bindingSettings: BindingSettings = getSettings();
  const unsubscribeBindings = subscribeSettings(value => { bindingSettings = value; });
  onDestroy(unsubscribeBindings);
  $: markerBindings = sequenceBindings<MarkerId>('marker', bindingSettings);
  $: keyLabel = (operation: import('./keyboardOperations').KeyboardOperationId, separator = ' / ') => { bindingSettings; return operationKeyLabel(operation, separator); };
  const modeLabel = (mode: string) => mode === 'MARKER_SEQUENCE' ? '定型標識入力' : mode;
  function openSettings() { finishEditing(); closeEntryMenu(false); settingsOpen = true; }

  const storageKey = 'IndexedDB: kiri-kyo-editor';
  let entries: Entry[] = [createEntry(createExampleDocument())];
  let activeEntryId = entries[0].id;
  let openEntryMenuId: string | null = null;
  let editors: Record<string, EntryEditorHandle | undefined> = {};
  let rowStates: Record<string, EntryEditorState> = {};
  const history = new EditHistory<DocumentSnapshot>();
  let ready = false;
  let restoring = false;
  let loadFailed = false;
  let saveError: string | null = null;
  let copyStatus = '';
  let bulkDialog: HTMLDialogElement;
  let bulkTextarea: HTMLTextAreaElement;
  let bulkAfterId: string | null = null;
  let bulkDraft = '';
  let displayJSON = '';
  let savedJSON = '';
  let saveStatus: PersistenceStatus = { pending: false, saving: false, error: null };
  let loading = false;
  let destroyed = false;
  let debugOpen = false;
  let debugLoading = false;
  let debugRequest = 0;
  const client = createPersistenceClient(() => new Worker(new URL('./persistence.worker.ts', import.meta.url), { type: 'module' }));
  const persistence = createEntryPersistence(async batch => { await client.send({ kind: 'write', batch }); }, status => {
    saveStatus = status;
    saveError = status.error;
  });
  const updates = createEditorUpdates({ debug: () => {}, save: saveCurrentEntry });
  const appositionMarkerLabels = (['marker.noun', 'marker.subject', 'marker.object', 'marker.nounComplement', 'marker.plus'] satisfies MarkerId[])
    .map(markerLabel).join(' / ');

  $: bulkCount = parseEnglishLines(bulkDraft).length;
  $: documentState = { version: 7, entries } satisfies EntryDocument;
  $: activeState = rowStates[activeEntryId];
  // Changes schedule the idle save, but do not assemble any document-wide JSON.
  $: { ready; restoring; activeEntryId; documentState; rowStates; updates.schedule(); }

  onDestroy(() => {
    destroyed = true;
    updates.dispose();
    persistence.dispose();
    client.dispose();
  });

  onMount(() => {
    try { settingsError = loadSettings(localStorage); }
    catch (error) { settingsError = `キーバインド設定を読み込めませんでした。初期値を使用します: ${String(error)}`; }
    void initialize();
  });

  async function initialize() {
    if (loading || destroyed) return;
    loading = true;
    loadFailed = false;
    saveError = null;
    try {
      let legacyRaw: string | null = null;
      let legacyError: string | undefined;
      try { legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY); }
      catch (error) { legacyError = String(error); }
      const recovery: { key: string; raw: string }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(RECOVERY_PREFIX)) {
          const raw = localStorage.getItem(key);
          if (raw !== null) recovery.push({ key, raw });
        }
      }
      const document = await client.send({ kind: 'load', legacyRaw, legacyError,
        initial: { version: 7, entries }, recovery: recovery.map(item => item.raw) });
      if (destroyed) return;
      if (!document) throw new Error('保存データが読み込めません');
      // Do not clear a journal that another tab has updated during recovery.
      for (const { key, raw } of recovery) if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      entries = document.entries;
      activeEntryId = entries[0].id;
      ready = true;
    } catch (error) {
      if (!destroyed) {
        loadFailed = true;
        saveError = String(error);
      }
    }
    finally { loading = false; }
  }

  async function discardSavedData() {
    if (loading || ready || !loadFailed
      || !confirm('読み込めない保存データをすべて破棄します。この操作は取り消せません。よろしいですか？')) return;
    loading = true;
    saveError = null;
    try {
      await client.send({ kind: 'discard' });
      const keys = [LEGACY_STORAGE_KEY];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(RECOVERY_PREFIX)) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    } catch (error) {
      if (!destroyed) saveError = `保存データを破棄できませんでした: ${String(error)}`;
      return;
    } finally { loading = false; }
    await initialize();
  }

  function currentEditor() { return editors[activeEntryId]; }

  function snapshot(): DocumentSnapshot {
    const state = currentEditor()?.snapshot();
    return structuredClone(state ? withEntrySnapshot({ version: 7, entries }, activeEntryId, state) : {
      document: { version: 7, entries }, activeEntryId, cursor: { x: 0, y: 0 },
    });
  }

  function recordEntry(id: string, before: EditorSnapshot, after: EditorSnapshot) {
    if (restoring) return;
    const document: EntryDocument = { version: 7, entries };
    history.record(withEntrySnapshot(document, id, before), withEntrySnapshot(document, id, after));
    updateEntry(id, after);
  }

  function updateEntry(id: string, state: EditorSnapshot) {
    const entry = entries.find((entry) => entry.id === id);
    if (entry && JSON.stringify(entry.document) !== JSON.stringify(state.document)) {
      const updated = { ...entry, document: state.document };
      entries = entries.map((entry) => entry.id === id ? updated : entry);
      if (ready && !restoring) persistence.mark(updated);
    }
  }

  function receiveState(id: string, state: EntryEditorState) {
    if (!entries.some((entry) => entry.id === id)) return;
    rowStates = { ...rowStates, [id]: state };
    if (!restoring) updateEntry(id, state.snapshot);
  }

  function translationActivity(_composing: boolean) {
    if (restoring) return;
    updates.schedule();
  }

  function finishEditing() {
    currentEditor()?.finishEditing();
    const state = currentEditor()?.snapshot();
    if (state) updateEntry(activeEntryId, state);
  }

  function activate(id: string) {
    if (!ready || restoring || id === activeEntryId) return;
    finishEditing();
    saveCurrentEntry();
    closeEntryMenu(false);
    activeEntryId = id;
  }

  async function scrollToActive(focus = false) {
    await tick();
    const element = document.getElementById(`entry-${activeEntryId}`);
    if (focus) element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }

  function moveEntry(direction: -1 | 1) {
    // Input commits even at the first/last entry, before checking the destination.
    currentEditor()?.finishFormEditing();
    currentEditor()?.finishMarkerInput?.();
    const index = entries.findIndex((entry) => entry.id === activeEntryId);
    const target = entries[index + direction];
    if (!target) return;
    activate(target.id);
    currentEditor()?.selectFirst();
    void scrollToActive(true);
  }

  async function addEntry(id: string) {
    if (restoring) return;
    activate(id);
    finishEditing();
    saveCurrentEntry();
    const before = snapshot();
    const after = insertEntry(before, id);
    history.record(before, after);
    persistence.saveStructure(before.document.entries, after.document.entries);
    entries = after.document.entries;
    activeEntryId = after.activeEntryId;
    await tick();
    currentEditor()?.startInput();
    void scrollToActive();
  }

  async function openBulkEntry(id: string) {
    if (restoring || bulkAfterId !== null) return;
    activate(id);
    finishEditing();
    bulkAfterId = id;
    bulkDraft = '';
    await tick();
    bulkDialog.showModal();
    bulkTextarea.focus();
  }

  function closeBulkEntry() {
    bulkDialog.close();
    bulkAfterId = null;
    bulkDraft = '';
  }

  function handleBulkKeydown(event: KeyboardEvent) {
    if (matchesKeyboardInput(event, [
      { isComposing: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
      { keyCode: 229, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ])) {
      if (operationMatches({ ...event, key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey, isComposing: false, keyCode: 0 }, 'dialog.cancel')) event.preventDefault();
      return;
    }
    const operation = resolveInput(event, { mode: 'DIALOG' }).winner?.operation;
    if (operation === 'dialog.cancel') {
      event.preventDefault();
      event.stopPropagation();
      closeBulkEntry();
      return;
    }
    if (operation !== 'focus.next' && operation !== 'focus.previous') return;
    const controls = bulkDialog.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)');
    const index = Array.from(controls).indexOf(document.activeElement as HTMLElement);
    const direction = operation === 'focus.previous' ? -1 : 1;
    event.preventDefault();
    controls[(index + direction + controls.length) % controls.length]?.focus();
  }

  async function addBulkEntries() {
    if (restoring || bulkAfterId === null || !bulkCount) return;
    saveCurrentEntry();
    const before = snapshot();
    const after = insertEnglishEntries(before, bulkAfterId, bulkDraft);
    if (after === before) return;
    history.record(before, after);
    // Close before changing the active entry: native dialog focus restoration
    // must not reactivate the old entry after insertion.
    closeBulkEntry();
    persistence.saveStructure(before.document.entries, after.document.entries);
    entries = after.document.entries;
    activeEntryId = after.activeEntryId;
    await tick();
    currentEditor()?.selectFirst();
    void scrollToActive(true);
  }

  async function deleteEntry(id: string) {
    if (restoring) return;
    activate(id);
    finishEditing();
    saveCurrentEntry();
    const before = snapshot();
    const after = removeEntry(before, id);
    history.record(before, after);
    persistence.saveStructure(before.document.entries, after.document.entries);
    entries = after.document.entries;
    activeEntryId = after.activeEntryId;
    delete rowStates[id];
    await tick();
    currentEditor()?.selectFirst();
    void scrollToActive(true);
  }

  function swapEntry(id: string, direction: -1 | 1) {
    if (restoring) return;
    const index = entries.findIndex((entry) => entry.id === id);
    if (!entries[index + direction]) return;
    activate(id);
    finishEditing();
    saveCurrentEntry();
    const before = snapshot();
    const after = reorderEntry(before, id, direction);
    history.record(before, after);
    persistence.saveStructure(before.document.entries, after.document.entries);
    entries = after.document.entries;
    void scrollToActive(true);
  }

  async function undo(redo: boolean) {
    if (restoring) return;
    finishEditing();
    saveCurrentEntry();
    const beforeEntries = entries;
    const state = redo ? history.redo() : history.undo();
    if (!state) return;
    restoring = true;
    entries = state.document.entries;
    activeEntryId = state.activeEntryId;
    await tick();
    for (const entry of entries) {
      editors[entry.id]?.restore({
        document: entry.document,
        cursor: entry.id === activeEntryId ? state.cursor : { x: 0, y: 0 },
      }, entry.id === activeEntryId);
    }
    await tick();
    // Publish restored states after all child components have finished restoring.
    for (const entry of entries) {
      const editor = editors[entry.id];
      if (editor) updateEntry(entry.id, editor.snapshot());
    }
    restoring = false;
    persistence.saveStructure(beforeEntries, entries);
    void scrollToActive(true);
  }

  function closeEntryMenu(restoreFocus = true) {
    const id = openEntryMenuId;
    openEntryMenuId = null;
    if (restoreFocus && id) document.getElementById(`entry-menu-trigger-${id}`)?.focus({ preventScroll: true });
  }

  async function toggleEntryMenu(id: string) {
    if (openEntryMenuId === id) { closeEntryMenu(); return; }
    activate(id);
    openEntryMenuId = id;
    await tick();
    document.getElementById(`entry-${id}`)?.querySelector<HTMLButtonElement>('.entry-menu-panel button')?.focus({ preventScroll: true });
  }

  function runEntryAction(action: () => unknown) {
    closeEntryMenu();
    action();
  }

  function handleEntryMenuKeydown(event: KeyboardEvent) {
    const operation = resolveInput(event, { mode: 'MENU' }).winner?.operation;
    if (operation === 'dialog.cancel' && openEntryMenuId) {
      event.preventDefault();
      closeEntryMenu();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const panel = target.closest('.entry-menu-panel');
    if (!panel || !operation) return;
    event.preventDefault();
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current = buttons.indexOf(target as HTMLButtonElement);
    const next = operation === 'cursor.rowStart' ? 0 : operation === 'cursor.rowEnd' ? buttons.length - 1
      : (current + (operation === 'cursor.down' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (settingsOpen) return;
    if (event.target instanceof Element && event.target.closest('.entry-menu')) {
      if (openEntryMenuId) { handleEntryMenuKeydown(event); return; }
      if (matchesKeyboardInput(event, [{ key: ['Enter', ' ', 'Tab'], ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null }])) return;
    }
    if (!(event.target instanceof Element) || !event.target.closest('.debug-panel')) updates.schedule();
    if (!ready || restoring || bulkAfterId !== null || matchesKeyboardInput(event, [
      { isComposing: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
      { keyCode: 229, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ])) return;
    if (event.target instanceof Element && event.target.closest('.debug-panel')) return;
    if (event.target instanceof HTMLButtonElement && !event.target.closest('.diagram')
      && matchesKeyboardInput(event, [
        { key: ['Enter', ' '], ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
      ])) return;
    const editor = currentEditor();
    if (!editor) return;
    const resolved = editor.resolveKeydown(event);
    const candidate = resolved.winner?.operation;
    const shortcut = candidate === 'entry.next' || candidate === 'entry.previous' || candidate === 'entry.reorderDown' || candidate === 'entry.reorderUp' ? candidate : undefined;
    if (shortcut) {
      event.preventDefault();
      if (resolved.interpretedAsNormal || editor.getInputMode() === 'MARKER_SEQUENCE') editor.finishMarkerInput();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ]) && (shortcut === 'entry.reorderDown' || shortcut === 'entry.reorderUp')) return;
      if (shortcut === 'entry.next') moveEntry(1);
      else if (shortcut === 'entry.previous') moveEntry(-1);
      else swapEntry(activeEntryId, shortcut === 'entry.reorderDown' ? 1 : -1);
      return;
    }
    editor.handleKeydown(event, resolved);
  }

  function finishMarkerInput() { currentEditor()?.finishMarkerInput(); }

  function saveCurrentEntry(leaving = false) {
    if (!ready || restoring || !currentEditor()?.canSave(leaving)) return;
    persistence.saveEntry(activeEntryId);
  }

  function flushBeforeLeaving() {
    if (!ready || restoring) return;
    if (currentEditor()?.getInputMode() === 'TRANSLATION') {
      const state = currentEditor()?.snapshot();
      if (state) updateEntry(activeEntryId, state);
    }
    updates.flushSave();
    try {
      const journal = persistence.journal(id => editors[id]?.canSave(true) ?? true);
      const key = RECOVERY_PREFIX + persistence.session;
      if (journal.batches.length) localStorage.setItem(key, JSON.stringify(journal));
      else localStorage.removeItem(key);
    } catch (error) { saveError = `終了時の退避に失敗しました: ${String(error)}`; }
  }

  function retrySave() {
    if (!ready) { void initialize(); return; }
    saveCurrentEntry();
    persistence.retry();
  }

  async function refreshDebugJSON() {
    const request = ++debugRequest;
    debugLoading = true;
    // Full diagnostics are assembled only by an explicit user request.
    displayJSON = debugJSON({
      ready, activeEntryId, mode: rowStates[activeEntryId]?.mode ?? 'NORMAL', document: { version: 7, entries },
      entries: Object.fromEntries(entries.map(({ id }) => [id, rowStates[id]?.getDisplay() ?? null])),
    });
    try {
      const state = await client.send({ kind: 'read' });
      if (request === debugRequest) savedJSON = debugJSON({ storageKey, error: saveError, state: state ?? null });
    } catch (error) {
      if (request === debugRequest) savedJSON = debugJSON({ storageKey, error: String(error), state: null });
    } finally { if (request === debugRequest) debugLoading = false; }
  }

  function debugJSON(value: unknown): string {
    return JSON.stringify(value, (_key, item) =>
      item instanceof Map ? Object.fromEntries(item) : item instanceof Set ? [...item] : item, 2) ?? 'null';
  }

  async function copyDebugJSON() {
    try {
      await refreshDebugJSON();
      await navigator.clipboard.writeText(JSON.stringify({ display: JSON.parse(displayJSON), saved: JSON.parse(savedJSON) }, null, 2));
      copyStatus = '表示状態と保存状態をコピーしました';
    } catch { copyStatus = 'コピーできませんでした。下のJSONを選択してコピーしてください。'; }
  }
</script>

<svelte:window on:keydown={handleKeydown} on:blur={finishMarkerInput}
  on:beforeunload={flushBeforeLeaving} on:pagehide={flushBeforeLeaving}
  on:pointerdown={(event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.entry-menu')) closeEntryMenu();
    if (!(event.target instanceof Element) || !event.target.closest('.debug-panel')) {
      updates.schedule();
      finishMarkerInput();
    }
  }}
  on:compositionstart={finishMarkerInput}
  on:focusin={(event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.entry-menu')) closeEntryMenu(false);
    if (!(event.target instanceof Element) || !event.target.closest('.diagram, .debug-panel')) finishMarkerInput();
  }}
 />

<svelte:head><title>Kiri-kyo Editor — 英文構造図</title></svelte:head>

{#if settingsOpen}
  <KeybindingSettings onclose={() => { settingsOpen = false; }} onsaved={() => { settingsError = undefined; settingsOpen = false; }} />
{/if}

<main class="shell">
  <header class="topbar">
    <h1>英文構造図エディタ</h1>
    <button type="button" on:click={openSettings}>キーバインド設定</button>
    <div class="mode">{entries.findIndex((entry) => entry.id === activeEntryId) + 1} / {entries.length} · {modeLabel(activeState?.mode ?? 'NORMAL')}</div>
  </header>

  {#if settingsError}<p role="alert">{settingsError}</p>{/if}
  <section class="guide" aria-label="キーボード操作ガイド">
    <span><kbd>{keyLabel('entry.next')}</kbd> 次の組</span><span><kbd>{keyLabel('entry.previous')}</kbd> 前の組</span>
    <span><kbd>{keyLabel('entry.reorderDown')}</kbd> 下へ入れ替え</span><span><kbd>{keyLabel('entry.reorderUp')}</kbd> 上へ入れ替え</span>
    <span><kbd>{keyLabel('english.start')}</kbd> 英文入力</span><span><kbd>{keyLabel('translation.start')}</kbd> 訳文入力</span>
    <span><kbd>{keyLabel('form.start')}</kbd> formモード（活用表示）</span>
    <span><kbd>{keyLabel('border.start')}</kbd> 境目モード（<kbd>{keyLabel('cursor.left')}</kbd>/<kbd>{keyLabel('cursor.right')}</kbd>で移動、<kbd>{keyLabel('cursor.rowStart')}</kbd>/<kbd>{keyLabel('cursor.rowEnd')}</kbd>で文頭・文末）</span>
    <span>境目で <kbd>{keyLabel('pseudo.start')}</kbd> 疑似トークン作成、<kbd>{keyLabel('bracket.insertSquareOpen')}</kbd>/<kbd>{keyLabel('bracket.insertSquareClose')}</kbd> 角括弧追加、<kbd>{keyLabel('bracket.insertRoundOpen')}</kbd>/<kbd>{keyLabel('bracket.insertRoundClose')}</kbd> 丸括弧追加、<kbd>{keyLabel('bracket.insertAngleOpen')}</kbd>/<kbd>{keyLabel('bracket.insertAngleClose')}</kbd> 山括弧追加、<kbd>{keyLabel('bracket.deleteBefore')}</kbd>/<kbd>{keyLabel('bracket.deleteAfter')}</kbd> 隣の括弧・疑似トークン削除</span>
    <span>疑似スロットで <kbd>{keyLabel('english.start')}</kbd> 再編集（空文字で削除）</span>
    <span>normalで <kbd>{keyLabel('bracket.insertSquareOpen')}</kbd>/<kbd>{keyLabel('bracket.insertSquareClose')}</kbd>、<kbd>{keyLabel('bracket.insertRoundOpen')}</kbd>/<kbd>{keyLabel('bracket.insertRoundClose')}</kbd>、<kbd>{keyLabel('bracket.insertAngleOpen')}</kbd>/<kbd>{keyLabel('bracket.insertAngleClose')}</kbd> 現在のregionの左／右に括弧追加（元のスロットに留まる・丸括弧はスロットなし）</span>
    <span><kbd>{keyLabel('bracket.insertSquareOpen')}</kbd> のスロットは標識・矢印に対応（T/D不可、含めた下線は複合下線）</span>
    <span><kbd>{keyLabel('bracket.insertRoundOpen')}</kbd>/<kbd>{keyLabel('bracket.insertAngleOpen')}</kbd> は全体を選択・標識入力不可、ad系統の修飾矢印の始点／終点に対応（T/D不可、下線作成時は選択していても除外）。<kbd>{keyLabel('bracket.insertRoundClose')}</kbd>/<kbd>{keyLabel('bracket.insertAngleClose')}</kbd> は選択なし</span>
    <span><kbd>{keyLabel('cursor.left')}</kbd><kbd>{keyLabel('cursor.right')}</kbd> 移動</span><span><kbd>{keyLabel('cursor.down')}</kbd><kbd>{keyLabel('cursor.up')}</kbd> 下線間を移動</span>
    <span><kbd>{keyLabel('cursor.up')}</kbd> 基礎下線の内部へ（T・D分割中は不可）</span>
    <span><kbd>{keyLabel('cursor.rowStart')}</kbd><kbd>{keyLabel('cursor.rowEnd')}</kbd> 行頭・行末</span>
    <span><kbd>{keyLabel('selection.toggle')}</kbd> 範囲選択</span><span><kbd>{keyLabel('selection.toggle')} を2回</kbd> 個別選択（<kbd>{keyLabel('selection.toggle')}</kbd>で追加・解除）</span>
    <span><kbd>{keyLabel('selection.commit')}</kbd> 下線作成</span><span><kbd>{keyLabel('split.t')}</kbd> T化</span><span><kbd>{keyLabel('split.d')}</kbd> 2分割（連続領域・再分割不可）</span>
    <span><kbd>{keyLabel('arrow.start')}</kbd> 矢印作成・付け替え（{appositionMarkerLabels} は同格）→ 相手で <kbd>{keyLabel('arrow.commit')}</kbd></span>
    <span><kbd>{keyLabel('arrow.delete')}</kbd> 矢印削除（同格は両端で可）</span>
    <span><kbd>{keyLabel('structure.delete')}</kbd> 下線削除・T/D分割解除</span><span><kbd>{keyLabel('marker.clear')}</kbd> 標識削除</span>
    <span>Normalで <kbd>{keyLabel('marker.customStart')}</kbd> 標識を自由入力</span>
    <span><kbd>{keyLabel('history.undo')}</kbd> 元に戻す</span><span><kbd>{keyLabel('history.redo')}</kbd> やり直す</span><span><kbd>{keyLabel('editor.cancel')}</kbd> Normal</span>
  </section>

  <details class="marker-guide" on:toggle={finishMarkerInput}>
    <summary>標識の入力（Normal モード）</summary>
    <div class="marker-bindings">{#each markerBindings as binding}<span><kbd>{binding.sequence}</kbd> → {markerLabel(binding.value)}</span>{/each}</div>
    <p>先頭文字から定型標識入力に切り替わります。移動・{keyLabel('editor.cancel')} で確定して Normal に戻り、Normal の {keyLabel('marker.clear')} で削除します。</p>
  </details>

  {#if ready}
    <div class="entries">
      {#each entries as entry, index (entry.id)}
        <section id={`entry-${entry.id}`} data-entry-id={entry.id} class="entry" class:active={activeEntryId === entry.id}
          tabindex="-1"
          aria-label={`第${index + 1}組`} on:pointerdown|capture={() => activate(entry.id)} on:focusin|capture={() => activate(entry.id)}>
          <div class="entry-menu" class:open={openEntryMenuId === entry.id}>
            <button id={`entry-menu-trigger-${entry.id}`} class="entry-menu-trigger" type="button"
              aria-label={`第${index + 1}組の操作`} aria-expanded={openEntryMenuId === entry.id}
              aria-controls={`entry-menu-panel-${entry.id}`} on:click={() => toggleEntryMenu(entry.id)}>⋯</button>
            {#if openEntryMenuId === entry.id}
              <div id={`entry-menu-panel-${entry.id}`} class="entry-menu-panel" role="group" aria-label={`第${index + 1}組の操作`}>
                <span class="entry-menu-title">第{index + 1}組</span>
                <button type="button" on:click={() => runEntryAction(() => editors[entry.id]?.startInput())}>英文を編集</button>
                <button type="button" on:click={() => runEntryAction(() => editors[entry.id]?.startInput(true))}>訳文を編集</button>
                <button type="button" on:click={() => runEntryAction(() => addEntry(entry.id))}>下に追加</button>
                <button type="button" on:click={() => runEntryAction(() => openBulkEntry(entry.id))}>英文を一括追加</button>
                <button type="button" disabled={index === 0} on:click={() => runEntryAction(() => swapEntry(entry.id, -1))}>上へ</button>
                <button type="button" disabled={index === entries.length - 1} on:click={() => runEntryAction(() => swapEntry(entry.id, 1))}>下へ</button>
                <button type="button" on:click={() => runEntryAction(() => deleteEntry(entry.id))}>削除</button>
              </div>
            {/if}
          </div>
          <EntryEditor {bindingSettings} bind:this={editors[entry.id]} initial={entry.document} active={activeEntryId === entry.id}
            ontranslationactivity={translationActivity}
            onactivate={() => activate(entry.id)} onundo={(redo) => void undo(redo)}
            onrecord={(before, after) => recordEntry(entry.id, before, after)}
            onstate={(state) => receiveState(entry.id, state)} />
        </section>
      {/each}
    </div>
  {/if}

  <footer>
    <span role="status">{loading ? '保存データを読み込み中…' : saveError ? '保存に失敗しました' : saveStatus.saving ? '保存中…' : saveStatus.pending ? '未保存の変更があります' : ready ? '保存済み' : '未読み込み'} · 文単位で自動保存</span>
    <span>{entries.length}組</span>
  </footer>
  {#if saveError}
    <p role="alert">{saveError} <button type="button" on:click={retrySave} disabled={loading}>再試行</button>
      {#if loadFailed && !ready}<button type="button" on:click={() => void discardSavedData()} disabled={loading}>保存データを破棄</button>{/if}
    </p>
  {/if}

  <dialog bind:this={bulkDialog} class="bulk-dialog" aria-labelledby="bulk-title" aria-describedby="bulk-description"
    on:cancel|preventDefault={closeBulkEntry}
    on:keydown={handleBulkKeydown}>
    <h2 id="bulk-title">英文を一括追加</h2>
    <p id="bulk-description">1行を1組として、第{entries.findIndex((entry) => entry.id === bulkAfterId) + 1}組の直後へ追加します。空行は無視し、既存の組は変更しません。</p>
    <label for="bulk-english">英文（1行に1組）</label>
    <textarea id="bulk-english" bind:this={bulkTextarea} bind:value={bulkDraft} rows="8"
      placeholder={'She likes music.\nHe plays the piano.'}></textarea>
    <div class="bulk-actions">
      <span role="status" aria-live="polite">追加件数: {bulkCount}組</span>
      <button type="button" on:click={closeBulkEntry}>キャンセル</button>
      <button type="button" class="bulk-submit" disabled={!bulkCount} on:click={addBulkEntries}>追加</button>
    </div>
  </dialog>

  <details class="debug-panel" bind:open={debugOpen} on:toggle={() => { if (debugOpen) void refreshDebugJSON(); }}>
    <summary>デバッグ用JSON</summary>
    <div class="debug-header"><h2 id="debug-heading">デバッグ用JSON</h2>
      <button type="button" disabled={debugLoading} on:click={() => void refreshDebugJSON()}>JSONを更新</button>
      <button type="button" on:pointerdown|preventDefault on:click={copyDebugJSON}>両方のJSONをコピー</button>
    </div>
    <p>表示・操作の内部状態と、保存完了した状態です。JSONはこの欄を開くか、更新・コピーを押したときに取得します。通常の保存は操作停止から500ms後と、別の文への切り替え時に行います。</p>
    <p class="debug-copy-status" role="status">{copyStatus}</p>
    <div class="debug-columns">
      <label><span>表示状態</span><textarea aria-label="表示状態JSON" readonly wrap="off" spellcheck={false} value={displayJSON}></textarea></label>
      <label><span>保存状態</span><textarea aria-label="保存状態JSON" readonly wrap="off" spellcheck={false} value={savedJSON}></textarea></label>
    </div>
  </details>
</main>

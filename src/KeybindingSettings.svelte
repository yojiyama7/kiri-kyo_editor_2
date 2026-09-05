<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { INPUT_MODES, SETTINGS_OPERATIONS, getSettings, defaultSettings, captureKey, bindingLabel, validateSettings, findConflicts,
    operationDefinition, saveSettings, isComposingInput, type Binding, type InputMode, type OperationDefinition, type OperationId } from './keybindings';
  import { MODE_ABBREVIATIONS, MODE_HELP, operationHelp } from './keybindingHelp';
  import { lockDocumentScroll } from './documentScroll';
  export let onclose: () => void;
  export let onsaved: () => void;
  let dialog: HTMLDialogElement;
  let helpDialog: HTMLDialogElement;
  let selectedHelp: OperationDefinition | null = null;
  let draft = structuredClone(getSettings());
  let saveError = '';
  let recording: string | null = null;
  let modeFilter: InputMode | '' = '';
  const slotIndexes = [0, 1, 2];
  const categories = ['取消', '移動', 'Undo / Redo', 'モード内操作', '標識・form入力', '操作開始・構造変更'];
  $: errors = validateSettings(draft);
  $: conflicts = findConflicts(draft);
  onMount(() => {
    dialog.showModal();
    return lockDocumentScroll(document);
  });
  function isFixedEscape(binding: Binding): boolean {
    return binding.kind === 'key' && binding.key === 'Escape' && !binding.ctrl && !binding.alt && !binding.meta && !binding.shift && !binding.code;
  }
  function editableBindings(id: OperationId): Binding[] {
    return draft.bindings[id].filter(binding => !isFixedEscape(binding));
  }
  function setSlot(id: OperationId, index: number, binding?: Binding): number | undefined {
    const current = editableBindings(id);
    let actualIndex: number | undefined;
    if (binding) {
      actualIndex = Math.min(index, current.length);
      if (index < current.length) current[index] = binding;
      else current.push(binding);
    } else if (index < current.length) {
      current.splice(index, 1);
    }
    const fixed = draft.bindings[id].filter(isFixedEscape);
    draft = { ...draft, bindings: { ...draft.bindings, [id]: [...fixed, ...current] } };
    saveError = '';
    return actualIndex;
  }
  async function focusSlot(id: OperationId, index: number) {
    await tick();
    const input = dialog?.querySelector<HTMLInputElement>(`input[data-operation="${id}"][data-slot="${index}"]`);
    input?.focus();
    if (!input?.readOnly) input?.setSelectionRange(input.value.length, input.value.length);
  }
  function clearSlot(event: KeyboardEvent, id: OperationId, index: number): boolean {
    if (isComposingInput(event) || event.key !== 'Escape') return false;
    event.preventDefault();
    event.stopPropagation();
    setSlot(id, index);
    recording = null;
    (event.currentTarget as HTMLElement).blur();
    return true;
  }
  function updateSequence(event: Event, id: OperationId, index: number) {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.value;
    const actualIndex = setSlot(id, index, value ? { kind: 'sequence', sequence: value } : undefined);
    if (!value) input.blur();
    else if (actualIndex !== index) void focusSlot(id, actualIndex!);
  }
  function reset(id: OperationId) {
    draft = { ...draft, bindings: { ...draft.bindings, [id]: defaultSettings().bindings[id] } };
  }
  function openHelp(operation: OperationDefinition) {
    selectedHelp = operation;
    helpDialog.showModal();
  }
  function closeHelp() {
    helpDialog.close();
    selectedHelp = null;
  }
  function assignmentSummary(operation: OperationDefinition): string {
    const labels = editableBindings(operation.id).map(bindingLabel);
    if (operation.category === 1) labels.unshift('Esc（固定）');
    return labels.join(' / ') || '未割り当て';
  }
  function operationMatchesFilter(operation: OperationDefinition): boolean {
    return modeFilter === '' || operation.modes.includes(modeFilter);
  }
  function modeDescription(mode: InputMode): string {
    return `${MODE_HELP[mode]} (${mode})`;
  }
  function record(event: KeyboardEvent, id: OperationId, index: number) {
    if (event.key === 'Escape' && !isComposingInput(event)) { clearSlot(event, id, index); return; }
    event.stopPropagation();
    if (isComposingInput(event)) return;
    const key = captureKey(event);
    if (!key || event.repeat) return;
    event.preventDefault();
    const actualIndex = setSlot(id, index, key);
    recording = null;
    if (actualIndex !== index) void focusSlot(id, actualIndex!);
  }
  function save() {
    try { saveSettings(localStorage, draft); dialog.close(); onsaved(); }
    catch (error) { saveError = `保存できませんでした: ${String(error)}`; }
  }
  function close() { dialog.close(); onclose(); }
</script>

<dialog bind:this={dialog} class="keybinding-settings" aria-labelledby="keybinding-title"
  on:cancel={(event) => { event.preventDefault(); close(); }} on:keydown|stopPropagation>
  <header>
    <h2 id="keybinding-title">キーバインド設定</h2>
    <p>上ほど優先されます。各操作3件まで。Escは設定欄には表示されませんが、取消キーとして常に有効です。競合があっても保存できます。</p>
    <p>入力欄でEscを押すと、その割り当てを解除します。空いた欄は自動的に左詰めされます。</p>
    <p>キー欄を選んで実際のキーを押してください。標識・formは文字列を入力します。定型標識は先頭文字から専用モードに入り、続きの入力に時間制限はありません。</p>
    <p>OS・ブラウザーが先に処理するキーは、アプリへ届かない場合があります。この競合の完全検出はできません。</p>
  </header>
  <div class="settings-content">
    <section class="binding-panel" aria-label="キーバインド操作の検索結果">
      <div class="binding-filter">
        <label for="mode-filter">前提モード</label>
        <select id="mode-filter" bind:value={modeFilter}>
          <option value="">すべて</option>
          {#each INPUT_MODES as mode}
            <option value={mode}>{MODE_HELP[mode]}（{MODE_ABBREVIATIONS[mode]}）</option>
          {/each}
        </select>
        <div class="mode-filter-help">
          <button type="button" class="help-button" aria-label="モードアイコンの説明" aria-describedby="mode-icon-key">?</button>
          <div class="mode-icon-key" id="mode-icon-key" role="tooltip">
            <strong>モードアイコン</strong>
            <ul>
              {#each INPUT_MODES as mode}
                <li><span class="mode-icon" aria-hidden="true">{MODE_ABBREVIATIONS[mode]}</span><span>{MODE_HELP[mode]}</span></li>
              {/each}
            </ul>
          </div>
        </div>
      </div>
      <div class="binding-list" role="table" aria-label="固定優先順位順の操作">
        <div class="binding-header" role="row">
          <span role="columnheader">操作</span>
          <span role="columnheader">説明</span>
          <span role="columnheader">キーバインド1</span>
          <span role="columnheader">キーバインド2</span>
          <span role="columnheader">キーバインド3</span>
          <span role="columnheader">初期化</span>
        </div>
        {#each SETTINGS_OPERATIONS as operation, rank}
          {#if operationMatchesFilter(operation)}
            {@const help = operationHelp(operation.id)}
            <div class="binding-row" role="row">
              <div class="binding-operation" role="rowheader">
                <strong>{rank + 1}. {operation.label}</strong>
                <small>
                  <span>{categories[operation.category - 1]}</span>
                  <span class="mode-icons" aria-label="前提モード">
                    {#each operation.modes as mode}
                      <span class="mode-icon" title={modeDescription(mode)} aria-label={modeDescription(mode)}>{MODE_ABBREVIATIONS[mode]}</span>
                    {/each}
                  </span>
                </small>
              </div>
              <div class="help-control" role="cell">
                <button type="button" class="help-button" aria-label={`${operation.label}の詳細説明`} aria-describedby={`help-summary-${operation.id}`}
                  aria-haspopup="dialog" on:click={() => openHelp(operation)}>?</button>
                <span class="help-tooltip" id={`help-summary-${operation.id}`} role="tooltip">{help.summary}</span>
              </div>
              {#each slotIndexes as index}
                {@const binding = editableBindings(operation.id)[index]}
                <div class="binding-slot" role="cell">
                  {#if operation.sequence}
                    <input aria-label={`${operation.label} 割り当て${index + 1}`} value={binding?.kind === 'sequence' ? binding.sequence : ''} placeholder="empty"
                      data-operation={operation.id} data-slot={index}
                      on:input={(event) => updateSequence(event, operation.id, index)}
                      on:keydown={(event) => clearSlot(event, operation.id, index)} />
                  {:else}
                    <input readonly aria-label={`${operation.label} 割り当て${index + 1}`}
                      value={binding ? bindingLabel(binding) : ''} placeholder="empty"
                      data-operation={operation.id} data-slot={index}
                      class:recording={recording === `${operation.id}:${index}`}
                      on:focus={() => { recording = `${operation.id}:${index}`; }} on:blur={() => { recording = null; }}
                      on:keydown={(event) => record(event, operation.id, index)} />
                  {/if}
                </div>
              {/each}
              <div class="binding-reset" role="cell">
                <button type="button" on:click={() => reset(operation.id)}>初期化</button>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </section>
    <aside aria-label="競合と入力エラー">
      <h3>入力エラー {errors.length}件</h3>
      {#each errors as error}<p class="error">{error}</p>{/each}
      <h3>競合警告 {conflicts.length}件</h3>
      {#if !errors.length && !conflicts.length}<p>競合はありません。</p>{/if}
      {#if errors.length}<p>入力エラーを修正すると競合を検査します。</p>{/if}
      {#each conflicts as conflict}
        <div class="conflict">
          <strong><span class="mode-icon" title={modeDescription(conflict.mode)} aria-label={modeDescription(conflict.mode)}>{MODE_ABBREVIATIONS[conflict.mode]}</span> · {conflict.buffer ? `「${conflict.buffer}」の後に ` : ''}{conflict.input}</strong>
          <p>{conflict.operations.map(id => operationDefinition(id).label).join(' / ')}</p>
          <p>優先: {operationDefinition(conflict.winner).label}。他の候補は実行されません。</p>
          {#if conflict.affectedSequences.length}<p>関連する連続入力: {conflict.affectedSequences.join(' / ')}</p>{/if}
        </div>
      {/each}
    </aside>
  </div>
  <footer>
    {#if saveError}<p role="alert" class="error">{saveError}</p>{/if}
    <button type="button" on:click={() => { draft = defaultSettings(); saveError = ''; }}>全体を初期化</button>
    <button type="button" on:click={close}>キャンセル</button>
    <button type="button" disabled={errors.length > 0} on:click={save}>保存{conflicts.length ? '（競合あり）' : ''}</button>
  </footer>
</dialog>

<dialog bind:this={helpDialog} class="operation-help" aria-labelledby="operation-help-title"
  on:cancel|preventDefault={closeHelp} on:keydown|stopPropagation>
  {#if selectedHelp}
    {@const help = operationHelp(selectedHelp.id)}
    <div class="operation-help-heading">
      <h2 id="operation-help-title">{selectedHelp.label}</h2>
      <button type="button" aria-label="詳細説明を閉じる" on:click={closeHelp}>閉じる</button>
    </div>
    <section>
      <h3>何をする操作か</h3>
      <p>{help.description}</p>
    </section>
    <section>
      <h3>利用可能なモード</h3>
      <ul class="mode-list">
        {#each selectedHelp.modes as mode}<li><strong class="mode-icon" title={modeDescription(mode)} aria-label={modeDescription(mode)}>{MODE_ABBREVIATIONS[mode]}</strong><span>{MODE_HELP[mode]}</span></li>{/each}
      </ul>
    </section>
    <section>
      <h3>使い方の例</h3>
      <p>{help.example}</p>
    </section>
    <section>
      <h3>現在の割り当て</h3>
      <p>{assignmentSummary(selectedHelp)}</p>
    </section>
  {/if}
</dialog>

<style>
  .keybinding-settings { width: min(1100px, 94vw); max-height: 90vh; padding: 0; border: 1px solid #aaa; border-radius: 10px; color: #222; background: white; overscroll-behavior: contain; }
  .keybinding-settings::backdrop { background: #0006; }
  header, footer { padding: 16px 20px; background: #f6f6f6; }
  header p { margin: 6px 0; font-size: .85rem; }
  h2 { margin: 0 0 8px; }
  .settings-content { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); height: 58vh; overflow: hidden; }
  .binding-panel { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
  .binding-filter { display: flex; flex: none; gap: 10px; align-items: center; padding: 10px 16px; border-bottom: 1px solid #bbb; background: #f7f7f7; }
  .binding-filter label { font-size: .85rem; font-weight: 600; }
  .binding-filter select { min-width: 170px; padding: 6px 28px 6px 8px; border: 1px solid #aaa; border-radius: 4px; background: white; }
  .mode-filter-help { position: relative; z-index: 3; display: flex; }
  .mode-icon-key { box-sizing: border-box; position: absolute; top: calc(100% + 7px); right: 0; width: min(300px, 80vw); padding: 10px 12px; border: 1px solid #777; border-radius: 5px; background: #222; color: white; font-size: .75rem; line-height: 1.45; box-shadow: 0 3px 10px #0004; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .12s; }
  .mode-icon-key ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; margin: 8px 0 0; padding: 0; list-style: none; }
  .mode-icon-key li { display: flex; gap: 6px; align-items: center; }
  .mode-filter-help:hover .mode-icon-key, .mode-filter-help:focus-within .mode-icon-key { opacity: 1; visibility: visible; }
  .binding-list { min-width: 0; min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
  .binding-header, .binding-row { display: grid; grid-template-columns: minmax(185px, 1fr) 28px repeat(3, 118px) max-content; gap: 8px; align-items: center; min-width: 680px; padding: 10px 16px; }
  .binding-header { position: sticky; top: 0; z-index: 1; border-bottom: 1px solid #bbb; background: #eee; color: #555; font-size: .75rem; font-weight: 600; }
  .binding-row { border-bottom: 1px solid #ddd; }
  .binding-operation { min-width: 0; }
  small { display: flex; flex-wrap: wrap; gap: 5px 8px; align-items: center; color: #666; font-size: .75rem; margin-top: 4px; }
  .mode-icons { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .mode-icon { box-sizing: border-box; display: inline-flex; min-width: 22px; height: 22px; align-items: center; justify-content: center; padding: 0 5px; border: 1px solid #8a96a3; border-radius: 7px; background: #edf2f7; color: #344454; font: 700 .68rem/1 ui-monospace, monospace; vertical-align: middle; }
  .help-control { position: relative; display: flex; justify-content: center; }
  .help-button { width: 22px; height: 22px; padding: 0; border: 1px solid #777; border-radius: 50%; background: white; color: #555; font-weight: 700; line-height: 20px; }
  .help-tooltip { position: absolute; top: calc(100% + 7px); left: 50%; z-index: 4; width: 220px; padding: 8px 10px; border: 1px solid #777; border-radius: 5px; background: #222; color: white; font-size: .75rem; font-weight: 400; line-height: 1.45; box-shadow: 0 3px 10px #0004; opacity: 0; visibility: hidden; pointer-events: none; transform: translateX(-50%); transition: opacity .12s; }
  .help-control:hover .help-tooltip, .help-button:focus-visible + .help-tooltip { opacity: 1; visibility: visible; }
  .binding-slot { min-width: 0; }
  .binding-reset { justify-self: end; }
  input { box-sizing: border-box; width: 100%; padding: 6px; border: 1px solid #aaa; border-radius: 4px; }
  input::placeholder { color: #777; opacity: .55; }
  input.recording { outline: 2px solid #2672ae; }
  button { padding: 6px 9px; cursor: pointer; }
  button:disabled { cursor: default; }
  aside { min-height: 0; overflow: auto; padding: 12px; border-left: 1px solid #ddd; background: #fffaf0; overscroll-behavior: contain; }
  h3 { font-size: .95rem; }
  .conflict { border-bottom: 1px solid #e1cda4; padding: 10px 0; font-size: .8rem; overflow-wrap: anywhere; }
  .conflict p { margin: 6px 0; }
  .error { color: #a02020; font-size: .85rem; }
  footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
  .operation-help { box-sizing: border-box; width: min(560px, 90vw); max-height: 82vh; padding: 20px 24px; border: 1px solid #888; border-radius: 10px; color: #222; background: white; }
  .operation-help::backdrop { background: #0007; }
  .operation-help-heading { display: flex; gap: 16px; align-items: center; justify-content: space-between; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
  .operation-help-heading h2 { margin: 0; font-size: 1.25rem; }
  .operation-help section { margin-top: 18px; }
  .operation-help h3 { margin: 0 0 6px; font-size: .95rem; }
  .operation-help p { margin: 0; line-height: 1.65; }
  .mode-list { display: flex; flex-wrap: wrap; gap: 7px; margin: 0; padding: 0; list-style: none; }
  .mode-list li { display: flex; gap: 5px; align-items: baseline; padding: 5px 8px; border-radius: 5px; background: #f0f3f6; font-size: .8rem; }
  .mode-list span { color: #555; }
  @media (max-width: 700px) { .settings-content { grid-template-columns: 1fr; grid-template-rows: minmax(0, 2fr) minmax(120px, 1fr); } aside { border-left: 0; } }
</style>

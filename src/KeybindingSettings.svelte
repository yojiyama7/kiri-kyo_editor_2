<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { OPERATIONS, getSettings, defaultSettings, captureKey, bindingLabel, validateSettings, findConflicts,
    operationDefinition, saveSettings, isComposingInput, type Binding, type OperationId } from './keybindings';
  import { lockDocumentScroll } from './documentScroll';
  export let onclose: () => void;
  export let onsaved: () => void;
  let dialog: HTMLDialogElement;
  let draft = structuredClone(getSettings());
  let saveError = '';
  let recording: string | null = null;
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
    <section class="binding-list" aria-label="固定優先順位順の操作">
      {#each OPERATIONS as operation, rank}
        <div class="binding-row">
          <div><strong>{rank + 1}. {operation.label}</strong><small>{categories[operation.category - 1]} · 適用モード: {operation.modes.join(' / ')}</small></div>
          <div class="binding-slots">
            {#each slotIndexes as index}
              {@const binding = editableBindings(operation.id)[index]}
              <div class="binding-slot">
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
            <button type="button" on:click={() => reset(operation.id)}>初期化</button>
          </div>
        </div>
      {/each}
    </section>
    <aside aria-label="競合と入力エラー">
      <h3>入力エラー {errors.length}件</h3>
      {#each errors as error}<p class="error">{error}</p>{/each}
      <h3>競合警告 {conflicts.length}件</h3>
      {#if !errors.length && !conflicts.length}<p>競合はありません。</p>{/if}
      {#if errors.length}<p>入力エラーを修正すると競合を検査します。</p>{/if}
      {#each conflicts as conflict}
        <div class="conflict">
          <strong>{conflict.mode} · {conflict.buffer ? `「${conflict.buffer}」の後に ` : ''}{conflict.input}</strong>
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

<style>
  .keybinding-settings { width: min(1100px, 94vw); max-height: 90vh; padding: 0; border: 1px solid #aaa; border-radius: 10px; color: #222; background: white; overscroll-behavior: contain; }
  .keybinding-settings::backdrop { background: #0006; }
  header, footer { padding: 16px 20px; background: #f6f6f6; }
  header p { margin: 6px 0; font-size: .85rem; }
  h2 { margin: 0 0 8px; }
  .settings-content { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); height: 58vh; overflow: hidden; }
  .binding-list { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .binding-row { padding: 12px 16px; border-bottom: 1px solid #ddd; }
  small { display: block; color: #666; font-size: .75rem; margin-top: 4px; }
  .binding-slots { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
  .binding-slot { display: flex; align-items: center; gap: 4px; }
  input { width: 130px; padding: 6px; border: 1px solid #aaa; border-radius: 4px; }
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
  @media (max-width: 700px) { .settings-content { grid-template-columns: 1fr; grid-template-rows: minmax(0, 2fr) minmax(120px, 1fr); } aside { border-left: 0; } }
</style>

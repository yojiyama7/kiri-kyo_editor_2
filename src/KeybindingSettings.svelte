<script lang="ts">
  import { onMount } from 'svelte';
  import { OPERATIONS, getSettings, defaultSettings, captureKey, bindingLabel, validateSettings, findConflicts,
    operationDefinition, saveSettings, isComposingInput, type Binding, type OperationId } from './keybindings';
  export let onclose: () => void;
  export let onsaved: () => void;
  let dialog: HTMLDialogElement;
  let draft = structuredClone(getSettings());
  let saveError = '';
  let recording: string | null = null;
  const categories = ['取消', '移動', 'Undo / Redo', 'モード内操作', '標識・form入力', '操作開始・構造変更'];
  $: errors = validateSettings(draft);
  $: conflicts = findConflicts(draft);
  onMount(() => { dialog.showModal(); });
  function replace(id: OperationId, index: number, binding: Binding) {
    draft = { ...draft, bindings: { ...draft.bindings, [id]: draft.bindings[id].map((old, i) => i === index ? binding : old) } };
    saveError = '';
  }
  function remove(id: OperationId, index: number) {
    draft = { ...draft, bindings: { ...draft.bindings, [id]: draft.bindings[id].filter((_, i) => i !== index) } };
  }
  function add(id: OperationId, sequence: boolean) {
    const blank: Binding = sequence ? { kind: 'sequence', sequence: '' } : { kind: 'key', key: '', ctrl: false, alt: false, meta: false, shift: false };
    draft = { ...draft, bindings: { ...draft.bindings, [id]: [...draft.bindings[id], blank] } };
  }
  function reset(id: OperationId) {
    draft = { ...draft, bindings: { ...draft.bindings, [id]: defaultSettings().bindings[id] } };
  }
  function record(event: KeyboardEvent, id: OperationId, index: number) {
    event.stopPropagation();
    if (isComposingInput(event)) return;
    event.preventDefault();
    const key = captureKey(event);
    if (!key || event.repeat) return;
    // Escape always cancels recording; it cannot be assigned to another operation.
    if (key.key === 'Escape') { recording = null; (event.target as HTMLElement).blur(); return; }
    replace(id, index, key);
    recording = null;
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
    <p>上ほど優先されます。各操作3件まで。Escは固定です。競合があっても保存できます。</p>
    <p>キー欄を選んで実際のキーを押してください。標識・formは文字列を入力します。連続入力に時間制限はありません。</p>
    <p>OS・ブラウザーが先に処理するキーは、アプリへ届かない場合があります。この競合の完全検出はできません。</p>
  </header>
  <div class="settings-content">
    <section class="binding-list" aria-label="固定優先順位順の操作">
      {#each OPERATIONS as operation, rank}
        <div class="binding-row">
          <div><strong>{rank + 1}. {operation.label}</strong><small>{categories[operation.category - 1]} · {operation.modes.join(' / ')}</small></div>
          <div class="binding-slots">
            {#each draft.bindings[operation.id] as binding, index}
              {@const fixed = binding.kind === 'key' && binding.key === 'Escape'}
              <div class="binding-slot">
                {#if binding.kind === 'sequence'}
                  <input aria-label={`${operation.label} 割り当て${index + 1}`} value={binding.sequence}
                    on:input={(event) => replace(operation.id, index, { kind: 'sequence', sequence: event.currentTarget.value })} />
                {:else}
                  <input readonly disabled={fixed} aria-label={`${operation.label} 割り当て${index + 1}${fixed ? ' 固定' : ''}`}
                    value={bindingLabel(binding)} placeholder="キーを押して登録"
                    class:recording={recording === `${operation.id}:${index}`}
                    on:focus={() => { recording = `${operation.id}:${index}`; }} on:blur={() => { recording = null; }}
                    on:keydown={(event) => record(event, operation.id, index)} />
                {/if}
                {#if fixed}<span>固定</span>{:else}<button type="button" aria-label={`${operation.label} 割り当て${index + 1}を削除`} on:click={() => remove(operation.id, index)}>削除</button>{/if}
              </div>
            {/each}
            {#if draft.bindings[operation.id].length < 3}<button type="button" on:click={() => add(operation.id, operation.sequence)}>追加</button>{/if}
            <button type="button" on:click={() => reset(operation.id)}>初期化</button>
            {#if draft.bindings[operation.id].length === 0}<small>未割り当て</small>{/if}
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
  .keybinding-settings { width: min(1100px, 94vw); max-height: 90vh; padding: 0; border: 1px solid #aaa; border-radius: 10px; color: #222; background: white; }
  .keybinding-settings::backdrop { background: #0006; }
  header, footer { padding: 16px 20px; background: #f6f6f6; }
  header p { margin: 6px 0; font-size: .85rem; }
  h2 { margin: 0 0 8px; }
  .settings-content { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); height: 58vh; overflow: hidden; }
  .binding-list { min-width: 0; min-height: 0; overflow: auto; }
  .binding-row { padding: 12px 16px; border-bottom: 1px solid #ddd; }
  small { display: block; color: #666; font-size: .75rem; margin-top: 4px; }
  .binding-slots { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
  .binding-slot { display: flex; align-items: center; gap: 4px; }
  input { width: 130px; padding: 6px; border: 1px solid #aaa; border-radius: 4px; }
  input.recording { outline: 2px solid #2672ae; }
  button { padding: 6px 9px; cursor: pointer; }
  button:disabled { cursor: default; }
  aside { min-height: 0; overflow: auto; padding: 12px; border-left: 1px solid #ddd; background: #fffaf0; }
  h3 { font-size: .95rem; }
  .conflict { border-bottom: 1px solid #e1cda4; padding: 10px 0; font-size: .8rem; overflow-wrap: anywhere; }
  .conflict p { margin: 6px 0; }
  .error { color: #a02020; font-size: .85rem; }
  footer { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
  @media (max-width: 700px) { .settings-content { grid-template-columns: 1fr; grid-template-rows: minmax(0, 2fr) minmax(120px, 1fr); } aside { border-left: 0; } }
</style>

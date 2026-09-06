import type { KeyboardInput } from './keyboard.ts';
import { KEYBOARD_OPERATION_IDS, type KeyboardOperationId } from './operationIds.ts';
import { MARKER_LABELS, FORM_LABELS, type MarkerId, type FormId } from './inputIds.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS, DEFAULT_FORM_INPUT_BINDINGS, DEFAULT_OPERATION_KEY_LABELS, FIXED_OPERATION_IDS } from './inputConfig.ts';

export type OperationId = Exclude<KeyboardOperationId, 'translation.blockTab'> | MarkerId | FormId;
export type InputMode = 'NORMAL' | 'VISUAL' | 'VISUAL_MULTI' | 'ARROW' | 'BORDER' | 'FORM'
  | 'INSERT' | 'TRANSLATION' | 'PSEUDO_INPUT' | 'MARKER_INPUT' | 'MARKER_SEQUENCE' | 'DIALOG' | 'MENU';
export const INPUT_MODES: readonly InputMode[] = ['NORMAL', 'VISUAL', 'VISUAL_MULTI', 'ARROW', 'BORDER', 'FORM',
  'INSERT', 'TRANSLATION', 'PSEUDO_INPUT', 'MARKER_INPUT', 'MARKER_SEQUENCE', 'DIALOG', 'MENU'];
export type KeyStroke = { kind: 'key'; key: string; code?: string; ctrl: boolean; alt: boolean; meta: boolean; shift: boolean };
export type Binding = KeyStroke | { kind: 'sequence'; sequence: string };
export type BindingSettings = { version: 1; bindings: Record<OperationId, Binding[]> };
export type OperationDefinition = { id: OperationId; label: string; category: number; modes: readonly InputMode[]; sequence: boolean };
const edit: InputMode[] = ['NORMAL', 'VISUAL', 'VISUAL_MULTI', 'ARROW', 'BORDER'];
const navigation: InputMode[] = [...edit, 'FORM'];
const definitions: OperationDefinition[] = [];
function add(category: number, modes: readonly InputMode[], values: Partial<Record<OperationId, string>>) {
  for (const [id, label] of Object.entries(values)) definitions.push({ id: id as OperationId, label, category, modes, sequence: false });
}
add(1, [...navigation, 'INSERT', 'TRANSLATION', 'PSEUDO_INPUT', 'MARKER_INPUT', 'MARKER_SEQUENCE'], { 'editor.cancel': '編集の終了・取消' });
add(1, ['DIALOG', 'MENU'], { 'dialog.cancel': 'ダイアログ・メニューを閉じる' });
add(2, [...navigation, 'MARKER_SEQUENCE', 'MENU'], { 'cursor.left': '左へ移動', 'cursor.right': '右へ移動', 'cursor.up': '上へ移動',
  'cursor.down': '下へ移動', 'cursor.rowStart': '行頭へ移動', 'cursor.rowEnd': '行末へ移動' });
// BORDER has no vertical navigation; MENU has no horizontal navigation.
for (const definition of definitions) {
  if (['cursor.up', 'cursor.down'].includes(definition.id)) definition.modes = definition.modes.filter(mode => mode !== 'BORDER');
  if (['cursor.left', 'cursor.right'].includes(definition.id)) definition.modes = definition.modes.filter(mode => mode !== 'MENU');
}
add(2, [...navigation, 'TRANSLATION', 'MARKER_SEQUENCE'], { 'entry.next': '次の組', 'entry.previous': '前の組' });
add(2, ['DIALOG'], { 'focus.next': '次の項目へ', 'focus.previous': '前の項目へ' });
add(3, edit, { 'history.undo': '元に戻す', 'history.redo': 'やり直す' });
add(4, ['FORM'], { 'form.commit': 'formを確定', 'form.clear': 'formを削除', 'form.eraseInput': 'form入力を1文字戻す' });
add(4, ['PSEUDO_INPUT'], { 'pseudo.commit': '疑似トークンを確定' });
add(4, ['MARKER_INPUT'], { 'marker.customCommit': '自由入力の標識を確定' });
add(4, ['TRANSLATION'], { 'translation.commit': '訳文入力を完了' });
add(4, ['ARROW'], { 'arrow.commit': '矢印を確定' });
add(4, ['VISUAL', 'VISUAL_MULTI'], { 'selection.commit': '選択から下線を作成' });
add(4, ['NORMAL', 'VISUAL', 'VISUAL_MULTI'], { 'selection.toggle': '選択を開始・追加・解除' });
add(4, ['NORMAL'], { 'marker.clear': '標識を削除' });
for (const [id, label] of Object.entries(MARKER_LABELS)) definitions.push({ id: id as MarkerId, label: `標識 ${label}`, category: 5, modes: ['NORMAL', 'MARKER_SEQUENCE'], sequence: true });
for (const [id, label] of Object.entries(FORM_LABELS)) definitions.push({ id: id as FormId, label: `form ${label}`, category: 5, modes: ['FORM'], sequence: true });
add(6, ['NORMAL'], { 'form.start': 'form入力を開始', 'border.start': '境目モードを開始', 'marker.start': '定型標識入力を開始', 'marker.customStart': '標識の自由入力を開始',
  'arrow.start': '矢印作成を開始', 'arrow.delete': '矢印を削除', 'split.t': 'T化', 'split.d': 'D分割',
  'english.start': '英文・疑似トークンを編集', 'translation.start': '訳文を編集', 'structure.delete': '構造を削除' });
add(6, edit, { 'entry.reorderDown': '組を下へ入れ替え', 'entry.reorderUp': '組を上へ入れ替え' });
add(6, ['BORDER'], { 'pseudo.start': '疑似トークン入力を開始', 'bracket.deleteBefore': '前の括弧・疑似トークンを削除', 'bracket.deleteAfter': '後の括弧・疑似トークンを削除' });
add(6, ['NORMAL', 'BORDER'], { 'bracket.insertSquareOpen': '[ を挿入', 'bracket.insertSquareClose': '] を挿入',
  'bracket.insertRoundOpen': '( を挿入', 'bracket.insertRoundClose': ') を挿入', 'bracket.insertAngleOpen': '< を挿入', 'bracket.insertAngleClose': '> を挿入' });
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const OPERATIONS = definitions.sort((a, b) => a.category - b.category ||
  (a.category === 3 ? Number(a.id !== 'history.undo') - Number(b.id !== 'history.undo') : compareText(a.id, b.id)));
const fixedOperationIds = new Set<OperationId>(FIXED_OPERATION_IDS);
export const SETTINGS_OPERATIONS = OPERATIONS.filter(operation => !fixedOperationIds.has(operation.id));
const ranks = new Map(OPERATIONS.map((op, index) => [op.id, index]));
const byId = new Map(OPERATIONS.map(op => [op.id, op]));
const expected = [...KEYBOARD_OPERATION_IDS.filter(id => id !== 'translation.blockTab'), ...Object.keys(MARKER_LABELS), ...Object.keys(FORM_LABELS)];
if (ranks.size !== definitions.length || ranks.size !== expected.length || expected.some(id => !ranks.has(id as OperationId))) {
  throw new Error('操作の優先順位定義に重複または未分類があります');
}
export function compareOperations(a: OperationId, b: OperationId): number { return ranks.get(a)! - ranks.get(b)!; }
export function operationDefinition(id: OperationId) { return byId.get(id)!; }
export function isComposingInput(input: KeyboardInput): boolean { return !!input.isComposing || input.keyCode === 229; }
const namedKeys = new Set(['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Pause', 'PrintScreen', 'ContextMenu', 'NumLock', 'ScrollLock', 'Clear', 'Help']);
function isKeyName(key: unknown): key is string { return typeof key === 'string' && ([...key].length === 1 && !/[\p{Cc}]/u.test(key) || namedKeys.has(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)); }
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Dead', 'Process', 'Unidentified']);
// Shift is already encoded by printable event.key (R, +, (, ...). Non-printable
// keys and Ctrl/Meta chords retain Shift separately.
export function captureKey(input: KeyboardInput): KeyStroke | undefined {
  if (!isKeyName(input.key) || modifierKeys.has(input.key) || isComposingInput(input)) return;
  const ctrl = !!input.ctrlKey, alt = !!input.altKey, meta = !!input.metaKey;
  const physical = alt && !!input.code && /^Key[A-Z]$/.test(input.code);
  const key = physical ? input.code!.slice(3).toLowerCase() : input.key;
  return { kind: 'key', key, ...(physical ? { code: input.code } : {}), ctrl, alt, meta,
    shift: physical || ctrl || alt || meta || key.length !== 1 || !/[A-Z~!@#$%^&*()_+{}|:"<>?]/.test(key) ? !!input.shiftKey : false };
}
export function keyMatches(input: KeyboardInput, binding: KeyStroke): boolean {
  const actual = captureKey(input);
  if (!actual) return false;
  const physicalMatch = binding.code && input.code ? binding.code === input.code : actual.key === binding.key;
  return !!physicalMatch && actual.ctrl === binding.ctrl && actual.alt === binding.alt
    && actual.meta === binding.meta && actual.shift === binding.shift;
}
const displayKeys: Record<string, string> = { Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑', ' ': 'Space' };
export function bindingLabel(binding: Binding): string {
  if (binding.kind === 'sequence') return binding.sequence;
  return [binding.ctrl && 'Ctrl', binding.alt && 'Alt', binding.meta && 'Meta', binding.shift && 'Shift', displayKeys[binding.key] ?? binding.key].filter(Boolean).join('+');
}

export function operationKeyLabels(operation: KeyboardOperationId): readonly string[] {
  return operation === 'translation.blockTab' ? ['Tab'] : getSettings().bindings[operation as OperationId].map(bindingLabel);
}

export function operationKeyLabel(operation: KeyboardOperationId, separator = ' / '): string {
  return operationKeyLabels(operation).join(separator) || '未割り当て';
}
function keyFromLabel(label: string): KeyStroke {
  const pieces = label.split('+');
  let key = pieces.pop()!;
  key = ({ Esc: 'Escape', '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' } as Record<string, string>)[key] ?? key;
  const shifted = pieces.includes('Shift');
  if (shifted && key.length === 1) key = key.toUpperCase();
  return captureKey({ key, ctrlKey: pieces.includes('Ctrl'), altKey: pieces.includes('Alt'), metaKey: pieces.includes('Meta'),
    shiftKey: shifted, ...(pieces.includes('Alt') && /^[a-z]$/.test(key) ? { code: `Key${key.toUpperCase()}` } : {}) })!;
}
export function defaultSettings(): BindingSettings {
  const bindings = {} as Record<OperationId, Binding[]>;
  for (const op of OPERATIONS) {
    bindings[op.id] = op.sequence
      ? [...DEFAULT_MARKER_INPUT_BINDINGS, ...DEFAULT_FORM_INPUT_BINDINGS].filter(b => b.value === op.id).map(b => ({ kind: 'sequence', sequence: b.sequence }))
      : (DEFAULT_OPERATION_KEY_LABELS[op.id as KeyboardOperationId] ?? []).map(keyFromLabel);
  }
  return { version: 1, bindings };
}
function restoreFixedBindings(settings: BindingSettings): BindingSettings {
  const normalized = structuredClone(settings);
  // v1 settings saved before marker.start was introduced remain usable.
  if (!normalized.bindings['marker.start']) normalized.bindings['marker.start'] = (DEFAULT_OPERATION_KEY_LABELS['marker.start'] ?? []).map(keyFromLabel);
  for (const id of FIXED_OPERATION_IDS) {
    normalized.bindings[id] = (DEFAULT_OPERATION_KEY_LABELS[id] ?? []).map(keyFromLabel);
  }
  return normalized;
}
let active: BindingSettings | undefined;
const listeners = new Set<(settings: BindingSettings) => void>();
export function getSettings(): BindingSettings { return active ??= defaultSettings(); }
export function subscribeSettings(listener: (settings: BindingSettings) => void): () => void {
  listeners.add(listener); listener(getSettings()); return () => { listeners.delete(listener); };
}
export function applySettings(settings: BindingSettings): void {
  const normalized = restoreFixedBindings(settings);
  const errors = validateSettings(normalized);
  if (errors.length) throw new Error(errors.join('\n'));
  active = normalized;
  for (const listener of listeners) listener(active);
}
export function sequenceBindings<T extends MarkerId | FormId>(kind: 'marker' | 'form', settings = getSettings()): { sequence: string; value: T }[] {
  return OPERATIONS.filter(op => op.sequence && op.id.startsWith(kind + '.')).flatMap(op =>
    settings.bindings[op.id].filter((b): b is Extract<Binding, { kind: 'sequence' }> => b.kind === 'sequence').map(b => ({ sequence: b.sequence, value: op.id as T })));
}
export function validateSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || (value as BindingSettings).version !== 1 || !(value as BindingSettings).bindings
    || typeof (value as BindingSettings).bindings !== 'object' || Array.isArray((value as BindingSettings).bindings)) return ['設定の形式またはバージョンが不正です'];
  const settings = value as BindingSettings, errors: string[] = [];
  if (Object.keys(settings.bindings).some(id => !byId.has(id as OperationId))) errors.push('未知の操作があります');
  for (const op of OPERATIONS) {
    const values = settings.bindings[op.id];
    if (!Array.isArray(values)) { errors.push(`${op.label}: 割り当てが不正です`); continue; }
    const maximum = op.category === 1 ? 4 : 3;
    if (values.length > maximum) errors.push(`${op.label}: 登録できるのは${op.category === 1 ? '固定Escと3件' : '3件'}までです`);
    const seen = new Set<string>();
    for (const binding of values) {
      if (!binding || typeof binding !== 'object') { errors.push(`${op.label}: 入力が不正です`); continue; }
      if (op.sequence) {
        if (binding.kind !== 'sequence' || typeof binding.sequence !== 'string' || !binding.sequence.length || /[\p{Cc}]/u.test(binding.sequence)) errors.push(`${op.label}: 空でない、制御文字を含まない文字列を入力してください`);
      } else if (binding.kind !== 'key' || !isKeyName(binding.key) || modifierKeys.has(binding.key)
        || !['ctrl', 'alt', 'meta', 'shift'].every(field => typeof (binding as unknown as Record<string, unknown>)[field] === 'boolean')
        || (binding.code !== undefined && (typeof binding.code !== 'string' || !/^Key[A-Z]$/.test(binding.code) || !binding.alt || binding.key !== binding.code.slice(3).toLowerCase()))) errors.push(`${op.label}: キーが不正です`);
      if (binding.kind === 'key') {
        const normalized = captureKey({ key: binding.key, code: binding.code, ctrlKey: binding.ctrl, altKey: binding.alt, metaKey: binding.meta, shiftKey: binding.shift });
        if (normalized && (normalized.key !== binding.key || normalized.shift !== binding.shift || normalized.code !== binding.code)) errors.push(`${op.label}: キーの形式が正規化されていません`);
      }
      if (binding.kind === 'key' && binding.key === 'Escape' && (op.category !== 1 || binding.ctrl || binding.alt || binding.meta || binding.shift || binding.code)) errors.push(`${op.label}: Escは固定の取消専用です`);
      const signature = binding.kind === 'sequence' ? binding.sequence : JSON.stringify([binding.key, binding.ctrl, binding.alt, binding.meta, binding.shift]);
      if (seen.has(signature)) errors.push(`${op.label}: 同じ入力が重複しています`);
      seen.add(signature);
    }
    if (op.category === 1 && !values.some(b => b?.kind === 'key' && b.key === 'Escape' && !b.ctrl && !b.alt && !b.meta && !b.shift && !b.code)) errors.push(`${op.label}: 固定Escが必要です`);
  }
  return errors;
}
export const SETTINGS_STORAGE_KEY = 'kiri-kyo-editor:keybindings:v1';
export function loadSettings(storage: Pick<Storage, 'getItem'>): string | undefined {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) { applySettings(defaultSettings()); return; }
    const parsed: unknown = JSON.parse(raw);
    const migrated = parsed && typeof parsed === 'object' && (parsed as BindingSettings).version === 1
      && (parsed as BindingSettings).bindings && typeof (parsed as BindingSettings).bindings === 'object'
      ? restoreFixedBindings(parsed as BindingSettings) : parsed;
    const errors = validateSettings(migrated);
    if (errors.length) throw new Error(errors.join(' / '));
    applySettings(migrated as BindingSettings);
  } catch (error) { applySettings(defaultSettings()); return `キーバインド設定を読み込めませんでした。保存データを保持して初期値を使用します: ${String(error)}`; }
}
export function saveSettings(storage: Pick<Storage, 'setItem'>, settings: BindingSettings): void {
  const normalized = restoreFixedBindings(settings);
  const errors = validateSettings(normalized);
  if (errors.length) throw new Error(errors.join('\n'));
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  applySettings(normalized);
}
export type InputContext = { mode: InputMode; buffer?: string };
export type Candidate = { operation: OperationId; source: 'key' | 'sequence'; buffer?: string; complete?: boolean; hasLonger?: boolean; restarted?: boolean };
export type Resolution = { candidates: Candidate[]; winner?: Candidate; interpretedAsNormal: boolean };
export function resolveInput(input: KeyboardInput, context: InputContext, settings = getSettings()): Resolution {
  if (isComposingInput(input)) return { candidates: [], interpretedAsNormal: false };
  if (context.mode === 'MARKER_SEQUENCE' && input.repeat && input.key && [...input.key].length === 1
    && !input.ctrlKey && !input.altKey && !input.metaKey) return { candidates: [], interpretedAsNormal: false };
  const allowed = OPERATIONS.filter(op => op.modes.includes(context.mode));
  const candidates: Candidate[] = allowed.filter(op => !op.sequence && settings.bindings[op.id].some(b => b.kind === 'key' && keyMatches(input, b)))
    .map(op => ({ operation: op.id, source: 'key' }));
  if (input.key && [...input.key].length === 1 && !input.ctrlKey && !input.altKey && !input.metaKey && (context.mode !== 'FORM' || !captureKey(input)?.shift)) {
    const sequences = allowed.filter(op => op.sequence).flatMap(op => settings.bindings[op.id]
      .filter((b): b is Extract<Binding, { kind: 'sequence' }> => b.kind === 'sequence').map(b => ({ ...b, operation: op.id })));
    const continuation = (context.mode === 'NORMAL' ? '' : context.buffer ?? '') + input.key;
    const canContinue = sequences.some(b => b.sequence.startsWith(continuation));
    if (context.mode === 'MARKER_SEQUENCE' && !canContinue) {
      if (candidates.length === 0) {
        const normal = resolveInput(input, { mode: 'NORMAL' }, settings);
        return { ...normal, interpretedAsNormal: true };
      }
      candidates.sort((a, b) => compareOperations(a.operation, b.operation));
      return { candidates, winner: candidates[0], interpretedAsNormal: false };
    }
    const buffer = canContinue ? continuation : input.key;
    const matches = sequences.filter(b => b.sequence.startsWith(buffer));
    const complete = matches.filter(b => b.sequence === buffer);
    // A prefix is a parsing state, not a competing execution. Keep all future
    // suffixes even when a shorter complete operation has already been applied.
    const choices = complete.length ? complete : matches;
    const unique = [...new Set(choices.map(b => b.operation))].sort(compareOperations);
    const ids = complete.length ? unique : unique.slice(0, 1);
    candidates.push(...ids.map(operation => ({ operation, source: 'sequence' as const, buffer,
      restarted: !!context.buffer && buffer !== continuation, complete: complete.length > 0, hasLonger: matches.some(b => b.sequence !== buffer) })));
  }
  candidates.sort((a, b) => compareOperations(a.operation, b.operation));
  return { candidates, winner: candidates[0], interpretedAsNormal: false };
}
export type BindingConflict = { mode: InputMode; buffer: string; input: string; operations: OperationId[]; winner: OperationId; affectedSequences: string[] };
export function findConflicts(settings: BindingSettings): BindingConflict[] {
  if (validateSettings(settings).length) return [];
  const conflicts: BindingConflict[] = [], seen = new Set<string>();
  for (const mode of INPUT_MODES) {
    const allowed = OPERATIONS.filter(op => op.modes.includes(mode));
    const sequences = allowed.filter(op => op.sequence).flatMap(op => settings.bindings[op.id].flatMap(b => b.kind === 'sequence' ? [b.sequence] : []));
    const buffers = new Set(['']);
    const inputs = new Map<string, KeyboardInput>();
    const remember = (input: KeyboardInput) => inputs.set(JSON.stringify(input), input);
    for (const sequence of sequences) {
      const chars = [...sequence]; let prefix = '';
      for (const char of chars) {
        if (mode === 'FORM' || mode === 'MARKER_SEQUENCE' && prefix
          && sequences.some(candidate => candidate !== prefix && candidate.startsWith(prefix))) buffers.add(prefix);
        remember({ key: char }); prefix += char;
      }
      if (mode === 'FORM') buffers.add(prefix);
    }
    for (const op of allowed) for (const b of settings.bindings[op.id]) if (b.kind === 'key') {
      remember({ key: b.key, code: b.code, ctrlKey: b.ctrl, altKey: b.alt, metaKey: b.meta, shiftKey: b.shift });
    }
    for (const buffer of buffers) for (const input of inputs.values()) {
      const result = resolveInput(input, { mode, buffer }, settings);
      if (mode === 'MARKER_SEQUENCE' && result.interpretedAsNormal) continue;
      const operations = [...new Set(result.candidates.map(c => c.operation))];
      if (operations.length < 2) continue;
      const label = bindingLabel(captureKey(input)!);
      const signature = JSON.stringify([mode, buffer, label, operations]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const sequenceCandidate = result.candidates.find(c => c.source === 'sequence');
      conflicts.push({ mode, buffer, input: label, operations, winner: result.winner!.operation,
        affectedSequences: sequenceCandidate ? [...new Set(sequences.filter(s => s.startsWith(sequenceCandidate.buffer!)))] : [] });
    }
  }
  return conflicts;
}

export function isRepeatedInput(input: KeyboardInput): boolean { return !!input.repeat; }
export function isModifierInput(input: KeyboardInput): boolean { return modifierKeys.has(input.key ?? ''); }
export function operationMatches(input: KeyboardInput, id: OperationId, settings = getSettings()): boolean {
  return settings.bindings[id].some(binding => binding.kind === 'key' && keyMatches(input, binding));
}

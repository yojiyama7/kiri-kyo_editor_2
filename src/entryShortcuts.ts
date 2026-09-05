import { resolveInput } from './keybindings.ts';
import { type KeyboardInput } from './keyboard.ts';
import { type KeyboardOperationId } from './keyboardOperations.ts';

type ShortcutEvent = KeyboardInput;
export type EntryShortcut = Extract<KeyboardOperationId,
  'entry.next' | 'entry.previous' | 'entry.reorderDown' | 'entry.reorderUp'>;
export type EntryInputMode = 'INSERT' | 'TRANSLATION' | 'PSEUDO_INPUT' | 'MARKER_INPUT' | 'MARKER_SEQUENCE' | 'FORM' | null;

export function entryShortcut(event: ShortcutEvent, inputMode: EntryInputMode): EntryShortcut | undefined {
  const mode = inputMode ?? 'NORMAL';
  const operation = resolveInput(event, { mode }).winner?.operation;
  return operation === 'entry.next' || operation === 'entry.previous' || operation === 'entry.reorderDown' || operation === 'entry.reorderUp' ? operation : undefined;
}

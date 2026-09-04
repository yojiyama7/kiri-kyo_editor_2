import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { resolveKeyboardOperation, type KeyboardOperationId } from './keyboardOperations.ts';

type ShortcutEvent = KeyboardInput;
export type EntryShortcut = Extract<KeyboardOperationId,
  'entry.next' | 'entry.previous' | 'entry.reorderDown' | 'entry.reorderUp'>;
export type EntryInputMode = 'INSERT' | 'TRANSLATION' | 'PSEUDO_INPUT' | 'MARKER_INPUT' | 'FORM' | null;

export function entryShortcut(event: ShortcutEvent, inputMode: EntryInputMode): EntryShortcut | undefined {
  if (inputMode === 'INSERT' || inputMode === 'PSEUDO_INPUT' || inputMode === 'MARKER_INPUT'
    || matchesKeyboardInput(event, [
      { isComposing: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
      { keyCode: 229, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
      { metaKey: true, ctrlKey: null, altKey: null, shiftKey: null, repeat: null, isComposing: null },
      { shiftKey: true, ctrlKey: null, altKey: null, metaKey: null, repeat: null, isComposing: null },
    ])) return;
  const movement = resolveKeyboardOperation(event, [
    { operation: 'entry.next', rules: [{ key: 'n', ctrlKey: true, repeat: null }] },
    { operation: 'entry.previous', rules: [{ key: 'p', ctrlKey: true, repeat: null }] },
  ]);
  if (movement) return movement;
  if (inputMode === null) {
    // Option may produce a different character on macOS; retain physical J/K.
    return resolveKeyboardOperation(event, [
      { operation: 'entry.reorderDown', rules: [
        { code: 'KeyJ', altKey: true, repeat: null },
        { key: 'j', altKey: true, repeat: null },
      ] },
      { operation: 'entry.reorderUp', rules: [
        { code: 'KeyK', altKey: true, repeat: null },
        { key: 'k', altKey: true, repeat: null },
      ] },
    ]);
  }
}

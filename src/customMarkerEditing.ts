import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { resolveKeyboardOperation, type KeyboardOperationId } from './keyboardOperations.ts';
import type { EditorSnapshot } from './history.ts';

export type CustomMarkerInputSession = {
  before: EditorSnapshot;
  slotId: string;
  text: string;
  composing: boolean;
};

export function customMarkerInputAction(event: KeyboardInput, composing: boolean):
  Extract<KeyboardOperationId, 'marker.customCommit' | 'editor.cancel'> | undefined {
  const ctrlBracket = matchesKeyboardInput(event, [{ key: '[', ctrlKey: true }]);
  if (composing || matchesKeyboardInput(event, [
    { isComposing: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
    { keyCode: 229, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    { metaKey: true, ctrlKey: null, altKey: null, shiftKey: null, repeat: null, isComposing: null },
    { altKey: true, ctrlKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    { shiftKey: true, ctrlKey: null, altKey: null, metaKey: null, repeat: null, isComposing: null },
    { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
  ]) || (matchesKeyboardInput(event, [
    { ctrlKey: true, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
  ]) && !ctrlBracket)) return;
  return resolveKeyboardOperation(event, [
    { operation: 'marker.customCommit', rules: [{ key: 'Enter' }] },
    { operation: 'editor.cancel', rules: [{ key: 'Escape' }, { key: '[', ctrlKey: true }] },
  ]);
}

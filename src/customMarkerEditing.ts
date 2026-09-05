import { resolveInput, isComposingInput, isRepeatedInput } from './keybindings.ts';
import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { type KeyboardOperationId } from './keyboardOperations.ts';
import type { EditorSnapshot } from './history.ts';

export type CustomMarkerInputSession = {
  before: EditorSnapshot;
  slotId: string;
  text: string;
  composing: boolean;
};

export function customMarkerInputAction(event: KeyboardInput, composing: boolean):
  Extract<KeyboardOperationId, 'marker.customCommit' | 'editor.cancel'> | undefined {
  if (composing || isComposingInput(event) || isRepeatedInput(event)) return;
  const operation = resolveInput(event, { mode: 'MARKER_INPUT' }).winner?.operation;
  return operation === 'marker.customCommit' || operation === 'editor.cancel' ? operation : undefined;
}

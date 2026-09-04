import { matchesKeyboardInput, type KeyboardInput, type KeyboardInputRule } from './keyboard.ts';

export const KEYBOARD_OPERATION_IDS = [
  'entry.next', 'entry.previous', 'entry.reorderDown', 'entry.reorderUp',
  'editor.cancel', 'history.undo', 'history.redo',
  'cursor.left', 'cursor.right', 'cursor.down', 'cursor.up', 'cursor.rowStart', 'cursor.rowEnd',
  'form.start', 'form.clear', 'form.commit', 'form.eraseInput',
  'border.start', 'pseudo.start', 'pseudo.commit', 'marker.customStart', 'marker.customCommit',
  'bracket.insertSquareOpen', 'bracket.insertSquareClose',
  'bracket.insertRoundOpen', 'bracket.insertRoundClose',
  'bracket.insertAngleOpen', 'bracket.insertAngleClose',
  'bracket.deleteBefore', 'bracket.deleteAfter',
  'arrow.start', 'arrow.delete', 'arrow.commit',
  'split.t', 'split.d', 'marker.clear',
  'selection.toggle', 'selection.commit',
  'english.start', 'translation.start', 'structure.delete',
  'dialog.cancel', 'focus.next', 'focus.previous', 'translation.blockTab',
] as const;

export type KeyboardOperationId = typeof KEYBOARD_OPERATION_IDS[number];
const KEYBOARD_OPERATION_ID_SET = new Set<string>(KEYBOARD_OPERATION_IDS);

export function isKeyboardOperationId(value: unknown): value is KeyboardOperationId {
  return typeof value === 'string' && KEYBOARD_OPERATION_ID_SET.has(value);
}

export type KeyboardOperationBinding<Operation extends KeyboardOperationId = KeyboardOperationId> = {
  operation: Operation;
  rules: readonly KeyboardInputRule[];
};

export function resolveKeyboardOperation<Operation extends KeyboardOperationId>(input: KeyboardInput,
  bindings: readonly KeyboardOperationBinding<Operation>[]): Operation | undefined {
  return bindings.find((binding) => matchesKeyboardInput(input, binding.rules))?.operation;
}

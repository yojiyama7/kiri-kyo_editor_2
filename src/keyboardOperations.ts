import { compareOperations, type OperationId } from './keybindings.ts';
import { matchesKeyboardInput, type KeyboardInput, type KeyboardInputRule } from './keyboard.ts';

export { KEYBOARD_OPERATION_IDS, isKeyboardOperationId, type KeyboardOperationId } from './operationIds.ts';
import type { KeyboardOperationId } from './operationIds.ts';
export type KeyboardOperationBinding<Operation extends KeyboardOperationId = KeyboardOperationId> = {
  operation: Operation;
  rules: readonly KeyboardInputRule[];
};

export function resolveKeyboardOperation<Operation extends KeyboardOperationId>(input: KeyboardInput,
  bindings: readonly KeyboardOperationBinding<Operation>[]): Operation | undefined {
  return bindings.filter((binding) => matchesKeyboardInput(input, binding.rules))
    .sort((a, b) => a.operation === b.operation ? 0 : a.operation === 'translation.blockTab' ? 1 : b.operation === 'translation.blockTab' ? -1 : compareOperations(a.operation as OperationId, b.operation as OperationId))[0]?.operation;
}

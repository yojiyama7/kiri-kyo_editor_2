import { bindingLabel, getSettings } from './keybindings.ts';
import type { FormId, MarkerId } from './inputIds.ts';
import type { KeyboardOperationId } from './keyboardOperations.ts';

export type InputSequenceBinding<ValueId extends string> = {
  sequence: string;
  value: ValueId;
};

export const DEFAULT_MARKER_INPUT_BINDINGS = [
  { sequence: 's', value: 'marker.subject' },
  { sequence: 'ps', value: 'marker.provisionalSubject' },
  { sequence: 'as', value: 'marker.trueSubject' },
  { sequence: "s'", value: 'marker.subjectPrime' },
  { sequence: 'sad', value: 'marker.sentenceAdverb' },
  { sequence: 'V', value: 'marker.verb' },
  { sequence: '1', value: 'marker.number1' },
  { sequence: '2', value: 'marker.number2' },
  { sequence: '3', value: 'marker.number3' },
  { sequence: '4', value: 'marker.number4' },
  { sequence: '5', value: 'marker.number5' },
  { sequence: '-3', value: 'marker.negativeNumber3' },
  { sequence: '-4', value: 'marker.negativeNumber4' },
  { sequence: '-5', value: 'marker.negativeNumber5' },
  { sequence: '+', value: 'marker.plus' },
  { sequence: 'a', value: 'marker.adjective' },
  { sequence: 'aux', value: 'marker.auxiliary' },
  { sequence: 'ad', value: 'marker.adverb' },
  { sequence: 'ado', value: 'marker.adverbialObjective' },
  { sequence: 'ac', value: 'marker.adjectiveComplement' },
  { sequence: 'n', value: 'marker.noun' },
  { sequence: 'nad', value: 'marker.introductoryAdverb' },
  { sequence: 'nc', value: 'marker.nounComplement' },
  { sequence: 'nC', value: 'marker.nounComplement' },
  { sequence: 'pre', value: 'marker.preposition' },
  { sequence: 'con', value: 'marker.conjunction' },
  { sequence: 'o', value: 'marker.object' },
  { sequence: 'o1', value: 'marker.object1' },
  { sequence: 'o2', value: 'marker.object2' },
] as const satisfies readonly InputSequenceBinding<MarkerId>[];

export const DEFAULT_FORM_INPUT_BINDINGS = [
  { sequence: 'b', value: 'form.base' },
  { sequence: 'c', value: 'form.present' },
  { sequence: 'p', value: 'form.past' },
  { sequence: 'pp', value: 'form.pastParticiple' },
  { sequence: 'ing', value: 'form.ing' },
] as const satisfies readonly InputSequenceBinding<FormId>[];

// These operations keep their defaults and stay out of the settings UI.
// Removing an ID here makes that operation configurable again with its default intact.
export const FIXED_OPERATION_IDS = ['focus.next', 'focus.previous'] as const satisfies readonly KeyboardOperationId[];

export const DEFAULT_OPERATION_KEY_LABELS: Partial<Record<KeyboardOperationId, readonly string[]>> = {
  'entry.next': ['Ctrl+n'], 'entry.previous': ['Ctrl+p'],
  'entry.reorderDown': ['Alt+j'], 'entry.reorderUp': ['Alt+k'],
  'editor.cancel': ['Esc', 'Ctrl+['], 'history.undo': ['u'], 'history.redo': ['Ctrl+r'],
  'cursor.left': ['h', '←'], 'cursor.right': ['l', '→'], 'cursor.down': ['j', '↓'], 'cursor.up': ['k', '↑'],
  'cursor.rowStart': ['0', 'Home'], 'cursor.rowEnd': ['$', 'End'],
  'form.start': ['f'], 'form.clear': ['x'], 'form.commit': ['Enter'], 'form.eraseInput': ['Backspace'],
  'border.start': ['b'], 'pseudo.start': ['/'], 'pseudo.commit': ['Enter'],
  'marker.start': ['m'],
  'marker.customStart': ['/'], 'marker.customCommit': ['Enter'],
  'bracket.insertSquareOpen': ['['], 'bracket.insertSquareClose': [']'],
  'bracket.insertRoundOpen': ['('], 'bracket.insertRoundClose': [')'],
  'bracket.insertAngleOpen': ['<'], 'bracket.insertAngleClose': ['>'],
  'bracket.deleteBefore': ['Backspace'], 'bracket.deleteAfter': ['Delete'],
  'arrow.start': ['r'], 'arrow.delete': ['Shift+r'], 'arrow.commit': ['Enter'],
  'split.t': ['t'], 'split.d': ['d'], 'marker.clear': ['x'],
  'selection.toggle': ['v'], 'selection.commit': ['Enter'],
  'english.start': ['i'], 'translation.start': ['Tab'], 'structure.delete': ['X'],
  'dialog.cancel': ['Esc', 'Ctrl+['], 'focus.next': ['Tab'], 'focus.previous': ['Shift+Tab'],
  'translation.blockTab': ['Tab'], 'translation.commit': ['Enter'],
};

export function operationKeyLabels(operation: KeyboardOperationId): readonly string[] {
  return operation === 'translation.blockTab' ? ['Tab'] : getSettings().bindings[operation].map(bindingLabel);
}

export function operationKeyLabel(operation: KeyboardOperationId, separator = ' / '): string {
  return operationKeyLabels(operation).join(separator) || '未割り当て';
}

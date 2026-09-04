import { FORM_LABELS, isBasicToken, isFormId, type FormId, type SavedState } from './model.ts';
import type { EditorSnapshot } from './history.ts';
import { DEFAULT_FORM_INPUT_BINDINGS, type InputSequenceBinding } from './inputConfig.ts';
import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { resolveKeyboardOperation } from './keyboardOperations.ts';

export type FormSession = { slotId: string; tokenId?: string; before: EditorSnapshot; buffer: string };
export type FormTarget = { slotId: string; ownerSlotId: string; tokenId?: string; label: string; form?: FormId };

export function formTargets(document: SavedState): FormTarget[] {
  const owners = [
    ...document.tokens.filter(isBasicToken).map(token => ({ ...token, tokenId: token.id, label: token.text })),
    ...document.groups.filter(group => group.kind === 'basic' || document.splits.some(split => split.slotId === group.slotId && split.kind === 'd'))
      .map(group => ({ ...group, tokenId: undefined, label: group.kind === 'basic' ? '基礎下線' : '複合下線' })),
  ];
  return owners.flatMap(owner => {
    const split = document.splits.find(split => split.slotId === owner.slotId);
    const base = { ownerSlotId: owner.slotId, tokenId: owner.tokenId, label: owner.label };
    return split?.kind === 'd' ? [
      { ...base, slotId: split.leftSlotId, form: split.leftForm ?? owner.form, label: `${owner.label} 左` },
      { ...base, slotId: split.rightSlotId, form: split.rightForm, label: `${owner.label} 右` },
    ] : [{ ...base, slotId: owner.slotId, form: owner.form }];
  });
}

export function formTargetAtSlot(document: SavedState, slotId: string | undefined): FormTarget | undefined {
  if (!slotId) return undefined;
  const split = document.splits.find(split => split.leftSlotId === slotId || split.rightSlotId === slotId);
  const targetId = split && split.kind !== 'd' ? split.slotId : slotId;
  return formTargets(document).find(target => target.slotId === targetId);
}

export function ownerForm(document: SavedState, slotId: string): FormId | undefined {
  return document.tokens.filter(isBasicToken).find(token => token.slotId === slotId)?.form
    ?? document.groups.find(group => group.slotId === slotId)?.form;
}

// Structural operations may preserve a basic group's form while it is opened
// as a composite. Eligibility for editing is handled by formTargetAtSlot.
export function setOwnerForm(document: SavedState, slotId: string, form?: FormId): SavedState {
  const token = document.tokens.find(token => token.slotId === slotId);
  if (token) return setTokenForm(document, token.id, form);
  const group = document.groups.find(group => group.slotId === slotId);
  if (!group || group.form === form) return document;
  return { ...document, groups: document.groups.map(candidate => {
    if (candidate.id !== group.id) return candidate;
    const { form: _old, ...rest } = candidate;
    return form === undefined ? rest : { ...rest, form };
  }) };
}

export function normalizeDForms(document: SavedState): SavedState {
  for (const split of document.splits) {
    const form = ownerForm(document, split.slotId);
    if (split.kind !== 'd' || form === undefined) continue;
    document = setOwnerForm(document, split.slotId);
    document = { ...document, splits: document.splits.map(candidate => candidate.slotId === split.slotId
      ? { ...candidate, leftForm: candidate.leftForm ?? form } : candidate) };
  }
  return document;
}

export function setFormAtSlot(document: SavedState, slotId: string, form?: FormId): SavedState {
  const target = formTargetAtSlot(document, slotId);
  if (!target) return document;
  document = normalizeDForms(document);
  if (target.slotId === target.ownerSlotId) return setOwnerForm(document, target.slotId, form);
  const split = document.splits.find(split => split.slotId === target.ownerSlotId)!;
  const field = split.leftSlotId === target.slotId ? 'leftForm' : 'rightForm';
  if (split[field] === form) return document;
  return { ...document, splits: document.splits.map(candidate => {
    if (candidate.slotId !== split.slotId) return candidate;
    const next = { ...candidate };
    if (form === undefined) delete next[field];
    else next[field] = form;
    return next;
  }) };
}

export function setTokenForm(document: SavedState, tokenId: string, form?: FormId): SavedState {
  const target = document.tokens.find((token) => token.id === tokenId);
  if (!target || !isBasicToken(target) || target.form === form) return document;
  return { ...document, tokens: document.tokens.map((token) => {
    if (token.id !== tokenId || !isBasicToken(token)) return token;
    const { form: _oldForm, ...rest } = token;
    return form === undefined ? rest : { ...rest, form };
  }) };
}

// No timeout: p stays editable until Enter so a second p can select p.p.
export function formIdForInput(buffer: string,
  bindings: readonly InputSequenceBinding<FormId>[] = DEFAULT_FORM_INPUT_BINDINGS): FormId | undefined {
  return bindings.find(binding => binding.sequence === buffer)?.value;
}

export function nextFormInput(buffer: string, input: KeyboardInput,
  bindings: readonly InputSequenceBinding<FormId>[] = DEFAULT_FORM_INPUT_BINDINGS): { buffer: string; form?: FormId } {
  if (resolveKeyboardOperation(input, [
    { operation: 'form.eraseInput', rules: [{ key: 'Backspace' }] },
  ]) === 'form.eraseInput') {
    const next = buffer.slice(0, -1);
    return { buffer: next, form: formIdForInput(next, bindings) };
  }
  if (!matchesKeyboardInput(input, [{ keyLength: 1 }])) return { buffer, form: formIdForInput(buffer, bindings) };
  const key = input.key ?? '';
  const isPrefix = (value: string) => bindings.some(binding => binding.sequence.startsWith(value));
  const next = isPrefix(buffer + key) ? buffer + key : isPrefix(key) ? key : buffer;
  return { buffer: next, form: formIdForInput(next, bindings) };
}

export function nextFormBuffer(buffer: string, input: KeyboardInput,
  bindings: readonly InputSequenceBinding<FormId>[] = DEFAULT_FORM_INPUT_BINDINGS): string {
  return nextFormInput(buffer, input, bindings).buffer;
}

export function formDisplay(target: { slotId?: string; form?: FormId }, session: FormSession | null): string {
  const buffer = session?.slotId === target.slotId ? session?.buffer ?? '' : '';
  const bufferedForm = formIdForInput(buffer);
  return buffer ? bufferedForm ? FORM_LABELS[bufferedForm] : buffer
    : target.form === undefined ? '' : FORM_LABELS[target.form];
}

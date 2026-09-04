import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { resolveKeyboardOperation, type KeyboardOperationId } from './keyboardOperations.ts';
import { isSavedState, type PseudoToken, type SavedState, type Token } from './model.ts';
import { removeSlotsAndDependents } from './structureDeletion.ts';
import type { EditorSnapshot } from './history.ts';

export type PseudoInputSession = {
  before: EditorSnapshot;
  text: string;
  composing: boolean;
} & ({ kind: 'create'; borderIndex: number; token: PseudoToken }
  | { kind: 'edit'; tokenId: string });

export function realSentence(tokens: readonly Token[]): string {
  return tokens.filter((token) => token.kind === undefined || token.kind === 'real').map((token) => token.text).join(' ');
}

export function replaceEnglishSentence(document: SavedState, draft: string, createId: () => string = () => crypto.randomUUID()): SavedState {
  const words = draft.trim() ? draft.trim().split(/\s+/) : [];
  if (words.join(' ') === realSentence(document.tokens)) return document;
  const tokens = words.map((text) => ({ id: createId(), slotId: createId(), text, kind: 'real' as const }));
  return { ...document, tokens, slots: tokens.map((token) => ({ id: token.slotId })), groups: [], splits: [], arrows: [] };
}

// Only the token's own slot or its own T/D children are edit targets. A group
// over a pseudo token must retain the normal whole-sentence editing command.
export function pseudoTokenAtSlot(document: SavedState, slotId: string | undefined): PseudoToken | undefined {
  if (!slotId) return undefined;
  const source = document.splits.find((split) => split.leftSlotId === slotId || split.rightSlotId === slotId)?.slotId ?? slotId;
  return document.tokens.find((token): token is PseudoToken => token.kind === 'pseudo' && token.slotId === source);
}

export function splitPseudoInput(text: string): string[] {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

export function insertPseudoTokens(document: SavedState, index: number, tokens: readonly PseudoToken[]):
  { ok: true; document: SavedState } | { ok: false; message: string } {
  if (!Number.isInteger(index) || index < 0 || index > document.tokens.length
    || tokens.length === 0 || tokens.some((token) => token.text === '')) {
    return { ok: false, message: '疑似トークンの挿入位置または文字が不正です。' };
  }
  const next: SavedState = { ...document,
    tokens: [...document.tokens.slice(0, index), ...tokens, ...document.tokens.slice(index)],
    slots: [...document.slots, ...tokens.map((token) => ({ id: token.slotId }))],
  };
  // Existing memberships stay unchanged. Inserting a gap into a split source
  // (including indirect sources) is rejected before opening the input field.
  if (!isSavedState(next)) return { ok: false,
    message: 'この境目には挿入できません。T/D分割元の連続性など、既存の構造を維持できなくなります。' };
  return { ok: true, document: next };
}

export function insertPseudoToken(document: SavedState, index: number, token: PseudoToken):
  { ok: true; document: SavedState } | { ok: false; message: string } {
  return insertPseudoTokens(document, index, [token]);
}

export function deletePseudoToken(document: SavedState, tokenId: string): SavedState {
  const token = document.tokens.find((token): token is PseudoToken => token.id === tokenId && token.kind === 'pseudo');
  if (!token) return document;
  const next = removeSlotsAndDependents(document, [token.slotId]);
  return { ...next, tokens: next.tokens.filter((candidate) => candidate.id !== tokenId) };
}

export function editPseudoToken(document: SavedState, tokenId: string, text: string): SavedState {
  const token = document.tokens.find((token): token is PseudoToken => token.id === tokenId && token.kind === 'pseudo');
  if (!token || token.text === text) return document;
  if (text !== '') return { ...document, tokens: document.tokens.map((candidate) =>
    candidate.id === tokenId && candidate.kind === 'pseudo' ? { ...candidate, text } : candidate) };
  return deletePseudoToken(document, tokenId);
}

type InputKey = KeyboardInput;
export function pseudoInputAction(event: InputKey, composing: boolean):
  Extract<KeyboardOperationId, 'pseudo.commit' | 'editor.cancel'> | undefined {
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
    { operation: 'pseudo.commit', rules: [{ key: 'Enter' }] },
    { operation: 'editor.cancel', rules: [{ key: 'Escape' }, { key: '[', ctrlKey: true }] },
  ]);
}

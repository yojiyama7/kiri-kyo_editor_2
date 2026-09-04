import { isBasicToken, isBracket, isSavedState, type BracketToken, type BracketText, type SavedState, type Token } from './model.ts';
import { regionAt, type Cursor, type DiagramLayout } from './layout.ts';
import { removeSlotsAndDependents } from './structureDeletion.ts';

export function bracketBorderFromRegion(tokens: readonly Token[], layout: DiagramLayout, cursor: Cursor, text: BracketText):
  { ok: true; index: number } | { ok: false; message: string } {
  const region = regionAt(layout, cursor.x, cursor.y);
  if (!region) return { ok: false, message: '括弧を追加する対象の region が選択されていません。' };
  const left = text === '[' || text === '(' || text === '<';
  const atom = layout.atoms[left ? region.start : region.end - 1];
  const token = atom && tokens[atom.tokenIndex];
  const side = left ? '左端' : '右端';
  if (!token || !isBasicToken(token)) {
    return { ok: false, message: `region の${side}が基礎スロットではないため、括弧を追加できません。` };
  }
  const range = layout.tokenRanges[atom.tokenIndex];
  if (left ? region.start !== range.start : region.end !== range.end) {
    return { ok: false, message: `region の${side}がトークンの途中にあるため、括弧を追加できません。` };
  }
  return { ok: true, index: atom.tokenIndex + (left ? 0 : 1) };
}

export function insertBracket(document: SavedState, index: number, text: BracketText,
  createId: () => string = () => crypto.randomUUID()):
  { ok: true; document: SavedState } | { ok: false; message: string } {
  if (!Number.isInteger(index) || index < 0 || index > document.tokens.length) {
    return { ok: false, message: '括弧の挿入位置が不正です。' };
  }
  const token: BracketToken = text === '['
    ? { id: createId(), kind: 'bracket-open', text, slotId: createId() }
    : text === ']' ? { id: createId(), kind: 'bracket-close', text }
    : text === '(' ? { id: createId(), kind: 'paren-open', text, slotId: createId() }
    : text === ')' ? { id: createId(), kind: 'paren-close', text }
    : text === '<' ? { id: createId(), kind: 'angle-open', text, slotId: createId() }
    : { id: createId(), kind: 'angle-close', text };
  const next: SavedState = { ...document,
    tokens: [...document.tokens.slice(0, index), token, ...document.tokens.slice(index)],
    slots: token.slotId === undefined ? document.slots : [...document.slots, { id: token.slotId }],
  };
  return isSavedState(next) ? { ok: true, document: next } : { ok: false,
    message: 'この境目には挿入できません。T/D分割元の連続性など、既存の構造を維持できなくなります。' };
}

export function deleteBracket(document: SavedState, index: number): SavedState {
  const token = document.tokens[index];
  if (!token || !isBracket(token)) return document;
  const next = token.slotId === undefined ? document : removeSlotsAndDependents(document, [token.slotId]);
  return { ...next, tokens: next.tokens.filter((candidate) => candidate.id !== token.id) };
}

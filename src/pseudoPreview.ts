import type { SavedState, Token } from './model.ts';
import type { PseudoInputSession } from './pseudoEditing.ts';

// Display-only: empty text is retained, never interpreted as deletion. This
// document is for geometry and measurement, not persistence or history.
export function pseudoPreview(document: SavedState, session: PseudoInputSession | null):
  { document: SavedState; inputTokenId?: string } {
  if (!session) return { document };
  if (session.kind === 'create') {
    const token = { ...session.token, text: session.text };
    return { inputTokenId: token.id, document: { ...document,
      tokens: [...document.tokens.slice(0, session.borderIndex), token, ...document.tokens.slice(session.borderIndex)],
      slots: [...document.slots, { id: token.slotId }],
    } };
  }
  return { inputTokenId: session.tokenId, document: { ...document,
    tokens: document.tokens.map((token) => token.id === session.tokenId && token.kind === 'pseudo' ? { ...token, text: session.text } : token),
  } };
}

export function widthsByToken(tokens: readonly Token[], measured: ReadonlyMap<string, number>): number[] {
  return tokens.map((token) => measured.get(token.id) ?? 1);
}

// The anchor is centered in the actual token column, which can be wider than
// the input when markers/split labels need extra room. Scroll offsets keep the
// overlay in the diagram's content coordinates rather than viewport coordinates.
export function inputOverlayOffset(anchor: { left: number; top: number }, diagram: { left: number; top: number },
  scrollLeft: number, scrollTop: number, clientLeft = 0, clientTop = 0) {
  return { left: anchor.left - diagram.left + scrollLeft - clientLeft,
    top: anchor.top - diagram.top + scrollTop - clientTop };
}

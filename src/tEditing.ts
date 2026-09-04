import { isBasicToken, type SavedState, type SlotSplit } from './model.ts';
import { getSlotRanges } from './slotGeometry.ts';
import { setSlotMarker } from './markers.ts';
import { removeSlotsAndDependents } from './structureDeletion.ts';
import { normalizeDForms, ownerForm, setOwnerForm } from './formEditing.ts';

export function canSplit(document: SavedState, slotId: string, kind: 't' | 'd' = 't'): boolean {
  if (document.splits?.some((split) => [split.slotId, split.leftSlotId, split.rightSlotId].includes(slotId))) return false;
  if (!document.tokens.some((token) => isBasicToken(token) && token.slotId === slotId)
    && !document.groups.some((group) => group.slotId === slotId && (kind === 'd' || group.kind === 'basic'))) return false;
  return getSlotRanges(document.tokens, document.groups, document.splits).get(slotId)?.length === 1;
}

export function splitSlot(document: SavedState, slotId: string, kind: 't' | 'd' = 't'): SavedState {
  if (!canSplit(document, slotId, kind)) return document;
  const split: SlotSplit = { slotId, leftSlotId: crypto.randomUUID(), rightSlotId: crypto.randomUUID(),
    ...(kind === 'd' ? { kind } : {}) };
  if (kind === 'd') {
    const form = ownerForm(document, slotId);
    if (form !== undefined) split.leftForm = form;
    document = setOwnerForm(document, slotId);
  }
  const marker = document.slots.find((slot) => slot.id === slotId)?.marker;
  return { ...document,
    arrows: document.arrows.map((arrow) => ({ ...arrow,
      sourceSlotId: arrow.sourceSlotId === slotId ? split.leftSlotId : arrow.sourceSlotId,
      targetSlotId: arrow.kind === 'apposition' && arrow.targetSlotId === slotId ? split.leftSlotId : arrow.targetSlotId,
    })),
    splits: [...(document.splits ?? []), split],
    slots: [...setSlotMarker(document.slots, slotId),
      { id: split.leftSlotId, ...(marker === undefined ? {} : { marker }) }, { id: split.rightSlotId }],
  };
}

export function unsplitSlot(document: SavedState, slotId: string): SavedState {
  if (!document.splits.some(split => [split.slotId, split.leftSlotId, split.rightSlotId].includes(slotId))) return document;
  document = normalizeDForms(document);
  const split = document.splits?.find((split) => [split.slotId, split.leftSlotId, split.rightSlotId].includes(slotId));
  if (!split) return document;
  const marker = document.slots.find((slot) => slot.id === split.leftSlotId)?.marker;
  let next = removeSlotsAndDependents(document, [split.leftSlotId, split.rightSlotId]);
  if (split.kind === 'd') next = setOwnerForm(next, split.slotId, split.leftForm);
  return { ...next,
    slots: setSlotMarker(next.slots, split.slotId, marker),
  };
}

import { effectiveSlotMarker, isArrowMarker, isAppositionMarker, isAppositionEndpoint, type Arrow, type SavedState } from './model.ts';

export function connectArrow(document: SavedState, sourceSlotId: string, targetSlotId: string): SavedState {
  if (sourceSlotId === targetSlotId || !document.slots.some((slot) => slot.id === targetSlotId)
    || !isArrowMarker(effectiveSlotMarker(document, sourceSlotId))) return document;
  const existing = document.arrows.find((arrow) => arrow.kind !== 'apposition' && arrow.sourceSlotId === sourceSlotId);
  if (existing?.targetSlotId === targetSlotId) return document;
  const arrow = { sourceSlotId, targetSlotId };
  return { ...document, arrows: existing
    ? document.arrows.map((item) => item === existing ? arrow : item)
    : [...document.arrows, arrow] };
}

export function connectApposition(document: SavedState, sourceSlotId: string, targetSlotId: string): SavedState {
  const source = document.slots.find((slot) => slot.id === sourceSlotId);
  const target = document.slots.find((slot) => slot.id === targetSlotId);
  if (!source || !target || sourceSlotId === targetSlotId
    || !isAppositionMarker(effectiveSlotMarker(document, sourceSlotId))
    || !isAppositionEndpoint(effectiveSlotMarker(document, targetSlotId))) return document;
  const touches = (arrow: Arrow, id: string) => arrow.sourceSlotId === id || arrow.targetSlotId === id;
  const existing = document.arrows.find((arrow) => arrow.kind === 'apposition' && touches(arrow, sourceSlotId));
  if (existing && touches(existing, targetSlotId)) return document;
  const arrow: Arrow = { kind: 'apposition', sourceSlotId, targetSlotId };
  // Preserve the edited connection's order, while removing the other end's old partner atomically.
  const arrows = document.arrows.flatMap((item) => {
    if (item === existing) return [arrow];
    return item.kind === 'apposition' && touches(item, targetSlotId) ? [] : [item];
  });
  if (!existing) arrows.push(arrow);
  return { ...document, arrows };
}

export function deleteArrow(document: SavedState, sourceSlotId: string): SavedState {
  const arrows = document.arrows.filter((arrow) => arrow.sourceSlotId !== sourceSlotId
    && !(arrow.kind === 'apposition' && arrow.targetSlotId === sourceSlotId));
  return arrows.length === document.arrows.length ? document : { ...document, arrows };
}

// Call at the marker transaction boundary, not between characters of e.g. sad.
export function pruneArrows(document: SavedState): SavedState {
  const slots = new Map(document.slots.map((slot) => [slot.id, slot]));
  const arrows = document.arrows.filter((arrow) => slots.has(arrow.sourceSlotId) && slots.has(arrow.targetSlotId)
    && (arrow.kind === 'apposition'
      ? [arrow.sourceSlotId, arrow.targetSlotId].every((id) => isAppositionEndpoint(effectiveSlotMarker(document, id)))
      : isArrowMarker(effectiveSlotMarker(document, arrow.sourceSlotId))));
  return arrows.length === document.arrows.length ? document : { ...document, arrows };
}

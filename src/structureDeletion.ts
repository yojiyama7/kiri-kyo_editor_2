import type { SavedState } from './model.ts';

// Roots are slots owned by removed structures (Group slots or T children).
// Follow consumers and ownership, never the surviving inputs of a structure.
export function removeSlotsAndDependents(document: SavedState, slotIds: readonly string[]): SavedState {
  const existing = new Set(document.slots.map((slot) => slot.id));
  const removed = new Set(slotIds.filter((id) => existing.has(id)));
  if (!removed.size) return document;

  let size = -1;
  while (size !== removed.size) {
    size = removed.size;
    for (const group of document.groups) {
      if (group.slots.some((id) => removed.has(id))) removed.add(group.slotId);
    }
    for (const split of document.splits) {
      if ([split.slotId, split.leftSlotId, split.rightSlotId].some((id) => removed.has(id))) {
        removed.add(split.leftSlotId);
        removed.add(split.rightSlotId);
      }
    }
  }

  return { ...document,
    arrows: document.arrows.filter((arrow) => !removed.has(arrow.sourceSlotId) && !removed.has(arrow.targetSlotId)),
    slots: document.slots.filter((slot) => !removed.has(slot.id)),
    groups: document.groups.filter((group) => !removed.has(group.slotId)),
    splits: document.splits.filter((split) => !removed.has(split.leftSlotId)),
  };
}

export function deleteGroup(document: SavedState, groupId: string): SavedState {
  const target = document.groups.find((group) => group.id === groupId);
  return target ? removeSlotsAndDependents(document, [target.slotId]) : document;
}

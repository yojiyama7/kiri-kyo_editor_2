import { hasBasicContents, readSavedState, type SavedState, type Group } from './model.ts';
import { normalizeDForms } from './formEditing.ts';
import { computeLayout, containsX, groupAt, moveVertical, relocateCursor, type Cursor, type DiagramLayout } from './layout.ts';

export type GroupEditResult = { document: SavedState; cursor: Cursor; anchor: Cursor | null };

// Preserve the destination slot when a kind change moves it to another row.
function relocate(before: DiagramLayout, after: DiagramLayout, cursor: Cursor): Cursor {
  return relocateCursor(before, after, cursor);
}

export function enterBasicGroup(document: SavedState, cursor: Cursor): GroupEditResult {
  const layout = computeLayout(document.tokens, document.groups, document.splits, document.arrows);
  const current = groupAt(layout, cursor.x, cursor.y);
  if (current?.group.kind === 'basic' && document.splits?.some((split) => split.slotId === current.group.slotId)) {
    return { document, cursor, anchor: null };
  }
  if (current?.group.kind !== 'basic') {
    return { document, cursor: moveVertical(layout, cursor, -1), anchor: null };
  }
  const groups = document.groups.map((group): Group => group.id === current.group.id
    ? { ...group, kind: 'composite' } : group);
  const next = computeLayout(document.tokens, groups, document.splits, document.arrows);
  const origin = { x: cursor.x, y: next.slotY.get(current.group.slotId)! };
  return { document: { ...document, groups }, cursor: moveVertical(next, origin, -1), anchor: null };
}

export function settleBasicGroups(
  document: SavedState,
  cursor: Cursor,
  anchor: Cursor | null = null,
  closeAll = false,
): GroupEditResult {
  // Each pass converts at least one composite; reflow can make others eligible.
  for (;;) {
    const layout = computeLayout(document.tokens, document.groups, document.splits, document.arrows);
    const finished = new Set(layout.groups.filter((placement) =>
      placement.group.kind === 'composite'
        && hasBasicContents(document.tokens, document.slots, placement.group.slots, document.splits)
        && (closeAll || !(cursor.y < placement.y
        && containsX(layout, placement.group.slotId, cursor.x))),
    ).map(({ group }) => group.id));
    if (!finished.size) return { document, cursor, anchor };
    const groups = document.groups.map((group): Group => finished.has(group.id)
      ? { ...group, kind: 'basic' } : group);
    const next = computeLayout(document.tokens, groups, document.splits, document.arrows);
    cursor = relocate(layout, next, cursor);
    if (anchor) anchor = relocate(layout, next, anchor);
    document = { ...document, groups };
  }
}

export function readSavedDocument(value: unknown): SavedState | undefined {
  const saved = readSavedState(value);
  if (!saved) return undefined;
  // Normalize editable groups after upgrading supported saved documents.
  const groups = saved.groups.map(({ id, slotId, slots, kind, form }) => ({ id, slotId, slots, kind, ...(form === undefined ? {} : { form }) }));
  return settleBasicGroups(normalizeDForms({ ...saved, groups }), { x: 0, y: 0 }, null, true).document;
}

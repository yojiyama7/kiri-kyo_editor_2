import { hasBasicContents, readSavedState, type SavedState, type Group } from './model.ts';
import { computeLayout, containsX, groupAt, moveVertical, relocateCursor, type Cursor, type DiagramLayout } from './layout.ts';

export type GroupEditResult = { cursor: Cursor; anchor: Cursor | null; openedGroupIds: Set<string> };

export function reclassifyGroups(document: SavedState): SavedState {
  let changed = false;
  const groups = document.groups.map((group): Group => {
    const kind = hasBasicContents(document.tokens, document.slots, group.slots, document.splits) ? 'basic' : 'composite';
    if (kind === group.kind) return group;
    changed = true;
    return { ...group, kind };
  });
  return changed ? { ...document, groups } : document;
}

export function groupsForEditing(groups: readonly Group[], openedGroupIds: ReadonlySet<string>): Group[] {
  if (!openedGroupIds.size) return [...groups];
  return groups.map(group => openedGroupIds.has(group.id) && group.kind === 'basic'
    ? { ...group, kind: 'composite' } : group);
}

function layoutFor(document: SavedState, openedGroupIds: ReadonlySet<string>): DiagramLayout {
  return computeLayout(document.tokens, groupsForEditing(document.groups, openedGroupIds), document.splits, document.arrows);
}

export function enterBasicGroup(
  document: SavedState,
  cursor: Cursor,
  openedGroupIds: ReadonlySet<string> = new Set(),
): GroupEditResult {
  const layout = layoutFor(document, openedGroupIds);
  const current = groupAt(layout, cursor.x, cursor.y);
  if (current?.group.kind !== 'basic') {
    return { cursor: moveVertical(layout, cursor, -1), anchor: null, openedGroupIds: new Set(openedGroupIds) };
  }
  if (document.splits.some(split => split.slotId === current.group.slotId)) {
    return { cursor, anchor: null, openedGroupIds: new Set(openedGroupIds) };
  }
  const opened = new Set(openedGroupIds);
  opened.add(current.group.id);
  const next = layoutFor(document, opened);
  const origin = { x: cursor.x, y: next.slotY.get(current.group.slotId)! };
  return { cursor: moveVertical(next, origin, -1), anchor: null, openedGroupIds: opened };
}

export function settleOpenedGroups(
  document: SavedState,
  cursor: Cursor,
  anchor: Cursor | null,
  openedGroupIds: ReadonlySet<string>,
  closeAll = false,
): GroupEditResult {
  let opened = new Set([...openedGroupIds].filter(id => document.groups.some(group => group.id === id && group.kind === 'basic')));
  for (;;) {
    const layout = layoutFor(document, opened);
    const finished = new Set(layout.groups.filter(placement => opened.has(placement.group.id)
      && (closeAll || !(cursor.y < placement.y && containsX(layout, placement.group.slotId, cursor.x))))
      .map(({ group }) => group.id));
    if (!finished.size) return { cursor, anchor, openedGroupIds: opened };
    for (const id of finished) opened.delete(id);
    const next = layoutFor(document, opened);
    cursor = relocateCursor(layout, next, cursor);
    if (anchor) anchor = relocateCursor(layout, next, anchor);
  }
}

export function readSavedDocument(value: unknown): SavedState | undefined {
  const saved = readSavedState(value);
  if (!saved) return undefined;
  const groups = saved.groups.map(({ id, slotId, slots, kind, form }) => ({ id, slotId, slots, kind, ...(form === undefined ? {} : { form }) }));
  return reclassifyGroups({ ...saved, groups });
}

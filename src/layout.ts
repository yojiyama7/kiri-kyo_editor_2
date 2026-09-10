import { isBracket, hasTokenSlot } from './model.ts';
import type { Arrow, Group, Token, SlotSplit } from './model';
import { getSlotGeometry, type LogicalAtom, type SlotRange } from './slotGeometry.ts';

export type GroupPlacement = {
  group: Group;
  baseSlotIds: ReadonlySet<string>;
  // Inclusive token indices for rendering, not logical region boundaries.
  start: number;
  end: number;
  y: number;
};

export type DiagramLayout = {
  arrows: ArrowPlacement[];
  groups: GroupPlacement[];
  rows: ReadonlyMap<number, readonly GroupPlacement[]>;
  slotY: ReadonlyMap<string, number>;
  maxY: number;
  tokenCount: number;
  // Number of integer logical atoms; may exceed tokenCount after T splits.
  logicalSize: number;
  baseSlotIds: readonly (string | undefined)[];
  tokenRanges: readonly SlotRange[];
  bracketRanges: readonly SlotRange[];
  atoms: LogicalAtom[];
  rangesBySlot: ReadonlyMap<string, SlotRange[]>;
  basesBySlot: ReadonlyMap<string, ReadonlySet<string>>;
  splits: readonly SlotSplit[];
};

export type Cursor = { x: number; y: number };

export type LineSegment = {
  start: number;
  end: number;
  startConnection?: string;
  endConnection?: string;
};

export type TokenRow = { start: number; end: number };

export function wrapTokenRows(widths: readonly number[], availableWidth: number, gap = 10): TokenRow[] {
  const rows: TokenRow[] = [];
  const limit = Math.max(1, availableWidth);
  let used = 0;
  for (let x = 0; x < widths.length; x += 1) {
    const width = Math.min(widths[x], limit);
    const row = rows[rows.length - 1];
    if (!row || used + gap + width > limit) {
      rows.push({ start: x, end: x });
      used = width;
    } else {
      row.end = x;
      used += gap + width;
    }
  }
  return rows;
}

export function groupLineSegments(
  layout: DiagramLayout,
  placement: GroupPlacement,
  rowStarts: ReadonlySet<number> = new Set(),
): LineSegment[] {
  const segments: LineSegment[] = [];
  for (let x = placement.start; x <= placement.end; x += 1) {
    const tokenRange = layout.tokenRanges[x];
    if (!layout.rangesBySlot.get(placement.group.slotId)!.some((range) => range.start < tokenRange.end && range.end > tokenRange.start)) continue;
    const previous = segments[segments.length - 1];
    if (previous && previous.end === x - 1 && !rowStarts.has(x)) previous.end = x;
    else segments.push({ start: x, end: x });
  }
  const groupIndex = layout.groups.indexOf(placement);
  for (let index = 1; index < segments.length; index += 1) {
    const gapIndex = index - 1;
    // Give each (group, gap) pair its own hue, including separate gaps within
    // one group. Both endpoints of that connection receive the exact same color.
    const sum = groupIndex + gapIndex;
    const connectionIndex = sum * (sum + 1) / 2 + gapIndex;
    const color = `hsl(${(215 + connectionIndex * 137.508) % 360} 70% 42%)`;
    segments[index - 1].endConnection = color;
    segments[index].startConnection = color;
  }
  return segments;
}

export function slotPosition(layout: DiagramLayout, slotId: string): Cursor | undefined {
  const splitChild = layout.splits.some((split) => split.leftSlotId === slotId || split.rightSlotId === slotId);
  // A sparse T keeps earlier source regions as left-side continuations, while
  // both interactive halves are rendered in the final region.
  const ranges = layout.rangesBySlot.get(slotId);
  const range = splitChild ? ranges?.at(-1) : ranges?.[0];
  const y = layout.slotY.get(slotId);
  return range && y !== undefined ? { x: range.start, y } : undefined;
}

export function toggleSlotSelection(layout: DiagramLayout, selected: readonly string[], cursor: Cursor): string[] {
  const slotId = slotAt(layout, cursor.x, cursor.y);
  if (slotId === undefined) return [...selected];
  if (selected.includes(slotId)) return selected.filter((id) => id !== slotId);
  return [...selected, slotId].sort((a, b) => slotPosition(layout, a)!.x - slotPosition(layout, b)!.x);
}

export type CollisionInterval = { start: number; end: number; startClosed: boolean; endClosed: boolean };
export type ArrowPlacement = {
  key: string;
  kind?: 'apposition';
  targetSlotId: string;
  sourceSlotIds: string[];
  // Midpoint span for arrow–arrow collisions and placement priority.
  interval: CollisionInterval;
  // Full endpoint-slot envelope, used only against underline/slot regions.
  slotInterval: CollisionInterval;
  y: number;
};

export function intervalsIntersect(a: CollisionInterval, b: CollisionInterval): boolean {
  const empty = (range: CollisionInterval) => range.start > range.end
    || (range.start === range.end && !(range.startClosed && range.endClosed));
  if (empty(a) || empty(b)) return false;
  if (a.end < b.start || b.end < a.start) return false;
  if (a.end === b.start) return a.endClosed && b.startClosed;
  if (b.end === a.start) return b.endClosed && a.startClosed;
  return true;
}

export function computeLayout(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[] = [], arrows: readonly Arrow[] = []): DiagramLayout {
  const { rangesBySlot, atoms, tokenRanges } = getSlotGeometry(tokens, groups, splits);
  const basesBySlot = new Map([...rangesBySlot].map(([id, ranges]) => [id, new Set(atoms
    .filter((atom) => ranges.some((range) => atom.start >= range.start && atom.end <= range.end))
    .map((atom) => atom.id))]));
  const slotY = new Map(tokens.filter(hasTokenSlot).map((token) => [token.slotId, 0]));
  const inheritSplitY = () => {
    for (const split of splits) {
      const y = slotY.get(split.slotId);
      if (y !== undefined) {
        slotY.set(split.leftSlotId, y);
        slotY.set(split.rightSlotId, y);
      }
    }
  };
  inheritSplitY();
  type Candidate = { group?: Group; arrow?: Omit<ArrowPlacement, 'y'>; dependencies: string[];
    intervals: CollisionInterval[]; length: number; order: number };
  const candidates: Candidate[] = groups.map((group, order) => {
    const ranges = rangesBySlot.get(group.slotId)!;
    return { group, dependencies: group.slots, order,
      intervals: ranges.map((range) => ({ ...range, startClosed: true, endClosed: false })),
      length: ranges[ranges.length - 1].end - ranges[0].start };
  });
  const bundles = new Map<string, Pick<ArrowPlacement, 'targetSlotId' | 'sourceSlotIds' | 'kind'>>();
  arrows.forEach((arrow, index) => {
    // Namespace keys: directed targets may also be endpoints of apposition arrows.
    const key = JSON.stringify(arrow.kind === 'apposition' ? ['apposition', index] : ['directed', arrow.targetSlotId]);
    const bundle = bundles.get(key) ?? { targetSlotId: arrow.targetSlotId, sourceSlotIds: [],
      ...(arrow.kind ? { kind: arrow.kind } : {}) };
    bundle.sourceSlotIds.push(arrow.sourceSlotId);
    bundles.set(key, bundle);
  });
  for (const [key, { targetSlotId, sourceSlotIds, kind }] of bundles) {
    const dependencies = [...sourceSlotIds, targetSlotId];
    const centers = dependencies.map((id) => {
      const result = rangesBySlot.get(id);
      if (!result) throw new Error(`Unknown arrow slot: ${id}`);
      const last = result[result.length - 1];
      return (last.start + last.end) / 2;
    });
    const start = Math.min(...centers);
    const end = Math.max(...centers);
    const targetX = centers[centers.length - 1];
    // Directed targets are closed while source-only edges are open. Both ends
    // of an apposition are displaced like sources when they share an incoming
    // target, so treat both ends as open for arrow-to-arrow placement too.
    const interval = { start, end, startClosed: kind !== 'apposition' && targetX === start,
      endClosed: kind !== 'apposition' && targetX === end };
    const endpointRanges = dependencies.flatMap((id) => rangesBySlot.get(id)!);
    const slotInterval = { start: Math.min(...endpointRanges.map((range) => range.start)),
      end: Math.max(...endpointRanges.map((range) => range.end)), startClosed: true, endClosed: false };
    candidates.push({ arrow: { key, ...(kind ? { kind } : {}), targetSlotId, sourceSlotIds, interval, slotInterval }, dependencies, intervals: [interval],
      length: end - start, order: candidates.length });
  }
  const remaining = new Set(candidates);
  const placements = new Map<string, GroupPlacement>();
  const arrowPlacements = new Map<string, ArrowPlacement>();
  // Keep item types: the arrow's footprint depends on its collision partner.
  const occupied = new Map<number, Candidate[]>();
  const bracketRanges = tokens.flatMap((token, index) => isBracket(token) ? [tokenRanges[index]] : []);
  if (bracketRanges.length) occupied.set(0, [{ dependencies: [], length: 0, order: -1,
    intervals: bracketRanges.map((range) => ({ ...range, startClosed: true, endClosed: false })) }]);
  const collides = (a: Candidate, b: Candidate) => {
    const aIntervals = a.arrow && !b.arrow ? [a.arrow.slotInterval] : a.intervals;
    const bIntervals = b.arrow && !a.arrow ? [b.arrow.slotInterval] : b.intervals;
    return aIntervals.some((left) => bIntervals.some((right) => intervalsIntersect(left, right)));
  };
  const rows = new Map<number, GroupPlacement[]>();
  let maxY = 0;
  while (remaining.size) {
    const candidate = [...remaining].filter((item) => item.dependencies.every((id) => slotY.has(id)))
      .sort((a, b) => a.length - b.length || Number(!!a.arrow) - Number(!!b.arrow) || a.order - b.order)[0];
    if (!candidate) throw new Error('Unresolvable diagram dependencies');
    const { group, arrow } = candidate;
    let y = Math.max(0, ...candidate.dependencies.map((id) => slotY.get(id)!
      + (group?.kind === 'basic' ? 0 : 1)));
    while ((occupied.get(y) ?? []).some((used) => collides(candidate, used))) y += 1;
    occupied.set(y, [...(occupied.get(y) ?? []), candidate]);
    if (group) {
      const ranges = rangesBySlot.get(group.slotId)!;
      const placement = { group, baseSlotIds: basesBySlot.get(group.slotId)!, start: atoms[ranges[0].start].tokenIndex,
        end: atoms[ranges[ranges.length - 1].end - 1].tokenIndex, y };
      placements.set(group.id, placement);
      const row = rows.get(y) ?? [];
      row.push(placement);
      rows.set(y, row);
      slotY.set(group.slotId, y);
      inheritSplitY();
    } else if (arrow) arrowPlacements.set(arrow.key, { ...arrow, y });
    maxY = Math.max(maxY, y);
    remaining.delete(candidate);
  }
  return { groups: groups.map((group) => placements.get(group.id)!),
    arrows: [...bundles.keys()].map((id) => arrowPlacements.get(id)!), rows, slotY, maxY,
    tokenCount: tokens.length, logicalSize: atoms.length, tokenRanges, bracketRanges, baseSlotIds: tokens.map((token) => token.slotId),
    atoms, rangesBySlot, basesBySlot, splits };
}

export function containsX(layout: DiagramLayout, id: string, x: number): boolean {
  return layout.rangesBySlot.get(id)?.some((range) => x >= range.start && x < range.end) ?? false;
}

export function groupAt(layout: DiagramLayout, x: number, y: number): GroupPlacement | undefined {
  return [...layout.groups].reverse().find((placement) => placement.y === y && containsX(layout, placement.group.slotId, x));
}

export function slotAt(layout: DiagramLayout, x: number, y: number): string | undefined {
  if (x < 0 || x >= layout.logicalSize) return undefined;
  const id = groupAt(layout, x, y)?.group.slotId ?? (y === 0 ? layout.atoms[Math.floor(x)]?.tokenSlotId : undefined);
  const split = layout.splits.find((split) => split.slotId === id);
  return split ? (containsX(layout, split.leftSlotId, x) ? split.leftSlotId : split.rightSlotId) : id;
}

export function tokenIndexAt(layout: DiagramLayout, x: number): number | undefined {
  return layout.atoms[Math.floor(x)]?.tokenIndex;
}

// Keep the slot (and, when possible, its original atom/region) across reflow
// and renumbering. If the slot disappears, fall back to its owning token.
export function relocateCursor(before: DiagramLayout, after: DiagramLayout, cursor: Cursor,
  preferredId = slotAt(before, cursor.x, cursor.y)): Cursor {
  const oldAtom = before.atoms[Math.floor(cursor.x)];
  const atom = oldAtom && after.atoms.find((candidate) => candidate.id === oldAtom.id);
  const position = preferredId === undefined ? undefined : slotPosition(after, preferredId);
  if (position) return { x: atom && containsX(after, preferredId!, atom.start) ? atom.start : position.x, y: position.y };
  const token = oldAtom?.tokenSlotId ? after.rangesBySlot.get(oldAtom.tokenSlotId)?.[0] : undefined;
  const x = atom?.start ?? token?.start ?? Math.max(0, Math.min(cursor.x, after.logicalSize - 1));
  return nearestCursor(after, { x, y: cursor.y });
}

// Logical regions stay continuous across display wrapping. Other regions of
// the same slot do not contribute to the current region's navigation bounds.
export function regionAt(layout: DiagramLayout, x: number, y: number): SlotRange | undefined {
  const id = slotAt(layout, x, y);
  return id === undefined ? undefined
    : layout.rangesBySlot.get(id)?.find((range) => x >= range.start && x < range.end);
}

export function groupForDeletion(layout: DiagramLayout, cursor: Cursor): Group | undefined {
  const current = groupAt(layout, cursor.x, cursor.y)?.group;
  if (current || cursor.y !== 0) return current;
  return [...layout.groups].reverse().find((placement) => containsX(layout, placement.group.slotId, cursor.x))?.group;
}

export function normalizeCursorY(layout: DiagramLayout, x: number, y: number): number {
  for (let candidate = Math.min(y, layout.maxY); candidate > 0; candidate -= 1) {
    if (slotAt(layout, x, candidate) !== undefined) return candidate;
  }
  return 0;
}

// Slotless positions keep their logical X but are never navigation destinations.
export function nearestCursor(layout: DiagramLayout, cursor: Cursor): Cursor {
  const x = Math.max(0, Math.min(cursor.x, layout.logicalSize - 1));
  const at = (x: number): Cursor | undefined => {
    const y = normalizeCursorY(layout, x, cursor.y);
    return slotAt(layout, x, y) === undefined ? undefined : { x, y };
  };
  return at(x) ?? layout.atoms.filter((atom) => atom.start > x).map((atom) => at(atom.start)).find(Boolean)
    ?? [...layout.atoms].reverse().filter((atom) => atom.start < x).map((atom) => at(atom.start)).find(Boolean)
    ?? { x: 0, y: 0 };
}

export function selectSlotRange(layout: DiagramLayout, anchor: Cursor, cursor: Cursor): string[] {
  const selected = new Map<string, number>();
  const covered = new Set<string>();
  function add(position: Cursor) {
    const id = slotAt(layout, position.x, position.y);
    if (id === undefined) return;
    selected.set(id, slotPosition(layout, id)!.x);
    for (const base of layout.basesBySlot.get(id)!) covered.add(base);
  }
  add(anchor);
  add(cursor);
  const ceiling = Math.max(anchor.y, cursor.y);
  for (const atom of layout.atoms) {
    if (atom.start < Math.min(anchor.x, cursor.x) || atom.start > Math.max(anchor.x, cursor.x) || covered.has(atom.id)) continue;
    add({ x: atom.start, y: normalizeCursorY(layout, atom.start, ceiling) });
  }
  return [...selected].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

export function moveVertical(layout: DiagramLayout, cursor: Cursor, direction: -1 | 1): Cursor {
  for (let y = cursor.y + direction; y >= 0 && y <= layout.maxY; y += direction) {
    if (regionAt(layout, cursor.x, y) !== undefined) return { x: cursor.x, y };
  }
  return cursor;
}

export function moveLeft(layout: DiagramLayout, cursor: Cursor): Cursor { return moveHorizontal(layout, cursor, -1); }
export function moveRight(layout: DiagramLayout, cursor: Cursor): Cursor { return moveHorizontal(layout, cursor, 1); }

function moveHorizontal(layout: DiagramLayout, cursor: Cursor, direction: -1 | 1): Cursor {
  const region = regionAt(layout, cursor.x, cursor.y);
  if (region === undefined) return cursor;
  const atom = direction === -1
    ? [...layout.atoms].reverse().find((atom) => atom.end <= region.start && slotAt(layout, atom.start, normalizeCursorY(layout, atom.start, cursor.y)) !== undefined)
    : layout.atoms.find((atom) => atom.start >= region.end && slotAt(layout, atom.start, normalizeCursorY(layout, atom.start, cursor.y)) !== undefined);
  if (!atom) return cursor;
  return { x: atom.start, y: normalizeCursorY(layout, atom.start, cursor.y) };
}

export function moveToRowEdge(layout: DiagramLayout, cursor: Cursor, edge: 'start' | 'end'): Cursor {
  const candidates = layout.atoms.filter((atom) => slotAt(layout, atom.start, cursor.y) !== undefined);
  const atom = edge === 'start' ? candidates[0] : candidates[candidates.length - 1];
  return atom ? { x: atom.start, y: cursor.y } : cursor;
}

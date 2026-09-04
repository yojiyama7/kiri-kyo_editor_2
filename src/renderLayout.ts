import { isBracket, isVirtualBracket, type Group, type Token, type SlotSplit } from './model.ts';
import { wrapTokenRows } from './layout.ts';
import { getSlotGeometry, mergeRanges, type SlotRange } from './slotGeometry.ts';

export type RenderRegion = {
  // start/end are inclusive token indices; logicalRanges are half-open X ranges.
  row: number; start: number; end: number; left: number; right: number;
  logicalRanges: SlotRange[];
  startConnection?: string; endConnection?: string;
  // Optional glyph attachment, relative to the row's Y=0 slot origin.
  arrowAttachment?: { x: number; y: number };
};

export type LabelWidths = ReadonlyMap<string, number>;
export type PendingLabel = { slotId: string; x: number };
export type RenderOptions = { unclampedTokenId?: string; splitMinimumWidths?: LabelWidths };
type Row = { start: number; end: number };
type Padding = { before: number; after: number };
export const BRACKET_GUTTER = 12;
export const BRACKET_SLOT_MIN_WIDTH = 24;
export const CLOSE_BRACKET_WIDTH = 10;
const GAP = 10;
const EPSILON = 0.01;

// Resolve display geometry separately from logical coordinates: a wrapped T's
// children live only in its final region, and all dependents use that geometry.
export function computeRenderLayout(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[], widths: readonly number[], availableWidth: number,
  labelWidths: LabelWidths = new Map(), pendingLabel?: PendingLabel, options: RenderOptions = {}) {
  const columnWidths = tokens.map((token, index) => {
    if (isBracket(token) && token.kind !== 'bracket-open') return CLOSE_BRACKET_WIDTH;
    const width = token.id === options.unclampedTokenId ? widths[index] : Math.min(widths[index], Math.max(1, availableWidth));
    return token.kind === 'bracket-open' ? Math.max(BRACKET_GUTTER + BRACKET_SLOT_MIN_WIDTH, width) : width;
  });
  const rows = wrapTokenRows(columnWidths, availableWidth);
  // Start afresh on every measurement/resize. Padding is never fed back into
  // measured token widths, so changing or deleting a label cannot accumulate it.
  for (;;) {
    const view = fitRows(tokens, groups, splits, columnWidths, rows, labelWidths, pendingLabel, options.splitMinimumWidths);
    const overflowing = rows.findIndex((row, i) => row.end > row.start && view.rowWidths[i] > availableWidth + EPSILON);
    if (overflowing < 0) return view;
    // Only move a boundary left: wrapping terminates, even if one label is wider
    // than the viewport. A single-token overflow is displayed with scrolling.
    const row = rows[overflowing];
    const moved = row.end--;
    if (rows[overflowing + 1]) rows[overflowing + 1].start = moved;
    else rows.push({ start: moved, end: moved });
  }
}

function fitRows(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[], widths: readonly number[],
  rows: Row[], labelWidths: LabelWidths, pendingLabel?: PendingLabel, splitMinimumWidths: LabelWidths = new Map()) {
  const padding: Padding[] = tokens.map(() => ({ before: 0, after: 0 }));
  let view = placeRegions(tokens, groups, splits, widths, rows, padding, labelWidths, pendingLabel, splitMinimumWidths);
  // Resolve one dependency at a time, children before parents. A group's own
  // extra space is reserved only at its outer boundaries, never inside a token.
  // Reservations grow monotonically; later intersecting groups may share them.
  for (;;) {
    let changed = false;
    for (const region of view.labelRegions) {
      const first = view.columns[region.start];
      const last = view.columns[region.end];
      const before = Math.max(0, first.left - region.left);
      const after = Math.max(0, region.right - last.right);
      if (before > padding[region.start].before + EPSILON || after > padding[region.end].after + EPSILON) {
        padding[region.start].before = Math.max(padding[region.start].before, before);
        padding[region.end].after = Math.max(padding[region.end].after, after);
        changed = true;
        break;
      }
    }
    if (!changed) {
      const { labelRegions, ...result } = view;
      return result;
    }
    view = placeRegions(tokens, groups, splits, widths, rows, padding, labelWidths, pendingLabel, splitMinimumWidths);
  }
}

function placeRegions(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[], widths: readonly number[],
  rows: Row[], padding: Padding[], labelWidths: LabelWidths, pendingLabel: PendingLabel | undefined,
  splitMinimumWidths: LabelWidths) {
  const { rangesBySlot: logicalRangesBySlot, tokenRanges } = getSlotGeometry(tokens, groups, splits);
  const tokenRegions = new Map<string, RenderRegion[]>();
  const columns: RenderRegion[] = [];
  const rowWidths: number[] = [];
  // Only a label's own expansion requests new space. Inherited split halves
  // can already occupy part of a token gap; reserving that gap again would
  // repeatedly widen both halves and could prevent layout from settling.
  const labelRegions: RenderRegion[] = [];
  rows.forEach((row, rowIndex) => {
    let left = 0;
    for (let x = row.start; x <= row.end; x += 1) {
      left += padding[x].before;
      const right = left + widths[x];
      const region = { row: rowIndex, start: x, end: x, left, right, logicalRanges: [tokenRanges[x]] };
      columns.push(region);
      const token = tokens[x];
      if (token.slotId !== undefined) tokenRegions.set(token.slotId, [{ ...region,
        right: right - (token.kind === 'bracket-open' ? BRACKET_GUTTER : 0),
        ...(isVirtualBracket(token) ? { arrowAttachment: { x: right - 1, y: 28 } } : {}) }]);
      left = right + padding[x].after + GAP;
    }
    rowWidths.push(left - GAP);
  });
  const regionsBySlot = new Map(tokenRegions);
  const groupBySlot = new Map(groups.map((group) => [group.slotId, group]));
  const childBySlot = new Map<string, { split: SlotSplit; right: boolean }>(splits.flatMap((split) => [
    [split.leftSlotId, { split, right: false }] as const,
    [split.rightSlotId, { split, right: true }] as const,
  ]));
  const splitBySource = new Map(splits.map((split) => [split.slotId, split]));
  const appliedSplits = new Set<string>();
  const visiting = new Set<string>();
  function applySplit(split: SlotSplit, source: RenderRegion[]): void {
    if (appliedSplits.has(split.slotId)) return;
    const last = source[source.length - 1];
    const ratio = split.kind === 'd' ? split.ratio ?? 0.5 : 0.5;
    const originalLeft = last.left;
    const originalRight = last.right;
    const originalWidth = originalRight - originalLeft;
    const leftMinimum = splitMinimumWidths.get(split.leftSlotId) ?? 0;
    const rightMinimum = splitMinimumWidths.get(split.rightSlotId) ?? 0;
    const commonMinimum = split.kind === 'd' ? 0 : Math.max(leftMinimum, rightMinimum);
    const totalWidth = split.kind === 'd'
      ? Math.max(originalWidth, leftMinimum + rightMinimum)
      : Math.max(originalWidth, commonMinimum * 2);
    const center = (originalLeft + originalRight) / 2;
    const left = center - totalWidth / 2;
    const right = center + totalWidth / 2;
    const leftWidth = split.kind === 'd'
      ? Math.min(totalWidth - rightMinimum, Math.max(leftMinimum, totalWidth * ratio))
      : totalWidth / 2;
    const middle = left + leftWidth;
    if (left < originalLeft || right > originalRight) {
      last.left = left;
      last.right = right;
      labelRegions.push(last);
    }
    const region = (start: number, end: number, logicalRanges: SlotRange[]): RenderRegion => {
      const covered = columns.filter((column) => column.row === last.row && column.left < end && column.right > start);
      return { row: last.row, start: covered[0]?.start ?? last.start,
        end: covered[covered.length - 1]?.end ?? last.end, left: start, right: end, logicalRanges };
    };
    regionsBySlot.set(split.leftSlotId, [region(left, middle, logicalRangesBySlot.get(split.leftSlotId)!)]);
    regionsBySlot.set(split.rightSlotId, [region(middle, right, logicalRangesBySlot.get(split.rightSlotId)!)]);
    appliedSplits.add(split.slotId);
  }
  function resolve(id: string): RenderRegion[] {
    const child = childBySlot.get(id);
    if (child) {
      const source = resolve(child.split.slotId);
      applySplit(child.split, source);
      return regionsBySlot.get(id)!;
    }
    const cached = regionsBySlot.get(id);
    if (cached) {
      const split = splitBySource.get(id);
      if (split) applySplit(split, cached);
      return cached;
    }
    if (visiting.has(id)) throw new Error(`Cyclic display dependency: ${id}`);
    visiting.add(id);
    let result: RenderRegion[] = [];
    const group = groupBySlot.get(id);
    if (!group) throw new Error(`Unknown display slot: ${id}`);
    const regions = group.slots.flatMap(resolve).sort((a, b) => a.row - b.row || a.start - b.start || a.left - b.left);
    for (const region of regions) {
      const last = result[result.length - 1];
      // Decorations may extend outside the selected content. Only logical
      // adjacency can join regions; a wide label must not fill a sparse gap.
      const connected = last && last.row === region.row && last.logicalRanges.some((a) =>
        region.logicalRanges.some((b) => a.start <= b.end && b.start <= a.end));
      if (connected) {
        last.left = Math.min(last.left, region.left);
        last.right = Math.max(last.right, region.right);
        last.end = Math.max(last.end, region.end);
        last.logicalRanges = mergeRanges([...last.logicalRanges, ...region.logicalRanges]);
      } else result.push({ row: region.row, start: region.start, end: region.end, left: region.left, right: region.right,
        logicalRanges: region.logicalRanges });
    }
    const labelled = pendingLabel?.slotId === id
      ? result.find((region) => region.logicalRanges.some((r) => r.start <= pendingLabel.x && pendingLabel.x < r.end)) ?? result.at(-1)
      : result.at(-1);
    if (labelled) {
      const extra = Math.max(0, (labelWidths.get(id) ?? 0) - (labelled.right - labelled.left)) / 2;
      labelled.left -= extra;
      labelled.right += extra;
      if (extra > 0) labelRegions.push(labelled);
    }
    visiting.delete(id);
    regionsBySlot.set(id, result);
    const split = splitBySource.get(id);
    if (split) applySplit(split, result);
    return result;
  }
  groups.forEach((group) => resolve(group.slotId));
  for (const id of childBySlot.keys()) resolve(id);
  // Decorate only each group's own region copies, never those of its children.
  groups.forEach((group, groupIndex) => {
    const regions = regionsBySlot.get(group.slotId)!;
    for (let index = 1; index < regions.length; index += 1) {
      const sum = groupIndex + index - 1;
      const color = `hsl(${(215 + (sum * (sum + 1) / 2 + index - 1) * 137.508) % 360} 70% 42%)`;
      regions[index - 1].endConnection = color;
      regions[index].startConnection = color;
    }
  });
  return { rows, regionsBySlot, columns, rowWidths, labelRegions };
}

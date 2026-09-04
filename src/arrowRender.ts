import type { DiagramLayout } from './layout.ts';
import type { Slot } from './model.ts';
import type { RenderRegion } from './renderLayout.ts';

export type RenderArrowSegment = {
  kind?: 'apposition';
  label?: { text: string; x: number; y: number };
  targetSlotId: string; row: number; logicalY: number; y: number; left: number; right: number;
  startConnection?: string; endConnection?: string;
  stems: { slotId: string; x: number; y: number; target: boolean; attachmentX?: number }[];
};

const OUTGOING_OFFSET = 6;
const BASIC_TARGET_INSET = 7;
// Cross the underline 5px above the slot and protrude another 3px.
const EMPTY_SLOT_EXTENSION = 8;

function offsetToward(region: RenderRegion, x: number, destinationRegion: RenderRegion, destinationX: number): number {
  // Across wrapping, later rows are to the logical right even if their pixel
  // X is smaller. Coincident attachments use a rightward fallback.
  const direction = Math.sign(destinationRegion.row - region.row) || Math.sign(destinationX - x) || 1;
  const distance = destinationRegion.row === region.row && destinationX !== x
    ? Math.abs(destinationX - x) / 2 : Infinity;
  const offset = Math.min(OUTGOING_OFFSET, Math.max(0, region.right - region.left) / 4, distance);
  return x + direction * offset;
}

// Coordinates are relative to the top of the row's Y=0 slot, not its text.
export function renderArrows(layout: DiagramLayout, regionsBySlot: ReadonlyMap<string, RenderRegion[]>,
  slots: readonly Slot[], columns?: readonly RenderRegion[]): RenderArrowSegment[] {
  const result: RenderArrowSegment[] = [];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const tHalfSlots = new Set(layout.splits.filter((split) => split.kind !== 'd')
    .flatMap((split) => [split.leftSlotId, split.rightSlotId]));
  const incomingSlots = new Set(layout.arrows.filter((arrow) => arrow.kind !== 'apposition').map((arrow) => arrow.targetSlotId));
  const bracketStarts = new Set(layout.bracketRanges.map((range) => range.start));
  const basicSlots = new Set(layout.baseSlotIds.filter((id, index): id is string =>
    id !== undefined && !bracketStarts.has(layout.tokenRanges[index].start)));
  for (const split of layout.splits) {
    basicSlots.add(split.leftSlotId);
    basicSlots.add(split.rightSlotId);
  }
  for (const split of layout.splits) basicSlots.delete(split.slotId);
  // Check direct contents, regardless of markers or underline kind. Expanding
  // nested underlines to their token leaves would incorrectly include them.
  const basicContentGroups = layout.groups.filter(({ group }) =>
    group.slots.length > 0 && group.slots.every((id) => basicSlots.has(id)))
    .map(({ group }) => new Set(group.slots));
  const bounds = new Map<number, { left: number; right: number }>();
  // Include expanded underlines so wrapped connections stay outside their stems.
  // Display columns also preserve rows made solely of slotless closing brackets.
  const rowRegions = [...(columns ?? []), ...Array.from(regionsBySlot.values()).flat()];
  for (const region of rowRegions) {
    const previous = bounds.get(region.row);
    bounds.set(region.row, { left: Math.min(previous?.left ?? Infinity, region.left),
      right: Math.max(previous?.right ?? -Infinity, region.right) });
  }
  layout.arrows.forEach((arrow, index) => {
    const apposition = arrow.kind === 'apposition';
    const endpointIds = [...arrow.sourceSlotIds, arrow.targetSlotId];
    const endpointRegions = endpointIds.map((slotId) => regionsBySlot.get(slotId)!.at(-1)!);
    const endpointXs = endpointRegions.map((region) => region.arrowAttachment?.x ?? (region.left + region.right) / 2);
    const targetRegion = endpointRegions[endpointRegions.length - 1];
    const targetX = endpointXs[endpointXs.length - 1];
    const endpoints = endpointIds.map((slotId, endpointIndex) => {
      const region = endpointRegions[endpointIndex];
      const target = !apposition && slotId === arrow.targetSlotId;
      const attachment = region.arrowAttachment;
      let x = endpointXs[endpointIndex];
      if (!target && incomingSlots.has(slotId)) {
        const destinationIndex = apposition ? (endpointIndex === 0 ? 1 : 0) : endpointIds.length - 1;
        x = offsetToward(region, x, endpointRegions[destinationIndex], endpointXs[destinationIndex]);
      }
      const emptySlot = slotById.get(slotId)?.marker === undefined;
      const extendAboveSlot = apposition && emptySlot && !tHalfSlots.has(slotId);
      const attachToSlotTop = target && emptySlot;
      return { slotId, row: region.row, x, target,
        ...(attachment && x !== attachment.x ? { attachmentX: attachment.x } : {}),
        y: attachment?.y ?? layout.slotY.get(slotId)! * 38
          + (extendAboveSlot ? -EMPTY_SLOT_EXTENSION : attachToSlotTop ? 0 : 28) };
    }).sort((a, b) => a.row - b.row || a.x - b.x);
    // A shared target moves only when at least one source enters from outside
    // a qualifying underline. Membership stays the same across wrapped rows.
    if (!apposition && basicContentGroups.some((contents) => contents.has(arrow.targetSlotId)
      && arrow.sourceSlotIds.some((id) => !contents.has(id)))) {
      const target = endpoints.find((endpoint) => endpoint.target)!;
      const first = endpoints[0];
      const last = endpoints[endpoints.length - 1];
      // Decide using the original target and already-adjusted sources across
      // all rows, not the edges of an individual wrapped segment.
      const determinesLeft = target.row === first.row && target.x === first.x;
      const determinesRight = target.row === last.row && target.x === last.x;
      if (determinesLeft || determinesRight) {
        const inset = Math.min(BASIC_TARGET_INSET, (targetRegion.right - targetRegion.left) / 2);
        target.x = determinesRight ? targetRegion.left + inset : targetRegion.right - inset;
        if (slotById.get(target.slotId)?.marker === undefined) target.y -= EMPTY_SLOT_EXTENSION;
        endpoints.sort((a, b) => a.row - b.row || a.x - b.x);
      }
    }
    // Recompute horizontal extents after moving either source or target stems.
    const first = endpoints[0];
    const last = endpoints[endpoints.length - 1];
    for (let row = first.row; row <= last.row; row += 1) {
      // Each (bundle, row gap) pair has a stable connection color.
      const connection = (gap: number) => `hsl(${((index + gap) * (index + gap + 1) / 2 + gap) * 137.508 + 35} 70% 42%)`;
      const y = arrow.y * 38 + (apposition ? 3 : 14);
      const left = row === first.row ? first.x : bounds.get(row)!.left;
      const right = row === last.row ? last.x : bounds.get(row)!.right;
      result.push({ targetSlotId: arrow.targetSlotId, row, logicalY: arrow.y, y, left, right,
        ...(apposition ? { kind: 'apposition' as const } : {}),
        ...(apposition && row === last.row ? { label: { text: '同格', x: (left + right) / 2, y: y + 18 } } : {}),
        startConnection: row > first.row ? connection(row - first.row - 1) : undefined,
        endConnection: row < last.row ? connection(row - first.row) : undefined,
        stems: endpoints.filter((endpoint) => endpoint.row === row),
      });
    }
  });
  return result;
}

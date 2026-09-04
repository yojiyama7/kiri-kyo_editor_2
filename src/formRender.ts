import type { SavedState } from './model.ts';
import { slotAt, type DiagramLayout } from './layout.ts';
import type { RenderRegion } from './renderLayout.ts';
import { formTargets, formDisplay, type FormSession, type FormTarget } from './formEditing.ts';

export function visibleFormTargets(document: SavedState, layout: DiagramLayout): FormTarget[] {
  return formTargets(document).filter(target => {
    // A word's annotation remains visible when a basic underline covers its
    // slot. Selection/edit eligibility is independent from form visibility.
    if (target.tokenId !== undefined) return true;
    const split = document.splits.find(split => split.slotId === target.slotId);
    const ids = split ? [split.leftSlotId, split.rightSlotId] : [target.slotId];
    return ids.some(id => {
      const y = layout.slotY.get(id);
      return y !== undefined && layout.rangesBySlot.get(id)?.some(range => {
        for (let x = range.start; x < range.end; x++) if (slotAt(layout, x, y) === id) return true;
        return false;
      });
    });
  });
}

export type FormLabelRegion = RenderRegion & { slotId: string; text: string; label: string; pending: boolean; lane: number };

// Use the same region/half geometry as the corresponding slots. One label per
// owner (or D half); wrapped/sparse groups do not repeat it on every word.
export function renderForms(document: SavedState, layout: DiagramLayout,
  regionsBySlot: ReadonlyMap<string, readonly RenderRegion[]>, session: FormSession | null): FormLabelRegion[] {
  const targets = visibleFormTargets(document, layout);
  const targetBySlot = new Map(targets.map(target => [target.slotId, target]));
  const isWord = (slotId: string) => targetBySlot.get(slotId)?.tokenId !== undefined;
  const labels = targets.flatMap(target => {
    const text = formDisplay(target, session);
    const pending = target.slotId === session?.slotId;
    if (!text && !pending) return [];
    const regions = regionsBySlot.get(target.slotId) ?? [];
    const split = document.splits.some(split => split.slotId === target.slotId);
    const region = pending && !split
      ? regions.find(region => region.logicalRanges.some(range => range.start <= session.before.cursor.x && session.before.cursor.x < range.end)) ?? regions.at(-1)
      : regions.at(-1);
    return region ? [{ ...region, slotId: target.slotId, text, label: target.label, pending, lane: 0 }] : [];
  });
  // Place words first even when an underline has exactly the same width.
  // Group height depends on its actual contents across all wrapped regions,
  // not just the words underneath the final region where its form is drawn.
  const placed: FormLabelRegion[] = [];
  for (const label of labels.sort((a, b) => Number(!isWord(a.slotId)) - Number(!isWord(b.slotId))
    || a.row - b.row || (a.right - a.left) - (b.right - b.left))) {
    if (!isWord(label.slotId)) {
      // Both D halves use their whole owner's membership and rise together.
      const contents = layout.rangesBySlot.get(targetBySlot.get(label.slotId)!.ownerSlotId) ?? [];
      for (const word of placed.filter(word => isWord(word.slotId))) {
        const ranges = layout.rangesBySlot.get(word.slotId) ?? [];
        if (contents.some(content => ranges.some(range => content.start < range.end && range.start < content.end))) {
          label.lane = Math.max(label.lane, word.lane + 1);
        }
      }
    }
    while (placed.some(other => other.row === label.row && other.lane === label.lane
      && other.left < label.right && label.left < other.right)) label.lane++;
    placed.push(label);
  }
  return placed;
}

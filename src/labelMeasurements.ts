import type { Arrow, Group, Slot, SlotSplit, Token } from './model.ts';
import { computeLayout, slotAt, slotPosition } from './layout.ts';
import { markerLabel } from './markers.ts';

// A label belongs to its own slot, not to the last token inside that slot.
export function measureLabels(tokens: Token[], slots: Slot[], groups: Group[], splits: SlotSplit[], arrows: Arrow[],
  pendingSlotId?: string, buffer = '') {
  const slotMap = new Map(slots.map((slot) => [slot.id, slot]));
  const splitMap = new Map(splits.map((split) => [split.slotId, split]));
  const layout = computeLayout(tokens, groups, splits, arrows);
  const label = (id: string) => pendingSlotId === id ? buffer : markerLabel(slotMap.get(id)?.marker);
  const visibleLabel = (id: string) => {
    const position = slotPosition(layout, id);
    return position && slotAt(layout, position.x, position.y) === id ? label(id) : '';
  };
  const splitLabels = (id: string) => {
    const split = splitMap.get(id);
    return split ? [[visibleLabel(split.leftSlotId), visibleLabel(split.rightSlotId)]] : [];
  };
  return {
    tokens: tokens.map((token) => ({ token, labels: token.slotId === undefined ? [] : [visibleLabel(token.slotId)],
      splitLabels: token.slotId === undefined ? [] : splitLabels(token.slotId) })),
    groups: groups.map((group) => ({ slotId: group.slotId,
      labels: splitMap.has(group.slotId) ? [] : [label(group.slotId)], splitLabels: splitLabels(group.slotId) })),
  };
}

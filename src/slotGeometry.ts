import type { Group, Token, SlotSplit } from './model.ts';

// Public logical regions have integer boundaries and are half-open.
export type SlotRange = { start: number; end: number };
export type LogicalAtom = SlotRange & { id: string; tokenIndex: number; tokenSlotId?: string };

export function mergeRanges(ranges: readonly SlotRange[]): SlotRange[] {
  const result: SlotRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function getSlotGeometry(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[] = []) {
  // Resolve cuts in token space first. Renumber only after all cuts are known,
  // so adding an unrelated T never changes another T's logical bisection.
  const ranges = new Map<string, SlotRange[]>(tokens.flatMap((token, x) => token.slotId === undefined ? [] : [[token.slotId, [{ start: x, end: x + 1 }]] as [string, SlotRange[]]]));
  const groupsBySlot = new Map(groups.map((group) => [group.slotId, group]));
  const children = new Map<string, { split: SlotSplit; right: boolean }>(splits.flatMap((split) => [
    [split.leftSlotId, { split, right: false }] as const,
    [split.rightSlotId, { split, right: true }] as const,
  ]));
  const visiting = new Set<string>();
  function resolve(id: string): SlotRange[] {
    const cached = ranges.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Cyclic slot reference: ${id}`);
    visiting.add(id);
    const child = children.get(id);
    const group = groupsBySlot.get(id);
    let result: SlotRange[];
    if (child) {
      const source = resolve(child.split.slotId);
      if (source.length !== 1) throw new Error('分割には連続した領域が必要です');
      const { start, end } = source[0];
      const middle = (start + end) / 2;
      result = [{ start: child.right ? middle : start, end: child.right ? end : middle }];
    } else if (group) {
      result = mergeRanges(group.slots.flatMap(resolve));
    } else throw new Error(`Unknown slot reference: ${id}`);
    if (!result.length) throw new Error(`Group has no base slots: ${id}`);
    visiting.delete(id);
    ranges.set(id, result);
    return result;
  }
  for (const group of groups) resolve(group.slotId);
  for (const id of children.keys()) resolve(id);
  const boundaries = [...new Set([...Array.from({ length: tokens.length + 1 }, (_, x) => x), ...[...ranges.values()].flatMap((regions) =>
    regions.flatMap(({ start, end }) => [start, end]))])].sort((a, b) => a - b);
  const indices = new Map(boundaries.map((boundary, index) => [boundary, index]));
  const atoms: LogicalAtom[] = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const tokenIndex = Math.floor(start);
    const tokenSlotId = tokens[tokenIndex].slotId;
    const atomId = tokenSlotId ?? `token:${tokens[tokenIndex].id}`;
    return { start: index, end: index + 1, tokenIndex, tokenSlotId,
      id: Number.isInteger(start) && end === start + 1 ? atomId : `${atomId}@${start}:${end}` };
  });
  const rangesBySlot = new Map([...ranges].map(([id, regions]) => [id, regions.map(({ start, end }) =>
    ({ start: indices.get(start)!, end: indices.get(end)! }))]));
  const tokenRanges = tokens.map((_, x) => ({ start: indices.get(x)!, end: indices.get(x + 1)! }));
  return { atoms, rangesBySlot, tokenRanges };
}

export function getSlotRanges(tokens: readonly Token[], groups: readonly Group[], splits: readonly SlotSplit[] = []) {
  return getSlotGeometry(tokens, groups, splits).rangesBySlot;
}

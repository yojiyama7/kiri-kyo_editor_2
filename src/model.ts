import { getSlotRanges } from './slotGeometry.ts';
import { isMarker, type Marker } from './markers.ts';
import { FORM_LABELS, isFormId, type FormId } from './inputIds.ts';

export { FORM_LABELS, isFormId, type FormId } from './inputIds.ts';

export type Slot = { id: string; marker?: Marker };

type TokenFields = {
  id: string;
  text: string;
  slotId: string;
  form?: FormId;
};
// Missing kind preserves saved real tokens from before pseudo-token support.
export type RealToken = TokenFields & { kind?: 'real' };
export type PseudoToken = TokenFields & { kind: 'pseudo' };
export type OpenBracketToken = { id: string; kind: 'bracket-open'; text: '['; slotId: string };
export type CloseBracketToken = { id: string; kind: 'bracket-close'; text: ']'; slotId?: never };
export type OpenParenToken = { id: string; kind: 'paren-open'; text: '('; slotId: string };
export type CloseParenToken = { id: string; kind: 'paren-close'; text: ')'; slotId?: never };
export type OpenAngleToken = { id: string; kind: 'angle-open'; text: '<'; slotId: string };
export type CloseAngleToken = { id: string; kind: 'angle-close'; text: '>'; slotId?: never };
export type BracketToken = OpenBracketToken | CloseBracketToken | OpenParenToken | CloseParenToken | OpenAngleToken | CloseAngleToken;
export type BracketText = BracketToken['text'];
export type Token = RealToken | PseudoToken | BracketToken;
export function isBracketText(text: string): text is BracketText {
  return text === '[' || text === ']' || text === '(' || text === ')' || text === '<' || text === '>';
}
export function isBracket(token: Token): token is BracketToken {
  return token.kind === 'bracket-open' || token.kind === 'bracket-close'
    || token.kind === 'paren-open' || token.kind === 'paren-close'
    || token.kind === 'angle-open' || token.kind === 'angle-close';
}
export function hasTokenSlot(token: Token): token is RealToken | PseudoToken | OpenBracketToken | OpenParenToken | OpenAngleToken {
  return token.slotId !== undefined;
}
export function isVirtualBracket(token: Token): token is OpenParenToken | OpenAngleToken {
  return token.kind === 'paren-open' || token.kind === 'angle-open';
}
export function isBasicToken(token: Token): token is RealToken | PseudoToken {
  return !isBracket(token);
}

export type GroupKind = 'basic' | 'composite';

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  basic: '基礎下線',
  composite: '複合下線',
};

export type Group = {
  kind: GroupKind;
  id: string;
  slotId: string;
  slots: string[];
  form?: FormId;
};

// Missing kind is the original T split representation accepted by the current v6 schema.
export type SlotSplit = { slotId: string; leftSlotId: string; rightSlotId: string; kind?: 't' | 'd'; leftForm?: FormId; rightForm?: FormId };
export type TSplit = SlotSplit;
// Missing kind denotes the original directed arrow. Apposition endpoints are symmetric.
export type Arrow = { sourceSlotId: string; targetSlotId: string; kind?: 'apposition' };

export function isArrowMarker(marker: Marker | undefined): boolean {
  return typeof marker === 'string' && ['marker.adjective', 'marker.adverb', 'marker.adverbialObjective', 'marker.sentenceAdverb'].includes(marker);
}

export function isAppositionMarker(marker: Marker | undefined): boolean {
  return typeof marker === 'string' && ['marker.noun', 'marker.subject', 'marker.object', 'marker.nounComplement'].includes(marker);
}

export function isAppositionEndpoint(marker: Marker | undefined): boolean {
  return marker === undefined || isAppositionMarker(marker);
}

export type SavedState = {
  version: 6;
  arrows: Arrow[];
  splits: SlotSplit[];
  tokens: Token[];
  slots: Slot[];
  groups: Group[];
  translation: string;
};

type SlotDocument = { tokens: readonly Token[]; slots: readonly Slot[] };

export function isSlotEditable(document: SlotDocument, slotId: string): boolean {
  return document.slots.some(slot => slot.id === slotId)
    && !document.tokens.some(token => isVirtualBracket(token) && token.slotId === slotId);
}

// A virtual bracket's ad meaning belongs to the token, never to an editable label.
export function effectiveSlotMarker(document: SlotDocument, slotId: string): Marker | undefined {
  const slot = document.slots.find(slot => slot.id === slotId);
  if (!slot) return undefined;
  return document.tokens.some(token => isVirtualBracket(token) && token.slotId === slotId)
    ? 'marker.adverb' : slot.marker;
}

export function hasBasicContents(tokens: readonly Token[], slots: readonly Slot[], slotIds: readonly string[], splits: readonly SlotSplit[] = []): boolean {
  const baseSlotIds = new Set([...tokens.filter(isBasicToken).map((token) => token.slotId), ...splits.filter((split) => split.kind === 'd').flatMap((split) => [split.leftSlotId, split.rightSlotId])]);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  return slotIds.length > 0 && slotIds.every((id) =>
    baseSlotIds.has(id) && !splits.some((split) => split.slotId === id) && slotById.has(id) && slotById.get(id)!.marker === undefined,
  );
}

// Virtual brackets remain selectable for arrows, but never become new underline members.
export function groupContentSlotIds(tokens: readonly Token[], selectedSlotIds: readonly string[]): string[] {
  const excluded = new Set(tokens.filter(isVirtualBracket).map(token => token.slotId));
  return selectedSlotIds.filter(id => !excluded.has(id));
}

// Initial classification uses the direct contents; editing can reclassify later.
export function createGroup(tokens: readonly Token[], slots: readonly Slot[], selectedSlotIds: readonly string[], splits: readonly SlotSplit[] = []): Group {
  const contents = groupContentSlotIds(tokens, selectedSlotIds);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  if (!contents.length || contents.some((id) => !slotById.has(id))) {
    throw new Error('A group requires existing slots');
  }
  const kind: GroupKind = hasBasicContents(tokens, slots, contents, splits) ? 'basic' : 'composite';
  return { id: crypto.randomUUID(), slotId: crypto.randomUUID(), kind, slots: contents };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSavedState(value: unknown): value is SavedState {
  if (
    !isRecord(value)
    || value.version !== 6
    || !Array.isArray(value.arrows)
    || !Array.isArray(value.splits)
    || !Array.isArray(value.tokens)
    || !Array.isArray(value.slots)
    || !Array.isArray(value.groups)
    || typeof value.translation !== 'string'
  ) return false;

  const validSlots = value.slots.every((slot) => isRecord(slot) && isNonEmptyString(slot.id)
    && (slot.marker === undefined || isMarker(slot.marker)));
  const validTokens = value.tokens.every((token) =>
    isRecord(token)
    && isNonEmptyString(token.id)
    && typeof token.text === 'string'
    && token.text.length > 0
    && (token.kind === 'bracket-open' || token.kind === 'bracket-close' || token.kind === 'paren-open' || token.kind === 'paren-close'
      || token.kind === 'angle-open' || token.kind === 'angle-close'
      ? token.form === undefined : token.form === undefined || isFormId(token.form))
    && (token.kind === 'bracket-close' ? token.text === ']' && token.slotId === undefined
      : token.kind === 'paren-close' ? token.text === ')' && token.slotId === undefined
      : token.kind === 'angle-close' ? token.text === '>' && token.slotId === undefined
      : isNonEmptyString(token.slotId) && (token.kind === 'bracket-open' ? token.text === '['
        : token.kind === 'paren-open' ? token.text === '('
        : token.kind === 'angle-open' ? token.text === '<'
        : token.kind === undefined || token.kind === 'real' || token.kind === 'pseudo'))
  );
  const validGroups = value.groups.every((group) =>
    isRecord(group)
    && isNonEmptyString(group.id)
    && isNonEmptyString(group.slotId)
    && (group.kind === 'basic' || group.kind === 'composite')
    && (group.form === undefined || isFormId(group.form))
    && Array.isArray(group.slots)
    && group.slots.length > 0
    && group.slots.every(isNonEmptyString)
  );
  if (!validSlots || !validTokens || !validGroups) return false;

  const splits = (value.splits ?? []) as SlotSplit[];
  if (!splits.every((split) => isRecord(split) && isNonEmptyString(split.slotId)
    && isNonEmptyString(split.leftSlotId) && isNonEmptyString(split.rightSlotId)
    && (split.kind === undefined || split.kind === 't' || split.kind === 'd')
    && (split.leftForm === undefined || (split.kind === 'd' && isFormId(split.leftForm)))
    && (split.rightForm === undefined || (split.kind === 'd' && isFormId(split.rightForm))))) return false;
  const saved = value as SavedState;
  const slotIds = saved.slots.map((slot) => slot.id);
  const tokenIds = saved.tokens.map((token) => token.id);
  const groupIds = saved.groups.map((group) => group.id);
  if (
    new Set(slotIds).size !== slotIds.length
    || new Set(tokenIds).size !== tokenIds.length
    || new Set(groupIds).size !== groupIds.length
  ) return false;

  const slotIdSet = new Set(slotIds);
  if (saved.tokens.some(token => isVirtualBracket(token)
    && saved.slots.find(slot => slot.id === token.slotId)?.marker !== undefined)) return false;
  const arrowSources = new Set<string>();
  const appositionSlots = new Set<string>();
  for (const arrow of saved.arrows) {
    if (!isRecord(arrow) || !isNonEmptyString(arrow.sourceSlotId) || !isNonEmptyString(arrow.targetSlotId)
      || !slotIdSet.has(arrow.sourceSlotId) || !slotIdSet.has(arrow.targetSlotId)
      || arrow.sourceSlotId === arrow.targetSlotId
      || (arrow.kind !== undefined && arrow.kind !== 'apposition')) return false;
    if (arrow.kind === 'apposition') {
      for (const id of [arrow.sourceSlotId, arrow.targetSlotId]) {
        if (appositionSlots.has(id)
          || !isAppositionEndpoint(effectiveSlotMarker(saved, id))) return false;
        appositionSlots.add(id);
      }
    } else {
      if (arrowSources.has(arrow.sourceSlotId)
        || !isArrowMarker(effectiveSlotMarker(saved, arrow.sourceSlotId))) return false;
      arrowSources.add(arrow.sourceSlotId);
    }
  }
  const ownerSlotIds = [
    ...saved.tokens.filter(hasTokenSlot).map((token) => token.slotId),
    ...saved.groups.map((group) => group.slotId),
    ...splits.flatMap((split) => [split.leftSlotId, split.rightSlotId]),
  ];
  if (
    new Set(ownerSlotIds).size !== ownerSlotIds.length
    || ownerSlotIds.length !== slotIds.length
    || ownerSlotIds.some((slotId) => !slotIdSet.has(slotId))
    || saved.groups.some((group) => group.slots.some((slotId) => !slotIdSet.has(slotId)))
  ) return false;

  const baseSlotIds = new Set([...saved.tokens.filter(isBasicToken).map((token) => token.slotId), ...splits.filter((split) => split.kind === 'd').flatMap((split) => [split.leftSlotId, split.rightSlotId])]);
  if (saved.groups.some((group) => group.kind === 'basic'
    && group.slots.some((slotId) => !baseSlotIds.has(slotId)))) return false;

  const sources = new Set([...saved.tokens.filter(isBasicToken).map((token) => token.slotId),
    ...saved.groups.filter((group) => group.kind === 'basic').map((group) => group.slotId)]);
  const doubleSources = new Set([...saved.tokens.filter(isBasicToken).map((token) => token.slotId),
    ...saved.groups.map((group) => group.slotId)]);
  if (new Set(splits.map((split) => split.slotId)).size !== splits.length
    || splits.some((split) => !(split.kind === 'd' ? doubleSources : sources).has(split.slotId)
      || saved.slots.find((slot) => slot.id === split.slotId)?.marker !== undefined)) return false;
  try {
    getSlotRanges(saved.tokens, saved.groups, splits);
    return true;
  } catch {
    return false;
  }
}

/** Upgrade slotless opening parentheses at the read boundary; runtime validation stays strict. */
export function readSavedState(value: unknown): SavedState | undefined {
  if (!isRecord(value) || value.version !== 6 || !Array.isArray(value.tokens) || !Array.isArray(value.slots)) return undefined;
  if (!value.tokens.some(token => isRecord(token) && token.kind === 'paren-open' && token.slotId === undefined)) {
    return isSavedState(value) ? value : undefined;
  }
  // Reserve references as well as owners, so migration cannot repair dangling references.
  const used = new Set<string>();
  function reserve(item: unknown): void {
    if (typeof item === 'string') used.add(item);
    else if (Array.isArray(item)) item.forEach(reserve);
    else if (isRecord(item)) Object.values(item).forEach(reserve);
  }
  reserve(value);
  const slots = [...value.slots];
  const tokens = value.tokens.map(token => {
    if (!isRecord(token) || token.kind !== 'paren-open' || token.slotId !== undefined) return token;
    if (!isNonEmptyString(token.id)) return token;
    // Stable across repeated reads of an old database before its next save.
    const base = `paren:${token.id}`;
    let slotId = base;
    for (let suffix = 1; used.has(slotId); suffix++) slotId = `${base}:${suffix}`;
    used.add(slotId);
    slots.push({ id: slotId });
    return { ...token, slotId };
  });
  const next = { ...value, tokens, slots };
  return isSavedState(next) ? next : undefined;
}

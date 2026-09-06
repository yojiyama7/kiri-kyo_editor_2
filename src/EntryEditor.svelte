<script lang="ts">
  import { moveBorderOperation } from './borderNavigation';
  import { resolveInput, sequenceBindings, getSettings, isComposingInput, isRepeatedInput, operationMatches, type Candidate, type Resolution, type InputMode, type BindingSettings } from './keybindings';
  import { matchesKeyboardInput } from './keyboard';
  import { type KeyboardOperationId } from './keyboardOperations';
  import { createGroup, FORM_LABELS, GROUP_KIND_LABELS, isBracket, type BracketText, type Group, type SavedState, type SlotSplit, type Arrow, isArrowMarker, isAppositionMarker, isAppositionEndpoint } from './model';
  import { isVirtualBracket, isSlotEditable, effectiveSlotMarker, groupContentSlotIds, type FormId } from './model';
  import { formIdForInput, formTargetAtSlot, formTargets, setFormAtSlot, formDisplay, type FormSession } from './formEditing';
  import { renderForms, visibleFormTargets } from './formRender';
  import { connectArrow, connectApposition, deleteArrow, pruneArrows } from './arrowEditing';
  import { renderArrows } from './arrowRender';
  import { splitSlot, unsplitSlot } from './tEditing';
  import { deleteGroup } from './structureDeletion';
  import { BRACKET_GUTTER, BRACKET_SLOT_MIN_WIDTH, CLOSE_BRACKET_WIDTH, computeRenderLayout } from './renderLayout';
  import { bracketBorderFromRegion, insertBracket, deleteBracket } from './bracketEditing';
  import { borderFromCursor, cursorFromBorder, borderPosition } from './borderNavigation';
  import { realSentence, replaceEnglishSentence, pseudoTokenAtSlot, insertPseudoToken, insertPseudoTokens, deletePseudoToken, editPseudoToken, splitPseudoInput, pseudoInputAction, type PseudoInputSession } from './pseudoEditing';
  import { pseudoPreview, widthsByToken, inputOverlayOffset } from './pseudoPreview';
  import { measureLabels } from './labelMeasurements';
  import { type EditorSnapshot } from './history';
  import { enterBasicGroup, groupsForEditing, reclassifyGroups, settleOpenedGroups } from './groupEditing';
  import type { EntryEditorState, EntryInputMode } from './entryDocument';
  import { markerFromText, markerLabel, setSlotMarker, type MarkerId } from './markers';
  import { customMarkerInputAction, type CustomMarkerInputSession } from './customMarkerEditing';
  import { operationKeyLabel } from './keybindings';
  import {
    type Cursor,
    computeLayout,
    slotPosition,
    relocateCursor,
    containsX,
    groupAt,
    slotAt,
    regionAt,
    groupForDeletion,
    nearestCursor,
    selectSlotRange,
    toggleSlotSelection,
    moveLeft,
    moveRight,
    moveVertical as getVerticalCursor,
    moveToRowEdge as getRowEdgeCursor,
  } from './layout';

  type Mode = 'NORMAL' | 'BORDER' | 'VISUAL' | 'VISUAL_MULTI' | 'ARROW' | 'INSERT' | 'TRANSLATION' | 'PSEUDO_INPUT' | 'MARKER_INPUT' | 'MARKER_SEQUENCE' | 'FORM';

  function bracketTextForOperation(operation: KeyboardOperationId | undefined): BracketText | undefined {
    if (operation === 'bracket.insertSquareOpen') return '[';
    if (operation === 'bracket.insertSquareClose') return ']';
    if (operation === 'bracket.insertRoundOpen') return '(';
    if (operation === 'bracket.insertRoundClose') return ')';
    if (operation === 'bracket.insertAngleOpen') return '<';
    if (operation === 'bracket.insertAngleClose') return '>';
  }

  export let initial: SavedState;
  export let active = false;

  const arrowMarkerLabels = (['marker.adjective', 'marker.adverb', 'marker.adverbialObjective', 'marker.sentenceAdverb'] satisfies MarkerId[])
    .map(markerLabel).join(' / ');
  const appositionMarkerLabels = (['marker.noun', 'marker.subject', 'marker.object', 'marker.nounComplement', 'marker.plus'] satisfies MarkerId[])
    .map(markerLabel).join(' / ');
  export let bindingSettings: BindingSettings = getSettings();
  $: formInputGuide = sequenceBindings<FormId>('form', bindingSettings).map(binding => `${binding.sequence} ${FORM_LABELS[binding.value]}`).join(' / ');
  $: keyLabel = (operation: KeyboardOperationId, separator = ' / ') => { bindingSettings; return operationKeyLabel(operation, separator); };
  export let onrecord: (before: EditorSnapshot, after: EditorSnapshot) => void;
  export let onstate: (state: EntryEditorState) => void;
  export let onactivate: () => void;
  export let onundo: (redo: boolean) => void;
  export let ontranslationactivity: (composing: boolean) => void;

  let tokens = initial.tokens;
  let slots = initial.slots;
  let groups: Group[] = initial.groups;
  let splits: SlotSplit[] = initial.splits;
  let arrows: Arrow[] = initial.arrows;
  let arrowSourceId: string | undefined;
  let arrowKind: Arrow['kind'];
  let arrowMessage = '';
  let translation = initial.translation;
  let translationComposing = false;
  let sentenceDraft = realSentence(initial.tokens);
  let mode: Mode = 'NORMAL';
  let formSession: FormSession | null = null;
  let pseudoInput: PseudoInputSession | null = null;
  let customMarkerInput: CustomMarkerInputSession | null = null;
  let pseudoMessage = '';
  let borderIndex = 0;
  let cursorX = 0;
  let cursorY = 0;
  let anchor: Cursor | null = null;
  let individualSlots: string[] = [];
  let activeGroup: Group | undefined;
  const history = { record: (before: EditorSnapshot, after: EditorSnapshot) => onrecord(before, after) };
  let inputStart: EditorSnapshot | null = null;
  let diagramWidth = 1;
  let tokenWidthById = new Map<string, number>();
  let pseudoInputWidth = 24;
  let pseudoInputOffset = { left: 4, top: 12 };
  let customMarkerInputWidth = 24;
  let customMarkerInputOffset = { left: 4, top: 12 };
  let groupLabelWidths = new Map<string, number>();
  let splitMinimumWidths = new Map<string, number>();
  let markerBuffer = '';
  let markerSlotId: string | undefined;
  let markerStart: EditorSnapshot | null = null;
  let openedGroupIds = new Set<string>();

  $: editingGroups = groupsForEditing(groups, openedGroupIds);
  $: layout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
  $: preview = pseudoPreview({ tokens, slots, groups, splits, arrows, translation }, pseudoInput);
  $: displayTokens = preview.document.tokens;
  $: inputTokenId = preview.inputTokenId;
  $: displayLayout = computeLayout(displayTokens, editingGroups, splits, arrows);
  $: allFormTargets = formTargets(preview.document);
  $: visibleFormIds = new Set(visibleFormTargets(preview.document, displayLayout).map(target => target.slotId));
  $: tokenWidths = widthsByToken(displayTokens, tokenWidthById);

  $: slotById = new Map(preview.document.slots.map((slot) => [slot.id, slot]));
  $: splitBySource = new Map(splits.map((split) => [split.slotId, split]));
  $: currentId = active && mode !== 'BORDER' && mode !== 'PSEUDO_INPUT' ? slotAt(layout, cursorX, cursorY) : undefined;
  $: currentRegion = mode === 'BORDER' || mode === 'PSEUDO_INPUT' ? undefined : regionAt(layout, cursorX, cursorY);
  $: snapshotCursor = pseudoInput ? pseudoInput.before.cursor
    : mode === 'BORDER' ? cursorFromBorder(layout, borderIndex) : { x: cursorX, y: cursorY };
  $: pendingMarkerSlotId = customMarkerInput?.slotId
    ?? (markerBuffer && markerSlotId === currentId ? markerSlotId : undefined);
  $: pendingMarkerText = customMarkerInput ? customMarkerInput.text || ' ' : markerBuffer;
  $: measurements = measureLabels(displayTokens, preview.document.slots, groups, splits, arrows, pendingMarkerSlotId, pendingMarkerText);
  $: renderLayout = computeRenderLayout(displayTokens, editingGroups, splits, tokenWidths, diagramWidth,
    groupLabelWidths, pendingMarkerSlotId ? { slotId: pendingMarkerSlotId, x: cursorX }
      : formSession && groups.some(group => group.slotId === formSession?.slotId) && !splitBySource.has(formSession.slotId)
        ? { slotId: formSession.slotId, x: cursorX } : undefined,
    { unclampedTokenId: inputTokenId, splitMinimumWidths });
  $: tokenRows = renderLayout.rows;
  $: borderRenderPosition = borderPosition(renderLayout.columns, borderIndex);
  $: pendingMarkerRegions = pendingMarkerSlotId ? renderLayout.regionsBySlot.get(pendingMarkerSlotId) ?? [] : [];
  $: pendingMarkerRegion = pendingMarkerRegions.find((region) =>
    region.logicalRanges.some((range) => range.start <= cursorX && cursorX < range.end))
    ?? pendingMarkerRegions[pendingMarkerRegions.length - 1];
  $: rowStarts = new Set(tokenRows.map((row) => row.start));
  $: highlightedContentSlotIds = new Set(groups
    .filter((group) => group.slotId === currentId || selectedSlotIds.has(group.slotId))
    .flatMap((group) => group.slots)
    .filter((id) => id !== currentId && !selectedSlotIds.has(id)));
  $: contentHighlights = [...highlightedContentSlotIds].flatMap((id) =>
    (displayTokens.some(token => isVirtualBracket(token) && token.slotId === id)
      ? [] : renderLayout.regionsBySlot.get(id) ?? []).map((region) => ({
      ...region, slotId: id, y: displayLayout.slotY.get(id) ?? 0,
    })));
  $: arrowSegments = renderArrows(displayLayout, renderLayout.regionsBySlot, preview.document.slots, renderLayout.columns);
  $: formRegions = renderForms(preview.document, displayLayout, renderLayout.regionsBySlot, formSession);
  $: displayRows = tokenRows.map((row, rowIndex) => ({
    ...row,
    width: Math.max(diagramWidth, renderLayout.rowWidths[rowIndex]),
    columns: renderLayout.columns.slice(row.start, row.end + 1).flatMap((column, i, columns) => [
      column.left - (i ? columns[i - 1].right : 0), column.right - column.left,
    ]).concat(Math.max(0, renderLayout.rowWidths[rowIndex] - renderLayout.columns[row.end].right)),
    arrows: arrowSegments.filter((segment) => segment.row === rowIndex),
    forms: formRegions.filter(region => region.row === rowIndex),
    formHeight: Math.max(0, ...formRegions.filter(region => region.row === rowIndex).map(region => (region.lane + 1) * 18)),
    // Keep at least two display rows: the English row and one structure row.
    maxY: Math.max(1, ...displayLayout.groups.filter((placement) =>
      renderLayout.regionsBySlot.get(placement.group.slotId)!.some((region) => region.row === rowIndex)).map((placement) => placement.y),
      ...arrowSegments.filter((segment) => segment.row === rowIndex).map((segment) => segment.logicalY)),
    highlights: contentHighlights.filter((region) => region.row === rowIndex),
    groups: displayLayout.groups.map((placement) => ({
      placement,
      segments: renderLayout.regionsBySlot.get(placement.group.slotId)!.filter((region) => region.row === rowIndex),
    })).filter(({ segments }) => segments.length > 0),
  }));
  $: {
    const cursor = nearestCursor(layout, { x: cursorX, y: cursorY });
    cursorX = cursor.x;
    cursorY = cursor.y;
  }
  $: activeGroup = mode === 'BORDER' || mode === 'PSEUDO_INPUT' ? undefined : groupAt(layout, cursorX, cursorY)?.group;
  $: selecting = mode === 'VISUAL' || mode === 'VISUAL_MULTI';
  $: selectedSlots = mode === 'VISUAL_MULTI' ? individualSlots
    : anchor === null ? [] : selectSlotRange(layout, anchor, { x: cursorX, y: cursorY });
  $: selectedSlotIds = new Set(selectedSlots);
  // Capture reactive dependencies, but assemble the debug payload only on demand.
  $: getDisplay = () => ({
    active,
    mode,
    cursor: { ...snapshotCursor, slotId: mode === 'BORDER' || mode === 'PSEUDO_INPUT' ? null : slotAt(layout, cursorX, cursorY) ?? null },
    borderIndex: mode === 'BORDER' ? borderIndex : null,
    borderPosition: mode === 'BORDER' ? borderRenderPosition : null,
    currentRegion: currentRegion ?? null,
    activeGroupId: activeGroup?.id ?? null,
    anchor,
    selecting,
    selectedSlotIds: selectedSlots,
    highlightedContentSlotIds,
    individualSlots,
    arrowSourceId,
    arrowKind,
    arrowMessage,
    arrowSegments,
    markerInput: { buffer: markerBuffer, slotId: markerSlotId ?? null, active: markerStart !== null },
    sentenceDraft,
    pseudoInput,
    customMarkerInput,
    pseudoMessage,
    formSession,
    openedGroupIds,
    formRegions,
    previewDocument: pseudoInput ? preview.document : null,
    displayLayout,
    inputTokenId,
    pseudoInputWidth,
    pseudoInputOffset,
    customMarkerInputWidth,
    customMarkerInputOffset,
    textEditing: inputStart !== null || pseudoInput !== null || customMarkerInput !== null || formSession !== null,
    document: { tokens, slots, groups, splits, arrows, translation },
    layout,
    diagramWidth,
    tokenWidths,
    groupLabelWidths,
    splitMinimumWidths,
    tokenRows,
    rowStarts,
    displayRows,
  });
  $: onstate({
    snapshot: { document: { tokens, slots, groups, splits, arrows, translation }, cursor: snapshotCursor },
    mode, pendingMarker: markerStart !== null, getDisplay,
  });

  function clickSlotId(id: string) {
    const position = slotPosition(layout, id);
    if (position) clickSlot(position.x, position.y);
  }

  function visibleSlot(currentLayout: typeof layout, id: string): boolean {
    const position = slotPosition(currentLayout, id);
    return !!position && slotAt(currentLayout, position.x, position.y) === id;
  }

  function measureDiagram(node: HTMLElement, _state: unknown) {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Reserve room for endpoint dots and the selection outline on both sides.
        const width = Math.max(1, node.clientWidth - 8);
        if (diagramWidth !== width) diagramWidth = width;
        const elements = node.querySelectorAll<HTMLElement>('.token-measure');
        const widths = new Map(Array.from(elements, (element) =>
          [element.dataset.tokenId!, element.getBoundingClientRect().width] as const));
        if (widths.size !== tokenWidthById.size || [...widths].some(([id, value]) => tokenWidthById.get(id) !== value)) {
          tokenWidthById = widths;
        }
        // Intrinsic mirror only: never measure the input or its sized anchor as
        // the source of the next width, which would create a feedback loop.
        const mirror = node.querySelector<HTMLElement>('.pseudo-input-measure');
        if (mirror) {
          const width = mirror.getBoundingClientRect().width;
          if (pseudoInputWidth !== width) pseudoInputWidth = width;
        }
        const anchor = node.querySelector<HTMLElement>('.pseudo-input-anchor');
        if (anchor) {
          const offset = inputOverlayOffset(anchor.getBoundingClientRect(), node.getBoundingClientRect(),
            node.scrollLeft, node.scrollTop, node.clientLeft, node.clientTop);
          if (offset.left !== pseudoInputOffset.left || offset.top !== pseudoInputOffset.top) pseudoInputOffset = offset;
        }
        const markerMirror = node.querySelector<HTMLElement>('.custom-marker-input-measure');
        if (markerMirror) {
          const width = markerMirror.getBoundingClientRect().width;
          if (customMarkerInputWidth !== width) customMarkerInputWidth = width;
        }
        const markerAnchor = node.querySelector<HTMLElement>('.custom-marker-input-anchor');
        if (markerAnchor) {
          const offset = inputOverlayOffset(markerAnchor.getBoundingClientRect(), node.getBoundingClientRect(),
            node.scrollLeft, node.scrollTop, node.clientLeft, node.clientTop);
          if (offset.left !== customMarkerInputOffset.left || offset.top !== customMarkerInputOffset.top) customMarkerInputOffset = offset;
        }
        const groupElements = node.querySelectorAll<HTMLElement>('.group-measure');
        const groupWidths = new Map(Array.from(groupElements, (element) =>
          [element.dataset.slotId!, element.getBoundingClientRect().width] as const));
        if (groupWidths.size !== groupLabelWidths.size || [...groupWidths].some(([id, value]) => groupLabelWidths.get(id) !== value)) {
          groupLabelWidths = groupWidths;
        }
        const splitElements = node.querySelectorAll<HTMLElement>('.split-half-measure');
        const splitWidths = new Map<string, number>();
        for (const element of splitElements) {
          const id = element.dataset.splitSlotId!;
          splitWidths.set(id, Math.max(splitWidths.get(id) ?? 0, element.getBoundingClientRect().width));
        }
        if (splitWidths.size !== splitMinimumWidths.size
          || [...splitWidths].some(([id, value]) => splitMinimumWidths.get(id) !== value)) splitMinimumWidths = splitWidths;
        for (const element of elements) observer.observe(element);
        for (const element of groupElements) observer.observe(element);
        for (const element of splitElements) observer.observe(element);
        for (const element of node.querySelectorAll('.diagram-row')) observer.observe(element);
        if (anchor) observer.observe(anchor);
        if (markerAnchor) observer.observe(markerAnchor);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return {
      update(_state: unknown) {
        observer.disconnect();
        observer.observe(node);
        measure();
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
      },
    };
  }

  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  function focusTranslation(node: HTMLTextAreaElement, editing: boolean) {
    const update = (active: boolean) => {
      if (active) node.focus();
      // Keep the first line at the same origin after ending an edit.
      node.scrollTop = 0;
      node.scrollLeft = 0;
    };
    update(editing);
    return { update };
  }

  function sentenceFromTokens(): string {
    return realSentence(tokens);
  }

  function startPseudoInput() {
    const before = snapshot();
    pseudoMessage = '';
    if (mode === 'BORDER') {
      const token = { id: crypto.randomUUID(), slotId: crypto.randomUUID(), kind: 'pseudo' as const, text: ' ' };
      const result = insertPseudoToken(before.document, borderIndex, token);
      if (!result.ok) { pseudoMessage = result.message; return; }
      pseudoInput = { kind: 'create', before, borderIndex, token, text: '', composing: false };
    } else {
      const token = pseudoTokenAtSlot(before.document, currentSlotId());
      if (!token) return;
      pseudoInput = { kind: 'edit', before, tokenId: token.id, text: token.text, composing: false };
    }
    mode = 'PSEUDO_INPUT';
  }

  function startCustomMarkerInput() {
    finishMarkerInput();
    const before = snapshot();
    const slotId = currentSlotId();
    if (slotId === undefined || !isSlotEditable(before.document, slotId)) return;
    const marker = before.document.slots.find((slot) => slot.id === slotId)?.marker;
    customMarkerInput = { before, slotId, text: markerLabel(marker), composing: false };
    mode = 'MARKER_INPUT';
  }

  function cancelCustomMarkerInput() {
    const session = customMarkerInput;
    if (!session) return;
    customMarkerInput = null;
    cursorX = session.before.cursor.x;
    cursorY = session.before.cursor.y;
    mode = 'NORMAL';
  }

  function commitCustomMarkerInput() {
    const session = customMarkerInput;
    if (!session) return;
    const current = snapshot().document;
    const slots = setSlotMarker(current.slots, session.slotId, markerFromText(session.text));
    const withMarker = slots.every((slot, index) => slot === current.slots[index]) ? current : { ...current, slots };
    const next = pruneArrows(withMarker);
    const changed = next !== current;
    customMarkerInput = null;
    mode = 'NORMAL';
    applyDocument(next, session.slotId);
    if (changed) history.record(session.before, snapshot());
  }

  function handleCustomMarkerKeydown(event: KeyboardEvent) {
    if (!customMarkerInput) return;
    if (operationMatches(event, 'history.redo')) event.preventDefault();
    const action = customMarkerInputAction(event, customMarkerInput.composing);
    if (!action) return;
    event.preventDefault();
    if (action === 'marker.customCommit') commitCustomMarkerInput();
    else cancelCustomMarkerInput();
  }

  function insertBorderBracket(text: BracketText) {
    const before = snapshot();
    const result = insertBracket(before.document, borderIndex, text);
    if (!result.ok) { pseudoMessage = result.message; return; }
    ({ tokens, slots, groups, splits, arrows, translation } = result.document);
    borderIndex += 1;
    history.record(before, snapshot());
  }

  function insertRegionBracket(text: BracketText) {
    pseudoMessage = '';
    const before = snapshot();
    const beforeLayout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
    const border = bracketBorderFromRegion(tokens, beforeLayout, before.cursor, text);
    if (!border.ok) { pseudoMessage = border.message; return; }
    const result = insertBracket(before.document, border.index, text);
    if (!result.ok) { pseudoMessage = result.message; return; }
    const next = result.document;
    const nextLayout = computeLayout(next.tokens, groupsForEditing(next.groups, openedGroupIds), next.splits, next.arrows);
    const slotId = slotAt(beforeLayout, before.cursor.x, before.cursor.y)!;
    const atom = beforeLayout.atoms[before.cursor.x];
    // Insertion preserves each existing token's cuts. Anchor within that token:
    // split atom IDs contain absolute token offsets and can change on insertion.
    const tokenIndex = atom.tokenIndex + (atom.tokenIndex >= border.index ? 1 : 0);
    const offset = before.cursor.x - beforeLayout.tokenRanges[atom.tokenIndex].start;
    ({ tokens, slots, groups, splits, arrows, translation } = next);
    cursorX = nextLayout.tokenRanges[tokenIndex].start + offset;
    cursorY = nextLayout.slotY.get(slotId)!;
    history.record(before, snapshot());
  }

  function deleteBorderItem(index: number) {
    const before = snapshot();
    const token = before.document.tokens[index];
    const next = token?.kind === 'pseudo' ? deletePseudoToken(before.document, token.id)
      : deleteBracket(before.document, index);
    if (next === before.document) return;
    ({ tokens, slots, groups, splits, arrows, translation } = next);
    borderIndex = Math.max(0, Math.min(borderIndex - (index < borderIndex ? 1 : 0), tokens.length));
    history.record(before, snapshot());
  }

  function cancelPseudoInput() {
    const session = pseudoInput;
    if (!session) return;
    pseudoInput = null;
    cursorX = session.before.cursor.x;
    cursorY = session.before.cursor.y;
    if (session.kind === 'create') {
      borderIndex = session.borderIndex;
      mode = 'BORDER';
    } else mode = 'NORMAL';
  }

  function commitPseudoInput() {
    const session = pseudoInput;
    if (!session) return;
    const parts = session.kind === 'create' ? splitPseudoInput(session.text) : [];
    if (session.kind === 'create' && parts.length === 0) { cancelPseudoInput(); return; }
    let next: SavedState;
    let cursor: Cursor;
    if (session.kind === 'create') {
      const inserted = parts.map((text, index) => index === 0 ? { ...session.token, text } : {
        id: crypto.randomUUID(), slotId: crypto.randomUUID(), kind: 'pseudo' as const, text,
      });
      const result = insertPseudoTokens(session.before.document, session.borderIndex, inserted);
      if (!result.ok) { pseudoMessage = result.message; cancelPseudoInput(); return; }
      next = result.document;
      borderIndex = session.borderIndex + inserted.length;
      mode = 'BORDER';
      cursor = cursorFromBorder(computeLayout(next.tokens, groupsForEditing(next.groups, openedGroupIds), next.splits, next.arrows), borderIndex);
    } else {
      next = editPseudoToken(session.before.document, session.tokenId, session.text);
      const index = session.before.document.tokens.findIndex((token) => token.id === session.tokenId);
      cursor = session.text === '' ? cursorFromBorder(computeLayout(next.tokens, groupsForEditing(next.groups, openedGroupIds), next.splits, next.arrows), index)
        : session.before.cursor;
      mode = 'NORMAL';
    }
    pseudoInput = null;
    ({ tokens, slots, groups, splits, arrows, translation } = next);
    cursorX = cursor.x;
    cursorY = cursor.y;
    if (next !== session.before.document) history.record(session.before, snapshot());
  }

  function handlePseudoKeydown(event: KeyboardEvent) {
    if (!pseudoInput) return;
    // Preserve the existing Ctrl+r reload guard without running document redo.
    if (operationMatches(event, 'history.redo')) event.preventDefault();
    const action = pseudoInputAction(event, pseudoInput.composing);
    if (!action) return;
    event.preventDefault();
    if (action === 'pseudo.commit') commitPseudoInput();
    else cancelPseudoInput();
  }

  export function canSave(leaving = false): boolean {
    return markerStart === null && (leaving || !translationComposing);
  }

  export function snapshot(): EditorSnapshot {
    const currentLayout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
    return structuredClone({
      document: { tokens, slots, groups, splits, arrows, translation },
      cursor: pseudoInput ? pseudoInput.before.cursor : mode === 'BORDER' ? cursorFromBorder(currentLayout, borderIndex) : nearestCursor(currentLayout, { x: cursorX, y: cursorY }),
    });
  }

  export function restore(state: EditorSnapshot, _settle = true) {
    cancelForm();
    // A restored normal cursor must not be replaced by a stale border index.
    if (mode === 'BORDER' || mode === 'PSEUDO_INPUT' || mode === 'MARKER_INPUT' || mode === 'MARKER_SEQUENCE') mode = 'NORMAL';
    pseudoInput = null;
    customMarkerInput = null;
    pseudoMessage = '';
    borderIndex = 0;
    inputStart = null;
    markerStart = null;
    markerSlotId = undefined;
    markerBuffer = '';
    openedGroupIds = new Set();
    // Inactive entries can retain an open basic group from an earlier edit.
    // Restoring another entry must not reclassify their saved structures.
    const document = reclassifyGroups(state.document);
    ({ tokens, slots, groups, splits, arrows, translation } = document);
    cursorX = state.cursor.x;
    cursorY = state.cursor.y;
    sentenceDraft = sentenceFromTokens();
    enterNormal();
  }

  function commitSentence() {
    const before = snapshot().document;
    const next = replaceEnglishSentence(before, sentenceDraft);
    sentenceDraft = realSentence(next.tokens);
    if (next === before) return;
    ({ tokens, slots, groups, splits, arrows } = next);
    cursorX = Math.min(cursorX, Math.max(0, tokens.length - 1));
    cursorY = 0;
  }

  function enterNormal() {
    cancelForm();
    cancelPseudoInput();
    cancelCustomMarkerInput();
    pseudoMessage = '';
    const wasTranslation = mode === 'TRANSLATION';
    if (mode === 'BORDER') {
      const cursor = cursorFromBorder(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), borderIndex);
      cursorX = cursor.x;
      cursorY = cursor.y;
    }
    borderIndex = 0;
    finishMarkerInput();
    if (mode === 'INSERT') commitSentence();
    if (inputStart) {
      settleCursor();
      history.record(inputStart, snapshot());
      inputStart = null;
    }
    const normalCursor = nearestCursor(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), { x: cursorX, y: cursorY });
    cursorX = normalCursor.x;
    cursorY = normalCursor.y;
    mode = 'NORMAL';
    arrowSourceId = undefined;
    arrowKind = undefined;
    arrowMessage = '';
    anchor = null;
    individualSlots = [];
    translationComposing = false;
    if (wasTranslation) ontranslationactivity(false);
    // Blur only the field being closed; a newly focused entry must keep focus.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) focused.blur();
  }

  function translationActivity() {
    if (mode === 'TRANSLATION') ontranslationactivity(translationComposing);
  }

  function moveVertical(direction: -1 | 1) {
    if (mode !== 'NORMAL' && mode !== 'VISUAL_MULTI' && mode !== 'ARROW') return;
    if (direction === -1) {
      const result = enterBasicGroup(snapshot().document, { x: cursorX, y: cursorY }, openedGroupIds);
      openedGroupIds = result.openedGroupIds;
      navigate(result.cursor);
    } else {
      navigate(getVerticalCursor(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), { x: cursorX, y: cursorY }, direction));
    }
  }

  function moveToRowEdge(edge: 'start' | 'end') {
    navigate(getRowEdgeCursor(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), { x: cursorX, y: cursorY }, edge));
  }

  function settleCursor() {
    const result = settleOpenedGroups(snapshot().document, { x: cursorX, y: cursorY }, anchor, openedGroupIds);
    cursorX = result.cursor.x;
    cursorY = result.cursor.y;
    anchor = result.anchor;
    openedGroupIds = result.openedGroupIds;
  }

  function navigate(cursor: Cursor, document?: SavedState) {
    const targetLayout = document ? computeLayout(document.tokens, groupsForEditing(document.groups, openedGroupIds), document.splits, document.arrows)
      : computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
    const targetId = slotAt(targetLayout, cursor.x, cursor.y);
    finishMarkerInput();
    const before = snapshot();
    const next = document ? reclassifyGroups(document) : before.document;
    const nextLayout = computeLayout(next.tokens, groupsForEditing(next.groups, openedGroupIds), next.splits, next.arrows);
    const destination = { ...cursor, y: (targetId ? nextLayout.slotY.get(targetId) : undefined) ?? cursor.y };
    ({ tokens, slots, groups, splits, arrows, translation } = next);
    cursorX = destination.x;
    cursorY = destination.y;
    settleCursor();
    history.record(before, snapshot());
  }

  function toggleCurrentSlot() {
    individualSlots = toggleSlotSelection(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), individualSlots, { x: cursorX, y: cursorY });
  }

  function clickSlot(x: number, y: number) {
    cancelForm();
    cancelPseudoInput();
    cancelCustomMarkerInput();
    if (mode === 'BORDER') return;
    onactivate();
    navigate({ x, y });
    if (mode === 'VISUAL_MULTI') toggleCurrentSlot();
  }

  function currentSlotId(): string | undefined {
    return slotAt(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), cursorX, cursorY);
  }

  function applyDocument(next: SavedState, preferredId = currentSlotId()) {
    const beforeLayout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
    const oldCursor = { x: cursorX, y: cursorY };
    next = reclassifyGroups(next);
    ({ tokens, slots, groups, splits, arrows, translation } = next);
    openedGroupIds = new Set([...openedGroupIds].filter(id => groups.some(group => group.id === id && group.kind === 'basic')));
    const nextLayout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);
    const cursor = relocateCursor(beforeLayout, nextLayout, oldCursor, preferredId);
    if (anchor) anchor = relocateCursor(beforeLayout, nextLayout, anchor);
    cursorX = cursor.x;
    cursorY = cursor.y;
    settleCursor();
  }

  export function finishMarkerInput() {
    if (markerStart) {
      applyDocument(reclassifyGroups(pruneArrows(snapshot().document)));
      const after = snapshot();
      if (JSON.stringify(markerStart.document) !== JSON.stringify(after.document)) history.record(markerStart, after);
    }
    markerStart = null;
    markerSlotId = undefined;
    markerBuffer = '';
    if (mode === 'MARKER_SEQUENCE') mode = 'NORMAL';
  }

  function handleMarkerKey(event: KeyboardEvent, winner: Candidate): boolean {
    const slotId = currentSlotId();
    if (markerSlotId !== undefined && markerSlotId !== slotId) finishMarkerInput();
    const result = { handled: true, restarted: winner.restarted,
      marker: winner.complete ? winner.operation as MarkerId : undefined,
      buffer: winner.hasLonger ? winner.buffer! : '' };
    if (result.handled && matchesKeyboardInput(event, [
      { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
    ])) {
      event.preventDefault();
      return true;
    }
    if (result.restarted || !result.handled) finishMarkerInput();
    if (!result.handled || slotId === undefined) return false;
    event.preventDefault();
    if (!isSlotEditable({ tokens, slots }, slotId)) return true;
    if (!markerStart) {
      markerStart = snapshot();
      markerSlotId = slotId;
    }
    if (result.marker !== undefined) {
      slots = setSlotMarker(slots, slotId, result.marker);
      settleCursor();
    }
    markerBuffer = result.buffer;
    if (markerBuffer) mode = 'MARKER_SEQUENCE';
    else finishMarkerInput();
    return true;
  }

  function cancelForm() {
    formSession = null;
    if (mode === 'FORM') mode = 'NORMAL';
  }

  function startForm() {
    const before = snapshot();
    const target = formTargetAtSlot(before.document, currentSlotId());
    if (!target) return;
    formSession = { slotId: target.slotId, tokenId: target.tokenId, before, buffer: '' };
    mode = 'FORM';
  }

  function commitForm(form?: FormId) {
    if (!formSession) return;
    const { before, slotId } = formSession;
    const current = snapshot().document;
    const next = setFormAtSlot(current, slotId, form);
    ({ tokens, groups, splits } = next);
    enterNormal();
    if (next !== current) history.record(before, snapshot());
  }

  export function finishFormEditing() {
    if (mode !== 'FORM' || !formSession) return;
    const form = formIdForInput(formSession.buffer);
    if (form) commitForm(form);
    else enterNormal();
  }

  export function resolveKeydown(event: KeyboardEvent): Resolution {
    return resolveInput(event, { mode: mode as InputMode,
      buffer: mode === 'FORM' ? formSession?.buffer : mode === 'MARKER_SEQUENCE' ? markerBuffer : undefined });
  }

  export function handleKeydown(event: KeyboardEvent, resolved = resolveKeydown(event)) {
    if (event.target instanceof Element && event.target.closest('.debug-panel')) return;
    if (mode === 'PSEUDO_INPUT') { handlePseudoKeydown(event); return; }
    if (mode === 'MARKER_INPUT') { handleCustomMarkerKeydown(event); return; }
    if (isComposingInput(event)) return;
    if (mode === 'INSERT' || mode === 'TRANSLATION') {
      if (resolved.winner?.operation === 'editor.cancel' || resolved.winner?.operation === 'translation.commit') { event.preventDefault(); enterNormal(); }
      else if (operationMatches(event, 'history.redo')) event.preventDefault();
      return;
    }
    const winner = resolved.winner;
    if (mode === 'MARKER_SEQUENCE' && resolved.interpretedAsNormal) finishMarkerInput();
    if (!winner) {
      if (mode === 'FORM' || mode === 'BORDER') event.preventDefault();
      return;
    }
    event.preventDefault();
    if (winner.source === 'sequence') {
      if (mode === 'NORMAL' || mode === 'MARKER_SEQUENCE') handleMarkerKey(event, winner);
      else if (mode === 'FORM' && formSession && !isRepeatedInput(event)) formSession = { ...formSession, buffer: winner.buffer! };
      return;
    }
    const operation = winner.operation as KeyboardOperationId;
    if (mode === 'MARKER_SEQUENCE') finishMarkerInput();
    if (mode === 'FORM') {
      if (operation.startsWith('cursor.')) finishFormEditing();
      else {
        if (isRepeatedInput(event)) return;
        if (operation === 'editor.cancel') finishFormEditing();
        else if (operation === 'form.clear') commitForm();
        else if (operation === 'form.commit') {
          if (!formSession?.buffer) enterNormal();
          else { const form = formIdForInput(formSession.buffer); if (form) commitForm(form); }
        } else if (operation === 'form.eraseInput' && formSession) {
          formSession = { ...formSession, buffer: [...formSession.buffer].slice(0, -1).join('') };
        }
        return;
      }
    }
    if (operation === 'history.redo') {
      if (mode === 'ARROW' || mode === 'BORDER') enterNormal();
      onundo(true);
      return;
    }
    if (operation === 'form.start' && mode === 'NORMAL') {
      event.preventDefault();
      if (!isRepeatedInput(event)) startForm();
      return;
    }
    if (operation === 'marker.start' && mode === 'NORMAL') {
      event.preventDefault();
      if (!isRepeatedInput(event)) {
        const slotId = currentSlotId();
        if (slotId !== undefined && isSlotEditable({ tokens, slots }, slotId)) mode = 'MARKER_SEQUENCE';
      }
      return;
    }
    if (operation === 'marker.customStart' && mode === 'NORMAL') {
      event.preventDefault();
      if (!matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) startCustomMarkerInput();
      return;
    }
    if (operation === 'history.undo') {
      event.preventDefault();
      if (mode === 'ARROW' || mode === 'BORDER') enterNormal();
      onundo(false);
      return;
    }
    const navigationLayout = computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows);

    const bracketText = bracketTextForOperation(operation);
    if (mode === 'NORMAL' && bracketText !== undefined) {
      event.preventDefault();
      if (!matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) insertRegionBracket(bracketText);
      return;
    }
    if (mode === 'BORDER') {
      // Do not fall through to slot edits, native button activation or scrolling.
      event.preventDefault();
      pseudoMessage = '';
      const borderOperation = operation;
      if (isRepeatedInput(event) && !operation.startsWith('cursor.') && operation !== 'editor.cancel') return;
      const borderBracketText = bracketTextForOperation(borderOperation);
      if (borderOperation === 'editor.cancel') enterNormal();
      else if (borderOperation === 'pseudo.start') startPseudoInput();
      else if (borderBracketText !== undefined) insertBorderBracket(borderBracketText);
      else if (borderOperation === 'bracket.deleteBefore') deleteBorderItem(borderIndex - 1);
      else if (borderOperation === 'bracket.deleteAfter') deleteBorderItem(borderIndex);
      else if (!isRepeatedInput(event) || operation.startsWith('cursor.') || operation === 'editor.cancel') borderIndex = moveBorderOperation(borderIndex, tokens.length, operation);
      return;
    }
    if (operation === 'border.start' && mode === 'NORMAL') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      borderIndex = borderFromCursor(navigationLayout, { x: cursorX, y: cursorY });
      arrowMessage = '';
      mode = 'BORDER';
      return;
    }

    if ((operation === 'arrow.start' || operation === 'arrow.delete') && mode === 'NORMAL') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      const id = currentSlotId();
      if (!id) return;
      if (operation === 'arrow.delete') {
        const before = snapshot();
        applyDocument(deleteArrow(before.document, id), id);
        history.record(before, snapshot());
      } else if (isArrowMarker(effectiveSlotMarker({ tokens, slots }, id))
        || isAppositionMarker(effectiveSlotMarker({ tokens, slots }, id))) {
        arrowSourceId = id;
        arrowKind = isAppositionMarker(effectiveSlotMarker({ tokens, slots }, id)) ? 'apposition' : undefined;
        arrowMessage = '';
        mode = 'ARROW';
      } else arrowMessage = `矢印の始点には ${operationKeyLabel('bracket.insertRoundOpen')} / ${operationKeyLabel('bracket.insertAngleOpen')} または ${arrowMarkerLabels}、同格の開始には ${appositionMarkerLabels} の標識が必要です。`;
      return;
    }
    if (operation === 'arrow.commit' && mode === 'ARROW') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      const targetId = currentSlotId();
      if (!targetId || !arrowSourceId || targetId === arrowSourceId) {
        arrowMessage = '始点とは別のスロットを選択してください。';
        return;
      }
      if (arrowKind === 'apposition' && !isAppositionEndpoint(effectiveSlotMarker({ tokens, slots }, targetId))) {
        arrowMessage = `同格の相手は ${appositionMarkerLabels} または空のスロットを選択してください。`;
        return;
      }
      const before = snapshot();
      applyDocument((arrowKind === 'apposition' ? connectApposition : connectArrow)(before.document, arrowSourceId, targetId), targetId);
      history.record(before, snapshot());
      enterNormal();
      return;
    }
    if ((operation === 'split.t' || operation === 'split.d') && mode === 'NORMAL') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      const before = snapshot();
      const id = currentSlotId();
      if (id === undefined) return;
      const next = splitSlot(before.document, id, operation === 'split.t' ? 't' : 'd', cursorX);
      if (next === before.document) return;
      const split = next.splits.find((split) => split.slotId === id)!;
      applyDocument(next, split.leftSlotId);
      history.record(before, snapshot());
    } else if (operation === 'marker.clear' && mode === 'NORMAL') {
      const slotId = currentSlotId();
      if (slotId !== undefined && isSlotEditable({ tokens, slots }, slotId)) {
        const before = snapshot();
        applyDocument(pruneArrows({ ...before.document, slots: setSlotMarker(slots, slotId) }), slotId);
        history.record(before, snapshot());
      }
      event.preventDefault();
    } else if (operation === 'cursor.left') {
      navigate(moveLeft(navigationLayout, { x: cursorX, y: cursorY }));
      event.preventDefault();
    } else if (operation === 'cursor.right') {
      navigate(moveRight(navigationLayout, { x: cursorX, y: cursorY }));
      event.preventDefault();
    } else if (operation === 'cursor.down') {
      moveVertical(1);
      event.preventDefault();
    } else if (operation === 'cursor.up') {
      moveVertical(-1);
      event.preventDefault();
    } else if (operation === 'cursor.rowStart') {
      moveToRowEdge('start');
      event.preventDefault();
    } else if (operation === 'cursor.rowEnd') {
      moveToRowEdge('end');
      event.preventDefault();
    } else if (operation === 'selection.toggle' && mode === 'NORMAL') {
      mode = 'VISUAL';
      anchor = { x: cursorX, y: cursorY };
      event.preventDefault();
    } else if (operation === 'selection.toggle' && mode === 'VISUAL') {
      individualSlots = [...selectedSlots];
      anchor = null;
      mode = 'VISUAL_MULTI';
      event.preventDefault();
    } else if (operation === 'selection.toggle' && mode === 'VISUAL_MULTI') {
      toggleCurrentSlot();
      event.preventDefault();
    } else if (operation === 'selection.commit' && selecting) {
      const contents = groupContentSlotIds(tokens, selectedSlots);
      if (contents.length) {
        const before = snapshot();
        const group = createGroup(tokens, slots, contents, splits);
        // Creation and focus on the new group's own slot share one history entry.
        applyDocument({ ...before.document, slots: [...slots, { id: group.slotId }], groups: [...groups, group] }, group.slotId);
        history.record(before, snapshot());
      }
      enterNormal();
      event.preventDefault();
    } else if (operation === 'editor.cancel') {
      enterNormal();
      event.preventDefault();
    } else if (operation === 'english.start' && mode === 'NORMAL') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      if (pseudoTokenAtSlot(snapshot().document, currentSlotId())) startPseudoInput();
      else {
        inputStart = snapshot();
        sentenceDraft = sentenceFromTokens();
        mode = 'INSERT';
      }
    } else if (operation === 'translation.start' && mode === 'NORMAL') {
      inputStart = snapshot();
      mode = 'TRANSLATION';
      translationActivity();
      event.preventDefault();
    } else if (operation === 'structure.delete' && mode === 'NORMAL') {
      event.preventDefault();
      if (matchesKeyboardInput(event, [
        { repeat: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, isComposing: null },
      ])) return;
      const before = snapshot();
      const id = currentSlotId();
      const split = splits.find((split) => split.leftSlotId === id || split.rightSlotId === id);
      if (split) {
        const next = unsplitSlot(before.document, id!);
        applyDocument(next, split.slotId);
      } else {
        const target = groupForDeletion(layout, { x: cursorX, y: cursorY });
        if (!target) return;
        const next = deleteGroup(before.document, target.id);
        applyDocument(next, id);
      }
      settleCursor();
      history.record(before, snapshot());
    }
  }
  export function finishEditing() {
    enterNormal();
  }

  export function settleGroupsBeforeEntryMove() {
    const result = settleOpenedGroups(snapshot().document, { x: cursorX, y: cursorY }, null, openedGroupIds, true);
    cursorX = result.cursor.x;
    cursorY = result.cursor.y;
    openedGroupIds = result.openedGroupIds;
  }

  export function selectFirst() {
    const cursor = nearestCursor(computeLayout(tokens, groupsForEditing(groups, openedGroupIds), splits, arrows), { x: 0, y: 0 });
    cursorX = cursor.x;
    cursorY = cursor.y;
  }

  export function startInput(translationInput = false) {
    onactivate();
    enterNormal();
    inputStart = snapshot();
    sentenceDraft = sentenceFromTokens();
    mode = translationInput ? 'TRANSLATION' : 'INSERT';
    translationActivity();
  }

  export function getInputMode(): EntryInputMode {
    return mode === 'INSERT' || mode === 'TRANSLATION' || mode === 'PSEUDO_INPUT' || mode === 'MARKER_INPUT'
      || mode === 'MARKER_SEQUENCE' || mode === 'FORM' ? mode : null;
  }

</script>

{#snippet measureForms(slotId: string | undefined)}
  {@const targets = allFormTargets.filter(target => target.ownerSlotId === slotId)}
  {#if targets.length !== 2 && targets.some(target => visibleFormIds.has(target.slotId) && (formDisplay(target, formSession) || formSession?.slotId === target.slotId))}
    <div class="form-measure-row">
      {#each targets as target}
        <span class="token-form" class:form-pending={formSession?.slotId === target.slotId}
          data-form-label={formDisplay(target, formSession)}>{visibleFormIds.has(target.slotId) ? formDisplay(target, formSession) : ''}</span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet splitMeasurement(split: SlotSplit, labels: string[])}
  <span class="split-measure">
    {#each [split.leftSlotId, split.rightSlotId] as id, side}
      {@const target = allFormTargets.find(target => target.slotId === id)}
      <span class="split-half-measure" data-split-slot-id={id}>
        {#if target && visibleFormIds.has(id) && (formDisplay(target, formSession) || formSession?.slotId === id)}
          <span class="token-form" class:form-pending={formSession?.slotId === id}
            data-form-label={formDisplay(target, formSession)}>{formDisplay(target, formSession)}</span>
        {/if}
        <span class="slot-marker">{labels[side] || ' '}</span>
      </span>
    {/each}
  </span>
{/snippet}

{#snippet pseudoField()}
  {#if pseudoInput}
    <input type="text" class="pseudo-input" value={pseudoInput.text}
      style={`left: ${pseudoInputOffset.left}px; top: ${pseudoInputOffset.top}px; width: ${pseudoInputWidth}px`}
      aria-label={pseudoInput.kind === 'create' ? '疑似トークンを作成' : '疑似トークンを編集（空文字で削除）'}
      use:focusOnMount
      on:input={(event) => { if (pseudoInput) pseudoInput.text = event.currentTarget.value; }}
      on:keydown|stopPropagation={handlePseudoKeydown}
      on:compositionstart={() => { if (pseudoInput) pseudoInput.composing = true; }}
      on:compositionend={() => { if (pseudoInput) pseudoInput.composing = false; }}
      on:blur={cancelPseudoInput} />
  {/if}
{/snippet}

{#snippet customMarkerField()}
  {#if customMarkerInput}
    <input type="text" class="custom-marker-input" value={customMarkerInput.text}
      style={`left: ${customMarkerInputOffset.left}px; top: ${customMarkerInputOffset.top}px; width: ${customMarkerInputWidth}px`}
      aria-label="標識を自由入力（空文字で削除）"
      use:focusOnMount
      on:input={(event) => { if (customMarkerInput) customMarkerInput.text = event.currentTarget.value; }}
      on:keydown|stopPropagation={handleCustomMarkerKeydown}
      on:compositionstart={() => { if (customMarkerInput) customMarkerInput.composing = true; }}
      on:compositionend={() => { if (customMarkerInput) customMarkerInput.composing = false; }}
      on:blur={cancelCustomMarkerInput} />
  {/if}
{/snippet}

{#snippet slotMarker(id: string)}
  {#if customMarkerInput?.slotId === id}
    <span class="custom-marker-input-anchor" style={`width: ${customMarkerInputWidth}px`} aria-hidden="true"></span>
  {:else if pendingMarkerSlotId === id}
    <span class="slot-marker marker-pending" role="status" aria-label={`標識入力: ${markerBuffer}`}>{markerBuffer}</span>
  {:else}
    <span class="slot-marker">{markerLabel(slotById.get(id)?.marker)}</span>
  {/if}
{/snippet}

{#snippet splitControls(split: SlotSplit)}
  <div class="split-slots" class:d-split={split.kind === 'd'} data-t-source={split.kind === 'd' ? undefined : split.slotId}
    data-split-source={split.slotId} data-split-kind={split.kind ?? 't'}>
    {#each [split.leftSlotId, split.rightSlotId] as id, side}
      <button type="button" class="slot t-half"
        style={`width: ${(renderLayout.regionsBySlot.get(id)?.at(-1)?.right ?? 0) - (renderLayout.regionsBySlot.get(id)?.at(-1)?.left ?? 0)}px`}
        tabindex="-1"
        class:arrow-source={arrowSourceId === id}
        class:current={currentId === id}
        class:current-region={currentId === id}
        class:selected={selecting && selectedSlotIds.has(id)}
        class:covered={!visibleSlot(displayLayout, id)}
        disabled={!visibleSlot(displayLayout, id)}
        data-slot-id={id}
        aria-label={`${split.kind === 'd' ? 'D分割' : 'T化'} ${side === 0 ? '左' : '右'}スロット${slotById.get(id)?.marker ? ` 標識: ${markerLabel(slotById.get(id)?.marker)}` : ''}`}
        on:mousedown|preventDefault
        on:click={() => clickSlotId(id)}>{@render slotMarker(id)}</button>
    {/each}
  </div>
{/snippet}

  {#if active}
    <aside class="operation-guide" role="status" aria-label="操作案内">
      {#if arrowMessage || pseudoMessage}
        <p class="selection-guide">{arrowMessage || pseudoMessage}</p>
      {:else if mode === 'ARROW'}
        <p class="selection-guide">{arrowKind === 'apposition' ? `同格: 相手は ${appositionMarkerLabels} または空。` : '矢印:'} 移動またはクリックで相手を選択 / {keyLabel('arrow.commit')} で確定 / {keyLabel('editor.cancel')} で取消</p>
      {:else if mode === 'VISUAL_MULTI'}
        <p class="selection-guide">個別選択: 移動して {keyLabel('selection.toggle')}、またはクリックで追加・解除 / {keyLabel('selection.commit')} で下線作成 / {keyLabel('editor.cancel')} で取消（{selectedSlots.length} 選択中）</p>
      {:else if mode === 'BORDER'}
        <p class="selection-guide">境目モード: {keyLabel('cursor.left')} / {keyLabel('cursor.right')} で移動 / {keyLabel('cursor.rowStart')}・{keyLabel('cursor.rowEnd')} で文頭・文末 ・ {keyLabel('pseudo.start')} で疑似トークン作成 / {keyLabel('bracket.deleteBefore')}・{keyLabel('bracket.deleteAfter')} で隣の括弧・疑似トークン削除 / {keyLabel('editor.cancel')} で Normal（境目 {borderIndex + 1} / {tokens.length + 1}）</p>
      {:else if mode === 'PSEUDO_INPUT'}
        <p class="selection-guide">疑似トークン: {keyLabel('pseudo.commit')} で確定 / {keyLabel('editor.cancel')}・入力欄から離れると取消（再編集は空文字で削除。関連する下線も削除されます）</p>
      {:else if mode === 'MARKER_INPUT'}
        <p class="selection-guide">標識の自由入力: {keyLabel('marker.customCommit')} で確定 / {keyLabel('editor.cancel')}・入力欄から離れると取消（空文字で削除）</p>
      {:else if mode === 'MARKER_SEQUENCE'}
        <p class="selection-guide">定型標識入力: 続きを入力 / 移動・{keyLabel('editor.cancel')} で確定して Normal</p>
      {:else if mode === 'FORM'}
        <p class="selection-guide">formモード: {formInputGuide} ・ {keyLabel('form.commit')} / {keyLabel('editor.cancel')} で確定 / 移動キー・{keyLabel('entry.next')}/{keyLabel('entry.previous')} で確定して移動 / {keyLabel('form.clear')} で即時削除 / {keyLabel('form.eraseInput')} で入力を戻す（Dは左右別、T・基礎下線は1つ）</p>
      {/if}
    </aside>
  {/if}

  <section
    class="editor"
    class:visual={selecting}
    aria-label="英文構造図編集領域"
  >
    {#if mode === 'INSERT'}
      <p class="selection-guide">英文を変更すると、疑似トークン・角括弧・丸括弧・下線・標識・活用表示・分割・矢印はリセットされます。</p>
      <div class="input-row">
        <input bind:value={sentenceDraft} aria-label="英文" use:focusOnMount on:keydown={(event) => {
          if (resolveInput(event, { mode: 'INSERT' }).winner?.operation === 'editor.cancel') { event.preventDefault(); event.stopPropagation(); enterNormal(); }
        }} />
        <button type="button" on:click={enterNormal}>完了</button>
      </div>
    {:else}
      {#if !displayTokens.length}<p class="empty-entry">英文を入力してください</p>{/if}
      <div class="diagram" style={`--bracket-gutter: ${BRACKET_GUTTER}px; --bracket-min-width: ${BRACKET_GUTTER + BRACKET_SLOT_MIN_WIDTH}px; --close-bracket-width: ${CLOSE_BRACKET_WIDTH}px`} use:measureDiagram={{ measurements, renderLayout, inputTokenId, pseudoInputWidth, formSession }}>
        {#if !displayTokens.length && active && mode === 'BORDER'}
          <div class="diagram-row" style="grid-template-columns: 1fr">
            <span class="border-cursor" style="left: 0" aria-hidden="true"></span>
          </div>
        {/if}
        <div class="token-measurements" aria-hidden="true">
          {#if customMarkerInput}
            <span class="custom-marker-input-measure">{customMarkerInput.text || ' '}</span>
          {/if}
          {#each measurements.tokens as { token, labels, splitLabels }}
            <div class="token-measure" class:bracket-open={token.kind === 'bracket-open'} class:bracket-close={token.kind === 'bracket-close'} class:paren-open={token.kind === 'paren-open'} class:paren-close={token.kind === 'paren-close'} class:angle-open={token.kind === 'angle-open'} class:angle-close={token.kind === 'angle-close'} data-token-id={token.id}>
              {@render measureForms(token.slotId)}
              {#if token.id === inputTokenId}
                <span class="pseudo-input-measure">{token.text || ' '}</span>
              {:else}
                <span class="token-text" class:pseudo-token={token.kind === 'pseudo'}>{token.text}</span>
              {/if}
              {#each labels as label}
                <span class="slot-marker">{label}</span>
              {/each}
              {#each splitLabels as pair}{@render splitMeasurement(splitBySource.get(token.slotId!)!, pair)}{/each}
            </div>
          {/each}
          {#each measurements.groups as { slotId, labels, splitLabels }}
            <div class="group-measure" data-slot-id={slotId}>
              {@render measureForms(slotId)}
              {#each labels as label}<span class="slot-marker">{label}</span>{/each}
              {#each splitLabels as pair}{@render splitMeasurement(splitBySource.get(slotId)!, pair)}{/each}
            </div>
          {/each}
        </div>
        <!-- Keep the native input outside row loops: reflow must not restart IME. -->
        {@render pseudoField()}
        {@render customMarkerField()}
        {#each displayRows as row, rowIndex}
          <div
            class="diagram-row"
            style={`width: ${row.width}px; padding-top: ${row.formHeight}px; grid-template-columns: ${row.columns.map((width) => `${width}px`).join(' ')}`}
          >
            {#if row.forms.length}
              <div class="form-layer">
                {#each row.forms as form}
                  <span class="token-form" class:form-pending={form.pending} data-form-slot-id={form.slotId} data-form-label={form.text}
                    style={`left: ${form.left}px; width: ${form.right - form.left}px; top: ${row.formHeight - (form.lane + 1) * 18}px`}
                    aria-label={`${form.label} の活用${form.pending ? '（編集中）' : ''}`}>{form.text}</span>
                {/each}
              </div>
            {/if}
            {#if active && mode === 'BORDER' && borderRenderPosition.row === rowIndex}
              <span class="border-cursor" style={`left: ${borderRenderPosition.left}px`} aria-hidden="true"></span>
            {/if}
            {#each displayTokens.slice(row.start, row.end + 1) as token, localIndex}
              <div
                class="token"
                class:bracket-open={token.kind === 'bracket-open'}
                class:bracket-close={token.kind === 'bracket-close'}
                class:paren-open={token.kind === 'paren-open'}
                class:paren-close={token.kind === 'paren-close'}
                class:angle-open={token.kind === 'angle-open'}
                class:angle-close={token.kind === 'angle-close'}
                style={`--column: ${localIndex * 2 + 2}`}
              >
                {#if isVirtualBracket(token)}
                  <button type="button" class="angle-selection"
                    tabindex="-1"
                    class:current={currentId === token.slotId}
                    class:selected={selecting && selectedSlotIds.has(token.slotId)}
                    class:arrow-source={arrowSourceId === token.slotId}
                    class:content-selected={highlightedContentSlotIds.has(token.slotId)}
                    on:mousedown|preventDefault
                    on:click={() => clickSlotId(token.slotId)}
                    aria-label={`${token.kind === 'paren-open' ? '開き丸括弧' : '開き山括弧'}（ad系統・標識入力不可）`}>
                    {#if token.kind === 'angle-open'}
                      <svg class="angle-glyph" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                        <polyline points="9,0 1,50 9,100" />
                      </svg>
                    {/if}
                  </button>
                  {#if token.kind === 'paren-open'}
                    <span class="bracket-glyph" aria-hidden="true"></span>
                  {/if}
                {:else if token.kind === 'angle-close'}
                  <svg class="angle-glyph" viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                    <polyline points="1,0 9,50 1,100" />
                  </svg>
                {:else if isBracket(token)}
                  <span class="bracket-glyph" aria-hidden="true"></span>
                {:else if token.id === inputTokenId}
                  <span class="pseudo-input-anchor" style={`width: ${pseudoInputWidth}px`} aria-hidden="true"></span>
                {:else}
                  <span class="token-text" class:pseudo-token={token.kind === 'pseudo'}>{token.text}</span>
                {/if}
                {#if token.slotId !== undefined && !isVirtualBracket(token)}
                  {#if splitBySource.has(token.slotId)}
                    {@const sourceRegion = renderLayout.regionsBySlot.get(token.slotId)?.[0]}
                    {@const column = renderLayout.columns[row.start + localIndex]}
                    <div class="t-token" class:d-split={splitBySource.get(token.slotId)?.kind === 'd'}
                      style={`left: ${(sourceRegion?.left ?? column.left) - column.left}px; width: ${(sourceRegion?.right ?? column.right) - (sourceRegion?.left ?? column.left)}px`}>
                      {@render splitControls(splitBySource.get(token.slotId)!)}
                    </div>
                  {:else if !visibleSlot(displayLayout, token.slotId) || (token.id === inputTokenId && pseudoInput?.kind === 'create')}
                    <span class="slot slot-placeholder" aria-hidden="true"></span>
                  {:else}
                  <button
                  type="button"
                  class="slot"
                  tabindex="-1"
                  class:arrow-source={arrowSourceId === token.slotId}
                  class:current={currentId === token.slotId}
                  class:current-region={currentId === token.slotId}
                  class:selected={selecting && selectedSlotIds.has(token.slotId)}
                  on:mousedown|preventDefault
                  on:click={() => clickSlotId(token.slotId)}
                  aria-label={`${token.kind === 'bracket-open' ? '開き角括弧' : token.text} に対応するスロット${slotById.get(token.slotId)?.marker ? ` 標識: ${markerLabel(slotById.get(token.slotId)?.marker)}` : ''}`}
                  >{@render slotMarker(token.slotId)}</button>
                  {/if}
                {/if}
              </div>
            {/each}
            {#each row.groups as { placement, segments } (placement.group.id)}
              {@const split = splitBySource.get(placement.group.slotId)}
              {@const allRegions = renderLayout.regionsBySlot.get(placement.group.slotId)!}
              <div class="group-line" style={`--row: ${placement.y + 1}`} data-group-kind={placement.group.kind}>
                {#each segments as segment}
                  {@const last = segment === allRegions[allRegions.length - 1]}
                  {#if split && last}
                    <div class="line-segment t-region" style={`left: ${segment.left}px; width: ${segment.right - segment.left}px`}>
                      {@render splitControls(split)}
                      {#if segment.startConnection}<span class="connection-dot start" style={`--connection-color: ${segment.startConnection}`}></span>{/if}
                    </div>
                  {:else}
                    <button type="button" class="line-segment"
                      tabindex="-1"
                      class:arrow-source={!split && arrowSourceId === placement.group.slotId}
                      class:current={!split && currentId === placement.group.slotId}
                      class:current-region={!split && currentId === placement.group.slotId && currentRegion !== undefined
                        && segment.logicalRanges.some((range) => range.start < currentRegion.end && range.end > currentRegion.start)}
                      class:selected={selecting && selectedSlotIds.has(placement.group.slotId)}
                      style={`left: ${segment.left}px; width: ${segment.right - segment.left}px`}
                      data-region-start={segment.start} data-region-end={segment.end}
                      data-slot-id={placement.group.slotId}
                      title={GROUP_KIND_LABELS[placement.group.kind]}
                      aria-label={`${GROUP_KIND_LABELS[placement.group.kind]}${split ? ` ${split.kind === 'd' ? 'D分割' : 'T化'}の継続区間` : ''}${!split && slotById.get(placement.group.slotId)?.marker ? ` 標識: ${markerLabel(slotById.get(placement.group.slotId)?.marker)}` : ''}`}
                      on:mousedown|preventDefault
                      on:click={() => {
                        if (split) clickSlotId(split.leftSlotId);
                        else {
                          const region = segment.logicalRanges.find((range) => range.start <= cursorX && cursorX < range.end)
                            ?? segment.logicalRanges[0];
                          const x = Math.max(region.start, Math.min(cursorX, region.end - 1));
                          if (containsX(layout, placement.group.slotId, x)) clickSlot(x, placement.y);
                          else clickSlotId(placement.group.slotId);
                        }
                      }}>
                      {#if pendingMarkerSlotId === placement.group.slotId ? segment === pendingMarkerRegion : last}
                        {@render slotMarker(placement.group.slotId)}
                      {/if}
                      {#if segment.startConnection}<span class="connection-dot start" style={`--connection-color: ${segment.startConnection}`}></span>{/if}
                      {#if segment.endConnection}<span class="connection-dot end" style={`--connection-color: ${segment.endConnection}`}></span>{/if}
                    </button>
                  {/if}
                {/each}
              </div>
            {/each}
            <div class="diagram-depth" style={`grid-row: ${row.maxY + 1}`} aria-hidden="true"></div>
            {#if row.arrows.length}
              <svg class="arrow-layer" width="100%" height={row.maxY * 38 + 28} aria-hidden="true">
                {#each row.arrows as segment}
                  <g data-arrow-target={segment.targetSlotId} data-arrow-kind={segment.kind ?? 'directed'}>
                    <line x1={segment.left} x2={segment.right} y1={segment.y} y2={segment.y} />
                    {#each segment.stems as stem}
                      {#if stem.attachmentX !== undefined}
                        <line x1={stem.attachmentX} x2={stem.x} y1={stem.y} y2={stem.y} />
                      {/if}
                      <line x1={stem.x} x2={stem.x} y1={stem.y} y2={segment.y} />
                      {#if stem.target}
                        <path d={`M ${stem.x - 4} ${stem.y + Math.min(7, segment.y - stem.y)} L ${stem.x} ${stem.y} L ${stem.x + 4} ${stem.y + Math.min(7, segment.y - stem.y)}`} />
                      {/if}
                    {/each}
                    {#if segment.label}<text class="apposition-label" x={segment.label.x} y={segment.label.y}>{segment.label.text}</text>{/if}
                    {#if segment.startConnection}<circle cx={segment.left} cy={segment.y} r="3.5" style={`fill: ${segment.startConnection}`} />{/if}
                    {#if segment.endConnection}<circle cx={segment.right} cy={segment.y} r="3.5" style={`fill: ${segment.endConnection}`} />{/if}
                  </g>
                {/each}
              </svg>
            {/if}
            {#each row.highlights as region}
              <div class="content-highlight-row" style={`grid-row: ${region.y + 1}`} aria-hidden="true">
                <span class="content-highlight" data-content-slot-id={region.slotId}
                  style={`left: ${region.left + 1}px; width: ${Math.max(0, region.right - region.left - 2)}px`}></span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}

    <div class="translation-block">
      <div class="translation-field" class:translation-editing={mode === 'TRANSLATION'}>
        <div class="translation-mirror" aria-hidden="true">{(translation || 'Tabを押して訳文を入力') + '\u200b'}{#if mode === 'TRANSLATION'}<span class="translation-button-space"></span>{/if}</div>
        <textarea bind:value={translation} aria-label="訳文" rows="1"
          readonly={mode !== 'TRANSLATION'} tabindex={mode === 'TRANSLATION' ? 0 : -1}
          placeholder="Tabを押して訳文を入力" use:focusTranslation={mode === 'TRANSLATION'}
          on:input={translationActivity} on:keyup={translationActivity}
          on:pointerdown={translationActivity} on:pointerup={translationActivity}
          on:click={translationActivity} on:select={translationActivity}
          on:selectionchange={translationActivity}
          on:compositionstart={() => { translationComposing = true; translationActivity(); }}
          on:compositionupdate={translationActivity}
          on:compositionend={() => { translationComposing = false; translationActivity(); }}
          on:keydown={(event) => {
            if (mode !== 'TRANSLATION') return;
            translationActivity();
            const translationOperation = resolveKeydown(event).winner?.operation;
            if (isComposingInput(event)) {
              if (matchesKeyboardInput(event, [{ key: 'Tab', ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null }])) {
                event.preventDefault(); event.stopPropagation();
              }
              return;
            }
            if (translationOperation === 'editor.cancel' || translationOperation === 'translation.commit') {
              event.preventDefault(); event.stopPropagation(); enterNormal();
            } else if (!translationOperation && matchesKeyboardInput(event, [{ key: 'Tab', ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null }])) {
              event.preventDefault(); event.stopPropagation();
            }
          }}></textarea>
        {#if mode === 'TRANSLATION'}
          <button class="translation-done" type="button" on:click={enterNormal}>完了</button>
        {/if}
      </div>
    </div>
  </section>

import { isSavedState, type SavedState } from './model.ts';
import { readSavedDocument } from './groupEditing.ts';
import type { Cursor } from './layout.ts';
import type { EditorSnapshot } from './history.ts';
import type { EntryInputMode } from './entryShortcuts.ts';

export type Entry = { id: string; document: SavedState };
export type EntryDocument = { version: 7; entries: Entry[] };
export type DocumentSnapshot = { document: EntryDocument; activeEntryId: string; cursor: Cursor };
export type EntryEditorState = {
  snapshot: EditorSnapshot;
  mode: string;
  pendingMarker: boolean;
  getDisplay: () => unknown;
};
export type EntryEditorHandle = {
  snapshot(): EditorSnapshot;
  canSave(leaving?: boolean): boolean;
  restore(state: EditorSnapshot, settle?: boolean): void;
  finishEditing(): void;
  finishFormEditing(): void;
  finishMarkerInput(): void;
  selectFirst(): void;
  startInput(translationInput?: boolean): void;
  getInputMode(): EntryInputMode;
  handleKeydown(event: KeyboardEvent): void;
};

export function createEntry(document: SavedState = {
  version: 6, tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: '',
}): Entry {
  return { id: crypto.randomUUID(), document };
}

export function isEntryDocument(value: unknown): value is EntryDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as EntryDocument;
  if (candidate.version !== 7 || !Array.isArray(candidate.entries) || !candidate.entries.length) return false;
  const ids = new Set<string>();
  for (const entry of candidate.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.length || ids.has(entry.id)
      || !isSavedState(entry.document)) return false;
    ids.add(entry.id);
  }
  return true;
}

export function readEntryDocument(value: unknown): EntryDocument | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as EntryDocument | SavedState;
  if (candidate.version === 6) {
    const document = readSavedDocument(candidate);
    return document ? { version: 7, entries: [createEntry(document)] } : undefined;
  }
  if (candidate.version !== 7 || !Array.isArray(candidate.entries)) return undefined;
  const normalized = {
    version: 7,
    entries: candidate.entries.map(entry => entry && ({ ...entry, document: readSavedDocument(entry.document) })),
  };
  return isEntryDocument(normalized) ? normalized : undefined;
}

export function withEntrySnapshot(document: EntryDocument, id: string, state: EditorSnapshot): DocumentSnapshot {
  return {
    document: { version: 7, entries: document.entries.map((entry) => entry.id === id
      ? { ...entry, document: state.document } : entry) },
    activeEntryId: id,
    cursor: state.cursor,
  };
}

export function insertEntry(state: DocumentSnapshot, afterId: string): DocumentSnapshot {
  const index = state.document.entries.findIndex((entry) => entry.id === afterId);
  if (index < 0) return state;
  const entry = createEntry();
  const entries = [...state.document.entries];
  entries.splice(index + 1, 0, entry);
  return { document: { version: 7, entries }, activeEntryId: entry.id, cursor: { x: 0, y: 0 } };
}

export function parseEnglishLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0);
}

// Return a new snapshot without changing the input. The injectable ID source
// also allows deterministic tests without regenerating IDs on undo/redo.
export function insertEnglishEntries(
  state: DocumentSnapshot, afterId: string, text: string,
  createId: () => string = () => crypto.randomUUID(),
): DocumentSnapshot {
  const index = state.document.entries.findIndex((entry) => entry.id === afterId);
  const sentences = parseEnglishLines(text);
  if (index < 0 || !sentences.length) return state;
  const added: Entry[] = sentences.map((sentence) => {
    const tokens = sentence.split(' ').map((text) => ({ id: createId(), text, slotId: createId(), kind: 'real' as const }));
    return {
      id: createId(),
      document: {
        version: 6, tokens, slots: tokens.map(({ slotId }) => ({ id: slotId })),
        groups: [], splits: [], arrows: [], translation: '',
      },
    };
  });
  const entries = [...state.document.entries.slice(0, index + 1), ...added, ...state.document.entries.slice(index + 1)];
  return { document: { version: 7, entries }, activeEntryId: added[0].id, cursor: { x: 0, y: 0 } };
}

export function removeEntry(state: DocumentSnapshot, id: string): DocumentSnapshot {
  const index = state.document.entries.findIndex((entry) => entry.id === id);
  if (index < 0) return state;
  const entries = state.document.entries.filter((entry) => entry.id !== id);
  if (!entries.length) entries.push(createEntry());
  const activeEntryId = id === state.activeEntryId ? entries[Math.min(index, entries.length - 1)].id : state.activeEntryId;
  return {
    document: { version: 7, entries }, activeEntryId,
    cursor: activeEntryId === state.activeEntryId ? state.cursor : { x: 0, y: 0 },
  };
}

export function reorderEntry(state: DocumentSnapshot, id: string, direction: -1 | 1): DocumentSnapshot {
  const index = state.document.entries.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.document.entries.length) return state;
  const entries = [...state.document.entries];
  [entries[index], entries[target]] = [entries[target], entries[index]];
  return { ...state, document: { version: 7, entries } };
}

import { readEntryDocument, type Entry, type EntryDocument } from './entryDocument.ts';

export const LEGACY_STORAGE_KEY = 'kiri-kyo-editor:mvp';
export const RECOVERY_PREFIX = 'kiri-kyo-editor:recovery:';
export type EntryChange = { id: string; generation: number; entry: Entry | null };
export type SaveBatch = {
  session: string;
  sequence: number;
  changes: EntryChange[];
  order?: { generation: number; ids: string[] };
};
export type RecoveryJournal = { version: 2; batches: SaveBatch[] };
export type PersistenceStatus = { pending: boolean; saving: boolean; error: string | null };

/** Validate recovery data before replaying any of it. Invalid data stays on disk. */
export function parseRecovery(raw: string): RecoveryJournal {
  const value = JSON.parse(raw) as RecoveryJournal;
  if (value?.version !== 2 || !Array.isArray(value.batches)) throw new Error('終了時の退避データが不正です');
  for (const batch of value.batches) {
    if (!batch || typeof batch.session !== 'string' || !batch.session
      || !Number.isSafeInteger(batch.sequence) || batch.sequence < 1 || !Array.isArray(batch.changes)) {
      throw new Error('終了時の保存要求が不正です');
    }
    const ids = new Set<string>();
    for (const change of batch.changes) {
      const normalized = change?.entry && readEntryDocument({ version: 7, entries: [change.entry] });
      if (!change || typeof change.id !== 'string' || !change.id || ids.has(change.id)
        || !Number.isSafeInteger(change.generation) || change.generation < 1
        || (change.entry !== null && (change.entry?.id !== change.id
          || !normalized))) throw new Error('退避された文が不正です');
      if (normalized) change.entry = normalized.entries[0];
      ids.add(change.id);
    }
    if (batch.order && (!Number.isSafeInteger(batch.order.generation) || batch.order.generation < 1
      || !Array.isArray(batch.order.ids) || !batch.order.ids.length
      || batch.order.ids.some(id => typeof id !== 'string' || !id)
      || new Set(batch.order.ids).size !== batch.order.ids.length)) throw new Error('退避された文の順序が不正です');
  }
  return value;
}

/** Diff only used for structural edits/history restoration, never on the idle path. */
export function changedEntries(before: Entry[], after: Entry[]) {
  const old = new Map(before.map(entry => [entry.id, entry]));
  const updates = after.filter(entry => {
    const previous = old.get(entry.id);
    old.delete(entry.id);
    return !previous || (previous.document !== entry.document
      && JSON.stringify(previous.document) !== JSON.stringify(entry.document));
  });
  const beforeIds = before.map(entry => entry.id);
  const afterIds = after.map(entry => entry.id);
  return { updates, deleted: [...old.keys()], order: beforeIds.length !== afterIds.length
    || beforeIds.some((id, i) => id !== afterIds[i]) ? afterIds : undefined };
}

/** UI-side queue: dirty drafts are separate from eligible, committed snapshots. */
export function createEntryPersistence(
  write: (batch: SaveBatch) => Promise<void>,
  notify: (status: PersistenceStatus) => void,
  session = crypto.randomUUID(),
) {
  let generation = 0;
  let sequence = 0;
  const dirty = new Map<string, EntryChange>();
  const pending = new Map<string, EntryChange>();
  let order: SaveBatch['order'];
  let pendingOrder: SaveBatch['order'];
  let active: SaveBatch | undefined;
  let failed: SaveBatch | undefined;
  let error: string | null = null;
  let disposed = false;
  function emit() { notify({ pending: dirty.size > 0 || !!order || !!active || !!failed, saving: !!active, error }); }
  function makeBatch(changes: EntryChange[], nextOrder?: SaveBatch['order']): SaveBatch {
    return { session, sequence: ++sequence, changes, ...(nextOrder ? { order: nextOrder } : {}) };
  }
  function pump() {
    if (disposed || active) return;
    const batch = failed ?? (pending.size || pendingOrder ? makeBatch([...pending.values()], pendingOrder) : undefined);
    if (!batch) { emit(); return; }
    if (!failed) { pending.clear(); pendingOrder = undefined; }
    failed = undefined;
    active = batch;
    error = null;
    emit();
    // Promise boundary also catches a transport that throws before posting.
    void Promise.resolve().then(() => write(batch)).then(() => {
      if (disposed) return;
      for (const change of batch.changes) {
        if (dirty.get(change.id)?.generation === change.generation) dirty.delete(change.id);
      }
      if (batch.order?.generation === order?.generation) order = undefined;
      active = undefined;
      pump();
    }, reason => {
      if (disposed) return;
      active = undefined;
      failed = batch;
      error = String(reason);
      emit();
    });
  }
  function mark(entry: Entry) {
    const change = { id: entry.id, generation: ++generation, entry: structuredClone(entry) };
    dirty.set(entry.id, change);
    // Previously eligible snapshots stay intact until this new edit is eligible.
    emit();
  }
  function enqueue(id: string) {
    const change = dirty.get(id);
    if (change && !active?.changes.some(item => item.id === id && item.generation === change.generation)
      && !failed?.changes.some(item => item.id === id && item.generation === change.generation)) pending.set(id, change);
  }
  return {
    session,
    mark,
    saveEntry(id: string) { enqueue(id); pump(); },
    saveStructure(before: Entry[], after: Entry[]) {
      const diff = changedEntries(before, after);
      for (const entry of diff.updates) { mark(entry); enqueue(entry.id); }
      for (const id of diff.deleted) {
        dirty.set(id, { id, generation: ++generation, entry: null });
        enqueue(id);
      }
      if (diff.order) { order = { generation: ++generation, ids: diff.order }; pendingOrder = order; }
      pump();
    },
    retry() { pump(); },
    /** Called only at page departure; include requests whose acknowledgement may be lost. */
    journal(eligible: (id: string) => boolean = () => true): RecoveryJournal {
      const outstanding = active ?? failed;
      const changes = new Map(pending);
      for (const [id, change] of dirty) if (change.entry === null || eligible(id)) changes.set(id, change);
      for (const change of outstanding?.changes ?? []) {
        if (changes.get(change.id)?.generation === change.generation) changes.delete(change.id);
      }
      const nextOrder = order?.generation === outstanding?.order?.generation ? undefined : order;
      return { version: 2, batches: [
        ...(outstanding ? [outstanding] : []),
        ...(changes.size || nextOrder ? [makeBatch([...changes.values()], nextOrder)] : []),
      ] };
    },
    dispose() { disposed = true; },
  };
}

export type PersistenceRequest =
  | { kind: 'load'; legacyRaw: string | null; legacyError?: string; initial: EntryDocument; recovery: string[] }
  | { kind: 'write'; batch: SaveBatch }
  | { kind: 'read' };
export type PersistenceResponse = { id: number; document?: EntryDocument; error?: string };

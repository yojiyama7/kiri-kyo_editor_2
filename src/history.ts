import type { SavedState } from './model';
import type { Cursor } from './layout';

export type EditorSnapshot = { document: SavedState; cursor: Cursor };
type Change<T> = { before: T; after: T };

export class EditHistory<T extends { document: unknown } = EditorSnapshot> {
  private past: Change<T>[] = [];
  private future: Change<T>[] = [];

  record(before: T, after: T): void {
    // Navigation and unchanged input must neither create an undo step nor
    // discard redo steps. Cursor positions travel with actual edits only.
    if (JSON.stringify(before.document) === JSON.stringify(after.document)) return;
    this.past.push(structuredClone({ before, after }));
    this.future = [];
  }

  undo(): T | undefined {
    const change = this.past.pop();
    if (!change) return undefined;
    this.future.push(change);
    return structuredClone(change.before);
  }

  redo(): T | undefined {
    const change = this.future.pop();
    if (!change) return undefined;
    this.past.push(change);
    return structuredClone(change.after);
  }
}

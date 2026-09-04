export const EDITOR_IDLE_MS = 500;

export type UpdateClock = {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
};

const browserClock: UpdateClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Keep only a callback, never a document snapshot: delayed work must read the latest state. */
export function createEditorUpdates(
  callbacks: { debug: () => void; save: (leaving?: boolean) => void },
  clock: UpdateClock = browserClock,
) {
  let timer: unknown;
  let pendingSave = false;
  let disposed = false;
  function cancel() {
    clock.clearTimeout(timer);
    timer = undefined;
  }
  function schedule(save = true) {
    if (disposed) return;
    pendingSave ||= save;
    // External storage notifications need display refresh only, not a write-back
    // of our older document, and must not postpone a pending user operation.
    if (!save && timer !== undefined) return;
    cancel();
    timer = clock.setTimeout(() => {
      timer = undefined;
      const shouldSave = pendingSave;
      pendingSave = false;
      if (shouldSave) callbacks.save();
      // Read back the newly saved state in the same task, with no extra delay.
      callbacks.debug();
    }, EDITOR_IDLE_MS);
  }
  function flushSave() {
    if (disposed) return;
    cancel();
    pendingSave = false;
    callbacks.save(true);
  }
  return {
    schedule,
    flushSave,
    flushDebug() {
      if (disposed) return;
      // Copying fresh JSON must neither save edits nor lose their idle deadline.
      if (!pendingSave) cancel();
      callbacks.debug();
    },
    dispose() {
      disposed = true;
      cancel();
      pendingSave = false;
    },
  };
}

import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';

export const WEB_CONTROL_SELECTOR = 'button, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"])';

type FocusDocument = Pick<Document, 'activeElement'>;
type Scheduler = (callback: () => void) => void;

export function blurFocusedWebControl(document: FocusDocument): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active?.matches?.(WEB_CONTROL_SELECTOR)) return false;
  active.blur();
  return true;
}

export function scheduleEscapeFocusRelease(input: KeyboardInput, document: FocusDocument,
  schedule: Scheduler = callback => { setTimeout(callback, 0); }): boolean {
  const composing = matchesKeyboardInput(input, [
    { isComposing: true, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
    { keyCode: 229, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
  ]);
  const escape = matchesKeyboardInput(input, [
    { key: 'Escape', ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null },
  ]);
  if (!escape || composing) return false;
  schedule(() => { blurFocusedWebControl(document); });
  return true;
}

import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS, type InputSequenceBinding } from './inputConfig.ts';
import { MARKER_LABELS, isMarkerId, type MarkerId } from './inputIds.ts';
import type { Slot } from './model';

export { MARKER_LABELS, isMarkerId, type MarkerId } from './inputIds.ts';

export function markerLabel(marker: MarkerId | undefined): string {
  return marker === undefined ? '' : MARKER_LABELS[marker];
}

function matchMarker(buffer: string, bindings: readonly InputSequenceBinding<MarkerId>[]) {
  let marker: MarkerId | undefined;
  let hasLonger = false;
  for (const binding of bindings) {
    if (binding.sequence === buffer) marker = binding.value;
    else if (binding.sequence.startsWith(buffer)) hasLonger = true;
  }
  return { marker, hasLonger, matched: marker !== undefined || hasLonger };
}

// A rejected continuation closes the old edit before retrying the key as a new
// input. Non-character keys are returned to the editor's normal command handler.
export function nextMarkerInput(buffer: string, input: KeyboardInput,
  bindings: readonly InputSequenceBinding<MarkerId>[] = DEFAULT_MARKER_INPUT_BINDINGS) {
  const key = input.key ?? '';
  const isCharacter = matchesKeyboardInput(input, [{
    keyLength: 1, ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null,
  }]);
  let next = buffer + key;
  let match = isCharacter ? matchMarker(next, bindings) : { matched: false, hasLonger: false, marker: undefined };
  const restarted = buffer !== '' && !match.matched;
  if (restarted && isCharacter) {
    next = key;
    match = matchMarker(next, bindings);
  }
  return {
    handled: match.matched,
    restarted,
    marker: match.marker,
    buffer: match.matched && match.hasLonger ? next : '',
  };
}

export function setSlotMarker(slots: readonly Slot[], slotId: string, marker?: MarkerId): Slot[] {
  return slots.map((slot) => {
    if (slot.id !== slotId || slot.marker === marker) return slot;
    if (marker !== undefined) return { ...slot, marker };
    const { marker: _removed, ...empty } = slot;
    return empty;
  });
}

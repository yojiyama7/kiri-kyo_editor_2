import { matchesKeyboardInput, type KeyboardInput } from './keyboard.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS, type InputSequenceBinding } from './inputConfig.ts';
import { MARKER_LABELS, isMarker, isMarkerId, type Marker, type MarkerId } from './inputIds.ts';
import type { Slot } from './model';

export { MARKER_LABELS, isMarker, isMarkerId, type CustomMarker, type Marker, type MarkerId } from './inputIds.ts';

export function markerLabel(marker: Marker | undefined): string {
  return marker === undefined ? '' : typeof marker === 'string' ? MARKER_LABELS[marker] : marker.text;
}

export function markerFromText(text: string): Marker | undefined {
  const normalized = text.trim();
  if (!normalized) return undefined;
  const known = (Object.entries(MARKER_LABELS) as [MarkerId, string][])
    .find(([, label]) => label === normalized)?.[0];
  return known ?? { kind: 'custom', text: normalized };
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

function sameMarker(left: Marker | undefined, right: Marker | undefined): boolean {
  return left === right || !!left && !!right && typeof left !== 'string' && typeof right !== 'string'
    && left.kind === right.kind && left.text === right.text;
}

export function setSlotMarker(slots: readonly Slot[], slotId: string, marker?: Marker): Slot[] {
  return slots.map((slot) => {
    if (slot.id !== slotId || sameMarker(slot.marker, marker)) return slot;
    if (marker !== undefined) return { ...slot, marker };
    const { marker: _removed, ...empty } = slot;
    return empty;
  });
}

import { createGroup, type SavedState, type Slot } from './model.ts';

export function createExampleDocument(): SavedState {
  const tokens = 'She gave the student a careful explanation.'.split(' ').map((text) => ({
    id: crypto.randomUUID(), text, slotId: crypto.randomUUID(), kind: 'real' as const,
  }));
  const slots: Slot[] = tokens.map(({ slotId }, x) => ({
    id: slotId, ...(x === 0 ? { marker: 'marker.subject' as const } : x === 1 ? { marker: 'marker.verb' as const } : {}),
  }));
  const student = createGroup(tokens, slots, tokens.slice(2, 4).map(({ slotId }) => slotId));
  slots.push({ id: student.slotId, marker: 'marker.object1' });
  const explanation = createGroup(tokens, slots, tokens.slice(4).map(({ slotId }) => slotId));
  slots.push({ id: explanation.slotId, marker: 'marker.object2' });
  const predicate = createGroup(tokens, slots, [tokens[1].slotId, student.slotId, explanation.slotId]);
  slots.push({ id: predicate.slotId });
  return {
    arrows: [], splits: [], tokens, slots, groups: [student, explanation, predicate],
    translation: '彼女はその学生に丁寧な説明をした。',
  };
}

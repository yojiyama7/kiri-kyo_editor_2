import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroup, isSavedState } from '../src/model.ts';
import { createExampleDocument } from '../src/example.ts';
import { setSlotMarker } from '../src/markers.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS } from '../src/inputConfig.ts';
import { EditHistory } from '../src/history.ts';
import { computeLayout, slotAt, groupForDeletion } from '../src/layout.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { reclassifyGroups } from '../src/groupEditing.ts';

test('only empty direct base slots create a basic underline', () => {
  const tokens = ['a', 'b'].map((text) => ({ id: `token:${text}`, text, slotId: text }));
  const slots = [{ id: 'a' }, { id: 'b', marker: undefined }, { id: 'child' }];
  const selected = ['a', 'b'];
  const basic = createGroup(tokens, slots, selected);
  assert.equal(basic.kind, 'basic');
  selected.pop();
  assert.deepEqual(basic.slots, ['a', 'b']);
  for (const { value } of DEFAULT_MARKER_INPUT_BINDINGS) {
    assert.equal(createGroup(tokens, setSlotMarker(slots, 'b', value), ['a', 'b']).kind, 'composite');
    assert.equal(createGroup(tokens, setSlotMarker(slots, 'b', value), ['b']).kind, 'composite');
  }
  assert.equal(createGroup(tokens, slots, ['child']).kind, 'composite');
  assert.equal(createGroup(tokens, slots, ['a', 'child']).kind, 'composite');
  assert.throws(() => createGroup(tokens, slots, []));
  assert.throws(() => createGroup(tokens, slots, ['missing']));
});

test('the example contains two basic underlines and a composite referencing them', () => {
  const document = createExampleDocument();
  const [student, explanation, predicate] = document.groups;
  assert.deepEqual(document.groups.map(({ kind }) => kind), ['basic', 'basic', 'composite']);
  assert.deepEqual(student.slots, document.tokens.slice(2, 4).map(({ slotId }) => slotId));
  assert.deepEqual(explanation.slots, document.tokens.slice(4).map(({ slotId }) => slotId));
  assert.deepEqual(predicate.slots, [document.tokens[1].slotId, student.slotId, explanation.slotId]);
  assert.equal(isSavedState(JSON.parse(JSON.stringify(document))), true);
  assert.deepEqual(computeLayout(document.tokens, document.groups).groups.map(({ y }) => y), [0, 0, 1]);
});

test('marker edits reclassify eligible composites without changing references', () => {
  const document = createExampleDocument();
  document.slots = document.slots.slice(0, document.tokens.length);
  const selected = document.tokens.slice(1).map((token) => token.slotId);
  const group = createGroup(document.tokens, document.slots, selected);
  document.groups = [group];
  document.slots.push({ id: group.slotId });
  assert.equal(group.kind, 'composite');
  const before = { document, cursor: { x: 1, y: 1 } };
  const after = structuredClone(before);
  after.document.slots = setSlotMarker(after.document.slots, document.tokens[1].slotId);
  after.document = reclassifyGroups(after.document);
  assert.equal(after.document.groups[0].kind, 'basic');
  assert.deepEqual(after.document.groups[0].slots, selected);
  assert.equal(isSavedState(after.document), true);
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), after);
});

test('zero-row marker editing and deletion retain hidden token data through save and history', () => {
  const document = createExampleDocument();
  // A previously edited token marker remains stored beneath its basic group.
  document.slots = setSlotMarker(document.slots, document.tokens[2].slotId, 'marker.adverb');
  const originalTokenSlots = structuredClone(document.slots.slice(0, document.tokens.length));
  const layout = computeLayout(document.tokens, document.groups);
  const student = document.groups[0];
  const edited = structuredClone(document);
  edited.slots = setSlotMarker(edited.slots, slotAt(layout, 2, 0), 'marker.subject');
  assert.deepEqual(edited.slots.slice(0, document.tokens.length), originalTokenSlots);
  assert.equal(edited.slots.find(({ id }) => id === student.slotId).marker, 'marker.subject');
  const before = { document: JSON.parse(JSON.stringify(edited)), cursor: { x: 2, y: 0 } };
  assert.equal(isSavedState(before.document), true);
  const after = structuredClone(before);
  const target = groupForDeletion(computeLayout(after.document.tokens, after.document.groups), before.cursor);
  after.document = deleteGroup(after.document, target.id);
  assert.deepEqual(after.document.groups.map((group) => group.id), [document.groups[1].id]);
  assert.deepEqual(after.document.tokens, document.tokens);
  assert.deepEqual(after.document.slots.slice(0, document.tokens.length), originalTokenSlots);
  assert.equal(slotAt(computeLayout(after.document.tokens, after.document.groups), 2, 0), document.tokens[2].slotId);
  assert.equal(isSavedState(after.document), true);
  const history = new EditHistory();
  history.record(before, after);
  const restored = history.undo();
  assert.equal(slotAt(computeLayout(restored.document.tokens, restored.document.groups), 2, 0), student.slotId);
  assert.deepEqual(restored, before);
  assert.deepEqual(history.redo(), after);
});

test('current schema rejects missing or unknown kinds, inner versions and invalid references', () => {
  const mutations = [
    (s) => { s.version = 2; },
    (s) => { delete s.groups[0].kind; },
    (s) => { s.groups[0].kind = 'unknown'; },
    (s) => { s.groups[2].kind = 'basic'; },
    (s) => { s.groups[2].slots = [s.groups[2].slotId]; },
    (s) => { s.groups[0].slots = ['missing']; },
    (s) => { s.groups[0].slots = []; },
    (s) => { s.slots[0].marker = 'invalid'; },
    (s) => { s.slots[0].marker = { kind: 'custom', text: '' }; },
    (s) => { s.slots[0].marker = { kind: 'custom', text: ' untrimmed ' }; },
    (s) => { s.slots[0].marker = { kind: 'unknown', text: 'x' }; },
    (s) => { s.slots.push({ ...s.slots[0] }); },
  ];
  for (const mutate of mutations) {
    const document = createExampleDocument();
    mutate(document);
    assert.equal(isSavedState(document), false);
  }
});

test('custom markers are valid, non-empty markers without built-in arrow semantics', () => {
  const document = createExampleDocument();
  document.slots[0].marker = { kind: 'custom', text: '自由' };
  document.arrows = [];
  assert.equal(isSavedState(JSON.parse(JSON.stringify(document))), true);
  assert.equal(createGroup(document.tokens, document.slots, [document.tokens[0].slotId]).kind, 'composite');
});

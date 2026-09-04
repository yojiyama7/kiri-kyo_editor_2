import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKER_LABELS, isMarker, isMarkerId, markerFromText, markerLabel, nextMarkerInput as resolveMarkerInput, setSlotMarker } from '../src/markers.ts';
import { DEFAULT_MARKER_INPUT_BINDINGS } from '../src/inputConfig.ts';
import { EditHistory } from '../src/history.ts';
import { isSavedState } from '../src/model.ts';

const expected = {
  s: 'S', V: 'V', 1: '(1)', 2: '(2)', 3: '(3)', 4: '(4)', 5: '(5)',
  '-3': '(-3)', '-4': '-(4)', '-5': '-(5)', a: 'a', ad: 'ad', ac: 'aC',
  n: 'n', nad: '誘導副詞', nC: 'nC', o: 'O', o1: 'O1', o2: 'O2',
  aux: 'aux', pre: '前', con: '接', ado: '副詞的目的格', sad: '文ad',
  nc: 'nC', "s'": "S'", '+': '+', ps: '仮S', as: '真S',
};
const nextMarkerInput = (buffer, key, bindings) => resolveMarkerInput(buffer, { key }, bindings);

test('all 29 bindings produce the specified labels through sequential input', () => {
  assert.equal(DEFAULT_MARKER_INPUT_BINDINGS.length, 29);
  assert.deepEqual(Object.fromEntries(DEFAULT_MARKER_INPUT_BINDINGS.map(({ sequence, value }) => [sequence, markerLabel(value)])), expected);
  for (const [input, label] of Object.entries(expected)) {
    let buffer = '';
    let result;
    for (const key of input) {
      result = nextMarkerInput(buffer, key);
      assert.equal(result.handled, true);
      assert.equal(result.restarted, false);
      buffer = result.buffer;
    }
    assert.equal(isMarkerId(result.marker), true);
    assert.equal(markerLabel(result.marker), label);
    assert.equal(Object.hasOwn(MARKER_LABELS, result.marker), true);
  }
});

test('plus commits immediately and can replace a pending marker', () => {
  assert.deepEqual(nextMarkerInput('', '+'), { handled: true, restarted: false, marker: 'marker.plus', buffer: '' });
  assert.deepEqual(nextMarkerInput('a', '+'), { handled: true, restarted: true, marker: 'marker.plus', buffer: '' });
  const document = {
    version: 6, arrows: [], splits: [], tokens: [{ id: 't', text: 'a', slotId: 't' }],
    slots: setSlotMarker([{ id: 't', marker: 'marker.subject' }], 't', 'marker.plus'), groups: [], translation: '',
  };
  assert.equal(document.slots[0].marker, 'marker.plus');
  assert.equal(isSavedState(JSON.parse(JSON.stringify(document))), true);
});

test('short matches display immediately and remain open for longer bindings', () => {
  assert.deepEqual(nextMarkerInput('', 'a'), { handled: true, restarted: false, marker: 'marker.adjective', buffer: 'a' });
  assert.deepEqual(nextMarkerInput('a', 'd'), { handled: true, restarted: false, marker: 'marker.adverb', buffer: 'ad' });
  assert.deepEqual(nextMarkerInput('ad', 'o'), { handled: true, restarted: false, marker: 'marker.adverbialObjective', buffer: '' });
  assert.deepEqual(nextMarkerInput('', 'n'), { handled: true, restarted: false, marker: 'marker.noun', buffer: 'n' });
  assert.deepEqual(nextMarkerInput('n', 'a'), { handled: true, restarted: false, marker: undefined, buffer: 'na' });
  assert.deepEqual(nextMarkerInput('na', 'd'), { handled: true, restarted: false, marker: 'marker.introductoryAdverb', buffer: '' });
  assert.deepEqual(nextMarkerInput('n', 'C'), { handled: true, restarted: false, marker: 'marker.nounComplement', buffer: '' });
  assert.deepEqual(nextMarkerInput('', 's'), { handled: true, restarted: false, marker: 'marker.subject', buffer: 's' });
  assert.deepEqual(nextMarkerInput('s', 'a'), { handled: true, restarted: false, marker: undefined, buffer: 'sa' });
  assert.deepEqual(nextMarkerInput('sa', 'd'), { handled: true, restarted: false, marker: 'marker.sentenceAdverb', buffer: '' });
  assert.deepEqual(nextMarkerInput('a', 'u'), { handled: true, restarted: false, marker: undefined, buffer: 'au' });
  assert.deepEqual(nextMarkerInput('au', 'x'), { handled: true, restarted: false, marker: 'marker.auxiliary', buffer: '' });
  assert.equal(nextMarkerInput('a', 'c').marker, 'marker.adjectiveComplement');
  assert.equal(nextMarkerInput('', 'o').marker, 'marker.object');
  assert.equal(nextMarkerInput('o', '1').marker, 'marker.object1');
  assert.equal(nextMarkerInput('o', '2').buffer, '');
});

test('prefixes do not replace the existing marker and mismatches retry only the new key', () => {
  for (const key of ['-', 'p']) {
    const pending = nextMarkerInput('', key);
    assert.equal(pending.marker, undefined);
    assert.equal(pending.buffer, key);
  }
  assert.deepEqual(nextMarkerInput('a', 'n'), { handled: true, restarted: true, marker: 'marker.noun', buffer: 'n' });
  assert.equal(nextMarkerInput('-', '1').marker, 'marker.number1');
  assert.equal(nextMarkerInput('n', 'o').buffer, 'o');
  for (const key of ['Escape', 'ArrowRight', 'Enter', 'v', 'x', 'Tab']) {
    const result = nextMarkerInput('a', key);
    assert.equal(result.handled, false);
    assert.equal(result.restarted, true);
    assert.equal(result.buffer, '');
    assert.equal(result.marker, undefined);
  }
  assert.equal(nextMarkerInput('', 'd').handled, false);
  assert.equal(nextMarkerInput('', 'u').handled, false);
});

test('matching and persisted IDs are case-sensitive and reject invalid values', () => {
  assert.equal(nextMarkerInput('', 'v').handled, false);
  assert.equal(nextMarkerInput('', 'V').marker, 'marker.verb');
  assert.equal(nextMarkerInput('n', 'C').marker, 'marker.nounComplement');
  assert.equal(nextMarkerInput('n', 'c').marker, 'marker.nounComplement');
  for (const value of ['S', "S'", 'O1', 'aC', 'N', '', null, {}, 3]) assert.equal(isMarkerId(value), false);
  assert.equal(markerLabel(undefined), '');
});

test('free marker text trims input, resolves canonical labels and preserves custom labels', () => {
  assert.equal(markerFromText('  ad  '), 'marker.adverb');
  assert.equal(markerFromText(' S '), 'marker.subject');
  assert.deepEqual(markerFromText('  任意 / 😀  '), { kind: 'custom', text: '任意 / 😀' });
  assert.equal(markerFromText('   '), undefined);
  assert.equal(markerLabel({ kind: 'custom', text: '任意' }), '任意');
  assert.equal(isMarker({ kind: 'custom', text: '任意' }), true);
  for (const value of [{ kind: 'custom', text: '' }, { kind: 'custom', text: ' x ' },
    { kind: 'other', text: 'x' }, { kind: 'custom' }]) assert.equal(isMarker(value), false);
});

test('custom input sequences resolve to the same key-independent marker ID', () => {
  const bindings = [{ sequence: 'z', value: 'marker.subject' }];
  assert.deepEqual(nextMarkerInput('', 'z', bindings), {
    handled: true, restarted: false, marker: 'marker.subject', buffer: '',
  });
  assert.equal(isMarkerId('s'), false);
  assert.equal(isMarkerId('marker.subject'), true);
});

test('markers replace or clear one slot without changing slot references or input data', () => {
  const slots = [{ id: 'token' }, { id: 'group', marker: 'marker.subject' }];
  const edited = setSlotMarker(slots, 'group', 'marker.adverb');
  assert.equal(edited[0], slots[0]);
  assert.deepEqual(edited[1], { id: 'group', marker: 'marker.adverb' });
  assert.deepEqual(slots[1], { id: 'group', marker: 'marker.subject' });
  assert.deepEqual(setSlotMarker(edited, 'group'), [{ id: 'token' }, { id: 'group' }]);
  assert.equal(setSlotMarker(slots, 'group', 'marker.subject')[1], slots[1]);
  const custom = setSlotMarker(slots, 'group', { kind: 'custom', text: '自由' });
  assert.deepEqual(custom[1].marker, { kind: 'custom', text: '自由' });
  assert.equal(setSlotMarker(custom, 'group', { kind: 'custom', text: '自由' })[1], custom[1]);
  assert.deepEqual(setSlotMarker(slots, 'missing', 'marker.verb'), slots);
});

test('marker edits round-trip through JSON and history, including empty slots and no-ops', () => {
  const before = {
    document: { version: 6, arrows: [], splits: [], tokens: [{ id: 't', text: 'a', slotId: 't' }],
      slots: [{ id: 't' }, { id: 'g' }], groups: [{ kind: 'basic', id: 'g', slotId: 'g', slots: ['t'] }], translation: '' },
    cursor: { x: 0, y: 1 },
  };
  const after = structuredClone(before);
  after.document.slots = setSlotMarker(after.document.slots, 'g', 'marker.adjective');
  after.document.slots = setSlotMarker(after.document.slots, 'g', 'marker.adverb');
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(JSON.parse(JSON.stringify(after)), after);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  history.record(before, { ...before, document: { ...before.document, slots: setSlotMarker(before.document.slots, 't') } });
  assert.deepEqual(history.redo(), after);
  const deleted = structuredClone(after);
  deleted.document.slots = setSlotMarker(deleted.document.slots, 'g');
  history.record(after, deleted);
  assert.deepEqual(history.undo(), after);
});

test('nad is one marker transaction, persists, and consumes d rather than invoking a split', () => {
  const before = {
    document: { version: 6, arrows: [], splits: [], tokens: [{ id: 't', text: 'there', slotId: 't' }],
      slots: [{ id: 't', marker: 'marker.subject' }], groups: [], translation: '' },
    cursor: { x: 0, y: 0 },
  };
  const after = structuredClone(before);
  let buffer = '';
  for (const key of 'nad') {
    const result = nextMarkerInput(buffer, key);
    assert.equal(result.handled, true);
    assert.equal(result.restarted, false);
    if (result.marker !== undefined) after.document.slots = setSlotMarker(after.document.slots, 't', result.marker);
    buffer = result.buffer;
  }
  assert.equal(buffer, '');
  assert.equal(after.document.slots[0].marker, 'marker.introductoryAdverb');
  assert.equal(isSavedState(JSON.parse(JSON.stringify(after.document))), true);
  const history = new EditHistory();
  history.record(before, after);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), after);
  assert.deepEqual(nextMarkerInput('na', 'Escape'), { handled: false, restarted: true, marker: undefined, buffer: '' });
});

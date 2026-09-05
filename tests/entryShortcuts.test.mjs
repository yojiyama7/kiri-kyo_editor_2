import test from 'node:test';
import assert from 'node:assert/strict';
import { entryShortcut } from '../src/entryShortcuts.ts';

const event = (key, extra = {}) => ({
  key, code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, keyCode: 0, ...extra,
});

test('Ctrl+n/p move entries; Alt+j/k reorder, including macOS Option characters', () => {
  assert.equal(entryShortcut(event('n', { ctrlKey: true }), null), 'entry.next');
  assert.equal(entryShortcut(event('p', { ctrlKey: true }), null), 'entry.previous');
  assert.equal(entryShortcut(event('j', { altKey: true }), null), 'entry.reorderDown');
  assert.equal(entryShortcut(event('k', { altKey: true }), null), 'entry.reorderUp');
  assert.equal(entryShortcut(event('∆', { code: 'KeyJ', altKey: true }), null), 'entry.reorderDown');
  assert.equal(entryShortcut(event('˚', { code: 'KeyK', altKey: true }), null), 'entry.reorderUp');
});

test('input mode and composition/modifier guards also apply to repeated shortcuts', () => {
  for (const input of [event('n', { ctrlKey: true }), event('p', { ctrlKey: true }),
    event('j', { altKey: true }), event('k', { altKey: true })]) {
    for (const repeat of [false, true]) {
      for (const mode of ['INSERT', 'PSEUDO_INPUT', 'MARKER_INPUT']) {
        assert.equal(entryShortcut({ ...input, repeat }, mode), undefined);
      }
      for (const extra of [{ isComposing: true }, { keyCode: 229 }, { metaKey: true }, { shiftKey: true }, { ctrlKey: true, altKey: true }]) {
        for (const mode of [null, 'INSERT', 'TRANSLATION', 'PSEUDO_INPUT', 'MARKER_INPUT', 'MARKER_SEQUENCE', 'FORM']) {
          assert.equal(entryShortcut({ ...input, ...extra, repeat }, mode), undefined);
        }
      }
    }
  }
});

test('marker sequence mode allows entry movement but not reordering', () => {
  assert.equal(entryShortcut(event('n', { ctrlKey: true }), 'MARKER_SEQUENCE'), 'entry.next');
  assert.equal(entryShortcut(event('p', { ctrlKey: true }), 'MARKER_SEQUENCE'), 'entry.previous');
  assert.equal(entryShortcut(event('j', { altKey: true }), 'MARKER_SEQUENCE'), undefined);
  assert.equal(entryShortcut(event('k', { altKey: true }), 'MARKER_SEQUENCE'), undefined);
});

test('ordinary navigation, negative markers, redo and superseded Ctrl+j/k remain available to the entry editor', () => {
  for (const input of [event('n'), event('p'), event('j'), event('k'), event('-'),
    event('r', { ctrlKey: true }), event('j', { ctrlKey: true }), event('k', { ctrlKey: true })]) {
    assert.equal(entryShortcut(input, null), undefined);
  }
});


test('translation input allows Ctrl+n/p but keeps Alt+j/k available for text input', () => {
  assert.equal(entryShortcut(event('n', { ctrlKey: true }), 'TRANSLATION'), 'entry.next');
  assert.equal(entryShortcut(event('p', { ctrlKey: true }), 'TRANSLATION'), 'entry.previous');
  for (const input of [event('j', { altKey: true }), event('k', { altKey: true }),
    event('∆', { code: 'KeyJ', altKey: true }), event('˚', { code: 'KeyK', altKey: true })]) {
    assert.equal(entryShortcut(input, 'TRANSLATION'), undefined);
    assert.equal(entryShortcut(input, 'INSERT'), undefined);
  }
});

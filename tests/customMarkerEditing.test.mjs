import assert from 'node:assert/strict';
import test from 'node:test';
import { customMarkerInputAction } from '../src/customMarkerEditing.ts';

const key = (key, extra = {}) => ({ key, code: '', keyCode: 0, isComposing: false, repeat: false,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

test('free marker input commits and cancels while protecting IME and modified input', () => {
  assert.equal(customMarkerInputAction(key('Enter'), false), 'marker.customCommit');
  assert.equal(customMarkerInputAction(key('Escape'), false), 'editor.cancel');
  assert.equal(customMarkerInputAction(key('[', { ctrlKey: true }), false), 'editor.cancel');
  for (const input of [key('Enter', { isComposing: true }), key('Escape', { keyCode: 229 }),
    key('Enter', { repeat: true }), key('r', { ctrlKey: true }), key('x', { metaKey: true }),
    key('x', { altKey: true }), key('X', { shiftKey: true })]) {
    assert.equal(customMarkerInputAction(input, false), undefined);
  }
  assert.equal(customMarkerInputAction(key('Enter'), true), undefined);
});

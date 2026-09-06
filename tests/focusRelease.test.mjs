import assert from 'node:assert/strict';
import test from 'node:test';
import { blurFocusedWebControl, scheduleEscapeFocusRelease, WEB_CONTROL_SELECTOR } from '../src/focusRelease.ts';

function control(matches = true) {
  let blurred = 0;
  return { element: { matches: selector => matches && selector === WEB_CONTROL_SELECTOR, blur: () => { blurred++; } }, blurred: () => blurred };
}

test('Escape releases a web control after existing key handling has completed', () => {
  const focused = control(), scheduled = [];
  assert.equal(scheduleEscapeFocusRelease({ key: 'Escape' }, { activeElement: focused.element }, callback => scheduled.push(callback)), true);
  assert.equal(focused.blurred(), 0);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(focused.blurred(), 1);
});

test('Escape releases buttons, inputs and equivalent web controls only', () => {
  const focused = control();
  assert.equal(blurFocusedWebControl({ activeElement: focused.element }), true);
  assert.equal(focused.blurred(), 1);
  assert.equal(blurFocusedWebControl({ activeElement: control(false).element }), false);
  assert.equal(blurFocusedWebControl({ activeElement: null }), false);
});

test('non-Escape and IME events do not schedule focus release', () => {
  const focused = control(), scheduled = [];
  assert.equal(scheduleEscapeFocusRelease({ key: 'Enter' }, { activeElement: focused.element }, callback => scheduled.push(callback)), false);
  assert.equal(scheduleEscapeFocusRelease({ key: 'Escape', isComposing: true }, { activeElement: focused.element }, callback => scheduled.push(callback)), false);
  assert.equal(scheduleEscapeFocusRelease({ key: 'Escape', keyCode: 229 }, { activeElement: focused.element }, callback => scheduled.push(callback)), false);
  assert.equal(scheduled.length, 0);
});

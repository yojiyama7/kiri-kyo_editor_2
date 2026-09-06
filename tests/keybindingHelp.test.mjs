import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPERATIONS, INPUT_MODES } from '../src/keybindings.ts';
import { MODE_ABBREVIATIONS, MODE_HELP, MODE_NAMES, operationHelp } from '../src/keybindingHelp.ts';

test('every configurable operation has complete help text', () => {
  for (const operation of OPERATIONS) {
    const help = operationHelp(operation.id);
    assert.ok(help, `${operation.id} has no help`);
    assert.ok(help.summary.length >= 10, `${operation.id} summary is too short`);
    assert.ok(help.description.length >= 20, `${operation.id} description is too short`);
    assert.ok(help.example.length >= 20, `${operation.id} example is too short`);
  }
});

test('every input mode has a display label', () => {
  assert.deepEqual(Object.keys(MODE_HELP).sort(), [...INPUT_MODES].sort());
  assert.ok(Object.values(MODE_HELP).every(label => label.length > 0));
});

test('every input mode has a unique one or two letter abbreviation', () => {
  assert.deepEqual(Object.keys(MODE_ABBREVIATIONS).sort(), [...INPUT_MODES].sort());
  assert.ok(Object.values(MODE_ABBREVIATIONS).every(label => /^[A-Z]{1,2}$/.test(label)));
  assert.equal(new Set(Object.values(MODE_ABBREVIATIONS)).size, INPUT_MODES.length);
});

test('every input mode has a lowercase English name', () => {
  assert.deepEqual(Object.keys(MODE_NAMES).sort(), [...INPUT_MODES].sort());
  assert.ok(Object.values(MODE_NAMES).every(name => /^[a-z]+(?: [a-z]+)*$/.test(name)));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { matchesKeyboardInput } from '../src/keyboard.ts';
import { KEYBOARD_OPERATION_IDS, isKeyboardOperationId, resolveKeyboardOperation } from '../src/keyboardOperations.ts';
import { DEFAULT_FORM_INPUT_BINDINGS, DEFAULT_MARKER_INPUT_BINDINGS, operationKeyLabel } from '../src/inputConfig.ts';

test('keyboard rules match scalar values, value lists, OR alternatives and AND fields', () => {
  const input = { key: '∆', code: 'KeyJ', altKey: true };
  assert.equal(matchesKeyboardInput(input, [{ key: ['j', '∆'], code: 'KeyJ', altKey: true }]), true);
  assert.equal(matchesKeyboardInput(input, [{ key: 'j', altKey: true }, { code: 'KeyJ', altKey: true }]), true);
  assert.equal(matchesKeyboardInput(input, [{ key: '∆', code: 'KeyK', altKey: true }]), false);
  assert.equal(matchesKeyboardInput({ key: 'Escape' }, [{ key: 'Enter' }, { key: 'Escape' }]), true);
});

test('omitted booleans mean false and null makes a boolean unconstrained', () => {
  const repeatedCtrlR = { key: 'r', ctrlKey: true, repeat: true };
  assert.equal(matchesKeyboardInput(repeatedCtrlR, [{ key: 'r' }]), false);
  assert.equal(matchesKeyboardInput(repeatedCtrlR, [{ key: 'r', ctrlKey: true }]), false);
  assert.equal(matchesKeyboardInput(repeatedCtrlR, [{ key: 'r', ctrlKey: true, repeat: null }]), true);
  assert.equal(matchesKeyboardInput({ key: 'r' }, [{ key: 'r' }]), true);
});

test('keyCode, composition, repeat and key length are available as JSON conditions', () => {
  assert.equal(matchesKeyboardInput({ key: 'Process', keyCode: 229 }, [{ keyCode: 229 }]), true);
  assert.equal(matchesKeyboardInput({ key: 'a', isComposing: true }, [{ isComposing: true }]), true);
  assert.equal(matchesKeyboardInput({ key: 'a', repeat: true }, [{ repeat: true }]), true);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [{ keyLength: 1 }]), true);
  assert.equal(matchesKeyboardInput({ key: 'Enter' }, [{ keyLength: [1, 2] }]), false);
});

test('empty and malformed JSON-compatible rules do not match', () => {
  assert.equal(matchesKeyboardInput({ key: 'a' }, []), false);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [null]), false);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [{ key: 1 }]), false);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [{ unknown: 'a' }]), false);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [{ repeat: 'yes' }]), false);
  assert.equal(matchesKeyboardInput({ key: 'a' }, [{ keyLength: Number.NaN }]), false);
});

test('keyboard bindings resolve stable operation IDs independently from their keys', () => {
  const bindings = [
    { operation: 'cursor.left', rules: [{ key: ['h', 'ArrowLeft'] }] },
    { operation: 'editor.cancel', rules: [{ key: 'Escape' }] },
  ];
  assert.equal(resolveKeyboardOperation({ key: 'h' }, bindings), 'cursor.left');
  assert.equal(resolveKeyboardOperation({ key: 'ArrowLeft' }, bindings), 'cursor.left');
  assert.equal(resolveKeyboardOperation({ key: 'Escape' }, bindings), 'editor.cancel');
  assert.equal(resolveKeyboardOperation({ key: 'x' }, bindings), undefined);
  assert.equal(new Set(KEYBOARD_OPERATION_IDS).size, KEYBOARD_OPERATION_IDS.length);
  for (const operation of KEYBOARD_OPERATION_IDS) assert.equal(isKeyboardOperationId(operation), true);
  assert.equal(isKeyboardOperationId('unknown.operation'), false);
  assert.equal(isKeyboardOperationId(1), false);
});

test('the first matching binding defines deterministic operation precedence', () => {
  assert.equal(resolveKeyboardOperation({ key: 'Enter' }, [
    { operation: 'arrow.commit', rules: [{ key: 'Enter' }] },
    { operation: 'selection.commit', rules: [{ key: 'Enter' }] },
  ]), 'arrow.commit');
});

test('guide labels and sequence bindings are resolved from IDs in input configuration', () => {
  assert.equal(operationKeyLabel('entry.next'), 'Ctrl+n');
  assert.equal(operationKeyLabel('editor.cancel'), 'Esc / Ctrl+[');
  assert.equal(new Set(DEFAULT_MARKER_INPUT_BINDINGS.map(binding => binding.sequence)).size,
    DEFAULT_MARKER_INPUT_BINDINGS.length);
  assert.equal(new Set(DEFAULT_FORM_INPUT_BINDINGS.map(binding => binding.sequence)).size,
    DEFAULT_FORM_INPUT_BINDINGS.length);
  assert.ok(DEFAULT_MARKER_INPUT_BINDINGS.every(binding => binding.sequence !== binding.value));
  assert.ok(DEFAULT_FORM_INPUT_BINDINGS.every(binding => binding.sequence !== binding.value));
});

test('guides contain no hard-coded kbd text and saved fields contain no key-derived IDs', () => {
  for (const file of ['App.svelte', 'EntryEditor.svelte']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /<kbd>\s*[^<{\s]/, file);
  }
  const files = ['model.ts', 'markers.ts', 'example.ts', 'formEditing.ts', 'EntryEditor.svelte'];
  const persistedBinding = /\b(?:marker|form|leftForm|rightForm)\s*:\s*['"](?:s|V|a|ad|ado|sad|n|nc|nC|o|o1|o2|b|c|p|pp|ing)['"]/;
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, persistedBinding, file);
  }
});

test('keyboard event comparisons stay inside the shared matcher', () => {
  const files = ['App.svelte', 'EntryEditor.svelte', 'entryShortcuts.ts', 'pseudoEditing.ts',
    'borderNavigation.ts', 'formEditing.ts', 'markers.ts'];
  const forbidden = [
    /event\.(?:key|code|keyCode|ctrlKey|altKey|metaKey|shiftKey|repeat|isComposing)\s*(?:===|!==)/,
    /!\s*event\.(?:key|code|keyCode|ctrlKey|altKey|metaKey|shiftKey|repeat|isComposing)/,
    /event\.(?:ctrlKey|altKey|metaKey|shiftKey|repeat|isComposing)\s*(?:&&|\|\|)/,
    /\.includes\(event\.(?:key|code|keyCode)\)/,
    /(?:event|input)\.key(?:\.|\?\.)length\s*(?:===|!==|<|>)/,
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTestFiles } from './run-tests.mjs';

const files = ['tests/model.test.mjs', 'tests/timing.slow.test.mjs',
  'tests/slow/browser.test.mjs', 'tests/slow/nested/save.test.mjs', 'tests/README.md'];

test('normal test runs exclude explicitly slow tests without running them to time them', () => {
  assert.deepEqual(selectTestFiles(files), ['tests/model.test.mjs']);
});
test('explicit all runs include fast and slow tests', () => {
  assert.deepEqual(selectTestFiles(files, 'all'), files.filter(file => file.endsWith('.test.mjs')).sort());
});
test('explicit slow runs include only designated slow tests', () => {
  assert.deepEqual(selectTestFiles(files, 'slow'), files.slice(1, 4).sort());
});
test('invalid run modes fail closed and Windows paths are classified', () => {
  assert.throws(() => selectTestFiles(files, 'unknown'));
  assert.deepEqual(selectTestFiles(['tests\\slow\\browser.test.mjs']), []);
});

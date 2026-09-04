import assert from 'node:assert/strict';
import test from 'node:test';
import { writeChangedDocument } from '../src/documentPersistence.ts';
import { createEditorUpdates } from '../src/editorUpdates.ts';

test('unchanged documents are not written again after idle save and page departure', () => {
  const document = { version: 7, entries: [] };
  const writes = [];
  const first = writeChangedDocument(document, undefined, (raw) => writes.push(raw));
  assert.equal(first.status, 'saved');
  const second = writeChangedDocument(document, first.raw, (raw) => writes.push(raw));
  assert.deepEqual(second, { status: 'unchanged' });
  assert.deepEqual(writes, [JSON.stringify(document)]);
});

test('storage failure keeps the old snapshot and allows the same change to be retried', () => {
  const before = { translation: 'before' };
  const next = { translation: 'after' };
  const lastWritten = JSON.stringify(before);
  let stored = lastWritten;
  const failed = writeChangedDocument(next, lastWritten, () => { throw new Error('quota exceeded'); });
  assert.deepEqual(failed, { status: 'error', error: 'Error: quota exceeded' });
  assert.equal(stored, lastWritten);
  const retried = writeChangedDocument(next, lastWritten, (raw) => { stored = raw; });
  assert.deepEqual(retried, { status: 'saved', raw: JSON.stringify(next) });
  assert.equal(stored, JSON.stringify(next));
});

test('a failed delayed save is retried on page departure without leaving a stale timer', () => {
  let task;
  let lastWritten;
  let fail = true;
  const attempts = [];
  const document = { translation: 'latest' };
  const updates = createEditorUpdates({
    debug() {},
    save() {
      const result = writeChangedDocument(document, lastWritten, (raw) => {
        attempts.push(raw);
        if (fail) throw new Error('unavailable');
      });
      if (result.status === 'saved') lastWritten = result.raw;
    },
  }, {
    setTimeout(callback) { task = callback; return callback; },
    clearTimeout(handle) { if (handle === task) task = undefined; },
  });
  updates.schedule();
  task();
  task = undefined;
  assert.equal(lastWritten, undefined);
  fail = false;
  updates.flushSave();
  assert.equal(task, undefined);
  assert.equal(lastWritten, JSON.stringify(document));
  updates.flushSave();
  assert.equal(attempts.length, 2);
});

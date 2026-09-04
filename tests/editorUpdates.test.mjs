import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorUpdates } from '../src/editorUpdates.ts';

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...tasks].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= end);
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = end;
    },
    get pending() { return tasks.size; },
  };
}

function setup() {
  const clock = fakeClock();
  const calls = [];
  const updates = createEditorUpdates({
    debug: () => calls.push('debug'), save: () => calls.push('save'),
  }, clock);
  return { clock, calls, updates };
}

test('one timer saves then refreshes debug at 500ms, without any synchronous work', () => {
  const { clock, calls, updates } = setup();
  for (let i = 0; i < 50; i++) updates.schedule();
  assert.equal(clock.pending, 1);
  assert.deepEqual(calls, []);
  clock.advance(499);
  assert.deepEqual(calls, []);
  clock.advance(1);
  assert.deepEqual(calls, ['save', 'debug']);
  clock.advance(10000);
  assert.equal(clock.pending, 0);
  assert.deepEqual(calls, ['save', 'debug']);
});

test('all operations, including mode exit and selection, restart the same 500ms timer', () => {
  const { clock, calls, updates } = setup();
  for (const operation of ['input', 'selection', 'mode exit', 'entry switch']) {
    updates.schedule();
    clock.advance(499);
    assert.deepEqual(calls, [], operation);
  }
  clock.advance(1);
  assert.deepEqual(calls, ['save', 'debug']);
});

test('debug sees the newly written state immediately, not another 500ms later', () => {
  const clock = fakeClock();
  let saved = 'old';
  let displayed;
  const updates = createEditorUpdates({
    save: () => { saved = 'new'; }, debug: () => { displayed = saved; },
  }, clock);
  updates.schedule();
  clock.advance(500);
  assert.equal(displayed, 'new');
  assert.equal(clock.pending, 0);
});

test('save guard can block incomplete IME/marker state; completion schedules the shared task', () => {
  const clock = fakeClock();
  let blocked = true;
  const calls = [];
  const updates = createEditorUpdates({
    save: () => { if (!blocked) calls.push('save'); }, debug: () => calls.push('debug'),
  }, clock);
  updates.schedule();
  clock.advance(10000);
  assert.deepEqual(calls, ['debug']);
  blocked = false;
  updates.schedule();
  clock.advance(499);
  assert.deepEqual(calls, ['debug']);
  clock.advance(1);
  assert.deepEqual(calls, ['debug', 'save', 'debug']);
});

test('page departure flushes saving and cancels the idle task', () => {
  const { clock, calls, updates } = setup();
  updates.schedule();
  clock.advance(100);
  updates.flushSave();
  assert.deepEqual(calls, ['save']);
  clock.advance(5000);
  assert.deepEqual(calls, ['save']);
});

test('rapid entry switches save only the latest document, never an old captured snapshot', () => {
  const clock = fakeClock();
  let document = 'first entry';
  const saves = [];
  const updates = createEditorUpdates({ debug() {}, save: () => saves.push(document) }, clock);
  updates.schedule();
  clock.advance(400);
  document = 'second entry';
  updates.schedule();
  clock.advance(499);
  assert.deepEqual(saves, []);
  document = 'second entry, latest text';
  clock.advance(1);
  assert.deepEqual(saves, ['second entry, latest text']);
});

test('copy refreshes debug without saving or changing the pending save deadline', () => {
  const { clock, calls, updates } = setup();
  updates.schedule();
  clock.advance(100);
  updates.flushDebug();
  assert.deepEqual(calls, ['debug']);
  clock.advance(399);
  assert.deepEqual(calls, ['debug']);
  clock.advance(1);
  assert.deepEqual(calls, ['debug', 'save', 'debug']);
});

test('external storage refresh does not overwrite the external document', () => {
  const { clock, calls, updates } = setup();
  updates.schedule(false);
  clock.advance(500);
  assert.deepEqual(calls, ['debug']);
});

test('external storage refresh neither cancels nor postpones a local pending save', () => {
  const { clock, calls, updates } = setup();
  updates.schedule();
  clock.advance(400);
  updates.schedule(false);
  clock.advance(100);
  assert.deepEqual(calls, ['save', 'debug']);
});

test('dispose cancels the task and prevents further work', () => {
  const { clock, calls, updates } = setup();
  updates.schedule();
  updates.dispose();
  updates.schedule();
  updates.flushSave();
  updates.flushDebug();
  clock.advance(10000);
  assert.equal(clock.pending, 0);
  assert.deepEqual(calls, []);
});

for (const count of [10, 50]) {
  test(`${count} entries: rapid input does no debug serialization or saving until the shared deadline`, () => {
    const clock = fakeClock();
    const entries = Array.from({ length: count }, (_, i) => ({ id: i, translation: '' }));
    const debug = [];
    const saved = [];
    const updates = createEditorUpdates({
      debug: () => debug.push(JSON.stringify(entries)),
      save: () => saved.push(JSON.stringify(entries)),
    }, clock);
    // Virtual time only; no real-time waits in the default test suite.
    for (let i = 0; i < 100; i++) {
      entries[0].translation += 'あ';
      updates.schedule();
      clock.advance(50);
    }
    assert.equal(debug.length, 0);
    assert.equal(saved.length, 0);
    clock.advance(450);
    assert.deepEqual(debug, [JSON.stringify(entries)]);
    assert.deepEqual(saved, [JSON.stringify(entries)]);
  });
}

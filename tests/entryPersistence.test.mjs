import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntryPersistence, changedEntries, parseRecovery } from '../src/entryPersistence.ts';
import { createEditorUpdates } from '../src/editorUpdates.ts';
import { createPersistenceClient } from '../src/persistenceClient.ts';

const entry = (id, text = '') => ({ id, document: {
  tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup() {
  const requests = [];
  let status;
  const queue = createEntryPersistence(batch => new Promise((resolve, reject) => {
    requests.push({ batch: structuredClone(batch), resolve, reject });
  }), next => { status = next; }, 'test-session');
  return { queue, requests, status: () => status };
}

test('dirty editing sends nothing until 500ms idle; unchanged entries send nothing', async () => {
  const { queue, requests, status } = setup();
  let now = 0;
  let task;
  const updates = createEditorUpdates({ debug() {}, save: () => queue.saveEntry('a') }, {
    setTimeout(callback, delay) { task = { callback, at: now + delay }; return task; },
    clearTimeout(handle) { if (task === handle) task = undefined; },
  });
  const advance = ms => { now += ms; if (task && now >= task.at) { const cb = task.callback; task = undefined; cb(); } };
  queue.saveEntry('a');
  await drain();
  assert.equal(requests.length, 0);
  queue.mark(entry('a', 'first'));
  updates.schedule();
  advance(499);
  await drain();
  assert.equal(requests.length, 0);
  queue.mark(entry('a', 'latest'));
  updates.schedule();
  advance(499);
  assert.equal(requests.length, 0);
  advance(1);
  await drain();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].batch.changes.map(c => c.entry), [entry('a', 'latest')]);
  assert.equal(requests[0].batch.order, undefined);
  requests[0].resolve();
  await drain();
  assert.deepEqual(status(), { pending: false, saving: false, error: null });
  queue.saveEntry('a');
  await drain();
  assert.equal(requests.length, 1);
  updates.dispose();
});

test('A → B → A switches queue every departure without waiting and coalesce pending A edits', async () => {
  const { queue, requests, status } = setup();
  let active = 'a';
  function switchTo(id) { queue.saveEntry(active); active = id; }
  queue.mark(entry('a', 'one'));
  switchTo('b');
  assert.equal(active, 'b');
  queue.mark(entry('b', 'two'));
  switchTo('a');
  queue.mark(entry('a', 'three'));
  switchTo('b');
  queue.mark(entry('a', 'four'));
  queue.saveEntry('a');
  await drain();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].batch.changes[0].entry.document.translation, 'one');
  requests[0].resolve();
  await drain();
  assert.equal(status().pending, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].batch.changes.map(c => c.entry), [entry('b', 'two'), entry('a', 'four')]);
  requests[1].resolve();
  await drain();
  assert.equal(status().pending, false);
});

test('old acknowledgement cannot clear a newer draft or prematurely save it', async () => {
  const { queue, requests, status } = setup();
  queue.mark(entry('a', 'saved version'));
  queue.saveEntry('a');
  await drain();
  queue.mark(entry('a', 'still editing'));
  requests[0].resolve();
  await drain();
  assert.equal(status().pending, true);
  assert.equal(requests.length, 1);
  queue.saveEntry('a');
  await drain();
  assert.equal(requests[1].batch.changes[0].entry.document.translation, 'still editing');
});

test('failed/uncertain writes retry the same request before subsequent changes', async () => {
  const { queue, requests, status } = setup();
  queue.mark(entry('a', 'old'));
  queue.saveEntry('a');
  await drain();
  requests[0].reject(new Error('quota'));
  await drain();
  assert.match(status().error, /quota/);
  queue.mark(entry('a', 'new'));
  queue.saveEntry('a');
  await drain();
  assert.deepEqual(requests[1].batch, requests[0].batch);
  requests[1].resolve();
  await drain();
  assert.equal(requests[2].batch.changes[0].entry.document.translation, 'new');
  requests[2].resolve();
  await drain();
  assert.equal(status().pending, false);
});

test('flush waits for the captured changes and order without absorbing later edits', async () => {
  const { queue, requests } = setup();
  const a = entry('a');
  queue.mark(entry('a', 'at export click'));
  queue.saveStructure([a], [entry('a', 'at export click'), entry('b')]);
  const flushed = queue.flush();
  let complete = false;
  void flushed.then(() => { complete = true; });
  await drain();
  assert.equal(complete, false);
  assert.equal(requests.length, 1);
  queue.mark(entry('a', 'edited while waiting'));
  requests[0].resolve();
  await flushed;
  assert.equal(complete, true);
  assert.equal(requests.length, 1);
  assert.equal(queue.journal().batches[0].changes[0].entry.document.translation, 'edited while waiting');
});

test('flush sends unsent changes immediately and rejects on ineligible or failed saves', async () => {
  const { queue, requests } = setup();
  queue.mark(entry('a', 'ready'));
  await assert.rejects(queue.flush(id => id !== 'a'), /入力中/);
  assert.equal(requests.length, 0);
  const flushed = queue.flush();
  await drain();
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('quota'));
  await assert.rejects(flushed, /quota/);
  assert.deepEqual(queue.journal().batches[0], requests[0].batch);
});

test('deletion replaces a pending write and restoration recreates only the changed entry', async () => {
  const { queue, requests } = setup();
  const a = entry('a'), b = entry('b');
  queue.mark(entry('a', 'busy'));
  queue.saveEntry('a');
  queue.mark(entry('b', 'pending'));
  queue.saveEntry('b');
  queue.saveStructure([a, b], [a]);
  await drain();
  requests[0].resolve();
  await drain();
  assert.deepEqual(requests[1].batch.changes.map(c => [c.id, c.entry]), [['b', null]]);
  assert.deepEqual(requests[1].batch.order.ids, ['a']);
  queue.saveStructure([a], [a, b]);
  requests[1].resolve();
  await drain();
  assert.deepEqual(requests[2].batch.changes.map(c => c.entry), [b]);
  assert.deepEqual(requests[2].batch.order.ids, ['a', 'b']);
});

test('structure diffs handle add/bulk add/reorder/delete and content undo/redo', () => {
  const a = entry('a'), b = entry('b'), c = entry('c');
  assert.deepEqual(changedEntries([a], [a, b, c]), { updates: [b, c], deleted: [], order: ['a', 'b', 'c'] });
  assert.deepEqual(changedEntries([a, b], [b, a]), { updates: [], deleted: [], order: ['b', 'a'] });
  assert.deepEqual(changedEntries([a, b], [b]), { updates: [], deleted: ['a'], order: ['b'] });
  assert.deepEqual(changedEntries([a, b], structuredClone([a, b])), { updates: [], deleted: [], order: undefined });
  const edited = entry('b', 'edited');
  assert.deepEqual(changedEntries([a, b], [a, edited]).updates, [edited]);
  assert.deepEqual(changedEntries([a, edited], [a, b]).updates, [b]);
});

test('departure journal includes unacknowledged, queued and unsent eligible changes', async () => {
  const { queue, requests } = setup();
  queue.mark(entry('a', 'in flight'));
  queue.saveEntry('a');
  queue.mark(entry('a', 'newer'));
  queue.mark(entry('b', 'IME unfinished'));
  queue.mark(entry('c', 'queued'));
  queue.saveEntry('c');
  await drain();
  const journal = queue.journal(id => id !== 'b');
  assert.deepEqual(journal.batches[0], requests[0].batch);
  assert.deepEqual(journal.batches[1].changes.map(c => c.entry), [entry('c', 'queued'), entry('a', 'newer')]);
  assert.ok(journal.batches[1].sequence > requests[0].batch.sequence);
  assert.deepEqual(parseRecovery(JSON.stringify(journal)), journal);
});

test('journal carries deletion/order and includes a failed request for idempotent replay', async () => {
  const { queue, requests } = setup();
  queue.mark(entry('a', 'first'));
  queue.saveEntry('a');
  await drain();
  requests[0].reject(new Error('lost reply'));
  await drain();
  queue.saveStructure([entry('a'), entry('b')], [entry('a')]);
  const journal = queue.journal();
  assert.deepEqual(journal.batches[0], requests[0].batch);
  assert.deepEqual(journal.batches[1].changes.map(c => [c.id, c.entry]), [['b', null]]);
  assert.deepEqual(journal.batches[1].order.ids, ['a']);
});

for (const count of [10, 50, 1000]) {
  test(`${count} entries: idle sends one entry and no order or full document`, async () => {
    const { queue, requests } = setup();
    const entries = Array.from({ length: count }, (_, i) => entry(String(i)));
    queue.mark({ ...entries[3], document: { ...entries[3].document, translation: 'changed' } });
    queue.saveEntry('3');
    await drain();
    assert.equal(requests[0].batch.changes.length, 1);
    assert.equal(requests[0].batch.changes[0].id, '3');
    assert.equal(requests[0].batch.order, undefined);
    assert.equal(queue.journal().batches.length, 1);
  });
}

test('queue snapshots are immutable and invalid recovery is rejected', async () => {
  const { queue, requests } = setup();
  const source = entry('a', 'before');
  queue.mark(source);
  source.document.translation = 'mutated later';
  queue.saveEntry('a');
  await drain();
  assert.equal(requests[0].batch.changes[0].entry.document.translation, 'before');
  assert.throws(() => parseRecovery('{'));
  assert.throws(() => parseRecovery(JSON.stringify({ version: 2, batches: [{ sequence: -1 }] })));
  const invalid = queue.journal();
  invalid.batches[0].changes[0].entry.document.version = 999;
  assert.throws(() => parseRecovery(JSON.stringify(invalid)));
});

test('Worker transport waits for matching replies, reports failure and can restart', async () => {
  const workers = [];
  const client = createPersistenceClient(() => {
    const worker = { messages: [], postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  });
  let resolved = false;
  const first = client.send({ kind: 'read' }).then(value => { resolved = true; return value; });
  await drain();
  assert.equal(resolved, false);
  const document = { version: 8, entries: [entry('a')] };
  workers[0].onmessage({ data: { id: workers[0].messages[0].id, document } });
  assert.deepEqual(await first, document);
  const failed = client.send({ kind: 'read' });
  workers[0].onerror({ message: 'Worker crashed', preventDefault() {} });
  await assert.rejects(failed, /crashed/);
  const retried = client.send({ kind: 'read' });
  assert.equal(workers.length, 2);
  workers[1].onmessage({ data: { id: workers[1].messages[0].id, document } });
  assert.deepEqual(await retried, document);
  client.dispose();
  await assert.rejects(client.send({ kind: 'read' }), /終了/);
});

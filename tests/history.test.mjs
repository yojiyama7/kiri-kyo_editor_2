import assert from 'node:assert/strict';
import test from 'node:test';
import { EditHistory } from '../src/history.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { computeLayout } from '../src/layout.ts';

const initial = () => ({
  document: {
    arrows: [], splits: [],
    tokens: [{ id: 'token:a', text: 'a', slotId: 'a' }],
    slots: [{ id: 'a' }],
    groups: [],
    translation: '訳文',
  },
  cursor: { x: 0, y: 0 },
});

test('undo/redo restores recursive slot references, IDs, and the edit cursor', () => {
  const history = new EditHistory();
  const before = initial();
  before.document.slots.push({ id: 'child' }, { id: 'parent' });
  before.document.groups.push(
    { kind: 'basic', id: 'group:child', slotId: 'child', slots: ['a'] },
    { kind: 'composite', id: 'group:parent', slotId: 'parent', slots: ['child'] },
  );
  before.cursor.y = 1;
  const deleted = structuredClone(before);
  deleted.document = deleteGroup(deleted.document, 'group:child');
  assert.deepEqual(deleted.document.groups, []);
  deleted.cursor.y = 0;
  history.record(before, deleted);
  const restored = history.undo();
  assert.deepEqual(restored, before);
  assert.equal(computeLayout(restored.document.tokens, restored.document.groups).maxY, 1);
  assert.deepEqual(history.redo(), deleted);
});

test('multiple text edits undo and redo in order, with safe history boundaries', () => {
  const history = new EditHistory();
  const before = initial();
  const translated = structuredClone(before);
  translated.document.translation = '新しい訳文';
  const empty = structuredClone(translated);
  empty.document.tokens = [];
  empty.document.slots = [];
  assert.equal(history.undo(), undefined);
  assert.equal(history.redo(), undefined);
  history.record(before, translated);
  history.record(translated, empty);
  assert.deepEqual(history.undo(), translated);
  assert.deepEqual(history.undo(), before);
  assert.equal(history.undo(), undefined);
  assert.deepEqual(history.redo(), translated);
  assert.deepEqual(history.redo(), empty);
  assert.equal(history.redo(), undefined);
});

test('unchanged edits preserve redo, while a new edit after undo discards it', () => {
  const history = new EditHistory();
  const before = initial();
  const edited = structuredClone(before);
  edited.document.translation = '変更';
  history.record(before, edited);
  history.undo();
  history.record(before, { ...before, cursor: { x: 0, y: 1 } });
  assert.deepEqual(history.redo(), edited);
  history.undo();
  const branch = structuredClone(before);
  branch.document.translation = '別の変更';
  history.record(before, branch);
  assert.equal(history.redo(), undefined);
  assert.deepEqual(history.undo(), before);
  assert.deepEqual(history.redo(), branch);
});

test('later mutations cannot alter saved snapshots or restored history entries', () => {
  const history = new EditHistory();
  const before = initial();
  const edited = initial();
  edited.document.translation = '変更';
  history.record(before, edited);
  before.document.tokens[0].text = 'mutated';
  edited.document.translation = 'mutated';
  const restored = history.undo();
  assert.equal(restored.document.tokens[0].text, 'a');
  restored.document.tokens[0].text = 'mutated again';
  assert.equal(history.redo().document.translation, '変更');
  assert.equal(history.undo().document.tokens[0].text, 'a');
});

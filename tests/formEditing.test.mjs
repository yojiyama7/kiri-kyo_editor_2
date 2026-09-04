import assert from 'node:assert/strict';
import test from 'node:test';
import { FORM_LABELS, isSavedState } from '../src/model.ts';
import { formIdForInput, formTargetAtSlot, setFormAtSlot, formTargets, ownerForm, setTokenForm, nextFormBuffer, nextFormInput, formDisplay } from '../src/formEditing.ts';
import { DEFAULT_FORM_INPUT_BINDINGS } from '../src/inputConfig.ts';
import { splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { insertBracket } from '../src/bracketEditing.ts';
import { editPseudoToken, replaceEnglishSentence } from '../src/pseudoEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';
import { writeChangedDocument } from '../src/documentPersistence.ts';
import { entryShortcut } from '../src/entryShortcuts.ts';
import { enterBasicGroup, settleBasicGroups } from '../src/groupEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';

const initial = () => ({
  version: 6, translation: '', groups: [], splits: [], arrows: [],
  tokens: [{ id: 'real', slotId: 'r', text: 'go' }, { id: 'pseudo', slotId: 'p', text: 'be', kind: 'pseudo' }],
  slots: [{ id: 'r' }, { id: 'p' }],
});

test('form codes display exact labels; prefixes, restart and backspace need no clock', () => {
  const token = initial().tokens[0];
  for (const { sequence, value } of DEFAULT_FORM_INPUT_BINDINGS) {
    const buffer = [...sequence].reduce((current, key) => nextFormBuffer(current, { key }), '');
    assert.equal(buffer, sequence);
    const label = FORM_LABELS[value];
    assert.equal(formDisplay(token, { slotId: token.slotId, buffer }), label);
    assert.equal(formDisplay({ ...token, form: value }, null), label);
  }
  assert.equal(nextFormBuffer('p', { key: 'p' }), 'pp');
  assert.equal(nextFormBuffer('pp', { key: 'p' }), 'p');
  assert.equal(nextFormBuffer('pp', { key: 'c' }), 'c');
  assert.equal(nextFormBuffer('p', { key: 'i' }), 'i');
  assert.equal(nextFormBuffer('i', { key: 'n' }), 'in');
  assert.equal(nextFormBuffer('in', { key: 'g' }), 'ing');
  assert.equal(nextFormBuffer('in', { key: 'b' }), 'b');
  for (const key of ['q', 'ArrowLeft', 'Tab', 'P']) assert.equal(nextFormBuffer('in', { key }), 'in');
  assert.equal(nextFormBuffer('ing', { key: 'Backspace' }), 'in');
  assert.equal(nextFormBuffer('pp', { key: 'Backspace' }), 'p');
  assert.equal(nextFormBuffer('', { key: 'Backspace' }), '');
  for (const buffer of ['i', 'in']) assert.equal(formDisplay(token, { slotId: token.slotId, buffer }), buffer);
  assert.equal(formDisplay({ ...token, form: 'form.present' }, { slotId: token.slotId, buffer: '' }), '現在形');
  assert.equal(formDisplay({ ...token, form: 'form.base' }, { slotId: 'other', buffer: 'pp' }), '原形');
});

test('custom input sequences resolve to the same key-independent form ID', () => {
  const bindings = [{ sequence: 'z', value: 'form.pastParticiple' }];
  assert.deepEqual(nextFormInput('', { key: 'z' }, bindings), { buffer: 'z', form: 'form.pastParticiple' });
  assert.equal(formIdForInput('z', bindings), 'form.pastParticiple');
  assert.equal(formIdForInput('pp'), 'form.pastParticiple');
});

test('form targets share T owners, separate D halves and include basic groups', () => {
  for (const kind of ['t', 'd']) {
    for (const source of ['r', 'p', 'g']) {
      const base = initial();
      base.groups = [{ id: 'group', slotId: 'g', kind: 'basic', slots: ['r', 'p'] }];
      base.slots.push({ id: 'g' });
      assert.equal(formTargetAtSlot(base, 'g').slotId, 'g');
      const d = splitSlot(base, source, kind);
      const split = d.splits[0];
      for (const id of [split.leftSlotId, split.rightSlotId]) {
        assert.equal(formTargetAtSlot(d, id)?.slotId, kind === 'd' ? id : source);
        assert.equal(formTargetAtSlot(d, id)?.ownerSlotId, source);
      }
      assert.equal(formTargets(d).filter(target => target.ownerSlotId === source).length, kind === 'd' ? 2 : 1);
    }
  }
  const d = initial();
  d.groups = [{ id: 'group', slotId: 'g', kind: 'composite', slots: ['r', 'p'] }];
  d.slots.push({ id: 'g' });
  assert.equal(formTargetAtSlot(d, 'g'), undefined);
  const divided = splitSlot(d, 'g', 'd');
  assert.equal(formTargetAtSlot(divided, divided.splits[0].rightSlotId).slotId, divided.splits[0].rightSlotId);
  for (const text of ['[', ']', '(', ')']) {
    const brackets = insertBracket(initial(), 0, text).document;
    const token = brackets.tokens[0];
    for (const slotId of [token.slotId, 'missing', undefined]) assert.equal(formTargetAtSlot(brackets, slotId), undefined);
    assert.equal(setTokenForm(brackets, token.id, 'form.base'), brackets);
    assert.equal(formDisplay(token, null), '');
  }
});

test('form edits are immutable and idempotent, clear only form and round-trip through v5/v6 persistence', () => {
  const original = initial();
  const before = structuredClone(original);
  for (const tokenId of ['real', 'pseudo']) {
    for (const form of Object.keys(FORM_LABELS)) {
      const next = setTokenForm(original, tokenId, form);
      assert.deepEqual(original, before);
      assert.equal(next.tokens.find(t => t.id === tokenId).form, form);
      assert.equal(isSavedState(next), true);
      assert.equal(setTokenForm(next, tokenId, form), next);
      const written = [];
      const result = writeChangedDocument({ version: 7, entries: [{ id: 'entry', document: next }] }, undefined, raw => written.push(raw));
      assert.equal(result.status, 'saved');
      assert.deepEqual(readEntryDocument(JSON.parse(written[0])).entries[0].document, next);
      assert.deepEqual(readEntryDocument(next).entries[0].document, next);
      assert.deepEqual(setTokenForm(next, tokenId), original);
      assert.equal(Object.hasOwn(setTokenForm(next, tokenId).tokens.find(t => t.id === tokenId), 'form'), false);
    }
  }
  assert.equal(isSavedState(original), true);
  assert.equal(setTokenForm(original, 'real'), original);
  assert.equal(setTokenForm(original, 'missing', 'form.base'), original);
});

test('saved forms reject invalid values and annotated brackets; sentence regeneration resets forms', () => {
  for (const form of ['', 'past', null, 1, {}, 'constructor', 'toString']) {
    const d = initial();
    d.tokens[0].form = form;
    assert.equal(isSavedState(d), false);
    assert.equal(readEntryDocument(d), undefined);
  }
  for (const bracket of ['[', ']', '(', ')']) {
    const d = insertBracket(initial(), 0, bracket).document;
    d.tokens[0].form = 'form.base';
    assert.equal(isSavedState(d), false);
  }
  const d = setTokenForm(setTokenForm(initial(), 'real', 'form.past'), 'pseudo', 'form.base');
  assert.equal(replaceEnglishSentence(d, 'go'), d);
  assert.ok(replaceEnglishSentence(d, 'went').tokens.every(t => t.form === undefined));
  assert.equal(editPseudoToken(d, 'pseudo', 'was').tokens[1].form, 'form.base');
});

test('FORM allows entry navigation and blocks reorder shortcuts', () => {
  assert.equal(entryShortcut({ key: 'n', ctrlKey: true }, 'FORM'), 'entry.next');
  assert.equal(entryShortcut({ key: 'p', ctrlKey: true }, 'FORM'), 'entry.previous');
  for (const [key, code, modifier] of [['j', 'KeyJ', 'altKey'], ['k', 'KeyK', 'altKey'], ['∆', 'KeyJ', 'altKey'], ['˚', 'KeyK', 'altKey']]) {
    assert.equal(entryShortcut({ key, code, [modifier]: true }, 'FORM'), undefined);
  }
});

test('D moves the existing form left, edits and clears halves independently, and unsplit keeps left', () => {
  for (const source of ['r', 'p', 'g']) {
    const base = initial();
    base.groups = [{ id: 'group', slotId: 'g', kind: 'basic', slots: ['r', 'p'] }];
    base.slots.push({ id: 'g' });
    const original = setFormAtSlot(base, source, 'form.base');
    const before = structuredClone(original);
    const divided = splitSlot(original, source, 'd');
    assert.deepEqual(original, before);
    const { leftSlotId: left, rightSlotId: right } = divided.splits[0];
    assert.equal(ownerForm(divided, source), undefined);
    assert.equal(formTargetAtSlot(divided, left).form, 'form.base');
    assert.equal(formTargetAtSlot(divided, right).form, undefined);
    const both = setFormAtSlot(setFormAtSlot(divided, right, 'form.ing'), left, 'form.pastParticiple');
    assert.equal(formTargetAtSlot(both, left).form, 'form.pastParticiple');
    assert.equal(formTargetAtSlot(both, right).form, 'form.ing');
    assert.equal(setFormAtSlot(both, left, 'form.pastParticiple'), both);
    assert.equal(ownerForm(unsplitSlot(both, right), source), 'form.pastParticiple');
    const cleared = setFormAtSlot(both, left);
    assert.equal(formTargetAtSlot(cleared, left).form, undefined);
    assert.equal(formTargetAtSlot(cleared, right).form, 'form.ing');
    assert.equal(ownerForm(unsplitSlot(cleared, left), source), undefined);
    assert.equal(isSavedState(both), true);
    assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(both))).entries[0].document, both);
  }
});

test('T has one form for either side and preserves it through split/unsplit and saving', () => {
  for (const source of ['r', 'g']) {
    const base = initial();
    base.groups = [{ id: 'group', slotId: 'g', kind: 'basic', slots: ['r', 'p'] }];
    base.slots.push({ id: 'g' });
    const split = splitSlot(setFormAtSlot(base, source, 'form.base'), source, 't');
    const { leftSlotId: left, rightSlotId: right } = split.splits[0];
    const next = setFormAtSlot(split, right, 'form.past');
    assert.equal(formTargetAtSlot(next, left).form, 'form.past');
    assert.equal(formTargetAtSlot(next, right).form, 'form.past');
    assert.equal(ownerForm(unsplitSlot(next, right), source), 'form.past');
    assert.deepEqual(readEntryDocument(JSON.parse(JSON.stringify(next))).entries[0].document, next);
    assert.equal(setFormAtSlot(next, left).tokens.find(token => token.slotId === source)?.form, undefined);
    assert.equal(ownerForm(setFormAtSlot(next, left), source), undefined);
  }
});

test('legacy D forms migrate left once and new saved form fields are validated', () => {
  const legacy = splitSlot(initial(), 'r', 'd');
  legacy.tokens[0].form = 'form.past';
  const loaded = readEntryDocument(legacy).entries[0].document;
  assert.equal(loaded.tokens[0].form, undefined);
  assert.equal(loaded.splits[0].leftForm, 'form.past');
  assert.deepEqual(readEntryDocument(loaded).entries[0].document, loaded);
  for (const invalid of [null, '', 'past', 3, 'constructor']) {
    const d = structuredClone(loaded);
    d.splits[0].rightForm = invalid;
    assert.equal(isSavedState(d), false);
    const grouped = initial();
    grouped.groups = [{ id: 'g', slotId: 'g', kind: 'basic', slots: ['r', 'p'], form: invalid }];
    grouped.slots.push({ id: 'g' });
    assert.equal(isSavedState(grouped), false);
  }
  const invalidT = splitSlot(initial(), 'r', 't');
  invalidT.splits[0].leftForm = 'form.base';
  assert.equal(isSavedState(invalidT), false);
});

test('group forms survive internal editing and reload; deleting the group restores access to token forms', () => {
  let d = initial();
  d.tokens[0].form = 'form.past';
  d.groups = [{ id: 'group', slotId: 'g', kind: 'basic', slots: ['r', 'p'], form: 'form.pastParticiple' }];
  d.slots.push({ id: 'g' });
  const opened = enterBasicGroup(d, { x: 0, y: 0 });
  assert.equal(opened.document.groups[0].kind, 'composite');
  assert.equal(opened.document.groups[0].form, 'form.pastParticiple');
  assert.equal(formTargetAtSlot(opened.document, 'g'), undefined);
  const closed = settleBasicGroups(opened.document, { x: 1, y: 1 }, null, true).document;
  assert.equal(closed.groups[0].form, 'form.pastParticiple');
  assert.equal(closed.groups[0].kind, 'basic');
  assert.equal(readEntryDocument(opened.document).entries[0].document.groups[0].form, 'form.pastParticiple');
  const deleted = deleteGroup(closed, 'group');
  assert.equal(deleted.groups.length, 0);
  assert.equal(deleted.tokens[0].form, 'form.past');
});

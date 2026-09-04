import assert from 'node:assert/strict';
import test from 'node:test';
import { computeLayout, slotPosition } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { renderForms, visibleFormTargets } from '../src/formRender.ts';
import { setFormAtSlot } from '../src/formEditing.ts';
import { splitSlot } from '../src/tEditing.ts';
import { EditHistory } from '../src/history.ts';

const base = () => ({
  version: 6, tokens: ['a', 'b', 'c'].map(text => ({ id: `t:${text}`, slotId: text, text })),
  slots: ['a', 'b', 'c'].map(id => ({ id })), groups: [], splits: [], arrows: [], translation: '',
});
const grouped = () => {
  const d = base();
  d.groups = [{ id: 'g', slotId: 'g', slots: ['a', 'b', 'c'], kind: 'basic' }];
  d.slots.push({ id: 'g' });
  return d;
};
function render(d, available = 500, session = null, widths = new Map(), splitMinimumWidths = new Map()) {
  const layout = computeLayout(d.tokens, d.groups, d.splits, d.arrows);
  const geometry = computeRenderLayout(d.tokens, d.groups, d.splits, [60, 60, 60], available, widths,
    session && !d.splits.some(s => s.slotId === session.slotId) ? { slotId: session.slotId, x: session.before.cursor.x } : undefined,
    { splitMinimumWidths });
  return { layout, geometry, forms: renderForms(d, layout, geometry.regionsBySlot, session) };
}

test('D labels and pending highlight align with separate halves; T labels span the entire token', () => {
  for (const kind of ['t', 'd']) {
    let d = splitSlot(base(), 'b', kind);
    const { leftSlotId: left, rightSlotId: right } = d.splits[0];
    d = setFormAtSlot(d, left, 'form.past');
    d = setFormAtSlot(d, right, 'form.ing');
    const { forms, geometry, layout } = render(d);
    assert.equal(forms.length, kind === 'd' ? 2 : 1);
    if (kind === 'd') {
      const l = forms.find(f => f.slotId === left), r = forms.find(f => f.slotId === right);
      assert.equal(l.text, '過去形');
      assert.equal(r.text, 'ing');
      assert.equal(l.right, r.left);
      assert.equal(l.right - l.left, r.right - r.left);
      assert.equal(l.lane, r.lane);
    } else {
      assert.equal(forms[0].slotId, 'b');
      assert.equal(forms[0].text, 'ing');
      assert.equal(forms[0].left, geometry.regionsBySlot.get('b')[0].left);
      assert.equal(forms[0].right, geometry.regionsBySlot.get('b')[0].right);
    }
    const session = { slotId: kind === 'd' ? right : 'b', buffer: 'b', before: { document: d, cursor: slotPosition(layout, right) } };
    const editing = render(d, 500, session).forms;
    assert.equal(editing.filter(f => f.pending).length, 1);
    assert.equal(editing.find(f => f.pending).slotId, session.slotId);
  }
});

test('D form regions use independently measured minimum widths', () => {
  let d = splitSlot(base(), 'b', 'd');
  const { leftSlotId: left, rightSlotId: right } = d.splits[0];
  d = setFormAtSlot(setFormAtSlot(d, left, 'form.pastParticiple'), right, 'form.ing');
  const { forms, geometry } = render(d, 500, null, new Map(), new Map([[left, 54], [right, 24]]));
  const leftForm = forms.find(form => form.slotId === left);
  const rightForm = forms.find(form => form.slotId === right);
  assert.equal(leftForm.right - leftForm.left, 54);
  assert.equal(rightForm.right - rightForm.left, 30);
  assert.equal(leftForm.right, rightForm.left);
  assert.equal(geometry.columns[1].right - geometry.columns[1].left, 60);
});

test('basic underline and T retain word forms and raise their single form, even when the words are on earlier rows', () => {
  for (const kind of [null, 't']) {
    let d = grouped();
    d.tokens[0].form = 'form.base';
    d.tokens[1].form = 'form.past';
    d = setFormAtSlot(d, 'g', 'form.pastParticiple');
    if (kind) d = splitSlot(d, 'g', kind);
    for (const available of [500, 135, 60]) {
      const { forms, geometry, layout } = render(d, available);
      assert.deepEqual(visibleFormTargets(d, layout).map(t => t.slotId), ['a', 'b', 'c', 'g']);
      assert.equal(forms.length, 3);
      assert.equal(forms.find(f => f.slotId === 'a').text, '原形');
      assert.equal(forms.find(f => f.slotId === 'b').text, '過去形');
      assert.ok(forms.filter(f => f.slotId !== 'g').every(f => f.lane === 0));
      const group = forms.find(f => f.slotId === 'g');
      assert.equal(group.text, 'p.p.');
      assert.equal(group.lane, 1);
      assert.equal(group.left, geometry.regionsBySlot.get('g').at(-1).left);
      assert.equal(group.right, geometry.regionsBySlot.get('g').at(-1).right);
      assert.equal(group.row, geometry.regionsBySlot.get('g').at(-1).row);
    }
  }
});

test('word-only and underline-only forms need one row; no forms reserve no height', () => {
  for (const kind of [null, 't', 'd']) {
    let d = grouped();
    if (kind) d = splitSlot(d, 'g', kind);
    assert.equal(render(d).forms.length, 0);
    const wordOnly = setFormAtSlot(d, 'b', 'form.past');
    assert.deepEqual(render(wordOnly).forms.map(f => [f.slotId, f.lane]), [['b', 0]]);
    const groupSlot = kind === 'd' ? d.splits[0].leftSlotId : 'g';
    const groupOnly = setFormAtSlot(d, groupSlot, 'form.pastParticiple');
    assert.deepEqual(render(groupOnly).forms.map(f => [f.slotId, f.lane]), [[groupSlot, 0]]);
  }
});

test('one-word group form is above its word even with equal widths or a narrower D half', () => {
  for (const kind of [null, 't', 'd']) {
    let d = grouped();
    d.groups[0].slots = ['a'];
    d.tokens[0].form = 'form.past';
    d.groups[0].form = 'form.base';
    if (kind) d = splitSlot(d, 'g', kind);
    if (kind === 'd') d = setFormAtSlot(d, d.splits[0].rightSlotId, 'form.ing');
    const { forms } = render(d);
    const word = forms.find(f => f.slotId === 'a');
    const groups = forms.filter(f => f.slotId !== 'a');
    assert.equal(word.lane, 0);
    assert.equal(groups.length, kind === 'd' ? 2 : 1);
    assert.ok(groups.every(f => f.lane === 1));
    if (kind !== 'd') {
      assert.equal(groups[0].left, word.left);
      assert.equal(groups[0].right, word.right);
    }
  }
});

test('D underline halves both rise if any included word has form, including on a previous row', () => {
  let d = grouped();
  d.tokens[0].form = 'form.past';
  d = splitSlot(d, 'g', 'd');
  const { leftSlotId: left, rightSlotId: right } = d.splits[0];
  d = setFormAtSlot(setFormAtSlot(d, left, 'form.base'), right, 'form.ing');
  for (const available of [500, 60]) {
    const { forms } = render(d, available);
    assert.equal(forms.find(f => f.slotId === left).lane, 1);
    assert.equal(forms.find(f => f.slotId === right).lane, 1);
    assert.equal(forms.find(f => f.slotId === 'a').lane, 0);
  }
});

test('pseudo tokens and covered D word halves retain their own forms and elevate the owning underline', () => {
  let d = base();
  d.tokens[1].kind = 'pseudo';
  d = setFormAtSlot(d, 'b', 'form.pastParticiple');
  d = splitSlot(d, 'a', 'd');
  const { leftSlotId: left, rightSlotId: right } = d.splits[0];
  d = setFormAtSlot(setFormAtSlot(d, left, 'form.base'), right, 'form.past');
  d.groups = [{ id: 'g', slotId: 'g', slots: [left, right, 'b'], kind: 'basic', form: 'form.ing' }];
  d.slots.push({ id: 'g' });
  const { forms } = render(d);
  assert.deepEqual(new Set(forms.map(f => f.slotId)), new Set([left, right, 'b', 'g']));
  assert.equal(forms.find(f => f.slotId === 'b').text, 'p.p.');
  assert.ok(forms.filter(f => f.slotId !== 'g').every(f => f.lane === 0));
  assert.equal(forms.find(f => f.slotId === 'g').lane, 1);
});

test('sparse gaps and an unowned D half do not count as internal words', () => {
  const d = grouped();
  d.groups[0].slots = ['a', 'c'];
  d.groups[0].form = 'form.base';
  d.tokens[1].form = 'form.past';
  for (const available of [500, 60]) {
    const { forms } = render(d, available);
    assert.equal(forms.find(f => f.slotId === 'g').lane, 0);
    assert.equal(forms.find(f => f.slotId === 'b').lane, 0);
  }
  let half = splitSlot(base(), 'a', 'd');
  const { leftSlotId: left, rightSlotId: right } = half.splits[0];
  half = setFormAtSlot(half, right, 'form.past');
  half.groups = [{ id: 'g', slotId: 'g', kind: 'basic', slots: [left], form: 'form.base' }];
  half.slots.push({ id: 'g' });
  assert.equal(render(half).forms.find(f => f.slotId === 'g').lane, 0);
});

test('preview, clear, undo and redo recompute form lanes without changing saved input', () => {
  const d = grouped();
  d.tokens[0].form = 'form.past';
  const before = { document: d, cursor: { x: 0, y: 0 } };
  const session = { slotId: 'g', buffer: 'pp', before };
  const preview = render(d, 500, session).forms;
  assert.equal(preview.find(f => f.slotId === 'g').lane, 1);
  assert.equal(preview.find(f => f.slotId === 'g').pending, true);
  assert.equal(d.groups[0].form, undefined);
  const committed = { ...before, document: setFormAtSlot(d, 'g', 'form.pastParticiple') };
  const history = new EditHistory();
  history.record(before, committed);
  assert.equal(render(committed.document).forms.find(f => f.slotId === 'g').lane, 1);
  const cleared = { ...before, document: setFormAtSlot(committed.document, 'a') };
  history.record(committed, cleared);
  assert.equal(render(cleared.document).forms.find(f => f.slotId === 'g').lane, 0);
  assert.equal(render(history.undo().document).forms.find(f => f.slotId === 'g').lane, 1);
  assert.equal(render(history.redo().document).forms.find(f => f.slotId === 'g').lane, 0);
  assert.ok(render(setFormAtSlot(committed.document, 'g')).forms.every(f => f.lane === 0));
});

test('D on an underline uses final-region halves across wrapping and source label width expansion', () => {
  let d = splitSlot(grouped(), 'g', 'd');
  const { leftSlotId: left, rightSlotId: right } = d.splits[0];
  d = setFormAtSlot(setFormAtSlot(d, left, 'form.base'), right, 'form.present');
  for (const available of [500, 135, 60]) {
    const { forms, geometry } = render(d, available, null, new Map([['g', 110]]));
    assert.equal(forms.length, 2);
    const owner = geometry.regionsBySlot.get('g').at(-1);
    const l = forms.find(f => f.slotId === left), r = forms.find(f => f.slotId === right);
    assert.equal(l.row, owner.row);
    assert.equal(r.row, owner.row);
    assert.equal(l.left, owner.left);
    assert.equal(l.right, (owner.left + owner.right) / 2);
    assert.equal(r.left, l.right);
    assert.equal(r.right, owner.right);
  }
});

test('sparse and wrapped basic groups preview only the active region and persist a single form', () => {
  const d = grouped();
  d.groups[0].slots = ['a', 'c'];
  d.groups[0].form = 'form.base';
  const session = { slotId: 'g', buffer: 'pp', before: { document: d, cursor: { x: 0, y: 0 } } };
  for (const available of [500, 100]) {
    const { forms, geometry } = render(d, available, session, new Map([['g', 90]]));
    assert.equal(forms.length, 1);
    assert.equal(forms[0].pending, true);
    assert.equal(forms[0].left, geometry.regionsBySlot.get('g')[0].left);
    assert.equal(forms[0].right, geometry.regionsBySlot.get('g')[0].right);
    assert.equal(d.groups[0].form, 'form.base');
  }
});

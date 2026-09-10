import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createGroup, isSavedState, hasBasicContents } from '../src/model.ts';
import { canSplit, splitSlot, unsplitSlot } from '../src/tEditing.ts';
import { deleteGroup } from '../src/structureDeletion.ts';
import { computeLayout, slotAt, slotPosition, moveLeft, moveRight, moveVertical, moveToRowEdge, selectSlotRange, toggleSlotSelection } from '../src/layout.ts';
import { computeRenderLayout } from '../src/renderLayout.ts';
import { enterBasicGroup, readSavedDocument, reclassifyGroups } from '../src/groupEditing.ts';
import { setSlotMarker } from '../src/markers.ts';
import { EditHistory } from '../src/history.ts';
import { formTargetAtSlot } from '../src/formEditing.ts';
import { readEntryDocument } from '../src/entryDocument.ts';

const initial = () => ({ arrows: [], tokens: [...'abcd'].map((text) => ({id:`token:${text}`, text, slotId:text})),
  slots: [...'abcd'].map((id) => ({id})), groups: [], splits: [], translation: '訳' });
const layoutOf = (d) => computeLayout(d.tokens, d.groups, d.splits);
const addGroup = (d, ids) => {
  const g = createGroup(d.tokens, d.slots, ids, d.splits);
  d.groups.push(g); d.slots.push({id:g.slotId}); return g;
};
const marker = (d, id) => d.slots.find((slot) => slot.id === id)?.marker;
const at = (layout, cursor) => slotAt(layout, cursor.x, cursor.y);

test('T transfers the marker only to the left, preserving source identity and existing references', () => {
  const d = initial();
  d.slots = setSlotMarker(d.slots, 'a', 'marker.subject');
  const parent = addGroup(d, ['a', 'b']);
  const next = splitSlot(d, 'a');
  const split = next.splits[0];
  assert.equal(marker(next, 'a'), undefined);
  assert.equal(marker(next, split.leftSlotId), 'marker.subject');
  assert.equal(marker(next, split.rightSlotId), undefined);
  assert.deepEqual(next.groups[0], parent);
  assert.equal(marker(d, 'a'), 'marker.subject');
  assert.equal(isSavedState(next), true);
  assert.equal(reclassifyGroups(next).groups[0].kind, 'composite');
});

test('T accepts sparse basic groups while D still requires one region, and neither accepts composite groups or children', () => {
  const d = initial();
  const basic = addGroup(d, ['a', 'b']);
  const sparse = addGroup(d, ['a', 'c']);
  const composite = addGroup(d, [basic.slotId]);
  for (const id of [basic.slotId, sparse.slotId]) assert.equal(canSplit(d, id), true);
  assert.equal(canSplit(d, sparse.slotId, 'd'), false);
  for (const id of [composite.slotId, 'missing']) {
    assert.equal(canSplit(d, id), false);
    assert.equal(splitSlot(d, id), d);
  }
  const next = splitSlot(d, basic.slotId);
  for (const id of Object.values(next.splits[0])) assert.equal(splitSlot(next, id), next);
});

test('a sparse basic T bisects only its rightmost region and positions both controls there', () => {
  const original = initial();
  const source = addGroup(original, ['a', 'c']);
  const d = splitSlot(original, source.slotId);
  const split = d.splits[0];
  const layout = layoutOf(d);
  assert.deepEqual(layout.rangesBySlot.get(split.leftSlotId), [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  assert.deepEqual(layout.rangesBySlot.get(split.rightSlotId), [{ start: 3, end: 4 }]);
  assert.deepEqual(slotPosition(layout, split.leftSlotId), { x: 2, y: 0 });
  assert.deepEqual(slotPosition(layout, split.rightSlotId), { x: 3, y: 0 });
  assert.equal(isSavedState(d), true);
  assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(d))), d);
  assert.deepEqual(unsplitSlot(d, split.rightSlotId), original);
  const history = new EditHistory();
  const before = { document: original, cursor: slotPosition(layoutOf(original), source.slotId) };
  const after = { document: d, cursor: slotPosition(layout, split.leftSlotId) };
  history.record(before, after);
  assert.deepEqual(history.undo(), before); assert.deepEqual(history.redo(), after);
  for (const available of [1000, 90]) {
    const view = computeRenderLayout(d.tokens, d.groups, d.splits, [80, 80, 80, 80], available);
    const sourceRegions = view.regionsBySlot.get(source.slotId);
    const last = sourceRegions.at(-1);
    const left = view.regionsBySlot.get(split.leftSlotId)[0];
    const right = view.regionsBySlot.get(split.rightSlotId)[0];
    assert.equal(left.row, last.row); assert.equal(right.row, last.row);
    assert.deepEqual([left.left, left.right, right.left, right.right],
      [last.left, (last.left + last.right) / 2, (last.left + last.right) / 2, last.right]);
  }
});

test('horizontal and vertical navigation and edges distinguish two halves within one token', () => {
  const d = splitSlot(initial(), 'b');
  const {leftSlotId:left, rightSlotId:right} = d.splits[0];
  const l = layoutOf(d);
  assert.deepEqual(slotPosition(l, left), {x:1,y:0});
  assert.deepEqual(slotPosition(l, right), {x:2,y:0});
  let c = {x:0,y:0};
  for (const id of [left, right, 'c']) { c = moveRight(l,c); assert.equal(at(l,c),id); }
  for (const id of [right,left,'a']) { c = moveLeft(l,c); assert.equal(at(l,c),id); }
  const group = addGroup(d,[right]);
  const marked = {...d, slots:setSlotMarker(d.slots,right,'o')};
  group.kind = 'composite';
  const l2 = layoutOf(marked);
  const p = slotPosition(l2,right);
  assert.equal(at(l2,moveVertical(l2,p,1)),group.slotId);
  assert.equal(at(l2,moveVertical(l2,moveVertical(l2,p,1),-1)),right);
  const end = splitSlot(initial(),'d');
  assert.equal(at(layoutOf(end),moveToRowEdge(layoutOf(end),{x:0,y:0},'end')),end.splits[0].rightSlotId);
});

test('range and individual selection include each half exactly once in left-to-right order', () => {
  const d = splitSlot(initial(),'b'); const l=layoutOf(d); const split=d.splits[0];
  const left=slotPosition(l,split.leftSlotId), right=slotPosition(l,split.rightSlotId);
  assert.deepEqual(selectSlotRange(l,left,right),[split.leftSlotId,split.rightSlotId]);
  assert.deepEqual(selectSlotRange(l,{x:0,y:0},{x:3,y:0}),['a',split.leftSlotId,split.rightSlotId,'c']);
  let selected=toggleSlotSelection(l,[],right);
  selected=toggleSlotSelection(l,selected,left);
  assert.deepEqual(selected,[split.leftSlotId,split.rightSlotId]);
  assert.deepEqual(toggleSlotSelection(l,selected,left),[split.rightSlotId]);
});

test('empty T halves create composite groups below their independently selectable halves', () => {
  const d=splitSlot(initial(),'b'); const split=d.splits[0];
  const left=addGroup(d,[split.leftSlotId]); const right=addGroup(d,[split.rightSlotId]);
  assert.equal(left.kind,'composite'); assert.equal(right.kind,'composite');
  const l=layoutOf(d);
  assert.equal(l.slotY.get(left.slotId),1); assert.equal(l.slotY.get(right.slotId),1);
  assert.equal(slotAt(l,1,0),split.leftSlotId); assert.equal(slotAt(l,2,0),split.rightSlotId);
  assert.equal(slotAt(l,1,1),left.slotId); assert.equal(slotAt(l,2,1),right.slotId);
  assert.equal(at(l,enterBasicGroup(d,slotPosition(l,right.slotId)).cursor),split.rightSlotId);
  assert.equal(canSplit(d,left.slotId),false);
  assert.equal(formTargetAtSlot(d,left.slotId),undefined);
  assert.equal(addGroup(d,[left.slotId]).kind,'composite');
  assert.equal(hasBasicContents(d.tokens,setSlotMarker(d.slots,split.rightSlotId,'marker.subject'),[split.rightSlotId],d.splits),false);
});

test('T contents stay composite through marker clearing, exit and reload; legacy basic saves are rejected', () => {
  for (const kind of [undefined, 't']) {
    for (const groupOwner of [false, true]) {
      let base = initial();
      base.tokens[3].kind = 'pseudo';
      const owner = groupOwner ? addGroup(base, ['a', 'b']).slotId : 'b';
      base = splitSlot(base, owner);
      if (kind) base.splits[0].kind = kind;
      base = splitSlot(base, 'c', 'd');
      const { leftSlotId: left, rightSlotId: right } = base.splits[0];
      const { leftSlotId: dLeft, rightSlotId: dRight } = base.splits[1];
      for (const contents of [[left], [right], [left, right], [left, 'a'], [left, 'd'], [right, dLeft], [left, right, dRight, 'd']]) {
        for (const marker of [undefined, 'marker.subject']) {
          const document = structuredClone(base);
          document.slots = setSlotMarker(document.slots, contents[0], marker);
          const group = addGroup(document, contents);
          assert.equal(group.kind, 'composite');
          assert.equal(isSavedState(document), true);
          document.slots = setSlotMarker(document.slots, contents[0]);
          const inside = slotPosition(layoutOf(document), contents[0]);
          const outside = slotPosition(layoutOf(document), group.slotId);
          for (const cursor of [inside, outside]) {
            assert.equal(reclassifyGroups(document).groups.at(-1).kind, 'composite');
          }
          assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(document))), document);
          const entry = { version: 8, entries: [{ id: 'entry', document }] };
          assert.deepEqual(readEntryDocument(entry), entry);
          const invalid = structuredClone(document);
          invalid.groups.at(-1).kind = 'basic';
          assert.equal(isSavedState(invalid), false);
          assert.equal(readSavedDocument(invalid), undefined);
          assert.equal(readEntryDocument({ version: 8, entries: [{ id: 'entry', document: invalid }] }), undefined);
        }
      }
      // T elsewhere in the document must not disqualify empty D halves or words.
      for (const contents of [[dLeft], [dRight], [dLeft, dRight], [dLeft, 'd'], ['d']]) {
        const document = structuredClone(base);
        assert.equal(addGroup(document, contents).kind, 'basic');
        assert.equal(isSavedState(document), true);
        assert.deepEqual(readSavedDocument(document), document);
      }
    }
  }
});

test('a split basic group keeps its Y and blocks internal editing on both halves', () => {
  const d=initial(); const source=addGroup(d,['a','b','c']);
  const next=splitSlot(d,source.slotId); const l=layoutOf(next);
  for (const id of [next.splits[0].leftSlotId,next.splits[0].rightSlotId]) {
    const cursor=slotPosition(l,id); const entered=enterBasicGroup(next,cursor);
    assert.equal(entered.openedGroupIds.size, 0); assert.deepEqual(entered.cursor,cursor);
  }
  assert.equal(at(l,moveRight(l,slotPosition(l,next.splits[0].leftSlotId))),next.splits[0].rightSlotId);
  assert.equal(at(l,moveRight(l,slotPosition(l,next.splits[0].rightSlotId))),'d');
});

test('unsplitting T discards right marker and recursively deletes dependent groups and their D children', () => {
  let d=initial(); const source=addGroup(d,['a','b']); const untouched=addGroup(d,[source.slotId,'d']);
  d=splitSlot(d,source.slotId); const split=d.splits[0];
  const dependent=addGroup(d,[split.leftSlotId]);
  d=splitSlot(d,dependent.slotId,'d'); const nested=d.splits[1];
  addGroup(d,[nested.rightSlotId,'c']);
  const both=addGroup(d,[split.leftSlotId,split.rightSlotId]); addGroup(d,[both.slotId]);
  d.slots=setSlotMarker(setSlotMarker(d.slots,split.leftSlotId,'marker.object1'),split.rightSlotId,'marker.object2');
  assert.equal(isSavedState(d),true);
  const result=unsplitSlot(d,split.rightSlotId);
  assert.deepEqual(result.groups.map((g)=>g.id),[source.id,untouched.id]);
  assert.equal(result.splits.length,0);
  assert.equal(marker(result,source.slotId),'marker.object1');
  assert.equal(isSavedState(result),true);
  assert.equal(unsplitSlot(result,'missing'),result);
});

test('deleting a T owner removes consumers of both its source and its children', () => {
  let d=initial();const source=addGroup(d,['a','b']);addGroup(d,[source.slotId,'c']);
  d=splitSlot(d,source.slotId);addGroup(d,[d.splits[0].rightSlotId]);
  const next=deleteGroup(d,source.id);
  assert.equal(next.splits.length,0);assert.equal(next.groups.length,0);
  assert.deepEqual(next.tokens,d.tokens);
  assert.deepEqual(next.slots,initial().slots);
  assert.equal(isSavedState(next),true);
});

test('creation and cascade removal each round-trip as a single history step including half cursor', () => {
  const history=new EditHistory();const d=initial();const before={document:d,cursor:{x:1,y:0}};
  const created=splitSlot(d,'b');const split=created.splits[0];
  const after={document:created,cursor:slotPosition(layoutOf(created),split.leftSlotId)};
  history.record(before,after);assert.deepEqual(history.undo(),before);assert.deepEqual(history.redo(),after);
  addGroup(created,[split.rightSlotId]);const ready={document:created,cursor:slotPosition(layoutOf(created),split.leftSlotId)};
  const removed={document:unsplitSlot(created,split.leftSlotId),cursor:{x:1,y:0}};
  history.record(ready,removed);assert.deepEqual(history.undo(),ready);assert.deepEqual(history.redo(),removed);
});

test('current saves round-trip T data; all versioned inner formats and malformed T references are rejected', () => {
  let d=initial();const source=addGroup(d,['a','b']);d=splitSlot(d,source.slotId);
  assert.deepEqual(readSavedDocument(JSON.parse(JSON.stringify(d))),d);
  for (const version of [1,2,3,4,5,undefined]) assert.equal(readSavedDocument({...d,version}),undefined);
  assert.equal(readSavedDocument(JSON.parse(readFileSync(new URL('./fixtures/empty-composite.v3.json',import.meta.url),'utf8'))),undefined);
  for (const mutate of [
    (v)=>{delete v.splits;},
    (v)=>{v.splits[0].leftSlotId='missing';},
    (v)=>{v.splits[0].rightSlotId=v.splits[0].leftSlotId;},
    (v)=>{v.splits.push({...v.splits[0]});},
    (v)=>{v.splits[0].slotId=v.splits[0].leftSlotId;},
    (v)=>{v.groups[0].slots=[v.splits[0].leftSlotId];},
    (v)=>{v.groups[0].kind='composite';},
    (v)=>{v.slots.find((s)=>s.id===v.splits[0].slotId).marker='marker.subject';},
  ]) {const invalid=structuredClone(d);mutate(invalid);assert.equal(isSavedState(invalid),false);}
});

test('wrapped T halves use only the final region, and child underlines follow the same half on resize', () => {
  let d=initial();const source=addGroup(d,['a','b','c']);d=splitSlot(d,source.slotId);
  const split=d.splits[0];const child=addGroup(d,[split.rightSlotId]);const parent=addGroup(d,[source.slotId]);
  for (const available of [1000,200,90]) {
    const view=computeRenderLayout(d.tokens,d.groups,d.splits,[100,80,60,40],available);
    const regions=view.regionsBySlot.get(source.slotId);const last=regions.at(-1);
    const left=view.regionsBySlot.get(split.leftSlotId);const right=view.regionsBySlot.get(split.rightSlotId);
    assert.equal(left.length,1);assert.equal(right.length,1);
    assert.equal(left[0].row,last.row);assert.equal(right[0].row,last.row);
    assert.equal(left[0].left,last.left);assert.equal(right[0].right,last.right);
    assert.equal(left[0].right,(last.left+last.right)/2);assert.equal(right[0].left,left[0].right);
    assert.deepEqual(view.regionsBySlot.get(child.slotId),right);
    assert.deepEqual(view.regionsBySlot.get(parent.slotId).map(({row,left,right})=>({row,left,right})),regions.map(({row,left,right})=>({row,left,right})));
  }
});

test('render geometry preserves gaps and never fills an unselected T half', () => {
  let d=splitSlot(initial(),'b');const split=d.splits[0];
  const group=addGroup(d,['a',split.rightSlotId,'d']);
  const view=computeRenderLayout(d.tokens,d.groups,d.splits,[80,80,80,80],1000);
  const regions=view.regionsBySlot.get(group.slotId);
  assert.deepEqual(regions.map(({left,right})=>[left,right]),[[0,80],[130,170],[270,350]]);
  assert.equal(regions[0].endConnection,regions[1].startConnection);
  assert.equal(regions[1].endConnection,regions[2].startConnection);
});

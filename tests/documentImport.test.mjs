import assert from 'node:assert/strict';
import test from 'node:test';
import { entryDocumentsEqual, parseImportedDocument, readImportedDocument } from '../src/documentImport.ts';

const entry = (id, text = '') => ({ id, document: {
  tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: text,
} });

test('export-format version 8 JSON imports every entry in order with Unicode intact', async () => {
  const document = { version: 8, entries: [entry('b', '日本語'), entry('a', '訳文')] };
  assert.deepEqual(parseImportedDocument(JSON.stringify(document)), document);
  assert.deepEqual(await readImportedDocument({ text: async () => JSON.stringify(document) }), document);
});

test('import rejects malformed JSON, other roots and invalid version 8 documents', () => {
  for (const [text, message] of [
    ['{', /JSONとして/],
    [JSON.stringify({ display: {}, saved: {} }), /version 8/],
    [JSON.stringify({ version: 7, entries: [entry('a')] }), /version 8/],
    [JSON.stringify(entry('a')), /version 8/],
    [JSON.stringify({ version: 8, entries: [] }), /内容が不正/],
    [JSON.stringify({ version: 8, entries: [entry('a'), entry('a')] }), /内容が不正/],
    [JSON.stringify({ version: 8, entries: [{ ...entry('a'), document: { ...entry('a').document, translation: 1 } }] }), /内容が不正/],
  ]) assert.throws(() => parseImportedDocument(text), message);
});

test('file read failures receive an import-specific error', async () => {
  await assert.rejects(readImportedDocument({ text: async () => { throw new Error('denied'); } }), /ファイルを読み取れませんでした.*denied/);
});

test('document equality ignores JSON object property order but preserves entry order', () => {
  const left = { version: 8, entries: [entry('a', 'one'), entry('b', 'two')] };
  const right = { entries: [
    { document: { translation: 'one', arrows: [], splits: [], groups: [], slots: [], tokens: [] }, id: 'a' },
    { document: { translation: 'two', arrows: [], splits: [], groups: [], slots: [], tokens: [] }, id: 'b' },
  ], version: 8 };
  assert.equal(entryDocumentsEqual(left, right), true);
  assert.equal(entryDocumentsEqual(left, { version: 8, entries: [...left.entries].reverse() }), false);
});

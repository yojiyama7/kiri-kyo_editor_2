import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_JSON_MIME,
  documentExportFilename,
  downloadEntryDocument,
  serializeEntryDocument,
} from '../src/documentExport.ts';

const document = {
  version: 8,
  entries: [{ id: 'entry-a', document: {
    tokens: [], slots: [], groups: [], splits: [], arrows: [], translation: '日本語の訳文',
  } }],
};

test('entry documents serialize as the unwrapped, indented version 8 save format', () => {
  const json = serializeEntryDocument(document);
  assert.deepEqual(JSON.parse(json), document);
  assert.match(json, /^\{\n  "version": 8,/);
  assert.match(json, /日本語の訳文/);
  assert.equal(json.includes('display'), false);
  assert.equal(json.includes('keybindings'), false);
});

test('export filenames use local date and time', () => {
  assert.equal(
    documentExportFilename(new Date(2026, 8, 10, 7, 8, 9)),
    'kiri-kyo-editor-v8-20260910-070809.json',
  );
});

test('download uses JSON MIME and always removes its temporary resources', () => {
  const calls = [];
  const anchor = {
    href: '', download: '',
    click() { calls.push('click'); },
    remove() { calls.push('remove'); },
  };
  let blobParts;
  let blobOptions;
  const blob = {};
  downloadEntryDocument(document, new Date(2026, 8, 10, 7, 8, 9), {
    createBlob(parts, options) { blobParts = parts; blobOptions = options; return blob; },
    createObjectURL(value) { assert.equal(value, blob); calls.push('create-url'); return 'blob:test'; },
    revokeObjectURL(url) { assert.equal(url, 'blob:test'); calls.push('revoke-url'); },
    createAnchor() { calls.push('create-anchor'); return anchor; },
  });
  assert.deepEqual(blobParts, [serializeEntryDocument(document)]);
  assert.deepEqual(blobOptions, { type: DOCUMENT_JSON_MIME });
  assert.equal(anchor.href, 'blob:test');
  assert.equal(anchor.download, 'kiri-kyo-editor-v8-20260910-070809.json');
  assert.deepEqual(calls, ['create-url', 'create-anchor', 'click', 'remove', 'revoke-url']);
});

test('download revokes the URL when creating or clicking the anchor fails', () => {
  const calls = [];
  assert.throws(() => downloadEntryDocument(document, new Date(), {
    createBlob() { return {}; },
    createObjectURL() { return 'blob:test'; },
    revokeObjectURL() { calls.push('revoke'); },
    createAnchor() { throw new Error('anchor failed'); },
  }), /anchor failed/);
  assert.deepEqual(calls, ['revoke']);

  assert.throws(() => downloadEntryDocument(document, new Date(), {
    createBlob() { return {}; },
    createObjectURL() { return 'blob:test'; },
    revokeObjectURL() { calls.push('revoke after click'); },
    createAnchor() {
      return { href: '', download: '', click() { throw new Error('click failed'); }, remove() { calls.push('remove'); } };
    },
  }), /click failed/);
  assert.deepEqual(calls, ['revoke', 'remove', 'revoke after click']);
});

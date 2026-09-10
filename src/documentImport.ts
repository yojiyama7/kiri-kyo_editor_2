import { readEntryDocument, type EntryDocument } from './entryDocument.ts';

export function parseImportedDocument(text: string): EntryDocument {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('JSONとして読み取れないファイルです'); }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 8) {
    throw new Error('version 8のセーブデータではありません');
  }
  const document = readEntryDocument(value);
  if (!document) throw new Error('version 8のセーブデータの内容が不正です');
  return document;
}

export async function readImportedDocument(file: Pick<File, 'text'>): Promise<EntryDocument> {
  let text: string;
  try { text = await file.text(); }
  catch (error) { throw new Error(`ファイルを読み取れませんでした: ${String(error)}`); }
  return parseImportedDocument(text);
}

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}

export function entryDocumentsEqual(left: EntryDocument, right: EntryDocument): boolean {
  return stableJSON(left) === stableJSON(right);
}

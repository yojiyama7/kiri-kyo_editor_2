import type { EntryDocument } from './entryDocument.ts';

export const DOCUMENT_JSON_MIME = 'application/json;charset=utf-8';

export type DownloadEnvironment = {
  createBlob(parts: BlobPart[], options: BlobPropertyBag): Blob;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): Pick<HTMLAnchorElement, 'href' | 'download' | 'click' | 'remove'>;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function documentExportFilename(now = new Date()): string {
  return `kiri-kyo-editor-v8-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

export function serializeEntryDocument(document: EntryDocument): string {
  return JSON.stringify(document, null, 2);
}

function browserEnvironment(): DownloadEnvironment {
  return {
    createBlob: (parts, options) => new Blob(parts, options),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    createAnchor: () => {
      const anchor = document.createElement('a');
      document.body.append(anchor);
      return anchor;
    },
  };
}

export function downloadEntryDocument(
  document: EntryDocument,
  now = new Date(),
  environment: DownloadEnvironment = browserEnvironment(),
): void {
  const blob = environment.createBlob([serializeEntryDocument(document)], { type: DOCUMENT_JSON_MIME });
  const url = environment.createObjectURL(blob);
  try {
    const anchor = environment.createAnchor();
    try {
      anchor.href = url;
      anchor.download = documentExportFilename(now);
      anchor.click();
    } finally {
      anchor.remove();
    }
  } finally {
    environment.revokeObjectURL(url);
  }
}

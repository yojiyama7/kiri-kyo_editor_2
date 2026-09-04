type WriteResult =
  | { status: 'unchanged' }
  | { status: 'saved'; raw: string }
  | { status: 'error'; error: string };

/** Only successful writes may advance the caller's last-written snapshot. */
export function writeChangedDocument(
  document: object,
  lastWritten: string | undefined,
  write: (raw: string) => void,
): WriteResult {
  try {
    const raw = JSON.stringify(document);
    if (raw === lastWritten) return { status: 'unchanged' };
    write(raw);
    return { status: 'saved', raw };
  } catch (error) {
    return { status: 'error', error: String(error) };
  }
}

import { nearestCursor, tokenIndexAt, type Cursor, type DiagramLayout } from './layout.ts';
import type { KeyboardInput } from './keyboard.ts';
import { resolveKeyboardOperation } from './keyboardOperations.ts';

// Borders index the complete token sequence (real, pseudo, and brackets),
// never the logical atoms introduced by slot splits.
export function clampBorder(index: number, tokenCount: number): number {
  return Math.max(0, Math.min(index, tokenCount));
}

export function borderFromCursor(layout: DiagramLayout, cursor: Cursor): number {
  return tokenIndexAt(layout, cursor.x) ?? 0;
}

export function moveBorder(index: number, tokenCount: number, input: KeyboardInput): number {
  const current = clampBorder(index, tokenCount);
  const operation = resolveKeyboardOperation(input, [
    { operation: 'cursor.left', rules: [
      { key: ['h', 'ArrowLeft'], ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ] },
    { operation: 'cursor.right', rules: [
      { key: ['l', 'ArrowRight'], ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ] },
    { operation: 'cursor.rowStart', rules: [
      { key: '0', ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ] },
    { operation: 'cursor.rowEnd', rules: [
      { key: '$', ctrlKey: null, altKey: null, metaKey: null, shiftKey: null, repeat: null, isComposing: null },
    ] },
  ]);
  if (operation === 'cursor.left') return clampBorder(current - 1, tokenCount);
  if (operation === 'cursor.right') return clampBorder(current + 1, tokenCount);
  if (operation === 'cursor.rowStart') return 0;
  if (operation === 'cursor.rowEnd') return tokenCount;
  return current;
}

export function cursorFromBorder(layout: DiagramLayout, index: number): Cursor {
  const border = clampBorder(index, layout.tokenCount);
  if (!layout.tokenCount) return { x: 0, y: 0 };
  const atEnd = border === layout.tokenCount;
  const range = layout.tokenRanges[atEnd ? border - 1 : border];
  // The last integer atom is inside the token, including the right split half.
  return nearestCursor(layout, { x: atEnd ? range.end - 1 : range.start, y: 0 });
}

type TokenColumn = { row: number; left: number; right: number };
export type BorderPosition = { row: number; left: number };

export function borderPosition(columns: readonly TokenColumn[], index: number): BorderPosition {
  const border = clampBorder(index, columns.length);
  if (!columns.length) return { row: 0, left: 0 };
  const right = columns[border];
  const left = columns[border - 1];
  if (!right) return { row: left.row, left: left.right };
  if (!left || left.row !== right.row) return { row: right.row, left: right.left };
  return { row: right.row, left: (left.right + right.left) / 2 };
}

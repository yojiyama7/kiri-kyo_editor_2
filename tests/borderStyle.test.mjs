import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('border caret spans the word and y=0 slot but is bounded before the second grid track', () => {
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.border-cursor\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'shared caret style must exist for both populated and empty entries');
  assert.match(rule, /position:\s*absolute\s*;/);
  // An auto end line would allow the absolute caret to reach later tracks.
  assert.match(rule, /grid-row:\s*1\s*\/\s*2\s*;/);
  assert.match(rule, /top:\s*0\s*;/);
  assert.match(rule, /bottom:\s*0\s*;/);
  assert.doesNotMatch(rule, /(?:^|[;\n])\s*(?:height|min-height|max-height)\s*:/);
});

test('pseudo text shares annotation color and native input is wired for IME, draft binding and blur cancellation', () => {
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.token-text\.pseudo-token\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /color:\s*var\(--annotation-color\)/);
  assert.match(rule, /white-space:\s*pre-wrap/);
  assert.doesNotMatch(rule, /(?:border|background)\s*:/);
  const source = readFileSync(new URL('../src/EntryEditor.svelte', import.meta.url), 'utf8');
  const field = source.match(/\{#snippet pseudoField\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1];
  assert.ok(field);
  assert.match(field, /<input type="text"/);
  assert.match(field, /value=\{pseudoInput.text\}/);
  assert.match(field, /on:input=.*if \(pseudoInput\) pseudoInput.text = event.currentTarget.value/);
  assert.match(field, /use:focusOnMount/);
  assert.match(field, /on:compositionstart/);
  assert.match(field, /on:compositionend/);
  assert.match(field, /on:keydown\|stopPropagation=\{handlePseudoKeydown\}/);
  assert.match(field, /on:blur=\{cancelPseudoInput\}/);
});

test('one persistent input is outside row loops and measured from an intrinsic same-font mirror', () => {
  const source = readFileSync(new URL('../src/EntryEditor.svelte', import.meta.url), 'utf8');
  assert.equal([...source.matchAll(/\{@render pseudoField\(\)\}/g)].length, 1);
  assert.ok(source.indexOf('{@render pseudoField()}') < source.indexOf('{#each displayRows'));
  assert.match(source, /\{#if pseudoInput\}\s*<input/);
  assert.match(source, /data-token-id=\{token.id\}/);
  assert.match(source, /\.pseudo-input-measure/);
  assert.doesNotMatch(source, /querySelector[^\n]*['"]\.pseudo-input['"]/);
  assert.match(source, /class="pseudo-input-anchor"/);
  assert.match(source, /token.text \|\| ' '/);
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.match(css, /input\.pseudo-input, \.pseudo-input-measure\s*\{[^}]*font:/);
  assert.match(css, /\.pseudo-input-measure\s*\{[^}]*width: max-content;[^}]*white-space: pre;/);
  assert.match(css, /\.pseudo-input-anchor\s*\{[^}]*align-self: center/);
  assert.doesNotMatch(css, /input\.pseudo-input\s*\{[^}]*(?:grid-row|grid-column|max-width):/);
});

test('diagram slot controls do not receive native browser focus', () => {
  const source = readFileSync(new URL('../src/EntryEditor.svelte', import.meta.url), 'utf8');
  const controls = [
    /<button type="button" class="slot t-half"[\s\S]*?on:click/,
    /<button type="button" class="angle-selection"[\s\S]*?on:click/,
    /<button\s+type="button"\s+class="slot"[\s\S]*?on:click/,
    /<button type="button" class="line-segment"[\s\S]*?on:click/,
  ];
  for (const pattern of controls) {
    const control = source.match(pattern)?.[0];
    assert.ok(control, `missing diagram control: ${pattern}`);
    assert.match(control, /tabindex="-1"/);
    assert.match(control, /on:mousedown\|preventDefault/);
  }
});

test('sparse T highlights only the current continuation or final control region', () => {
  const source = readFileSync(new URL('../src/EntryEditor.svelte', import.meta.url), 'utf8');
  const controls = source.match(/\{#snippet splitControls[\s\S]*?\{\/snippet\}/)?.[0];
  assert.ok(controls);
  assert.match(controls, /activeRange = displayLayout\.rangesBySlot\.get\(id\)\?\.at\(-1\)/);
  assert.match(controls, /currentAtControl = currentId === id && activeRange !== undefined/);
  assert.match(controls, /activeRange\.start <= cursorX && cursorX < activeRange\.end/);
  assert.match(controls, /class:current=\{currentAtControl\}/);
  assert.match(controls, /class:current-region=\{currentAtControl\}/);
  const continuation = source.match(/\{@const continuationSlotId[\s\S]*?<button type="button" class="line-segment"[\s\S]*?on:click=\{\(\) => \{/)?.[0];
  assert.ok(continuation);
  assert.match(continuation, /split\.kind === 'd' \? undefined : split\.leftSlotId/);
  assert.match(continuation, /currentContinuation = continuationSlotId !== undefined && currentId === continuationSlotId/);
  assert.match(continuation, /segment\.logicalRanges\.some/);
  assert.match(continuation, /class:current=\{currentContinuation\}/);
  assert.match(continuation, /class:current-region=\{currentContinuation\}/);
  assert.match(continuation, /class:arrow-source=\{!split && arrowSourceId === placement\.group\.slotId\}/);
  assert.match(continuation, /class:selected=\{!split && selecting && selectedSlotIds\.has\(placement\.group\.slotId\)\}/);
});

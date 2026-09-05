import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

test('entry menu uses only a square hit area anchored to the entry top right', () => {
  const entryRule = css.match(/\.entry\s*\{([^}]+)\}/)?.[1];
  const menuRule = css.match(/\.entry-menu\s*\{([^}]+)\}/)?.[1];
  const triggerRule = css.match(/\.entry-menu-trigger\s*\{([^}]+)\}/)?.[1];

  assert.ok(entryRule);
  assert.match(entryRule, /position:\s*relative/);
  assert.doesNotMatch(entryRule, /padding-right\s*:/);

  assert.ok(menuRule);
  assert.match(menuRule, /position:\s*absolute/);
  assert.match(menuRule, /top:\s*8px/);
  assert.match(menuRule, /right:\s*8px/);
  assert.match(menuRule, /width:\s*32px/);
  assert.match(menuRule, /height:\s*32px/);

  assert.ok(triggerRule);
  assert.match(triggerRule, /width:\s*100%/);
  assert.match(triggerRule, /height:\s*100%/);
  assert.match(triggerRule, /aspect-ratio:\s*1/);
});

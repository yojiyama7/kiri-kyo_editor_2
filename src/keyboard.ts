export type KeyboardInput = Partial<Pick<KeyboardEvent,
  'key' | 'code' | 'keyCode' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'isComposing'>>;

type RuleValue<T> = T | readonly T[];
type BooleanRuleValue = boolean | null;

export type KeyboardInputRule = {
  key?: RuleValue<string>;
  code?: RuleValue<string>;
  keyCode?: RuleValue<number>;
  keyLength?: RuleValue<number>;
  ctrlKey?: BooleanRuleValue;
  altKey?: BooleanRuleValue;
  metaKey?: BooleanRuleValue;
  shiftKey?: BooleanRuleValue;
  repeat?: BooleanRuleValue;
  isComposing?: BooleanRuleValue;
};

const VALUE_FIELDS = ['key', 'code', 'keyCode', 'keyLength'] as const;
const BOOLEAN_FIELDS = ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'repeat', 'isComposing'] as const;
const RULE_FIELDS = new Set<string>([...VALUE_FIELDS, ...BOOLEAN_FIELDS]);

function isRuleValue(value: unknown, type: 'string' | 'number'): boolean {
  const valid = (item: unknown) => typeof item === type && (type !== 'number' || Number.isFinite(item));
  if (valid(value)) return true;
  return Array.isArray(value) && value.every(valid);
}

function valueMatches(actual: string | number, expected: unknown): boolean {
  return Array.isArray(expected) ? expected.includes(actual as never) : actual === expected;
}

function ruleMatches(input: KeyboardInput, rule: unknown): boolean {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const candidate = rule as Record<string, unknown>;
  if (Object.keys(candidate).some((field) => !RULE_FIELDS.has(field))) return false;

  for (const field of VALUE_FIELDS) {
    if (!Object.hasOwn(candidate, field)) continue;
    const type = field === 'key' || field === 'code' ? 'string' : 'number';
    if (!isRuleValue(candidate[field], type)) return false;
    const actual = field === 'keyLength' ? (input.key ?? '').length
      : field === 'key' || field === 'code' ? input[field] ?? '' : input[field] ?? 0;
    if (!valueMatches(actual, candidate[field])) return false;
  }

  for (const field of BOOLEAN_FIELDS) {
    const expected = Object.hasOwn(candidate, field) ? candidate[field] : false;
    if (expected === null) continue;
    if (typeof expected !== 'boolean' || (input[field] ?? false) !== expected) return false;
  }
  return true;
}

export function matchesKeyboardInput(input: KeyboardInput, rules: readonly KeyboardInputRule[]): boolean {
  if (input === null || typeof input !== 'object' || !Array.isArray(rules) || rules.length === 0) return false;
  return rules.some((rule) => ruleMatches(input, rule));
}

export const MARKER_LABELS = {
  'marker.subject': 'S',
  'marker.provisionalSubject': '仮S',
  'marker.trueSubject': '真S',
  'marker.subjectPrime': "S'",
  'marker.sentenceAdverb': '文ad',
  'marker.verb': 'V',
  'marker.number1': '(1)',
  'marker.number2': '(2)',
  'marker.number3': '(3)',
  'marker.number4': '(4)',
  'marker.number5': '(5)',
  'marker.negativeNumber3': '(-3)',
  'marker.negativeNumber4': '-(4)',
  'marker.negativeNumber5': '-(5)',
  'marker.plus': '+',
  'marker.adjective': 'a',
  'marker.auxiliary': 'aux',
  'marker.adverb': 'ad',
  'marker.adverbialObjective': '副詞的目的格',
  'marker.adjectiveComplement': 'aC',
  'marker.noun': 'n',
  'marker.introductoryAdverb': '誘導副詞',
  'marker.nounComplement': 'nC',
  'marker.preposition': '前',
  'marker.conjunction': '接',
  'marker.object': 'O',
  'marker.object1': 'O1',
  'marker.object2': 'O2',
} as const;

export type MarkerId = keyof typeof MARKER_LABELS;
const MARKER_ID_SET = new Set<string>(Object.keys(MARKER_LABELS));

export function isMarkerId(value: unknown): value is MarkerId {
  return typeof value === 'string' && MARKER_ID_SET.has(value);
}

export const FORM_LABELS = {
  'form.base': '原形',
  'form.present': '現在形',
  'form.past': '過去形',
  'form.pastParticiple': 'p.p.',
  'form.ing': 'ing',
} as const;

export type FormId = keyof typeof FORM_LABELS;
const FORM_ID_SET = new Set<string>(Object.keys(FORM_LABELS));

export function isFormId(value: unknown): value is FormId {
  return typeof value === 'string' && FORM_ID_SET.has(value);
}

import { FORM_LABELS, MARKER_LABELS, isFormId, isMarkerId } from './inputIds.ts';
import type { KeyboardOperationId } from './operationIds.ts';
import type { InputMode, OperationId } from './keybindings.ts';

export type OperationHelp = { summary: string; description: string; example: string };
type ConfigurableKeyboardOperationId = Exclude<KeyboardOperationId, 'translation.blockTab'>;

export const MODE_HELP: Record<InputMode, string> = {
  NORMAL: '通常編集', VISUAL: '範囲選択', VISUAL_MULTI: '個別選択', ARROW: '矢印の相手選択', BORDER: '境目編集', FORM: 'form入力',
  INSERT: '英文入力', TRANSLATION: '訳文入力', PSEUDO_INPUT: '疑似トークン入力', MARKER_INPUT: '自由標識入力',
  MARKER_SEQUENCE: '定型標識の連続入力', DIALOG: 'ダイアログ', MENU: '操作メニュー',
};

export const MODE_ABBREVIATIONS: Record<InputMode, string> = {
  NORMAL: 'N', VISUAL: 'V', VISUAL_MULTI: 'VM', ARROW: 'A', BORDER: 'B', FORM: 'F',
  INSERT: 'I', TRANSLATION: 'T', PSEUDO_INPUT: 'PI', MARKER_INPUT: 'MI',
  MARKER_SEQUENCE: 'MS', DIALOG: 'D', MENU: 'M',
};

export const MODE_NAMES: Record<InputMode, string> = {
  NORMAL: 'normal', VISUAL: 'visual', VISUAL_MULTI: 'visual multi', ARROW: 'arrow', BORDER: 'border', FORM: 'form',
  INSERT: 'insert', TRANSLATION: 'translation', PSEUDO_INPUT: 'pseudo input', MARKER_INPUT: 'marker input',
  MARKER_SEQUENCE: 'marker sequence', DIALOG: 'dialog', MENU: 'menu',
};

const ACTION_HELP = {
  'entry.next': { summary: '編集対象を次の英文・訳文の組へ移します。', description: '現在の編集を必要に応じて確定し、次の組を選択してその位置へ移動します。', example: '第1組を編集中に実行すると、第2組の対応する編集位置へ移ります。' },
  'entry.previous': { summary: '編集対象を前の英文・訳文の組へ移します。', description: '現在の編集を必要に応じて確定し、前の組を選択してその位置へ移動します。', example: '第2組を編集中に実行すると、第1組の対応する編集位置へ戻ります。' },
  'entry.reorderDown': { summary: '現在の組を1つ下へ移動します。', description: '選択中の英文・訳文の組を次の組と入れ替え、文書内の並び順を変更します。', example: '第2組で実行すると、第2組と第3組の順番が入れ替わります。' },
  'entry.reorderUp': { summary: '現在の組を1つ上へ移動します。', description: '選択中の英文・訳文の組を前の組と入れ替え、文書内の並び順を変更します。', example: '第2組で実行すると、第1組と第2組の順番が入れ替わります。' },
  'editor.cancel': { summary: '現在のモードや入力を終了・取消します。', description: '選択、矢印、境目、form、英文・訳文など、現在の編集状態に応じて確定または取消を行い、通常状態へ戻します。固定Escはこの設定とは別に常に利用できます。', example: '矢印の相手を選んでいる途中で実行すると、矢印を作らず通常編集へ戻ります。' },
  'history.undo': { summary: '直前の編集を取り消します。', description: '下線、標識、構造、英文・訳文、組の並びなど、直前に履歴へ記録された変更を1つ前の状態へ戻します。', example: '下線を作成した直後に実行すると、その下線が消えて作成前へ戻ります。' },
  'history.redo': { summary: '取り消した編集をやり直します。', description: '「元に戻す」で取り消した変更を、取り消す前の状態へ1つ進めます。', example: '下線作成を元に戻した後に実行すると、同じ下線が復元されます。' },
  'cursor.left': { summary: '編集位置を左へ移動します。', description: '現在のモードで選択可能な、左隣のスロット、境目、またはメニュー項目へ移動します。', example: '単語を選択中に実行すると、左隣の単語または構造へ移ります。' },
  'cursor.right': { summary: '編集位置を右へ移動します。', description: '現在のモードで選択可能な、右隣のスロットまたは境目へ移動します。', example: '単語を選択中に実行すると、右隣の単語または構造へ移ります。' },
  'cursor.down': { summary: '編集位置を下へ移動します。', description: '同じ位置付近にある1段下の構造、またはメニューの次の項目へ移動します。', example: '上位の下線を選択中に実行すると、その下にある下線や単語へ移ります。' },
  'cursor.up': { summary: '編集位置を上へ移動します。', description: '同じ位置付近にある1段上の構造、またはメニューの前の項目へ移動します。', example: '単語を選択中に実行すると、その単語を含む下線へ移ります。' },
  'cursor.rowStart': { summary: '現在の表示行の先頭へ移動します。', description: '現在選択している表示行の、最初に選択できる位置へカーソルを移します。', example: '長い英文の途中で実行すると、同じ表示行の左端へ移ります。' },
  'cursor.rowEnd': { summary: '現在の表示行の末尾へ移動します。', description: '現在選択している表示行の、最後に選択できる位置へカーソルを移します。', example: '長い英文の途中で実行すると、同じ表示行の右端へ移ります。' },
  'form.start': { summary: '選択中の対象でform入力を始めます。', description: '単語、疑似トークン、または下線に対して、原形・現在形・過去形などのformを入力するモードへ入ります。', example: '動詞を選択して実行し、続けて過去形の入力を行うと、その動詞に「過去形」が表示されます。' },
  'form.clear': { summary: '選択中のformを削除します。', description: 'form入力の対象に現在設定されている活用表示を削除し、通常編集へ戻ります。', example: '「p.p.」が付いた単語で実行すると、そのform表示だけが消えます。' },
  'form.commit': { summary: '入力中のformを確定します。', description: 'form入力中の有効な文字列を対象へ反映し、入力モードを終了します。', example: '過去形の入力が完成した状態で実行すると、「過去形」として保存されます。' },
  'form.eraseInput': { summary: 'formの入力を末尾から1文字戻します。', description: 'form入力中の未確定文字列から最後の1文字を取り除き、候補を入力し直せる状態にします。', example: '「in」まで入力した状態で実行すると、「i」へ戻ります。' },
  'border.start': { summary: '単語間の境目を編集するモードへ入ります。', description: '現在位置に近い境目を選び、疑似トークンや括弧の挿入・削除を行える状態にします。', example: '2つの単語の間で開始し、疑似トークン入力を実行すると、その間に語を補えます。' },
  'pseudo.start': { summary: '選択中の境目で疑似トークン入力を始めます。', description: '英文本文を変更せず、解析上必要な補助語を現在の境目へ追加する入力欄を開きます。', example: '省略された語を入力して確定すると、その境目に疑似トークンとして追加されます。' },
  'pseudo.commit': { summary: '疑似トークンの入力を確定します。', description: '入力中の文字列を疑似トークンとして追加または更新し、境目編集へ戻ります。', example: '入力欄へ「to」と入力して実行すると、「to」の疑似トークンが作成されます。' },
  'marker.start': { summary: '選択中の対象で定型標識入力を明示的に始めます。', description: '定型標識に割り当てた連続文字列を受け付けるモードへ、文字列をまだ入力していない状態で入ります。', example: '開始してから「s」と入力すると、選択中のスロットにS標識が設定されます。' },
  'marker.customStart': { summary: '選択中の標識を自由入力します。', description: '定型標識にない文字列も含め、選択中のスロットへ任意の標識を入力する欄を開きます。', example: 'スロットを選択して開始し、「補語」と入力すると、その文字列を標識として設定できます。' },
  'marker.customCommit': { summary: '自由入力中の標識を確定します。', description: '自由入力欄の前後空白を除いた文字列を標識として保存します。空なら既存標識を削除します。', example: '「S」と入力して実行すると定型のS標識として確定し、独自文字列なら自由標識として確定します。' },
  'bracket.insertSquareOpen': { summary: '現在位置へ開き角括弧を挿入します。', description: '選択位置または境目へ「[」を独立した解析要素として挿入します。', example: '語の左側で実行すると、その語の直前に「[」が追加されます。' },
  'bracket.insertSquareClose': { summary: '現在位置へ閉じ角括弧を挿入します。', description: '選択位置または境目へ「]」を独立した解析要素として挿入します。', example: '語の右側で実行すると、その語の直後に「]」が追加されます。' },
  'bracket.insertRoundOpen': { summary: '現在位置へ開き丸括弧を挿入します。', description: '選択位置または境目へ「(」を、スロットを持たない括弧として挿入します。', example: '補足部分の先頭で実行すると、その位置に「(」が追加されます。' },
  'bracket.insertRoundClose': { summary: '現在位置へ閉じ丸括弧を挿入します。', description: '選択位置または境目へ「)」を、スロットを持たない括弧として挿入します。', example: '補足部分の末尾で実行すると、その位置に「)」が追加されます。' },
  'bracket.insertAngleOpen': { summary: '現在位置へ開き山括弧を挿入します。', description: '選択位置または境目へ「<」を、修飾矢印を接続できる解析要素として挿入します。', example: 'まとまりの先頭で実行すると、その位置に「<」が追加されます。' },
  'bracket.insertAngleClose': { summary: '現在位置へ閉じ山括弧を挿入します。', description: '選択位置または境目へ「>」を、閉じ側の解析記号として挿入します。', example: 'まとまりの末尾で実行すると、その位置に「>」が追加されます。' },
  'bracket.deleteBefore': { summary: '境目の直前にある括弧・疑似トークンを削除します。', description: '現在の境目の左隣が括弧または疑似トークンなら、依存する構造も整理して削除します。通常の単語は削除しません。', example: '疑似トークンの直後の境目で実行すると、その疑似トークンが削除されます。' },
  'bracket.deleteAfter': { summary: '境目の直後にある括弧・疑似トークンを削除します。', description: '現在の境目の右隣が括弧または疑似トークンなら、依存する構造も整理して削除します。通常の単語は削除しません。', example: '開き括弧の直前の境目で実行すると、その括弧が削除されます。' },
  'arrow.start': { summary: '選択中の標識から矢印作成を始めます。', description: '矢印を出せる標識を始点として固定し、接続先を選ぶモードへ入ります。同格標識では同格接続を作成します。', example: 'ad標識を選んで開始し、修飾先へ移動して確定すると矢印が作られます。' },
  'arrow.delete': { summary: '選択中の対象から出る矢印を削除します。', description: '現在のスロットを始点とする修飾矢印、または参加している同格接続を削除します。標識自体は残します。', example: '矢印の始点で実行すると、標識を残したまま接続線だけが消えます。' },
  'arrow.commit': { summary: '選択中の相手へ矢印を確定します。', description: '矢印モードで選択した終点を接続先として保存し、通常編集へ戻ります。', example: '始点から目的の語へ移動して実行すると、その2点を結ぶ矢印が作られます。' },
  'split.t': { summary: '選択中の対象をT字型に分割します。', description: '単語または対応する下線を左右2スロットへ分け、中央に縦線を持つT構造を作成します。', example: '1語を選択して実行すると、その語を共有する左右2つの操作領域ができます。' },
  'split.d': { summary: '選択中の対象を左右にD分割します。', description: '単語または連続した下線を左右2スロットへ分け、左右を個別に選択・編集できるようにします。', example: '複数語の下線内で実行すると、現在位置に近い境界で左右に分割されます。' },
  'marker.clear': { summary: '選択中の標識だけを削除します。', description: '現在のスロットに付いている標識を空にします。関連条件を満たさなくなった矢印などは同じ編集で整理されます。', example: 'S標識のスロットで実行すると、下線を残したままSだけが消えます。' },
  'selection.toggle': { summary: '下線にする範囲の選択を開始・切替します。', description: '通常状態では範囲選択を開始し、選択中は現在位置を選択へ追加、または選択から解除します。', example: '開始後に右へ移動すると範囲が広がり、個別選択では離れた語も追加できます。' },
  'selection.commit': { summary: '選択したスロットから下線を作成します。', description: '範囲選択または個別選択に含まれる有効なスロットをまとめ、新しい下線として確定します。', example: '2語を選択して実行すると、その2語を含む下線が作成されます。' },
  'english.start': { summary: '英文または疑似トークンを編集します。', description: '通常の語では組全体の英文入力を開始し、疑似トークン上ではその疑似トークンだけを再編集します。', example: '通常の単語で実行すると英文入力欄が開き、疑似トークンで実行するとその文字だけを編集できます。' },
  'translation.start': { summary: '現在の組の訳文を編集します。', description: '選択中の英文に対応する訳文入力を開始し、確定までの変更を1回の編集として扱います。', example: '英文を選択して実行し、日本語訳を入力して完了すると訳文が保存されます。' },
  'structure.delete': { summary: '選択中の下線または分割構造を削除します。', description: '現在位置のT/D分割を解除するか、選択中の下線とそれに依存する構造をまとめて削除します。', example: '下線上で実行するとその下線が消え、T/Dの左右上で実行すると分割が解除されます。' },
  'dialog.cancel': { summary: '開いているダイアログやメニューを閉じます。', description: 'ダイアログの入力を確定せずに閉じるか、開いている操作メニューを閉じて元の場所へ戻します。固定Escは常に利用できます。', example: '操作メニューを開いた状態で実行すると、項目を選ばずメニューだけが閉じます。' },
  'focus.next': { summary: 'ダイアログ内の次の項目へ移動します。', description: '開いているダイアログ内で、次に操作できる入力欄またはボタンへフォーカスを移します。', example: '入力欄で実行すると、次の有効なボタンへフォーカスが移ります。' },
  'focus.previous': { summary: 'ダイアログ内の前の項目へ移動します。', description: '開いているダイアログ内で、前にある操作可能な入力欄またはボタンへフォーカスを戻します。', example: '確定ボタンで実行すると、直前の入力欄へフォーカスが戻ります。' },
  'translation.commit': { summary: '入力中の訳文を確定します。', description: '現在の訳文を保存対象へ反映して訳文編集を終了し、通常編集へ戻ります。', example: '訳文を入力した後に実行すると、その内容を確定して編集枠を閉じます。' },
} satisfies Record<ConfigurableKeyboardOperationId, OperationHelp>;

export function operationHelp(id: OperationId): OperationHelp {
  if (isMarkerId(id)) {
    const label = MARKER_LABELS[id];
    return {
      summary: `選択中のスロットへ「${label}」標識を設定します。`,
      description: `割り当てた連続文字列を入力し、現在選択している単語・疑似トークン・下線などの標識を「${label}」へ変更します。`,
      example: `対象を選択してこの入力を行うと、そのスロットに「${label}」が表示されます。より長い入力候補がある場合は、続きの文字を待ちます。`,
    };
  }
  if (isFormId(id)) {
    const label = FORM_LABELS[id];
    return {
      summary: `form入力中の対象を「${label}」に設定します。`,
      description: `formモードで割り当てた連続文字列を入力し、選択中の単語・疑似トークン・下線の活用表示を「${label}」へ変更します。`,
      example: `form入力を開始してこの入力を完成させると、対象の上に「${label}」が表示されます。`,
    };
  }
  return ACTION_HELP[id as ConfigurableKeyboardOperationId];
}

import { describe, expect, it } from 'vitest';
import { isSequenceDiagram, normalizeLabel, parseSequence, stripStepNumber } from '../src/diagrams/sequence';

describe('isSequenceDiagram', () => {
  it('detects sequenceDiagram after comments and blank lines', () => {
    expect(isSequenceDiagram('%% comment\n\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isSequenceDiagram('flowchart TD\n  A-->B')).toBe(false);
    expect(isSequenceDiagram('%% @link-headings\nsequenceDiagram')).toBe(true);
  });

  it('skips a leading YAML frontmatter block', () => {
    expect(isSequenceDiagram('---\ntitle: Login\nconfig:\n  theme: dark\n---\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isSequenceDiagram('---\ntitle: Flow\n---\nflowchart TD')).toBe(false);
  });
});

describe('parseSequence', () => {
  it('extracts messages with document line numbers', () => {
    const src = ['sequenceDiagram', '  actor U as User', '  U->>FE: 入力', '  FE-->>U: 結果'].join('\n');
    expect(parseSequence(src, 10).messages).toEqual([
      { index: 0, line: 12, text: '入力' },
      { index: 1, line: 13, text: '結果' },
    ]);
  });

  it('recognizes all arrow kinds and activation markers', () => {
    const arrows = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)', '<<->>', '<<-->>', '-|\\', '--|/', '/|-', '\\\\--'];
    const src = ['sequenceDiagram', ...arrows.map((a, i) => `A${a}+B: m${i}`)].join('\n');
    expect(parseSequence(src, 0).messages.map((m) => m.text)).toEqual(arrows.map((_, i) => `m${i}`));
  });

  it('skips notes, blocks and other statements', () => {
    const src = [
      'sequenceDiagram',
      '  participant A',
      '  Note over A,B: A->>B: not a message',
      '  alt ok',
      '  A->>B: yes',
      '  else ng',
      '  A-->>B: no',
      '  end',
      '  activate A',
      '  loop every 1m',
      '  A->>A: self',
      '  end',
    ].join('\n');
    expect(parseSequence(src, 0).messages.map((m) => m.text)).toEqual(['yes', 'no', 'self']);
  });

  it('attaches %% @ref to the next message only', () => {
    const src = ['sequenceDiagram', '  %% @ref 認証処理 ', '', '  %% other comment', '  A->>B: auth', '  A->>B: next'].join('\n');
    const { messages } = parseSequence(src, 5);
    expect(messages[0]).toMatchObject({ text: 'auth', ref: '認証処理', refLine: 6 });
    expect(messages[1].ref).toBeUndefined();
  });

  it('reads messages from participants named like keywords', () => {
    const src = ['sequenceDiagram', '  %% @ref 送信処理', '  Link->>API: 送信', '  End-->>Box: 完了', '  end'].join('\n');
    expect(parseSequence(src, 0).messages).toEqual([
      { index: 0, line: 2, text: '送信', ref: '送信処理', refLine: 1 },
      { index: 1, line: 3, text: '完了' },
    ]);
  });

  it('ignores frontmatter lines and keeps document line numbers', () => {
    const src = ['---', 'title: A->>B: not a message', '---', 'sequenceDiagram', 'A->>B: x'].join('\n');
    expect(parseSequence(src, 10).messages).toEqual([{ index: 0, line: 14, text: 'x' }]);
  });

  it('keeps colons inside the label', () => {
    expect(parseSequence('sequenceDiagram\nA->>B: GET /a?x=1: ok', 0).messages[0].text).toBe('GET /a?x=1: ok');
  });

  it('finds the %% @link-headings marker before or after the diagram type', () => {
    expect(parseSequence('%% @link-headings\nsequenceDiagram\nA->>B: x', 3).markerLine).toBe(3);
    const after = parseSequence('sequenceDiagram\n  %%  @link-headings \nA->>B: x', 3);
    expect(after).toEqual({ messages: [{ index: 0, line: 5, text: 'x' }], notes: [], anchors: [], strayDirectives: [], markerLine: 4 });
    expect(parseSequence('sequenceDiagram\n%% @link-headings-x\nA->>B: x', 0).markerLine).toBeUndefined();
  });

  it('numbers messages like mermaid autonumber', () => {
    const numbers = (...lines: string[]) => parseSequence(['sequenceDiagram', ...lines].join('\n'), 0).messages.map((m) => m.number);
    expect(numbers('A->>B: a', 'autonumber', 'A->>B: b', 'Note over A: n', 'A->>B: c')).toEqual([undefined, 2, 3]);
    expect(numbers('autonumber 10 5', 'A->>B: a', 'A->>B: b')).toEqual([10, 15]);
    // the counter keeps going while numbering is off
    expect(numbers('AUTONUMBER', 'A->>B: a', 'autonumber off', 'A->>B: b', 'autonumber', 'A->>B: c')).toEqual([1, undefined, 3]);
    expect(numbers('autonumber 1 0.1', 'A->>B: a', 'A->>B: b', 'A->>B: c')).toEqual([1, 1.1, 1.2]);
    expect(numbers('autonumber 5', 'A->>B: a', 'autonumber 0 2', 'A->>B: b', 'A->>B: c')).toEqual([5, 6, 8]);
    expect(numbers('autonumber 10 %% start', 'A->>B: a', 'autonumber off # pause', 'A->>B: b')).toEqual([10, undefined]);
  });

  it('ignores the marker inside frontmatter and does not attach it as a @ref', () => {
    expect(parseSequence('---\n%% @link-headings\n---\nsequenceDiagram\nA->>B: x', 0).markerLine).toBeUndefined();
    const { messages } = parseSequence('sequenceDiagram\n%% @ref y\n%% @link-headings\nA->>B: x', 0);
    expect(messages[0].ref).toBe('y');
  });
});

describe('stripStepNumber', () => {
  it('splits a leading step number off', () => {
    expect(stripStepNumber('3. 取得')).toEqual({ text: '取得', value: '3' });
    expect(stripStepNumber('3) 取得')).toEqual({ text: '取得', value: '3' });
    expect(stripStepNumber('3．取得')).toEqual({ text: '取得', value: '3' });
    expect(stripStepNumber('３．取得１件')).toEqual({ text: '取得１件', value: '3' });
    expect(stripStepNumber('(12) 取得')).toEqual({ text: '取得', value: '12' });
    expect(stripStepNumber('（3）取得')).toEqual({ text: '取得', value: '3' });
    expect(stripStepNumber('③ 取得')).toEqual({ text: '取得', value: '3' });
    expect(stripStepNumber('1.2. 取得')).toEqual({ text: '取得', value: '1.2' });
    expect(stripStepNumber('1.2.3 取得')).toEqual({ text: '取得', value: '1.2.3' });
  });

  it('leaves labels that only start with a number alone', () => {
    expect(stripStepNumber('200 OK')).toBeUndefined();
    expect(stripStepNumber('1.5倍に拡大')).toBeUndefined();
    expect(stripStepNumber('3.')).toBeUndefined();
  });
});

describe('normalizeLabel', () => {
  it('normalizes line breaks, entities and whitespace', () => {
    expect(normalizeLabel('  ユーザー<br/>情報  を取得 ')).toBe('ユーザー 情報 を取得');
    expect(normalizeLabel('a#59; b')).toBe('a; b');
  });
});

describe('parseSequence notes', () => {
  const SRC = [
    'sequenceDiagram',
    '  S->>S: 応答作成',
    '  Note over S: HNY90000 → 503 → Ⓒ エラー応答',
    '  alt 正常',
    '    Note over S: Ⓑ',
    '    S->>S: 正常応答作成',
    '    S-->>C: 200',
    '  else Ⓒ エラー',
    '    S->>S: エラー応答作成',
    '    loop 再試行',
    '      S->>S: 再送',
    '    end',
    '    S-->>C: 400',
    '  end',
    '  S->>S: 後処理',
  ].join('\n');

  it('reads the labels of notes and of block sections, with the messages of their sections', () => {
    const parsed = parseSequence(SRC, 0);
    expect(parsed.messages.map((m) => m.text)).toEqual(['応答作成', '正常応答作成', '200', 'エラー応答作成', '再送', '400', '後処理']);
    expect(parsed.anchors).toEqual([
      { name: 'Ⓑ', line: 4, note: 1, firstMessage: 1, endMessage: 3 },
      { name: 'Ⓒ', line: 7, title: 'Ⓒ エラー', occurrence: 0, firstMessage: 3, endMessage: 6 },
    ]);
  });

  it('makes a note with a defined label in its text jump to it', () => {
    const { notes } = parseSequence(SRC, 0);
    expect(notes).toEqual([
      { index: 0, line: 2, text: 'HNY90000 → 503 → Ⓒ エラー応答', goto: 'Ⓒ' },
      { index: 1, line: 4, text: 'Ⓑ', anchor: 'Ⓑ' },
    ]);
    // A circled letter no label has is only text.
    expect(parseSequence('sequenceDiagram\nNote over A: Ⓩ を参照', 0).notes[0].goto).toBeUndefined();
  });

  it('ends the label of a note outside the blocks at the end of the diagram', () => {
    const src = ['sequenceDiagram', 'A->>B: 一', 'Note over A: ⓐ', 'A->>B: 二', 'A->>B: 三'].join('\n');
    expect(parseSequence(src, 0).anchors).toEqual([{ name: 'ⓐ', line: 2, note: 0, firstMessage: 1, endMessage: 3 }]);
  });

  it('names labels and jumps with %% @anchor and %% @goto', () => {
    const src = [
      'sequenceDiagram',
      '  %% @anchor 認証エラー',
      '  Note over A: 認証エラー',
      '  A->>B: 一',
      '  %% @anchor リトライ',
      '  loop 3 回まで',
      '  A->>B: 二',
      '  end',
      '  %% @goto 認証エラー',
      '  Note over A: 401 の場合',
    ].join('\n');
    const parsed = parseSequence(src, 0);
    expect(parsed.anchors).toEqual([
      { name: '認証エラー', line: 2, markerLine: 1, note: 0, firstMessage: 0, endMessage: 2 },
      { name: 'リトライ', line: 5, markerLine: 4, title: '3 回まで', occurrence: 0, firstMessage: 1, endMessage: 2 },
    ]);
    expect(parsed.notes[1]).toEqual({ index: 1, line: 9, text: '401 の場合', goto: '認証エラー', gotoLine: 8 });
    expect(parsed.strayDirectives).toEqual([]);
  });

  it('reports %% @anchor and %% @goto that apply to nothing', () => {
    const src = ['sequenceDiagram', '%% @goto Ⓐ', 'A->>B: 一', '%% @anchor Ⓑ', 'rect rgb(0, 0, 0)', 'end', '%% @goto Ⓒ', 'alt x', 'end', '%% @anchor Ⓓ'].join('\n');
    expect(parseSequence(src, 0).strayDirectives).toEqual([
      { line: 1, directive: 'goto' },
      { line: 3, directive: 'anchor' },
      { line: 6, directive: 'goto' },
      { line: 9, directive: 'anchor' },
    ]);
  });

  it('counts the sections with the same condition before a labeled one', () => {
    const src = ['sequenceDiagram', 'alt エラー', 'end', 'alt 正常', '%% @anchor X', 'else エラー', 'end'].join('\n');
    expect(parseSequence(src, 0).anchors).toEqual([{ name: 'X', line: 5, markerLine: 4, title: 'エラー', occurrence: 1, firstMessage: 0, endMessage: 0 }]);
  });

  it('takes %% @anchor only on a section with a condition, which mermaid draws', () => {
    const parsed = parseSequence(['sequenceDiagram', 'alt x', '%% @anchor Ⓐ', 'else', 'end'].join('\n'), 0);
    expect(parsed.anchors).toEqual([]);
    expect(parsed.strayDirectives).toEqual([{ line: 2, directive: 'anchor' }]);
  });

  it('makes a note with only a label jump with %% @goto', () => {
    const parsed = parseSequence(['sequenceDiagram', 'Note over A: Ⓑ', '%% @goto Ⓑ', 'Note over A: Ⓒ'].join('\n'), 0);
    expect(parsed.notes[1]).toEqual({ index: 1, line: 3, text: 'Ⓒ', goto: 'Ⓑ', gotoLine: 2 });
    expect(parsed.anchors.map((a) => a.name)).toEqual(['Ⓑ']);
  });

  it('does not count notes as messages nor give them @ref', () => {
    const src = ['sequenceDiagram', '%% @ref 見出し', 'Note over A: Ⓐ', 'A->>B: 一'].join('\n');
    const parsed = parseSequence(src, 0);
    expect(parsed.messages).toEqual([{ index: 0, line: 3, text: '一', ref: '見出し', refLine: 1 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { isSequenceDiagram, normalizeLabel, parseSequence, stripStepNumber } from '../src/sequence';

describe('isSequenceDiagram', () => {
  it('detects sequenceDiagram after comments and blank lines', () => {
    expect(isSequenceDiagram('%% comment\n\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isSequenceDiagram('flowchart TD\n  A-->B')).toBe(false);
    expect(isSequenceDiagram('%% @seq-notes\nsequenceDiagram')).toBe(true);
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

  it('finds the %% @seq-notes marker before or after the diagram type', () => {
    expect(parseSequence('%% @seq-notes\nsequenceDiagram\nA->>B: x', 3).markerLine).toBe(3);
    const after = parseSequence('sequenceDiagram\n  %%  @seq-notes \nA->>B: x', 3);
    expect(after).toEqual({ messages: [{ index: 0, line: 5, text: 'x' }], markerLine: 4 });
    expect(parseSequence('sequenceDiagram\n%% @seq-notes-x\nA->>B: x', 0).markerLine).toBeUndefined();
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
    expect(parseSequence('---\n%% @seq-notes\n---\nsequenceDiagram\nA->>B: x', 0).markerLine).toBeUndefined();
    const { messages } = parseSequence('sequenceDiagram\n%% @ref y\n%% @seq-notes\nA->>B: x', 0);
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

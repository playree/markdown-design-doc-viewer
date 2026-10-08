import { describe, expect, it } from 'vitest';
import { isSequenceDiagram, normalizeLabel, parseSequence } from '../src/sequence';

describe('isSequenceDiagram', () => {
  it('detects sequenceDiagram after comments and blank lines', () => {
    expect(isSequenceDiagram('%% comment\n\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isSequenceDiagram('flowchart TD\n  A-->B')).toBe(false);
  });

  it('skips a leading YAML frontmatter block', () => {
    expect(isSequenceDiagram('---\ntitle: Login\nconfig:\n  theme: dark\n---\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(isSequenceDiagram('---\ntitle: Flow\n---\nflowchart TD')).toBe(false);
  });
});

describe('parseSequence', () => {
  it('extracts messages with document line numbers', () => {
    const src = ['sequenceDiagram', '  actor U as User', '  U->>FE: 入力', '  FE-->>U: 結果'].join('\n');
    expect(parseSequence(src, 10)).toEqual([
      { index: 0, line: 12, text: '入力' },
      { index: 1, line: 13, text: '結果' },
    ]);
  });

  it('recognizes all arrow kinds and activation markers', () => {
    const arrows = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)', '<<->>', '<<-->>', '-|\\', '--|/', '/|-', '\\\\--'];
    const src = ['sequenceDiagram', ...arrows.map((a, i) => `A${a}+B: m${i}`)].join('\n');
    expect(parseSequence(src, 0).map((m) => m.text)).toEqual(arrows.map((_, i) => `m${i}`));
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
    expect(parseSequence(src, 0).map((m) => m.text)).toEqual(['yes', 'no', 'self']);
  });

  it('attaches %% @ref to the next message only', () => {
    const src = ['sequenceDiagram', '  %% @ref 認証処理 ', '', '  %% other comment', '  A->>B: auth', '  A->>B: next'].join('\n');
    const messages = parseSequence(src, 5);
    expect(messages[0]).toMatchObject({ text: 'auth', ref: '認証処理', refLine: 6 });
    expect(messages[1].ref).toBeUndefined();
  });

  it('reads messages from participants named like keywords', () => {
    const src = ['sequenceDiagram', '  %% @ref 送信処理', '  Link->>API: 送信', '  End-->>Box: 完了', '  end'].join('\n');
    expect(parseSequence(src, 0)).toEqual([
      { index: 0, line: 2, text: '送信', ref: '送信処理', refLine: 1 },
      { index: 1, line: 3, text: '完了' },
    ]);
  });

  it('ignores frontmatter lines and keeps document line numbers', () => {
    const src = ['---', 'title: A->>B: not a message', '---', 'sequenceDiagram', 'A->>B: x'].join('\n');
    expect(parseSequence(src, 10)).toEqual([{ index: 0, line: 14, text: 'x' }]);
  });

  it('keeps colons inside the label', () => {
    expect(parseSequence('sequenceDiagram\nA->>B: GET /a?x=1: ok', 0)[0].text).toBe('GET /a?x=1: ok');
  });
});

describe('normalizeLabel', () => {
  it('normalizes line breaks, entities and whitespace', () => {
    expect(normalizeLabel('  ユーザー<br/>情報  を取得 ')).toBe('ユーザー 情報 を取得');
    expect(normalizeLabel('a#59; b')).toBe('a; b');
  });
});

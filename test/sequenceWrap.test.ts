import { describe, expect, it } from 'vitest';
import { textWidth, wrapLabel, wrapSequenceMessages } from '../src/diagrams/sequenceWrap';

const doc = (...lines: string[]): string => lines.join('\n');

describe('textWidth', () => {
  it('counts the full-width characters as 2', () => {
    expect(textWidth('abc')).toBe(3);
    expect(textWidth('注文API')).toBe(7);
    expect(textWidth('（ＡＢ）')).toBe(8);
    expect(textWidth('𠮷')).toBe(2);
    expect(textWidth('🚀👍🪄')).toBe(6);
  });
});

describe('wrapLabel', () => {
  it('leaves a label that fits as it is', () => {
    expect(wrapLabel('POST /orders/{id}/cancel', 30)).toEqual(['POST /orders/{id}/cancel']);
    expect(wrapLabel('注文をキャンセル済みで保存', 30)).toEqual(['注文をキャンセル済みで保存']);
  });

  it('breaks English at the spaces, with the lines evened out', () => {
    expect(wrapLabel('Diagrams without @link-headings render normally', 30)).toEqual(['Diagrams without', '@link-headings render normally']);
    expect(wrapLabel('Open link and enter new password', 30)).toEqual(['Open link and', 'enter new password']);
  });

  it('breaks Japanese between any characters, with the lines evened out', () => {
    expect(wrapLabel('オーソリを取消して注文をキャンセル済みで保存する', 30)).toEqual(['オーソリを取消して注文を', 'キャンセル済みで保存する']);
  });

  it('breaks between Japanese and a word rather than in the word', () => {
    expect(wrapLabel(`オーソリを取消${'A'.repeat(30)}`, 30)).toEqual(['オーソリを取消', 'A'.repeat(30)]);
  });

  it('breaks a path after a slash', () => {
    expect(wrapLabel('GET /api/v1/orders/{orderId}/cancellation', 30)).toEqual(['GET /api/v1/orders/', '{orderId}/cancellation']);
    expect(wrapLabel('see https://example.com/orders/12345', 30)).toEqual(['see https://example.com/', 'orders/12345']);
  });

  it('breaks a word longer than a line', () => {
    expect(wrapLabel('a'.repeat(70), 30)).toEqual(['a'.repeat(24), 'a'.repeat(24), 'a'.repeat(22)]);
  });

  it('does not start a line with a closing mark or end one with an opening one', () => {
    const lines = wrapLabel('あいうえおかきくけこさしすせ、そたちつてとなにぬねの', 30);
    expect(lines.every((line) => !/^[、。）」ー]/.test(line))).toBe(true);
    expect(wrapLabel('あいうえおかきくけこさしすせ「そたちつてと」なにぬねの', 30).every((line) => !/「$/.test(line))).toBe(true);
    expect(wrapLabel('あいうえおかきくけこさしすせ「そたちつてと」なにぬねの', 30).every((line) => !/^」/.test(line))).toBe(true);
  });

  it('collapses the spaces', () => {
    expect(wrapLabel('  Open link   and enter  new password  ', 30)).toEqual(['Open link and', 'enter new password']);
  });
});

describe('wrapSequenceMessages', () => {
  const long = 'オーソリを取消して注文をキャンセル済みで保存する';

  it('breaks the long labels of the arrows with <br>', () => {
    expect(wrapSequenceMessages(doc('sequenceDiagram', `  API->>PSP: ${long}`, '  PSP-->>API: OK'), 30)).toBe(
      doc('sequenceDiagram', '  API->>PSP: オーソリを取消して注文を<br>キャンセル済みで保存する', '  PSP-->>API: OK'),
    );
  });

  it('keeps the lines, their ends and the spaces around the label', () => {
    expect(wrapSequenceMessages(`---\ntitle: x\n---\r\nsequenceDiagram\r\nA->>B:  ${long}  \r\n`, 30)).toBe(
      '---\ntitle: x\n---\r\nsequenceDiagram\r\nA->>B:  オーソリを取消して注文を<br>キャンセル済みで保存する  \r\n',
    );
  });

  it('leaves the labels broken by the author, with markup or with what mermaid reads in them', () => {
    for (const label of [`${long}<br>です`, `<b>${long}</b>`, `${long}<BR/>です`, `Click <kbd>Enter</kbd> to confirm the account transfer`, `<span class="x">${long}</span>`, `wrap:${long}`, `nowrap:${long}`, `${long}#59;`, `${long} %% メモ`, `$$x$$${long}`]) {
      const source = doc('sequenceDiagram', `A->>B: ${label}`);
      expect(wrapSequenceMessages(source, 30)).toBe(source);
    }
  });

  it('breaks a label with a < that is not a tag', () => {
    expect(wrapSequenceMessages(doc('sequenceDiagram', `A->>B: List<Item> を${long}`), 30)).toContain('<br>');
    expect(wrapSequenceMessages(doc('sequenceDiagram', `A->>B: Map<string, number> を${long}`), 30)).toContain('<br>');
  });

  it('counts the emoji as wide', () => {
    expect(wrapSequenceMessages(doc('sequenceDiagram', `A->>B: ${'🚀'.repeat(15)}`), 30)).not.toContain('<br>');
    expect(wrapSequenceMessages(doc('sequenceDiagram', `A->>B: ${'🚀'.repeat(16)}`), 30)).toBe(
      doc('sequenceDiagram', `A->>B: ${'🚀'.repeat(8)}<br>${'🚀'.repeat(8)}`),
    );
  });

  it('leaves the notes, participants and conditions', () => {
    const source = doc(
      'sequenceDiagram',
      `participant A as ${long}`,
      `Note over A: ${long}`,
      `alt ${long}`,
      'A->>A: x',
      'end',
    );
    expect(wrapSequenceMessages(source, 30)).toBe(source);
  });

  it('leaves the labels with a width of 0, and the other diagrams', () => {
    const source = doc('sequenceDiagram', `A->>B: ${long}`);
    expect(wrapSequenceMessages(source, 0)).toBe(source);
    const flowchart = doc('flowchart TD', `A -->|${long}| B`, `C->>D: ${long}`);
    expect(wrapSequenceMessages(flowchart, 30)).toBe(flowchart);
  });
});

import { describe, expect, it } from 'vitest';
import { linkDiagrams } from '../src/linker';
import { createMarkdown, HEADING_ID_PREFIX, renderDocument, slugify } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');
const hid = (text: string): string => HEADING_ID_PREFIX + slugify(text);

const SAMPLE = doc(
  '# シーケンス',
  '',
  '```mermaid',
  '%% @link-headings',
  'sequenceDiagram',
  '    Auth->>DB: ユーザー情報を取得',
  '    %% @ref トークン発行処理',
  '    Auth-->>API: トークン発行',
  '    API-->>FE: 200 OK',
  '```',
  '',
  '# 処理概要',
  '',
  '## ユーザー情報を取得',
  '',
  'テキスト',
  '',
  '## トークン発行処理',
  '',
  '<!-- link-headings:end -->',
  '',
  '# 補足',
);

describe('linkDiagrams', () => {
  it('links by text and by @ref and stops at the end marker', () => {
    const tokens = md.parse(SAMPLE, {});
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(warnings).toEqual([]);
    expect(diagrams).toHaveLength(1);
    const [d] = diagrams;
    expect(d.paired).toBe(true);
    expect(d.messages.map((m) => m.target)).toEqual([hid('ユーザー情報を取得'), hid('トークン発行処理'), undefined]);
    expect(tokens[d.rangeEnd].type).toBe('html_block');
  });

  it('stops the overview range at the next sequence diagram', () => {
    const src = doc(
      '```mermaid', 'sequenceDiagram', '%% @link-headings', 'A->>B: 一', '```',
      '## 一',
      '```mermaid', 'sequenceDiagram', '%% @link-headings', 'A->>B: 二', '```',
      '## 二',
    );
    const tokens = md.parse(src, {});
    const { diagrams } = linkDiagrams(tokens);
    expect(diagrams.map((d) => d.messages[0].target)).toEqual([hid('一'), hid('二')]);
    expect(diagrams[0].rangeEnd).toBe(diagrams[1].fenceIndex);
  });

  it('extends the overview range over unmarked diagrams', () => {
    const src = doc(
      '```mermaid', 'sequenceDiagram', '%% @link-headings', 'A->>B: 一', '```',
      '```mermaid', 'sequenceDiagram', 'A->>B: 二', '```',
      '## 二',
    );
    const tokens = md.parse(src, {});
    const { diagrams } = linkDiagrams(tokens);
    expect(diagrams.map((d) => d.paired)).toEqual([true, false]);
    expect(diagrams[0].rangeEnd).toBe(tokens.length);
    expect(diagrams[0].messages[0].target).toBeUndefined();
    expect(diagrams[1].messages[0].target).toBeUndefined();
  });

  it('pairs a marked diagram without links and warns on unresolved @ref', () => {
    const src = doc('```mermaid', 'sequenceDiagram', '%% @link-headings', '%% @ref 無い見出し', 'A->>B: x', '```', '## y');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].paired).toBe(true);
    expect(warnings).toEqual([{ line: 3, message: expect.stringContaining('無い見出し') }]);
  });

  it('does not pair or link unmarked diagrams and warns on their @ref', () => {
    const src = doc('```mermaid', 'sequenceDiagram', '%% @ref x', 'A->>B: x', 'A->>B: y', '```', '## x', '## y');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].paired).toBe(false);
    expect(diagrams[0].messages.map((m) => m.target)).toEqual([undefined, undefined]);
    expect(warnings).toEqual([{ line: 2, message: expect.stringContaining('@link-headings') }]);
  });

  it('warns on a marked diagram nested in a list', () => {
    const src = doc('- item', '', '  ```mermaid', '  sequenceDiagram', '  %% @link-headings', '  A->>B: x', '  ```', '## x');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].paired).toBe(false);
    expect(warnings).toEqual([{ line: 4, message: expect.stringContaining('list or blockquote') }]);
  });

  it('ignores headings before the diagram and other mermaid diagrams', () => {
    const src = doc('## x', '```mermaid', 'pie', '%% @link-headings', '"x": 1', '```', '```mermaid', 'sequenceDiagram', '%% @link-headings', 'A->>B: x', '```');
    const { diagrams } = linkDiagrams(md.parse(src, {}));
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].messages[0].target).toBeUndefined();
  });

  it('does not recognize the old @seq-notes markers but reports them', () => {
    const src = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', 'A->>B: x', '```', '## x', '<!-- seq-notes:end -->');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].paired).toBe(false);
    expect(warnings).toEqual([
      { line: 1, message: '"%% @seq-notes" is no longer supported. Write "%% @link-headings" instead.' },
      { line: 6, message: '"<!-- seq-notes:end -->" is no longer supported. Write "<!-- link-headings:end -->" instead.' },
    ]);
  });

  it('links flowchart nodes and marks horizontal flowcharts as stacked', () => {
    const src = doc(
      '```mermaid', '%% @link-headings', 'flowchart TD', '  A[取得] --> B{判定}', '  %% @ref 終了処理', '  B --> C([終了])', '  B --> D', '```',
      '## 取得', '## 判定', '## 終了処理', '## 予備',
      '```mermaid', 'graph LR', '  %% @link-headings', '  X[二つ目]', '```',
      '## 二つ目',
    );
    const tokens = md.parse(src, {});
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(warnings).toEqual([]);
    expect(diagrams.map((d) => [d.kind, d.paired, d.stacked])).toEqual([
      ['flowchart', true, false],
      ['flowchart', true, true],
    ]);
    const [flow, lr] = diagrams;
    expect(flow.messages.map((m) => [m.nodeId, m.target, m.unlinked])).toEqual([
      ['A', hid('取得'), undefined],
      ['B', hid('判定'), undefined],
      ['C', hid('終了処理'), undefined],
      // A node without a label is not marked.
      ['D', undefined, undefined],
    ]);
    expect(flow.rangeEnd).toBe(lr.fenceIndex);
    expect(flow.unlinkedHeadings.map((i) => tokens[i].attrGet('id'))).toEqual([hid('予備')]);
    expect(lr.messages[0].target).toBe(hid('二つ目'));
  });

  it('ends the overview of a sequence diagram at a marked flowchart', () => {
    const src = doc('```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: 一', '```', '## 一', '```mermaid', '%% @link-headings', 'flowchart TD', 'A[二]', '```', '## 二');
    const { diagrams } = linkDiagrams(md.parse(src, {}));
    expect(diagrams.map((d) => d.kind)).toEqual(['sequence', 'flowchart']);
    expect(diagrams[0].rangeEnd).toBe(diagrams[1].fenceIndex);
    expect(diagrams.map((d) => d.messages[0].target)).toEqual([hid('一'), hid('二')]);
  });

  it('words the flowchart warnings for flowcharts', () => {
    const src = doc('```mermaid', 'flowchart TD', '%% @ref x', 'A[a]', '```', '```mermaid', '%% @link-headings', 'flowchart TD', '%% @ref 無い', 'B[b]', '```');
    expect(linkDiagrams(md.parse(src, {})).warnings.map((w) => w.message)).toEqual([
      '@ref is ignored because the flowchart has no "%% @link-headings" marker.',
      '@ref target heading "無い" was not found after the flowchart.',
    ]);
  });

  it('collects the unlinked headings at the level most linked headings have', () => {
    const src = doc(
      '```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: 一', 'B->>C: 二', '%% @ref 概要', 'C-->>A: 応答', 'A->>A: 無し', '```',
      '# 概要', '## 一', '### 詳細', '## 二', '#### 深い', '## 三', '> ## 引用', '',
      '<!-- link-headings:end -->',
      '## 範囲外',
    );
    const tokens = md.parse(src, {});
    const [d] = linkDiagrams(tokens).diagrams;
    // `# 概要` is linked by @ref but does not change the step level; headings in blockquotes and after the end marker are ignored
    expect(d.unlinkedHeadings.map((i) => tokens[i].attrGet('id'))).toEqual([hid('三')]);
    expect(d.messages.map((m) => m.unlinked)).toEqual([undefined, undefined, undefined, true]);
  });

  it('marks nothing in a diagram without any link', () => {
    const tokens = md.parse(doc('```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: x', '```', '## 見出し'), {});
    const [d] = linkDiagrams(tokens).diagrams;
    expect(d.unlinkedHeadings).toEqual([]);
    expect(d.messages[0].unlinked).toBeUndefined();
  });
});

describe('numbered headings', () => {
  const src = doc(
    '```mermaid', '%% @link-headings', 'sequenceDiagram', 'autonumber', 'A->>B: 取得', 'B-->>A: 結果', 'A->>A: 保存', '```',
    '## 1. 取得', '## 2) 結果', '## 保存', '## 4. 保存',
  );

  it('links arrows to headings without their step number and prefers exact matches', () => {
    const tokens = md.parse(src, {});
    const { diagrams } = linkDiagrams(tokens);
    expect(diagrams[0].messages.map((m) => [m.number, m.target])).toEqual([
      [1, hid('1. 取得')],
      [2, hid('2) 結果')],
      [3, hid('保存')],
    ]);
  });

  it('links a numbered heading even when its number differs from the arrow number', () => {
    const tokens = md.parse(src.replace('## 2) 結果', '## 5) 結果'), {});
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(diagrams[0].messages[1].target).toBe(hid('5) 結果'));
    expect(warnings).toEqual([]);
  });

  it('tells whether the heading already shows the arrow number', () => {
    const tokens = md.parse(src.replace('## 2) 結果', '## 5) 結果'), {});
    expect(linkDiagrams(tokens).diagrams[0].messages.map((m) => m.numberInHeading)).toEqual([true, false, undefined]);
  });

  it('compares the numbers as numbers', () => {
    const tokens = md.parse(src.replace('## 1. 取得', '## 01. 取得'), {});
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(diagrams[0].messages[0].numberInHeading).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('picks the heading with the arrow number among headings with the same text', () => {
    const tokens = md.parse(doc('```mermaid', '%% @link-headings', 'sequenceDiagram', 'autonumber', 'A->>B: 取得', 'B->>C: 取得', '```', '## 1. 取得', '## 2. 取得'), {});
    const { diagrams, warnings } = linkDiagrams(tokens);
    expect(diagrams[0].messages.map((m) => m.target)).toEqual([hid('1. 取得'), hid('2. 取得')]);
    expect(warnings).toEqual([]);
  });
});

describe('renderDocument', () => {
  it('wraps paired diagrams and their overview', () => {
    const html = renderDocument(md, SAMPLE);
    const pairStart = html.indexOf('<div class="seqnotes-pair"');
    expect(pairStart).toBeGreaterThan(html.indexOf('<h1 id="sn-シーケンス"'));
    expect(html.indexOf('<div class="seqnotes-seq-col">')).toBeGreaterThan(pairStart);
    const overview = html.indexOf('<div class="seqnotes-overview-col">');
    expect(html.indexOf('<h1 id="sn-処理概要" data-line="11">')).toBeGreaterThan(overview);
    // content after the end marker is outside the pair
    expect(html.lastIndexOf('</div>', html.indexOf('<h1 id="sn-補足"'))).toBeGreaterThan(overview);
    expect(html).toMatch(/<div class="seqnotes-mermaid" data-line="2" data-seqnotes-meta="\{&quot;id&quot;:0,/);
  });

  it('marks the unlinked headings', () => {
    const html = renderDocument(md, doc('```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: 一', '```', '## 一', '## 二'));
    expect(html).toContain('<h2 id="sn-一" data-line="5">');
    expect(html).toMatch(/<h2 id="sn-二" data-line="6" class="seqnotes-unlinked" title="[^"]+" data-seqnotes-mark="no arrow">/);
  });

  it('renders flowcharts with their node ids and stacks horizontal ones', () => {
    const html = renderDocument(md, doc('```mermaid', '%% @link-headings', 'graph LR', 'A[一] --> B[二]', '```', '## 一', '## 予備'));
    expect(html).toContain('<div class="seqnotes-pair seqnotes-pair-stacked" data-diagram="0">');
    expect(html).toContain('&quot;kind&quot;:&quot;flowchart&quot;');
    expect(html).toContain('&quot;nodeId&quot;:&quot;A&quot;');
    expect(html).toMatch(/<h2 id="sn-予備" data-line="6" class="seqnotes-unlinked" title="No node in the flowchart is linked to this heading." data-seqnotes-mark="no node">/);
    expect(renderDocument(md, doc('```mermaid', '%% @link-headings', 'graph TD', 'A[一]', '```', '## 一'))).toContain('<div class="seqnotes-pair" data-diagram="0">');
  });

  it('leaves out the warnings, marks and source lines for an export', () => {
    const src = doc('---', 'title: T', '---', '```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: 一', '%% @ref 無い', 'A->>B: 二', '```', '## 一', '## 三');
    const html = renderDocument(md, src, { forExport: true });
    expect(html).not.toContain('seqnotes-warnings');
    expect(html).not.toContain('seqnotes-unlinked');
    expect(html).not.toContain('data-line');
    expect(html).not.toContain('unlinked&quot;');
    expect(html).toContain('<table class="seqnotes-front-matter">');
    expect(html).toContain('<div class="seqnotes-mermaid" data-seqnotes-meta=');
    expect(html).toContain('<h2 id="sn-三">三</h2>');
    // The preview still has them.
    expect(renderDocument(md, src)).toContain('unlinked&quot;:true');
  });

  it('escapes the mermaid source and embedded metadata', () => {
    const html = renderDocument(md, doc('```mermaid', 'sequenceDiagram', 'A->>B: "</pre><b>', '```'));
    expect(html).not.toMatch(/<b>/);
    expect(html).toContain('A-&gt;&gt;B: &quot;&lt;/pre&gt;&lt;b&gt;');
    expect(html).toContain('&quot;text&quot;:&quot;\\&quot;&lt;/pre&gt;&lt;b&gt;&quot;');
  });

  it('adds data-line to blocks and rewrites image sources', () => {
    const html = renderDocument(md, doc('para', '', '![x](img/a.png)'), { resolveResource: (s) => `res:${s}` });
    expect(html).toContain('<p data-line="0">para</p>');
    expect(html).toContain('src="res:img/a.png"');
  });

  it('makes heading ids unique, including against literal suffixed headings', () => {
    const html = renderDocument(md, doc('## A', '## A', '## A-1', '## Title'));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['sn-a', 'sn-a-1', 'sn-a-1-1', 'sn-title']);
  });

  it('puts warnings above the content without data-line', () => {
    const html = renderDocument(md, doc('para', '', '```mermaid', 'sequenceDiagram', '%% @link-headings', '%% @ref 無い', 'A->>B: x', '```'));
    expect(html).toMatch(/^<div class="seqnotes-warnings" data-seqnotes-key="[^"]+"><p data-seqnotes-jump="5">/);
    expect(html.indexOf('data-line')).toBeGreaterThan(html.indexOf('</div>'));
  });

  it('keys the warnings by their messages, without the line numbers', () => {
    const src = doc('```mermaid', 'sequenceDiagram', '%% @link-headings', '%% @ref 無い', 'A->>B: x', '```');
    const key = (html: string): string | undefined => /data-seqnotes-key="([^"]*)"/.exec(html)?.[1];
    expect(key(renderDocument(md, src))).toBe('@ref target heading &quot;無い&quot; was not found after the sequence diagram.');
    expect(key(renderDocument(md, doc('para', '', src)))).toBe(key(renderDocument(md, src)));
    expect(renderDocument(md, doc('para'))).not.toContain('seqnotes-warnings');
  });

  it('translates the warnings and marks with env.t', () => {
    const t = (message: string, ...args: (string | number)[]): string => `[${message}|${args.join('|')}]`;
    const html = renderDocument(
      md,
      doc('```mermaid', '%% @link-headings', 'sequenceDiagram', 'A->>B: 一', '%% @ref 無い', 'A->>B: 二', '```', '## 一', '## 三'),
      { t },
    );
    expect(html).toContain(
      '<p data-seqnotes-jump="4">[⚠ Line {0}: {1}|5|[@ref target heading &quot;{0}&quot; was not found after the sequence diagram.|無い]]</p>',
    );
    expect(html).toContain('title="[No arrow in the sequence diagram is linked to this heading.|]" data-seqnotes-mark="[no arrow|]"');
  });
});

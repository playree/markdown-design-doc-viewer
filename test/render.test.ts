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
  '<!-- seq-notes:end -->',
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
      '```mermaid', 'sequenceDiagram', 'A->>B: 一', '```',
      '## 一',
      '```mermaid', 'sequenceDiagram', 'A->>B: 二', '```',
      '## 二',
    );
    const tokens = md.parse(src, {});
    const { diagrams } = linkDiagrams(tokens);
    expect(diagrams.map((d) => d.messages[0].target)).toEqual([hid('一'), hid('二')]);
    expect(diagrams[0].rangeEnd).toBe(diagrams[1].fenceIndex);
  });

  it('does not pair diagrams without links and warns on unresolved @ref', () => {
    const src = doc('```mermaid', 'sequenceDiagram', '%% @ref 無い見出し', 'A->>B: x', '```', '## y');
    const { diagrams, warnings } = linkDiagrams(md.parse(src, {}));
    expect(diagrams[0].paired).toBe(false);
    expect(warnings).toEqual([{ line: 2, message: expect.stringContaining('無い見出し') }]);
  });

  it('ignores headings before the diagram and non-sequence mermaid', () => {
    const src = doc('## x', '```mermaid', 'flowchart TD', 'A-->B', '```', '```mermaid', 'sequenceDiagram', 'A->>B: x', '```');
    const { diagrams } = linkDiagrams(md.parse(src, {}));
    expect(diagrams).toHaveLength(1);
    expect(diagrams[0].paired).toBe(false);
  });
});

describe('renderDocument', () => {
  it('wraps paired diagrams and their overview', () => {
    const html = renderDocument(md, SAMPLE);
    const pairStart = html.indexOf('<div class="seqnotes-pair"');
    expect(pairStart).toBeGreaterThan(html.indexOf('<h1 id="sn-シーケンス"'));
    expect(html.indexOf('<div class="seqnotes-seq-col">')).toBeGreaterThan(pairStart);
    const overview = html.indexOf('<div class="seqnotes-overview-col">');
    expect(html.indexOf('<h1 id="sn-処理概要" data-line="10">')).toBeGreaterThan(overview);
    // content after the end marker is outside the pair
    expect(html.lastIndexOf('</div>', html.indexOf('<h1 id="sn-補足"'))).toBeGreaterThan(overview);
    expect(html).toMatch(/<div class="seqnotes-mermaid" data-line="2" data-seqnotes-meta="\{&quot;id&quot;:0,/);
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
    const html = renderDocument(md, doc('para', '', '```mermaid', 'sequenceDiagram', '%% @ref 無い', 'A->>B: x', '```'));
    expect(html).toMatch(/^<div class="seqnotes-warnings"><p data-seqnotes-jump="4">/);
    expect(html.indexOf('data-line')).toBeGreaterThan(html.indexOf('</div>'));
  });
});

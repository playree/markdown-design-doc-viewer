import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from '../src/markdownExtras';
import { createMarkdown, renderDocument } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

describe('front matter', () => {
  const table = (...rows: [string, string][]): string =>
    '<table data-line="0" class="seqnotes-front-matter">\n<tbody>\n' +
    rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>\n`).join('') +
    '</tbody>\n</table>\n';

  it('shows the entries as a table and keeps the source lines of what follows', () => {
    const html = renderDocument(md, doc('---', 'title: 設計書', 'version: 1', '---', '', '# 概要'));
    expect(html).toBe(table(['title', '設計書'], ['version', '1']) + '<h1 id="sn-概要" data-line="5">概要</h1>\n');
  });

  it('hides the block when frontMatter is false', () => {
    const html = renderDocument(md, doc('---', 'title: 設計書', '---', '', '# 概要'), { frontMatter: false });
    expect(html).toBe('<h1 id="sn-概要" data-line="4">概要</h1>\n');
  });

  it('accepts ... as the end and leaves an unclosed block alone', () => {
    expect(renderDocument(md, doc('---', 'a: 1', '...', 'para'))).toBe(table(['a', '1']) + '<p data-line="3">para</p>\n');
    expect(renderDocument(md, doc('---', 'para'))).toContain('<hr data-line="0">');
  });

  it('leaves a leading horizontal rule alone', () => {
    const html = renderDocument(md, doc('---', '', '# 見出し', '', '---', 'para'));
    expect(html).toContain('<h1 id="sn-見出し" data-line="2">');
  });

  it('only applies at the top of the document', () => {
    expect(renderDocument(md, doc('para', '', '---', 'a: 1', '---'))).toContain('<h2 id="sn-a-1" data-line="3">a: 1</h2>');
  });

  it('accepts non-ASCII and quoted keys', () => {
    expect(renderDocument(md, doc('---', 'タイトル: 設計書', '---', 'para'))).toBe(table(['タイトル', '設計書']) + '<p data-line="3">para</p>\n');
    expect(renderDocument(md, doc('---', '"title": \'設計書\'', '---'))).toBe(table(['title', '設計書']));
  });

  it('does not turn its lines into headings', () => {
    // Without the rule, `title: 設計書` followed by `---` is a setext heading.
    expect(md.parse(doc('---', 'title: 設計書', '---'), {}).map((t) => t.type)).toEqual(['front_matter']);
  });

  it('escapes the keys and values', () => {
    expect(renderDocument(md, doc('---', 'a: <b>&', '---'))).toBe(table(['a', '&lt;b&gt;&amp;']));
  });

  it('shows nothing for a block without entries to show', () => {
    expect(renderDocument(md, doc('---', 'a: 1', '---'), { frontMatter: false })).toBe('');
  });
});

describe('parseFrontMatter', () => {
  it('reads plain and quoted values', () => {
    expect(parseFrontMatter(doc('title: "設計書: ログイン"', "status: 'draft'", 'time: 10:30'))).toEqual([
      { key: 'title', value: '設計書: ログイン' },
      { key: 'status', value: 'draft' },
      { key: 'time', value: '10:30' },
    ]);
  });

  it('joins lists with commas', () => {
    expect(parseFrontMatter(doc('tags:', '  - auth', '  - "api"', 'owners: [alice, \'bob\']', 'reviewers:', '- carol'))).toEqual([
      { key: 'tags', value: 'auth, api' },
      { key: 'owners', value: 'alice, bob' },
      { key: 'reviewers', value: 'carol' },
    ]);
  });

  it('keeps the lines of block scalars and nested values', () => {
    expect(parseFrontMatter(doc('summary: |', '  line 1', '  line 2', '', 'folded: >', '  a', '  b', 'author:', '  name: X', '  team: Y'))).toEqual([
      { key: 'summary', value: 'line 1\nline 2' },
      { key: 'folded', value: 'a b' },
      { key: 'author', value: 'name: X\nteam: Y' },
    ]);
  });

  it('drops trailing comments, but not a # in quotes or in a word', () => {
    expect(parseFrontMatter(doc('title: Draft # internal note', 'quoted: "a # b" # note', 'issue: C#7', 'tags: # list', '  - a # first', 'summary: | # note', '  # kept in a block'))).toEqual([
      { key: 'title', value: 'Draft' },
      { key: 'quoted', value: 'a # b' },
      { key: 'issue', value: 'C#7' },
      { key: 'tags', value: 'a' },
      { key: 'summary', value: '# kept in a block' },
    ]);
  });

  it('skips comments and an empty value stays empty', () => {
    expect(parseFrontMatter(doc('# comment', 'a:', 'b: 1'))).toEqual([
      { key: 'a', value: '' },
      { key: 'b', value: '1' },
    ]);
  });
});

describe('code highlighting', () => {
  it('highlights fences with a known language', () => {
    const html = renderDocument(md, doc('```json', '{"id": 1}', '```'));
    expect(html).toContain('<code data-line="0" class="language-json">');
    expect(html).toContain('<span class="hljs-attr">&quot;id&quot;</span>');
  });

  it('only escapes code without a known language', () => {
    expect(renderDocument(md, doc('```nosuchlang', '<b>', '```'))).toContain('<code data-line="0" class="language-nosuchlang">&lt;b&gt;\n</code>');
    expect(renderDocument(md, doc('```', '<b>', '```'))).toContain('<code data-line="0">&lt;b&gt;\n</code>');
  });
});

describe('GitHub alerts', () => {
  const icon = (name: string) => `<svg class="octicon octicon-${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="[^"]+"></path></svg>`;

  it.each([
    ['NOTE', 'info'],
    ['TIP', 'light-bulb'],
    ['IMPORTANT', 'report'],
    ['WARNING', 'alert'],
    ['CAUTION', 'stop'],
  ])('converts [!%s]', (type, iconName) => {
    const html = renderDocument(md, doc(`> [!${type}]`, '> 本文'));
    const name = type.toLowerCase();
    expect(html).toMatch(
      new RegExp(
        `^<div class="markdown-alert markdown-alert-${name}" data-line="0">\n` +
          `<p class="markdown-alert-title" data-line="0">${icon(iconName)}${name[0].toUpperCase()}${name.slice(1)}</p>\n` +
          '<p data-line="1">本文</p>\n' +
          '</div>\n$',
      ),
    );
  });

  it('drops the marker paragraph when the text starts in a new paragraph', () => {
    const html = renderDocument(md, doc('> [!note]', '>', '> 本文'));
    expect(html).toMatch(
      new RegExp(
        '^<div class="markdown-alert markdown-alert-note" data-line="0">\n' +
          `<p class="markdown-alert-title" data-line="0">${icon('info')}Note</p>\n` +
          '<p data-line="2">本文</p>\n' +
          '</div>\n$',
      ),
    );
  });

  it('leaves other blockquotes alone', () => {
    expect(renderDocument(md, doc('> [!NOTE] 同じ行', '> 本文'))).toContain('<blockquote data-line="0">');
    expect(renderDocument(md, doc('> [!OTHER]', '> 本文'))).toContain('<blockquote data-line="0">');
  });

  it('leaves marker-only and nested blockquotes alone, like GitHub', () => {
    expect(renderDocument(md, doc('> [!NOTE]'))).toContain('<blockquote data-line="0">');
    expect(renderDocument(md, doc('- 項目', '', '  > [!NOTE]', '  > 本文'))).toContain('<blockquote data-line="2">');
    expect(renderDocument(md, doc('> > [!NOTE]', '> > 本文'))).not.toContain('markdown-alert');
  });
});

describe('task lists', () => {
  it('renders checkboxes', () => {
    const html = renderDocument(md, doc('- [ ] 未完了', '- [x] 完了', '- [X]', '- 通常', '- [y] 対象外'));
    expect(html).toContain('<li class="task-list-item" data-line="0"><input class="task-list-item-checkbox" type="checkbox" disabled> 未完了</li>');
    expect(html).toContain('<li class="task-list-item" data-line="1"><input class="task-list-item-checkbox" type="checkbox" disabled checked> 完了</li>');
    expect(html).toContain('<li class="task-list-item" data-line="2"><input class="task-list-item-checkbox" type="checkbox" disabled checked> </li>');
    expect(html).toContain('<li data-line="3">通常</li>');
    expect(html).toContain('<li data-line="4">[y] 対象外</li>');
  });
});

import { describe, expect, it } from 'vitest';
import { inSequenceDiagram, quickFixes, quickFixesByLine, refCandidates, type TextEdit } from '../src/authoring';
import { collectIssues } from '../src/issues';
import { createMarkdown } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

function apply(source: string, edit: TextEdit): string {
  const lines = source.split('\n');
  const offset = (p: TextEdit['start']): number => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return source.slice(0, offset(edit.start)) + edit.text + source.slice(offset(edit.end));
}

// Line numbers:          0             1                 2                  3                   4                  5                    6                  7
const base = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '    %% @ref ない', '    A->>B: 三', '```',
  // 8   9       10  11      12  13
  '', '## 一', '', '本文', '', '## 予備');

describe('inSequenceDiagram', () => {
  it('is true on the content lines of a sequence diagram only', () => {
    expect([0, 1, 3, 6, 7, 9].map((line) => inSequenceDiagram(md, base, line))).toEqual([false, true, true, true, false, false]);
    expect(inSequenceDiagram(md, doc('```mermaid', 'flowchart LR', '  A --> B', '```'), 2)).toBe(false);
  });
});

describe('refCandidates', () => {
  it('lists the overview headings, unlinked first', () => {
    expect(refCandidates(md, base, 5)).toEqual([
      { text: '予備', linked: false },
      { text: '一', linked: true },
    ]);
  });

  it('is undefined outside a paired diagram', () => {
    expect(refCandidates(md, base, 9)).toBeUndefined();
    expect(refCandidates(md, doc('```mermaid', 'sequenceDiagram', '    A->>B: 一', '```', '## 一'), 2)).toBeUndefined();
  });
});

describe('quickFixes', () => {
  it('links an unlinked arrow with a new @ref above it, keeping the indent', () => {
    const fixes = quickFixes(md, base, 4);
    expect(fixes.map((f) => f.title)).toEqual(['Link to heading "予備" with @ref', 'Add heading "二" to the overview']);
    const fixed = apply(base, fixes[0].edit);
    expect(fixed.split('\n').slice(4, 6)).toEqual(['    %% @ref 予備', '    A->>B: 二']);
    expect(collectIssues(md, fixed).map((i) => i.line)).not.toContain(5);
  });

  it('adds the heading after the steps of the earlier arrows', () => {
    const fixed = apply(base, quickFixes(md, base, 4)[1].edit);
    expect(fixed.split('\n').slice(11, 16)).toEqual(['本文', '', '## 二', '', '## 予備']);
    expect(collectIssues(md, fixed).some((i) => i.message.includes('"二"'))).toBe(false);
  });

  it('rewrites a @ref to a missing heading, or adds that heading', () => {
    const fixes = quickFixes(md, base, 5);
    expect(fixes.map((f) => f.title)).toEqual(['Change @ref to heading "予備"', 'Add heading "ない" to the overview']);
    expect(apply(base, fixes[0].edit).split('\n')[5]).toBe('    %% @ref 予備');
    // The same fixes on the arrow line.
    expect(quickFixes(md, base, 6)).toEqual(fixes);
  });

  it('links an unlinked arrow to a heading without an arrow', () => {
    const fixes = quickFixes(md, base, 13);
    expect(fixes.map((f) => f.title)).toEqual(['Link arrow "二" to this heading with @ref', 'Link arrow "三" to this heading with @ref']);
    expect(apply(base, fixes[0].edit).split('\n').slice(4, 6)).toEqual(['    %% @ref 予備', '    A->>B: 二']);
    // An arrow with a @ref gets it rewritten.
    expect(apply(base, fixes[1].edit).split('\n')[5]).toBe('    %% @ref 予備');
  });

  it('adds a heading at the end of the overview: before the end marker, a parent heading or at the end', () => {
    const src = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '```', '', '### 一', '本文');
    expect(apply(src, quickFixes(md, src, 4)[0].edit)).toBe(src + '\n\n### 二\n');
    expect(apply(src + '\n', quickFixes(md, src + '\n', 4)[0].edit)).toBe(src + '\n\n### 二\n');

    const marker = doc(src, '<!-- seq-notes:end -->', '', '## 次');
    expect(apply(marker, quickFixes(md, marker, 4)[0].edit)).toBe(doc(src, '', '### 二', '', '<!-- seq-notes:end -->', '', '## 次'));

    const parent = doc(src, '', '## 次の章');
    expect(apply(parent, quickFixes(md, parent, 4)[0].edit)).toBe(doc(src, '', '### 二', '', '## 次の章'));
  });

  it('adds the heading of the first arrow before the first step', () => {
    const src = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '```', '', '## 概要', '', '### 二');
    expect(apply(src, quickFixes(md, src, 3)[0].edit)).toBe(doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '```', '', '## 概要', '', '### 一', '', '### 二'));
  });

  it('does not offer a @ref to a heading with the text of an earlier one, which @ref cannot tell apart', () => {
    const src = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '```', '', '## 一', '### 確認', '## 三', '### 確認');
    // `### 確認` are below the step level; the unlinked step is `三`.
    expect(quickFixes(md, src, 4).map((f) => f.title)).toEqual(['Link to heading "三" with @ref', 'Add heading "二" to the overview']);
    const steps = doc('```mermaid', '%% @seq-notes', 'sequenceDiagram', '    A->>B: 一', '    A->>B: 二', '```', '', '## 一', '## 確認', '## 確認');
    expect(quickFixes(md, steps, 4).map((f) => f.title)).toEqual(['Link to heading "確認" with @ref', 'Add heading "二" to the overview']);
    expect(quickFixes(md, steps, 9)).toEqual([]);
    expect(refCandidates(md, steps, 4)?.map((c) => c.text)).toEqual(['確認', '一']);
  });

  it('gives the fixes of several lines at once', () => {
    const fixes = quickFixesByLine(md, base, [4, 13, 3]);
    expect([...fixes.keys()]).toEqual([4, 13, 3]);
    expect(fixes.get(4)).toEqual(quickFixes(md, base, 4));
    expect(fixes.get(13)).toEqual(quickFixes(md, base, 13));
    expect(fixes.get(3)).toEqual([]);
  });

  it('offers nothing for linked lines and translates the titles', () => {
    expect(quickFixes(md, base, 3)).toEqual([]);
    expect(quickFixes(md, base, 9)).toEqual([]);
    expect(quickFixes(md, base, 4, (m, ...args) => `${m}|${args.join(',')}`)[0].title).toBe('Link to heading "{0}" with @ref|予備');
  });
});

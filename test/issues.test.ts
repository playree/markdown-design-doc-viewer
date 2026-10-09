import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectIssues } from '../src/issues';
import { createMarkdown } from '../src/render';

const md = createMarkdown();

const doc = (...lines: string[]): string => lines.join('\n');

describe('collectIssues', () => {
  it('reports nothing for a fully linked document', () => {
    const src = doc(
      '```mermaid',
      '%% @link-headings',
      'sequenceDiagram',
      '    Auth->>DB: ユーザー取得',
      '    %% @ref トークン発行',
      '    Auth-->>API: トークンを返す',
      '```',
      '',
      '## ユーザー取得',
      '',
      '## 2. トークン発行',
    );
    expect(collectIssues(md, src)).toEqual([]);
  });

  it('reports link warnings, unlinked arrows and unlinked headings by line', () => {
    const src = doc(
      '```mermaid',
      '%% @link-headings',
      'sequenceDiagram',
      '    A->>B: 一',
      '    A->>B: 二<br/>行目',
      '    %% @ref ない見出し',
      '    A->>B: 三',
      '```',
      '',
      '## 一',
      '',
      '## 余分な見出し',
    );
    expect(collectIssues(md, src)).toEqual([
      { line: 4, severity: 'info', message: 'Arrow "二 行目" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the arrow.' },
      { line: 5, severity: 'warning', message: '@ref target heading "ない見出し" was not found after the sequence diagram.' },
      { line: 6, severity: 'info', message: 'Arrow "三" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the arrow.' },
      { line: 11, severity: 'info', message: 'No arrow in the sequence diagram is linked to heading "余分な見出し".' },
    ]);
  });

  it('reports a marked diagram without any link once, at the fence', () => {
    const src = doc('# 図', '', '```mermaid', '%% @link-headings', 'sequenceDiagram', '    A->>B: 一', '```', '', '## 別の見出し');
    expect(collectIssues(md, src)).toEqual([
      {
        line: 2,
        severity: 'info',
        message: 'No arrow in the sequence diagram is linked to a heading. Write the steps as headings after the diagram, with the same text as the arrows.',
      },
    ]);
  });

  it('leaves a diagram whose only links are broken @refs to their warnings', () => {
    const src = doc('```mermaid', '%% @link-headings', 'sequenceDiagram', '    %% @ref ない', '    A->>B: 一', '```');
    expect(collectIssues(md, src).map((i) => i.severity)).toEqual(['warning']);
  });

  it('still reports a diagram without links when broken @refs and plain arrows are mixed', () => {
    const src = doc('```mermaid', '%% @link-headings', 'sequenceDiagram', '    %% @ref ない', '    A->>B: 一', '    A->>B: 二', '```');
    expect(collectIssues(md, src).map((i) => [i.line, i.severity])).toEqual([
      [0, 'info'],
      [3, 'warning'],
    ]);
  });

  it('does not report unlinked arrows without a label', () => {
    const src = doc('```mermaid', '%% @link-headings', 'sequenceDiagram', '    A->>B: 一', '    B-->>A: ', '```', '', '## 一');
    expect(collectIssues(md, src)).toEqual([]);
  });

  it('reports unlinked nodes and headings of a flowchart, but not nodes without a label', () => {
    const src = doc('```mermaid', '%% @link-headings', 'flowchart TD', '    A[一] --> B{二}', '    B --> C', '```', '', '## 一', '## 余分');
    expect(collectIssues(md, src)).toEqual([
      { line: 3, severity: 'info', message: 'Node "二" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the node.' },
      { line: 8, severity: 'info', message: 'No node in the flowchart is linked to heading "余分".' },
    ]);
  });

  it('reports a marked flowchart without any link once, at the fence', () => {
    const src = doc('```mermaid', '%% @link-headings', 'graph LR', '    A[一] --> B[二]', '```', '## 別');
    expect(collectIssues(md, src).map((i) => [i.line, i.message])).toEqual([
      [0, 'No node in the flowchart is linked to a heading. Write the steps as headings after the diagram, with the same text as the nodes.'],
    ]);
  });

  it('ignores diagrams without the marker', () => {
    expect(collectIssues(md, doc('```mermaid', 'sequenceDiagram', '    A->>B: 一', '```'))).toEqual([]);
  });

  it('passes the messages through the translate function', () => {
    const src = doc('```mermaid', '%% @link-headings', 'sequenceDiagram', '    A->>B: 一', '```');
    expect(collectIssues(md, src, (message) => `t:${message}`)[0].message).toMatch(/^t:/);
  });

  it.each(['ai-authoring-guide.md', 'ai-authoring-guide.ja.md'])('reports nothing for the template in docs/%s', (name) => {
    const guide = readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const template = /^````markdown\n([\s\S]*?)^````$/m.exec(guide)?.[1];
    expect(template).toContain('%% @link-headings');
    expect(collectIssues(md, template!)).toEqual([]);
  });
});

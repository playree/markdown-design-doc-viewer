import { describe, expect, it } from 'vitest';
import { isFlowchart, parseFlowchart } from '../src/flowchart';

const labels = (src: string): [string, string][] => parseFlowchart(src, 0).nodes.map((n) => [n.nodeId, n.text]);

describe('isFlowchart', () => {
  it('detects graph and flowchart after comments and front matter', () => {
    expect(isFlowchart('flowchart TD\n  A-->B')).toBe(true);
    expect(isFlowchart('%% @link-headings\n\ngraph LR\n  A-->B')).toBe(true);
    expect(isFlowchart('---\ntitle: Flow\n---\nflowchart-elk TB')).toBe(true);
    expect(isFlowchart('sequenceDiagram\n  A->>B: hi')).toBe(false);
    expect(isFlowchart('graphTD\n  A-->B')).toBe(false);
  });
});

describe('parseFlowchart', () => {
  it('extracts nodes with their labels and lines', () => {
    const src = ['flowchart TD', '  A[ユーザー情報を取得] --> B{在庫あり?}', '  B -->|はい| C(出荷する)', '  B -- いいえ --> D'].join('\n');
    expect(parseFlowchart(src, 10).nodes).toEqual([
      { index: 0, line: 11, text: 'ユーザー情報を取得', nodeId: 'A', labeled: true, refable: true },
      // A `%% @ref` above line 11 goes to A.
      { index: 1, line: 11, text: '在庫あり?', nodeId: 'B', labeled: true, refable: false },
      { index: 2, line: 12, text: '出荷する', nodeId: 'C', labeled: true, refable: true },
      { index: 3, line: 13, text: 'D', nodeId: 'D', labeled: false, refable: true },
    ]);
  });

  it('reads all node shapes', () => {
    const shapes = ['[a]', '(b)', '{c}', '((d))', '(((e)))', '([f])', '[[g]]', '[(h)]', '{{i}}', '[/j/]', '[\\k\\]', '[/l\\]', '>m]'];
    const src = ['graph TB', ...shapes.map((s, i) => `  N${i}${s}`)].join('\n');
    expect(labels(src).map(([, text]) => text)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']);
  });

  it('reads quoted labels, markdown strings and shape data', () => {
    const src = [
      'flowchart TD',
      '  A["取得 (DB) [1]"] --> B["`**太字**`"]',
      '  C@{ shape: rect, label: "発行" } --> D@{ shape: circle }',
      '  E[行1<br/>行2]:::warn',
    ].join('\n');
    expect(labels(src)).toEqual([
      ['A', '取得 (DB) [1]'],
      ['B', '太字'],
      ['C', '発行'],
      ['D', 'D'],
      ['E', '行1<br/>行2'],
    ]);
  });

  it('reads edge texts in pipes with quoted pipes', () => {
    expect(labels('flowchart TD\n  A[a] -->|"x|y"| B[b]')).toEqual([
      ['A', 'a'],
      ['B', 'b'],
    ]);
  });

  it('reports the old @seq-notes marker', () => {
    expect(parseFlowchart('flowchart TD\n  %% @seq-notes\n  A-->B', 3)).toMatchObject({ markerLine: undefined, legacyMarkerLine: 4 });
  });

  it('reads chained links, & and all link kinds without taking edge texts as nodes', () => {
    const src = [
      'flowchart LR',
      '  A --> B & C --> D',
      '  D --- E -.-> F ==> G --o H --x I <--> J ~~~ K',
      '  K -. 点線 .-> L == 太線 ==> M',
      '  M e1@--> N',
      '  N-->O;O-->P',
    ].join('\n');
    expect(labels(src).map(([id]) => id)).toEqual('ABCDEFGHIJKLMNOP'.split(''));
  });

  it('takes the last label of a node, like mermaid', () => {
    const src = ['flowchart TD', '  A --> B', '  A[開始]', '  A[開始処理] --> C'].join('\n');
    const [a] = parseFlowchart(src, 0).nodes;
    expect(a).toMatchObject({ nodeId: 'A', text: '開始処理', line: 3, labeled: true });
  });

  it('skips keywords, styles and subgraphs', () => {
    const src = [
      'flowchart TD',
      '  subgraph S1 [サブ]',
      '    direction LR',
      '    A[一] --> B[二]',
      '  end',
      '  S1 --> C[三]',
      '  classDef warn fill:#f96',
      '  class A warn',
      '  style B fill:#bbf',
      '  linkStyle 0 stroke:#f00',
      '  click C "https://example.com"',
      '  classA[クラス]',
      '  accDescr {',
      '    X[説明] --> Y',
      '  }',
      '  %% A[comment]',
    ].join('\n');
    expect(labels(src)).toEqual([
      ['A', '一'],
      ['B', '二'],
      ['C', '三'],
      ['classA', 'クラス'],
    ]);
  });

  it('attaches @ref to the node the next line defines', () => {
    const src = ['flowchart TD', '  %% @ref 認証処理', '  A --> B[ログイン]', '  %% @ref 終了', '  B --> C'].join('\n');
    const nodes = parseFlowchart(src, 5).nodes;
    expect(nodes.map((n) => [n.nodeId, n.ref, n.refLine])).toEqual([
      ['A', undefined, undefined],
      ['B', '認証処理', 6],
      ['C', '終了', 8],
    ]);
    // Without a node defined on the line, the first node of the line.
    expect(parseFlowchart(['flowchart TD', '  A[一] --> B[二]', '  %% @ref 終了', '  B --> A'].join('\n'), 0).nodes[1].ref).toBe('終了');
  });

  it('finds the marker and the direction', () => {
    expect(parseFlowchart('%% @link-headings\nflowchart TD\n  A-->B', 3)).toMatchObject({ markerLine: 3, horizontal: false });
    expect(parseFlowchart('flowchart TD\n  %% @link-headings\n  A-->B', 3).markerLine).toBe(4);
    expect(parseFlowchart('flowchart TD\n  %% @seq-notes\n  A-->B', 3).markerLine).toBeUndefined();
    const horizontal = (header: string): boolean => parseFlowchart(`${header}\n  A-->B`, 0).horizontal;
    expect(['graph LR', 'flowchart RL', 'graph <', 'graph >', 'graph LR;'].map(horizontal)).toEqual([true, true, true, true, true]);
    expect(['graph TD', 'flowchart TB', 'graph BT', 'graph', 'graph v', 'flowchart'].map(horizontal)).toEqual([false, false, false, false, false, false]);
  });

  it('reads statements on the header line', () => {
    expect(labels('graph TD;A[一]-->B')).toEqual([
      ['A', '一'],
      ['B', 'B'],
    ]);
  });
});

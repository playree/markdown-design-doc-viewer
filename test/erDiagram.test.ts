import { describe, expect, it } from 'vitest';
import { isErDiagram, parseErDiagram } from '../src/erDiagram';

const labels = (src: string): [string, string][] => parseErDiagram(src, 0).nodes.map((n) => [n.nodeId, n.text]);

describe('isErDiagram', () => {
  it('detects erDiagram after comments and front matter', () => {
    expect(isErDiagram('erDiagram\n  A ||--o{ B : has')).toBe(true);
    expect(isErDiagram('%% @link-headings\n\nerDiagram')).toBe(true);
    expect(isErDiagram('---\ntitle: ER\n---\nerDiagram')).toBe(true);
    expect(isErDiagram('flowchart TD\n  A-->B')).toBe(false);
    expect(isErDiagram('erDiagrams')).toBe(false);
  });
});

describe('parseErDiagram', () => {
  it('extracts the entities of relationships and attribute blocks with their lines', () => {
    const src = [
      'erDiagram',
      '  CUSTOMER ||--o{ ORDER : places',
      '  ORDER ||--|{ LINE-ITEM : contains',
      '  CUSTOMER {',
      '    string name PK "名前 {}"',
      '    string email',
      '  }',
      '  PRODUCT { string sku }',
    ].join('\n');
    expect(parseErDiagram(src, 10).nodes).toEqual([
      // Defined by its attribute block, so a `%% @ref` above that line goes to it.
      { index: 0, line: 13, text: 'CUSTOMER', nodeId: 'CUSTOMER', labeled: true, refable: true },
      { index: 1, line: 11, text: 'ORDER', nodeId: 'ORDER', labeled: true, refable: false },
      { index: 2, line: 12, text: 'LINE-ITEM', nodeId: 'LINE-ITEM', labeled: true, refable: true },
      { index: 3, line: 17, text: 'PRODUCT', nodeId: 'PRODUCT', labeled: true, refable: true },
    ]);
  });

  it('reads aliases, quoted names, classes and the word forms of the cardinalities', () => {
    const src = [
      'erDiagram',
      '  p["顧客"] {',
      '    string name',
      '  }',
      '  o[注文]:::main',
      '  "Order Item" }|..|| o : "belongs to"',
      '  p:::main only one to zero or more o : places',
      '  p[ほかの別名]',
    ].join('\n');
    // As in mermaid, the first alias stays.
    expect(labels(src)).toEqual([
      ['p', '顧客'],
      ['o', '注文'],
      ['Order Item', 'Order Item'],
    ]);
  });

  it('skips keywords, styles and subgraphs', () => {
    const src = [
      'erDiagram',
      '  direction LR',
      '  subgraph S [販売]',
      '    A ||--o{ B : has',
      '  end',
      '  classDef main fill:#f96',
      '  class A main',
      '  style B fill:#bbf',
      '  accTitle: タイトル',
      '  accDescr {',
      '    X ||--o{ Y : z',
      '  }',
      '  %% C ||--o{ D : e',
    ].join('\n');
    expect(labels(src)).toEqual([
      ['A', 'A'],
      ['B', 'B'],
    ]);
  });

  it('attaches @ref to the entity the next line defines', () => {
    const src = ['erDiagram', '  %% @ref 顧客テーブル', '  CUSTOMER ||--o{ ORDER : places', '  %% @ref 注文テーブル', '  ORDER { int id }'].join('\n');
    expect(parseErDiagram(src, 5).nodes.map((n) => [n.nodeId, n.ref, n.refLine])).toEqual([
      ['CUSTOMER', '顧客テーブル', 6],
      ['ORDER', '注文テーブル', 8],
    ]);
  });

  it('does not read directives inside attribute blocks', () => {
    const src = ['erDiagram', '  A {', '    %% @link-headings', '    %% @ref 無視', '    int id', '  }', '  A ||--o{ B : has'].join('\n');
    const parsed = parseErDiagram(src, 0);
    expect(parsed.markerLine).toBeUndefined();
    expect(parsed.nodes.map((n) => n.ref)).toEqual([undefined, undefined]);
  });

  it('finds the marker and the direction of the top level', () => {
    expect(parseErDiagram('%% @link-headings\nerDiagram\n  A ||--o{ B : has', 3)).toMatchObject({ markerLine: 3, horizontal: false });
    expect(parseErDiagram('erDiagram\n  %% @seq-notes\n  A', 3)).toMatchObject({ markerLine: undefined, legacyMarkerLine: 4 });
    const horizontal = (body: string): boolean => parseErDiagram(`erDiagram\n${body}\n  A ||--o{ B : has`, 0).horizontal;
    expect(['  direction LR', '  direction rl'].map(horizontal)).toEqual([true, true]);
    expect(['', '  direction TB', '  subgraph S\n    direction LR\n  end'].map(horizontal)).toEqual([false, false, false]);
  });
});

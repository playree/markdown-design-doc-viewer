import { describe, expect, it } from 'vitest';
import { isStateDiagram, parseStateDiagram } from '../src/stateDiagram';

const labels = (src: string): [string, string][] => parseStateDiagram(src, 0).nodes.map((n) => [n.nodeId, n.text]);

describe('isStateDiagram', () => {
  it('detects stateDiagram and stateDiagram-v2 after comments and front matter', () => {
    expect(isStateDiagram('stateDiagram-v2\n  [*] --> A')).toBe(true);
    expect(isStateDiagram('%% @link-headings\n\nstateDiagram\n  [*] --> A')).toBe(true);
    expect(isStateDiagram('---\ntitle: 状態\n---\nstateDiagram-v2')).toBe(true);
    expect(isStateDiagram('flowchart TD\n  A-->B')).toBe(false);
    expect(isStateDiagram('stateDiagram-v3')).toBe(false);
  });
});

describe('parseStateDiagram', () => {
  it('extracts the states of the transitions and of their definitions with their lines', () => {
    const src = [
      'stateDiagram-v2',
      '  [*] --> 待機中',
      '  待機中 --> Running : 開始',
      '  state "実行中" as Running',
      '  Running --> [*]',
    ].join('\n');
    expect(parseStateDiagram(src, 10).nodes).toEqual([
      { index: 0, line: 11, text: '待機中', nodeId: '待機中', labeled: true, refable: true },
      { index: 1, line: 13, text: '実行中', nodeId: 'Running', labeled: true, refable: true },
    ]);
  });

  it('takes the first description, as the label mermaid shows', () => {
    const src = ['stateDiagram-v2', '  s1 : 一つ目', '  s1 : 二つ目', '  s2:::warn', '  s1 --> s2:::warn', '  s3 : a:b'].join('\n');
    expect(labels(src)).toEqual([
      ['s1', '一つ目'],
      ['s2', 's2'],
      ['s3', 'a:b'],
    ]);
  });

  it('reads composite states and skips pseudo states, notes and keywords', () => {
    const src = [
      'stateDiagram-v2',
      '  direction LR',
      '  state fork1 <<fork>>',
      '  state "処理中" as Busy {',
      '    direction TB',
      '    [*] --> 受付',
      '    受付 --> fork1',
      '    --',
      '    state choice1 <<choice>>',
      '  }',
      '  note right of Busy : メモ',
      '  note left of 受付',
      '    X --> Y',
      '  end note',
      '  classDef warn fill:#f96',
      '  class 受付 warn',
      '  style Busy fill:#bbf',
      '  hide empty description',
      '  %% Z --> W',
    ].join('\n');
    const parsed = parseStateDiagram(src, 0);
    expect(parsed.nodes.map((n) => [n.nodeId, n.text])).toEqual([
      ['Busy', '処理中'],
      ['受付', '受付'],
    ]);
    // Only the direction of the top level.
    expect(parsed.horizontal).toBe(true);
  });

  it('attaches @ref to the state the next line defines', () => {
    const src = ['stateDiagram-v2', '  %% @ref 待機', '  [*] --> Idle', '  %% @ref 実行', '  Idle --> Running', '  %% @ref 実行状態', '  Running : 実行中'].join('\n');
    expect(parseStateDiagram(src, 5).nodes.map((n) => [n.nodeId, n.ref, n.refLine, n.refable])).toEqual([
      ['Idle', '待機', 6, true],
      // The `@ref` above the line of its description replaces the one above its first transition.
      ['Running', '実行状態', 10, true],
    ]);
  });

  it('does not give @ref to a pseudo state, nor read directives inside notes', () => {
    const src = [
      'stateDiagram-v2',
      '  state if_state <<choice>>',
      '  %% @ref 検証',
      '  if_state --> A',
      '  note left of A',
      '    %% @ref メモ',
      '  end note',
      '  A --> B',
    ].join('\n');
    expect(parseStateDiagram(src, 0).nodes.map((n) => [n.nodeId, n.ref, n.refable])).toEqual([
      ['A', '検証', true],
      ['B', undefined, true],
    ]);
  });

  it('finds the marker and the direction', () => {
    expect(parseStateDiagram('%% @link-headings\nstateDiagram-v2\n  A --> B', 3)).toMatchObject({ markerLine: 3, horizontal: false });
    expect(parseStateDiagram('stateDiagram\n  %% @seq-notes\n  A', 3)).toMatchObject({ markerLine: undefined, legacyMarkerLine: 4 });
    expect(parseStateDiagram('stateDiagram-v2\n  direction RL\n  A --> B', 0).horizontal).toBe(true);
  });
});

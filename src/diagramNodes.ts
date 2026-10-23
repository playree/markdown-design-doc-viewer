/**
 * What the parsers of the diagrams whose nodes are linked to headings (flowcharts, ER diagrams, state diagrams)
 * have in common: the `%% @link-headings` marker, the `%% @ref <heading>` directives and the nodes of each statement line.
 */
import { LEGACY_MARKER_RE, LINK_HEADINGS_RE, REF_RE, type SequenceMessage } from './sequence';

export interface DiagramNode extends SequenceMessage {
  /** Node id, which mermaid puts into the element id (or `data-id`) of the node's SVG element. */
  nodeId: string;
  /** false for a node that has no label of its own and is not a step for it (a flowchart node that shows its id). */
  labeled: boolean;
  /** false when a `%% @ref` written above `line` would go to another node defined on that line. */
  refable: boolean;
}

export interface ParsedNodeDiagram {
  /** Nodes in the order of their first appearance. `line` is where the node was defined (else the first appearance). */
  nodes: DiagramNode[];
  /** 0-based document line of the `%% @link-headings` marker, if present. */
  markerLine?: number;
  /** 0-based document line of an old `%% @seq-notes` marker, if present. */
  legacyMarkerLine?: number;
  /** true when the diagram is laid out horizontally (`LR` / `RL`). */
  horizontal: boolean;
}

/** A node written in a statement. */
export interface NodeRef {
  id: string;
  /** The text shown instead of the id, if written here. */
  label?: string;
  /** true when the statement defines the node (with its label, or on its own), so that a `%% @ref` above it goes to it. */
  defines?: boolean;
}

/** How a parser reads the statements of its kind of diagram. */
export interface NodeReader {
  /** The nodes of a statement line (none for the lines without any). Not called for the `%%` lines. */
  statement(raw: string, index: number): NodeRef[];
  /**
   * true for a line inside a block that `statement` opened, such as the attributes of an entity or a note, which is skipped:
   * a `%%` line there is not read as a directive.
   */
  skip?(raw: string): boolean;
  /** The ids that are not nodes (subgraphs, pseudo states), which the parser may add while reading. */
  excluded?: ReadonlySet<string>;
}

export interface NodeRules {
  /**
   * true when a node keeps its first label and the line of its first definition (ER diagrams, state diagrams),
   * false when the last ones win (flowcharts).
   */
  firstWins: boolean;
  /** true when a node without a label is a step too, named by its id (ER diagrams, state diagrams). */
  idIsLabel: boolean;
}

/**
 * Reads the nodes of the lines from `start` with `reader`, and the marker and the `%% @ref`s.
 * The multi-line accessible descriptions (`accDescr { … }`) are skipped.
 * @param firstLine  0-based document line of the first line
 */
export function readNodes(lines: string[], start: number, firstLine: number, rules: NodeRules, reader: NodeReader): Omit<ParsedNodeDiagram, 'horizontal'> {
  const excluded = reader.excluded ?? new Set<string>();
  const nodes = new Map<string, DiagramNode>();
  const defined = new Set<string>();
  const labeled = new Set<string>();
  let markerLine: number | undefined;
  let legacyMarkerLine: number | undefined;
  let pendingRef: { text: string; line: number } | undefined;
  /** The node a `%% @ref` above the line goes to, by document line. */
  const refTargets = new Map<number, string>();
  let inAccDescr = false;

  lines.forEach((raw, i) => {
    if (i < start) {
      return;
    }
    if (inAccDescr) {
      inAccDescr = !raw.includes('}');
      return;
    }
    if (/^\s*accDescr\s*\{/.test(raw) && !raw.includes('}')) {
      inAccDescr = true;
      return;
    }
    if (reader.skip?.(raw)) {
      return;
    }
    if (LINK_HEADINGS_RE.test(raw)) {
      markerLine ??= firstLine + i;
      return;
    }
    if (LEGACY_MARKER_RE.test(raw)) {
      legacyMarkerLine ??= firstLine + i;
      return;
    }
    const ref = REF_RE.exec(raw);
    if (ref) {
      pendingRef = { text: ref[1], line: firstLine + i };
      return;
    }
    if (raw.trim().startsWith('%%')) {
      return;
    }

    const line = firstLine + i;
    const refs = reader.statement(raw, i);
    // Nodes appearing for the first time on this line.
    const added: string[] = [];
    for (const { id, label, defines } of refs) {
      let node = nodes.get(id);
      if (!node) {
        node = { index: nodes.size, line, text: id, nodeId: id, labeled: rules.idIsLabel, refable: false };
        nodes.set(id, node);
        added.push(id);
      }
      if (label !== undefined && !(rules.firstWins && labeled.has(id))) {
        node.text = label;
        node.labeled = true;
        labeled.add(id);
      }
      if ((defines || label !== undefined) && !(rules.firstWins && defined.has(id))) {
        node.line = line;
        defined.add(id);
      }
    }
    // The node the line defines: the first one defined on it, else the first new one, else the first one.
    const candidates = refs.filter((r) => !excluded.has(r.id));
    const id = candidates.find((r) => r.defines || r.label !== undefined)?.id ?? added.find((a) => !excluded.has(a)) ?? candidates[0]?.id;
    if (id === undefined) {
      return;
    }
    const target = nodes.get(id)!;
    refTargets.set(line, target.nodeId);
    if (pendingRef) {
      target.ref = pendingRef.text;
      target.refLine = pendingRef.line;
      pendingRef = undefined;
    }
  });

  const result = [...nodes.values()]
    .filter((node) => !excluded.has(node.nodeId))
    .map((node, index) => ({ ...node, index, refable: refTargets.get(node.line) === node.nodeId }));
  return { nodes: result, markerLine, legacyMarkerLine };
}

const DIRECTION_RE = /^\s*direction\s+(TB|BT|RL|LR)\b/i;

/** For a `direction` statement, whether it lays the diagram out horizontally (`LR` / `RL`). Undefined for other lines. */
export function horizontalDirection(raw: string): boolean | undefined {
  const direction = DIRECTION_RE.exec(raw)?.[1].toUpperCase();
  return direction === undefined ? undefined : direction === 'LR' || direction === 'RL';
}

/**
 * The index of the line with the diagram's header after a leading front matter and comments,
 * if the first other line matches `header`.
 */
export function headerLine(lines: string[], start: number, header: RegExp): { index: number; match: RegExpExecArray } | undefined {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('%%')) {
      continue;
    }
    const match = header.exec(lines[i]);
    return match ? { index: i, match } : undefined;
  }
  return undefined;
}

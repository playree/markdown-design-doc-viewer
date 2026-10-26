import type { Token } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import type { ParsedNodeDiagram } from './diagramNodes';
import { diagramWording, type LinkWording } from './diagramWording';
import { isErDiagram, parseErDiagram } from './erDiagram';
import { isFlowchart, parseFlowchart } from './flowchart';
import { isSequenceDiagram, normalizeLabel, parseSequence, stripStepNumber, type SequenceMessage, type StepNumber } from './sequence';
import { isStateDiagram, parseStateDiagram } from './stateDiagram';
import { itemRows } from './tables';
import { partNumber, sourcePath, wireframeOf, wireframeParts, wireframeWarnings } from './wireframe';

export const END_MARKER_RE = /^\s*<!--\s*link-headings:end\s*-->\s*$/;

/** The end marker before it was renamed. No longer recognized, only reported. */
const LEGACY_END_MARKER_RE = /^\s*<!--\s*seq-notes:end\s*-->\s*$/;

/**
 * Diagrams whose items can be linked to headings: the arrows of a sequence diagram, the nodes of a flowchart,
 * the entities of an ER diagram, the states of a state diagram and the parts of a wireframe (src/wireframe.ts),
 * which are also linked to the rows of item tables.
 */
export type DiagramKind = MermaidKind | 'wireframe';

/** The diagrams written in mermaid, where `%% @link-headings` and `%% @ref` are written. */
export type MermaidKind = 'sequence' | 'flowchart' | 'er' | 'state';

/** The diagrams whose items are nodes, with their parsers. */
const NODE_DIAGRAMS: { kind: Exclude<MermaidKind, 'sequence'>; is: (source: string) => boolean; parse: (source: string, firstLine: number) => ParsedNodeDiagram }[] = [
  { kind: 'flowchart', is: isFlowchart, parse: parseFlowchart },
  { kind: 'er', is: isErDiagram, parse: parseErDiagram },
  { kind: 'state', is: isStateDiagram, parse: parseStateDiagram },
];

/** An arrow of a sequence diagram, or a node of the other diagrams. */
export interface LinkedMessage extends SequenceMessage {
  /** Node id (all but sequence diagrams). */
  nodeId?: string;
  /** false for a flowchart node without a label of its own. */
  labeled?: boolean;
  /** false for a node that a `%% @ref` above its line would not go to (another node on the line gets it). */
  refable?: boolean;
  /** id of the heading this message is linked to. */
  target?: string;
  /** true when the message has no target although other messages of the diagram have one. */
  unlinked?: boolean;
  /** true when the target heading already starts with the message's `autonumber` number. */
  numberInHeading?: boolean;
}

/** A top-level heading in the overview range of a paired diagram. */
export interface OverviewHeading {
  /** Token index of the `heading_open`. */
  index: number;
  id: string;
  level: number;
  /** 0-based line in the Markdown document. */
  line: number;
  /** Normalized heading text, as compared with the arrows. */
  text: string;
  /** true when `%% @ref <text>` links to this heading: it is the first heading of the range with the text. */
  refTarget: boolean;
}

/** A row of an item table (`item=` in its options) in the overview range of a wireframe. */
export interface ItemRow {
  /** Token index of the `tr_open`. */
  index: number;
  /** Token index of the `td_open` of its cell in the column of the part numbers. */
  cell: number;
  /** 0-based line in the Markdown document. */
  line: number;
  /** The text of its cell in the column of the part numbers. */
  item: string;
  /** The `target` of the part with its number. */
  target?: string;
  /** true when no part has its number although other rows or headings are linked. */
  unlinked?: boolean;
}

export interface DiagramInfo {
  /** Sequential number of the linkable diagram in the document. */
  id: number;
  kind: DiagramKind;
  /** Token index of the mermaid fence, or of the wireframe. */
  fenceIndex: number;
  /** Exclusive end of the overview range (token index). Only meaningful when `paired`. */
  rangeEnd: number;
  messages: LinkedMessage[];
  /**
   * Token indices of the top-level overview headings no message links to, at the level
   * most linked headings have. Empty when the diagram links to no heading at all.
   */
  unlinkedHeadings: number[];
  /** Top-level headings of the overview range, in document order. Only filled when `paired`. */
  headings: OverviewHeading[];
  /** Heading level of the steps (see `stepLevel`). Undefined when no message is linked. */
  stepLevel?: number;
  /** true when the diagram has a `%% @link-headings` marker and is top-level, so it is laid out with its overview. */
  paired: boolean;
  /** true when the overview is always put below the diagram instead of beside it (a horizontal diagram). */
  stacked: boolean;
  /** The rows of the item tables of the overview range (wireframes only). */
  rows: ItemRow[];
}

export interface LinkWarning {
  line: number;
  message: string;
}

export interface LinkResult {
  diagrams: DiagramInfo[];
  warnings: LinkWarning[];
}

export function isMermaidFence(token: Token): boolean {
  return token.type === 'fence' && token.info.trim().split(/\s+/)[0] === 'mermaid';
}

/** The kind of a mermaid fence whose items can be linked to headings, if it is one. */
export function diagramKind(token: Token): MermaidKind | undefined {
  if (!isMermaidFence(token)) {
    return undefined;
  }
  if (isSequenceDiagram(token.content)) {
    return 'sequence';
  }
  return NODE_DIAGRAMS.find((d) => d.is(token.content))?.kind;
}

/** Plain text of a heading's inline token. */
export function headingText(inline: Token | undefined): string {
  if (!inline) {
    return '';
  }
  if (!inline.children) {
    return inline.content;
  }
  return inline.children
    .map((child) => {
      switch (child.type) {
        case 'text':
        case 'code_inline':
          return child.content;
        case 'softbreak':
        case 'hardbreak':
          return ' ';
        default:
          return '';
      }
    })
    .join('');
}

/**
 * The heading level of the steps: the one most linked headings have (the shallowest on a tie),
 * so that a single `@ref` to e.g. a parent heading does not change it.
 */
function stepLevel(linkedLevels: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const level of linkedLevels) {
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  let best: number | undefined;
  for (const [level, count] of counts) {
    const bestCount = best === undefined ? 0 : counts.get(best)!;
    if (count > bestCount || (count === bestCount && level < best!)) {
      best = level;
    }
  }
  return best;
}

/** A diagram of the mermaid fence `token`, of `kind`, with its arrows / nodes, and the problems of its directives. */
function mermaidDiagram(token: Token, index: number, kind: MermaidKind, id: number, translate: Translate, warnings: LinkWarning[]): DiagramInfo {
  const firstLine = (token.map?.[0] ?? 0) + 1;
  const wording = diagramWording(kind, translate);
  const nodes = NODE_DIAGRAMS.find((d) => d.kind === kind)?.parse(token.content, firstLine);
  const { messages, markerLine, legacyMarkerLine }: { messages: LinkedMessage[]; markerLine?: number; legacyMarkerLine?: number } = nodes
    ? { messages: nodes.nodes, markerLine: nodes.markerLine, legacyMarkerLine: nodes.legacyMarkerLine }
    : parseSequence(token.content, firstLine);
  if (legacyMarkerLine !== undefined) {
    warnings.push({ line: legacyMarkerLine, message: translate('"%% @seq-notes" is no longer supported. Write "%% @link-headings" instead.') });
  }
  if (markerLine === undefined) {
    for (const m of messages.filter((m) => m.ref !== undefined)) {
      warnings.push({ line: m.refLine ?? m.line, message: wording.refWithoutMarker });
    }
  } else if (token.level !== 0) {
    warnings.push({ line: markerLine, message: wording.markerNotTopLevel });
  }
  const paired = markerLine !== undefined && token.level === 0;
  const stacked = nodes?.horizontal ?? false;
  return { id, kind, fenceIndex: index, rangeEnd: index + 1, messages, unlinkedHeadings: [], headings: [], paired, stacked, rows: [] };
}

/**
 * A diagram of the wireframe token `token`, with a part (node) per number of its `data-item`s, and the problems of its
 * file and options. The parts are written in its file, so they have the line of the wireframe.
 */
function wireframeDiagram(token: Token, index: number, id: number, translate: Translate, warnings: LinkWarning[]): DiagramInfo {
  const { src, options, file } = wireframeOf(token)!;
  const line = token.map?.[0] ?? 0;
  const messages: LinkedMessage[] = [];
  if (file === null) {
    warnings.push({ line, message: translate('The wireframe "{0}" could not be read.', sourcePath(src)) });
  }
  for (const part of file ? wireframeParts(file.html) : []) {
    const number = partNumber(part.item);
    if (number === undefined) {
      warnings.push({ line, message: translate('data-item "{0}" of the wireframe "{1}" is not a number.', part.item, sourcePath(src)) });
    } else if (!messages.some((m) => m.nodeId === String(number))) {
      // Several elements with a number are one part: e.g. the options of a radio button.
      messages.push({ index: messages.length, line, text: String(number), nodeId: String(number), ...(part.ref !== undefined ? { ref: part.ref } : {}) });
    }
  }
  if (options.linkHeadings && token.level !== 0) {
    warnings.push({ line: options.line ?? line, message: diagramWording('wireframe', translate).markerNotTopLevel });
  }
  const paired = options.linkHeadings && token.level === 0;
  return { id, kind: 'wireframe', fenceIndex: index, rangeEnd: index + 1, messages, unlinkedHeadings: [], headings: [], paired, stacked: options.stacked, rows: [] };
}

/**
 * Finds the diagrams whose items can be linked and resolves the arrow / node → heading links of the ones
 * marked with `%% @link-headings` (or the option `link-headings` of a wireframe). Headings must already carry an `id` attribute.
 *
 * Only top-level (level 0) fences are paired, so the overview range always
 * starts and ends on a top-level block boundary and can be rendered on its own.
 */
export function linkDiagrams(tokens: Token[], translate: Translate = formatMessage): LinkResult {
  const warnings: LinkWarning[] = [...wireframeWarnings(tokens)];

  const diagrams: DiagramInfo[] = [];
  tokens.forEach((token, index) => {
    const kind = diagramKind(token);
    if (kind) {
      diagrams.push(mermaidDiagram(token, index, kind, diagrams.length, translate, warnings));
    } else if (wireframeOf(token)) {
      diagrams.push(wireframeDiagram(token, index, diagrams.length, translate, warnings));
    }
  });

  const pairedFences = new Set(diagrams.filter((d) => d.paired).map((d) => d.fenceIndex));

  for (const token of tokens) {
    if (token.level === 0 && token.type === 'html_block' && LEGACY_END_MARKER_RE.test(token.content)) {
      warnings.push({
        line: token.map?.[0] ?? 0,
        message: translate('"<!-- seq-notes:end -->" is no longer supported. Write "<!-- link-headings:end -->" instead.'),
      });
    }
  }

  for (const diagram of diagrams.filter((d) => d.paired)) {
    const index = diagram.fenceIndex;
    let end = index + 1;
    while (end < tokens.length) {
      const t = tokens[end];
      if (
        pairedFences.has(end) ||
        (t.level === 0 && t.type === 'html_block' && END_MARKER_RE.test(t.content)) ||
        // The footnotes gathered at the end of the document are not part of the steps.
        t.type === 'footnote_block_open'
      ) {
        break;
      }
      end++;
    }
    diagram.rangeEnd = end;

    const headings = new Map<string, string>();
    // Numbered headings (`3. Fetch user`) by their text without the number, used when no heading matches exactly.
    const numberedHeadings = new Map<string, string[]>();
    const steps = new Map<string, StepNumber>();
    const headingTokens = diagram.headings;
    for (let i = index + 1; i < end; i++) {
      const t = tokens[i];
      const id = t.type === 'heading_open' ? t.attrGet('id') : null;
      if (id) {
        // Headings inside lists or blockquotes are not steps of the overview.
        const key = normalizeLabel(headingText(tokens[i + 1]));
        if (t.level === 0) {
          headingTokens.push({ index: i, id: String(id), level: Number(t.tag.slice(1)), line: t.map?.[0] ?? 0, text: key, refTarget: !headings.has(key) });
        }
        if (!headings.has(key)) {
          headings.set(key, String(id));
        }
        const step = stripStepNumber(key);
        if (step) {
          steps.set(String(id), step);
          numberedHeadings.set(step.text, [...(numberedHeadings.get(step.text) ?? []), String(id)]);
        }
      }
    }

    const wording = diagramWording(diagram.kind, translate);
    if (diagram.kind === 'wireframe') {
      linkParts(diagram, tokens, headings, steps, wording, warnings);
    } else {
      for (const message of diagram.messages) {
        const label = normalizeLabel(message.ref ?? message.text);
        const number = message.number;
        // Compared as numbers, so that `01.` matches arrow 1.
        const numbered = numberedHeadings.get(label) ?? [];
        const target = headings.get(label) ?? numbered.find((id) => Number(steps.get(id)!.value) === number) ?? numbered[0];
        if (target) {
          message.target = target;
          const step = steps.get(target);
          if (step && number !== undefined) {
            message.numberInHeading = Number(step.value) === number;
          }
        } else if (message.ref !== undefined) {
          warnings.push({ line: message.refLine ?? message.line, message: wording.refNotFound(message.ref) });
        }
      }
    }

    const targets = new Set(diagram.messages.map((m) => m.target).filter((t) => t !== undefined));
    if (targets.size === 0) {
      continue;
    }
    // A flowchart node without a label is not a step, like an arrow without a label.
    for (const message of diagram.messages.filter((m) => !m.target && m.labeled !== false)) {
      message.unlinked = true;
    }
    for (const row of diagram.rows.filter((r) => !r.target)) {
      row.unlinked = true;
    }
    const level = stepLevel(headingTokens.filter((h) => targets.has(h.id)).map((h) => h.level));
    diagram.stepLevel = level;
    diagram.unlinkedHeadings = headingTokens.filter((h) => h.level === level && !targets.has(h.id)).map((h) => h.index);
  }

  warnings.sort((a, b) => a.line - b.line);
  return { diagrams, warnings };
}

/**
 * Links the parts of a wireframe to the headings of its overview range numbered like them (or to the heading of their
 * `data-ref`), and to the rows of its item tables with their numbers. A part linked to rows only gets a target of its own,
 * which the rows share.
 */
function linkParts(
  diagram: DiagramInfo,
  tokens: Token[],
  headings: Map<string, string>,
  steps: Map<string, StepNumber>,
  wording: LinkWording,
  warnings: LinkWarning[],
): void {
  // The first heading of the range with each number.
  const numbered = new Map<number, string>();
  for (const [id, step] of steps) {
    const number = Number(step.value);
    if (!numbered.has(number)) {
      numbered.set(number, id);
    }
  }
  const parts = new Map(diagram.messages.map((m) => [Number(m.nodeId), m]));
  for (const [number, part] of parts) {
    if (part.ref === undefined) {
      part.target = numbered.get(number);
      continue;
    }
    part.target = headings.get(normalizeLabel(part.ref));
    if (part.target === undefined) {
      warnings.push({ line: part.line, message: wording.refNotFound(part.ref) });
    }
  }
  diagram.rows = itemRows(tokens, diagram.fenceIndex + 1, diagram.rangeEnd);
  for (const row of diagram.rows) {
    const number = partNumber(row.item);
    const part = number === undefined ? undefined : parts.get(number);
    if (part) {
      part.target ??= `seqnotes-part-${diagram.id}-${number}`;
      row.target = part.target;
    }
  }
}

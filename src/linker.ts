import type { Token } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import { isFlowchart, parseFlowchart } from './flowchart';
import { isSequenceDiagram, normalizeLabel, parseSequence, stripStepNumber, type SequenceMessage, type StepNumber } from './sequence';

export const END_MARKER_RE = /^\s*<!--\s*link-headings:end\s*-->\s*$/;

/** The end marker before it was renamed. No longer recognized, only reported. */
const LEGACY_END_MARKER_RE = /^\s*<!--\s*seq-notes:end\s*-->\s*$/;

/** Diagrams whose items can be linked to headings: the arrows of a sequence diagram, the nodes of a flowchart. */
export type DiagramKind = 'sequence' | 'flowchart';

/** An arrow of a sequence diagram or a node of a flowchart. */
export interface LinkedMessage extends SequenceMessage {
  /** Node id (flowcharts only). */
  nodeId?: string;
  /** false for a flowchart node without a label of its own. */
  labeled?: boolean;
  /** false for a flowchart node that a `%% @ref` above its line would not go to (another node on the line gets it). */
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

export interface DiagramInfo {
  /** Sequential number of the linkable diagram in the document. */
  id: number;
  kind: DiagramKind;
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
  /** true when the overview is always put below the diagram instead of beside it (a horizontal flowchart). */
  stacked: boolean;
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
export function diagramKind(token: Token): DiagramKind | undefined {
  if (!isMermaidFence(token)) {
    return undefined;
  }
  if (isSequenceDiagram(token.content)) {
    return 'sequence';
  }
  return isFlowchart(token.content) ? 'flowchart' : undefined;
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

/**
 * Finds sequence diagrams and flowcharts and resolves the arrow / node → heading links of the ones
 * marked with `%% @link-headings`. Headings must already carry an `id` attribute.
 *
 * Only top-level (level 0) fences are paired, so the overview range always
 * starts and ends on a top-level block boundary and can be rendered on its own.
 */
export function linkDiagrams(tokens: Token[], translate: Translate = formatMessage): LinkResult {
  const warnings: LinkWarning[] = [];

  const diagrams: DiagramInfo[] = tokens
    .map((token, index) => ({ token, index, kind: diagramKind(token) }))
    .filter((d): d is { token: Token; index: number; kind: DiagramKind } => d.kind !== undefined)
    .map(({ token, index, kind }, id) => {
      const firstLine = (token.map?.[0] ?? 0) + 1;
      const flowchart = kind === 'flowchart' ? parseFlowchart(token.content, firstLine) : undefined;
      const { messages, markerLine, legacyMarkerLine }: { messages: LinkedMessage[]; markerLine?: number; legacyMarkerLine?: number } = flowchart
        ? { messages: flowchart.nodes, markerLine: flowchart.markerLine, legacyMarkerLine: flowchart.legacyMarkerLine }
        : parseSequence(token.content, firstLine);
      if (legacyMarkerLine !== undefined) {
        warnings.push({ line: legacyMarkerLine, message: translate('"%% @seq-notes" is no longer supported. Write "%% @link-headings" instead.') });
      }
      if (markerLine === undefined) {
        for (const m of messages.filter((m) => m.ref !== undefined)) {
          warnings.push({
            line: m.refLine ?? m.line,
            message: flowchart
              ? translate('@ref is ignored because the flowchart has no "%% @link-headings" marker.')
              : translate('@ref is ignored because the sequence diagram has no "%% @link-headings" marker.'),
          });
        }
      } else if (token.level !== 0) {
        warnings.push({
          line: markerLine,
          message: flowchart
            ? translate('@link-headings is ignored for a flowchart inside a list or blockquote.')
            : translate('@link-headings is ignored for a sequence diagram inside a list or blockquote.'),
        });
      }
      const paired = markerLine !== undefined && token.level === 0;
      const stacked = flowchart?.horizontal ?? false;
      const diagram: DiagramInfo = { id, kind, fenceIndex: index, rangeEnd: index + 1, messages, unlinkedHeadings: [], headings: [], paired, stacked };
      return diagram;
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
      if (pairedFences.has(end) || (t.level === 0 && t.type === 'html_block' && END_MARKER_RE.test(t.content))) {
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
        warnings.push({
          line: message.refLine ?? message.line,
          message:
            diagram.kind === 'flowchart'
              ? translate('@ref target heading "{0}" was not found after the flowchart.', message.ref)
              : translate('@ref target heading "{0}" was not found after the sequence diagram.', message.ref),
        });
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
    const level = stepLevel(headingTokens.filter((h) => targets.has(h.id)).map((h) => h.level));
    diagram.stepLevel = level;
    diagram.unlinkedHeadings = headingTokens.filter((h) => h.level === level && !targets.has(h.id)).map((h) => h.index);
  }

  warnings.sort((a, b) => a.line - b.line);
  return { diagrams, warnings };
}

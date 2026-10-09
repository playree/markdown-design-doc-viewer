import type { Token } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import { isSequenceDiagram, normalizeLabel, parseSequence, stripStepNumber, type SequenceMessage, type StepNumber } from './sequence';

export const END_MARKER_RE = /^\s*<!--\s*seq-notes:end\s*-->\s*$/;

export interface LinkedMessage extends SequenceMessage {
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
}

export interface DiagramInfo {
  /** Sequential number of the sequence diagram in the document. */
  id: number;
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
  /** true when the diagram has a `%% @seq-notes` marker and is top-level, so it is laid out side by side. */
  paired: boolean;
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

function isSequenceFence(token: Token): boolean {
  return isMermaidFence(token) && isSequenceDiagram(token.content);
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
 * Finds sequence diagrams and resolves the message → heading links of the ones
 * marked with `%% @seq-notes`. Headings must already carry an `id` attribute.
 *
 * Only top-level (level 0) fences are paired, so the overview range always
 * starts and ends on a top-level block boundary and can be rendered on its own.
 */
export function linkDiagrams(tokens: Token[], translate: Translate = formatMessage): LinkResult {
  const warnings: LinkWarning[] = [];

  const diagrams: DiagramInfo[] = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => isSequenceFence(token))
    .map(({ token, index }, id) => {
      const { messages, markerLine } = parseSequence(token.content, (token.map?.[0] ?? 0) + 1);
      if (markerLine === undefined) {
        for (const m of messages.filter((m) => m.ref !== undefined)) {
          warnings.push({
            line: m.refLine ?? m.line,
            message: translate('@ref is ignored because the sequence diagram has no "%% @seq-notes" marker.'),
          });
        }
      } else if (token.level !== 0) {
        warnings.push({
          line: markerLine,
          message: translate('@seq-notes is ignored for a sequence diagram inside a list or blockquote.'),
        });
      }
      const paired = markerLine !== undefined && token.level === 0;
      const diagram: DiagramInfo = { id, fenceIndex: index, rangeEnd: index + 1, messages, unlinkedHeadings: [], headings: [], paired };
      return diagram;
    });

  const pairedFences = new Set(diagrams.filter((d) => d.paired).map((d) => d.fenceIndex));

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
          headingTokens.push({ index: i, id: String(id), level: Number(t.tag.slice(1)), line: t.map?.[0] ?? 0, text: key });
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
          message: translate('@ref target heading "{0}" was not found after the sequence diagram.', message.ref),
        });
      }
    }

    const targets = new Set(diagram.messages.map((m) => m.target).filter((t) => t !== undefined));
    if (targets.size === 0) {
      continue;
    }
    for (const message of diagram.messages.filter((m) => !m.target)) {
      message.unlinked = true;
    }
    const level = stepLevel(headingTokens.filter((h) => targets.has(h.id)).map((h) => h.level));
    diagram.stepLevel = level;
    diagram.unlinkedHeadings = headingTokens.filter((h) => h.level === level && !targets.has(h.id)).map((h) => h.index);
  }

  warnings.sort((a, b) => a.line - b.line);
  return { diagrams, warnings };
}

import type { MarkdownIt } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import { diagramKind, linkDiagrams, type DiagramInfo, type DiagramKind, type LinkedMessage, type OverviewHeading } from './linker';
import { normalizeLabel } from './sequence';

/** A 0-based position in the Markdown document. */
export interface Position {
  line: number;
  character: number;
}

export interface TextEdit {
  start: Position;
  end: Position;
  text: string;
}

export interface QuickFix {
  title: string;
  edit: TextEdit;
}

export interface RefCandidate {
  /** Heading text to write after `@ref`. */
  text: string;
  /** true when an arrow (node) of the diagram is already linked to the heading. */
  linked: boolean;
}

export interface RefCandidates {
  /** Kind of the diagram the `@ref` is in. */
  kind: DiagramKind;
  candidates: RefCandidate[];
}

/** true when `line` is a content line of the fence whose source lines are [start, end). */
function inFence(lines: string[], map: [number, number] | null, line: number): boolean {
  if (!map || line <= map[0] || line >= map[1]) {
    return false;
  }
  // The closing fence, if there is one, is the last line of the map.
  return !(line === map[1] - 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[line]));
}

/**
 * The kind of the diagram `line` is inside, when it is a sequence diagram or a flowchart,
 * where `%% @link-headings` and `%% @ref` can be written.
 */
export function linkableDiagramAt(md: MarkdownIt, source: string, line: number): DiagramKind | undefined {
  const lines = source.split(/\r?\n/);
  const fence = md.parse(source, {}).find((t) => diagramKind(t) !== undefined && inFence(lines, t.map, line));
  return fence && diagramKind(fence);
}

/**
 * The headings a `%% @ref` on `line` can link to: the headings of the overview of the paired diagram
 * containing the line, those no arrow is linked to first. Undefined when the line is not in a paired diagram.
 */
export function refCandidates(md: MarkdownIt, source: string, line: number): RefCandidates | undefined {
  const lines = source.split(/\r?\n/);
  const tokens = md.parse(source, {});
  const diagram = linkDiagrams(tokens).diagrams.find((d) => d.paired && inFence(lines, tokens[d.fenceIndex].map, line));
  if (!diagram) {
    return undefined;
  }
  const targets = new Set(diagram.messages.map((m) => m.target));
  // A heading with the text of an earlier one cannot be written as a `@ref`.
  const candidates = diagram.headings.filter((h) => h.text !== '' && h.refTarget).map((h) => ({ text: h.text, linked: targets.has(h.id) }));
  return { kind: diagram.kind, candidates: [...candidates.filter((c) => !c.linked), ...candidates.filter((c) => c.linked)] };
}

const indentOf = (line: string): string => /^\s*/.exec(line)![0];

/** Headings an unlinked arrow can be linked to: the unlinked steps, or any heading when nothing is linked yet. */
function linkableHeadings(diagram: DiagramInfo): OverviewHeading[] {
  const headings = diagram.stepLevel === undefined ? diagram.headings : diagram.headings.filter((h) => diagram.unlinkedHeadings.includes(h.index));
  return headings.filter((h) => h.text !== '' && h.refTarget);
}

/** Links `message` to `heading` by rewriting its `%% @ref`, or by writing one above it. */
function linkFix(lines: string[], message: LinkedMessage, heading: string, title: string): QuickFix {
  if (message.refLine !== undefined) {
    const line = message.refLine;
    return {
      title,
      edit: { start: { line, character: 0 }, end: { line, character: lines[line].length }, text: `${indentOf(lines[line])}%% @ref ${heading}` },
    };
  }
  const position = { line: message.line, character: 0 };
  return { title, edit: { start: position, end: position, text: `${indentOf(lines[message.line])}%% @ref ${heading}\n` } };
}

/**
 * Adds a step heading for `message` to the overview: after the steps of the earlier arrows, before the next
 * step or the heading above the steps that follows them, or at the end of the overview.
 */
function addHeadingFix(lines: string[], tokens: ReturnType<MarkdownIt['parse']>, diagram: DiagramInfo, message: LinkedMessage, t: Translate): QuickFix | undefined {
  const level = diagram.stepLevel;
  const text = normalizeLabel(message.ref ?? message.text);
  if (level === undefined || text === '') {
    return undefined;
  }
  // Only the steps: an `@ref` to e.g. a parent heading does not tell where the step goes.
  const lineOf = new Map(diagram.headings.filter((h) => h.level === level).map((h) => [h.id, h.line]));
  const earlier = diagram.messages.filter((m) => m.index < message.index && m.target !== undefined).map((m) => lineOf.get(m.target!) ?? -1);
  const after = Math.max(-1, ...earlier);
  // The next step, or else the heading above the steps that ends them.
  const next = diagram.headings.find((h) => h.line > after && h.level === level) ?? diagram.headings.find((h) => h.line > after && h.level < level);
  const heading = `${'#'.repeat(level)} ${text}`;
  const title = t('Add heading "{0}" to the overview', text);

  const line = next?.line ?? tokens[diagram.rangeEnd]?.map?.[0];
  if (line !== undefined) {
    const blankBefore = line === 0 || lines[line - 1].trim() === '';
    const position = { line, character: 0 };
    return { title, edit: { start: position, end: position, text: `${blankBefore ? '' : '\n'}${heading}\n\n` } };
  }
  // At the end of the document.
  const last = lines.length - 1;
  const endsWithNewline = lines[last] === '';
  const lastText = endsWithNewline ? lines[last - 1] : lines[last];
  const position = { line: last, character: lines[last].length };
  return { title, edit: { start: position, end: position, text: `${endsWithNewline ? '' : '\n'}${lastText?.trim() ? '\n' : ''}${heading}\n` } };
}

/**
 * Fixes for the link problems reported on `line` by `collectIssues`: an arrow without a heading,
 * a `%% @ref` to a missing heading and a step heading without an arrow.
 */
export function quickFixes(md: MarkdownIt, source: string, line: number, t: Translate = formatMessage): QuickFix[] {
  return quickFixesByLine(md, source, [line], t).get(line) ?? [];
}

/** `quickFixes` for several lines, parsing the document once. */
export function quickFixesByLine(md: MarkdownIt, source: string, lines: number[], t: Translate = formatMessage): Map<number, QuickFix[]> {
  const sourceLines = source.split(/\r?\n/);
  const tokens = md.parse(source, {});
  const diagrams = linkDiagrams(tokens, t).diagrams.filter((d) => d.paired);
  return new Map(lines.map((line) => [line, fixesAt(sourceLines, tokens, diagrams, line, t)]));
}

/** false for a flowchart node whose `%% @ref`, written above its line, would go to another node of the line. */
const canWriteRef = (message: LinkedMessage): boolean => message.refLine !== undefined || message.refable !== false;

function fixesAt(lines: string[], tokens: ReturnType<MarkdownIt['parse']>, diagrams: DiagramInfo[], line: number, t: Translate): QuickFix[] {
  const fixes: QuickFix[] = [];
  for (const diagram of diagrams) {
    // Arrows / nodes without a heading, or the `@ref` of one. A flowchart line may define several nodes.
    const messages = diagram.messages.filter((m) => !m.target && (m.refLine === line || (m.line === line && (m.unlinked || m.ref !== undefined))));
    for (const message of messages) {
      for (const heading of canWriteRef(message) ? linkableHeadings(diagram) : []) {
        const title = message.ref !== undefined ? t('Change @ref to heading "{0}"', heading.text) : t('Link to heading "{0}" with @ref', heading.text);
        fixes.push(linkFix(lines, message, heading.text, title));
      }
      const add = addHeadingFix(lines, tokens, diagram, message, t);
      if (add) {
        fixes.push(add);
      }
    }

    // A step heading without an arrow.
    const step = diagram.headings.find((h) => h.line === line && diagram.unlinkedHeadings.includes(h.index));
    if (step && step.text !== '' && step.refTarget) {
      for (const m of diagram.messages.filter((m) => m.unlinked && canWriteRef(m))) {
        const label = normalizeLabel(m.text) || `#${m.index + 1}`;
        const title = diagram.kind === 'flowchart' ? t('Link node "{0}" to this heading with @ref', label) : t('Link arrow "{0}" to this heading with @ref', label);
        fixes.push(linkFix(lines, m, step.text, title));
      }
    }
  }
  return fixes;
}

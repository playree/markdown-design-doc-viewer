/**
 * Minimal parser for mermaid `sequenceDiagram` sources.
 * Only extracts what the preview needs: the messages (arrows) in drawing order,
 * their source line and `autonumber` number, any `%% @ref <heading>` directive
 * attached to them and the `%% @seq-notes` marker that opts the diagram into the side-by-side layout.
 */

export interface SequenceMessage {
  /** Drawing order (0-based) among all messages in the diagram. */
  index: number;
  /** 0-based line in the Markdown document. */
  line: number;
  /** Message label as written after the colon. */
  text: string;
  /** Heading text given by a preceding `%% @ref` comment. */
  ref?: string;
  /** 0-based line of the `%% @ref` comment. */
  refLine?: number;
  /** Number drawn by `autonumber`, if numbering is on for this message. */
  number?: number;
}

export interface ParsedSequence {
  messages: SequenceMessage[];
  /** 0-based document line of the `%% @seq-notes` marker, if present. */
  markerLine?: number;
}

// Longest tokens first so that e.g. `-->>` is not read as `-->` + `>`.
const ARROWS = [
  '<<-->>', '<<->>', '-->>', '->>', '-->', '->',
  '--x', '-x', '--)', '-)',
  '--|\\', '--|/', '--\\\\', '--//', '/|--', '\\|--', '//--', '\\\\--',
  '-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-',
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const MESSAGE_RE = new RegExp(
  '^\\s*([^:]+?)\\s*(?:\\(\\))?(' + ARROWS.map(escapeRegExp).join('|') + ')(?:\\(\\))?\\s*[+-]?\\s*([^:]+?)\\s*:(.*)$',
);

const REF_RE = /^\s*%%\s*@ref\s+(.+?)\s*$/;

const SEQ_NOTES_RE = /^\s*%%\s*@seq-notes\s*$/;

// Numbers as mermaid's lexer reads them: up to two decimals.
const NUM = '(\\d+(?:\\.\\d{1,2})?|\\.\\d{1,2})';
// mermaid's lexer drops trailing `%%` and `#` comments.
const AUTONUMBER_RE = new RegExp(`^\\s*autonumber(?:\\s+(off)|\\s+${NUM}(?:\\s+${NUM})?)?\\s*(?:(?:%%|#).*)?$`, 'i');

// A keyword must be followed by whitespace or the line end, so that participants
// named e.g. `Link` or `End` (`Link->>API: ...`) are still read as messages.
const NON_MESSAGE_KEYWORDS = /^\s*(note|participant|actor|create|destroy|alt|else|opt|loop|par|and|critical|option|break|rect|box|end|activate|deactivate|autonumber|link|links|properties|details|title|accTitle|accDescr)(?=\s|$)/i;

/** Index of the first line after a leading `---` YAML frontmatter block (0 if there is none). */
function skipFrontmatter(lines: string[]): number {
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0 || lines[first].trim() !== '---') {
    return 0;
  }
  const close = lines.findIndex((line, i) => i > first && line.trim() === '---');
  return close < 0 ? lines.length : close + 1;
}

export function isSequenceDiagram(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (const raw of lines.slice(skipFrontmatter(lines))) {
    const line = raw.trim();
    if (line === '' || line.startsWith('%%')) {
      continue;
    }
    return /^sequenceDiagram\b/.test(line);
  }
  return false;
}

/**
 * @param source  fence content (without the ``` lines)
 * @param firstLine  0-based document line of the first content line
 */
export function parseSequence(source: string, firstLine: number): ParsedSequence {
  const messages: SequenceMessage[] = [];
  let markerLine: number | undefined;
  let pendingRef: { text: string; line: number } | undefined;
  // Same as mermaid's sequenceRenderer: every message advances the counter, even while numbering is off.
  let sequenceIndex = 1;
  let sequenceStep = 1;
  let numbering = false;

  const lines = source.split(/\r?\n/);
  const start = skipFrontmatter(lines);
  lines.forEach((raw, i) => {
    if (i < start) {
      return;
    }
    if (SEQ_NOTES_RE.test(raw)) {
      markerLine ??= firstLine + i;
      return;
    }
    const ref = REF_RE.exec(raw);
    if (ref) {
      pendingRef = { text: ref[1], line: firstLine + i };
      return;
    }
    const autonumber = AUTONUMBER_RE.exec(raw);
    if (autonumber) {
      // mermaid keeps the previous value for 0 (`start || sequenceIndex`).
      sequenceIndex = Number(autonumber[2] ?? 0) || sequenceIndex;
      sequenceStep = Number(autonumber[3] ?? 0) || sequenceStep;
      numbering = autonumber[1] === undefined;
      return;
    }
    if (raw.trim().startsWith('%%') || NON_MESSAGE_KEYWORDS.test(raw)) {
      return;
    }
    const m = MESSAGE_RE.exec(raw);
    if (!m) {
      return;
    }
    const message: SequenceMessage = { index: messages.length, line: firstLine + i, text: m[4].trim() };
    if (numbering) {
      message.number = sequenceIndex;
    }
    sequenceIndex = Math.round((sequenceIndex + sequenceStep) * 100) / 100;
    if (pendingRef) {
      message.ref = pendingRef.text;
      message.refLine = pendingRef.line;
      pendingRef = undefined;
    }
    messages.push(message);
  });

  return { messages, markerLine };
}

/** Normalizes label/heading text for comparison. */
export function normalizeLabel(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export interface StepNumber {
  /** Heading text without the number. */
  text: string;
  /** The number as written, with ASCII digits (`3`, `1.2`). */
  value: string;
}

const STEP_NUMBER_RES = [
  // `3.` `3)` `1.2.` `3．` `3）` (a dot directly before a digit is a decimal, not a separator)
  /^(\d+(?:\.\d+)*)[.)．）](?!\d)\s*(.+)$/,
  // `1.2.3 `
  /^(\d+(?:\.\d+)+)\s+(.+)$/,
  // `(3)` `（3）`
  /^[(（](\d+)[)）]\s*(.+)$/,
];

/** Splits a leading step number like `3.` off a heading. Labels such as `200 OK` are not numbered. */
export function stripStepNumber(heading: string): StepNumber | undefined {
  const text = heading.trim();
  // Full-width digits keep the string length, so the match positions apply to `text` as well.
  const ascii = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  for (const re of STEP_NUMBER_RES) {
    const m = re.exec(ascii);
    if (m) {
      return { text: text.slice(ascii.length - m[2].length), value: m[1] };
    }
  }
  // `①`–`⑳`
  const circled = /^([\u2460-\u2473])\s*(.+)$/.exec(text);
  if (circled) {
    return { text: circled[2], value: String(circled[1].charCodeAt(0) - 0x2460 + 1) };
  }
  return undefined;
}

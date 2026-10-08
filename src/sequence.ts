/**
 * Minimal parser for mermaid `sequenceDiagram` sources.
 * Only extracts what the preview needs: the messages (arrows) in drawing order,
 * their source line and any `%% @ref <heading>` directive attached to them.
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
export function parseSequence(source: string, firstLine: number): SequenceMessage[] {
  const messages: SequenceMessage[] = [];
  let pendingRef: { text: string; line: number } | undefined;

  const lines = source.split(/\r?\n/);
  const start = skipFrontmatter(lines);
  lines.forEach((raw, i) => {
    if (i < start) {
      return;
    }
    const ref = REF_RE.exec(raw);
    if (ref) {
      pendingRef = { text: ref[1], line: firstLine + i };
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
    if (pendingRef) {
      message.ref = pendingRef.text;
      message.refLine = pendingRef.line;
      pendingRef = undefined;
    }
    messages.push(message);
  });

  return messages;
}

/** Normalizes label/heading text for comparison. */
export function normalizeLabel(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

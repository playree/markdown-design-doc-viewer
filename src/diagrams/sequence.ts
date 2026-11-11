/**
 * Minimal parser for mermaid `sequenceDiagram` sources.
 * Only extracts what the preview needs: the messages (arrows) in drawing order,
 * their source line and `autonumber` number, any `%% @ref <heading>` directive
 * attached to them and the `%% @link-headings` marker that opts the diagram into the side-by-side layout.
 * Also the notes that label a place of the diagram (`Note over A: Ⓒ`, `else Ⓒ Error`, `%% @anchor`) and the notes that
 * jump to such a label (`Note over A: … → Ⓒ`, `%% @goto`).
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

export interface SequenceNote {
  /** Drawing order (0-based) among all notes in the diagram. */
  index: number;
  /** 0-based line in the Markdown document. */
  line: number;
  /** Note text as written after the colon. */
  text: string;
  /** The label the note defines: its text is only a label (`Ⓒ`), or it follows `%% @anchor`. */
  anchor?: string;
  /** The label the note jumps to: one defined in the diagram that its text has, or the one of a `%% @goto` above it. */
  goto?: string;
  /** 0-based line of the `%% @goto` above the note. */
  gotoLine?: number;
}

/** A label of a place of the diagram, which notes can jump to. */
export interface SequenceAnchor {
  name: string;
  /** 0-based line of the note or of the line of the block (`else Ⓒ Error`) that defines it. */
  line: number;
  /** 0-based line of the `%% @anchor` that names it. */
  markerLine?: number;
  /** Index of the note that defines it. Without it, a section of a block (`alt` / `else` / …) defines it. */
  note?: number;
  /** The condition of the section of a block that defines it, as written (`Ⓒ Error`). */
  title?: string;
  /** The number of sections before it with the same condition (compared by `compactLabel`), to tell them apart. */
  occurrence?: number;
  /** Index of the first message after the label. */
  firstMessage: number;
  /** Index after the last message of the section (or diagram) of the label. */
  endMessage: number;
}

/**
 * A `%% @anchor` or `%% @goto` directive that applies to nothing: the next line is not a note (or a block section), or
 * (`gotoOnLabel`) the note of the `%% @goto` is made a label by a `%% @anchor`.
 */
export interface StrayNoteDirective {
  line: number;
  directive: 'anchor' | 'goto' | 'gotoOnLabel';
}

export interface ParsedSequence {
  messages: SequenceMessage[];
  notes: SequenceNote[];
  /** In source order; a name may be defined more than once, of which the first is used. */
  anchors: SequenceAnchor[];
  /** The `%% @anchor` / `%% @goto` directives that apply to nothing. */
  strayDirectives: StrayNoteDirective[];
  /** 0-based document line of the `%% @link-headings` marker, if present. */
  markerLine?: number;
  /** 0-based document line of an old `%% @seq-notes` marker, if present. */
  legacyMarkerLine?: number;
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

export const REF_RE = /^\s*%%\s*@ref\s+(.+?)\s*$/;

export const LINK_HEADINGS_RE = /^\s*%%\s*@link-headings\s*$/;

export const ANCHOR_RE = /^\s*%%\s*@anchor\s+(.+?)\s*$/;

export const GOTO_RE = /^\s*%%\s*@goto\s+(.+?)\s*$/;

/** A note: `Note over A: text`, `Note right of A: text`, `Note over A,B: text`. */
const NOTE_RE = /^\s*note\s+(?:left\s+of|right\s+of|over)\s+[^:]+:(.*)$/i;

/** The lines that open a block (ended by `end`), and those that start another section of one, with their condition. */
const BLOCK_OPEN_RE = /^\s*(alt|opt|loop|par|par_over|critical|break|rect|box)(?:\s+(.*?))?\s*$/i;
const BLOCK_SECTION_RE = /^\s*(else|and|option)(?:\s+(.*?))?\s*$/i;
const BLOCK_END_RE = /^\s*end\s*$/i;
/** Blocks whose condition is not a text of a section (a color, a group of participants). */
const UNLABELED_BLOCKS = new Set(['rect', 'box']);

/** The circled letters that label places of a diagram without a directive: `Ⓐ`–`Ⓩ`, `ⓐ`–`ⓩ`. */
const LABEL_CHARS = '\u24B6-\u24E9';
const LABEL_ONLY_RE = new RegExp(`^[${LABEL_CHARS}]$`);
const LEADING_LABEL_RE = new RegExp(`^([${LABEL_CHARS}])(?![${LABEL_CHARS}])`);
const LABEL_CHAR_RE = new RegExp(`[${LABEL_CHARS}]`, 'g');

/** The label a note's text defines by itself: a single circled letter (`Ⓒ`). */
export const labelOfNote = (text: string): string | undefined => {
  const label = normalizeLabel(text);
  return LABEL_ONLY_RE.test(label) ? label : undefined;
};

/** The label a block section's condition starts with (`Ⓒ Error`). */
export const labelOfCondition = (text: string): string | undefined => LEADING_LABEL_RE.exec(normalizeLabel(text))?.[1];

/** The circled letters of a text, in order. */
export const labelsIn = (text: string): string[] => text.match(LABEL_CHAR_RE) ?? [];

/** The marker before it was renamed to `@link-headings`. No longer recognized, only reported. */
export const LEGACY_MARKER_RE = /^\s*%%\s*@seq-notes\s*$/;

// Numbers as mermaid's lexer reads them: up to two decimals.
const NUM = '(\\d+(?:\\.\\d{1,2})?|\\.\\d{1,2})';
// mermaid's lexer drops trailing `%%` and `#` comments.
const AUTONUMBER_RE = new RegExp(`^\\s*autonumber(?:\\s+(off)|\\s+${NUM}(?:\\s+${NUM})?)?\\s*(?:(?:%%|#).*)?$`, 'i');

// A keyword must be followed by whitespace or the line end, so that participants
// named e.g. `Link` or `End` (`Link->>API: ...`) are still read as messages.
const NON_MESSAGE_KEYWORDS = /^\s*(note|participant|actor|create|destroy|alt|else|opt|loop|par|and|critical|option|break|rect|box|end|activate|deactivate|autonumber|link|links|properties|details|title|accTitle|accDescr)(?=\s|$)/i;

/** Index of the first line after a leading `---` YAML frontmatter block (0 if there is none). */
export function skipFrontmatter(lines: string[]): number {
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
  let legacyMarkerLine: number | undefined;
  let pendingRef: { text: string; line: number } | undefined;
  const notes: SequenceNote[] = [];
  const anchors: SequenceAnchor[] = [];
  const strayDirectives: StrayNoteDirective[] = [];
  let pendingAnchor: { name: string; line: number } | undefined;
  let pendingGoto: { name: string; line: number } | undefined;
  // The open blocks, each with the labels of its current section, whose end is that of the section; the first is the diagram.
  const blocks: SequenceAnchor[][] = [[]];
  const endSection = (): void => {
    for (const anchor of blocks[blocks.length - 1]) {
      anchor.endMessage = messages.length;
    }
    blocks[blocks.length - 1] = [];
  };
  /** Drops the pending `%% @anchor` / `%% @goto` that the current line does not take, as stray. */
  const dropPending = (takesAnchor: boolean, takesGoto: boolean): void => {
    if (pendingAnchor && !takesAnchor) {
      strayDirectives.push({ line: pendingAnchor.line, directive: 'anchor' });
      pendingAnchor = undefined;
    }
    if (pendingGoto && !takesGoto) {
      strayDirectives.push({ line: pendingGoto.line, directive: 'goto' });
      pendingGoto = undefined;
    }
  };
  /** The conditions of the sections so far (`compactLabel`), for `SequenceAnchor.occurrence`. */
  const conditions: string[] = [];
  /** Adds the label of a section that starts on `line`, if it has one. */
  const sectionLabel = (keyword: string, condition: string | undefined, line: number): void => {
    // mermaid draws no condition for a section without one, which then cannot be found in its drawing.
    const labeled = !UNLABELED_BLOCKS.has(keyword.toLowerCase()) && condition !== undefined && condition !== '';
    dropPending(labeled, false);
    if (!labeled) {
      return;
    }
    const key = compactLabel(condition);
    const occurrence = conditions.filter((c) => c === key).length;
    conditions.push(key);
    const name = pendingAnchor?.name ?? labelOfCondition(condition);
    if (name !== undefined) {
      const anchor: SequenceAnchor = { name, line, title: condition, occurrence, firstMessage: messages.length, endMessage: messages.length };
      if (pendingAnchor) {
        anchor.markerLine = pendingAnchor.line;
      }
      anchors.push(anchor);
      blocks[blocks.length - 1].push(anchor);
    }
    pendingAnchor = undefined;
  };
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
    const anchorDirective = ANCHOR_RE.exec(raw);
    if (anchorDirective) {
      dropPending(false, true);
      pendingAnchor = { name: normalizeLabel(anchorDirective[1]), line: firstLine + i };
      return;
    }
    const gotoDirective = GOTO_RE.exec(raw);
    if (gotoDirective) {
      dropPending(true, false);
      pendingGoto = { name: normalizeLabel(gotoDirective[1]), line: firstLine + i };
      return;
    }
    if (raw.trim() === '' || raw.trim().startsWith('%%')) {
      return;
    }
    const note = NOTE_RE.exec(raw);
    if (note) {
      const text = note[1].trim();
      const entry: SequenceNote = { index: notes.length, line: firstLine + i, text };
      // A `%% @goto` makes it a jump, even when its text is only a label.
      const name = pendingAnchor?.name ?? (pendingGoto ? undefined : labelOfNote(text));
      if (name !== undefined) {
        entry.anchor = name;
        const anchor: SequenceAnchor = { name, line: entry.line, note: entry.index, firstMessage: messages.length, endMessage: messages.length };
        if (pendingAnchor) {
          anchor.markerLine = pendingAnchor.line;
        }
        anchors.push(anchor);
        blocks[blocks.length - 1].push(anchor);
      }
      if (pendingGoto && entry.anchor !== undefined) {
        // A note is a label or a jump, not both.
        strayDirectives.push({ line: pendingGoto.line, directive: 'gotoOnLabel' });
      } else if (pendingGoto) {
        entry.goto = pendingGoto.name;
        entry.gotoLine = pendingGoto.line;
      }
      pendingAnchor = undefined;
      pendingGoto = undefined;
      notes.push(entry);
      return;
    }
    const open = BLOCK_OPEN_RE.exec(raw);
    if (open) {
      blocks.push([]);
      sectionLabel(open[1], open[2], firstLine + i);
      return;
    }
    const section = BLOCK_SECTION_RE.exec(raw);
    if (section) {
      endSection();
      sectionLabel(section[1], section[2], firstLine + i);
      return;
    }
    dropPending(false, false);
    if (BLOCK_END_RE.test(raw)) {
      endSection();
      if (blocks.length > 1) {
        blocks.pop();
      }
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
  dropPending(false, false);
  while (blocks.length > 0) {
    endSection();
    blocks.pop();
  }

  // Without a directive, a note jumps to the first label of its text that the diagram defines.
  const defined = new Set(anchors.map((a) => a.name));
  for (const note of notes) {
    if (note.goto === undefined && note.anchor === undefined) {
      const name = labelsIn(note.text).find((label) => defined.has(label));
      if (name !== undefined) {
        note.goto = name;
      }
    }
  }

  return { messages, notes, anchors, strayDirectives, markerLine, legacyMarkerLine };
}

/** A label without any whitespace: as mermaid draws it, which may break it into lines. */
export const compactLabel = (text: string): string => normalizeLabel(text).replace(/\s+/g, '');

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

/** Replaces the full-width digits (`１２`) with ASCII ones, keeping the length of the string. */
export const toAsciiDigits = (s: string): string => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** Splits a leading step number like `3.` off a heading. Labels such as `200 OK` are not numbered. */
export function stripStepNumber(heading: string): StepNumber | undefined {
  const text = heading.trim();
  // Full-width digits keep the string length, so the match positions apply to `text` as well.
  const ascii = toAsciiDigits(text);
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

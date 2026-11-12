/**
 * Breaks the long labels of the arrows of a sequence diagram into lines (`<br>`), before mermaid draws it: mermaid
 * widens the space between the participants to the width of a label, which makes the whole diagram smaller.
 * mermaid's own `wrap` is not used, as it wraps at the width of a participant's box, puts hyphens into Japanese
 * and wraps the participants and notes too.
 */
import { isSequenceDiagram, parseSequence } from './sequence';

/** The width (in half-width characters) that a label is broken at by default (`mdDesignDoc.messageWrapWidth`). */
export const DEFAULT_MESSAGE_WRAP_WIDTH = 30;

/** Whether a value is a width to break the labels at (0: not broken). */
export const isWrapWidth = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Characters as wide as two half-width ones: East Asian Wide and Fullwidth (CJK, kana, hangul, full-width forms). */
const WIDE_RE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

/** Characters that do not start a line (closing brackets, punctuation, small kana, the long vowel mark). */
const NO_START = new Set(Array.from('、。，．・：；？！ゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ）〕］｝〉》」』】〙〗〟’”｠»,.:;!?)]}'));

/** Characters that do not end a line (opening brackets). */
const NO_END = new Set(Array.from('（〔［｛〈《「『【〘〖〝‘“｟«([{'));

/**
 * Labels left as they are: those broken by the author (`<br>`) or with other HTML tags, entity codes (`#59;`),
 * comments, KaTeX, and those that mermaid wraps or does not (`wrap:` / `nowrap:`). A `<` that is not a tag
 * (`List<Item>`, `a < b`) does not keep a label.
 */
const KEEP_RE =
  /<\/?(?:a|b|big|br|code|del|div|em|font|i|ins|mark|p|s|small|span|strong|sub|sup|u)\b[^>]*>|#|;|%%|\$\$|^:?(?:no)?wrap:/i;

const charWidth = (c: string): number => (WIDE_RE.test(c) ? 2 : 1);

/** The width of a text, with the wide characters counted as 2. */
export const textWidth = (text: string): number => Array.from(text).reduce((sum, c) => sum + charWidth(c), 0);

/** Whether a line may break between `chars[i - 1]` and `chars[i]`: at spaces, after slashes and next to wide characters. */
function canBreakBefore(chars: string[], i: number): boolean {
  const before = chars[i - 1];
  const after = chars[i];
  if (before === ' ' || after === ' ') {
    return true;
  }
  if (NO_START.has(after) || NO_END.has(before)) {
    return false;
  }
  // After a slash of a path or a URL (`/orders/` | `{id}`), not between two (`https://`).
  if (before === '/' && after !== '/') {
    return true;
  }
  return WIDE_RE.test(before) || WIDE_RE.test(after);
}

/** Fills lines up to `limit` wide, breaking a word only when it does not fit in a line by itself. */
function fillLines(chars: string[], limit: number): string[] {
  const lines: string[] = [];
  let start = 0;
  while (start < chars.length) {
    while (chars[start] === ' ') {
      start++;
    }
    if (start >= chars.length) {
      break;
    }
    let width = 0;
    let end = start;
    let lastBreak = -1;
    while (end < chars.length) {
      if (end > start && canBreakBefore(chars, end)) {
        lastBreak = end;
      }
      const w = charWidth(chars[end]);
      if (end > start && width + w > limit) {
        break;
      }
      width += w;
      end++;
    }
    const cut = end < chars.length && lastBreak > start ? lastBreak : end;
    lines.push(chars.slice(start, cut).join('').trimEnd());
    start = cut;
  }
  return lines;
}

/**
 * The lines of a label at most `maxWidth` wide (a word longer than that is broken), with as many lines as it needs
 * and their lengths evened out: a label a little too long breaks in the middle, not after `maxWidth`.
 */
export function wrapLabel(text: string, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const total = textWidth(normalized);
  if (maxWidth <= 0 || total <= maxWidth) {
    return [normalized];
  }
  const chars = Array.from(normalized);
  const count = fillLines(chars, maxWidth).length;
  for (let limit = Math.ceil(total / count); limit < maxWidth; limit++) {
    const lines = fillLines(chars, limit);
    if (lines.length <= count) {
      return lines;
    }
  }
  return fillLines(chars, maxWidth);
}

/**
 * The mermaid source with the labels of the arrows of a sequence diagram broken into lines (`<br>`) at `maxWidth`
 * (0: not broken). The other diagrams, and the lines of the source, stay as they are.
 */
export function wrapSequenceMessages(source: string, maxWidth: number): string {
  if (!(maxWidth > 0) || !isSequenceDiagram(source)) {
    return source;
  }
  const { messages } = parseSequence(source, 0);
  // The same lines as parseSequence's (`\r?\n`), with the `\r` kept in them.
  const lines = source.split('\n');
  let changed = false;
  for (const { line } of messages) {
    const raw = lines[line];
    // The participants have no colon, so the label is after the first one.
    const colon = raw.indexOf(':');
    const label = raw.slice(colon + 1);
    const text = label.trim();
    if (KEEP_RE.test(text) || textWidth(text) <= maxWidth) {
      continue;
    }
    const lead = /^\s*/.exec(label)![0];
    const trail = /\s*$/.exec(label)![0];
    lines[line] = `${raw.slice(0, colon + 1)}${lead}${wrapLabel(text, maxWidth).join('<br>')}${trail}`;
    changed = true;
  }
  return changed ? lines.join('\n') : source;
}

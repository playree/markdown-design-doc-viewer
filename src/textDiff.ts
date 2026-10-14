/**
 * Word-level comparison of two texts, for the differences between a document and one of its revisions: whether two
 * blocks are alike (diffRender.ts), and which words of a changed block were added or removed (the webview).
 * No dependency on vscode or Node.
 */
import { diffArrays } from 'diff';

export type WordChange = { type: 'equal' | 'added' | 'removed'; tokens: string[] };

/** Runs of letters or digits, runs of spaces, and any other single character (CJK characters, punctuation). */
const WORD_RE = /[\p{L}\p{N}_]+|\s+|[^]/gu;
/** Scripts written without spaces, which only a segmenter splits into words. */
const UNSPACED_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** A segmenter into words, for the scripts written without spaces. undefined where `Intl.Segmenter` is missing. */
export function wordSegmenter(lang?: string): Intl.Segmenter | undefined {
  try {
    return typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(lang, { granularity: 'word' }) : undefined;
  } catch {
    return undefined;
  }
}

/** Splits a text into the units compared: words and spaces; a single character each in a text without spaces when there is no segmenter. */
export function splitWords(text: string, segmenter?: Intl.Segmenter): string[] {
  const words: string[] = [];
  for (const [word] of text.matchAll(WORD_RE)) {
    if (word.length > 1 && UNSPACED_RE.test(word)) {
      if (segmenter) {
        for (const { segment } of segmenter.segment(word)) {
          words.push(segment);
        }
      } else {
        words.push(...word);
      }
    } else {
      words.push(word);
    }
  }
  return words;
}

/** Beyond this many words added and removed, two texts are taken as different, rather than compared at length. */
export const MAX_EDIT_LENGTH = 2000;

/** The changes from the words `before` to the words `after`, in order. undefined when they differ in too many words. */
export function diffWordLists(before: string[], after: string[]): WordChange[] | undefined {
  return diffArrays(before, after, { maxEditLength: MAX_EDIT_LENGTH })?.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'equal',
    tokens: change.value,
  }));
}

/**
 * Joins the changes apart by spaces or a single character only, into the words removed then those added: a sentence
 * rewritten reads as the old one and the new one, rather than as words removed and added in turn.
 */
export function groupChanges(changes: WordChange[]): WordChange[] {
  const grouped: WordChange[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = (): void => {
    if (removed.length > 0) {
      grouped.push({ type: 'removed', tokens: removed });
    }
    if (added.length > 0) {
      grouped.push({ type: 'added', tokens: added });
    }
    removed = [];
    added = [];
  };
  changes.forEach((change, i) => {
    if (change.type === 'removed') {
      removed.push(...change.tokens);
    } else if (change.type === 'added') {
      added.push(...change.tokens);
    } else if ((removed.length > 0 || added.length > 0) && i + 1 < changes.length && change.tokens.join('').trim().length <= 1) {
      // In both texts.
      removed.push(...change.tokens);
      added.push(...change.tokens);
    } else {
      flush();
      grouped.push(change);
    }
  });
  flush();
  return grouped;
}

/** How alike two texts are, from 0 (nothing in common) to 1 (the same): the share of their characters in common words. */
export function similarity(before: string, after: string, segmenter?: Intl.Segmenter): number {
  if (before === after) {
    return 1;
  }
  const total = before.length + after.length;
  if (total === 0) {
    return 1;
  }
  let common = 0;
  for (const change of diffWordLists(splitWords(before, segmenter), splitWords(after, segmenter)) ?? []) {
    if (change.type === 'equal') {
      common += change.tokens.join('').length;
    }
  }
  return (2 * common) / total;
}

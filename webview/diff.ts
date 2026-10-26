/**
 * Shows the differences of the document from a revision (`renderDiff` in diffRender.ts): the words changed in each
 * changed block, and the diagram of the revision under a changed diagram. The bar to go from one change to the next is
 * in diffBar.ts.
 */
import type { DiffView } from '../src/protocol';
import { diffWordLists, groupChanges, splitWords, wordSegmenter } from '../src/textDiff';

const segmenter = wordSegmenter(document.documentElement.lang || navigator.language);
const titles = document.body.dataset;

/** The texts not compared word by word: those of the diagrams and wireframes, compared as a whole. */
const SKIPPED = '.seqnotes-mermaid, .seqnotes-wireframe, script, style';
/**
 * The cells hidden by the table options (src/tables.ts), shown in a plain table, and their text merged into another
 * cell, shown otherwise. Only one of them is compared at a time, so that the words are not changed twice.
 */
const HIDDEN = '.seqnotes-cell-hidden';
const MERGED = '.seqnotes-cell-sub';
/** Beyond this many words, a changed block is only marked as a whole. */
const MAX_WORDS = 20_000;

/** Marks the changes in `content` (the sanitized HTML of `renderDiff`), before its diagrams are rendered. */
export function markChanges(content: HTMLElement, diff: DiffView, sanitize: (html: string) => DocumentFragment): void {
  for (const block of Array.from(content.querySelectorAll<HTMLElement>('[data-seqnotes-diff="changed"][data-seqnotes-diff-old]'))) {
    const html = diff.old[Number(block.dataset.seqnotesDiffOld)];
    if (html === undefined) {
      continue;
    }
    const before = document.createElement('div');
    // A row is parsed in a table: outside of it, its cells would be dropped, with the classes of the hidden ones.
    before.append(sanitize(block.matches('tr') ? `<table>${html}</table>` : html));
    if (block.matches('.seqnotes-mermaid')) {
      addOldDiagram(block, before);
    } else {
      if (block.querySelector(HIDDEN)) {
        // As shown in a plain table (webview/tableTree.ts), marked in the hidden cells only: the others are marked next.
        markWords(block, before, `${SKIPPED}, ${MERGED}`, HIDDEN);
      }
      markWords(block, before, `${SKIPPED}, ${HIDDEN}`);
    }
  }
}

/** Puts the diagram of the revision under the changed one, folded. Rendered with the others. */
function addOldDiagram(block: HTMLElement, before: HTMLElement): void {
  const diagram = before.querySelector('.seqnotes-mermaid');
  if (!diagram) {
    return;
  }
  const details = document.createElement('details');
  details.className = 'seqnotes-diff-old-diagram';
  const summary = document.createElement('summary');
  summary.textContent = titles.seqnotesDiffOldDiagram ?? '';
  details.append(summary, diagram);
  block.after(details);
}

function textNodes(root: Node, skipped: string): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    // The spaces between the elements are not part of the text, and an <ins> could not be put there (e.g. in a <tr>).
    if (text.data.trim() !== '' && !text.parentElement?.closest(skipped)) {
      nodes.push(text);
    }
  }
  return nodes;
}

interface Word {
  text: string;
  /** Index of its text node. */
  node: number;
  offset: number;
}

/** The words of the text nodes, each in a node: a word cut by an element (e.g. part of it in bold) is two words. */
function wordsOf(nodes: Text[]): Word[] {
  const words: Word[] = [];
  nodes.forEach((node, index) => {
    let offset = 0;
    for (const text of splitWords(node.data, segmenter)) {
      words.push({ text, node: index, offset });
      offset += text.length;
    }
  });
  return words;
}

/** An `<ins>` around the text `[at, end)` of a node, or a `<del>` with `text` at `at`. */
type Edit = { at: number; end: number; text?: undefined } | { at: number; end?: undefined; text: string };

/**
 * Marks the words added to a block with `<ins>`, and puts those removed from it back in `<del>`, comparing the texts
 * outside `skipped`. With `only`, only the texts in it are marked.
 */
function markWords(after: HTMLElement, before: HTMLElement, skipped: string, only?: string): void {
  const afterNodes = textNodes(after, skipped);
  const afterWords = wordsOf(afterNodes);
  const beforeWords = wordsOf(textNodes(before, skipped));
  if (afterWords.length + beforeWords.length > MAX_WORDS) {
    return;
  }
  const changes = diffWordLists(
    beforeWords.map((w) => w.text),
    afterWords.map((w) => w.text),
  );
  if (!changes) {
    return;
  }
  const edits = new Map<number, Edit[]>();
  const edit = (node: number, e: Edit): void => {
    edits.set(node, [...(edits.get(node) ?? []), e]);
  };
  let a = 0;
  let b = 0;
  for (const change of groupChanges(changes)) {
    const count = change.tokens.length;
    if (change.type === 'equal') {
      a += count;
      b += count;
    } else if (change.type === 'added') {
      // An <ins> per node of the words added.
      for (let start = a; start < a + count; ) {
        let end = start;
        while (end < a + count && afterWords[end].node === afterWords[start].node) {
          end++;
        }
        const last = afterWords[end - 1];
        if (afterWords.slice(start, end).some((w) => w.text.trim() !== '')) {
          edit(afterWords[start].node, { at: afterWords[start].offset, end: last.offset + last.text.length });
        }
        start = end;
      }
      a += count;
    } else {
      let text = '';
      for (let i = b; i < b + count; i++) {
        // The words of other elements (e.g. other cells) are apart.
        if (i > b && beforeWords[i].node !== beforeWords[i - 1].node && !/\s$/.test(text) && !/^\s/.test(beforeWords[i].text)) {
          text += ' ';
        }
        text += beforeWords[i].text;
      }
      b += count;
      // Before the word that took their place, or after the last one.
      const next = afterWords[a];
      const last = afterNodes.length - 1;
      if (text.trim() !== '' && (next || last >= 0)) {
        edit(next ? next.node : last, { at: next ? next.offset : afterNodes[last].data.length, text });
      }
    }
  }
  for (const [index, list] of edits) {
    const node = afterNodes[index];
    if (only && !node.parentElement?.closest(only)) {
      continue;
    }
    // A deletion goes before an insertion at the same place: the old words, then the new ones.
    list.sort((x, y) => x.at - y.at || (x.text === undefined ? 1 : 0) - (y.text === undefined ? 1 : 0));
    const fragment = document.createDocumentFragment();
    let pos = 0;
    for (const e of list) {
      fragment.append(node.data.slice(pos, e.at));
      if (e.text !== undefined) {
        const del = document.createElement('del');
        del.className = 'seqnotes-diff-del';
        del.textContent = e.text;
        fragment.append(del);
        pos = e.at;
      } else {
        const ins = document.createElement('ins');
        ins.className = 'seqnotes-diff-ins';
        ins.textContent = node.data.slice(e.at, e.end);
        fragment.append(ins);
        pos = e.end;
      }
    }
    fragment.append(node.data.slice(pos));
    node.replaceWith(fragment);
  }
}

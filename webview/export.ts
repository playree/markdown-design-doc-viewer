/**
 * Script of an exported HTML file: the side-by-side layout and the arrow ⇔ step highlighting of the preview,
 * without the parts that talk to VS Code.
 */
import { setupDiffBar } from './diffBar';
import { setupFootnotePopup } from './footnotePopup';
import { setUpIndexList } from './indexList';
import { activeFor, endsDrag, revealCounterpart, scrollToFragment, showActive, trackPresses, type Active } from './linking';
import { setupNoteJumps } from './noteJumps';
import { addSplitter, applySplit } from './splitter';
import { setupTableTree } from './tableTree';
import { setupToc } from './toc';
import { windowScrollHost } from './viewerContext';
import { layoutWireframes, linkTarget, remountWireframes } from './wireframe';

const root = document.getElementById('seqnotes-root')!;
const titles = document.body.dataset;
const scroll = windowScrollHost();
const width = Number(titles.seqnotesSplitMinWidth);
const splitMinWidth = Number.isFinite(width) ? width : 1000;

let pinned: Active | undefined;
let printing = false;

trackPresses();

function applyLayout(): void {
  // Printed pages are laid out vertically: the sticky diagram column does not work on paper.
  document.body.classList.toggle('seqnotes-wide', !printing && window.innerWidth >= splitMinWidth);
}

applyLayout();
window.addEventListener('resize', applyLayout);
window.addEventListener('beforeprint', () => {
  printing = true;
  applyLayout();
  // At once, so that the parts are boxed where they are printed.
  layoutWireframes(root);
});
window.addEventListener('afterprint', () => {
  printing = false;
  applyLayout();
});

remountWireframes(root);

// The boundary of the pairs side by side, as in the preview. The width is not kept: the file opens with the default one.
root.querySelectorAll('.seqnotes-pair:not(.seqnotes-pair-stacked)').forEach((pair) => {
  addSplitter(pair, titles.seqnotesSplitterTitle ?? '', (percent) => applySplit(document.body, percent));
});

// Other links are left to the browser, as in the document.
setupFootnotePopup(
  root,
  (href) => {
    if (!href.startsWith('#')) {
      return false;
    }
    scrollToFragment(root, href, scroll);
    return true;
  },
  { container: document.body, id: 'seqnotes-footnote-popup' },
);

setupTableTree(root);

// With the `toc` setting of the export (`exportPage` in src/export/exportPage.ts).
if (titles.seqnotesToc !== undefined) {
  setupToc(root, { container: document.body, title: titles.seqnotesTocTitle ?? '', scroll }).build(true);
}

// The differences from a revision rendered in the page (`ExportPage.diff` in src/export/exportPage.ts), hidden and shown by the bar.
const { seqnotesDiffLabel: diffLabel, seqnotesDiffStats: diffStats } = titles;
if (diffLabel !== undefined && diffStats !== undefined) {
  const [added = 0, changed = 0, deleted = 0] = diffStats.split(',').map(Number);
  const onToggle = (shown: boolean): void => {
    document.body.classList.toggle('seqnotes-diff-off', !shown);
  };
  setupDiffBar(root, { onToggle }, { container: document.body, titles, scroll }).show({ label: diffLabel, stats: { added, changed, deleted } });
}

// The list of the documents (index.html).
const index = root.querySelector<HTMLElement>('.seqnotes-index');
if (index) {
  setUpIndexList(index);
}

root.addEventListener('mouseover', (e) => showActive(root, activeFor(linkTarget(e)) ?? pinned));
root.addEventListener('mouseleave', () => showActive(root, pinned));

root.addEventListener('click', (e) => {
  const target = e.target as Element;
  const link = target.closest('a[href^="#"]');
  if (link) {
    e.preventDefault();
    scrollToFragment(root, link.getAttribute('href')!, scroll);
    return;
  }
  const active = endsDrag(e) ? undefined : activeFor(linkTarget(e));
  if (active) {
    pinned = { pair: active.pair, target: active.target };
    showActive(root, pinned);
    revealCounterpart(active, scroll);
  }
});

const noteJumps = setupNoteJumps(root, {
  scroll,
  pin(active, reveal) {
    pinned = { pair: active.pair, target: active.target };
    showActive(root, pinned);
    if (reveal) {
      revealCounterpart(active, scroll);
    }
  },
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pinned = undefined;
    showActive(root, undefined);
    noteJumps.clear();
  }
});

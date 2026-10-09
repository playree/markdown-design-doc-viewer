/**
 * Script of an exported HTML file: the side-by-side layout and the arrow ⇔ step highlighting of the preview,
 * without the parts that talk to VS Code.
 */
import { activeFor, revealCounterpart, scrollToFragment, showActive, type Active } from './linking';

const root = document.getElementById('seqnotes-root')!;
const width = Number(document.body.dataset.seqnotesSplitMinWidth);
const splitMinWidth = Number.isFinite(width) ? width : 1000;

let pinned: Active | undefined;
let printing = false;

function applyLayout(): void {
  // Printed pages are laid out vertically: the sticky diagram column does not work on paper.
  document.body.classList.toggle('seqnotes-wide', !printing && window.innerWidth >= splitMinWidth);
}

applyLayout();
window.addEventListener('resize', applyLayout);
window.addEventListener('beforeprint', () => {
  printing = true;
  applyLayout();
});
window.addEventListener('afterprint', () => {
  printing = false;
  applyLayout();
});

root.addEventListener('mouseover', (e) => showActive(root, activeFor(e.target as Element) ?? pinned));
root.addEventListener('mouseleave', () => showActive(root, pinned));

root.addEventListener('click', (e) => {
  const target = e.target as Element;
  const link = target.closest('a[href^="#"]');
  if (link) {
    e.preventDefault();
    scrollToFragment(link.getAttribute('href')!);
    return;
  }
  const active = activeFor(target);
  if (active) {
    pinned = { pair: active.pair, target: active.target };
    showActive(root, pinned);
    revealCounterpart(active);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pinned = undefined;
    showActive(root, undefined);
  }
});

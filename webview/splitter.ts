/**
 * The boundary between the diagram and the overview column of a side-by-side pair, dragged to resize them:
 * the preview (preview.ts) and an exported file (export.ts).
 */

const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

/**
 * Writes the width of the diagram column (`--seqnotes-split`, in % of the pair) on the viewer's element, kept between
 * 20% and 80%, or removes it (the default width) with `undefined`. Returns the width written.
 */
export function applySplit(el: HTMLElement, percent: number | undefined): number | undefined {
  if (percent === undefined || !Number.isFinite(percent)) {
    el.style.removeProperty('--seqnotes-split');
    return undefined;
  }
  percent = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent));
  el.style.setProperty('--seqnotes-split', `${percent}%`);
  return percent;
}

/**
 * Adds the boundary after the diagram column of a pair: dragging it gives `onSplit` the width of the diagram column
 * (in % of the pair), and double-clicking it gives `undefined` (the default width).
 */
export function addSplitter(pair: Element, title: string, onSplit: (percent: number | undefined) => void): void {
  const splitter = document.createElement('div');
  splitter.className = 'seqnotes-splitter';
  splitter.title = title;
  pair.querySelector('.seqnotes-seq-col')?.after(splitter);

  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = pair.getBoundingClientRect();
      onSplit(((ev.clientX - r.left) / r.width) * 100);
    };
    const up = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });
  splitter.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    onSplit(undefined);
  });
}

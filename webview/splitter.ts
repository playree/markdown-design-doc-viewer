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

/** The step of the arrow keys on a focused boundary, in % of the pair. */
const KEY_STEP = 5;

/**
 * Adds the boundary after the diagram column of a pair: dragging it gives `onSplit` the width of the diagram column
 * (in % of the pair), and double-clicking it gives `undefined` (the default width). Focused, the arrow keys move it,
 * Home and End to the narrowest and the widest, and Enter resets it. Its listeners are removed with `signal`.
 */
export function addSplitter(pair: Element, title: string, onSplit: (percent: number | undefined) => void, signal?: AbortSignal): void {
  const splitter = document.createElement('div');
  splitter.className = 'seqnotes-splitter';
  splitter.title = title;
  splitter.tabIndex = 0;
  splitter.setAttribute('role', 'separator');
  splitter.setAttribute('aria-orientation', 'vertical');
  splitter.setAttribute('aria-valuemin', String(MIN_SPLIT));
  splitter.setAttribute('aria-valuemax', String(MAX_SPLIT));
  const column = pair.querySelector('.seqnotes-seq-col');
  column?.after(splitter);

  /** The width of the diagram column, in % of the pair, as it is laid out. */
  const current = (): number => {
    const width = pair.getBoundingClientRect().width;
    return width > 0 && column ? (column.getBoundingClientRect().width / width) * 100 : 0;
  };
  /** Tells the width laid out to assistive technologies. */
  const showValue = (): void => splitter.setAttribute('aria-valuenow', String(Math.round(current())));
  const split = (percent: number | undefined): void => {
    onSplit(percent);
    showValue();
  };

  splitter.addEventListener(
    'pointerdown',
    (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = pair.getBoundingClientRect();
        split(((ev.clientX - r.left) / r.width) * 100);
      };
      // After the pointer is released, or the drag is cancelled (by a gesture of a touch screen, for instance).
      const end = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('lostpointercapture', end);
      };
      splitter.addEventListener('pointermove', move, { signal });
      splitter.addEventListener('lostpointercapture', end, { signal });
    },
    { signal },
  );
  splitter.addEventListener(
    'dblclick',
    (e) => {
      e.stopPropagation();
      split(undefined);
    },
    { signal },
  );
  // The width may have been changed since with the boundary of another pair.
  splitter.addEventListener('focus', showValue, { signal });
  splitter.addEventListener(
    'keydown',
    (e) => {
      let percent: number | undefined;
      switch (e.key) {
        case 'ArrowLeft':
          percent = current() - KEY_STEP;
          break;
        case 'ArrowRight':
          percent = current() + KEY_STEP;
          break;
        case 'Home':
          percent = MIN_SPLIT;
          break;
        case 'End':
          percent = MAX_SPLIT;
          break;
        case 'Enter':
          percent = undefined;
          break;
        default:
          return;
      }
      e.preventDefault();
      split(percent);
    },
    { signal },
  );
}

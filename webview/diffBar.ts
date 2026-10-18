/**
 * The bar of the differences from a revision (diff.ts): what the document is compared with, the number of blocks
 * changed, and buttons to go from one change to the next. In the preview, it closes the differences; in an exported
 * file (export.ts), it hides and shows them.
 */
import type { DiffView } from '../src/protocol';

const titles = document.body.dataset;

/** Where a change is put on the screen when the bar's buttons go to it (also `scroll-margin` in preview.css). */
const FOCUS_RATIO = 0.25;
const FOCUS_MS = 1500;

/** Fills in the `{0}` of a text from the body's data attributes. */
const format = (text: string | undefined, value: number): string => (text ?? '{0}').replace('{0}', String(value));

const CHEVRON_UP = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 10l4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 6l4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const EYE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const EYE_CLOSED =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.3"/></svg>';

/** What the bar shows: the label and the numbers of a `DiffView`. */
export type DiffSummary = Pick<DiffView, 'label' | 'stats'>;

export interface DiffBar {
  /** Shows the bar for the differences rendered in the root, or hides it without. */
  show(diff: DiffSummary | undefined): void;
}

/**
 * What the bar's last button does: `onClose` closes the differences (the preview), `onToggle` hides or shows them
 * (an exported file), called with whether they are shown.
 */
export type DiffBarAction = { onClose: () => void } | { onToggle: (shown: boolean) => void };

/** Sets up the bar for the changes in `root`. */
export function setupDiffBar(root: HTMLElement, action: DiffBarAction): DiffBar {
  const bar = document.createElement('div');
  bar.className = 'seqnotes-diff-bar';
  bar.setAttribute('role', 'toolbar');
  bar.hidden = true;
  const label = document.createElement('span');
  label.className = 'seqnotes-diff-label';
  const counts = document.createElement('span');
  counts.className = 'seqnotes-diff-counts';
  const buttons = document.createElement('span');
  buttons.className = 'seqnotes-diff-buttons';
  const button = (content: string, title: string | undefined, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = content;
    b.title = title ?? '';
    b.setAttribute('aria-label', b.title);
    b.addEventListener('click', onClick);
    return b;
  };
  const previous = button(CHEVRON_UP, titles.seqnotesDiffPreviousTitle, () => go(-1));
  const next = button(CHEVRON_DOWN, titles.seqnotesDiffNextTitle, () => go(1));
  buttons.append(previous, next);

  let current: HTMLElement | undefined;
  /** Where the page was scrolled to by going to `current`. */
  let currentScroll: number | undefined;
  let focusTimer: ReturnType<typeof setTimeout> | undefined;

  let changes = 0;
  /** Whether the changes are shown (always, unless hidden by the toggle button). */
  let shown = true;
  const updateButtons = (): void => {
    previous.disabled = next.disabled = changes === 0 || !shown;
  };
  if ('onClose' in action) {
    buttons.append(button('&times;', titles.seqnotesDiffCloseTitle, action.onClose));
  } else {
    const toggle = button(EYE, titles.seqnotesDiffHideTitle, () => {
      shown = !shown;
      current?.classList.remove('seqnotes-diff-focus');
      toggle.innerHTML = shown ? EYE : EYE_CLOSED;
      toggle.title = (shown ? titles.seqnotesDiffHideTitle : titles.seqnotesDiffShowTitle) ?? '';
      toggle.setAttribute('aria-label', toggle.title);
      updateButtons();
      action.onToggle(shown);
    });
    buttons.append(toggle);
  }
  bar.append(label, counts, buttons);
  // Outside the root, so the arrow / heading handlers on it do not see the clicks.
  document.body.append(bar);

  /** The changed blocks displayed, in document order. */
  const targets = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-seqnotes-diff]')).filter((el) => el.getClientRects().length > 0);

  function go(direction: 1 | -1): void {
    const list = targets();
    if (list.length === 0) {
      return;
    }
    const line = window.innerHeight * FOCUS_RATIO;
    const index = current ? list.indexOf(current) : -1;
    let target: HTMLElement | undefined;
    // From the one gone to last while the page stays where it went (which may not be at `line` near the end of the
    // page); else from what is on the screen.
    if (index >= 0 && currentScroll !== undefined && Math.abs(window.scrollY - currentScroll) < 2) {
      target = list[(index + direction + list.length) % list.length];
    } else if (direction > 0) {
      target = list.find((el) => el.getBoundingClientRect().top > line + 1) ?? list[0];
    } else {
      target = [...list].reverse().find((el) => el.getBoundingClientRect().top < line - 1) ?? list[list.length - 1];
    }
    current?.classList.remove('seqnotes-diff-focus');
    current = target;
    target.classList.add('seqnotes-diff-focus');
    target.scrollIntoView({ block: 'start' });
    currentScroll = window.scrollY;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => target.classList.remove('seqnotes-diff-focus'), FOCUS_MS);
  }

  return {
    show(diff) {
      bar.hidden = !diff;
      current = undefined;
      currentScroll = undefined;
      if (!diff) {
        return;
      }
      label.textContent = diff.label;
      label.title = diff.label;
      const { added, changed, deleted } = diff.stats;
      const items: [string, number, string | undefined][] = [
        ['added', added, titles.seqnotesDiffAdded],
        ['changed', changed, titles.seqnotesDiffChanged],
        ['deleted', deleted, titles.seqnotesDiffDeleted],
      ];
      counts.replaceChildren(
        ...items
          .filter(([, count]) => count > 0)
          .map(([kind, count, text]) => {
            const span = document.createElement('span');
            span.className = 'seqnotes-diff-count';
            span.dataset.kind = kind;
            span.textContent = format(text, count);
            return span;
          }),
      );
      changes = added + changed + deleted;
      if (changes === 0) {
        counts.textContent = titles.seqnotesDiffNoChanges ?? '';
      }
      updateButtons();
    },
  };
}

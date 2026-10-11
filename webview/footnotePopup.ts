/**
 * Shows the note of a footnote reference (`[^1]`) in a popup while the pointer is on it or it has the focus,
 * shared by the preview (`main.ts`) and exported HTML (`export.ts`).
 */

/** Delay before showing the popup on hover, so that passing over a reference does not flash it. */
const SHOW_DELAY = 150;
/** Delay before hiding it, so that the pointer can move from the reference onto the popup. */
const HIDE_DELAY = 200;
/** Space between the reference and the popup, and between the popup and the edges of the window, in px. */
const GAP = 6;
const EDGE = 8;

const REF = '.footnote-ref a[href^="#"]';

export interface FootnotePopup {
  hide(): void;
}

/**
 * Sets up the popup for the references in `root`. `handleLink` opens a link clicked in the popup
 * and returns true, or returns false to leave it to the browser.
 */
export function setupFootnotePopup(root: HTMLElement, handleLink: (href: string) => boolean): FootnotePopup {
  const popup = document.createElement('div');
  popup.className = 'seqnotes-footnote-popup';
  popup.id = 'seqnotes-footnote-popup';
  popup.setAttribute('role', 'tooltip');
  popup.hidden = true;
  // Outside the root, so the arrow / heading handlers on it do not see the pointer and the clicks.
  document.body.append(popup);

  let current: Element | undefined;
  let timer: number | undefined;

  const schedule = (fn: () => void, delay: number): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, delay);
  };

  function hide(): void {
    window.clearTimeout(timer);
    current?.removeAttribute('aria-describedby');
    current = undefined;
    popup.hidden = true;
    popup.replaceChildren();
  }

  function show(ref: Element): void {
    window.clearTimeout(timer);
    if (ref === current) {
      return;
    }
    let id = ref.getAttribute('href')!.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // keep the raw fragment
    }
    const item = document.getElementById(id);
    if (!item || !root.contains(item) || !item.matches('.footnote-item')) {
      hide();
      return;
    }
    hide();
    const note = item.cloneNode(true) as Element;
    // A copy without its listeners: no zoom buttons, nor images that look zoomable.
    note.querySelectorAll('.footnote-backref, .seqnotes-zoom-button').forEach((el) => el.remove());
    note.querySelectorAll('.seqnotes-zoomable').forEach((image) => {
      image.classList.remove('seqnotes-zoomable');
      for (const attr of ['tabindex', 'role', 'aria-label']) {
        image.removeAttribute(attr);
      }
    });
    // The note stays in the document: no element ids twice, except inside a diagram, whose styles refer to them.
    note.querySelectorAll('[id]').forEach((el) => {
      if (!el.closest('svg')) {
        el.removeAttribute('id');
      }
    });
    popup.replaceChildren(...Array.from(note.childNodes));
    popup.hidden = false;
    current = ref;
    ref.setAttribute('aria-describedby', popup.id);
    place(ref);
  }

  /** Below the reference, or above it when it does not fit below and there is more room above. Within the window. */
  function place(ref: Element): void {
    popup.style.left = '0';
    popup.style.top = '0';
    const anchor = ref.getBoundingClientRect();
    const { width, height } = popup.getBoundingClientRect();
    const below = window.innerHeight - anchor.bottom - GAP - EDGE;
    const above = anchor.top - GAP - EDGE;
    const top = height > below && above > below ? Math.max(EDGE, anchor.top - GAP - height) : anchor.bottom + GAP;
    const left = Math.max(EDGE, Math.min(anchor.left - 16, window.innerWidth - EDGE - width));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  root.addEventListener('mouseover', (e) => {
    const ref = (e.target as Element).closest(REF);
    if (ref) {
      schedule(() => show(ref), ref === current ? 0 : SHOW_DELAY);
    }
  });
  root.addEventListener('mouseout', (e) => {
    const ref = (e.target as Element).closest(REF);
    if (ref && !ref.contains(e.relatedTarget as Node | null)) {
      schedule(hide, HIDE_DELAY);
    }
  });
  popup.addEventListener('mouseenter', () => window.clearTimeout(timer));
  popup.addEventListener('mouseleave', () => schedule(hide, HIDE_DELAY));

  // From the keyboard only: a click focuses the reference too, and then jumps to the note.
  root.addEventListener('focusin', (e) => {
    const ref = (e.target as Element).closest(REF);
    if (ref?.matches(':focus-visible')) {
      show(ref);
    }
  });
  root.addEventListener('focusout', (e) => {
    // Not when a link in the popup takes the focus on a click: it would be removed before the click.
    if ((e.target as Element).closest(REF) && !popup.contains(e.relatedTarget as Node | null)) {
      schedule(hide, HIDE_DELAY);
    }
  });
  // The reference jumps to the note.
  root.addEventListener('click', (e) => {
    if ((e.target as Element).closest(REF)) {
      hide();
    }
  });

  popup.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('a[href]');
    if (link && handleLink(link.getAttribute('href')!)) {
      e.preventDefault();
      hide();
    }
  });

  // Captured, and not passed on: Escape closes only the popup, and keeps the pinned step of the preview.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && current) {
        e.stopImmediatePropagation();
        hide();
      }
    },
    { capture: true },
  );
  // Captured, to see the scrolling of the diagram columns too. The popup itself may scroll.
  document.addEventListener(
    'scroll',
    (e) => {
      if (current && !popup.contains(e.target as Node)) {
        hide();
      }
    },
    { capture: true, passive: true },
  );

  window.addEventListener('resize', hide);
  // Placed again when its content changes size, e.g. an image that loads.
  new ResizeObserver(() => {
    if (current) {
      place(current);
    }
  }).observe(popup);

  return { hide };
}

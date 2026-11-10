/**
 * Highlighting of the linked arrows / nodes and steps, shared by the preview (`preview.ts`) and exported HTML (`export.ts`).
 */
import { HEADING_ID_PREFIX, slugify } from '../src/shared/slug';
import type { ScrollHost } from './viewerContext';

/** A linked step of a side-by-side diagram: the pair and the id of the step heading. */
export interface Active {
  pair: Element;
  target: string;
}

const ACTIVE = 'seqnotes-active';

/** A pointer that moves farther than this (px) between its press and its release drags (e.g. selects text) instead of clicking. */
const DRAG_THRESHOLD = 4;

/** Where the pointer was pressed last. */
let pressed: { x: number; y: number } | undefined;
document.addEventListener('pointerdown', (e) => (pressed = { x: e.clientX, y: e.clientY }), true);

/** true when the click `e` ends a drag, such as a selection of text, which does not pin a step. */
export const endsDrag = (e: MouseEvent): boolean => pressed !== undefined && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_THRESHOLD;

/**
 * true when `el` is in a pair laid out side by side now (a stacked pair never is): in a viewer wide enough, whose element
 * has the class `seqnotes-wide`. As in preview.css, not an element of the document with that class (in raw HTML).
 */
export const isSideBySide = (el: Element): boolean => el.closest('.seqnotes-viewer.seqnotes-wide') !== null && !el.closest('.seqnotes-pair-stacked');

/** Highlights the arrows and the section (and rows) of `active`, and clears the previous highlight in `root`. */
export function showActive(root: Element, active: Active | undefined): void {
  root.querySelectorAll(`.${ACTIVE}`).forEach((el) => el.classList.remove(ACTIVE));
  if (!active) {
    return;
  }
  const target = CSS.escape(active.target);
  active.pair.querySelectorAll(`[data-seqnotes-target="${target}"], [data-seqnotes-section="${target}"]`).forEach((el) => el.classList.add(ACTIVE));
}

/** The message or linked heading (or row of an item table) under an event target. */
export function activeFor(el: Element | null): (Active & { kind: 'message' | 'heading' }) | undefined {
  const pair = el?.closest('.seqnotes-pair');
  if (!el || !pair) {
    return undefined;
  }
  const message = el.closest('[data-seqnotes-target]');
  if (message) {
    return { pair, target: message.getAttribute('data-seqnotes-target')!, kind: 'message' };
  }
  // A row linked to a part of a wireframe, which it shares with the heading linked to the part, if any.
  const row = el.closest('tr[data-seqnotes-section]');
  if (row) {
    return { pair, target: row.getAttribute('data-seqnotes-section')!, kind: 'heading' };
  }
  // Only the heading that owns the section; unlinked sub-headings inside it do not count.
  const heading = el.closest(':is(h1, h2, h3, h4, h5, h6)[id]');
  if (heading && heading.parentElement?.getAttribute('data-seqnotes-section') === heading.id) {
    return { pair, target: heading.id, kind: 'heading' };
  }
  return undefined;
}

/** Scrolls `el` into view: in its diagram column when it is sticky, else in the document that `scroll` scrolls. */
export function scrollColumnTo(el: Element, smooth: boolean, scroll: ScrollHost): void {
  const col = el.closest('.seqnotes-seq-col');
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  if (col && isSideBySide(col)) {
    const r = el.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    col.scrollBy({ top: r.top - c.top - c.height / 2, behavior });
    // The sticky column itself may be off screen when the pair is only partly visible.
    const pr = col.parentElement!.getBoundingClientRect();
    const viewport = scroll.viewport();
    if (pr.top > viewport.top || pr.bottom < viewport.top + viewport.height / 2) {
      scroll.reveal(col.parentElement!, 'start', behavior);
    }
  } else {
    scroll.reveal(el, 'center', behavior);
  }
}

/** Scrolls the counterpart of a clicked message (its step) or heading (its arrow) into view. */
export function revealCounterpart(active: Active & { kind: 'message' | 'heading' }, scroll: ScrollHost): void {
  const escaped = CSS.escape(active.target);
  if (active.kind === 'message') {
    // 'nearest' keeps the page still when the section is already visible, so the sticky diagram stays in view.
    const section = active.pair.querySelector(`[data-seqnotes-section="${escaped}"]`);
    if (section) {
      scroll.reveal(section, 'nearest', 'smooth');
    }
  } else {
    const item = active.pair.querySelector(`.seqnotes-item[data-seqnotes-target="${escaped}"]`);
    if (item) {
      scrollColumnTo(item, true, scroll);
    }
  }
}

/**
 * The element of `root` with the id `id`. Not `document.getElementById`: another viewer in the page may have the same
 * ids, before those of `root`.
 */
export function elementById(root: Element, id: string): Element | null {
  return root.querySelector(`[id="${CSS.escape(id)}"]`);
}

/**
 * Scrolls to the heading (or element) in `root` a `#fragment` link points to. Heading ids carry a prefix, so the link may
 * be written without it.
 */
export function scrollToFragment(root: Element, href: string, scroll: ScrollHost): void {
  let name = href.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw fragment
  }
  const byId = (id: string): Element | null => elementById(root, id);
  // A footnote first: its id (`fn1`) may also be the slug of a heading.
  const raw = byId(name);
  const target = (raw?.closest('.footnote-item, .footnote-ref') ? raw : null) ?? byId(HEADING_ID_PREFIX + name) ?? byId(HEADING_ID_PREFIX + slugify(name)) ?? raw;
  if (target) {
    scroll.reveal(target, 'start');
  }
}

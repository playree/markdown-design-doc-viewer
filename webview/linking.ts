/**
 * Highlighting of the linked arrows / nodes and steps, shared by the preview (`main.ts`) and exported HTML (`export.ts`).
 */
import { HEADING_ID_PREFIX, slugify } from '../src/slug';

/** A linked step of a side-by-side diagram: the pair and the id of the step heading. */
export interface Active {
  pair: Element;
  target: string;
}

const ACTIVE = 'seqnotes-active';

const isWide = (): boolean => document.body.classList.contains('seqnotes-wide');

/** true when `el` is in a pair laid out side by side now (a stacked pair never is). */
export const isSideBySide = (el: Element): boolean => isWide() && !el.closest('.seqnotes-pair-stacked');

/** Highlights the arrows and the section of `active`, and clears the previous highlight in `root`. */
export function showActive(root: Element, active: Active | undefined): void {
  root.querySelectorAll(`.${ACTIVE}`).forEach((el) => el.classList.remove(ACTIVE));
  if (!active) {
    return;
  }
  const target = CSS.escape(active.target);
  active.pair.querySelectorAll(`[data-seqnotes-target="${target}"], [data-seqnotes-section="${target}"]`).forEach((el) => el.classList.add(ACTIVE));
}

/** The message or linked heading under an event target. */
export function activeFor(el: Element | null): (Active & { kind: 'message' | 'heading' }) | undefined {
  const pair = el?.closest('.seqnotes-pair');
  if (!el || !pair) {
    return undefined;
  }
  const message = el.closest('[data-seqnotes-target]');
  if (message) {
    return { pair, target: message.getAttribute('data-seqnotes-target')!, kind: 'message' };
  }
  // Only the heading that owns the section; unlinked sub-headings inside it do not count.
  const heading = el.closest(':is(h1, h2, h3, h4, h5, h6)[id]');
  if (heading && heading.parentElement?.getAttribute('data-seqnotes-section') === heading.id) {
    return { pair, target: heading.id, kind: 'heading' };
  }
  return undefined;
}

export function scrollColumnTo(el: Element, smooth: boolean): void {
  const col = el.closest('.seqnotes-seq-col');
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  if (col && isSideBySide(col)) {
    const r = el.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    col.scrollBy({ top: r.top - c.top - c.height / 2, behavior });
    // The sticky column itself may be off screen when the pair is only partly visible.
    const pr = col.parentElement!.getBoundingClientRect();
    if (pr.top > 0 || pr.bottom < window.innerHeight / 2) {
      col.parentElement!.scrollIntoView({ block: 'start', behavior });
    }
  } else {
    el.scrollIntoView({ block: 'center', behavior });
  }
}

/** Scrolls the counterpart of a clicked message (its step) or heading (its arrow) into view. */
export function revealCounterpart(active: Active & { kind: 'message' | 'heading' }): void {
  const escaped = CSS.escape(active.target);
  if (active.kind === 'message') {
    // 'nearest' keeps the page still when the section is already visible, so the sticky diagram stays in view.
    active.pair.querySelector(`[data-seqnotes-section="${escaped}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    const item = active.pair.querySelector(`.seqnotes-item[data-seqnotes-target="${escaped}"]`);
    if (item) {
      scrollColumnTo(item, true);
    }
  }
}

/** Scrolls to the heading (or element) a `#fragment` link points to. Heading ids carry a prefix, so the link may be written without it. */
export function scrollToFragment(href: string): void {
  let name = href.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw fragment
  }
  const target =
    document.getElementById(HEADING_ID_PREFIX + name) ?? document.getElementById(HEADING_ID_PREFIX + slugify(name)) ?? document.getElementById(name);
  target?.scrollIntoView({ block: 'start' });
}

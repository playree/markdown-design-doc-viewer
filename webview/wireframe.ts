/**
 * The wireframes of a document (src/wireframe.ts), shared by the preview (main.ts) and exported HTML (export.ts).
 * Their HTML is shown in a shadow root, so that its styles and those of the page do not apply to each other, and works
 * as a page (its text can be selected, its form controls used), without leaving the document: its links and forms do not
 * navigate. A box is drawn over each of their parts (`data-item`), with its number: it stands for the part like a node
 * of a diagram, linked to the headings and rows (webview/linking.ts). The pointer events of the page are given to it
 * (`linkTarget`).
 *
 * The block of a wireframe (`wireframeBlock` in src/render.ts) keeps its HTML in a <pre>, sanitized by the preview,
 * from which exported HTML shows it again (the shadow root is not part of the exported body).
 */
import type { DiagramMeta } from '../src/render';
import { partNumber } from '../src/wireframe';

/** Before the styles of the wireframe: its page shown as in a browser, whatever the colors and font of the page around it. */
const BASE_STYLE = ':host { all: initial; display: block; } html { display: block; background: #fff; color: #000; color-scheme: light; } head { display: none; }';

/**
 * Shows the (sanitized) HTML of a wireframe in a shadow root of `screen`. With `inert`, it is only shown (in the zoom
 * overlay, which pans on drag): its boxes take the clicks.
 */
function showPage(screen: HTMLElement, html: string, inert: boolean): ShadowRoot {
  screen.inert = inert;
  const shadow = screen.attachShadow({ mode: 'open' });
  // A mock-up: its links and forms do not leave the document.
  shadow.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a[href], area[href]')) {
      e.preventDefault();
    }
  });
  shadow.addEventListener('submit', (e) => e.preventDefault());
  const style = document.createElement('style');
  style.textContent = BASE_STYLE;
  // Parsed as a document, so that it keeps its <html> and <body>, which its styles may select.
  const page = new DOMParser().parseFromString(html, 'text/html').documentElement;
  shadow.append(style, document.importNode(page, true));
  return shadow;
}

/**
 * The HTML of a wireframe in a shadow root, and a box over each of its parts; observed, so that they stay over them.
 * Returns the frame of the two. With `inert`, only shown (see `showPage`).
 */
export function mountWireframe(block: HTMLElement, html: string, meta: DiagramMeta | undefined, inert = false): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'seqnotes-wireframe-frame';
  const screen = document.createElement('div');
  screen.className = 'seqnotes-wireframe-screen';
  const shadow = showPage(screen, html, inert);

  const parts = document.createElement('div');
  parts.className = 'seqnotes-wireframe-parts';
  const messages = new Map((meta?.messages ?? []).map((m) => [m.nodeId, m]));
  const counts = new Map<number, number>();
  for (const element of Array.from(shadow.querySelectorAll('[data-item]'))) {
    const number = partNumber(element.getAttribute('data-item')!);
    if (number === undefined) {
      continue;
    }
    // The k-th element of the part: the elements of a part are boxed each, its number is shown once.
    const k = counts.get(number) ?? 0;
    counts.set(number, k + 1);
    const box = document.createElement('div');
    box.className = 'seqnotes-part seqnotes-item';
    box.dataset.seqnotesPart = String(number);
    box.dataset.seqnotesPartIndex = String(k);
    const message = messages.get(String(number));
    if (message?.target) {
      box.classList.add('seqnotes-linked');
      box.setAttribute('data-seqnotes-target', message.target);
    }
    if (message?.unlinked) {
      box.classList.add('seqnotes-unlinked');
    }
    if (k === 0) {
      const badge = document.createElement('span');
      badge.className = 'seqnotes-part-number';
      badge.textContent = String(number);
      box.append(badge);
    }
    parts.append(box);
  }
  frame.append(screen, parts);
  block.append(frame);
  observe(block, shadow);
  return frame;
}

/** Lays the wireframes out again when their block (its column) or their page (e.g. an image loaded) is resized. */
const resizes = new ResizeObserver((entries) => {
  const blocks = new Set<HTMLElement>();
  for (const { target } of entries) {
    const block = target instanceof HTMLElement && target.matches('.seqnotes-wireframe') ? target : observed.get(target);
    if (!block?.isConnected) {
      // Removed by an update.
      resizes.unobserve(target);
    } else {
      blocks.add(block);
    }
  }
  blocks.forEach(layoutWireframe);
});

/** The block of each page observed. */
const observed = new WeakMap<Element, HTMLElement>();

function observe(block: HTMLElement, shadow: ShadowRoot): void {
  const page = shadow.querySelector('html');
  resizes.observe(block);
  if (page) {
    observed.set(page, block);
    resizes.observe(page);
  }
}

/**
 * Sizes the wireframe of `block`: as wide as the block, or laid out at the width of its options and scaled down to the
 * block. Then puts the boxes of its parts over them.
 */
export function layoutWireframe(block: HTMLElement): void {
  const frame = block.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-frame');
  const screen = frame?.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-screen');
  const shadow = screen?.shadowRoot;
  // Not shown (e.g. in a closed <details>): laid out once it is.
  if (!frame || !screen || !shadow || block.clientWidth === 0) {
    return;
  }
  const width = Number(block.dataset.seqnotesWidth) || undefined;
  if (width) {
    const style = getComputedStyle(block);
    const available = block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const scale = Math.min(1, available / width);
    screen.style.width = `${width}px`;
    screen.style.transform = scale < 1 ? `scale(${scale})` : '';
    frame.style.width = `${width * scale}px`;
    frame.style.height = `${screen.offsetHeight * scale}px`;
  }

  const elements = new Map<number, Element[]>();
  for (const element of Array.from(shadow.querySelectorAll('[data-item]'))) {
    const number = partNumber(element.getAttribute('data-item')!);
    if (number !== undefined) {
      elements.set(number, [...(elements.get(number) ?? []), element]);
    }
  }
  const origin = frame.getBoundingClientRect();
  // The frame may be scaled (in the zoom overlay): the boxes are placed in its own pixels.
  const factor = frame.offsetWidth > 0 ? origin.width / frame.offsetWidth : 1;
  for (const box of Array.from(frame.querySelectorAll<HTMLElement>('.seqnotes-part'))) {
    const element = elements.get(Number(box.dataset.seqnotesPart))?.[Number(box.dataset.seqnotesPartIndex)];
    const r = element?.getBoundingClientRect();
    // An element not shown has no box.
    box.hidden = !r || (r.width === 0 && r.height === 0);
    if (r && !box.hidden) {
      box.style.left = `${(r.left - origin.left) / factor - frame.clientLeft}px`;
      box.style.top = `${(r.top - origin.top) / factor - frame.clientTop}px`;
      box.style.width = `${r.width / factor}px`;
      box.style.height = `${r.height / factor}px`;
    }
  }
}

/** Lays out the wireframes of `root`, once it is in the page. */
export function layoutWireframes(root: Element): void {
  root.querySelectorAll<HTMLElement>('.seqnotes-wireframe').forEach(layoutWireframe);
}

/** Shows the wireframes of an exported page again from the HTML kept in their block, with the boxes of the export. */
export function remountWireframes(root: Element): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('.seqnotes-wireframe'))) {
    const source = block.querySelector(':scope > .seqnotes-wireframe-src')?.textContent;
    const screen = block.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-frame > .seqnotes-wireframe-screen');
    if (typeof source === 'string' && screen && !screen.shadowRoot) {
      observe(block, showPage(screen, source, false));
    }
  }
  layoutWireframes(root);
}

/**
 * What an event happened on, for the links: the box of the part of a wireframe when it happened in one (the events of
 * its shadow root have its host as their target), else its target.
 */
export function linkTarget(e: Event): Element | null {
  const path = e.composedPath();
  const screen = path.find((el): el is HTMLElement => el instanceof HTMLElement && el.matches('.seqnotes-wireframe-screen'));
  const inner = path[0];
  if (!screen || !(inner instanceof Element) || inner === screen) {
    return e.target as Element | null;
  }
  const number = partNumber(inner.closest('[data-item]')?.getAttribute('data-item') ?? '');
  const box = number === undefined ? null : screen.parentElement?.querySelector(`:scope > .seqnotes-wireframe-parts > .seqnotes-part[data-seqnotes-part="${number}"]`);
  return box ?? screen;
}

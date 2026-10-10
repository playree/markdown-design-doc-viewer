import DOMPurify from 'dompurify';
import mermaid, { type MermaidConfig } from 'mermaid';
import type { DiagramLook, FromWebview, ToWebview, WebviewState } from '../src/protocol';
import type { DiagramMeta } from '../src/render';
import { normalizeLabel } from '../src/sequence';
import { activeFor, isSideBySide, revealCounterpart, scrollColumnTo, scrollToFragment, showActive as showActiveIn, type Active } from './linking';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById('seqnotes-root')!;

const CURRENT = 'seqnotes-current';
const HEADING_RE = /^H([1-6])$/;

let lastHtml: string | undefined;
let splitMinWidth = 1000;
let syncEditor = true;
let tocEnabled = true;
let diagramLook: DiagramLook = 'neo';
let renderSeq = 0;
let pinned: Active | undefined;
let currentLine: number | undefined;
/** `data-seqnotes-key` of the warnings the user closed. The panel is hidden while the warnings are the same. */
let dismissedWarnings: string | undefined;

// ---------------------------------------------------------------------------
// Layout

function applyLayout(): void {
  document.body.classList.toggle('seqnotes-wide', window.innerWidth >= splitMinWidth);
}

window.addEventListener('resize', applyLayout);

const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

function setSplit(percent: number | undefined): void {
  const style = document.documentElement.style;
  if (percent === undefined) {
    style.removeProperty('--seqnotes-split');
  } else {
    percent = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent));
    style.setProperty('--seqnotes-split', `${percent}%`);
  }
  const state = vscode.getState();
  if (state) {
    vscode.setState({ ...state, split: percent });
  }
}

setSplit(vscode.getState()?.split);

/** Lets the user drag the boundary between the diagram and the overview column. */
function addSplitter(pair: Element): void {
  const splitter = document.createElement('div');
  splitter.className = 'seqnotes-splitter';
  // Translated by the extension host (`shell()` in previewPanel.ts).
  splitter.title = document.body.dataset.seqnotesSplitterTitle ?? '';
  pair.querySelector('.seqnotes-seq-col')?.after(splitter);

  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = pair.getBoundingClientRect();
      setSplit(((ev.clientX - r.left) / r.width) * 100);
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
    setSplit(undefined);
  });
}

// ---------------------------------------------------------------------------
// Rendering

function isDarkTheme(): boolean {
  return !document.body.classList.contains('vscode-light') && !document.body.classList.contains('vscode-high-contrast-light');
}

let renderedDark = isDarkTheme();

/** SVGs of the previous render keyed by theme + source, so unchanged diagrams are not re-rendered on every edit. */
let svgCache = new Map<string, string>();

/** mermaid source of each rendered diagram, so that the zoom overlay can follow its diagram across updates. */
const diagramSources = new WeakMap<Element, string>();

/** mermaid is configured globally, so renders run one at a time. */
let renderQueue: Promise<unknown> = Promise.resolve();

function queueRender<T>(render: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(render);
  renderQueue = result.catch(() => undefined);
  return result;
}

/**
 * mermaid settings for `diagramLook`: nothing for `neo`, which mermaid uses by default for most diagrams.
 * A top-level `look` is taken before those per-diagram defaults.
 */
function lookConfig(look: DiagramLook): MermaidConfig {
  return look === 'neo' ? {} : { look };
}

/** Renders the mermaid blocks of `container` and returns the SVGs it used, keyed like `svgCache`. */
async function renderDiagrams(container: HTMLElement, idPrefix: string, dark: boolean): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  // Resets the settings of the previous render, as mermaid.initialize starts from its defaults.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: getComputedStyle(document.body).fontFamily,
    ...lookConfig(diagramLook),
  });

  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.seqnotes-mermaid'));
  for (const [i, block] of blocks.entries()) {
    const pre = block.querySelector('.seqnotes-mermaid-src');
    const metaJson = block.getAttribute('data-seqnotes-meta');
    const meta = metaJson ? (JSON.parse(metaJson) as DiagramMeta) : undefined;
    const id = `${idPrefix}-${i}`;
    const source = pre?.textContent ?? '';
    const key = `${dark}\n${diagramLook}\n${source}`;
    try {
      // A cached SVG carries the element ids of its first render, so reuse it only once per document.
      const cached = cache.has(key) ? undefined : svgCache.get(key);
      const svg = cached ?? (await mermaid.render(id, source)).svg;
      cache.set(key, svg);
      const holder = document.createElement('div');
      holder.className = 'seqnotes-diagram';
      holder.innerHTML = svg;
      diagramSources.set(holder, source);
      pre?.replaceWith(holder);
      const svgEl = holder.querySelector('svg');
      if (meta && svgEl) {
        if (meta.kind === 'flowchart') {
          annotateNodes(svgEl, meta);
        } else {
          annotateMessages(svgEl, meta);
        }
      }
    } catch (error) {
      document.getElementById(`d${id}`)?.remove();
      const message = document.createElement('div');
      message.className = 'seqnotes-error-message';
      message.textContent = `Mermaid: ${error instanceof Error ? error.message : String(error)}`;
      block.classList.add('seqnotes-error');
      block.prepend(message);
    }
  }
  return cache;
}

/** Sanitizes the HTML from the extension host and renders its diagrams into a new element. */
async function buildContent(html: string, idPrefix: string, dark: boolean): Promise<{ content: HTMLElement; cache: Map<string, string> }> {
  const content = document.createElement('div');
  // Raw HTML in Markdown is allowed, so sanitize like the built-in preview does.
  content.append(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }));
  const cache = await queueRender(() => renderDiagrams(content, idPrefix, dark));
  return { content, cache };
}

/** Ties the SVG elements of each message (label texts + arrow) to the parsed message data. */
function annotateMessages(svg: SVGSVGElement, meta: DiagramMeta): void {
  const groups: Element[][] = [];
  let texts: Element[] = [];
  for (const el of Array.from(svg.querySelectorAll('.messageText, [data-et="message"]'))) {
    if (el.matches('[data-et="message"]')) {
      groups.push([...texts, el]);
      texts = [];
    } else {
      texts.push(el);
    }
  }

  let assigned: (DiagramMeta['messages'][number] | undefined)[];
  if (groups.length === meta.messages.length) {
    assigned = meta.messages;
  } else {
    // Parser and mermaid disagree on the message count: fall back to matching labels.
    const unused = [...meta.messages];
    assigned = groups.map((group) => {
      const label = normalizeLabel(group.slice(0, -1).map((t) => t.textContent ?? '').join(' '));
      const i = unused.findIndex((m) => normalizeLabel(m.text) === label);
      return i >= 0 ? unused.splice(i, 1)[0] : undefined;
    });
  }

  groups.forEach((group, i) => {
    const message = assigned[i];
    if (!message) {
      return;
    }
    const arrow = group[group.length - 1];
    const hit = arrow.cloneNode(false) as Element;
    for (const attr of ['marker-start', 'marker-end', 'style', 'class', 'data-et', 'data-id']) {
      hit.removeAttribute(attr);
    }
    hit.classList.add('seqnotes-hit');
    arrow.after(hit);
    // The element that stands for the message, e.g. to scroll to.
    arrow.classList.add('seqnotes-item');
    for (const el of [...group, hit]) {
      el.classList.add('seqnotes-msg');
      el.setAttribute('data-seqnotes-line', String(message.line));
      if (message.target) {
        el.classList.add('seqnotes-linked');
        el.setAttribute('data-seqnotes-target', message.target);
      }
    }
    if (message.target && message.number !== undefined && !message.numberInHeading) {
      arrow.setAttribute('data-seqnotes-number', String(message.number));
    }
    if (message.unlinked) {
      group.slice(0, -1).forEach((text) => text.classList.add('seqnotes-unlinked'));
    }
  });
}

/** The node id of a flowchart node element: its `data-id`, or else the middle of its element id `<svg id>-flowchart-<node id>-<n>`. */
function flowchartNodeId(svg: SVGSVGElement, el: Element): string | undefined {
  const dataId = el.getAttribute('data-id');
  if (dataId !== null) {
    return dataId;
  }
  const id = el.id.startsWith(`${svg.id}-`) ? el.id.slice(svg.id.length + 1) : el.id;
  return /^flowchart-(.+)-\d+$/.exec(id)?.[1];
}

/** Ties the node elements of a flowchart to the parsed node data. */
function annotateNodes(svg: SVGSVGElement, meta: DiagramMeta): void {
  const elements = new Map<string, Element>();
  for (const el of Array.from(svg.querySelectorAll('g.node'))) {
    const id = flowchartNodeId(svg, el);
    if (id !== undefined && !elements.has(id)) {
      elements.set(id, el);
    }
  }
  for (const node of meta.messages) {
    const el = node.nodeId === undefined ? undefined : elements.get(node.nodeId);
    if (!el) {
      continue;
    }
    el.classList.add('seqnotes-node', 'seqnotes-item');
    el.setAttribute('data-seqnotes-line', String(node.line));
    if (node.target) {
      el.classList.add('seqnotes-linked');
      el.setAttribute('data-seqnotes-target', node.target);
    }
    if (node.unlinked) {
      el.classList.add('seqnotes-unlinked');
    }
  }
}

/** Wraps each linked heading and its content into a <section> so it can be highlighted as a whole. */
function wrapSections(pair: Element): void {
  const overview = pair.querySelector('.seqnotes-overview-col');
  if (!overview) {
    return;
  }
  const targets = new Set(Array.from(pair.querySelectorAll('[data-seqnotes-target]'), (el) => el.getAttribute('data-seqnotes-target')));
  const numbers = new Map<string, string[]>();
  for (const arrow of Array.from(pair.querySelectorAll('[data-seqnotes-number]'))) {
    const target = arrow.getAttribute('data-seqnotes-target')!;
    numbers.set(target, [...(numbers.get(target) ?? []), arrow.getAttribute('data-seqnotes-number')!]);
  }
  for (const heading of Array.from(overview.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    if (!targets.has(heading.id)) {
      continue;
    }
    addStepBadge(heading, numbers.get(heading.id));
    const level = headingLevel(heading)!;
    const section = document.createElement('section');
    section.className = 'seqnotes-section';
    section.setAttribute('data-seqnotes-section', heading.id);
    heading.before(section);
    let el: Element | null = heading;
    while (el && !(el !== heading && (headingLevel(el) ?? 7) <= level)) {
      const next: Element | null = el.nextElementSibling;
      section.append(el);
      el = next;
    }
  }
}

/** Shows the `autonumber` numbers of the linked arrows in front of the heading (except those it is numbered with already). */
function addStepBadge(heading: Element, numbers: string[] | undefined): void {
  if (!numbers) {
    return;
  }
  const badge = document.createElement('span');
  badge.className = 'seqnotes-step';
  badge.textContent = numbers.join(', ');
  heading.prepend(badge);
}

/** Adds a close button to the warnings panel, and keeps the panel hidden while the closed warnings stay the same. */
function setUpWarnings(): void {
  // renderDocument puts the panel first; a `.seqnotes-warnings` written in the Markdown is not it.
  const panel = root.firstElementChild;
  if (!(panel instanceof HTMLElement) || !panel.matches('.seqnotes-warnings[data-seqnotes-key]')) {
    return;
  }
  const key = panel.dataset.seqnotesKey;
  // Not cleared when the warnings change for a moment while typing: the panel hides again when they come back.
  panel.hidden = key === dismissedWarnings;
  const close = document.createElement('button');
  close.className = 'seqnotes-warnings-close';
  // Translated by the extension host (`shell()` in previewPanel.ts).
  close.title = document.body.dataset.seqnotesHideWarningsTitle ?? '';
  close.setAttribute('aria-label', close.title);
  close.textContent = '×';
  close.addEventListener('click', () => {
    // Keep what is below the panel where it is on the screen.
    const anchor = panel.nextElementSibling;
    const top = anchor?.getBoundingClientRect().top;
    dismissedWarnings = key;
    panel.hidden = true;
    if (anchor && top !== undefined) {
      window.scrollBy(0, anchor.getBoundingClientRect().top - top);
    }
  });
  panel.prepend(close);
}

function headingLevel(el: Element): number | undefined {
  const m = HEADING_RE.exec(el.tagName);
  return m ? Number(m[1]) : undefined;
}

async function update(html: string): Promise<void> {
  lastHtml = html;
  const seq = ++renderSeq;
  // Set before rendering, so that other class changes of the body do not start another update meanwhile.
  const dark = (renderedDark = isDarkTheme());
  const { content: next, cache } = await buildContent(html, `seqnotes-svg-${seq}`, dark);
  // Kept even when a newer update is waiting: it renders next and can reuse these.
  svgCache = cache;
  if (seq !== renderSeq) {
    return;
  }

  const scrollY = window.scrollY;
  const colScroll = Array.from(root.querySelectorAll('.seqnotes-seq-col'), (col) => col.scrollTop);
  const pinnedState = pinned && { diagram: pinned.pair.getAttribute('data-diagram'), target: pinned.target };

  root.replaceChildren(...Array.from(next.childNodes));
  root.querySelectorAll('.seqnotes-pair').forEach((pair) => {
    wrapSections(pair);
    if (!pair.classList.contains('seqnotes-pair-stacked')) {
      addSplitter(pair);
    }
  });
  setUpWarnings();
  addZoomButtons();
  markZoomableImages();
  if (zoom) {
    setZoomContent();
  }

  window.scrollTo(0, scrollY);
  root.querySelectorAll('.seqnotes-seq-col').forEach((col, i) => (col.scrollTop = colScroll[i] ?? 0));
  buildToc();

  const pair = pinnedState && root.querySelector(`.seqnotes-pair[data-diagram="${pinnedState.diagram}"]`);
  pinned = pair && pair.querySelector(`[data-seqnotes-section="${CSS.escape(pinnedState.target)}"]`) ? { pair, target: pinnedState.target } : undefined;
  showActive(pinned);
  if (currentLine !== undefined) {
    markLine(currentLine, false);
  }
}

// ---------------------------------------------------------------------------
// Table of contents

const TOC_CURRENT = 'seqnotes-toc-current';
/** A heading becomes the current one once its top is above this part of the window. */
const TOC_CURRENT_RATIO = 0.2;

const toc = document.createElement('nav');
toc.className = 'seqnotes-toc';
toc.hidden = true;
const tocTitle = document.createElement('div');
tocTitle.className = 'seqnotes-toc-title';
// Translated by the extension host (`shell()` in previewPanel.ts).
tocTitle.textContent = document.body.dataset.seqnotesTocTitle ?? '';
toc.setAttribute('aria-label', tocTitle.textContent);
const tocList = document.createElement('ol');
toc.append(tocTitle, tocList);
// Outside the root, so the arrow / heading handlers on it do not see the clicks.
document.body.append(toc);

let tocHeadings: Element[] = [];
/** Index of the current item in `tocHeadings`, -1 for none. */
let tocCurrent = -1;

/** The heading text without the `autonumber` badge added by `addStepBadge`. */
function headingText(heading: Element): string {
  const clone = heading.cloneNode(true) as Element;
  clone.querySelectorAll('.seqnotes-step').forEach((badge) => badge.remove());
  return (clone.textContent ?? '').trim();
}

/** Lists the h1-h3 of the rendered document. Shown as a line per heading, opened on hover by the CSS. */
function buildToc(): void {
  const entries = tocEnabled
    ? Array.from(root.querySelectorAll('h1, h2, h3'))
        .map((heading) => ({ heading, level: headingLevel(heading)!, text: headingText(heading) }))
        .filter((entry) => entry.text)
    : [];
  const minLevel = Math.min(...entries.map((entry) => entry.level));
  const scrollTop = tocList.scrollTop;
  tocList.replaceChildren(
    ...entries.map(({ heading, level, text }) => {
      const item = document.createElement('li');
      item.style.setProperty('--seqnotes-toc-depth', String(level - minLevel));
      const button = document.createElement('button');
      button.type = 'button';
      button.title = text;
      const label = document.createElement('span');
      label.className = 'seqnotes-toc-text';
      label.textContent = text;
      button.append(label);
      // Keeps mouse clicks from focusing the button: the list then closes when the mouse leaves, and keys still scroll the page.
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => revealHeading(heading));
      item.append(button);
      return item;
    }),
  );
  tocList.scrollTop = scrollTop;
  tocHeadings = entries.map((entry) => entry.heading);
  tocCurrent = -1;
  toc.hidden = entries.length === 0;
  updateTocCurrent();
}

function revealHeading(heading: Element): void {
  // A heading in a closed <details> is not displayed and would not scroll.
  for (let details = heading.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
    details.open = true;
  }
  heading.scrollIntoView({ block: 'start' });
}

function updateTocCurrent(): void {
  // The last headings may never reach the threshold; at the end of the page take the last one on the screen.
  // Not on a page that does not scroll: it is at the top, and everything on it is on the screen.
  const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
  const threshold = atEnd ? window.innerHeight : window.innerHeight * TOC_CURRENT_RATIO;
  let current = -1;
  for (const [i, heading] of tocHeadings.entries()) {
    const r = heading.getBoundingClientRect();
    // A heading that is not displayed (e.g. in a closed <details>) has an empty rect.
    if (r.height === 0) {
      continue;
    }
    if (r.top > threshold) {
      break;
    }
    current = i;
  }
  if (current === tocCurrent) {
    return;
  }
  setTocCurrent(tocCurrent, false);
  setTocCurrent(current, true);
  tocCurrent = current;
  // Not while open: the list would move under the mouse.
  if (!toc.matches(':hover')) {
    revealTocCurrent();
  }
}

function setTocCurrent(index: number, on: boolean): void {
  const item = tocList.children[index];
  if (!item) {
    return;
  }
  item.classList.toggle(TOC_CURRENT, on);
  // For screen readers, which do not see the highlighted line.
  const button = item.querySelector('button')!;
  if (on) {
    button.setAttribute('aria-current', 'location');
  } else {
    button.removeAttribute('aria-current');
  }
}

/** Scrolls the list (not the page, as scrollIntoView would) so that the current item is in it. */
function revealTocCurrent(): void {
  const item = tocList.children[tocCurrent];
  if (!(item instanceof HTMLElement)) {
    return;
  }
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < tocList.scrollTop) {
    tocList.scrollTop = top;
  } else if (bottom > tocList.scrollTop + tocList.clientHeight) {
    tocList.scrollTop = bottom - tocList.clientHeight;
  }
}

// The closed and the open list are laid out differently, so bring the current item into view on switching.
toc.addEventListener('pointerenter', revealTocCurrent);
toc.addEventListener('pointerleave', revealTocCurrent);
toc.addEventListener('focusin', (e) => {
  if (!toc.contains(e.relatedTarget as Node | null)) {
    revealTocCurrent();
  }
});

let tocFrame = 0;

function scheduleTocCurrent(): void {
  if (!tocFrame) {
    tocFrame = requestAnimationFrame(() => {
      tocFrame = 0;
      updateTocCurrent();
    });
  }
}

window.addEventListener('scroll', scheduleTocCurrent, { passive: true });
window.addEventListener('resize', scheduleTocCurrent);
// Headings also move without scrolling, e.g. when a <details> is toggled or an image is loaded.
new ResizeObserver(scheduleTocCurrent).observe(root);

// ---------------------------------------------------------------------------
// Message <-> heading highlighting

function showActive(active: Active | undefined): void {
  showActiveIn(root, active);
}

root.addEventListener('mouseover', (e) => showActive(activeFor(e.target as Element) ?? pinned));
root.addEventListener('mouseleave', () => showActive(pinned));

root.addEventListener('click', (e) => {
  const target = e.target as Element;
  const link = target.closest('a[href]');
  if (link) {
    e.preventDefault();
    openLink(link.getAttribute('href')!);
    return;
  }
  const image = target.closest<HTMLImageElement>('img.seqnotes-zoomable');
  // Not one that failed to load: there is nothing to show.
  if (image && !(image.complete && image.naturalWidth === 0)) {
    openZoom('image', zoomTargets('image').indexOf(image));
    return;
  }
  const active = activeFor(target);
  if (active) {
    activate(active);
  }
});

/** Pins a clicked message or heading and scrolls its counterpart into view. */
function activate(active: Active & { kind: 'message' | 'heading' }): void {
  pinned = { pair: active.pair, target: active.target };
  showActive(pinned);
  revealCounterpart(active);
}

document.addEventListener('keydown', (e) => {
  if (zoom) {
    zoomKey(e);
    return;
  }
  if (e.key === 'Escape') {
    pinned = undefined;
    showActive(undefined);
  }
});

function openLink(href: string): void {
  if (href.startsWith('#')) {
    scrollToFragment(href);
  } else {
    vscode.postMessage({ type: 'openLink', href });
  }
}

// ---------------------------------------------------------------------------
// Export

/**
 * Renders the HTML of an exported file (`renderDocument` with `forExport`) with the light theme,
 * and returns the body without the data only the preview script uses.
 */
async function exportBody(id: number, html: string): Promise<string> {
  const { content } = await buildContent(html, `seqnotes-export-${id}`, false);
  content.querySelectorAll('.seqnotes-pair').forEach(wrapSections);
  for (const attr of ['data-seqnotes-meta', 'data-seqnotes-line']) {
    content.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
  return content.innerHTML;
}

// ---------------------------------------------------------------------------
// Diagram / image zoom

const ZOOM_STEP = 1.25;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
/** Space kept around a diagram fitted to the overlay, in px. */
const ZOOM_MARGIN = 24;
/** A pointer that moves farther than this (px) pans instead of clicking. */
const DRAG_THRESHOLD = 4;

const ZOOM_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const FIT_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

type ZoomKind = 'diagram' | 'image';

interface Zoom {
  kind: ZoomKind;
  /** Index of the diagram or image among those of the document (`zoomTargets`). */
  index: number;
  /** Its `zoomSource` and the number of diagrams or images, to find it again after an update. */
  source: string | undefined;
  count: number;
  /** true while the whole diagram or image is shown, so that it is fitted again when the window is resized. */
  fitted: boolean;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The open zoom overlay, if any. */
let zoom: Zoom | undefined;

const zoomOverlay = document.createElement('div');
zoomOverlay.className = 'seqnotes-zoom';
zoomOverlay.hidden = true;
zoomOverlay.tabIndex = -1;
const zoomStage = document.createElement('div');
zoomStage.className = 'seqnotes-zoom-stage';
const zoomToolbar = document.createElement('div');
zoomToolbar.className = 'seqnotes-zoom-toolbar';

/** A toolbar button. Titles are translated by the extension host (`shell()` in previewPanel.ts). */
function zoomButton(content: string, title: string | undefined, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = content;
  button.title = title ?? '';
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', onClick);
  return button;
}

const zoomCenter = (): [number, number] => [zoomOverlay.clientWidth / 2, zoomOverlay.clientHeight / 2];
const titles = document.body.dataset;
zoomToolbar.append(
  zoomButton('+', titles.seqnotesZoomInTitle, () => zoomAt(ZOOM_STEP, ...zoomCenter())),
  zoomButton('&minus;', titles.seqnotesZoomOutTitle, () => zoomAt(1 / ZOOM_STEP, ...zoomCenter())),
  zoomButton(FIT_ICON, titles.seqnotesZoomFitTitle, () => fitZoom()),
  zoomButton('&times;', titles.seqnotesZoomCloseTitle, () => closeZoom()),
);
zoomOverlay.append(zoomStage, zoomToolbar);
// Outside the root, so the arrow / heading handlers on it do not see the events.
document.body.append(zoomOverlay);

/** The diagram holders or the images that open in the zoom overlay, in document order. */
function zoomTargets(kind: ZoomKind): Element[] {
  return Array.from(root.querySelectorAll(kind === 'diagram' ? '.seqnotes-diagram' : 'img.seqnotes-zoomable'));
}

/** What tells a diagram or image apart from the others across updates. */
function zoomSource(kind: ZoomKind, el: Element | undefined): string | undefined {
  return kind === 'diagram' ? el && diagramSources.get(el) : (el as HTMLImageElement | undefined)?.src;
}

/** Adds a button that opens the diagram in the zoom overlay, shown when hovering it. */
function addZoomButtons(): void {
  zoomTargets('diagram').forEach((holder, index) => {
    const button = zoomButton(ZOOM_ICON, titles.seqnotesZoomTitle, () => openZoom('diagram', index));
    button.className = 'seqnotes-zoom-button';
    // Not a jump to the source line.
    button.addEventListener('dblclick', (e) => e.stopPropagation());
    holder.prepend(button);
  });
}

/**
 * Marks the images that open in the zoom overlay on click. Not those in a link, which opens the link,
 * in a heading, which is pinned instead (e.g. an icon), nor in a diagram.
 */
function markZoomableImages(): void {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    if (!image.closest('a[href], h1, h2, h3, h4, h5, h6, .seqnotes-diagram')) {
      image.classList.add('seqnotes-zoomable');
    }
  }
}

function openZoom(kind: ZoomKind, index: number): void {
  const targets = zoomTargets(kind);
  zoom = { kind, index, source: zoomSource(kind, targets[index]), count: targets.length, fitted: true, scale: 1, x: 0, y: 0, width: 0, height: 0 };
  zoomOverlay.hidden = false;
  if (setZoomContent()) {
    fitZoom();
    zoomOverlay.focus();
  }
}

function closeZoom(): void {
  zoom = undefined;
  zoomOverlay.hidden = true;
  zoomStage.replaceChildren();
}

/**
 * Puts a copy of the diagram or image into the overlay, keeping the scale and position.
 * Closes it when the diagram or image is gone.
 */
function setZoomContent(): boolean {
  if (!zoom) {
    return false;
  }
  const { kind } = zoom;
  const targets = zoomTargets(kind);
  // The same one: still at its place (which tells apart those with the same source), or moved.
  // When it was edited, the one at the same place if none was added or removed.
  const unmoved = zoomSource(kind, targets[zoom.index]) === zoom.source;
  const index = unmoved ? zoom.index : targets.findIndex((target) => zoomSource(kind, target) === zoom!.source);
  zoom.index = index >= 0 ? index : targets.length === zoom.count ? zoom.index : -1;
  zoom.source = zoomSource(kind, targets[zoom.index]);
  zoom.count = targets.length;
  const target = targets[zoom.index];
  if (target instanceof HTMLImageElement) {
    setZoomImage(target);
    return true;
  }
  const svg = target?.querySelector<SVGSVGElement>(':scope > svg');
  if (!svg) {
    closeZoom();
    return false;
  }
  const box = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  zoom.width = box?.width || rect.width;
  zoom.height = box?.height || rect.height;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // mermaid sizes the SVG to its container with a max-width.
  copy.removeAttribute('style');
  copy.setAttribute('width', String(zoom.width));
  copy.setAttribute('height', String(zoom.height));
  zoomStage.replaceChildren(copy);
  applyZoom();
  return true;
}

function setZoomImage(image: HTMLImageElement): void {
  // Kept on updates, so that the image is not loaded again while typing.
  const shown = zoomStage.firstElementChild;
  if (shown instanceof HTMLImageElement && shown.src === image.src) {
    return;
  }
  const copy = image.cloneNode(false) as HTMLImageElement;
  copy.removeAttribute('width');
  copy.removeAttribute('height');
  copy.removeAttribute('style');
  // The overlay pans on drag instead.
  copy.classList.remove('seqnotes-zoomable');
  copy.draggable = false;
  const measure = () => {
    if (!zoom) {
      return;
    }
    // An SVG image without a size of its own has no natural size: take the one it is shown with.
    const rect = image.getBoundingClientRect();
    zoom.width = copy.naturalWidth || image.naturalWidth || rect.width || zoom.width;
    zoom.height = copy.naturalHeight || image.naturalHeight || rect.height || zoom.height;
    copy.style.width = `${zoom.width}px`;
    copy.style.height = `${zoom.height}px`;
  };
  measure();
  if (!copy.complete) {
    // Still loading: fit it once its size is known.
    copy.addEventListener('load', () => {
      if (zoom && zoomStage.contains(copy)) {
        measure();
        if (zoom.fitted) {
          fitZoom();
        }
      }
    });
  }
  zoomStage.replaceChildren(copy);
  applyZoom();
}

function applyZoom(): void {
  if (zoom) {
    zoomStage.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  }
}

/** Shows the whole diagram or image in the middle of the overlay. */
function fitZoom(): void {
  if (!zoom || zoom.width === 0 || zoom.height === 0) {
    return;
  }
  const width = zoomOverlay.clientWidth;
  const height = zoomOverlay.clientHeight;
  // An image is not enlarged beyond its own size, which would only blur it.
  const maxScale = zoom.kind === 'image' ? 1 : MAX_SCALE;
  zoom.scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.min((width - 2 * ZOOM_MARGIN) / zoom.width, (height - 2 * ZOOM_MARGIN) / zoom.height)));
  zoom.x = (width - zoom.width * zoom.scale) / 2;
  zoom.y = (height - zoom.height * zoom.scale) / 2;
  zoom.fitted = true;
  applyZoom();
}

/** Scales by `factor` keeping the point (x, y) of the overlay where it is. */
function zoomAt(factor: number, x: number, y: number): void {
  if (!zoom) {
    return;
  }
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom.scale * factor));
  zoom.x = x - ((x - zoom.x) * scale) / zoom.scale;
  zoom.y = y - ((y - zoom.y) * scale) / zoom.scale;
  zoom.scale = scale;
  zoom.fitted = false;
  applyZoom();
}

function zoomKey(e: KeyboardEvent): void {
  const [x, y] = zoomCenter();
  switch (e.key) {
    case 'Escape':
      closeZoom();
      break;
    case '+':
    case '=':
      zoomAt(ZOOM_STEP, x, y);
      break;
    case '-':
      zoomAt(1 / ZOOM_STEP, x, y);
      break;
    case '0':
      fitZoom();
      break;
    default:
      return;
  }
  e.preventDefault();
}

zoomOverlay.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = zoomOverlay.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

/** true while the pointer pans, so that releasing it is not taken as a click. */
let zoomDragged = false;

// On the whole overlay, so that the empty space around a small diagram pans it too.
zoomOverlay.addEventListener('pointerdown', (e) => {
  if (!zoom || e.button !== 0 || zoomToolbar.contains(e.target as Node)) {
    return;
  }
  const start = { x: e.clientX, y: e.clientY, zoomX: zoom.x, zoomY: zoom.y };
  zoomDragged = false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!zoomDragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    if (!zoomDragged) {
      // Captured only now: a capture from the start would make a click on an arrow target the overlay.
      zoomDragged = true;
      zoomOverlay.setPointerCapture(ev.pointerId);
      zoomOverlay.classList.add('seqnotes-zoom-dragging');
    }
    if (zoom) {
      zoom.x = start.zoomX + dx;
      zoom.y = start.zoomY + dy;
      zoom.fitted = false;
      applyZoom();
    }
  };
  const up = () => {
    zoomOverlay.classList.remove('seqnotes-zoom-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

zoomOverlay.addEventListener('dblclick', (e) => {
  if (!zoomToolbar.contains(e.target as Node)) {
    fitZoom();
  }
});

// A linked arrow in the overlay: close it and show the step, like a click on the arrow in the preview.
zoomStage.addEventListener('click', (e) => {
  const message = (e.target as Element).closest('[data-seqnotes-target]');
  const pair = zoom?.kind === 'diagram' && zoomTargets('diagram')[zoom.index]?.closest('.seqnotes-pair');
  if (zoomDragged || !message || !pair) {
    return;
  }
  closeZoom();
  activate({ pair, target: message.getAttribute('data-seqnotes-target')!, kind: 'message' });
});

// Not after the user zoomed or panned: they would lose their place, e.g. when a side bar is toggled.
window.addEventListener('resize', () => {
  if (zoom?.fitted) {
    fitZoom();
  }
});

// ---------------------------------------------------------------------------
// Editor sync

function lineOf(el: Element): number {
  return Number(el.getAttribute('data-seqnotes-line') ?? el.getAttribute('data-seqnotes-jump') ?? el.getAttribute('data-line'));
}

/** Block elements carrying source lines, in document order, usable for page scrolling. */
function lineElements(): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-line]')).filter(
    (el) => !(el.closest('.seqnotes-seq-col') && isSideBySide(el)) && el.offsetParent !== null,
  );
}

/** The arrow or node defined on `line`. */
function messageAt(line: number): Element | undefined {
  // A flowchart line may define several nodes: prefer a linked one.
  const items = `.seqnotes-item[data-seqnotes-line="${line}"]`;
  return root.querySelector(`${items}[data-seqnotes-target]`) ?? root.querySelector(items) ?? undefined;
}

function scrollToLine(line: number): void {
  const message = messageAt(line);
  if (message && isSideBySide(message)) {
    scrollColumnTo(message, false);
    return;
  }
  const elements = lineElements();
  let prev: HTMLElement | undefined;
  let next: HTMLElement | undefined;
  for (const el of elements) {
    if (lineOf(el) <= line) {
      prev = el;
    } else {
      next = el;
      break;
    }
  }
  if (!prev) {
    window.scrollTo(0, 0);
    return;
  }
  const top = (el: Element): number => el.getBoundingClientRect().top + window.scrollY;
  let y = top(prev);
  if (next && lineOf(next) > lineOf(prev)) {
    y += ((line - lineOf(prev)) / (lineOf(next) - lineOf(prev))) * (top(next) - top(prev));
  }
  window.scrollTo(0, y);
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const col = el.closest('.seqnotes-seq-col');
  const bounds = col && isSideBySide(col) ? col.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  return r.bottom > bounds.top && r.top < bounds.bottom && r.top >= 0 && r.bottom <= window.innerHeight;
}

function markLine(line: number, reveal: boolean): void {
  currentLine = line;
  root.querySelectorAll(`.${CURRENT}`).forEach((el) => el.classList.remove(CURRENT));

  const message = messageAt(line);
  if (message) {
    root.querySelectorAll(`[data-seqnotes-line="${line}"]`).forEach((el) => el.classList.add(CURRENT));
    const active = activeFor(message);
    if (active) {
      pinned = { pair: active.pair, target: active.target };
      showActive(pinned);
    }
    if (reveal && !isVisible(message)) {
      scrollColumnTo(message, true);
    }
    return;
  }

  let found: HTMLElement | undefined;
  for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
    if (lineOf(el) <= line) {
      found = el;
    } else {
      break;
    }
  }
  if (found) {
    found.classList.add(CURRENT);
    if (reveal && !isVisible(found)) {
      found.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

root.addEventListener('dblclick', (e) => {
  if (!syncEditor) {
    return;
  }
  const el = (e.target as Element).closest('[data-seqnotes-line], [data-seqnotes-jump], [data-line]');
  if (el) {
    vscode.postMessage({ type: 'revealLine', line: lineOf(el) });
  }
});

// ---------------------------------------------------------------------------
// Wiring

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'update':
      splitMinWidth = message.splitMinWidth;
      syncEditor = message.syncEditor;
      tocEnabled = message.toc;
      diagramLook = message.diagramLook;
      vscode.setState({ ...vscode.getState(), uri: message.uri });
      applyLayout();
      void update(message.html);
      break;
    case 'scrollToLine':
      scrollToLine(message.line);
      break;
    case 'markLine':
      markLine(message.line, true);
      break;
    case 'export':
      exportBody(message.id, message.html).then(
        (body) => vscode.postMessage({ type: 'exported', id: message.id, body }),
        (error: unknown) => vscode.postMessage({ type: 'exported', id: message.id, error: error instanceof Error ? error.message : String(error) }),
      );
      break;
  }
});

// VS Code switches the body class when the color theme changes.
new MutationObserver(() => {
  if (lastHtml !== undefined && isDarkTheme() !== renderedDark) {
    void update(lastHtml);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

vscode.postMessage({ type: 'ready' });

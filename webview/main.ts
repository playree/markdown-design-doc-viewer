import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import type { FromWebview, ToWebview, WebviewState } from '../src/protocol';
import type { DiagramMeta } from '../src/render';
import { normalizeLabel } from '../src/sequence';
import { HEADING_ID_PREFIX, slugify } from '../src/slug';

interface VsCodeApi {
  postMessage(message: FromWebview): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Active {
  pair: Element;
  target: string;
}

const vscode = acquireVsCodeApi();
const root = document.getElementById('seqnotes-root')!;

const ACTIVE = 'seqnotes-active';
const CURRENT = 'seqnotes-current';
const HEADING_RE = /^H([1-6])$/;

let lastHtml: string | undefined;
let splitMinWidth = 1000;
let syncEditor = true;
let tocEnabled = true;
let renderSeq = 0;
let pinned: Active | undefined;
let currentLine: number | undefined;
/** `data-seqnotes-key` of the warnings the user closed. The panel is hidden while the warnings are the same. */
let dismissedWarnings: string | undefined;

// ---------------------------------------------------------------------------
// Layout

const isWide = (): boolean => document.body.classList.contains('seqnotes-wide');

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

async function renderDiagrams(container: HTMLElement, seq: number): Promise<void> {
  renderedDark = isDarkTheme();
  const cache = new Map<string, string>();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: renderedDark ? 'dark' : 'default',
    fontFamily: getComputedStyle(document.body).fontFamily,
  });

  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.seqnotes-mermaid'));
  for (const [i, block] of blocks.entries()) {
    const pre = block.querySelector('.seqnotes-mermaid-src');
    const metaJson = block.getAttribute('data-seqnotes-meta');
    const meta = metaJson ? (JSON.parse(metaJson) as DiagramMeta) : undefined;
    const id = `seqnotes-svg-${seq}-${i}`;
    const source = pre?.textContent ?? '';
    const key = `${renderedDark}\n${source}`;
    try {
      // A cached SVG carries the element ids of its first render, so reuse it only once per document.
      const cached = cache.has(key) ? undefined : svgCache.get(key);
      const svg = cached ?? (await mermaid.render(id, source)).svg;
      cache.set(key, svg);
      const holder = document.createElement('div');
      holder.className = 'seqnotes-diagram';
      holder.innerHTML = svg;
      pre?.replaceWith(holder);
      const svgEl = holder.querySelector('svg');
      if (meta && svgEl) {
        annotateMessages(svgEl, meta);
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
  svgCache = cache;
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
  const next = document.createElement('div');
  // Raw HTML in Markdown is allowed, so sanitize like the built-in preview does.
  next.append(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }));
  await renderDiagrams(next, seq);
  if (seq !== renderSeq) {
    return;
  }

  const scrollY = window.scrollY;
  const colScroll = Array.from(root.querySelectorAll('.seqnotes-seq-col'), (col) => col.scrollTop);
  const pinnedState = pinned && { diagram: pinned.pair.getAttribute('data-diagram'), target: pinned.target };

  root.replaceChildren(...Array.from(next.childNodes));
  root.querySelectorAll('.seqnotes-pair').forEach((pair) => {
    wrapSections(pair);
    addSplitter(pair);
  });
  setUpWarnings();

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
  root.querySelectorAll(`.${ACTIVE}`).forEach((el) => el.classList.remove(ACTIVE));
  if (!active) {
    return;
  }
  const target = CSS.escape(active.target);
  active.pair.querySelectorAll(`[data-seqnotes-target="${target}"], [data-seqnotes-section="${target}"]`).forEach((el) => el.classList.add(ACTIVE));
}

/** The message or linked heading under an event target. */
function activeFor(el: Element | null): (Active & { kind: 'message' | 'heading' }) | undefined {
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

function scrollColumnTo(el: Element, smooth: boolean): void {
  const col = el.closest('.seqnotes-seq-col');
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  if (col && isWide()) {
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
  const active = activeFor(target);
  if (!active) {
    return;
  }
  pinned = { pair: active.pair, target: active.target };
  showActive(pinned);
  const escaped = CSS.escape(active.target);
  if (active.kind === 'message') {
    // 'nearest' keeps the page still when the section is already visible, so the sticky diagram stays in view.
    active.pair.querySelector(`[data-seqnotes-section="${escaped}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    const arrow = active.pair.querySelector(`[data-et="message"][data-seqnotes-target="${escaped}"]`);
    if (arrow) {
      scrollColumnTo(arrow, true);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pinned = undefined;
    showActive(undefined);
  }
});

function openLink(href: string): void {
  if (href.startsWith('#')) {
    let name = href.slice(1);
    try {
      name = decodeURIComponent(name);
    } catch {
      // keep the raw fragment
    }
    const target =
      document.getElementById(HEADING_ID_PREFIX + name) ??
      document.getElementById(HEADING_ID_PREFIX + slugify(name)) ??
      document.getElementById(name);
    target?.scrollIntoView({ block: 'start' });
  } else {
    vscode.postMessage({ type: 'openLink', href });
  }
}

// ---------------------------------------------------------------------------
// Editor sync

function lineOf(el: Element): number {
  return Number(el.getAttribute('data-seqnotes-line') ?? el.getAttribute('data-seqnotes-jump') ?? el.getAttribute('data-line'));
}

/** Block elements carrying source lines, in document order, usable for page scrolling. */
function lineElements(): HTMLElement[] {
  const wide = isWide();
  return Array.from(root.querySelectorAll<HTMLElement>('[data-line]')).filter(
    (el) => !(wide && el.closest('.seqnotes-seq-col')) && el.offsetParent !== null,
  );
}

function messageAt(line: number): Element | undefined {
  return root.querySelector(`[data-et="message"][data-seqnotes-line="${line}"]`) ?? undefined;
}

function scrollToLine(line: number): void {
  const message = messageAt(line);
  if (message && isWide()) {
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
  const bounds = col && isWide() ? col.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
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
  }
});

// VS Code switches the body class when the color theme changes.
new MutationObserver(() => {
  if (lastHtml !== undefined && isDarkTheme() !== renderedDark) {
    void update(lastHtml);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

vscode.postMessage({ type: 'ready' });

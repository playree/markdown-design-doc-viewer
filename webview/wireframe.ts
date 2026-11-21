/**
 * The wireframes of a document (src/markdown/wireframe.ts), shared by the preview (preview.ts) and exported HTML (export.ts).
 * Their HTML is shown in a shadow root, so that its styles and those of the page do not apply to each other, and works
 * as a page (its text can be selected, its form controls used), without leaving the document: its links and forms do not
 * navigate. A box is drawn over each of their parts (`data-item`), with its number: it stands for the part like a node
 * of a diagram, linked to the headings and rows (webview/linking.ts). The pointer events of the page are given to it
 * (`linkTarget`).
 *
 * Its styles work as in a browser as far as possible (e.g. those of a page captured by `md-design-doc capture`): `:root`
 * matches its <html>, and the rules that a shadow root ignores (`@font-face`, `@property`) are given to the document. The
 * parts written as selectors in its options are numbered as if they had `data-item`.
 *
 * The block of a wireframe (`wireframeBlock` in src/markdown/render.ts) keeps its HTML in a <pre>, sanitized by the preview,
 * from which exported HTML shows it again (the shadow root is not part of the exported body).
 */
import type { DiagramMeta } from '../src/markdown/render';
import { partNumber } from '../src/markdown/wireframe';

/** Before the styles of the wireframe: its page shown as in a browser, whatever the colors and font of the page around it. */
const BASE_STYLE = ':host { all: initial; display: block; } html { display: block; background: #fff; color: #000; color-scheme: light; } head { display: none; }';

/** `:root`, which matches nothing in a shadow root: there, the <html> of the page. */
const ROOT_RE = /:root(?![\w-])/g;

/** Constructed style sheets (Safari 16.4 and later): without them, the styles of a wireframe are kept as they are. */
const constructable = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype;

/**
 * The rules of the wireframes that only work in the document, not in a shadow root (`@font-face`, `@property`, e.g. of
 * Tailwind CSS): each one once, for all of them.
 */
let documentRules: CSSStyleSheet | undefined;
const documentRuleTexts = new Set<string>();

/** true for a rule that only works in the document. */
const isDocumentRule = (rule: CSSRule): boolean =>
  rule instanceof CSSFontFaceRule || (typeof CSSPropertyRule === 'function' && rule instanceof CSSPropertyRule);

/** Gives `rule` to the document, once. */
function addDocumentRule(rule: CSSRule): void {
  if (!documentRules) {
    documentRules = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, documentRules];
  }
  if (!documentRuleTexts.has(rule.cssText)) {
    documentRuleTexts.add(rule.cssText);
    documentRules.insertRule(rule.cssText, documentRules.cssRules.length);
  }
}

/** How a wireframe is shown (`mountWireframe`). */
export interface WireframeOptions {
  /**
   * Keeps its styles from reaching the page around it (the `restrictHtml` of an embedded viewer, whose page is the
   * app's): its rules that only work in the document (`@font-face`, `@property`) are left out instead of given to it,
   * and so are its rules of `:host`, which could take the screen out of its place (`position: fixed !important`).
   */
  restricted?: boolean;
  /** Where the pages of the wireframes of the viewer are kept, if anywhere. */
  pages?: PreparedPages;
}

/**
 * Marks the block of a wireframe shown `restricted` (`WireframeOptions`), so that an exported page shows it again so
 * (`remountWireframes`): the HTML kept in its block is that of the wireframe before its styles are restricted.
 */
const RESTRICTED_ATTR = 'data-seqnotes-wireframe-restricted';

/** A rule of the shadow host (`:host`, `:host()`, `:host-context()`), which the page of a wireframe does not need. */
const HOST_RE = /:host(?![\w-])|:host-context\b/;

/**
 * The style sheet of a <style> of a wireframe, to be adopted by its shadow root: its `:root` matching its <html>,
 * and its rules that only work in the document given to it (`addDocumentRule`), or left out when `restricted` (with
 * its rules of `:host`). Without its `@import`s.
 */
function pageSheet(style: HTMLStyleElement, restricted: boolean): CSSStyleSheet {
  const sheet = new CSSStyleSheet(style.media ? { media: style.media } : {});
  sheet.replaceSync(style.textContent ?? '');
  const visit = (parent: CSSStyleSheet | CSSGroupingRule | CSSStyleRule): void => {
    for (let i = parent.cssRules.length - 1; i >= 0; i--) {
      const rule = parent.cssRules[i];
      if (isDocumentRule(rule)) {
        if (!restricted) {
          addDocumentRule(rule);
        }
        parent.deleteRule(i);
        continue;
      }
      if (restricted && rule instanceof CSSStyleRule && HOST_RE.test(rule.selectorText)) {
        parent.deleteRule(i);
        continue;
      }
      if (rule instanceof CSSStyleRule) {
        const selector = rule.selectorText.replace(ROOT_RE, ':is(:root, html)');
        if (selector !== rule.selectorText) {
          rule.selectorText = selector;
        }
      }
      if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) {
        visit(rule);
      }
    }
  };
  visit(sheet);
  return sheet;
}

/** The `@import`s of the text of a <style>, which a constructed style sheet leaves out. */
const IMPORT_RE = /@import\b(?:[^;"']|"[^"]*"|'[^']*')*;/gi;

/** A page of a wireframe made ready to be shown (`preparePage`): parsed, with its styles as sheets. */
export interface PreparedPage {
  /** Its <html>, without its <style> elements when they are adopted as `sheets`: to be imported in each shadow root. */
  page: HTMLElement;
  /** Its <style> elements as sheets that work in a shadow root as in the document; undefined when they cannot be made. */
  sheets?: CSSStyleSheet[];
  /** The `@import`s of its <style> elements, which the sheets leave out: kept in a <style> before them. */
  imports: string;
}

/**
 * The pages of the wireframes prepared by a viewer (`WireframeOptions.pages`), by their (sanitized) HTML and whether
 * they are restricted: a wireframe that did not change is not parsed again, nor its styles made into sheets, at each
 * update of the document. The sheets are shared by the shadow roots that show it. Only the pages of the last render are
 * kept (`nextRender`), as a page with its styles may be large.
 */
export class PreparedPages {
  private previous = new Map<string, PreparedPage>();
  private current = new Map<string, PreparedPage>();

  /** Starts a render: the pages that it does not use are dropped at the next one. */
  nextRender(): void {
    this.previous = this.current;
    this.current = new Map();
  }

  /** The page kept for `key`, kept for this render too. */
  get(key: string): PreparedPage | undefined {
    const page = this.current.get(key) ?? this.previous.get(key);
    if (page) {
      this.current.set(key, page);
    }
    return page;
  }

  /** Keeps the page of `key` for this render. */
  set(key: string, page: PreparedPage): void {
    this.current.set(key, page);
  }
}

/**
 * The page of a wireframe, parsed as a document, so that it keeps its <html> and <body>, which its styles may select.
 * Its styles are made into sheets that work in a shadow root as in the document (`pageSheet`): its `@import`s are kept
 * apart, unless `restricted`, as the rules they import cannot be seen before they are loaded (`:host`, `@font-face`).
 */
function preparePage(html: string, restricted: boolean, pages: PreparedPages | undefined): PreparedPage {
  const key = `${restricted ? 1 : 0}${html}`;
  const kept = pages?.get(key);
  if (kept) {
    return kept;
  }
  const page = new DOMParser().parseFromString(html, 'text/html').documentElement;
  const styles = Array.from(page.querySelectorAll('style'));
  let prepared: PreparedPage;
  if (!constructable) {
    // Kept as they are, without a way to leave out their rules: none, when `restricted`.
    if (restricted) {
      styles.forEach((style) => style.remove());
    }
    prepared = { page, imports: '' };
  } else {
    const imports = restricted ? [] : styles.flatMap((style) => (style.textContent ?? '').match(IMPORT_RE) ?? []);
    prepared = { page, sheets: styles.map((style) => pageSheet(style, restricted)), imports: imports.join('\n') };
    styles.forEach((style) => style.remove());
  }
  pages?.set(key, prepared);
  return prepared;
}

/**
 * Numbers the elements of the parts written as selectors in the options (`items`), as if they had `data-item`: an
 * element already numbered by a selector before keeps its number. Returns the problems with them.
 */
function numberParts(shadow: ShadowRoot, items: [number, string][], block: HTMLElement): string[] {
  const notes: string[] = [];
  // Translated by the host (`data-seqnotes-item-*` by src/markdown/render.ts).
  const message = (template: string | undefined, number: number, selector: string): string =>
    (template ?? '').replace(/\{([01])\}/g, (_match, n: string) => (n === '0' ? String(number) : selector));
  const numbered = new Set<Element>();
  for (const [number, selector] of items) {
    let elements: Element[];
    try {
      elements = Array.from(shadow.querySelectorAll(selector.replace(ROOT_RE, 'html'))).filter((element) => !numbered.has(element));
    } catch {
      notes.push(message(block.dataset.seqnotesItemInvalid, number, selector));
      continue;
    }
    if (elements.length === 0) {
      notes.push(message(block.dataset.seqnotesItemUnmatched, number, selector));
    }
    for (const element of elements) {
      element.setAttribute('data-item', String(number));
      numbered.add(element);
    }
  }
  return notes;
}

/** The parts of a wireframe written as selectors in its options (`data-seqnotes-items`, by src/markdown/render.ts). */
function itemsOf(block: HTMLElement): [number, string][] {
  try {
    return JSON.parse(block.dataset.seqnotesItems ?? '[]') as [number, string][];
  } catch {
    return [];
  }
}

/**
 * Shows the (sanitized) HTML of a wireframe of `block` in a shadow root of `screen`, with the parts of its options
 * numbered. Returns the shadow root, and the problems with the selectors of the parts.
 */
function showPage(block: HTMLElement, screen: HTMLElement, html: string, { restricted = false, pages }: WireframeOptions = {}): { shadow: ShadowRoot; notes: string[] } {
  const shadow = screen.attachShadow({ mode: 'open' });
  // A mock-up: its links and forms do not leave the document.
  for (const type of ['click', 'auxclick']) {
    shadow.addEventListener(type, (e) => {
      if ((e.target as Element).closest('a[href], area[href]')) {
        e.preventDefault();
      }
    });
  }
  shadow.addEventListener('submit', (e) => e.preventDefault());
  // Moving from one element of the page to another, the event does not leave the shadow root (both are its host outside
  // of it): tell the page around it again, so that it highlights the part hovered (`linkTarget`).
  shadow.addEventListener('mouseover', (event) => {
    const e = event as MouseEvent;
    if (e.relatedTarget instanceof Node && shadow.contains(e.relatedTarget)) {
      e.target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true, clientX: e.clientX, clientY: e.clientY }));
    }
  });
  const style = document.createElement('style');
  style.textContent = BASE_STYLE;
  shadow.append(style);
  const { page, sheets, imports } = preparePage(html, restricted, pages);
  if (imports) {
    const importing = document.createElement('style');
    importing.textContent = imports;
    shadow.append(importing);
  }
  if (sheets) {
    shadow.adoptedStyleSheets = sheets;
  }
  shadow.append(document.importNode(page, true));
  return { shadow, notes: numberParts(shadow, itemsOf(block), block) };
}

/**
 * The HTML of a wireframe in a shadow root, and a box over each of its parts, which `watchWireframes` keeps over them
 * once it is in the page. Returns the frame of the two.
 */
export function mountWireframe(block: HTMLElement, html: string, meta: DiagramMeta | undefined, options: WireframeOptions = {}): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'seqnotes-wireframe-frame';
  const screen = document.createElement('div');
  screen.className = 'seqnotes-wireframe-screen';
  const { shadow, notes } = showPage(block, screen, html, options);
  block.toggleAttribute(RESTRICTED_ATTR, options.restricted === true);

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
  for (const note of notes) {
    const p = document.createElement('p');
    p.className = 'seqnotes-wireframe-note';
    p.textContent = note;
    block.append(p);
  }
  return frame;
}

/**
 * Lays the wireframes out again when their block (its column) or their page (e.g. an image loaded) is resized. Made by
 * the first `observe`: not when the module is imported, which may be on a server, without a `ResizeObserver`.
 */
let resizes: ResizeObserver | undefined;

const onResize = (entries: ResizeObserverEntry[]): void => {
  const blocks = new Set<HTMLElement>();
  for (const { target } of entries) {
    const block = target instanceof HTMLElement && target.matches('.seqnotes-wireframe') ? target : observed.get(target);
    if (!block?.isConnected) {
      // Removed by an update.
      resizes?.unobserve(target);
    } else {
      blocks.add(block);
    }
  }
  layoutBlocks(blocks);
};

/** The block of each page observed. */
const observed = new WeakMap<Element, HTMLElement>();

function observe(block: HTMLElement, shadow: ShadowRoot): void {
  const page = shadow.querySelector('html');
  resizes ??= new ResizeObserver(onResize);
  resizes.observe(block);
  if (page) {
    observed.set(page, block);
    resizes.observe(page);
  }
}

/**
 * Sizes the wireframes of `blocks`: each as wide as its block, or laid out at the width of its options and scaled down to
 * the block. Then puts the boxes of their parts over them. All the blocks are measured before they are written, and
 * again after, so that the browser lays the page out a few times for all of them, not for each element.
 */
function layoutBlocks(blocks: Iterable<HTMLElement>): void {
  const shown: { block: HTMLElement; frame: HTMLElement; screen: HTMLElement; shadow: ShadowRoot; width?: number }[] = [];
  for (const block of blocks) {
    const frame = block.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-frame');
    const screen = frame?.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-screen');
    const shadow = screen?.shadowRoot;
    // Not shown (e.g. in a closed <details>): laid out once it is.
    if (frame && screen && shadow && block.clientWidth > 0) {
      shown.push({ block, frame, screen, shadow, width: Number(block.dataset.seqnotesWidth) || undefined });
    }
  }

  // The width of the options: the scales read, then the screens written, then their heights read for the frames.
  const scaled = shown.flatMap(({ block, frame, screen, width }) => {
    if (width === undefined) {
      return [];
    }
    const style = getComputedStyle(block);
    const available = block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return [{ frame, screen, width, scale: Math.min(1, available / width) }];
  });
  for (const { screen, width, scale } of scaled) {
    screen.style.width = `${width}px`;
    screen.style.transform = scale < 1 ? `scale(${scale})` : '';
  }
  const heights = scaled.map(({ screen }) => screen.offsetHeight);
  scaled.forEach(({ frame, width, scale }, i) => {
    frame.style.width = `${width * scale}px`;
    frame.style.height = `${heights[i] * scale}px`;
  });

  // The boxes of the parts: all the elements measured, then the boxes written.
  const placements = shown.flatMap(({ frame, shadow }) => {
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
    const { clientLeft, clientTop } = frame;
    return Array.from(frame.querySelectorAll<HTMLElement>('.seqnotes-part'), (box) => {
      const r = elements.get(Number(box.dataset.seqnotesPart))?.[Number(box.dataset.seqnotesPartIndex)]?.getBoundingClientRect();
      // An element not shown has no box.
      const place = r && (r.width > 0 || r.height > 0)
        ? { left: (r.left - origin.left) / factor - clientLeft, top: (r.top - origin.top) / factor - clientTop, width: r.width / factor, height: r.height / factor }
        : undefined;
      return { box, place };
    });
  });
  for (const { box, place } of placements) {
    box.hidden = !place;
    if (place) {
      box.style.left = `${place.left}px`;
      box.style.top = `${place.top}px`;
      box.style.width = `${place.width}px`;
      box.style.height = `${place.height}px`;
    }
  }
}

/** Lays out the wireframe of `block` (`layoutBlocks`). */
export function layoutWireframe(block: HTMLElement): void {
  layoutBlocks([block]);
}

/** Lays out the wireframes of `root`, once it is in the page. */
export function layoutWireframes(root: Element): void {
  layoutBlocks(root.querySelectorAll<HTMLElement>('.seqnotes-wireframe'));
}

/** The shadow root of the page of the wireframe of `block`, once mounted. */
function shadowOf(block: HTMLElement): ShadowRoot | null | undefined {
  return block.querySelector(':scope > .seqnotes-wireframe-frame > .seqnotes-wireframe-screen')?.shadowRoot;
}

/**
 * Lays out the wireframe of `block` (in the page), and again whenever it or its page is resized, until
 * `unwatchWireframes`. Not done when it is mounted, so that a wireframe never put in the page (e.g. that of an export)
 * is not kept by the observer.
 */
export function watchWireframe(block: HTMLElement): void {
  const shadow = shadowOf(block);
  if (shadow) {
    observe(block, shadow);
  }
  layoutWireframe(block);
}

/** `watchWireframe` for the wireframes of `root`, laid out together. */
export function watchWireframes(root: Element): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.seqnotes-wireframe'));
  for (const block of blocks) {
    const shadow = shadowOf(block);
    if (shadow) {
      observe(block, shadow);
    }
  }
  layoutBlocks(blocks);
}

/**
 * Stops following the wireframes of `root` (`watchWireframe`): before they are removed, as the observer only lets go of
 * one removed when it reports it resized, which it does not for one hidden then (e.g. in a closed <details>).
 */
export function unwatchWireframes(root: Element): void {
  if (!resizes) {
    return;
  }
  const blocks = root instanceof HTMLElement && root.matches('.seqnotes-wireframe') ? [root] : [];
  for (const block of [...blocks, ...Array.from(root.querySelectorAll<HTMLElement>('.seqnotes-wireframe'))]) {
    resizes.unobserve(block);
    const page = shadowOf(block)?.querySelector('html');
    if (page) {
      resizes.unobserve(page);
    }
  }
}

/** Shows the wireframes of an exported page again from the HTML kept in their block, with the boxes of the export. */
export function remountWireframes(root: Element): void {
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('.seqnotes-wireframe'))) {
    const source = block.querySelector(':scope > .seqnotes-wireframe-src')?.textContent;
    const screen = block.querySelector<HTMLElement>(':scope > .seqnotes-wireframe-frame > .seqnotes-wireframe-screen');
    if (typeof source === 'string' && screen && !screen.shadowRoot) {
      // Its notes are in the exported page already.
      showPage(block, screen, source, { restricted: block.hasAttribute(RESTRICTED_ATTR) });
    }
  }
  watchWireframes(root);
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

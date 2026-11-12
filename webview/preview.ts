import DOMPurify from 'dompurify';
import mermaid, { type MermaidConfig } from 'mermaid';
import type { DiagramLook, DiffView, PreviewTheme, ToWebview } from '../src/shared/protocol';
import type { DiagramMeta } from '../src/markdown/render';
import { normalizeLabel } from '../src/diagrams/sequence';
import { markChanges } from './diff';
import { setupDiffBar } from './diffBar';
import { setupFootnotePopup } from './footnotePopup';
import { setUpIndexList } from './indexList';
import { activeFor, endsDrag, isSideBySide, revealCounterpart, scrollColumnTo, scrollToFragment, showActive as showActiveIn, trackPresses, type Active } from './linking';
import { foldedRows, isFoldedAway, plainTables, restoreFolded, restorePlain, setupTableTree } from './tableTree';
import { addSplitter, applySplit } from './splitter';
import { setupToc } from './toc';
import type { ViewerContext } from './viewerContext';
import { annotateNotes, setupNoteJumps } from './noteJumps';
import { layoutWireframe, layoutWireframes, linkTarget, mountWireframe } from './wireframe';

const CURRENT = 'seqnotes-current';
const HEADING_RE = /^H([1-6])$/;

/** mermaid is configured globally, so renders run one at a time, those of all the viewers of the page. */
let renderQueue: Promise<unknown> = Promise.resolve();

function queueRender<T>(render: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(render);
  renderQueue = result.catch(() => undefined);
  return result;
}

/** A preview of a document, which its host updates with its messages. */
export interface Preview {
  /** Handles a message of the host (`ToWebview`). Resolves once an `update` is shown (or superseded). */
  handle(message: ToWebview): Promise<void>;
  /**
   * Removes what the preview added outside its root (and the classes it put on the viewer's element), and its listeners.
   * Its pending renders and exports are dropped. The document rendered in the root is left there.
   */
  destroy(): void;
}

/**
 * Sets up the preview in `ctx.root`. It renders the documents the host sends with `update` messages, and sends back
 * its messages (`FromWebview`) with `ctx.post`.
 */
export function createPreview(ctx: ViewerContext): Preview {
  const { el, root, scroll } = ctx;
  const stopTrackingPresses = trackPresses();
  /** The translated titles: data attributes of the viewer's element (`shell()` in previewPanel.ts). */
  const titles = el.dataset;
  /** Removes the listeners on the window and the document. */
  const listeners = new AbortController();
  const { signal } = listeners;
  let destroyed = false;

  let lastHtml: string | undefined;
  /** The differences shown with `lastHtml`, if any. */
  let lastDiff: DiffView | undefined;
  let splitMinWidth = 1000;
  let syncEditor = true;
  let tocEnabled = true;
  let diagramLook: DiagramLook = 'neo';
  let renderSeq = 0;
  let pinned: Active | undefined;
  let currentLine: number | undefined;
  /** `data-seqnotes-key` of the warnings the user closed. The panel is hidden while the warnings are the same. */
  let dismissedWarnings: string | undefined;
  /** `uri` of the last update. */
  let currentUri: string | undefined;
  /**
   * Where the next render scrolls to instead of keeping the position: set by an update that opens another document
   * (`newDocument`) or a heading in it (`fragment`). Kept until a render is not superseded by a newer one.
   */
  let pendingScroll: { newDocument: boolean; fragment?: string } | undefined;

  // ---------------------------------------------------------------------------
  // Layout

  /**
   * The width of the preview: that of its viewport, less what the host puts at the left of it in the window
   * (`data-seqnotes-inset-left` on the viewer's element, in px: the sidebar of the desktop app).
   */
  function previewWidth(): number {
    return scroll.viewport().width - (Number(el.dataset.seqnotesInsetLeft) || 0);
  }

  /** Shows the diagrams and their steps side by side when the preview is wide enough (`mdDesignDoc.splitMinWidth`). */
  function applyLayout(): void {
    el.classList.toggle('seqnotes-wide', previewWidth() >= splitMinWidth);
  }

  const stopResize = scroll.onResize(applyLayout);

  /** Sets the width of the diagram columns (dragged with the boundary), kept with the state. */
  function setSplit(percent: number | undefined): void {
    const split = applySplit(el, percent);
    const state = ctx.getState();
    if (state) {
      ctx.setState({ ...state, split });
    }
  }

  setSplit(ctx.getState()?.split);

  // ---------------------------------------------------------------------------
  // Rendering

  /** `mdDesignDoc.theme`: VS Code's theme, or always light / dark. preview.css applies its colors from data-seqnotes-theme. */
  let previewTheme: PreviewTheme = titles.seqnotesTheme === 'light' || titles.seqnotesTheme === 'dark' ? titles.seqnotesTheme : 'auto';

  function isVscodeDark(): boolean {
    return !el.classList.contains('vscode-light') && !el.classList.contains('vscode-high-contrast-light');
  }

  function isDarkTheme(): boolean {
    return previewTheme === 'auto' ? isVscodeDark() : previewTheme === 'dark';
  }

  let renderedDark = isDarkTheme();

  /** SVGs of the previous render keyed by theme + source, so unchanged diagrams are not re-rendered on every edit. */
  let svgCache = new Map<string, string>();

  /** mermaid source of each rendered diagram (or HTML of a wireframe), so that the zoom overlay can follow its diagram across updates. */
  const diagramSources = new WeakMap<Element, string>();

  /**
   * mermaid settings for `diagramLook`: nothing for `neo`, which mermaid uses by default for most diagrams.
   * A top-level `look` is taken before those per-diagram defaults.
   */
  function lookConfig(look: DiagramLook): MermaidConfig {
    return look === 'neo' ? {} : { look };
  }

  /** Renders the mermaid blocks of `container` and returns the SVGs it used, keyed like `svgCache`. */
  async function renderDiagrams(container: HTMLElement, idPrefix: string, dark: boolean, look: DiagramLook): Promise<Map<string, string>> {
    const cache = new Map<string, string>();
    // Resets the settings of the previous render, as mermaid.initialize starts from its defaults.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: getComputedStyle(el).fontFamily,
      ...lookConfig(look),
    });

    // Where mermaid lays out and measures each diagram, out of sight: by default it does that in an element it adds
    // to the end of the body, where a half-drawn diagram shows for a moment at the top left of the page.
    const scratch = document.createElement('div');
    scratch.className = 'seqnotes-mermaid-scratch';
    el.append(scratch);
    try {
      await renderBlocks(container, idPrefix, dark, look, scratch, cache);
    } finally {
      scratch.remove();
    }
    return cache;
  }

  /** Renders the mermaid blocks of `container` with `scratch` for mermaid's work, and puts the SVGs it used in `cache`. */
  async function renderBlocks(container: HTMLElement, idPrefix: string, dark: boolean, look: DiagramLook, scratch: HTMLElement, cache: Map<string, string>): Promise<void> {
    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.seqnotes-mermaid'));
    for (const [i, block] of blocks.entries()) {
      const pre = block.querySelector('.seqnotes-mermaid-src');
      const meta = metaOf(block);
      const id = `${idPrefix}-${i}`;
      const source = pre?.textContent ?? '';
      const key = `${dark}\n${look}\n${source}`;
      try {
        // A cached SVG carries the element ids of its first render, so reuse it only once per document.
        const cached = cache.has(key) ? undefined : svgCache.get(key);
        const svg = cached ?? (await mermaid.render(id, source, scratch)).svg;
        cache.set(key, svg);
        const holder = document.createElement('div');
        holder.className = 'seqnotes-diagram';
        holder.innerHTML = svg;
        diagramSources.set(holder, source);
        pre?.replaceWith(holder);
        const svgEl = holder.querySelector('svg');
        if (meta && svgEl) {
          if (meta.kind === 'sequence') {
            annotateMessages(svgEl, meta);
            annotateNotes(svgEl, meta);
          } else {
            annotateNodes(svgEl, meta);
          }
        }
      } catch (error) {
        const message = document.createElement('div');
        message.className = 'seqnotes-error-message';
        message.textContent = `Mermaid: ${error instanceof Error ? error.message : String(error)}`;
        block.classList.add('seqnotes-error');
        block.prepend(message);
      }
    }
  }

  /** Raw HTML in Markdown is allowed, so sanitize like the built-in preview does. */
  const sanitize = (html: string): DocumentFragment => DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });

  /** The data of a diagram's block for the webview, if any. */
  function metaOf(block: Element): DiagramMeta | undefined {
    const json = block.getAttribute('data-seqnotes-meta');
    return json ? (JSON.parse(json) as DiagramMeta) : undefined;
  }

  /** Shows the wireframes of `container` with their HTML sanitized like the document's (webview/wireframe.ts). */
  function renderWireframes(container: HTMLElement): void {
    for (const block of Array.from(container.querySelectorAll<HTMLElement>('.seqnotes-wireframe'))) {
      const pre = block.querySelector(':scope > .seqnotes-wireframe-src');
      if (!pre) {
        continue;
      }
      // Kept sanitized for an exported page, which shows it from there (`remountWireframes`).
      // Without `autofocus`, which would take the focus (and scroll to it) at each update.
      const html = DOMPurify.sanitize(pre.textContent ?? '', { WHOLE_DOCUMENT: true, FORBID_ATTR: ['autofocus'] });
      pre.textContent = html;
      diagramSources.set(mountWireframe(block, html, metaOf(block)), html);
    }
  }

  /** Sanitizes the HTML from the extension host and renders its diagrams into a new element. */
  async function buildContent(html: string, idPrefix: string, dark: boolean, look: DiagramLook, diff?: DiffView): Promise<{ content: HTMLElement; cache: Map<string, string> }> {
    const content = document.createElement('div');
    content.append(sanitize(html));
    if (diff) {
      markChanges(content, diff, sanitize, titles.seqnotesDiffOldDiagram ?? '');
    }
    renderWireframes(content);
    const cache = await queueRender(() => renderDiagrams(content, idPrefix, dark, look));
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

  /** The node elements of each kind of diagram, and the node id in their element ids (without the svg id). */
  const NODE_ELEMENTS: Record<Exclude<DiagramMeta['kind'], 'sequence' | 'wireframe'>, { selector: string; id: RegExp }> = {
    flowchart: { selector: 'g.node', id: /^flowchart-(.+)-\d+$/ },
    er: { selector: 'g.node', id: /^entity-(.+)-\d+$/ },
    // A composite state is a cluster, not a node.
    state: { selector: 'g.node, g.statediagram-cluster', id: /^state-(.+)-\d+$/ },
  };

  /**
   * The node id of a node element: its `data-id`, or else the middle of its element id (`<svg id>-flowchart-<node id>-<n>`).
   * The notes of a state diagram (`state-<id>----note-<n>`) are not nodes.
   */
  function diagramNodeId(svg: SVGSVGElement, el: Element, idRe: RegExp): string | undefined {
    const dataId = el.getAttribute('data-id');
    if (dataId !== null) {
      return dataId;
    }
    const id = el.id.startsWith(`${svg.id}-`) ? el.id.slice(svg.id.length + 1) : el.id;
    const nodeId = idRe.exec(id)?.[1];
    return nodeId?.includes('----') ? undefined : nodeId;
  }

  /** Ties the node elements of a flowchart, an ER diagram or a state diagram to the parsed node data. */
  function annotateNodes(svg: SVGSVGElement, meta: DiagramMeta): void {
    const { selector, id: idRe } = NODE_ELEMENTS[meta.kind as keyof typeof NODE_ELEMENTS];
    const elements = new Map<string, Element>();
    for (const el of Array.from(svg.querySelectorAll(selector))) {
      const id = diagramNodeId(svg, el, idRe);
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
    close.title = titles.seqnotesHideWarningsTitle ?? '';
    close.setAttribute('aria-label', close.title);
    close.textContent = '×';
    close.addEventListener('click', () => {
      // Keep what is below the panel where it is on the screen.
      const anchor = panel.nextElementSibling;
      const top = anchor?.getBoundingClientRect().top;
      dismissedWarnings = key;
      panel.hidden = true;
      if (anchor && top !== undefined) {
        scroll.scrollBy(anchor.getBoundingClientRect().top - top);
      }
    });
    panel.prepend(close);
  }

  function headingLevel(el: Element): number | undefined {
    const m = HEADING_RE.exec(el.tagName);
    return m ? Number(m[1]) : undefined;
  }

  async function update(html: string, diff: DiffView | undefined): Promise<void> {
    lastHtml = html;
    lastDiff = diff;
    const seq = ++renderSeq;
    // Set before rendering, so that other class changes of the body do not start another update meanwhile.
    const dark = (renderedDark = isDarkTheme());
    const { content: next, cache } = await buildContent(html, `${ctx.idPrefix}-svg-${seq}`, dark, diagramLook, diff);
    // Kept even when a newer update is waiting: it renders next and can reuse these.
    svgCache = cache;
    if (seq !== renderSeq) {
      return;
    }

    const pending = pendingScroll;
    pendingScroll = undefined;
    // The state of the previous document does not apply to another one.
    const keep = !pending?.newDocument;
    const scrollY = keep ? scroll.top() : 0;
    const colScroll = keep ? Array.from(root.querySelectorAll('.seqnotes-seq-col'), (col) => col.scrollTop) : [];
    const pinnedState = keep && pinned && { diagram: pinned.pair.getAttribute('data-diagram'), target: pinned.target };
    // The search box of a list of documents keeps the focus while the list is updated (e.g. a file saved meanwhile).
    const filter = keep ? root.querySelector<HTMLInputElement>('.seqnotes-index-filter input') : null;
    const filterFocus = filter && document.activeElement === filter ? { start: filter.selectionStart, end: filter.selectionEnd } : undefined;
    // The folded metadata of the header stays open while the document is edited.
    const metadataOpen = keep && root.querySelector<HTMLDetailsElement>('.seqnotes-doc-more')?.open === true;
    // So do the folded rows of the tables shown as trees, and the tables shown as plain tables.
    const folded = keep ? foldedRows(root) : new Set<string>();
    const plain = keep ? plainTables(root) : new Set<number>();

    // Its reference is replaced.
    footnotePopup.hide();
    if (!keep) {
      // The warnings of another document are shown even if they read the same, and its diagrams are not zoomed.
      dismissedWarnings = undefined;
      if (zoom) {
        closeZoom();
      }
    }
    root.replaceChildren(...Array.from(next.childNodes));
    const metadata = root.querySelector<HTMLDetailsElement>('.seqnotes-doc-more');
    if (metadata) {
      metadata.open = metadataOpen;
    }
    restoreFolded(root, folded);
    restorePlain(root, plain);
    // A list of documents: its search and order are kept with the state, also when the list is shown again.
    const index = root.querySelector<HTMLElement>('.seqnotes-index');
    const input = index ? setUpIndexList(index, ctx.getState()?.indexList, (indexList) => ctx.setState({ ...ctx.getState()!, indexList })) : undefined;
    if (input && filterFocus) {
      input.focus();
      input.setSelectionRange(filterFocus.start, filterFocus.end);
    }
    root.querySelectorAll('.seqnotes-pair').forEach((pair) => {
      wrapSections(pair);
      if (!pair.classList.contains('seqnotes-pair-stacked')) {
        // Translated by the extension host (`shell()` in previewPanel.ts).
        addSplitter(pair, titles.seqnotesSplitterTitle ?? '', setSplit);
      }
    });
    setUpWarnings();
    diffBar.show(diff);
    layoutWireframes(root);
    addZoomButtons();
    markZoomableImages();
    if (zoom) {
      setZoomContent();
    }

    scroll.scrollTo(scrollY);
    root.querySelectorAll('.seqnotes-seq-col').forEach((col, i) => (col.scrollTop = colScroll[i] ?? 0));
    toc.build(tocEnabled);
    if (pending?.fragment) {
      scrollToFragment(root, `#${pending.fragment}`, scroll);
    }

    const pair = pinnedState && root.querySelector(`.seqnotes-pair[data-diagram="${pinnedState.diagram}"]`);
    pinned = pair && pair.querySelector(`[data-seqnotes-section="${CSS.escape(pinnedState.target)}"]`) ? { pair, target: pinnedState.target } : undefined;
    showActive(pinned);
    if (currentLine !== undefined) {
      markLine(currentLine, false);
    }
  }

  const toc = setupToc(root, { container: el, title: titles.seqnotesTocTitle ?? '', scroll });

  // ---------------------------------------------------------------------------
  // Message <-> heading highlighting

  function showActive(active: Active | undefined): void {
    showActiveIn(root, active);
  }

  root.addEventListener('mouseover', (e) => showActive(activeFor(linkTarget(e)) ?? pinned), { signal });
  root.addEventListener('mouseleave', () => showActive(pinned), { signal });

  root.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element;
      const link = target.closest('a[href]');
      if (link) {
        e.preventDefault();
        openLink(link.getAttribute('href')!);
        return;
      }
      if (openImageZoom(target)) {
        return;
      }
      const active = endsDrag(e) ? undefined : activeFor(linkTarget(e));
      if (active) {
        activate(active);
      }
    },
    { signal },
  );

  // Images are focusable (`markZoomableImages`): open them with the keys of a button too.
  root.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && openImageZoom(e.target as Element)) {
        e.preventDefault();
      }
    },
    { signal },
  );

  /** Pins a clicked message or heading and scrolls its counterpart into view. */
  function activate(active: Active & { kind: 'message' | 'heading' }, reveal = true): void {
    pinned = { pair: active.pair, target: active.target };
    showActive(pinned);
    if (reveal) {
      revealCounterpart(active, scroll);
    }
  }

  const noteJumps = setupNoteJumps(root, { scroll, pin: activate, signal });

  document.addEventListener(
    'keydown',
    (e) => {
      if (zoom) {
        // Typed into a form control of a wireframe, except Escape (unless it cancels a conversion).
        if (e.isComposing || (e.key !== 'Escape' && inFormControl(e))) {
          return;
        }
        zoomKey(e);
        return;
      }
      // Not a key pressed in another viewer of the page, which unpins its own steps.
      if (e.key === 'Escape' && (el.contains(e.target as Node) || e.target === document.body || e.target === document.documentElement)) {
        pinned = undefined;
        showActive(undefined);
        noteJumps.clear();
      }
    },
    { signal },
  );

  const footnotePopup = setupFootnotePopup(
    root,
    (href) => {
      openLink(href);
      return true;
    },
    { container: el, id: `${ctx.idPrefix}-footnote-popup` },
  );

  setupTableTree(root, signal);

  const diffBar = setupDiffBar(root, { onClose: () => ctx.post({ type: 'closeDiff' }) }, { container: el, titles, scroll });

  function openLink(href: string): void {
    if (href.startsWith('#')) {
      scrollToFragment(root, href, scroll);
    } else {
      ctx.post({ type: 'openLink', href });
    }
  }

  // ---------------------------------------------------------------------------
  // Export

  /**
   * Renders the HTML of an exported file (`renderDocument` with `forExport`, or `renderDiff` with `diff`) with the light theme,
   * and returns the body without the data only the preview script uses, and the errors of the diagrams.
   */
  async function exportBody(
    id: number,
    html: string,
    look: DiagramLook,
    diff: DiffView | undefined,
  ): Promise<{ body: string; diagramErrors: string[]; warnings: { line?: number; message: string }[] }> {
    const { content } = await buildContent(html, `${ctx.idPrefix}-export-${id}`, false, look, diff);
    content.querySelectorAll('.seqnotes-pair').forEach(wrapSections);
    // The selectors of the parts of the wireframes that match nothing: reported, not exported, like the other warnings.
    const warnings = Array.from(content.querySelectorAll<HTMLElement>('.seqnotes-wireframe-note'), (note) => {
      const line = note.parentElement?.dataset.seqnotesItemLine;
      note.remove();
      return { ...(line === undefined ? {} : { line: Number(line) }), message: note.textContent ?? '' };
    });
    for (const attr of ['data-seqnotes-meta', 'data-seqnotes-line', 'data-seqnotes-diff-old', 'data-seqnotes-item-line']) {
      content.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }
    const diagramErrors = Array.from(content.querySelectorAll('.seqnotes-error-message'), (el) => el.textContent ?? '');
    return { body: content.innerHTML, diagramErrors, warnings };
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
  zoomToolbar.append(
    zoomButton('+', titles.seqnotesZoomInTitle, () => zoomAt(ZOOM_STEP, ...zoomCenter())),
    zoomButton('&minus;', titles.seqnotesZoomOutTitle, () => zoomAt(1 / ZOOM_STEP, ...zoomCenter())),
    zoomButton(FIT_ICON, titles.seqnotesZoomFitTitle, () => fitZoom()),
    zoomButton('&times;', titles.seqnotesZoomCloseTitle, () => closeZoom()),
  );
  zoomOverlay.append(zoomStage, zoomToolbar);
  // Outside the root, so the arrow / heading handlers on it do not see the events.
  el.append(zoomOverlay);

  /** The diagram holders (and the frames of the wireframes) or the images that open in the zoom overlay, in document order. */
  function zoomTargets(kind: ZoomKind): Element[] {
    return Array.from(root.querySelectorAll(kind === 'diagram' ? '.seqnotes-diagram, .seqnotes-wireframe-frame' : 'img.seqnotes-zoomable'));
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
   * Marks the images that open in the zoom overlay on click, and makes them buttons for the keyboard.
   * Not those in a link, which opens the link, in a heading, which is pinned instead (e.g. an icon), nor in a diagram.
   */
  function markZoomableImages(): void {
    for (const image of Array.from(root.querySelectorAll('img'))) {
      if (!image.closest('a[href], h1, h2, h3, h4, h5, h6, .seqnotes-diagram')) {
        image.classList.add('seqnotes-zoomable');
        image.tabIndex = 0;
        image.setAttribute('role', 'button');
        // As a button, the alt text is no longer read: keep it in the name.
        const title = titles.seqnotesZoomImageTitle ?? '';
        image.setAttribute('aria-label', image.alt ? `${title}: ${image.alt}` : title);
      }
    }
  }

  /** Opens the zoomable image `target` in the overlay. false when it is not one. */
  function openImageZoom(target: Element): boolean {
    const image = target.closest<HTMLImageElement>('img.seqnotes-zoomable');
    // Not one that failed to load: there is nothing to show.
    if (!image || (image.complete && image.naturalWidth === 0)) {
      return false;
    }
    openZoom('image', zoomTargets('image').indexOf(image));
    return true;
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
    // Back to what opened it, so that the keyboard goes on from there.
    const target = zoom && zoomOverlay.contains(document.activeElement) ? zoomTargets(zoom.kind)[zoom.index] : undefined;
    const opener = target?.matches('img') ? target : target?.querySelector(':scope > .seqnotes-zoom-button');
    zoom = undefined;
    zoomOverlay.hidden = true;
    zoomStage.replaceChildren();
    zoomHovered = undefined;
    holdSpace(false);
    cancelZoomClick();
    (opener as HTMLElement | null | undefined)?.focus({ preventScroll: true });
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
    if (target?.matches('.seqnotes-wireframe-frame')) {
      setZoomWireframe(target as HTMLElement);
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

  /** Puts a copy of a wireframe into the overlay, at the width it is laid out at (that of its options, or of its column). */
  function setZoomWireframe(frame: HTMLElement): void {
    const block = frame.parentElement!;
    const html = diagramSources.get(frame) ?? '';
    const width = `${Number(block.dataset.seqnotesWidth) || frame.offsetWidth}px`;
    const meta = metaOf(block);
    // Kept on updates that do not change it, with what was typed into it and selected: only the links of its parts count,
    // not their lines, which change with an edit above it.
    const key = JSON.stringify([html, width, block.dataset.seqnotesItems, meta?.messages.map((m) => [m.nodeId, m.target, m.unlinked])]);
    const shown = zoomStage.firstElementChild;
    if (shown instanceof HTMLElement && shown.dataset.seqnotesZoomKey === key) {
      return;
    }
    const copy = block.cloneNode(false) as HTMLElement;
    // Not a line of the document, nor laid out at another width.
    copy.removeAttribute('data-line');
    copy.dataset.seqnotesZoomKey = key;
    copy.style.margin = '0';
    copy.style.padding = '0';
    copy.style.width = width;
    zoomStage.replaceChildren(copy);
    zoomHovered = undefined;
    // Works as in the preview: its text can be selected, its form controls used. The overlay pans on drag around it.
    mountWireframe(copy, html, meta);
    layoutWireframe(copy);
    if (zoom) {
      zoom.width = copy.offsetWidth;
      zoom.height = copy.offsetHeight;
    }
    applyZoom();
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
    for (const attr of ['tabindex', 'role', 'aria-label']) {
      copy.removeAttribute(attr);
    }
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
      // Failed after it was opened: there is nothing to show.
      copy.addEventListener('error', () => {
        if (zoom && zoomStage.contains(copy)) {
          closeZoom();
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
      case ' ':
        // Not on a button (of the toolbar, or of a wireframe), which Space presses.
        if ((e.composedPath()[0] as Element | undefined)?.closest?.('button, input')) {
          return;
        }
        holdSpace(true);
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

  /** true when `e` happened on the page of a wireframe, where a drag selects its text instead of panning (unless Space is held). */
  const onWireframePage = (e: Event): boolean => (e.target as Element).closest('.seqnotes-wireframe-screen') !== null;

  /** true while Space is held, which pans on drag over the page of a wireframe too, e.g. when it fills the overlay. */
  let zoomSpace = false;
  function holdSpace(held: boolean): void {
    zoomSpace = held;
    zoomOverlay.classList.toggle('seqnotes-zoom-space', held);
  }
  document.addEventListener(
    'keyup',
    (e) => {
      if (e.key === ' ') {
        holdSpace(false);
      }
    },
    { signal },
  );
  window.addEventListener('blur', () => holdSpace(false), { signal });

  // On the whole overlay, so that the empty space around a small diagram pans it too.
  zoomOverlay.addEventListener('pointerdown', (e) => {
    if (!zoom || e.button !== 0 || zoomToolbar.contains(e.target as Node)) {
      return;
    }
    zoomDragged = false;
    if (onWireframePage(e) && !zoomSpace) {
      return;
    }
    const start = { x: e.clientX, y: e.clientY, zoomX: zoom.x, zoomY: zoom.y };
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
    // Not on the page of a wireframe, where it selects a word.
    if (!zoomToolbar.contains(e.target as Node) && !onWireframePage(e)) {
      fitZoom();
    }
  });

  /**
   * The form controls of a wireframe that take an input, which are used instead of following the link of their part. Not
   * its buttons, which do nothing in a mock-up.
   */
  const FORM_CONTROLS = 'input:not([type="button"], [type="submit"], [type="reset"], [type="image"]), select, textarea, label, [contenteditable]:not([contenteditable="false"])';

  /** true when `e` happened in a form control of a wireframe (in its shadow root, so seen in the composed path). */
  const inFormControl = (e: Event): boolean => {
    const inner = e.composedPath()[0];
    return inner instanceof Element && inner.closest(FORM_CONTROLS) !== null;
  };

  /** The linked arrow, node or part of a wireframe `e` happened on in the overlay. */
  const zoomLinked = (e: Event): Element | null | undefined => linkTarget(e)?.closest('[data-seqnotes-target]');

  /** How long a click on a part of a wireframe waits for a second one, which selects a word instead (ms). */
  const DOUBLE_CLICK_WAIT = 400;

  /** The click on a part of a wireframe waiting for a second one. */
  let zoomClickTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelZoomClick(): void {
    clearTimeout(zoomClickTimer);
    zoomClickTimer = undefined;
  }

  // A linked arrow in the overlay: close it and show the step, like a click on the arrow in the preview.
  // Not at the end of a selection of the text of a wireframe, nor on its form controls.
  zoomStage.addEventListener('click', (e) => {
    cancelZoomClick();
    const message = zoomLinked(e);
    const pair = zoom?.kind === 'diagram' && zoomTargets('diagram')[zoom.index]?.closest('.seqnotes-pair');
    if (zoomDragged || endsDrag(e) || inFormControl(e) || !message || !pair || e.detail > 1) {
      return;
    }
    const show = (): void => {
      closeZoom();
      activate({ pair, target: message.getAttribute('data-seqnotes-target')!, kind: 'message' });
    };
    // A part of a wireframe: not before it is clear that the text is not double-clicked to select a word.
    if (message.matches('.seqnotes-part') && e.detail === 1) {
      zoomClickTimer = setTimeout(show, DOUBLE_CLICK_WAIT);
    } else {
      show();
    }
  });

  // The page of a wireframe takes the pointer, not the boxes of its parts: show the box of a linked part while hovering it.
  let zoomHovered: string | undefined;
  function showZoomHovered(target: string | undefined): void {
    if (target !== zoomHovered) {
      zoomHovered = target;
      showActiveIn(zoomStage, target === undefined ? undefined : { pair: zoomStage, target });
    }
  }
  zoomStage.addEventListener('mouseover', (e) => {
    const part = zoomLinked(e);
    showZoomHovered(part?.matches('.seqnotes-part') ? part.getAttribute('data-seqnotes-target')! : undefined);
  });
  zoomStage.addEventListener('mouseleave', () => showZoomHovered(undefined));

  // Not after the user zoomed or panned: they would lose their place, e.g. when a side bar is toggled.
  // The overlay covers the window.
  window.addEventListener(
    'resize',
    () => {
      if (zoom?.fitted) {
        fitZoom();
      }
    },
    { signal },
  );

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
      scrollColumnTo(message, false, scroll);
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
      scroll.scrollTo(0);
      return;
    }
    // The first element from the top of the page, so that the margin above it is not scrolled out of view.
    const offset = scroll.top() - scroll.viewport().top;
    const top = (element: Element): number => (element === elements[0] ? 0 : element.getBoundingClientRect().top + offset);
    let y = top(prev);
    if (next && lineOf(next) > lineOf(prev)) {
      y += ((line - lineOf(prev)) / (lineOf(next) - lineOf(prev))) * (top(next) - top(prev));
    }
    scroll.scrollTo(y);
  }

  function isVisible(element: Element): boolean {
    const r = element.getBoundingClientRect();
    const viewport = scroll.viewport();
    const col = element.closest('.seqnotes-seq-col');
    const bounds = col && isSideBySide(col) ? col.getBoundingClientRect() : viewport;
    return r.bottom > bounds.top && r.top < bounds.bottom && r.top >= viewport.top && r.bottom <= viewport.bottom;
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
        scrollColumnTo(message, true, scroll);
      }
      return;
    }

    let found: HTMLElement | undefined;
    for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
      if (isFoldedAway(el)) {
        // A row of a folded table: its folded parent before it is marked instead.
        continue;
      }
      if (lineOf(el) <= line) {
        found = el;
      } else {
        break;
      }
    }
    if (found) {
      found.classList.add(CURRENT);
      if (reveal && !isVisible(found)) {
        scroll.reveal(found, 'center', 'smooth');
      }
    }
  }

  root.addEventListener(
    'dblclick',
    (e) => {
      if (!syncEditor) {
        return;
      }
      const lined = (e.target as Element).closest('[data-seqnotes-line], [data-seqnotes-jump], [data-line]');
      if (lined) {
        ctx.post({ type: 'revealLine', line: lineOf(lined) });
      }
    },
    { signal },
  );

  // ---------------------------------------------------------------------------
  // Wiring

  async function handle(message: ToWebview): Promise<void> {
    if (destroyed) {
      return;
    }
    switch (message.type) {
      case 'update':
        splitMinWidth = message.splitMinWidth;
        syncEditor = message.syncEditor;
        tocEnabled = message.toc;
        diagramLook = message.diagramLook;
        previewTheme = message.theme;
        el.dataset.seqnotesTheme = message.theme;
        el.classList.toggle('seqnotes-limit-width', message.limitContentWidth);
        el.classList.toggle('seqnotes-sticky-table-header', message.stickyTableHeader);
        el.classList.toggle('seqnotes-table-tree-highlight', message.tableTreeHighlight);
        ctx.setState({ ...ctx.getState(), uri: message.uri });
        if ((currentUri !== undefined && message.uri !== currentUri) || message.fragment) {
          pendingScroll = { newDocument: pendingScroll?.newDocument === true || message.uri !== currentUri, fragment: message.fragment };
        }
        currentUri = message.uri;
        applyLayout();
        await update(message.html, message.diff);
        break;
      case 'scrollToLine':
        scrollToLine(message.line);
        break;
      case 'markLine':
        markLine(message.line, true);
        break;
      case 'export':
        exportBody(message.id, message.html, message.diagramLook, message.diff).then(
          ({ body, diagramErrors, warnings }) => !destroyed && ctx.post({ type: 'exported', id: message.id, body, diagramErrors, warnings }),
          (error: unknown) => !destroyed && ctx.post({ type: 'exported', id: message.id, error: error instanceof Error ? error.message : String(error) }),
        );
        break;
    }
  }

  // VS Code switches the body class when the color theme changes.
  const themeObserver = new MutationObserver(() => {
    if (lastHtml !== undefined && isDarkTheme() !== renderedDark) {
      void update(lastHtml, lastDiff);
    }
  });
  themeObserver.observe(el, { attributes: true, attributeFilter: ['class'] });

  // The desktop app shows or resizes its sidebar.
  const insetObserver = new MutationObserver(applyLayout);
  insetObserver.observe(el, { attributes: true, attributeFilter: ['data-seqnotes-inset-left'] });

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    // The renders under way are not shown.
    renderSeq++;
    if (zoom) {
      closeZoom();
    }
    listeners.abort();
    stopTrackingPresses();
    stopResize();
    themeObserver.disconnect();
    insetObserver.disconnect();
    toc.dispose();
    footnotePopup.dispose();
    diffBar.dispose();
    zoomOverlay.remove();
    // What it wrote on the viewer's element.
    el.classList.remove('seqnotes-wide', 'seqnotes-limit-width', 'seqnotes-sticky-table-header', 'seqnotes-table-tree-highlight');
    el.style.removeProperty('--seqnotes-split');
  }

  return { handle, destroy };
}

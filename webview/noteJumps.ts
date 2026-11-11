/**
 * The notes of a sequence diagram that label a place of it (`Note over A: Ⓒ`, `else Ⓒ Error`, `%% @anchor`) and the
 * notes that jump to such a label (`… → Ⓒ`, `%% @goto`): marked in the SVG by `annotateNotes`, and followed by
 * `setupNoteJumps`, shared by the preview (`preview.ts`) and exported HTML (`export.ts`).
 */
import type { DiagramMeta } from '../src/markdown/render';
import { compactLabel as compact, normalizeLabel } from '../src/diagrams/sequence';
import { endsDrag, isSideBySide, scrollColumnTo, type Active } from './linking';
import type { ScrollHost } from './viewerContext';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Highlight of a label and its section while a note that jumps to it is hovered, and the other way around. */
const HOVER = 'seqnotes-jump-hover';
const FLASH = 'seqnotes-flash';
/** How long the flash of a place jumped to lasts (as the animation in preview.css), in ms. */
const FLASH_MS = 1200;

/** A rough width of `text` in px: wide characters (CJK, circled letters) are 1em, the others about 0.6em. */
function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const c of text) {
    em += /[ᄀ-ᅟ①-⓿⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 1 : 0.6;
  }
  return em * fontSize;
}

/** The font size of a text of mermaid's SVG, in px (from its style, as mermaid writes it). */
function fontSize(text: Element): number {
  const size = parseFloat((text as SVGElement).style?.fontSize ?? '') || parseFloat(text.getAttribute('font-size') ?? '');
  return Number.isFinite(size) && size > 0 ? size : 14;
}

const num = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

/** How much larger the text of a badge is than that of a note, when it is one line. */
const BADGE_FONT_SCALE = 1.3;

/**
 * Shrinks the box of a note that only labels a place to a badge around its text, at the same center, and makes the text
 * of one line larger (centered in the box: mermaid puts the line `1em` below its top, which a larger text would lower).
 */
function makeBadge(group: Element): void {
  const rect = group.querySelector(':scope > rect');
  const texts = Array.from(group.querySelectorAll<SVGTextElement>(':scope > text'));
  if (!rect || texts.length === 0) {
    return;
  }
  const height = num(rect, 'height');
  const width = num(rect, 'width');
  if (!(height > 0)) {
    return;
  }
  if (texts.length === 1) {
    const [text] = texts;
    text.style.fontSize = `${fontSize(text) * BADGE_FONT_SCALE}px`;
    text.setAttribute('y', String(num(rect, 'y') + height / 2));
    text.removeAttribute('dy');
    text.setAttribute('dominant-baseline', 'central');
    text.removeAttribute('alignment-baseline');
    for (const tspan of Array.from(text.querySelectorAll('tspan'))) {
      tspan.removeAttribute('dy');
      tspan.removeAttribute('y');
    }
  }
  const textW = Math.max(...texts.map((t) => textWidth(t.textContent ?? '', fontSize(t))));
  const badge = Math.max(height, textW + height * 0.5);
  if (!(badge < width)) {
    return;
  }
  rect.setAttribute('x', String(num(rect, 'x') + (width - badge) / 2));
  rect.setAttribute('width', String(badge));
  rect.setAttribute('rx', String(height / 2));
  rect.setAttribute('ry', String(height / 2));
}

/** The box of a block (`alt`, `loop`, …) of mermaid's SVG, with the y of the lines between its sections. */
interface BlockBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  dividers: number[];
}

function blockBoxes(svg: SVGSVGElement): BlockBox[] {
  const boxes: BlockBox[] = [];
  for (const group of Array.from(svg.querySelectorAll('g[data-et="control-structure"]'))) {
    const lines = Array.from(group.querySelectorAll(':scope > line.loopLine')).map((l) => ({
      x1: num(l, 'x1'),
      y1: num(l, 'y1'),
      x2: num(l, 'x2'),
      y2: num(l, 'y2'),
    }));
    if (lines.length < 4) {
      continue;
    }
    const xs = lines.flatMap((l) => [l.x1, l.x2]);
    const ys = lines.flatMap((l) => [l.y1, l.y2]);
    const box: BlockBox = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), dividers: [] };
    box.dividers = lines
      .filter((l) => l.y1 === l.y2 && l.y1 > box.top && l.y1 < box.bottom)
      .map((l) => l.y1)
      .sort((a, b) => a - b);
    boxes.push(box);
  }
  return boxes;
}

/** Where a label is drawn: its center (x) and its top (y). */
function placeOf(el: Element): { x: number; y: number } {
  const rect = el.matches('g') ? el.querySelector(':scope > rect') : null;
  if (rect) {
    return { x: num(rect, 'x') + num(rect, 'width') / 2, y: num(rect, 'y') };
  }
  return { x: num(el, 'x'), y: num(el, 'y') };
}

/**
 * The rectangle of the section of the innermost block around a label: from the label (`fromLabel`, a note) or the top of
 * the section (a condition) to its end. undefined outside the blocks.
 */
function sectionRect(boxes: BlockBox[], el: Element, fromLabel: boolean): { x: number; y: number; width: number; height: number } | undefined {
  const { x, y } = placeOf(el);
  const box = boxes
    .filter((b) => b.left <= x && x <= b.right && b.top <= y && y <= b.bottom)
    .sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top))[0];
  if (!box) {
    return undefined;
  }
  const top = fromLabel ? y - 4 : Math.max(box.top, ...box.dividers.filter((d) => d <= y));
  const bottom = Math.min(box.bottom, ...box.dividers.filter((d) => d > y));
  return { x: box.left, y: top, width: box.right - box.left, height: bottom - top };
}

/**
 * Marks the notes of a sequence diagram that define labels (`.seqnotes-anchor`, shrunk to badges) and those that jump to
 * them (`.seqnotes-goto`), the conditions of block sections with a label, and the sections of the labels
 * (`.seqnotes-branch`, highlighted when jumped to). Every note gets its source line.
 */
export function annotateNotes(svg: SVGSVGElement, meta: DiagramMeta): void {
  const notes = meta.notes;
  if (!notes) {
    return;
  }
  const groups = Array.from(svg.querySelectorAll('g[data-et="note"]'));
  let assigned: ((typeof notes)[number] | undefined)[];
  if (groups.length === notes.length) {
    assigned = notes;
  } else {
    // The parser and mermaid disagree on the notes: match their texts instead.
    const unused = [...notes];
    assigned = groups.map((group) => {
      const text = compact(Array.from(group.querySelectorAll('text'), (t) => t.textContent ?? '').join(''));
      const i = unused.findIndex((n) => compact(n.text) === text);
      return i >= 0 ? unused.splice(i, 1)[0] : undefined;
    });
  }

  const labels: { el: Element; name: string; fromLabel: boolean }[] = [];
  groups.forEach((group, i) => {
    const note = assigned[i];
    if (!note) {
      return;
    }
    group.classList.add('seqnotes-note');
    group.setAttribute('data-seqnotes-line', String(note.line));
    if (note.anchor !== undefined) {
      group.classList.add('seqnotes-anchor');
      group.setAttribute('data-seqnotes-anchor', note.anchor);
      makeBadge(group);
      labels.push({ el: group, name: note.anchor, fromLabel: true });
    } else if (note.goto !== undefined) {
      group.classList.add('seqnotes-goto');
      group.setAttribute('data-seqnotes-goto', note.goto);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = (meta.jumpTitles?.goto ?? '{0}').replace('{0}', note.goto);
      group.prepend(title);
    }
  });

  // The conditions of the sections with a label, drawn as `[condition]` (the first one of a block in `loopText`). The
  // blocks are drawn from the inner ones, but from top to bottom in the order of the source.
  const conditions = Array.from(svg.querySelectorAll('text.loopText, text.sectionTitle')).sort((a, b) => num(a, 'y') - num(b, 'y'));
  for (const anchor of meta.anchors ?? []) {
    if (anchor.title === undefined) {
      continue;
    }
    const wanted = compact(`[${anchor.title}]`);
    const el = conditions.filter((c) => compact(c.textContent ?? '') === wanted)[anchor.occurrence ?? 0];
    if (!el) {
      continue;
    }
    el.classList.add('seqnotes-anchor');
    el.setAttribute('data-seqnotes-anchor', anchor.name);
    labels.push({ el, name: anchor.name, fromLabel: false });
  }

  const boxes = blockBoxes(svg);
  for (const { el, name, fromLabel } of labels) {
    const firstTarget = meta.anchors?.find((a) => a.name === name)?.firstTarget;
    if (firstTarget !== undefined) {
      el.setAttribute('data-seqnotes-first-target', firstTarget);
    }
    const r = sectionRect(boxes, el, fromLabel);
    if (!r || !(r.height > 0)) {
      continue;
    }
    // Over the diagram, which it tints without taking the pointer.
    const branch = document.createElementNS(SVG_NS, 'rect');
    branch.setAttribute('class', 'seqnotes-branch');
    branch.setAttribute('data-seqnotes-branch', name);
    for (const [attr, value] of Object.entries(r)) {
      branch.setAttribute(attr, String(value));
    }
    svg.append(branch);
  }
  if (labels.length > 0 && meta.jumpTitles) {
    svg.setAttribute('data-seqnotes-back-title', meta.jumpTitles.back);
  }
}

export interface NoteJumps {
  /** Removes the button that goes back and the highlights. */
  clear(): void;
}

export interface NoteJumpOptions {
  scroll: ScrollHost;
  /**
   * Pins the linked step of the first arrow of the section jumped to, as a click on it does, and scrolls the step into
   * view when `reveal` (the diagram is beside its steps).
   */
  pin(active: Active & { kind: 'message' }, reveal: boolean): void;
  /** Removes the listeners. */
  signal?: AbortSignal;
}

/** Follows the notes that jump to labels in the diagrams of `root` (marked by `annotateNotes`). */
export function setupNoteJumps(root: HTMLElement, { scroll, pin, signal }: NoteJumpOptions): NoteJumps {
  /** The button that goes back, with what keeps it next to its label when the diagram is resized. */
  let back: { button: HTMLButtonElement; observer: ResizeObserver } | undefined;
  /** The next note to go back to from a label clicked again, by diagram and label. */
  const cycles = new WeakMap<Element, Map<string, number>>();
  /** What removes the flash of an element, by element. */
  const flashes = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  let hovered: Element[] = [];

  const svgOf = (el: Element): SVGSVGElement | null => el.closest('svg');
  const byAttr = (svg: Element, attr: string, name: string): Element[] => Array.from(svg.querySelectorAll(`[${attr}="${CSS.escape(name)}"]`));

  function clearHover(): void {
    hovered.forEach((el) => el.classList.remove(HOVER));
    hovered = [];
  }

  function flash(el: Element): void {
    clearTimeout(flashes.get(el));
    el.classList.remove(FLASH);
    // Restarts the animation of an element that still flashes.
    void (el as HTMLElement).getBoundingClientRect();
    el.classList.add(FLASH);
    flashes.set(
      el,
      setTimeout(() => el.classList.remove(FLASH), FLASH_MS),
    );
  }

  function removeBack(): void {
    back?.observer.disconnect();
    back?.button.remove();
    back = undefined;
  }

  /** Puts `button` at the right of `anchor` in `holder`, or at its left when it does not fit there. */
  function place(button: HTMLElement, anchor: Element, holder: Element): void {
    const a = anchor.getBoundingClientRect();
    const h = holder.getBoundingClientRect();
    const right = a.right - h.left + 8;
    const left = right + button.offsetWidth > h.width ? Math.max(0, a.left - h.left - 8 - button.offsetWidth) : right;
    button.style.left = `${left}px`;
    button.style.top = `${a.top - h.top + a.height / 2}px`;
  }

  /** Shows the button that goes back to `from` next to the label `anchor` jumped to. */
  function showBack(anchor: Element, from: Element): void {
    removeBack();
    const holder = anchor.closest('.seqnotes-diagram');
    const svg = svgOf(anchor);
    if (!holder || !svg) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seqnotes-jump-back';
    const text = normalizeLabel(Array.from(from.querySelectorAll('text'), (t) => t.textContent ?? '').join(' '));
    button.textContent = `↩ ${text.length > 24 ? `${text.slice(0, 23)}…` : text}`;
    button.title = svg.getAttribute('data-seqnotes-back-title') ?? '';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      removeBack();
      go(from);
    });
    holder.append(button);
    // The diagram is scaled to the width of its column, which the window and the splitter change.
    const observer = new ResizeObserver(() => place(button, anchor, holder));
    observer.observe(holder);
    back = { button, observer };
    place(button, anchor, holder);
  }

  /** Scrolls to `el` (a note or label) in its diagram and flashes it. */
  function go(el: Element): void {
    scrollColumnTo(el, true, scroll);
    flash(el);
  }

  /** Jumps from the note `from` to its label: to the section, and to the step of its first linked arrow. */
  function jump(from: Element): void {
    const svg = svgOf(from);
    const name = from.getAttribute('data-seqnotes-goto');
    const anchor = svg && name !== null ? byAttr(svg, 'data-seqnotes-anchor', name)[0] : undefined;
    if (!svg || name === null || !anchor) {
      return;
    }
    scrollColumnTo(anchor, true, scroll);
    const branch = byAttr(svg, 'data-seqnotes-branch', name)[0];
    flash(branch ?? anchor);
    if (branch) {
      flash(anchor);
    }
    const target = anchor.getAttribute('data-seqnotes-first-target');
    const pair = anchor.closest('.seqnotes-pair');
    if (target !== null && pair) {
      // After the diagram is scrolled: in a page that scrolls, the step is what stays in view.
      pin({ pair, target, kind: 'message' }, isSideBySide(pair));
    }
    showBack(anchor, from);
  }

  /** Goes from a label to the notes that jump to it, one after the other. */
  function backFromAnchor(anchor: Element): void {
    const svg = svgOf(anchor);
    const name = anchor.getAttribute('data-seqnotes-anchor');
    if (!svg || name === null) {
      return;
    }
    const notes = byAttr(svg, 'data-seqnotes-goto', name);
    if (notes.length === 0) {
      return;
    }
    let cycle = cycles.get(svg);
    if (!cycle) {
      cycle = new Map();
      cycles.set(svg, cycle);
    }
    const i = (cycle.get(name) ?? 0) % notes.length;
    cycle.set(name, i + 1);
    removeBack();
    go(notes[i]);
  }

  root.addEventListener(
    'mouseover',
    (e) => {
      clearHover();
      const el = (e.target as Element).closest?.('svg [data-seqnotes-goto], svg [data-seqnotes-anchor]');
      const svg = el && svgOf(el);
      if (!el || !svg) {
        return;
      }
      const goto = el.getAttribute('data-seqnotes-goto');
      const name = goto ?? el.getAttribute('data-seqnotes-anchor')!;
      const related = goto !== null ? byAttr(svg, 'data-seqnotes-anchor', name) : byAttr(svg, 'data-seqnotes-goto', name);
      hovered = [el, ...related, ...byAttr(svg, 'data-seqnotes-branch', name)];
      hovered.forEach((r) => r.classList.add(HOVER));
    },
    { signal },
  );
  root.addEventListener('mouseleave', clearHover, { signal });
  signal?.addEventListener('abort', removeBack);

  root.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element).closest?.('svg [data-seqnotes-goto], svg [data-seqnotes-anchor]');
      // Not again for the second click of a double-click, which shows the line of the note in the editor.
      if (!el || endsDrag(e) || e.detail > 1) {
        return;
      }
      if (el.hasAttribute('data-seqnotes-goto')) {
        jump(el);
      } else {
        backFromAnchor(el);
      }
    },
    { signal },
  );

  return {
    clear() {
      removeBack();
      clearHover();
    },
  };
}

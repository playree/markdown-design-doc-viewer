/**
 * Regenerates the README screenshots in images/: the English ones from examples/screenshot.md for README.md,
 * and the Japanese ones (*.ja.png) from examples/screenshot.ja.md for README.ja.md.
 *
 * The preview webview (dist/webview.js, dist/webview.css) is loaded into a page that stands in for VS Code
 * (light theme colors, the texts of the language, a stub of acquireVsCodeApi) and captured with headless Chrome.
 *
 *   pnpm screenshots               # all scenes in all languages
 *   pnpm screenshots flowchart     # only the scenes whose name is given
 *   pnpm screenshots ja header     # only the languages (en, ja) whose name is given, can be combined with scenes
 *   pnpm screenshots demo          # the animated GIF of the README (images/demo.gif, demo.ja.gif), named like a scene
 *
 * Chrome is looked up in $CHROME_PATH, then in the Playwright browser cache (`pnpm exec playwright-core install chromium`),
 * then among the browsers installed on the system (`launchChrome` in src/headless.ts).
 * The Japanese screenshots need a Japanese font (Noto Sans CJK JP, `fonts-noto-cjk` on Debian / Ubuntu); without one, their text is drawn as boxes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import type { Browser, JSHandle, Page } from 'playwright-core';
import { PNG } from 'pngjs';
import { launchChrome } from '../src/headless';
import { formatMessage, translatorFor, type Translate } from '../src/l10n';
import { WEBVIEW_TITLES, type ToWebview } from '../src/protocol';
import { imagePath, imageType, isExternalUrl } from '../src/exportPage';
import { createMarkdown, escapeHtml, renderDocument } from '../src/render';
import { loadWireframes, wireframeSources } from '../src/wireframe';

/** The repository root: the script runs as dist/screenshots.cjs. */
const ROOT = resolve(__dirname, '..');
const WIDTH = 1570;

/** Colors of VS Code's "Light Modern" theme for the variables preview.css uses. */
const THEME: Record<string, string> = {
  // The Japanese font is used only for the characters the fonts before it do not have.
  'font-family': "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Liberation Sans', 'Noto Sans CJK JP', sans-serif",
  'editor-font-family': "Consolas, 'Courier New', 'DejaVu Sans Mono', monospace",
  'editor-background': '#ffffff',
  'editor-foreground': '#3b3b3b',
  foreground: '#3b3b3b',
  descriptionForeground: '#3b3b3b',
  errorForeground: '#f85149',
  focusBorder: '#005fb8',
  'icon-foreground': '#3b3b3b',
  'textLink-foreground': '#005fb8',
  'textLink-activeForeground': '#005fb8',
  'textBlockQuote-border': '#e5e5e5',
  'textBlockQuote-foreground': '#3b3b3b',
  'textCodeBlock-background': '#f3f3f3',
  'panel-border': '#e5e5e5',
  'editorWidget-background': '#f8f8f8',
  'editorWidget-border': '#c8c8c8',
  'editorLineNumber-activeForeground': '#171184',
  'list-hoverBackground': '#f2f2f2',
  'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
  'sash-hoverBorder': '#005fb8',
  'widget-shadow': 'rgba(0, 0, 0, 0.16)',
  'inputValidation-warningBackground': '#f6f5d2',
  'inputValidation-warningBorder': '#b89500',
  'charts-blue': '#1a85ff',
  'charts-green': '#388a34',
  'charts-purple': '#652d90',
  'charts-red': '#e51400',
  'charts-yellow': '#bf8803',
};

/** The h2 sections and the steps in them that the scenes look for, in the language of the source. */
interface Names {
  sequence: string;
  sequenceStep: string;
  flowchart: string;
  flowchartStep: string;
  linkChecks: string;
  markdown: string;
  tables: string;
  wireframe: string;
  /** The steps of the sequence diagram the animation points at: an arrow hovered, an arrow clicked and a heading hovered. */
  demo: { hover: string; click: string; heading: string };
}

interface Locale {
  name: string;
  /** The source document, relative to the repository root. */
  source: string;
  /** Appended to the file name of each scene: images/screenshot.ja.png. */
  suffix: string;
  /** `lang` of the page, so that CJK text is drawn with the glyphs of the language. */
  lang: string;
  /** Translates the texts of the preview, like `vscode.l10n.t` in this display language. */
  t: Translate;
  names: Names;
}

const jaBundle = JSON.parse(readFileSync(join(ROOT, 'l10n/bundle.l10n.ja.json'), 'utf8')) as Record<string, string>;

const LOCALES: Locale[] = [
  {
    name: 'en',
    source: 'examples/screenshot.md',
    suffix: '',
    lang: 'en',
    t: formatMessage,
    names: {
      sequence: 'Checkout sequence',
      sequenceStep: '3. Reserve stock',
      flowchart: 'Payment retry flow',
      flowchartStep: 'Retryable error?',
      linkChecks: 'Refund (draft)',
      markdown: 'Open items',
      tables: 'Request body of POST /orders',
      wireframe: 'Order confirmation screen',
      demo: { hover: '1. Place order', click: '5. Authorize payment', heading: '3. Reserve stock' },
    },
  },
  {
    name: 'ja',
    source: 'examples/screenshot.ja.md',
    suffix: '.ja',
    lang: 'ja',
    t: translatorFor(jaBundle),
    names: {
      sequence: '注文確定のシーケンス',
      sequenceStep: '3. 在庫を引き当て',
      flowchart: '決済リトライのフロー',
      flowchartStep: 'リトライ可能?',
      linkChecks: '返金（草案）',
      markdown: '未決事項',
      tables: 'POST /orders のリクエスト本文',
      wireframe: '注文完了画面',
      demo: { hover: '1. 注文を確定', click: '5. オーソリ', heading: '3. 在庫を引き当て' },
    },
  },
];

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Scene {
  name: string;
  /** Output path without the extension, relative to the repository root. `Locale.suffix` and `.png` are appended. */
  file: string;
  height: number;
  /** Scrolls and highlights in the page. Returns the area to capture, or nothing for the whole viewport. */
  prepare(page: Page, names: Names): Promise<Clip | undefined>;
}

const SCENES: Scene[] = [
  {
    // The diagram on the left, and a highlighted step in the middle of the steps on the right.
    name: 'sequence',
    file: 'images/screenshot',
    height: 790,
    prepare: async (page, names) => {
      await highlight(page, names.sequence, names.sequenceStep, 140);
      return undefined;
    },
  },
  {
    // The whole flowchart, so it is taller than the others.
    name: 'flowchart',
    file: 'images/screenshot-flowchart',
    height: 1400,
    prepare: async (page, names) => {
      await highlight(page, names.flowchart, names.flowchartStep);
      return sectionClip(page, names.flowchart);
    },
  },
  {
    // An arrow without a heading (faded) and a heading without an arrow (marked).
    name: 'link-checks',
    file: 'images/screenshot-link-checks',
    height: 790,
    prepare: (page, names) => sectionClip(page, names.linkChecks),
  },
  {
    name: 'markdown',
    file: 'images/screenshot-markdown',
    height: 790,
    prepare: (page, names) => sectionClip(page, names.markdown),
  },
  {
    // A table of items shown as a tree: a parent folded, and the parent and children of a row highlighted.
    name: 'tables',
    file: 'images/screenshot-tables',
    height: 790,
    prepare: async (page, names) => {
      await treeRow(page, names.tables, 'payment', (row) => row.querySelector<HTMLElement>('.seqnotes-tree-toggle')?.click());
      await treeRow(page, names.tables, 'items', (row) => row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      return sectionClip(page, names.tables);
    },
  },
  {
    // A wireframe beside its items: a part made of two elements highlighted with its row, as when hovering it.
    name: 'wireframe',
    file: 'images/screenshot-wireframe',
    height: 790,
    prepare: async (page, names) => {
      await page.evaluate((title) => {
        const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title);
        let pair = h2?.nextElementSibling;
        while (pair && !pair.classList.contains('seqnotes-pair')) {
          pair = pair.nextElementSibling;
        }
        const part = pair?.querySelector('.seqnotes-part[data-seqnotes-part="2"]');
        if (!part) {
          throw new Error(`No part 2 of a wireframe under the h2 "${title}"`);
        }
        part.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }, names.wireframe);
      return sectionClip(page, names.wireframe);
    },
  },
  {
    // The header of `type: design_doc`, with the other metadata opened.
    name: 'header',
    file: 'images/screenshot-header',
    height: 790,
    prepare: headerClip,
  },
];

/**
 * Highlights the arrow or node linked to the step `heading` in the diagram under the h2 `title`, as when hovering it.
 * With `top`, also scrolls the step to that distance from the top of the window.
 */
async function highlight(page: Page, title: string, heading: string, top?: number): Promise<void> {
  const step = await linkedStep(page, title, heading);
  await step.evaluate(([step, item], top) => {
    item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    if (top !== undefined) {
      window.scrollTo(0, step.getBoundingClientRect().top + window.scrollY - top);
    }
  }, top);
  await step.dispose();
}

/** Finds the step `heading` in the diagram under the h2 `title`, and the arrow or node linked to it. */
async function linkedStep(page: Page, title: string, heading: string): Promise<JSHandle<[Element, Element]>> {
  return page.evaluateHandle(
    ([title, heading]) => {
      const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title);
      let pair = h2?.nextElementSibling;
      while (pair && !pair.classList.contains('seqnotes-pair')) {
        pair = pair.nextElementSibling;
      }
      if (!pair) {
        throw new Error(`No diagram under the h2 "${title}"`);
      }
      // Compared without the arrow number and the marks the preview adds into the heading.
      const text = (el: Element): string => {
        const clone = el.cloneNode(true) as Element;
        clone.querySelectorAll('[class^="seqnotes-"]').forEach((child) => child.remove());
        return clone.textContent?.trim() ?? '';
      };
      const step = [...pair.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((el) => text(el) === heading);
      const item = step && pair.querySelector(`.seqnotes-item[data-seqnotes-target="${CSS.escape(step.id)}"]`);
      if (!step || !item) {
        throw new Error(`No arrow or node linked to the heading "${heading}" under "${title}"`);
      }
      return [step, item] as [Element, Element];
    },
    [title, heading] as const,
  );
}

/** Runs `action` on the row of the tree table under the h2 `title` whose tree cell shows the physical name `name`. */
async function treeRow(page: Page, title: string, name: string, action: (row: Element) => void): Promise<void> {
  const row = await page.evaluateHandle(
    ([title, name]) => {
      const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title);
      let table = h2?.nextElementSibling;
      while (table && !table.matches('.seqnotes-tree-table')) {
        table = table.nextElementSibling;
      }
      const row = [...(table?.querySelectorAll('tbody > tr') ?? [])].find((tr) => tr.querySelector('.seqnotes-tree-cell .seqnotes-cell-sub')?.textContent?.trim() === name);
      if (!row) {
        throw new Error(`No row "${name}" in a tree table under the h2 "${title}"`);
      }
      return row;
    },
    [title, name] as const,
  );
  await row.evaluate(action);
  await row.dispose();
}

/**
 * Scrolls to the h2 `title` and returns the area from it to the next h2 (or the footnotes gathered at the end of the document,
 * or the end of the document), without the table of contents at the right edge.
 */
async function sectionClip(page: Page, title: string): Promise<Clip> {
  await page.addStyleTag({ content: '.seqnotes-toc { display: none; }' });
  await scrollToH2(page, title);
  return page.evaluate((title) => {
    const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title)!;
    let last: Element = h2;
    for (let el = h2.nextElementSibling; el && el.tagName !== 'H2' && !el.matches('.footnotes-sep, .footnotes'); el = el.nextElementSibling) {
      last = el;
    }
    const top = Math.max(0, h2.getBoundingClientRect().top - 24);
    const bottom = last.getBoundingClientRect().bottom + 24;
    if (bottom > window.innerHeight) {
      throw new Error(`The section "${title}" is taller than the window. Increase the height of the scene to ${Math.ceil(bottom - top)} or more.`);
    }
    return { x: 0, y: top, width: window.innerWidth, height: bottom - top };
  }, title);
}

/** Scrolls the h2 `title` to the top of the window, leaving the margin of the clips above it. */
async function scrollToH2(page: Page, title: string): Promise<void> {
  await page.evaluate((title) => {
    const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title);
    if (!h2) {
      throw new Error(`No h2 "${title}"`);
    }
    window.scrollTo(0, h2.getBoundingClientRect().top + window.scrollY - 24);
  }, title);
}

/**
 * Opens the other metadata of the design document's header and returns the area of the header,
 * without the table of contents at the right edge.
 */
async function headerClip(page: Page): Promise<Clip> {
  // The header is at the top of the document: room above it for the same margin as the other scenes.
  await page.addStyleTag({ content: '.seqnotes-toc { display: none; } body { padding-top: 24px; }' });
  return page.evaluate(() => {
    const header = document.querySelector('.seqnotes-doc-header');
    const more = header?.querySelector<HTMLDetailsElement>('.seqnotes-doc-more');
    if (!header || !more) {
      throw new Error('No design document header with other metadata');
    }
    more.open = true;
    window.scrollTo(0, 0);
    const top = Math.max(0, header.getBoundingClientRect().top - 24);
    const bottom = header.getBoundingClientRect().bottom + 24;
    if (bottom > window.innerHeight) {
      throw new Error(`The header is taller than the window. Increase the height of the scene to ${Math.ceil(bottom - top)} or more.`);
    }
    return { x: 0, y: top, width: window.innerWidth, height: bottom - top };
  });
}

interface Animation {
  name: string;
  /** Output path without the extension, relative to the repository root. `Locale.suffix` and `.gif` are appended. */
  file: string;
  width: number;
  height: number;
  /** Moves the pointer in the page and records what it shows. */
  record(recorder: Recorder, names: Names): Promise<void>;
}

const ANIMATIONS: Animation[] = [
  {
    // An arrow hovered (its step is highlighted), an arrow clicked (the steps scroll to it) and a heading hovered (its arrow is highlighted).
    name: 'demo',
    file: 'images/demo',
    width: 1280,
    height: 720,
    record: async (recorder, names) => {
      const { page } = recorder;
      await scrollToH2(page, names.sequence);
      await recorder.place(await stepPoint(page, names.sequence, names.demo.hover, 'below'));
      await recorder.hold(800);
      await recorder.moveTo(await stepPoint(page, names.sequence, names.demo.hover, 'arrow'));
      await recorder.hold(1600);
      await recorder.moveTo(await stepPoint(page, names.sequence, names.demo.click, 'arrow'));
      await recorder.hold(600);
      await recorder.click();
      await recorder.play();
      await recorder.hold(1400);
      await recorder.moveTo(await stepPoint(page, names.sequence, names.demo.heading, 'heading'), 800);
      await recorder.hold(2200);
    },
  },
];

/** How long a frame of a pointer movement is shown, in ms. */
const FRAME = 40;
/** A little longer than the highlight transitions of preview.css. */
const TRANSITION = 200;

interface Point {
  x: number;
  y: number;
}

interface Frame {
  png: Buffer;
  /** How long the frame is shown, in ms. */
  delay: number;
  /** A state the animation stops at (`Recorder.hold`), rather than a step of a movement. */
  held?: boolean;
}

/**
 * Records the frames of an animation with a real pointer, so that the page reacts as to a user.
 * Screenshots do not show the pointer, so it is drawn in the page (`showPointer`).
 */
class Recorder {
  readonly frames: Frame[] = [];
  private at: Point = { x: 0, y: 0 };

  constructor(readonly page: Page) {}

  /** Puts the pointer at `point` without recording. */
  async place(point: Point): Promise<void> {
    this.at = point;
    await this.page.mouse.move(point.x, point.y);
  }

  /** Shows the page for `ms`, once the highlight transitions are done. */
  async hold(ms: number): Promise<void> {
    await this.page.waitForTimeout(TRANSITION);
    this.frames.push({ png: await this.page.screenshot(), delay: ms, held: true });
  }

  /** Moves the pointer to `to` in `ms`, slow at both ends. */
  async moveTo(to: Point, ms = 600): Promise<void> {
    const from = this.at;
    const steps = Math.max(1, Math.round(ms / FRAME));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.place({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
      this.frames.push({ png: await this.page.screenshot(), delay: FRAME });
    }
  }

  async click(): Promise<void> {
    await this.page.mouse.down();
    await this.page.mouse.up();
  }

  /**
   * Records what the page does by itself after a click (a smooth scroll) until it stops scrolling, or for `maxMs` at most.
   * Each frame is shown as long as it was on the page: until the next one was taken.
   */
  async play(maxMs = 3000): Promise<void> {
    const start = Date.now();
    let previous: { frame: Frame; at: number; scrollY: number } | undefined;
    for (;;) {
      const frame: Frame = { png: await this.page.screenshot(), delay: FRAME };
      const at = Date.now();
      const scrollY = await this.page.evaluate(() => window.scrollY);
      this.frames.push(frame);
      if (previous) {
        previous.frame.delay = Math.max(FRAME, at - previous.at);
      }
      // The scroll may start a little after the click.
      if ((previous?.scrollY === scrollY && at - start > TRANSITION) || at - start > maxMs) {
        return;
      }
      previous = { frame, at, scrollY };
    }
  }
}

/** Draws the pointer (and a ring where it clicks) in the page, following the mouse events. */
async function showPointer(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
#demo-pointer { position: fixed; left: 0; top: 0; z-index: 10000; pointer-events: none; }
.demo-click { position: fixed; z-index: 9999; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
  background: rgba(0, 95, 184, 0.35); pointer-events: none; animation: demo-click 0.5s ease-out forwards; }
@keyframes demo-click { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`,
  });
  await page.evaluate(() => {
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.innerHTML =
      '<svg width="20" height="26" viewBox="-1 -1 20 26"><path d="M0 0 V19 L4.5 14.5 L8 22 L11 20.7 L7.6 13.4 H14 Z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    document.addEventListener('mousemove', (e) => (pointer.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`), true);
    document.addEventListener(
      'mousedown',
      (e) => {
        const ring = document.createElement('div');
        ring.className = 'demo-click';
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        ring.addEventListener('animationend', () => ring.remove());
        document.body.append(ring);
      },
      true,
    );
  });
}

/**
 * Returns a point in the window for the step `heading` of the diagram under the h2 `title`:
 * - `arrow`: the middle of its arrow (under the label, which the pointer would hide). Not for an arrow to itself, whose middle is off the line.
 * - `heading`: the right of the text of its heading, so that the pointer does not hide the text.
 * - `below`: below the diagram, where the pointer highlights nothing.
 */
async function stepPoint(page: Page, title: string, heading: string, side: 'arrow' | 'heading' | 'below'): Promise<Point> {
  const step = await linkedStep(page, title, heading);
  const point = await step.evaluate(([step, item], side) => {
    if (side === 'arrow') {
      const rect = item.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (side === 'below') {
      const rect = item.closest('.seqnotes-diagram')!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: Math.min(rect.bottom + 32, window.innerHeight - 32) };
    }
    const range = document.createRange();
    range.selectNodeContents(step);
    const rect = range.getBoundingClientRect();
    return { x: rect.right + 16, y: rect.top + rect.height / 2 };
  }, side);
  await step.dispose();
  return point;
}

/** Encodes the frames to an animated GIF that loops, with one palette for all the frames. */
function encodeGif(frames: Frame[]): Uint8Array {
  // A frame the same as the previous one only makes it last longer.
  const images: { data: Buffer; delay: number; held: boolean }[] = [];
  for (const frame of frames) {
    const { data } = PNG.sync.read(frame.png);
    const previous = images.at(-1);
    if (previous?.data.equals(data)) {
      previous.delay += frame.delay;
      previous.held ||= frame.held ?? false;
    } else {
      images.push({ data, delay: frame.delay, held: frame.held ?? false });
    }
  }
  const { width, height } = PNG.sync.read(frames[0].png);
  // The palette is made from the frames held (the states shown, with their highlights) and is the same for all the frames,
  // so that a color does not flicker from one frame to the next. The last entry is for the pixels the same as in the previous frame.
  const colors = quantize(Buffer.concat(images.filter((image) => image.held).map((image) => image.data)), 255);
  // Not a color the pixels are mapped to, so that no pixel becomes transparent by chance.
  const palette = [...colors, [255, 0, 255]];
  const transparentIndex = colors.length;

  const gif = GIFEncoder();
  images.forEach((image, i) => {
    const index = applyPalette(image.data, colors);
    const previous = images[i - 1]?.data;
    if (previous) {
      for (let p = 0; p < index.length; p++) {
        if (previous.readUInt32LE(p * 4) === image.data.readUInt32LE(p * 4)) {
          index[p] = transparentIndex;
        }
      }
    }
    // Disposal 1: the next frame is drawn over this one, so its transparent pixels show what did not change.
    gif.writeFrame(index, width, height, { palette: i === 0 ? palette : undefined, delay: image.delay, transparent: i > 0, transparentIndex, dispose: 1 });
  });
  gif.finish();
  return gif.bytes();
}

function shell(update: ToWebview, locale: Locale): string {
  const dist = (name: string): string => pathToFileURL(join(ROOT, 'dist', name)).href;
  const vars = Object.entries(THEME)
    .map(([name, value]) => `--vscode-${name}: ${value};`)
    .join('\n');
  const titles = Object.entries(WEBVIEW_TITLES)
    .map(([name, title]) => ` data-seqnotes-${name}="${escapeHtml(locale.t(title))}"`)
    .join('');
  // `<` is escaped so that the HTML in the message cannot close the script element.
  const message = JSON.stringify(update).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="${locale.lang}">
<head>
<meta charset="UTF-8">
<style>:root {\n${vars}\n}</style>
<link rel="stylesheet" href="${dist('webview.css')}">
</head>
<body class="vscode-light"${titles}>
<div id="seqnotes-root"></div>
<script>
let state;
window.acquireVsCodeApi = () => ({
  getState: () => state,
  setState: (s) => (state = s),
  postMessage: (m) => m.type === 'ready' && window.postMessage(${message}, '*'),
});
</script>
<script src="${dist('webview.js')}"></script>
</body>
</html>`;
}

/** Opens the page in a new tab of the size of the window, once its diagrams and fonts are ready. */
async function openTab(browser: Browser, page: string, width: number, height: number): Promise<Page> {
  const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForSelector('#seqnotes-root .seqnotes-diagram svg');
  await tab.evaluate(() => document.fonts.ready);
  return tab;
}

/** Rethrows an error with what failed in front of its message. */
function failed(what: string): (error: unknown) => never {
  return (error) => {
    throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  };
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const unknown = only.filter((name) => ![...SCENES, ...ANIMATIONS, ...LOCALES].some((item) => item.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scene or language: ${unknown.join(', ')}. Scenes: ${[...SCENES, ...ANIMATIONS].map((s) => s.name).join(', ')}. Languages: ${LOCALES.map((l) => l.name).join(', ')}`,
    );
  }
  // All of them when none is named. The scenes and the animations are named together.
  const pick = <T extends { name: string }>(items: T[], among: { name: string }[]): T[] => {
    const named = among.some((item) => only.includes(item.name));
    return named ? items.filter((item) => only.includes(item.name)) : items;
  };
  const scenes = pick(SCENES, [...SCENES, ...ANIMATIONS]);
  const animations = pick(ANIMATIONS, [...SCENES, ...ANIMATIONS]);
  const locales = pick(LOCALES, LOCALES);

  const dir = mkdtempSync(join(tmpdir(), 'mdai-screenshots-'));
  const browser = await launchChrome();
  try {
    for (const locale of locales) {
      const source = join(ROOT, locale.source);
      const md = createMarkdown();
      const text = readFileSync(source, 'utf8');
      const read = async (path: string): Promise<string | undefined> => readFileSync(join(dirname(source), path), 'utf8');
      // The local images (of the wireframes) as data URIs: the page is written to another folder.
      const resolveResource = (src: string): string => {
        const type = imageType(imagePath(src));
        return isExternalUrl(src) || !type ? src : `data:${type};base64,${readFileSync(join(dirname(source), imagePath(src))).toString('base64')}`;
      };
      const wireframes = await loadWireframes(wireframeSources(md.parse(text, {})), read);
      const html = renderDocument(md, text, { t: locale.t, wireframes, resolveResource });
      const update: ToWebview = { type: 'update', uri: pathToFileURL(source).href, html, splitMinWidth: 1000, syncEditor: false, toc: true, diagramLook: 'neo', theme: 'auto', limitContentWidth: true, stickyTableHeader: true, tableTreeHighlight: true };
      const page = join(dir, `${locale.name}.html`);
      writeFileSync(page, shell(update, locale));

      for (const scene of scenes) {
        const file = `${scene.file}${locale.suffix}.png`;
        const tab = await openTab(browser, page, WIDTH, scene.height);
        const clip = await scene.prepare(tab, locale.names).catch(failed(`Scene "${scene.name}" (${locale.name})`));
        // Let the sticky column and the highlight transitions settle.
        await tab.waitForTimeout(500);
        await tab.screenshot({ path: resolve(ROOT, file), clip });
        await tab.close();
        console.log(`${scene.name} (${locale.name}): ${file}`);
      }

      for (const animation of animations) {
        const file = `${animation.file}${locale.suffix}.gif`;
        const tab = await openTab(browser, page, animation.width, animation.height);
        await showPointer(tab);
        const recorder = new Recorder(tab);
        await animation.record(recorder, locale.names).catch(failed(`Animation "${animation.name}" (${locale.name})`));
        await tab.close();
        const gif = encodeGif(recorder.frames);
        writeFileSync(resolve(ROOT, file), gif);
        console.log(`${animation.name} (${locale.name}): ${file} (${recorder.frames.length} frames, ${(gif.length / 1024).toFixed(0)} KB)`);
      }
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});

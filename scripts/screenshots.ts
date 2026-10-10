/**
 * Regenerates the README screenshots in images/ from examples/screenshot.md.
 *
 * The preview webview (dist/webview.js, dist/webview.css) is loaded into a page that stands in for VS Code
 * (light theme colors, English texts, a stub of acquireVsCodeApi) and captured with headless Chrome.
 *
 *   pnpm screenshots            # all scenes
 *   pnpm screenshots flowchart  # only the scenes whose name is given
 *
 * Chrome is looked up in $CHROME_PATH, then in the Playwright browser cache (`pnpm exec playwright-core install chromium`).
 */
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import type { ToWebview } from '../src/protocol';
import { createMarkdown, escapeHtml, renderDocument } from '../src/render';

/** The repository root: the script runs as dist/screenshots.cjs. */
const ROOT = resolve(__dirname, '..');
const SOURCE = join(ROOT, 'examples/screenshot.md');
const WIDTH = 1570;

/** Colors of VS Code's "Light Modern" theme for the variables preview.css uses. */
const THEME: Record<string, string> = {
  'font-family': "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Liberation Sans', sans-serif",
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

/** The same data attributes as `Preview.shell()` in src/previewPanel.ts, in English. */
const TITLES: Record<string, string> = {
  'splitter-title': 'Drag to resize, double-click to reset',
  'hide-warnings-title': 'Hide warnings',
  'toc-title': 'Contents',
  'zoom-title': 'Zoom diagram',
  'zoom-image-title': 'Zoom image',
  'zoom-in-title': 'Zoom in',
  'zoom-out-title': 'Zoom out',
  'zoom-fit-title': 'Fit to window',
  'zoom-close-title': 'Close',
};

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Scene {
  name: string;
  /** Output path, relative to the repository root. */
  file: string;
  height: number;
  /** Scrolls and highlights in the page. Returns the area to capture, or nothing for the whole viewport. */
  prepare(page: Page): Promise<Clip | undefined>;
}

const SCENES: Scene[] = [
  {
    // The diagram on the left, and a highlighted step in the middle of the steps on the right.
    name: 'sequence',
    file: 'images/screenshot.png',
    height: 790,
    prepare: async (page) => {
      await highlight(page, 'Checkout sequence', '3. Reserve stock', 140);
      return undefined;
    },
  },
  {
    // The whole flowchart, so it is taller than the others.
    name: 'flowchart',
    file: 'images/screenshot-flowchart.png',
    height: 1400,
    prepare: async (page) => {
      await highlight(page, 'Payment retry flow', 'Retryable error?');
      return sectionClip(page, 'Payment retry flow');
    },
  },
  {
    // An arrow without a heading (faded) and a heading without an arrow (marked).
    name: 'link-checks',
    file: 'images/screenshot-link-checks.png',
    height: 790,
    prepare: (page) => sectionClip(page, 'Refund (draft)'),
  },
  {
    name: 'markdown',
    file: 'images/screenshot-markdown.png',
    height: 790,
    prepare: (page) => sectionClip(page, 'Open items'),
  },
];

/**
 * Highlights the arrow or node linked to the step `heading` in the diagram under the h2 `title`, as when hovering it.
 * With `top`, also scrolls the step to that distance from the top of the window.
 */
async function highlight(page: Page, title: string, heading: string, top?: number): Promise<void> {
  await page.evaluate(
    ([title, heading, top]) => {
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
      item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      if (top !== undefined) {
        window.scrollTo(0, step.getBoundingClientRect().top + window.scrollY - top);
      }
    },
    [title, heading, top] as const,
  );
}

/**
 * Scrolls to the h2 `title` and returns the area from it to the next h2 (or the end of the document),
 * without the table of contents at the right edge.
 */
async function sectionClip(page: Page, title: string): Promise<Clip> {
  await page.addStyleTag({ content: '.seqnotes-toc { display: none; }' });
  return page.evaluate((title) => {
    const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === title);
    if (!h2) {
      throw new Error(`No h2 "${title}"`);
    }
    window.scrollTo(0, h2.getBoundingClientRect().top + window.scrollY - 24);
    let last: Element = h2;
    for (let el = h2.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
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

/**
 * $CHROME_PATH, else a Chromium (or its headless shell) of the Playwright cache.
 * undefined lets Playwright launch its default browser, which reports how to install it when it is missing too.
 */
function findChrome(): string | undefined {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const candidates: string[] = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // Not a platform Playwright has browsers for.
  }
  // Other revisions in the Playwright cache, newest first (Linux only).
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache/ms-playwright');
  const revision = (p: string): number => Number(/^chromium(?:_headless_shell)?-(\d+)/.exec(p)?.[1] ?? 0);
  const cached = globSync(['chromium-*/chrome-linux*/chrome', 'chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell'], { cwd: cache });
  candidates.push(...cached.sort((a, b) => revision(b) - revision(a)).map((p) => join(cache, p)));
  return candidates.find((p) => existsSync(p));
}

function shell(update: ToWebview): string {
  const dist = (name: string): string => pathToFileURL(join(ROOT, 'dist', name)).href;
  const vars = Object.entries(THEME)
    .map(([name, value]) => `--vscode-${name}: ${value};`)
    .join('\n');
  const titles = Object.entries(TITLES)
    .map(([name, title]) => ` data-seqnotes-${name}="${escapeHtml(title)}"`)
    .join('');
  // `<` is escaped so that the HTML in the message cannot close the script element.
  const message = JSON.stringify(update).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html>
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

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const unknown = only.filter((name) => !SCENES.some((s) => s.name === name));
  if (unknown.length > 0) {
    throw new Error(`Unknown scene: ${unknown.join(', ')}. Scenes: ${SCENES.map((s) => s.name).join(', ')}`);
  }
  const scenes = only.length > 0 ? SCENES.filter((s) => only.includes(s.name)) : SCENES;

  const html = renderDocument(createMarkdown(), readFileSync(SOURCE, 'utf8'));
  const update: ToWebview = { type: 'update', uri: pathToFileURL(SOURCE).href, html, splitMinWidth: 1000, syncEditor: false, toc: true, diagramLook: 'neo', limitContentWidth: true };
  const dir = mkdtempSync(join(tmpdir(), 'mdai-screenshots-'));
  const page = join(dir, 'index.html');
  writeFileSync(page, shell(update));

  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    for (const scene of scenes) {
      const tab = await browser.newPage({ viewport: { width: WIDTH, height: scene.height }, deviceScaleFactor: 1 });
      await tab.goto(pathToFileURL(page).href);
      await tab.waitForSelector('#seqnotes-root .seqnotes-diagram svg');
      await tab.evaluate(() => document.fonts.ready);
      const clip = await scene.prepare(tab).catch((error: unknown) => {
        throw new Error(`Scene "${scene.name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      });
      // Let the sticky column and the highlight transitions settle.
      await tab.waitForTimeout(500);
      await tab.screenshot({ path: resolve(ROOT, scene.file), clip });
      await tab.close();
      console.log(`${scene.name}: ${scene.file}`);
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

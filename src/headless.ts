/**
 * Runs the preview webview (dist/webview.js) in headless Chrome, for what needs a browser outside VS Code:
 * rendering the mermaid diagrams of an exported file (cli.ts) and the README screenshots (scripts/screenshots.ts).
 */
import { existsSync, globSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { formatMessage, type Translate } from './l10n';
import { WEBVIEW_TITLES, type DiagramLook, type DiffView, type FromWebview, type ToWebview } from './protocol';
import { escapeHtml } from './render';

/** An exported document is given up after this long. */
const EXPORT_TIMEOUT_MS = 60_000;

/** A Chromium (or its headless shell) of the Playwright browser cache, newest first. */
function cachedChromium(): string | undefined {
  const candidates: string[] = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // Not a platform Playwright has browsers for.
  }
  // Other revisions in the Playwright cache (Linux only).
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache/ms-playwright');
  const revision = (p: string): number => Number(/^chromium(?:_headless_shell)?-(\d+)/.exec(p)?.[1] ?? 0);
  const cached = globSync(['chromium-*/chrome-linux*/chrome', 'chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell'], { cwd: cache });
  candidates.push(...cached.sort((a, b) => revision(b) - revision(a)).map((p) => join(cache, p)));
  return candidates.find((p) => existsSync(p));
}

/**
 * Launches headless Chrome: `executablePath` or $CHROME_PATH when given, else a Chromium of the Playwright cache,
 * else the Google Chrome installed on the system (as on the GitHub Actions runners).
 */
export async function launchChrome(executablePath = process.env.CHROME_PATH || undefined): Promise<Browser> {
  if (executablePath) {
    return chromium.launch({ executablePath });
  }
  const cached = cachedChromium();
  if (cached) {
    return chromium.launch({ executablePath: cached });
  }
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (error) {
    throw new Error(
      'Chrome was not found. Install Google Chrome, give its path with --chrome or $CHROME_PATH, or install a Chromium with `npx playwright-core install chromium`.',
      { cause: error },
    );
  }
}

/** Defines `acquireVsCodeApi` for webview.js, its messages going to `post`. */
function vscodeApiStub(post: string): string {
  return `let state;
window.acquireVsCodeApi = () => ({
  getState: () => state,
  setState: (s) => (state = s),
  postMessage: (m) => window.${post}(m),
});`;
}

export interface ExportedBody {
  body: string;
  /** Messages of the diagrams mermaid could not render. */
  diagramErrors: string[];
  /** Problems found while rendering it (`warnings` of the `exported` message). */
  warnings: { line?: number; message: string }[];
}

/** One page of the webview in headless Chrome, which renders the bodies of exported files one after another. */
export class HeadlessRenderer {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (body: ExportedBody) => void; reject: (error: Error) => void }>();
  private page!: Page;

  private constructor(
    private readonly browser: Browser,
    private readonly dist: string,
    private readonly lang: string,
    private readonly t: Translate,
  ) {}

  /**
   * Opens the webview with the styles of an exported file, so that the diagrams are measured with its fonts.
   * `dist` is the folder of webview.js, webview.css and export.css; `lang` the language of the documents, and `t` that
   * of the texts the webview adds (e.g. above the diagram before a change).
   */
  static async open(dist: string, options: { lang: string; chrome?: string; t?: Translate }): Promise<HeadlessRenderer> {
    const browser = await launchChrome(options.chrome);
    const renderer = new HeadlessRenderer(browser, dist, options.lang, options.t ?? formatMessage);
    try {
      await renderer.openPage();
    } catch (error) {
      await browser.close();
      throw error;
    }
    return renderer;
  }

  /** Loads the webview into a new page, and waits for it to be ready. */
  private async openPage(): Promise<void> {
    const page = await this.browser.newPage();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let started!: () => void;
      const ready = new Promise<void>((resolve, reject) => {
        started = resolve;
        timer = setTimeout(() => reject(new Error('The preview script did not start.')), EXPORT_TIMEOUT_MS);
        page.on('pageerror', (error) => reject(new Error(`The preview script failed: ${error.message}`)));
      });
      // Not to be left unhandled while the page loads.
      ready.catch(() => undefined);
      await page.exposeFunction('mdDesignDocPost', (message: FromWebview) => {
        if (message.type === 'ready') {
          started();
        } else if (message.type === 'exported') {
          this.onExported(message);
        }
      });
      const titles = Object.entries(WEBVIEW_TITLES)
        .map(([name, title]) => ` data-seqnotes-${name}="${escapeHtml(this.t(title))}"`)
        .join('');
      await page.setContent(`<!DOCTYPE html>
<html lang="${escapeHtml(this.lang)}">
<head><meta charset="UTF-8"></head>
<body class="vscode-light" data-seqnotes-theme="light"${titles}>
<div id="seqnotes-root"></div>
<script>${vscodeApiStub('mdDesignDocPost')}</script>
</body>
</html>`);
      await page.addStyleTag({ path: join(this.dist, 'webview.css') });
      await page.addStyleTag({ path: join(this.dist, 'export.css') });
      await page.addScriptTag({ path: join(this.dist, 'webview.js') });
      await ready;
    } catch (error) {
      await page.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    this.page = page;
  }

  /** Renders `html` (from `renderForExport`, or `renderDiffForExport` with `diff`) like the preview does for the export command. */
  render(html: string, diagramLook: DiagramLook, diff?: DiffView): Promise<ExportedBody> {
    const id = ++this.nextId;
    return new Promise<ExportedBody>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // The webview renders one document at a time, so the next ones would wait for this one: they get a new page.
        const page = this.page;
        void page
          .close()
          .then(() => this.openPage())
          .then(
            () => reject(new Error('The diagrams were not rendered in time.')),
            (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
          );
      }, EXPORT_TIMEOUT_MS);
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.pending.delete(id);
        fn();
      };
      this.pending.set(id, { resolve: (body) => done(() => resolve(body)), reject: (error) => done(() => reject(error)) });
      const message: ToWebview = { type: 'export', id, html, diagramLook, ...(diff ? { diff } : {}) };
      this.page.evaluate((m) => window.postMessage(m, '*'), message).catch((error: unknown) => this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error))));
    });
  }

  private onExported(message: Extract<FromWebview, { type: 'exported' }>): void {
    const pending = this.pending.get(message.id);
    if (message.body !== undefined) {
      pending?.resolve({ body: message.body, diagramErrors: message.diagramErrors ?? [], warnings: message.warnings ?? [] });
    } else {
      pending?.reject(new Error(message.error ?? 'The diagrams could not be rendered.'));
    }
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}

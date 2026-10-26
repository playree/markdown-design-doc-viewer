/**
 * `md-design-doc capture`: a screen of a running web app (e.g. a single-page app on its development server, which
 * a wireframe cannot run) captured as the HTML file of a wireframe (src/wireframe.ts). The page is opened in headless
 * Chrome, prepared by the actions of the command line or a Playwright script (e.g. to show an error message or a dialog),
 * and written as it is shown (capturePage.ts): without its scripts, with its styles and its images and fonts embedded.
 * Its parts are then numbered by selectors in the options of the wireframe (`item.1="#email"`).
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright-core';
import { assetPlaceholder, assetType, capturedFrom, inlineImports, replaceAssets, splitTopLevel, styleText, viewportUnitsToPx } from './captureCss';
import { isInFolder, type CaptureOptions } from './cliOptions';
import { capturePage, unreadableSheets, type CapturedPage } from './capturePage';
import { launchChrome } from './headless';

/** A Playwright script of `--script`: `setup` before the page is opened, its default export once it is. */
interface CaptureScript {
  default?: (page: Page, context: BrowserContext) => unknown;
  setup?: (page: Page, context: BrowserContext) => unknown;
}

/**
 * The local files the page may embed: when it is a local file itself, those in its folder or the current folder, so
 * that a page does not write the other files of the computer into the wireframe.
 */
function localFolders(pageUrl: string): string[] {
  return pageUrl.startsWith('file:') ? [dirname(fileURLToPath(pageUrl)), process.cwd()].map((folder) => realpathSync(folder)) : [];
}

/**
 * The file at `url` with its type, or undefined when it cannot be fetched: with the cookies of the page, or from the
 * disk in `folders`.
 */
async function fetchFile(context: BrowserContext, url: string, folders: string[]): Promise<{ body: Buffer; type: string } | undefined> {
  try {
    if (url.startsWith('file:')) {
      const path = realpathSync(fileURLToPath(url));
      return folders.some((folder) => isInFolder(path, folder)) ? { body: readFileSync(path), type: assetType(url, undefined) } : undefined;
    }
    const response = await context.request.get(url);
    return response.ok() ? { body: await response.body(), type: assetType(url, response.headers()['content-type']) } : undefined;
  } catch {
    return undefined;
  }
}

/** Does the actions of the command line on the page. */
async function act(page: Page, options: CaptureOptions): Promise<void> {
  for (const action of options.actions) {
    switch (action.action) {
      case 'fill':
        await page.locator(action.selector).first().fill(action.text);
        break;
      case 'click':
        await page.locator(action.selector).first().click();
        break;
      case 'hover':
        await page.locator(action.selector).first().hover();
        break;
      case 'press':
        await page.keyboard.press(action.key);
        break;
    }
  }
}

/** Captures the page of `options.url` and writes it to `options.out`. Returns the warnings (the files not embedded). */
export async function capture(options: CaptureOptions): Promise<string[]> {
  const script = options.script ? ((await import(pathToFileURL(options.script).href)) as CaptureScript) : undefined;
  const browser = await launchChrome(options.chrome);
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      colorScheme: options.colorScheme,
      // Its animations end at once, e.g. those of a dialog that opens.
      reducedMotion: 'reduce',
      storageState: options.storageState,
      // The page runs the functions of the capture.
      bypassCSP: true,
    });
    const page = await context.newPage();
    // The fonts and images the page loaded, also those of the style sheets of other origins, which its resource
    // timings leave out.
    const requested = new Set<string>();
    page.on('requestfinished', (request) => requested.add(request.url()));
    await script?.setup?.(page, context);
    await page.goto(options.url, { waitUntil: 'networkidle' });
    await script?.default?.(page, context);
    await act(page, options);
    if (options.waitFor !== undefined) {
      await page.locator(options.waitFor).first().waitFor({ state: 'visible' });
    }
    if (options.wait) {
      await page.waitForTimeout(options.wait);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Shown as they end.
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          // An animation that does not end.
        }
      }
    });

    const warnings: string[] = [];
    const folders = localFolders(page.url());
    const sheetTexts: Record<string, string> = {};
    const fetchText = async (url: string): Promise<string | undefined> => (await fetchFile(context, url, folders))?.body.toString('utf8');
    for (const href of await page.evaluate(unreadableSheets)) {
      const text = await fetchText(href);
      const missing: string[] = [];
      if (text !== undefined) {
        // The page parses its text without its `@import`s.
        sheetTexts[href] = await inlineImports(text, href, fetchText, missing);
      } else {
        missing.push(href);
      }
      warnings.push(...missing.map((url) => `Style sheet left out (could not be fetched): ${url}`));
    }
    // Given as their source: the functions run in the page.
    const helpers = `{ viewportUnitsToPx: ${viewportUnitsToPx}, splitTopLevel: ${splitTopLevel}, assetPlaceholder: ${assetPlaceholder}, styleText: ${styleText} }`;
    const captured = await page.evaluate<CapturedPage>(`(${capturePage})(${JSON.stringify(sheetTexts)}, ${JSON.stringify([...requested])}, ${helpers})`);

    const urls = await Promise.all(
      captured.assets.map(async (url) => {
        const file = await fetchFile(context, url, folders);
        if (!file) {
          warnings.push(`Not embedded (could not be fetched): ${url}`);
        }
        return file ? `data:${file.type};base64,${file.body.toString('base64')}` : url;
      }),
    );
    // Not `--` in the comment.
    const source = `${capturedFrom(options.url).replace(/-(?=-)/g, '%2D')} at ${options.width}x${options.height}`;
    const html = `<!DOCTYPE html>\n<!-- Captured by md-design-doc capture from ${source} -->\n${replaceAssets(captured.html, urls)}\n`;
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, html);
    return warnings;
  } finally {
    await browser.close();
  }
}

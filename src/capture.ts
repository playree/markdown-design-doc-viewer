/**
 * `md-design-doc capture`: a screen of a running web app (e.g. a single-page app on its development server, which
 * a wireframe cannot run) captured as the HTML file of a wireframe (src/wireframe.ts). The page is opened in headless
 * Chrome, prepared by the actions of the command line or a Playwright script (e.g. to show an error message or a dialog),
 * and written as it is shown (capturePage.ts): without its scripts, with its styles and its images and fonts embedded.
 * Its parts are then numbered by selectors in the options of the wireframe (`item.1="#email"`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright-core';
import { assetPlaceholder, assetType, replaceAssets, splitTopLevel, styleText, viewportUnitsToPx } from './captureCss';
import type { CaptureOptions } from './cliOptions';
import { capturePage, unreadableSheets, type CapturedPage } from './capturePage';
import { launchChrome } from './headless';

/** A Playwright script of `--script`: `setup` before the page is opened, its default export once it is. */
interface CaptureScript {
  default?: (page: Page, context: BrowserContext) => unknown;
  setup?: (page: Page, context: BrowserContext) => unknown;
}

/** The file at `url` as a data URI, or undefined when it cannot be fetched. */
async function fetchAsset(context: BrowserContext, url: string): Promise<string | undefined> {
  if (url.startsWith('file:')) {
    // Opened by the page, not by the requests of the context.
    return undefined;
  }
  try {
    const response = await context.request.get(url);
    if (!response.ok()) {
      return undefined;
    }
    return `data:${assetType(url, response.headers()['content-type'])};base64,${(await response.body()).toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** The text of the style sheet at `url`, or undefined when it cannot be fetched. */
async function fetchText(context: BrowserContext, url: string): Promise<string | undefined> {
  try {
    const response = await context.request.get(url);
    return response.ok() ? await response.text() : undefined;
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
    // The fonts and images the page loaded are found in its resource timings.
    await page.addInitScript(() => performance.setResourceTimingBufferSize(100_000));
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

    const sheetTexts: Record<string, string> = {};
    for (const href of await page.evaluate(unreadableSheets)) {
      const text = await fetchText(context, href);
      if (text !== undefined) {
        sheetTexts[href] = text;
      }
    }
    // Given as their source: the functions run in the page.
    const helpers = `{ viewportUnitsToPx: ${viewportUnitsToPx}, splitTopLevel: ${splitTopLevel}, assetPlaceholder: ${assetPlaceholder}, styleText: ${styleText} }`;
    const captured = await page.evaluate<CapturedPage>(`(${capturePage})(${JSON.stringify(sheetTexts)}, ${helpers})`);

    const warnings: string[] = [];
    const urls = await Promise.all(
      captured.assets.map(async (url) => {
        const data = await fetchAsset(context, url);
        if (data === undefined) {
          warnings.push(`Not embedded (could not be fetched): ${url}`);
        }
        return data ?? url;
      }),
    );
    // Not `--` in the comment.
    const source = `${options.url.replace(/-(?=-)/g, '%2D')} at ${options.width}x${options.height}`;
    const html = `<!DOCTYPE html>\n<!-- Captured by md-design-doc capture from ${source} -->\n${replaceAssets(captured.html, urls)}\n`;
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, html);
    return warnings;
  } finally {
    await browser.close();
  }
}

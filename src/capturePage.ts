/**
 * What runs in the page captured by `md-design-doc capture` (capture.ts), given to it as the source of these functions:
 * they refer to nothing outside them but their arguments (the helpers of captureCss.ts).
 */

/** The page as a wireframe: its HTML with its styles, and the URLs of its files (`assetPlaceholder` in their place). */
export interface CapturedPage {
  html: string;
  /** The URLs of the files that the placeholders in `html` stand for, by their number. */
  assets: string[];
}

/** The helpers of captureCss.ts. */
export interface CaptureHelpers {
  viewportUnitsToPx: (text: string, width: number, height: number) => string;
  splitTopLevel: (text: string) => string[];
  assetPlaceholder: (n: number) => string;
  styleText: (css: string) => string;
}

/**
 * The URLs of the style sheets whose rules the page cannot read (from another origin, also imported by another one),
 * which the capture fetches.
 */
export function unreadableSheets(): string[] {
  const hrefs: string[] = [];
  const visit = (sheet: CSSStyleSheet | null): void => {
    if (!sheet) {
      return;
    }
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href && !hrefs.includes(sheet.href)) {
        hrefs.push(sheet.href);
      }
      return;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        visit(rule.styleSheet);
      }
    }
  };
  Array.from(document.styleSheets).forEach(visit);
  return hrefs;
}

/**
 * The page as it is shown, as the HTML of a wireframe:
 * - Its elements without its scripts, frames and links, and the state of its form controls in their attributes.
 *   The text of a password is masked.
 * - Its styles (the rules of its style sheets, also those added by scripts) in one <style>: the `@media` rules that
 *   apply to the window taken in, the others left out, so that the page is laid out as in the window it was captured in;
 *   its lengths relative to the window in pixels.
 * - Its images, and the fonts it loaded, by placeholders of their URLs (`assets`).
 * `sheetTexts` are the texts of the style sheets it cannot read, by their URLs (`unreadableSheets`).
 */
export function capturePage(sheetTexts: Record<string, string>, h: CaptureHelpers): CapturedPage {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const loaded = new Set(performance.getEntriesByType('resource').map((entry) => entry.name));
  const assets: string[] = [];
  const absolute = (url: string, base: string): string | undefined => {
    try {
      return new URL(url, base).href;
    } catch {
      return undefined;
    }
  };
  /** The placeholder of the file at `url`. */
  const asset = (url: string): string => {
    let n = assets.indexOf(url);
    if (n < 0) {
      n = assets.push(url) - 1;
    }
    return h.assetPlaceholder(n);
  };
  /** The URL of `url` in the captured page: a placeholder for a file that the page loaded (or `always`), else absolute. */
  const resolveUrl = (url: string, base: string, always = false): string => {
    const href = absolute(url, base);
    if (href === undefined || /^(?:data|blob|about):/i.test(href) || url.startsWith('#')) {
      return url;
    }
    return always || loaded.has(href) ? asset(href) : href;
  };
  const URL_RE = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s'"]*))\s*\)/gi;
  const unescape = (text: string): string => text.replace(/\\(.)/g, '$1');
  const urls = (text: string, base: string, always = false): string =>
    text.replace(URL_RE, (match, double?: string, single?: string, bare?: string) => {
      const url = unescape(double ?? single ?? bare ?? '');
      return url === '' ? match : `url("${resolveUrl(url, base, always).replace(/["\\]/g, '\\$&')}")`;
    });
  const declarations = (style: CSSStyleDeclaration, base: string): string => h.viewportUnitsToPx(urls(style.cssText, base), width, height);
  const applies = (media: MediaList): boolean => media.mediaText === '' || window.matchMedia(media.mediaText).matches;

  const children = (list: CSSRuleList | undefined, base: string): string =>
    Array.from(list ?? [])
      .map((rule) => serialize(rule, base))
      .filter((text) => text !== '')
      .join('\n');
  const serialize = (rule: CSSRule, base: string): string => {
    if (rule instanceof CSSImportRule) {
      let sheet: CSSStyleSheet | null = null;
      try {
        sheet = rule.styleSheet;
      } catch {
        // Not loaded.
      }
      if (!sheet || !applies(rule.media)) {
        return '';
      }
      let text = sheetRules(sheet);
      if (rule.layerName !== null) {
        text = `@layer ${rule.layerName} {\n${text}\n}`;
      }
      return rule.supportsText ? `@supports ${rule.supportsText} {\n${text}\n}` : text;
    }
    if (rule instanceof CSSMediaRule) {
      return applies(rule.media) ? children(rule.cssRules, base) : '';
    }
    if (rule instanceof CSSFontFaceRule) {
      // Only the fonts the page loaded, which it shows.
      const sources = h.splitTopLevel(rule.style.getPropertyValue('src')).filter((source) => {
        const m = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s'"]*))\s*\)/i.exec(source);
        const href = m ? absolute(unescape(m[1] ?? m[2] ?? m[3] ?? ''), base) : undefined;
        return !m || (href !== undefined && (href.startsWith('data:') || loaded.has(href)));
      });
      if (sources.length === 0) {
        return '';
      }
      const descriptors = Array.from(rule.style).map((name) => `${name}: ${name === 'src' ? urls(sources.join(', '), base) : rule.style.getPropertyValue(name)};`);
      return `@font-face { ${descriptors.join(' ')} }`;
    }
    if (rule instanceof CSSStyleRule) {
      const nested = children(rule.cssRules, base);
      return `${rule.selectorText} { ${declarations(rule.style, base)}${nested ? `\n${nested}\n` : ' '}}`;
    }
    if (rule instanceof CSSKeyframesRule) {
      const frames = Array.from(rule.cssRules as unknown as ArrayLike<CSSKeyframeRule>).map((frame) => `${frame.keyText} { ${declarations(frame.style, base)} }`);
      return `@keyframes ${rule.name} {\n${frames.join('\n')}\n}`;
    }
    if (rule instanceof CSSGroupingRule) {
      // `@supports`, `@layer`, `@container`...: kept, with their rules.
      const prelude = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
      return `${prelude} {\n${children(rule.cssRules, base)}\n}`;
    }
    if (rule.constructor.name === 'CSSNestedDeclarations') {
      return declarations((rule as CSSStyleRule).style, base);
    }
    return urls(rule.cssText, base);
  };
  /** The rules of `sheet`, or of its text fetched by the capture when the page cannot read them. */
  const sheetRules = (sheet: CSSStyleSheet): string => {
    const base = sheet.href ?? document.baseURI;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      const text = sheet.href ? sheetTexts[sheet.href] : undefined;
      if (text === undefined) {
        return '';
      }
      const copy = new CSSStyleSheet({ baseURL: sheet.href! } as CSSStyleSheetInit);
      copy.replaceSync(text);
      rules = copy.cssRules;
    }
    return children(rules, base);
  };
  const sheets = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets].filter((sheet) => !sheet.disabled && applies(sheet.media));
  const css = sheets.map(sheetRules).filter((text) => text !== '').join('\n');

  // The elements, with the state of the page in their attributes: in the same order in the copy.
  const page = document.documentElement.cloneNode(true) as HTMLElement;
  const elements = Array.from(document.documentElement.querySelectorAll('*'));
  const copies = Array.from(page.querySelectorAll('*'));
  elements.forEach((element, i) => {
    const copy = copies[i];
    for (const name of copy.getAttributeNames()) {
      if (/^on/i.test(name)) {
        copy.removeAttribute(name);
      }
    }
    const style = copy.getAttribute('style');
    if (style) {
      copy.setAttribute('style', h.viewportUnitsToPx(urls(style, document.baseURI, true), width, height));
    }
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        copy.toggleAttribute('checked', element.checked);
      } else if (element.type === 'password') {
        copy.setAttribute('value', '•'.repeat(element.value.length));
      } else if (element.type === 'image') {
        copy.setAttribute('src', resolveUrl(element.src, document.baseURI, true));
      } else if (element.type !== 'file') {
        copy.setAttribute('value', element.value);
      }
    } else if (element instanceof HTMLTextAreaElement) {
      copy.textContent = element.value;
    } else if (element instanceof HTMLOptionElement) {
      copy.toggleAttribute('selected', element.selected);
    } else if (element instanceof HTMLImageElement) {
      const src = element.currentSrc || element.src;
      if (src) {
        copy.setAttribute('src', resolveUrl(src, document.baseURI, true));
      }
      for (const name of ['srcset', 'sizes', 'loading']) {
        copy.removeAttribute(name);
      }
    } else if (element instanceof HTMLCanvasElement) {
      // What it shows, as an image.
      try {
        const image = document.createElement('img');
        for (const name of copy.getAttributeNames()) {
          image.setAttribute(name, copy.getAttribute(name)!);
        }
        image.setAttribute('src', element.toDataURL());
        copy.replaceWith(image);
      } catch {
        // Drawn with images of another origin.
      }
    } else if (element instanceof HTMLDialogElement || element.matches(':popover-open')) {
      // Shown in the top layer, which the copy is not in: where it is, in its style.
      if (element.matches(':modal, :popover-open')) {
        const style = getComputedStyle(element);
        for (const name of ['display', 'position', 'top', 'right', 'bottom', 'left', 'margin', 'width', 'height', 'max-width', 'max-height']) {
          (copy as HTMLElement).style.setProperty(name, style.getPropertyValue(name));
        }
        (copy as HTMLElement).style.setProperty('z-index', '2147483647');
      }
    } else if (element instanceof SVGImageElement) {
      const href = element.href.baseVal;
      if (href) {
        copy.setAttribute('href', resolveUrl(href, document.baseURI, true));
        copy.removeAttribute('xlink:href');
      }
    }
  });
  // Without what does not show the page: its scripts, frames, links (its style sheets are in the <style>), the sources
  // of the <picture> elements (their <img> has the image shown), and its hidden values and metadata, which may be
  // secrets (e.g. a CSRF token).
  page
    .querySelectorAll('script, noscript, iframe, frame, object, embed, base, link, style, meta:not([charset]), input[type="hidden" i], picture > source')
    .forEach((element) => element.remove());
  let head = page.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    page.prepend(head);
  }
  const styleElement = document.createElement('style');
  styleElement.textContent = h.styleText(css);
  head.append(styleElement);
  return { html: page.outerHTML, assets };
}

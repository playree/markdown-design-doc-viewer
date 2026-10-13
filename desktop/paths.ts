/**
 * Paths of the local files of the desktop app, as the operating system gives them: `C:\docs\a.md` on Windows,
 * `/home/me/docs/a.md` elsewhere. Without Node's `path`, which is not in the webview.
 */
import { imagePath, isExternalUrl, safeDecode, SCHEME_RE } from '../src/exportPage';

/** `C:\…`, `C:/…` or a UNC path `\\server\…`. */
const WINDOWS_RE = /^(?:[a-z]:[\\/]|\\\\)/i;

export function isWindowsPath(path: string): boolean {
  return WINDOWS_RE.test(path);
}

/** The folder of a file. */
export function dirname(path: string): string {
  const windows = isWindowsPath(path);
  const at = Math.max(path.lastIndexOf('/'), windows ? path.lastIndexOf('\\') : -1);
  if (at < 0) {
    return '.';
  }
  const dir = path.slice(0, at);
  // Keep the root: `/` and `C:\`.
  if (dir === '' || (windows && /^[a-z]:$/i.test(dir))) {
    return path.slice(0, at + 1);
  }
  return dir;
}

/**
 * The file a link or image path (decoded, without its query and fragment) of a document in `dir` points to:
 * relative to the document's folder, also with a leading `/` (the app has no workspace folder, as the extension has).
 * `..` does not go above the root.
 */
export function resolveDocumentPath(dir: string, path: string): string {
  const windows = isWindowsPath(dir);
  const sep = windows ? '\\' : '/';
  const split = (p: string) => p.split(windows ? /[\\/]/ : /\//);
  let root: string;
  let rest: string;
  if (windows && dir.startsWith('\\\\')) {
    // \\server\share is the root of a UNC path.
    const [server = '', share = '', ...more] = dir.slice(2).split(/[\\/]/);
    root = `\\\\${server}\\${share}\\`;
    rest = more.join(sep);
  } else if (windows) {
    root = `${dir.slice(0, 2)}\\`;
    rest = dir.slice(3);
  } else {
    root = '/';
    rest = dir.replace(/^\/+/, '');
  }
  const parts: string[] = [];
  for (const part of [...split(rest), ...split(path)]) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return root + parts.join(sep);
}

/** The file name of a path. */
export function basename(path: string): string {
  return path.split(isWindowsPath(path) ? /[\\/]/ : /\//).pop() ?? path;
}

/** true for a Markdown file, which the app opens itself instead of passing it to the system. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/** The local file of an image `src` of a document in `dir`; undefined for a URL (`https:`, `data:`…), used as it is. */
export function resourcePath(dir: string, src: string): string | undefined {
  return isExternalUrl(src) ? undefined : resolveDocumentPath(dir, imagePath(src));
}

/** What a link of a document opens. */
export type LinkTarget =
  /** In the default browser or mail app. */
  | { kind: 'url'; url: string }
  /** A Markdown document, opened in the app, at the heading `fragment` when given. */
  | { kind: 'document'; path: string; fragment?: string }
  /** Another file, opened with its default app. */
  | { kind: 'file'; path: string };

/** The target of a link `href` (other than `#id`, which the webview handles) of a document in `dir`; undefined when it is not opened. */
export function linkTarget(dir: string, href: string): LinkTarget | undefined {
  if (SCHEME_RE.test(href)) {
    return /^(?:https?|mailto):/i.test(href) ? { kind: 'url', url: href } : undefined;
  }
  if (href.startsWith('//')) {
    return undefined;
  }
  const at = href.indexOf('#');
  const fragment = at < 0 ? '' : href.slice(at + 1);
  const [file] = (at < 0 ? href : href.slice(0, at)).split('?', 1);
  const path = resolveDocumentPath(dir, safeDecode(file));
  return isMarkdownPath(path) ? { kind: 'document', path, ...(fragment ? { fragment } : {}) } : { kind: 'file', path };
}

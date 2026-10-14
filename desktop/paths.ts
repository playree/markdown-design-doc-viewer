/**
 * Paths of the local files of the desktop app, as the operating system gives them: `C:\docs\a.md` on Windows,
 * `/home/me/docs/a.md` elsewhere. Without Node's `path`, which is not in the webview.
 */
import { imagePath, isExternalUrl, safeDecode, SCHEME_RE } from '../src/exportPage';

/** `C:\…`, `C:/…` or a UNC path `\\server\…`. */
const WINDOWS_RE = /^(?:[a-z]:[\\/]|\\\\)/i;

function isWindowsPath(path: string): boolean {
  return WINDOWS_RE.test(path);
}

/** An absolute path: its root (`C:\`, `\\server\share\` or `/`), and the names of its folders and file below it. */
interface ParsedPath {
  windows: boolean;
  root: string;
  parts: string[];
}

/** Parses the absolute path `dir`, followed by `path` (relative to it). `..` does not go above the root. */
function parsePath(dir: string, path = ''): ParsedPath {
  const windows = isWindowsPath(dir);
  const split = (p: string) => p.split(windows ? /[\\/]/ : /\//);
  let root: string;
  let rest: string[];
  if (windows && dir.startsWith('\\\\')) {
    // \\server\share is the root of a UNC path.
    const [server = '', share = '', ...more] = dir.slice(2).split(/[\\/]/);
    root = `\\\\${server}\\${share}\\`;
    rest = more;
  } else if (windows) {
    root = `${dir.slice(0, 2)}\\`;
    rest = split(dir.slice(3));
  } else {
    root = '/';
    rest = split(dir);
  }
  const parts: string[] = [];
  for (const part of [...rest, ...split(path)]) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return { windows, root, parts };
}

/**
 * The file a link or image path (decoded, without its query and fragment) of a document in `dir` points to:
 * relative to the document's folder, also with a leading `/` (the app has no workspace folder, as the extension has).
 * `..` does not go above the root.
 */
export function resolveDocumentPath(dir: string, path: string): string {
  const { windows, root, parts } = parsePath(dir, path);
  return root + parts.join(windows ? '\\' : '/');
}

/** The `file:` URL of an absolute path. */
export function fileUrl(path: string): string {
  const { windows, root, parts } = parsePath(path);
  const encoded = parts.map(encodeURIComponent).join('/');
  if (!windows) {
    return `file:///${encoded}`;
  }
  // file://server/share/… for \\server\share\…, file:///C:/… for C:\….
  const host = root.startsWith('\\\\') ? root.slice(2, -1).split('\\').map(encodeURIComponent).join('/') : `/${root.slice(0, 2)}`;
  return `file://${host}/${encoded}`;
}

/**
 * A link from the file `from` (an exported HTML file) to the file `to`: relative to the folder of `from`, so that it
 * works as long as both stay where they are, or a `file:` URL on another drive or share. As `linkFrom` of the export
 * command (src/exportHtml.ts) and of the command line (src/cli.ts).
 */
export function relativeLink(from: string, to: string): string {
  const source = parsePath(from);
  const target = parsePath(to);
  // Windows does not tell apart the case of the names.
  const same = (a: string, b: string) => (source.windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (source.windows !== target.windows || !same(source.root, target.root)) {
    return fileUrl(to);
  }
  const dir = source.parts.slice(0, -1);
  let common = 0;
  while (common < dir.length && common < target.parts.length && same(dir[common], target.parts[common])) {
    common++;
  }
  return [...dir.slice(common).map(() => '..'), ...target.parts.slice(common).map(encodeURIComponent)].join('/');
}

/** true when `path` is the folder `folder` or is below it. */
export function isInside(folder: string, path: string): boolean {
  const outer = parsePath(folder);
  const inner = parsePath(path);
  // Windows does not tell apart the case of the names.
  const same = (a: string, b: string) => (outer.windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  return (
    outer.windows === inner.windows &&
    same(outer.root, inner.root) &&
    outer.parts.length <= inner.parts.length &&
    outer.parts.every((part, i) => same(part, inner.parts[i]))
  );
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

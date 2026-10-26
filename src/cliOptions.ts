/**
 * Command line (cli.ts): the arguments of the HTML export, the files to export and where to write them, and the
 * arguments of the capture of a screen as a wireframe (capture.ts).
 */
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { exportFileName, type ExportSettings } from './exportPage';
import type { DiagramLook } from './protocol';

export const USAGE = `Usage: md-design-doc export <file|folder>... [options]
       md-design-doc capture <url> -o <file.html> [options]

Exports Markdown design docs to single HTML files, like the "Export Design Doc as HTML" command.
Folders are searched for *.md and *.markdown files (except in node_modules and folders starting with a dot).

Options:
  -o, --out-dir <dir>          Write the HTML files here, in the same folders as the documents under --root.
                               By default, each one is written next to its document.
      --root <dir>             Folder of the images whose path starts with "/", and from which local images are
                               embedded besides the document's folder. Default: the current folder.
      --lang <lang>            Language of the texts added to the document (en, ja). Default: en.
      --diagram-look <look>    Look of the diagrams: neo or classic. Default: neo.
      --split-min-width <px>   Minimum window width for diagrams beside their steps. Default: 1000.
      --full-width             Do not keep the text in a centered column.
      --no-heading-numbers     Do not show the arrow numbers (autonumber) on the linked headings.
      --no-front-matter        Hide the YAML front matter.
      --no-sticky-table-header Do not keep the header row of long tables at the top.
      --no-table-tree-highlight
                               Do not highlight the parents and children of the row under the pointer in the
                               tables shown as trees.
      --no-toc                 Do not show the table of contents at the right edge of the page.
      --chrome <path>          Chrome or Chromium to render the diagrams with. Default: $CHROME_PATH, a Chromium of
                               the Playwright cache, or the Google Chrome installed on the system.
      --strict                 Fail when a document has a warning (a broken @ref, a misplaced marker, or table
                               options that cannot be applied).
      --diff-base <rev>        Show the changes of each document since the git revision <rev> (a tag, a commit or a
                               branch), as the preview compares a document with a revision. Requires git.
      --index                  Also write index.html, a list of the exported documents, in --out-dir.
      --index-title <title>    Title of index.html. Default: "Design Docs" in --lang.
      --index-design-docs      List only the design docs (type: design_doc in their front matter) in index.html.
  -h, --help                   Show this help.
  -v, --version                Show the version.

Exit status: 0 when all the files were exported, 1 when one failed (or with --strict, had a warning),
2 for a wrong command line.

md-design-doc capture <url> -o <file.html> [options]

Captures a screen of a running web app (e.g. on its development server) as the HTML file of a wireframe: the page as
rendered, with the styles that apply to it, its images and fonts embedded, and without its scripts.

Options:
  -o, --out <file.html>        Write the HTML file here (required).
      --width <px>             Width of the window, to write as the width= of the wireframe. Default: 1280.
      --height <px>            Height of the window (of 100vh). Default: 800.
      --color-scheme <scheme>  light or dark. Default: light.
      --storage-state <file>   Cookies and storage to open the page with (a Playwright storage state), e.g. signed in.
      --script <file.mjs>      Playwright script that prepares the page: its default export is called with the page
                               once it is open, and its export setup before it is opened (e.g. to mock the API).
      --fill <selector>=<text> Types the text into the field. The selector ends at the first "=" outside brackets
                               and quotes.
      --click <selector>       Clicks the element.
      --hover <selector>       Moves the pointer over the element.
      --press <key>            Presses the key (e.g. Enter, Escape).
                               --fill, --click, --hover and --press are done in their order, after --script.
      --wait-for <selector>    Waits for the element to be shown before capturing the page.
      --wait <ms>              Waits this long before capturing the page.
      --chrome <path>          Chrome or Chromium to open the page with.

Exit status: 0 when the file was written, 1 when the page could not be captured (e.g. a selector not found),
2 for a wrong command line.`;

/** A mistake in the command line: reported with the usage, exit status 2. */
export class UsageError extends Error {}

export interface ExportOptions {
  /** The files and folders given, as absolute paths. */
  inputs: string[];
  outDir?: string;
  root: string;
  lang: string;
  diagramLook: DiagramLook;
  headingNumbers: boolean;
  frontMatter: boolean;
  settings: ExportSettings;
  chrome?: string;
  strict: boolean;
  /** The git revision whose content each document is compared with (`--diff-base`). */
  diffBase?: string;
  /** Write a list of the documents (`indexPath`). */
  index: boolean;
  indexTitle?: string;
  /** List only the design documents (`type: design_doc`). */
  indexDesignDocs: boolean;
}

/** An action on the page before it is captured (`--fill`, `--click`, `--hover`, `--press`). */
export type CaptureAction =
  | { action: 'fill'; selector: string; text: string }
  | { action: 'click' | 'hover'; selector: string }
  | { action: 'press'; key: string };

export interface CaptureOptions {
  url: string;
  /** The HTML file to write, as an absolute path. */
  out: string;
  width: number;
  height: number;
  colorScheme: 'light' | 'dark';
  storageState?: string;
  script?: string;
  actions: CaptureAction[];
  waitFor?: string;
  wait?: number;
  chrome?: string;
}

export type Command = { command: 'help' } | { command: 'version' } | ({ command: 'export' } & ExportOptions) | ({ command: 'capture' } & CaptureOptions);

/** A command name (without a folder) is looked up in PATH. */
const chromePath = (chrome: string | undefined, cwd: string): string | undefined => (chrome === undefined || !/[\\/]/.test(chrome) ? chrome : resolve(cwd, chrome));

/** Parses the arguments after `md-design-doc`, with relative paths resolved from `cwd`. */
export function parseCommandLine(args: string[], cwd: string): Command {
  if (args[0] === 'capture') {
    return parseCapture(args.slice(1), cwd);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        'out-dir': { type: 'string', short: 'o' },
        root: { type: 'string' },
        lang: { type: 'string' },
        'diagram-look': { type: 'string' },
        'split-min-width': { type: 'string' },
        'full-width': { type: 'boolean' },
        'no-heading-numbers': { type: 'boolean' },
        'no-front-matter': { type: 'boolean' },
        'no-sticky-table-header': { type: 'boolean' },
        'no-table-tree-highlight': { type: 'boolean' },
        'no-toc': { type: 'boolean' },
        chrome: { type: 'string' },
        strict: { type: 'boolean' },
        'diff-base': { type: 'string' },
        index: { type: 'boolean' },
        'index-title': { type: 'string' },
        'index-design-docs': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    return { command: 'help' };
  }
  if (values.version) {
    return { command: 'version' };
  }
  const [command, ...inputs] = positionals;
  if (command === undefined) {
    throw new UsageError('No command given.');
  }
  if (command !== 'export') {
    throw new UsageError(`Unknown command: ${command}`);
  }
  if (inputs.length === 0) {
    throw new UsageError('No file or folder to export.');
  }

  const diagramLook = values['diagram-look'] ?? 'neo';
  if (diagramLook !== 'neo' && diagramLook !== 'classic') {
    throw new UsageError(`--diagram-look must be neo or classic: ${diagramLook}`);
  }
  const splitMinWidth = Number(values['split-min-width'] ?? 1000);
  if (!Number.isFinite(splitMinWidth) || splitMinWidth < 0) {
    throw new UsageError(`--split-min-width must be a number of pixels: ${values['split-min-width']}`);
  }
  if (values['diff-base'] !== undefined && values['diff-base'].trim() === '') {
    throw new UsageError('--diff-base must be a git revision.');
  }
  if (values.index && values['out-dir'] === undefined) {
    throw new UsageError('--index requires --out-dir.');
  }
  if (values['index-title'] !== undefined && !values.index) {
    throw new UsageError('--index-title requires --index.');
  }
  if (values['index-design-docs'] && !values.index) {
    throw new UsageError('--index-design-docs requires --index.');
  }
  return {
    command: 'export',
    inputs: inputs.map((input) => resolve(cwd, input)),
    outDir: values['out-dir'] === undefined ? undefined : resolve(cwd, values['out-dir']),
    root: resolve(cwd, values.root ?? '.'),
    lang: values.lang ?? 'en',
    diagramLook,
    headingNumbers: !values['no-heading-numbers'],
    frontMatter: !values['no-front-matter'],
    settings: {
      limitContentWidth: !values['full-width'],
      stickyTableHeader: !values['no-sticky-table-header'],
      tableTreeHighlight: !values['no-table-tree-highlight'],
      splitMinWidth,
      toc: !values['no-toc'],
    },
    chrome: chromePath(values.chrome, cwd),
    strict: values.strict ?? false,
    diffBase: values['diff-base'],
    index: values.index ?? false,
    indexTitle: values['index-title'],
    indexDesignDocs: values['index-design-docs'] ?? false,
  };
}

/**
 * The selector and the text of `--fill <selector>=<text>`: split at the first `=` outside brackets, parentheses and
 * quotes, so that the selector may have attributes (`input[name=email]=a@example.com`). undefined without one.
 */
export function splitFill(value: string): { selector: string; text: string } | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === '\\') {
        i++;
      } else if (c === quote) {
        quote = undefined;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '[' || c === '(') {
      depth++;
    } else if (c === ']' || c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === '=' && depth === 0 && i > 0) {
      return { selector: value.slice(0, i), text: value.slice(i + 1) };
    }
  }
  return undefined;
}

/** A number of pixels (or milliseconds) of the option `name`, at least `min`. */
function positiveNumber(name: string, value: string | undefined, fallback: number, min = 1): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new UsageError(`--${name} must be a whole number of ${name === 'wait' ? 'milliseconds' : 'pixels'}: ${value}`);
  }
  return number;
}

/** Parses the arguments after `md-design-doc capture`. */
function parseCapture(args: string[], cwd: string): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      tokens: true,
      options: {
        out: { type: 'string', short: 'o' },
        width: { type: 'string' },
        height: { type: 'string' },
        'color-scheme': { type: 'string' },
        'storage-state': { type: 'string' },
        script: { type: 'string' },
        fill: { type: 'string', multiple: true },
        click: { type: 'string', multiple: true },
        hover: { type: 'string', multiple: true },
        press: { type: 'string', multiple: true },
        'wait-for': { type: 'string' },
        wait: { type: 'string' },
        chrome: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals, tokens } = parsed;
  if (values.help) {
    return { command: 'help' };
  }
  if (values.version) {
    return { command: 'version' };
  }
  if (positionals.length !== 1) {
    throw new UsageError(positionals.length === 0 ? 'No URL to capture.' : 'Give one URL to capture.');
  }
  const [url] = positionals;
  if (!/^(?:https?|file):/i.test(url)) {
    throw new UsageError(`The URL must start with http:, https: or file: ${url}`);
  }
  if (values.out === undefined) {
    throw new UsageError('--out is required.');
  }
  const colorScheme = values['color-scheme'] ?? 'light';
  if (colorScheme !== 'light' && colorScheme !== 'dark') {
    throw new UsageError(`--color-scheme must be light or dark: ${colorScheme}`);
  }
  // In the order written.
  const actions: CaptureAction[] = [];
  for (const token of tokens) {
    if (token.kind !== 'option' || token.value === undefined) {
      continue;
    }
    if (token.name === 'fill') {
      const fill = splitFill(token.value);
      if (!fill) {
        throw new UsageError(`--fill must be <selector>=<text>: ${token.value}`);
      }
      actions.push({ action: 'fill', ...fill });
    } else if (token.name === 'click' || token.name === 'hover') {
      actions.push({ action: token.name, selector: token.value });
    } else if (token.name === 'press') {
      actions.push({ action: 'press', key: token.value });
    }
  }
  return {
    command: 'capture',
    url,
    out: resolve(cwd, values.out),
    width: positiveNumber('width', values.width, 1280),
    height: positiveNumber('height', values.height, 800),
    colorScheme,
    storageState: values['storage-state'] === undefined ? undefined : resolve(cwd, values['storage-state']),
    script: values.script === undefined ? undefined : resolve(cwd, values.script),
    actions,
    waitFor: values['wait-for'],
    wait: values.wait === undefined ? undefined : positiveNumber('wait', values.wait, 0, 0),
    chrome: chromePath(values.chrome, cwd),
  };
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

function isMarkdown(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * The Markdown files of `folder` and its subfolders, except node_modules and the folders starting with a dot.
 * Symbolic links are followed, each folder searched once (`visited`: their real paths).
 */
function markdownFiles(folder: string, visited = new Set<string>()): string[] {
  const real = realpathSync(folder);
  if (visited.has(real)) {
    return [];
  }
  visited.add(real);
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(folder, entry.name);
    let stats: { isDirectory(): boolean; isFile(): boolean } = entry;
    if (entry.isSymbolicLink()) {
      try {
        stats = statSync(path);
      } catch {
        // A broken link.
        continue;
      }
    }
    if (stats.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        files.push(...markdownFiles(path, visited));
      }
    } else if (stats.isFile() && isMarkdown(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/**
 * The documents to export: the files given (whatever their extension), and the Markdown files in the folders given.
 * Each one once, in the order given.
 */
export function collectDocuments(inputs: string[]): string[] {
  const documents = new Set<string>();
  for (const input of inputs) {
    let stats;
    try {
      stats = statSync(input);
    } catch {
      throw new UsageError(`No such file or folder: ${input}`);
    }
    for (const file of stats.isDirectory() ? markdownFiles(input) : [input]) {
      documents.add(file);
    }
  }
  return [...documents];
}

/** true when `path` is `folder` or in it. */
export function isInFolder(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Where the document is exported: next to it, or with `outDir` in the same folders as under `root`
 * (directly in `outDir` for a document outside `root`).
 */
export function outputPath(document: string, outDir: string | undefined, root: string): string {
  const name = exportFileName(basename(document));
  if (outDir === undefined) {
    return join(dirname(document), name);
  }
  return isInFolder(document, root) ? join(outDir, dirname(relative(root, document)), name) : join(outDir, name);
}

/** The list of the documents written with `--index`. */
export function indexPath(outDir: string): string {
  return join(outDir, 'index.html');
}

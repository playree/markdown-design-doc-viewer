/** Command line of the HTML export (cli.ts): its arguments, the files to export and where to write them. */
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { exportFileName, type ExportSettings } from './exportPage';
import type { DiagramLook } from './protocol';

export const USAGE = `Usage: md-design-doc export <file|folder>... [options]

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

export type Command = { command: 'help' } | { command: 'version' } | ({ command: 'export' } & ExportOptions);

/** Parses the arguments after `md-design-doc`, with relative paths resolved from `cwd`. */
export function parseCommandLine(args: string[], cwd: string): Command {
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
    // A command name (without a folder) is looked up in PATH.
    chrome: values.chrome === undefined || !/[\\/]/.test(values.chrome) ? values.chrome : resolve(cwd, values.chrome),
    strict: values.strict ?? false,
    diffBase: values['diff-base'],
    index: values.index ?? false,
    indexTitle: values['index-title'],
    indexDesignDocs: values['index-design-docs'] ?? false,
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

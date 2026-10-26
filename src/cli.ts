/**
 * Command line of the HTML export (`md-design-doc export`), for CI and batch conversions: the same HTML file as
 * the "Export Design Doc as HTML" command, with the diagrams rendered by the preview webview in headless Chrome.
 * Also captures a screen of a web app as a wireframe (`md-design-doc capture`, capture.ts).
 *
 * Built to dist/cli.js, next to the webview files it loads (webview.js, webview.css, export.js, export.css).
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture } from './capture';
import { collectDocuments, indexPath, isInFolder, outputPath, parseCommandLine, UsageError, USAGE, type CaptureOptions, type ExportOptions } from './cliOptions';
import { documentInfo, indexBody, type IndexEntry } from './exportIndex';
import { exportDiff, exportPage, imagePath, imageType, renderDiffForExport, renderForExport, stripSourceMap } from './exportPage';
import { GitError, gitFilesAt, gitRevision, gitShowAt } from './gitCli';
import { formatRevisionDate, type Revision } from './gitLog';
import { HeadlessRenderer } from './headless';
import { collectIssues } from './issues';
import { formatMessage, translatorFor, type Translate } from './l10n';
import { WEBVIEW_TITLES, type DiffView } from './protocol';
import { createMarkdown, type RenderEnv } from './render';
import { loadWireframes, wireframeSources, type WireframeFiles } from './wireframe';

/** dist/, where the script runs from. */
const DIST = __dirname;
const L10N = join(DIST, '..', 'l10n');

/** `vscode.l10n.t` in `lang`, from l10n/bundle.l10n.<lang>.json. */
function translator(lang: string): Translate {
  if (lang === 'en') {
    return formatMessage;
  }
  const bundle = join(L10N, `bundle.l10n.${lang}.json`);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(lang) || !existsSync(bundle)) {
    throw new UsageError(`Unsupported language: ${lang}`);
  }
  return translatorFor(JSON.parse(readFileSync(bundle, 'utf8')) as Record<string, string>);
}

/** A path shown in the messages: relative to `base` (the current folder) when it is in it. */
function display(path: string, base = process.cwd()): string {
  return isInFolder(path, base) ? relative(base, path).split(sep).join('/') || '.' : path;
}

const inGitHubActions = process.env.GITHUB_ACTIONS === 'true';
/** The files of the annotations are relative to the repository, wherever the command runs from. */
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

/** Escapes a GitHub Actions workflow command: its message, and with `property` its parameters. */
function escapeCommand(text: string, property = false): string {
  const escaped = text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return property ? escaped.replace(/:/g, '%3A').replace(/,/g, '%2C') : escaped;
}

/** Reports a problem of a document on stderr, as an annotation in GitHub Actions. */
function report(severity: 'warning' | 'error', file: string, message: string, line?: number): void {
  if (inGitHubActions) {
    const params = [`file=${escapeCommand(display(file, workspace), true)}`, ...(line === undefined ? [] : [`line=${line}`])].join(',');
    console.error(`::${severity} ${params}::${escapeCommand(message)}`);
  } else {
    console.error(`${display(file)}${line === undefined ? '' : `:${line}`}: ${severity}: ${message}`);
  }
}

/** A link to `image` from `target`: relative to it, so that it works as long as both stay where they are. */
function linkFrom(target: string, image: string): string {
  const rel = relative(dirname(target), image);
  return isAbsolute(rel) ? pathToFileURL(image).href : rel.split(sep).map(encodeURIComponent).join('/');
}

/**
 * The image `src` of `document` for the file `target`: embedded as a data URI when it is in the document's folder
 * or in `root` (like the preview, which shows only the images of the document's folder and the workspace),
 * else linked.
 */
function resolveImage(src: string, document: string, target: string, root: string): string {
  const path = imagePath(src);
  // As in the preview, a leading `/` is the root of the workspace.
  const image = path.startsWith('/') ? join(root, path) : resolve(dirname(document), path);
  try {
    // Compared by their real paths, so that a symbolic link in the folders does not embed a file outside them.
    const real = realpathSync(image);
    const type = imageType(real);
    if (type && [dirname(document), root].some((folder) => isInFolder(real, realpathSync(folder)))) {
      return `data:${type};base64,${readFileSync(real).toString('base64')}`;
    }
  } catch {
    // Linked instead.
  }
  return linkFrom(target, image);
}

/**
 * The text of a file of a wireframe of `document` (`path` as in `loadWireframes`), when it is in the document's folder or
 * in `root`, like the images embedded.
 */
function readWireframeFile(path: string, document: string, root: string): string | undefined {
  const file = path.startsWith('/') ? join(root, path) : resolve(dirname(document), path);
  try {
    const real = realpathSync(file);
    if ([dirname(document), root].some((folder) => isInFolder(real, realpathSync(folder)))) {
      return readFileSync(real, 'utf8').replace(/^\uFEFF/, '');
    }
  } catch {
    // Not read.
  }
  return undefined;
}

/** The files of the wireframes of `document` (`source`). */
function readWireframes(md: ReturnType<typeof createMarkdown>, source: string, document: string, root: string): Promise<WireframeFiles> {
  return loadWireframes(md, wireframeSources(md.parse(source, {})), async (path) => readWireframeFile(path, document, root));
}

/** git, run for `--diff-base`: the one on the PATH. */
const GIT = 'git';

/** What a failure of git says, for the problems of a document. */
function gitErrorMessage(error: unknown): string {
  if (error instanceof GitError && error.kind === 'notFound') {
    return 'Git was not found: --diff-base requires git on the PATH.';
  }
  if (error instanceof GitError && error.kind === 'notRepository') {
    return '--diff-base: the document is not in a git repository.';
  }
  return `--diff-base: ${error instanceof Error ? error.message : String(error)}`;
}

/** The differences of a document from the revision of `--diff-base`, rendered for its exported file. */
interface DocumentDiff {
  html: string;
  view: DiffView;
  /** The revision did not have the document. */
  isNew: boolean;
}

/** Exports the documents. Returns true when all of them were exported without a problem that fails the run. */
async function exportDocuments(options: ExportOptions): Promise<boolean> {
  const documents = collectDocuments(options.inputs);
  if (documents.length === 0) {
    throw new UsageError('No Markdown file found.');
  }
  const targets = documents.map((document) => outputPath(document, options.outDir, options.root));
  const twice = targets.find((target, i) => targets.indexOf(target) !== i);
  if (twice !== undefined) {
    throw new UsageError(`Two documents would be exported to the same file: ${display(twice)}`);
  }
  const index = options.index && options.outDir !== undefined ? indexPath(options.outDir) : undefined;
  // Compared without case, as a file system may not tell them apart.
  if (index !== undefined && targets.some((target) => target.toLowerCase() === index.toLowerCase())) {
    throw new UsageError(`A document would be exported to the file of --index: ${display(index)}`);
  }

  const t = translator(options.lang);
  const md = createMarkdown();
  const readDist = (name: string): string => stripSourceMap(readFileSync(join(DIST, name), 'utf8'));
  const styles = [readDist('webview.css'), readDist('export.css')];
  const script = readDist('export.js');
  const tocTitle = t(WEBVIEW_TITLES['toc-title']);

  let ok = true;
  const indexEntries: IndexEntry[] = [];
  const renderer = await HeadlessRenderer.open(DIST, { lang: options.lang, chrome: options.chrome, t });

  /** The commit of `--diff-base` and the files it has in each folder of documents, looked up once. */
  const baseFolders = new Map<string, Promise<{ commit: Omit<Revision, 'path'>; files: Set<string> }>>();
  const baseFolder = (revision: string, dir: string): Promise<{ commit: Omit<Revision, 'path'>; files: Set<string> }> => {
    let folder = baseFolders.get(dir);
    if (!folder) {
      folder = gitRevision(GIT, dir, revision).then(async (commit) => ({ commit, files: await gitFilesAt(GIT, dir, commit.hash) }));
      baseFolders.set(dir, folder);
    }
    return folder;
  };
  /** Renders the document with its differences from the revision `revision`. */
  const renderWithDiff = async (
    revision: string,
    document: string,
    source: string,
    env: Omit<RenderEnv, 'forExport' | 'resolveResource'>,
    image: (src: string) => Promise<string>,
  ): Promise<DocumentDiff> => {
    let commit: Omit<Revision, 'path'>;
    let content: Uint8Array | undefined;
    try {
      const folder = await baseFolder(revision, dirname(document));
      commit = folder.commit;
      content = folder.files.has(basename(document)) ? await gitShowAt(GIT, document, commit.hash) : undefined;
    } catch (error) {
      throw new Error(gitErrorMessage(error));
    }
    // Without a BOM, like the document (TextDecoder leaves it out).
    const before = content === undefined ? '' : new TextDecoder().decode(content);
    const date = formatRevisionDate(commit.date, options.lang);
    const label = content === undefined ? t('New since the version of {0}', date) : t('Compared with the version of {0}', date);
    const { html, old, stats } = await renderDiffForExport(md, before, source.replace(/^\uFEFF/, ''), env, image);
    return { html, view: { label, old, stats }, isNew: content === undefined };
  };
  try {
    for (const [i, document] of documents.entries()) {
      const target = targets[i];
      try {
        const source = readFileSync(document, 'utf8');
        const wireframes = await readWireframes(md, source, document, options.root);
        for (const issue of collectIssues(md, source, t, wireframes).filter((issue) => issue.severity === 'warning')) {
          report('warning', document, issue.message, issue.line + 1);
          ok &&= !options.strict;
        }
        const env = { t, frontMatter: options.frontMatter, headingNumbers: options.headingNumbers, wireframes };
        const image = async (src: string): Promise<string> => resolveImage(src, document, target, options.root);
        const diff = options.diffBase === undefined ? undefined : await renderWithDiff(options.diffBase, document, source, env, image);
        const html = diff ? diff.html : await renderForExport(md, source, env, image);
        const { body, diagramErrors } = await renderer.render(html, options.diagramLook, diff?.view);
        for (const error of diagramErrors) {
          report('error', document, error);
          ok = false;
        }
        const file = basename(document);
        const info = documentInfo(md, source, file, options.frontMatter);
        const page = exportPage({ lang: options.lang, title: info.title, body, styles, script, settings: options.settings, tocTitle, ...(diff ? { diff: exportDiff(diff.view, t) } : {}) });
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, page);
        console.log(`${display(document)} -> ${display(target)}`);
        if (index !== undefined && (info.designDoc || !options.indexDesignDocs)) {
          const folder = relative(dirname(index), dirname(target)).split(sep).join('/');
          const changes = diff && { stats: diff.view.stats, isNew: diff.isNew };
          indexEntries.push({ title: info.title, meta: info.meta, href: linkFrom(index, target), folder, file, ...(changes ? { changes } : {}) });
        }
      } catch (error) {
        report('error', document, error instanceof Error ? error.message : String(error));
        ok = false;
      }
    }
  } finally {
    await renderer.close();
  }

  // The documents that could not be exported are left out, and the index too when none was.
  if (index !== undefined && indexEntries.length > 0) {
    const title = options.indexTitle || t('Design Docs');
    mkdirSync(dirname(index), { recursive: true });
    // Its only headings are the folders of the documents.
    const settings = { ...options.settings, toc: false };
    writeFileSync(index, exportPage({ lang: options.lang, title, body: indexBody(title, indexEntries, t), styles, script, settings }));
    console.log(`-> ${display(index)}`);
  } else if (index !== undefined && options.indexDesignDocs) {
    console.error(`No design doc (type: design_doc) was exported: ${display(index)} is not written.`);
  }
  return ok;
}

/** Captures the screen of `options.url` as a wireframe. */
async function captureScreen(options: CaptureOptions): Promise<number> {
  for (const warning of await capture(options)) {
    console.error(`warning: ${warning}`);
  }
  console.log(`-> ${display(options.out)}`);
  return 0;
}

async function main(args: string[]): Promise<number> {
  try {
    const command = parseCommandLine(args, process.cwd());
    switch (command.command) {
      case 'help':
        console.log(USAGE);
        return 0;
      case 'version':
        console.log((JSON.parse(readFileSync(join(DIST, '..', 'package.json'), 'utf8')) as { version: string }).version);
        return 0;
      case 'export':
        return (await exportDocuments(command)) ? 0 : 1;
      case 'capture':
        return await captureScreen(command);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`md-design-doc: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    console.error(`md-design-doc: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});

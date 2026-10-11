/**
 * Command line of the HTML export (`md-design-doc export`), for CI and batch conversions: the same HTML file as
 * the "Export Design Doc as HTML" command, with the diagrams rendered by the preview webview in headless Chrome.
 *
 * Built to dist/cli.js, next to the webview files it loads (webview.js, webview.css, export.js, export.css).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectDocuments, isInFolder, outputPath, parseCommandLine, UsageError, USAGE, type ExportOptions } from './cliOptions';
import { documentTitle, exportPage, imagePath, imageType, renderForExport, stripSourceMap } from './exportPage';
import { HeadlessRenderer } from './headless';
import { collectIssues } from './issues';
import { formatMessage, type Translate } from './l10n';
import { createMarkdown } from './render';

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
  const messages = JSON.parse(readFileSync(bundle, 'utf8')) as Record<string, string>;
  return (message, ...args) => formatMessage(messages[message] ?? message, ...args);
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
  const type = imageType(image);
  if (type && [dirname(document), root].some((folder) => isInFolder(image, folder))) {
    try {
      return `data:${type};base64,${readFileSync(image).toString('base64')}`;
    } catch {
      // Linked instead.
    }
  }
  return linkFrom(target, image);
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

  const t = translator(options.lang);
  const md = createMarkdown();
  const readDist = (name: string): string => stripSourceMap(readFileSync(join(DIST, name), 'utf8'));
  const styles = [readDist('webview.css'), readDist('export.css')];
  const script = readDist('export.js');

  let ok = true;
  const renderer = await HeadlessRenderer.open(DIST, { lang: options.lang, chrome: options.chrome });
  try {
    for (const [i, document] of documents.entries()) {
      const target = targets[i];
      try {
        const source = readFileSync(document, 'utf8');
        for (const issue of collectIssues(md, source, t).filter((issue) => issue.severity === 'warning')) {
          report('warning', document, issue.message, issue.line + 1);
          ok &&= !options.strict;
        }
        const html = await renderForExport(md, source, { t, frontMatter: options.frontMatter, headingNumbers: options.headingNumbers }, async (src) =>
          resolveImage(src, document, target, options.root),
        );
        const { body, diagramErrors } = await renderer.render(html, options.diagramLook);
        for (const error of diagramErrors) {
          report('error', document, error);
          ok = false;
        }
        const page = exportPage({ lang: options.lang, title: documentTitle(md, source, document.split(/[\\/]/).pop() ?? ''), body, styles, script, settings: options.settings });
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, page);
        console.log(`${display(document)} -> ${display(target)}`);
      } catch (error) {
        report('error', document, error instanceof Error ? error.message : String(error));
        ok = false;
      }
    }
  } finally {
    await renderer.close();
  }
  return ok;
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

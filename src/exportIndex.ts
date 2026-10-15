/**
 * The list of the documents: a page with a table of the documents of each folder, linked by their title, with the
 * main entries of their front matter. That of the exported documents (`md-design-doc export --index`), and that of
 * the design documents of the workspace (designDocs.ts) or of the folder of the desktop app. Its search box and
 * sortable columns are added by the script of the page (webview/indexList.ts).
 */
import type { MarkdownIt } from 'markdown-it';
import { frontMatterEntries, titleOf } from './exportPage';
import type { Translate } from './l10n';
import { DESIGN_DOC_META, frontMatterValue, isDesignDoc } from './markdownExtras';
import { escapeHtml } from './render';

export interface DocumentInfo {
  title: string;
  /** The entries of `DESIGN_DOC_META` that the front matter has, by key. */
  meta: Record<string, string>;
  /** Whether it is a design document (`type: design_doc`). */
  designDoc: boolean;
}

/**
 * Title of the page and main entries of a document's header (whatever its `type`, like the title).
 * Without `frontMatter` (`--no-front-matter`), the entries are hidden as in the page; the `type` still tells a
 * design document.
 */
export function documentInfo(md: MarkdownIt, source: string, fallback: string, frontMatter = true): DocumentInfo {
  const tokens = md.parse(source, {});
  const entries = frontMatterEntries(tokens);
  const meta: Record<string, string> = {};
  for (const { key } of frontMatter ? DESIGN_DOC_META : []) {
    const value = frontMatterValue(entries, key)?.trim();
    if (value !== undefined) {
      meta[key] = value;
    }
  }
  return { title: titleOf(tokens, fallback), meta, designDoc: isDesignDoc(entries) };
}

/** Whether the document may have a front matter, and so be a design document: before parsing many files. */
export function mayHaveFrontMatter(source: string): boolean {
  return /^\uFEFF?---[ \t]*\r?\n/.test(source);
}

/** Compares folder paths (with `/`) folder by folder, so that a folder is followed by its subfolders. */
function compareFolders(a: string, b: string): number {
  const as = a === '' ? [] : a.split('/');
  const bs = b === '' ? [] : b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const order = as[i].localeCompare(bs[i]);
    if (order !== 0) {
      return order;
    }
  }
  return as.length - bs.length;
}

/** The text of an empty list of the design documents (in English, to translate). */
export const NO_DESIGN_DOCS = 'There are no design docs (Markdown files with type: design_doc in their front matter).';

export interface IndexEntry extends Omit<DocumentInfo, 'designDoc'> {
  /** Link to the document (its exported file), from the index. */
  href: string;
  /** Folder of the document under that of the index, with `/` (`''` at its top). */
  folder: string;
  /** File name of the document. */
  file: string;
}

/** The documents by folder: the top folder first, each followed by its subfolders, and the files by name. */
export function groupByFolder<T extends { folder: string; file: string }>(entries: T[]): { folder: string; entries: T[] }[] {
  const folders = [...new Set(entries.map((entry) => entry.folder))].sort(compareFolders);
  return folders.map((folder) => ({ folder, entries: entries.filter((entry) => entry.folder === folder).sort((a, b) => a.file.localeCompare(b.file)) }));
}

/**
 * The body of the index: a table for each folder, the top one first, without the columns no document has; `empty`
 * in their place when there are no documents. The texts of its search box are given to the script in data attributes.
 */
export function indexBody(title: string, entries: IndexEntry[], t: Translate, empty = ''): string {
  const columns = DESIGN_DOC_META.filter(({ key }) => entries.some((entry) => key in entry.meta));
  const head =
    '<thead><tr>' +
    [t('Title'), t('File'), ...columns.map(({ label }) => t(label))].map((label) => `<th>${escapeHtml(label)}</th>`).join('') +
    '</tr></thead>\n';
  const row = (entry: IndexEntry): string =>
    '<tr>' +
    `<td class="seqnotes-index-title"><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a></td>` +
    `<td class="seqnotes-index-file">${escapeHtml(entry.file)}</td>` +
    columns
      .map(({ key }) => {
        const value = entry.meta[key];
        return `<td class="seqnotes-index-${key}">${value === undefined ? '' : `<span>${escapeHtml(value)}</span>`}</td>`;
      })
      .join('') +
    '</tr>\n';
  const tables = groupByFolder(entries).map(
    ({ folder, entries: rows }) =>
      (folder === '' ? '' : `<h2>${escapeHtml(folder)}/</h2>\n`) + `<table>\n${head}<tbody>\n${rows.map(row).join('')}</tbody>\n</table>\n`,
  );
  const texts = {
    'filter-label': t('Filter'),
    'filter-placeholder': t('Filter by title, file name or metadata'),
    // `{0}` documents shown of `{1}`, filled in by the script.
    count: t('{0} of {1} documents'),
    'no-match': t('No documents match the filter.'),
    'sort-title': t('Sort by this column'),
  };
  const attrs = Object.entries(texts)
    .map(([key, text]) => ` data-seqnotes-${key}="${escapeHtml(text)}"`)
    .join('');
  const body = entries.length === 0 ? `<p class="seqnotes-index-empty">${escapeHtml(empty)}</p>\n` : tables.join('');
  return `<div class="seqnotes-index"${attrs}>\n<h1>${escapeHtml(title)}</h1>\n${body}</div>`;
}

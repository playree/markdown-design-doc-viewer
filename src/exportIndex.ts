/**
 * The list of the exported documents (`md-design-doc export --index`): a page with a table of the documents of
 * each folder, linked by their title, with the main entries of their front matter.
 */
import type { MarkdownIt } from 'markdown-it';
import { frontMatterEntries, titleOf } from './exportPage';
import type { Translate } from './l10n';
import { DESIGN_DOC_META, frontMatterValue } from './markdownExtras';
import { escapeHtml } from './render';

export interface DocumentInfo {
  title: string;
  /** The entries of `DESIGN_DOC_META` that the front matter has, by key. */
  meta: Record<string, string>;
}

/**
 * Title of the page and main entries of a document's header (whatever its `type`, like the title).
 * Without `frontMatter` (`--no-front-matter`), the entries are hidden as in the page.
 */
export function documentInfo(md: MarkdownIt, source: string, fallback: string, frontMatter = true): DocumentInfo {
  const tokens = md.parse(source, {});
  const entries = frontMatter ? frontMatterEntries(tokens) : [];
  const meta: Record<string, string> = {};
  for (const { key } of DESIGN_DOC_META) {
    const value = frontMatterValue(entries, key)?.trim();
    if (value !== undefined) {
      meta[key] = value;
    }
  }
  return { title: titleOf(tokens, fallback), meta };
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

export interface IndexEntry extends DocumentInfo {
  /** Link to the exported file, from the index. */
  href: string;
  /** Folder of the exported file under the output folder, with `/` (`''` at its top). */
  folder: string;
  /** File name of the document. */
  file: string;
}

/** The body of the index: a table for each folder, the top one first, without the columns no document has. */
export function indexBody(title: string, entries: IndexEntry[], t: Translate): string {
  const folders = [...new Set(entries.map((entry) => entry.folder))].sort(compareFolders);
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
  const tables = folders.map((folder) => {
    const rows = entries.filter((entry) => entry.folder === folder).sort((a, b) => a.file.localeCompare(b.file));
    return (folder === '' ? '' : `<h2>${escapeHtml(folder)}/</h2>\n`) + `<table>\n${head}<tbody>\n${rows.map(row).join('')}</tbody>\n</table>\n`;
  });
  return `<div class="seqnotes-index">\n<h1>${escapeHtml(title)}</h1>\n${tables.join('')}</div>`;
}

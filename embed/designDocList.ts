/**
 * The HTML of a list of design documents embedded in a page (`createDesignDocList` of embed/viewer.ts): the list of
 * the design documents of the extension and the desktop app (`indexBody`), of documents given by the app instead of
 * the files of a folder.
 */
import type { Translate } from '../src/shared/l10n';
import type { MarkdownIt } from 'markdown-it';
import { documentInfo, indexBody, NO_DESIGN_DOCS } from '../src/export/exportIndex';

/** A document of a list (`createDesignDocList`). */
export interface DesignDocListDocument {
  /** Its Markdown, or only its front matter: its title and the main entries of its front matter come from it. */
  markdown: string;
  /** The link of its title, given to `onOpenLink` when it is clicked (`#...` scrolls the list to that fragment instead). */
  href: string;
  /** The folder it is in, with `/` between the folders: a table and a heading for each. The top one (`''`) by default. */
  folder?: string;
  /** Its file name, shown next to its title (or what `fileLabel` names). */
  file?: string;
  /** Its title, instead of that of the Markdown (the `title` of its front matter, its first `#` heading, `file`, or `href`). */
  title?: string;
}

/** The texts and order of a list. */
export interface DesignDocListContent {
  documents: DesignDocListDocument[];
  /** The heading of the list. `Design Docs` by default. */
  title?: string;
  /** The header of the column of `file`. `File` by default. */
  fileLabel?: string;
  /** The placeholder of the search box. By default, it names the title, the file name and the metadata. */
  filterPlaceholder?: string;
  /** The text without documents. By default, that of the extension. */
  empty?: string;
  /**
   * Lists the folders and the documents in the order of `documents` (a folder where its first document is) instead of
   * by name. false by default.
   */
  keepOrder?: boolean;
}

/** The HTML of the list of `content`, with the texts translated by `t`. */
export function designDocListHtml(md: MarkdownIt, content: DesignDocListContent, t: Translate): string {
  const entries = content.documents.map((doc) => {
    const file = doc.file ?? '';
    // A title to click, also when the document has none.
    const info = documentInfo(md, doc.markdown, file || doc.href);
    return { title: doc.title ?? info.title, meta: info.meta, href: doc.href, folder: doc.folder ?? '', file };
  });
  return indexBody(content.title ?? t('Design Docs'), entries, t, {
    empty: content.empty ?? t(NO_DESIGN_DOCS),
    fileLabel: content.fileLabel,
    filterPlaceholder: content.filterPlaceholder,
    keepOrder: content.keepOrder,
  });
}

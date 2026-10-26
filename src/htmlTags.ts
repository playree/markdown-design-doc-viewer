/**
 * What the extension host reads of raw HTML without a DOM: the tags of `<img>` in the HTML of a document (render.ts),
 * and those of the HTML file of a wireframe (wireframe.ts).
 */
import type { MarkdownIt } from 'markdown-it';

/** The elements whose content is text, not HTML. */
export const RAW_TEXT = 'script|style|textarea|title';

/** An attribute of a tag: its name, and its value in double quotes, in single quotes or without quotes. */
export const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The text of an HTML attribute value: its character references decoded. `unescapeAll` also takes out the backslash
 * escapes of Markdown, which are kept by doubling the backslashes.
 */
export const decodeAttribute = (md: MarkdownIt, value: string): string => md.utils.unescapeAll(value.replace(/\\/g, '\\\\'));

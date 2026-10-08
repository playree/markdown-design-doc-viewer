/**
 * Prefix for generated heading ids. Keeps them from clashing with `document` properties
 * (`title`, `links`, ...), which DOMPurify would otherwise strip to prevent DOM clobbering.
 */
export const HEADING_ID_PREFIX = 'sn-';

export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
  return slug || 'section';
}

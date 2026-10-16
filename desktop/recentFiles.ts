/**
 * The files opened recently in the desktop app (File > Open Recent, and the screen of a window that shows no file), as
 * kept in the localStorage: their absolute paths, the last one opened first. Without the DOM, so that it is tested on
 * its own.
 */

/** How many files the list keeps. */
export const MAX_RECENT_FILES = 10;

/** The list saved (a JSON array of paths), or an empty one when it is missing or not such an array. */
export function parseRecentFiles(saved: string | null): string[] {
  let value: unknown;
  try {
    value = saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const paths = value.filter((path): path is string => typeof path === 'string' && path !== '');
  return [...new Set(paths)].slice(0, MAX_RECENT_FILES);
}

/** The list with `path` first, once. */
export function addRecentFile(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((other) => other !== path)].slice(0, MAX_RECENT_FILES);
}

/** The list without `path`. */
export function removeRecentFile(list: readonly string[], path: string): string[] {
  return list.filter((other) => other !== path);
}

/** A text shown as it is in a menu item: its `&` are not access keys (`&&` is a `&` on every system). */
export function menuText(text: string): string {
  return text.replace(/&/g, '&&');
}

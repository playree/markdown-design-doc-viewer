/**
 * The settings of the desktop app (View > Settings...): those of the extension (`mdDesignDoc.*` in package.json)
 * that apply without an editor, as kept in the localStorage. The theme is kept on its own (View > Theme). Without the
 * DOM, so that it is tested on its own.
 */
import type { DiagramLook } from '../src/protocol';

export interface DesktopSettings {
  splitMinWidth: number;
  toc: boolean;
  headingNumbers: boolean;
  frontMatter: boolean;
  diagramLook: DiagramLook;
  limitContentWidth: boolean;
  stickyTableHeader: boolean;
  tableTreeHighlight: boolean;
}

/** The defaults of the extension's settings. */
export const DEFAULT_SETTINGS: Readonly<DesktopSettings> = {
  splitMinWidth: 1000,
  toc: true,
  headingNumbers: true,
  frontMatter: true,
  diagramLook: 'neo',
  limitContentWidth: true,
  stickyTableHeader: true,
  tableTreeHighlight: true,
};

/** The settings, kept for the next launch and shared by the windows. */
export const SETTINGS_KEY = 'mdDesignDoc.settings';

/** A width of the preview: a number of pixels, 0 or more. */
export function isWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** The settings saved (a JSON object), each of them at its default when it is missing or not of its type. */
export function parseSettings(saved: string | null): DesktopSettings {
  let value: unknown;
  try {
    value = saved ? JSON.parse(saved) : {};
  } catch {
    value = {};
  }
  const object = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const flag = (key: keyof DesktopSettings, fallback: boolean): boolean => (typeof object[key] === 'boolean' ? object[key] : fallback);
  return {
    splitMinWidth: isWidth(object.splitMinWidth) ? object.splitMinWidth : DEFAULT_SETTINGS.splitMinWidth,
    toc: flag('toc', DEFAULT_SETTINGS.toc),
    headingNumbers: flag('headingNumbers', DEFAULT_SETTINGS.headingNumbers),
    frontMatter: flag('frontMatter', DEFAULT_SETTINGS.frontMatter),
    diagramLook: object.diagramLook === 'classic' || object.diagramLook === 'neo' ? object.diagramLook : DEFAULT_SETTINGS.diagramLook,
    limitContentWidth: flag('limitContentWidth', DEFAULT_SETTINGS.limitContentWidth),
    stickyTableHeader: flag('stickyTableHeader', DEFAULT_SETTINGS.stickyTableHeader),
    tableTreeHighlight: flag('tableTreeHighlight', DEFAULT_SETTINGS.tableTreeHighlight),
  };
}

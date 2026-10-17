import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../desktop/settings';

describe('parseSettings', () => {
  it('gives the defaults for nothing saved or a broken value', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1]')).toEqual(DEFAULT_SETTINGS);
  });

  it('reads the settings saved', () => {
    const saved = {
      splitMinWidth: 1400,
      toc: false,
      headingNumbers: false,
      frontMatter: false,
      diagramLook: 'classic',
      limitContentWidth: false,
      stickyTableHeader: false,
      tableTreeHighlight: false,
    };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('keeps the defaults of the settings missing or not of their type', () => {
    expect(parseSettings(JSON.stringify({ toc: false, headingNumbers: 'no', diagramLook: 'hand', splitMinWidth: -1, other: 1 }))).toEqual({
      ...DEFAULT_SETTINGS,
      toc: false,
    });
    expect(parseSettings(JSON.stringify({ splitMinWidth: '800' })).splitMinWidth).toBe(DEFAULT_SETTINGS.splitMinWidth);
    expect(parseSettings(JSON.stringify({ splitMinWidth: 0 })).splitMinWidth).toBe(0);
  });
});

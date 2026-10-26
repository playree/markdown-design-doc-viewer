import { describe, expect, it } from 'vitest';
import { assetPlaceholder, assetType, replaceAssets, splitTopLevel, styleText, viewportUnitsToPx } from '../src/captureCss';

describe('captured styles', () => {
  it('turns the lengths relative to the window into pixels', () => {
    expect(viewportUnitsToPx('min-height: 100vh; width: 50vw; height: calc(100dvh - 4rem); margin: -10vmin 0.5vmax', 400, 800)).toBe(
      'min-height: 800px; width: 200px; height: calc(800px - 4rem); margin: -40px 4px',
    );
    expect(viewportUnitsToPx('inline-size: 25svi; block-size: 12.5lvb', 400, 800)).toBe('inline-size: 100px; block-size: 100px');
  });

  it('leaves the names and URLs that look like lengths', () => {
    const text = '--h-100vh: 1px; height: var(--h-100vh); background: url("https://example.com/100vh.png?h=10vh")';
    expect(viewportUnitsToPx(text, 400, 800)).toBe(text);
  });

  it('splits a list at its top level commas', () => {
    expect(splitTopLevel('url("a,b.woff2") format("woff2"), local(Arial) , url(c.woff)')).toEqual(['url("a,b.woff2") format("woff2")', 'local(Arial)', 'url(c.woff)']);
    expect(splitTopLevel('')).toEqual([]);
  });

  it('replaces the placeholders of the files', () => {
    expect(replaceAssets(`<img src="${assetPlaceholder(1)}"> url("${assetPlaceholder(0)}") ${assetPlaceholder(2)}`, ['A', 'B'])).toBe('<img src="B"> url("A") seqnotes-asset:2');
  });

  it('takes the type of a file from its response, else from its extension', () => {
    expect(assetType('https://example.com/a.png', 'image/png; charset=binary')).toBe('image/png');
    expect(assetType('https://example.com/font.woff2?v=1', 'application/octet-stream')).toBe('font/woff2');
    expect(assetType('https://example.com/file', undefined)).toBe('application/octet-stream');
  });

  it('escapes what would end the <style> or have it removed', () => {
    expect(styleText('a::after { content: "</style><b>"; background: url("data:image/svg+xml,<svg/>") } @container (width < 40rem) {}')).toBe(
      'a::after { content: "\\3c /style>\\3c b>"; background: url("data:image/svg+xml,\\3c svg/>") } @container (width < 40rem) {}',
    );
  });
});

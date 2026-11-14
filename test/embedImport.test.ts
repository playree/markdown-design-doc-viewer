import { describe, expect, it } from 'vitest';

// The embedded viewer may be imported by an app rendered on a server (Next.js, for instance), where there is no
// document: its modules (and those of the preview they import) must not use it before a viewer is created.
describe('embedded viewer on a server', () => {
  it('runs without a document', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('imports createViewer without touching the DOM', async () => {
    const viewer = await import('../embed/viewer');
    expect(typeof viewer.createViewer).toBe('function');
    expect(typeof viewer.openLinkInNewTab).toBe('function');
  });

  it('imports the React component without touching the DOM', async () => {
    const react = await import('../embed/react');
    expect(react.DesignDocViewer).toBeDefined();
  });

  it('imports exportHtml without touching the DOM', async () => {
    const exported = await import('../embed/export');
    expect(typeof exported.exportHtml).toBe('function');
  });
});

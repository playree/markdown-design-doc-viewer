/**
 * The viewer of embed/viewer.ts as a React component. Its styles are embed/viewer.css, which the app imports.
 *
 *   <DesignDocViewer markdown={text} baseUrl="/docs/" style={{ height: 600 }} />
 *
 * It needs a height, which the viewer fills. `readFile` and `resolveResource` render the document again when they
 * change: keep them the same across renders (`useCallback`). The other callbacks may change freely.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { createViewer, openLinkInNewTab, type Viewer, type ViewerOptions } from './viewer';

export type { ViewerOptions } from './viewer';

export interface DesignDocViewerProps extends ViewerOptions {
  className?: string;
  style?: CSSProperties;
}

/** What the `ref` of a `DesignDocViewer` gives. */
export interface DesignDocViewerHandle {
  /** Scrolls the viewer so that this line (0-based) of the Markdown is at the top. */
  scrollToLine(line: number): void;
  /** Marks the element of this line (0-based), and scrolls it into view. */
  markLine(line: number): void;
}

export const DesignDocViewer = forwardRef<DesignDocViewerHandle, DesignDocViewerProps>(function DesignDocViewer({ className, style, ...options }, ref) {
  const element = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | undefined>(undefined);
  /** true from the creation of the viewer until the effect that updates it: it was created with the options of now. */
  const created = useRef(false);
  // The callbacks of the last render, called through these.
  const latest = useRef(options);
  latest.current = options;

  const revealing = options.onRevealLine !== undefined;
  const viewerOptions = (): ViewerOptions => ({
    ...latest.current,
    onOpenLink: (href) => (latest.current.onOpenLink ?? openLinkInNewTab)(href),
    // Only with one: without, a double-click does nothing.
    onRevealLine: revealing ? (line) => latest.current.onRevealLine?.(line) : undefined,
  });

  // Created again for another language, which the viewer takes at its creation only.
  useEffect(() => {
    const instance = createViewer(element.current!, viewerOptions());
    viewer.current = instance;
    created.current = true;
    return () => {
      instance.destroy();
      viewer.current = undefined;
    };
  }, [options.lang]);

  const { markdown, documentId, baseUrl, readFile, resolveResource, theme, diagramLook, splitMinWidth, toc, limitContentWidth, stickyTableHeader, tableTreeHighlight, frontMatter, headingNumbers, messageWrapWidth } = options;
  useEffect(() => {
    // Run after the effect above in the same commit: not again with the options it was just created with.
    if (created.current) {
      created.current = false;
      return;
    }
    void viewer.current?.update(viewerOptions());
    // With `lang`: also run after the viewer is created again for another language, so that the flag is reset there.
  }, [options.lang, markdown, documentId, baseUrl, readFile, resolveResource, theme, diagramLook, splitMinWidth, toc, limitContentWidth, stickyTableHeader, tableTreeHighlight, frontMatter, headingNumbers, messageWrapWidth, revealing]);

  useImperativeHandle(ref, () => ({
    scrollToLine: (line) => viewer.current?.scrollToLine(line),
    markLine: (line) => viewer.current?.markLine(line),
  }));

  return <div ref={element} className={className} style={style} />;
});

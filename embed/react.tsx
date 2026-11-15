/**
 * The viewer of embed/viewer.ts as a React component. Its styles are embed/viewer.css, which the app imports.
 *
 *   <DesignDocViewer markdown={text} baseUrl="/docs/" style={{ height: 600 }} />
 *   <DesignDocList documents={[{ markdown, href: '/docs/login', file: 'login.md' }]} onOpenLink={navigate} />
 *
 * It needs a height, which the viewer fills. `readFile` and `resolveResource` render the document again when they
 * change: keep them the same across renders (`useCallback`). The other callbacks may change freely.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { createDesignDocList, createViewer, openLinkInNewTab, openLinkInPage, type DesignDocList as List, type DesignDocListOptions, type Viewer, type ViewerOptions } from './viewer';

export type { DesignDocListDocument, DesignDocListOptions, ViewerOptions } from './viewer';

/** All the options, with those not given as undefined: an update then resets an option removed from the props. */
type AllOptions<T> = { [K in keyof Required<T>]: T[K] };

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
  // The options of the last render committed, whose callbacks are called through these.
  const latest = useRef(options);
  // Before the effects below, which read it: not in the render, which React may discard.
  useEffect(() => {
    latest.current = options;
  });

  const revealing = options.onRevealLine !== undefined;
  const closing = options.onCloseDiff !== undefined;
  const viewerOptions = (): AllOptions<ViewerOptions> => {
    const o = latest.current;
    return {
      markdown: o.markdown,
      documentId: o.documentId,
      baseUrl: o.baseUrl,
      readFile: o.readFile,
      resolveResource: o.resolveResource,
      lang: o.lang,
      theme: o.theme,
      diagramLook: o.diagramLook,
      splitMinWidth: o.splitMinWidth,
      toc: o.toc,
      limitContentWidth: o.limitContentWidth,
      stickyTableHeader: o.stickyTableHeader,
      tableTreeHighlight: o.tableTreeHighlight,
      frontMatter: o.frontMatter,
      headingNumbers: o.headingNumbers,
      messageWrapWidth: o.messageWrapWidth,
      compareWith: o.compareWith,
      compareLabel: o.compareLabel,
      onOpenLink: (href) => (latest.current.onOpenLink ?? openLinkInNewTab)(href),
      // Only with one: without, a double-click does nothing.
      onRevealLine: o.onRevealLine !== undefined ? (line) => latest.current.onRevealLine?.(line) : undefined,
      // Only with one: without, the viewer closes the differences by itself.
      onCloseDiff: o.onCloseDiff !== undefined ? () => latest.current.onCloseDiff?.() : undefined,
    };
  };

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

  const { markdown, documentId, baseUrl, readFile, resolveResource, theme, diagramLook, splitMinWidth, toc, limitContentWidth, stickyTableHeader, tableTreeHighlight, frontMatter, headingNumbers, messageWrapWidth, compareWith, compareLabel } = options;
  useEffect(() => {
    // Run after the effect above in the same commit: not again with the options it was just created with.
    if (created.current) {
      created.current = false;
      return;
    }
    void viewer.current?.update(viewerOptions());
    // With `lang`: also run after the viewer is created again for another language, so that the flag is reset there.
  }, [options.lang, markdown, documentId, baseUrl, readFile, resolveResource, theme, diagramLook, splitMinWidth, toc, limitContentWidth, stickyTableHeader, tableTreeHighlight, frontMatter, headingNumbers, messageWrapWidth, compareWith, compareLabel, revealing, closing]);

  useImperativeHandle(ref, () => ({
    scrollToLine: (line) => viewer.current?.scrollToLine(line),
    markLine: (line) => viewer.current?.markLine(line),
  }));

  return <div ref={element} className={className} style={style} />;
});

export interface DesignDocListProps extends DesignDocListOptions {
  className?: string;
  style?: CSSProperties;
}

/**
 * The list of the design documents of createDesignDocList (embed/viewer.ts), as high as the list. `onOpenLink` may
 * change freely; the list is shown again when the other options change (keep `documents` the same across renders
 * while they do not change: `useMemo`).
 */
export function DesignDocList({ className, style, ...options }: DesignDocListProps) {
  const element = useRef<HTMLDivElement>(null);
  const list = useRef<List | undefined>(undefined);
  /** true from the creation of the list until the effect that updates it: it was created with the options of now. */
  const created = useRef(false);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const listOptions = (): AllOptions<DesignDocListOptions> => {
    const o = latest.current;
    return {
      documents: o.documents,
      title: o.title,
      fileLabel: o.fileLabel,
      filterPlaceholder: o.filterPlaceholder,
      empty: o.empty,
      keepOrder: o.keepOrder,
      lang: o.lang,
      theme: o.theme,
      limitContentWidth: o.limitContentWidth,
      onOpenLink: (href) => (latest.current.onOpenLink ?? openLinkInPage)(href),
    };
  };

  // Created again for another language, which the list takes at its creation only.
  useEffect(() => {
    const instance = createDesignDocList(element.current!, listOptions());
    list.current = instance;
    created.current = true;
    return () => {
      instance.destroy();
      list.current = undefined;
    };
  }, [options.lang]);

  const { documents, title, fileLabel, filterPlaceholder, empty, keepOrder, theme, limitContentWidth } = options;
  useEffect(() => {
    if (created.current) {
      created.current = false;
      return;
    }
    void list.current?.update(listOptions());
  }, [options.lang, documents, title, fileLabel, filterPlaceholder, empty, keepOrder, theme, limitContentWidth]);

  return <div ref={element} className={className} style={style} />;
}

/**
 * The demo of the embedded viewer (`pnpm embed:demo`): a React page with two viewers side by side, which shows the
 * examples copied next to it. A viewer's theme and document can be switched, and the other one double-clicked. The
 * document of a viewer can be exported to an HTML file (`exportHtml`, imported when it is used, as an app would).
 * Tailwind's preflight can be put on the page, to see that the viewer looks the same in an app that uses it.
 * "Compare" shows the differences from an older version of the document made up by the demo (`olderVersion`): the
 * left viewer closes them with `onCloseDiff`, which unchecks it, and the right one by itself.
 *
 * It imports the viewer as an app does, from its npm package: scripts/embed-demo.mjs resolves it to the sources, or to
 * the package (--package).
 */
import { DesignDocViewer, type DesignDocViewerHandle } from 'markdown-design-doc-viewer-embed/react';
import 'markdown-design-doc-viewer-embed/viewer.css';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './demo.css';

const DOCUMENTS = ['login.md', 'password-reset.md', 'flowchart.md', 'wireframe.md', 'er-diagram.md', 'state-diagram.md', 'tables.md', 'message-definition.ja.md', 'front-matter.md', 'link-checks.md', 'screenshot.md'];
const baseUrl = new URL('examples/', location.href).href;

/** An example, read from the folder copied next to the page: the last one read while another one is read. */
function useExample(name: string): { name: string; text: string } | undefined {
  const [example, setExample] = useState<{ name: string; text: string }>();
  useEffect(() => {
    let cancelled = false;
    fetch(new URL(name, baseUrl))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${name}: ${response.status} ${response.statusText}`);
        }
        const text = await response.text();
        if (!cancelled) {
          setExample({ name, text });
        }
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [name]);
  return example;
}

/**
 * A made-up older version of `text`, for the differences: without the last line of its first diagram (an arrow of a
 * sequence diagram, for instance), with other words at the end of its first paragraph, and with a paragraph after it
 * that the document no longer has.
 */
function olderVersion(text: string): string {
  const lines = text.split('\n');
  let fence: 'mermaid' | 'other' | undefined;
  let diagrams = 0;
  let diagramLine: number | undefined;
  let paragraphEnd: number | undefined;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = fence ? undefined : /mermaid/.test(line) ? 'mermaid' : 'other';
      diagrams += fence === 'mermaid' ? 1 : 0;
    } else if (fence === 'mermaid' && diagrams === 1 && line.trim() !== '' && !/^\s*(%%|end\b)/.test(line)) {
      diagramLine = i;
    } else if (!fence && paragraphEnd === undefined && i > 0 && lines[i - 1].trim() === '' && /^[A-Za-z\u3000-\u9fff]/.test(line)) {
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].trim() !== '') {
        end += 1;
      }
      paragraphEnd = end;
    }
  });
  if (diagramLine !== undefined) {
    lines.splice(diagramLine, 1);
    paragraphEnd = paragraphEnd !== undefined && paragraphEnd > diagramLine ? paragraphEnd - 1 : paragraphEnd;
  }
  if (paragraphEnd !== undefined) {
    lines[paragraphEnd] = `${lines[paragraphEnd].replace(/\s*\S+$/, '')} as it was before.\n\nA paragraph that was removed since.`;
  }
  return lines.join('\n');
}

function Pane({ initial, revealLine, closeDiff }: { initial: string; revealLine?: boolean; closeDiff?: boolean }) {
  const [name, setName] = useState(initial);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [lang, setLang] = useState<'en' | 'ja'>('en');
  const [line, setLine] = useState<number>();
  const [compare, setCompare] = useState(false);
  const viewer = useRef<DesignDocViewerHandle>(null);
  const example = useExample(name);
  const compareWith = useMemo(() => (compare && example ? olderVersion(example.text) : undefined), [compare, example]);
  return (
    <section className="demo-pane">
      <div className="demo-toolbar">
        <select value={name} onChange={(e) => setName(e.target.value)} aria-label="Document">
          {DOCUMENTS.map((doc) => (
            <option key={doc}>{doc}</option>
          ))}
        </select>
        <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} aria-label="Theme">
          <option>auto</option>
          <option>light</option>
          <option>dark</option>
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} aria-label="Language">
          <option>en</option>
          <option>ja</option>
        </select>
        <button type="button" onClick={() => viewer.current?.scrollToLine(40)}>
          Line 40
        </button>
        <label>
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare
        </label>
        <button type="button" disabled={!example} onClick={() => example && download(example, lang, compareWith).catch((error: unknown) => console.error(error))}>
          Export HTML
        </button>
        {revealLine && <span className="demo-line">{line === undefined ? 'Double-click the document' : `Line ${line}`}</span>}
      </div>
      {example && (
        <DesignDocViewer
          ref={viewer}
          className="demo-viewer"
          markdown={example.text}
          documentId={example.name}
          baseUrl={baseUrl}
          theme={theme}
          lang={lang}
          onRevealLine={revealLine ? setLine : undefined}
          compareWith={compareWith}
          compareLabel={compareWith === undefined ? undefined : 'Compared with an older version'}
          onCloseDiff={closeDiff ? () => setCompare(false) : undefined}
        />
      )}
    </section>
  );
}

/** Exports `example` (with its differences from `compareWith`, if any) to an HTML file, which the browser downloads. */
async function download(example: { name: string; text: string }, lang: 'en' | 'ja', compareWith: string | undefined): Promise<void> {
  const { exportHtml } = await import('markdown-design-doc-viewer-embed/export');
  const html = await exportHtml({ markdown: example.text, lang, baseUrl, title: example.name, compareWith, compareLabel: compareWith === undefined ? undefined : 'Compared with an older version' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  link.download = example.name.replace(/\.md$/, '.html');
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Puts Tailwind's preflight (preflight.css, written by scripts/embed-demo.mjs) on the page, or takes it off. */
function PreflightToggle() {
  const [on, setOn] = useState(() => new URLSearchParams(location.search).has('preflight'));
  useEffect(() => {
    const link = document.getElementById('preflight') as HTMLLinkElement | null;
    if (link) {
      link.disabled = !on;
    }
  }, [on]);
  return (
    <label className="demo-preflight">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Tailwind preflight
    </label>
  );
}

function App() {
  return (
    <div className="demo-page">
      <header className="demo-header">
        <PreflightToggle />
      </header>
      <main className="demo">
        <Pane initial="login.md" closeDiff />
        <Pane initial="wireframe.md" revealLine />
      </main>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

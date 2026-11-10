/**
 * The demo of the embedded viewer (`pnpm embed:demo`): a React page with two viewers side by side, which shows the
 * examples copied next to it. A viewer's theme and document can be switched, and the other one double-clicked.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignDocViewer, type DesignDocViewerHandle } from '../react';
import '../viewer.css';
import './demo.css';

const DOCUMENTS = ['login.md', 'password-reset.md', 'flowchart.md', 'wireframe.md', 'er-diagram.md', 'state-diagram.md', 'tables.md'];
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

function Pane({ initial, revealLine }: { initial: string; revealLine?: boolean }) {
  const [name, setName] = useState(initial);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [lang, setLang] = useState<'en' | 'ja'>('en');
  const [line, setLine] = useState<number>();
  const viewer = useRef<DesignDocViewerHandle>(null);
  const example = useExample(name);
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
        />
      )}
    </section>
  );
}

function App() {
  return (
    <main className="demo">
      <Pane initial="login.md" />
      <Pane initial="wireframe.md" revealLine />
    </main>
  );
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

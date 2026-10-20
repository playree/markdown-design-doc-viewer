/**
 * The table of contents at the right edge of the page: a short line per heading (h1-h3), opened into the list on
 * hover by the CSS. Shared by the preview (`main.ts`) and exported HTML (`export.ts`).
 */

const TOC_CURRENT = 'seqnotes-toc-current';
/** A heading becomes the current one once its top is above this part of the window. */
const TOC_CURRENT_RATIO = 0.2;

export interface Toc {
  /** Lists the headings of the root again, or none when `enabled` is false. */
  build(enabled: boolean): void;
}

/** The heading text without the `autonumber` badge added by `addStepBadge`, nor the footnote references. */
function headingText(heading: Element): string {
  const clone = heading.cloneNode(true) as Element;
  clone.querySelectorAll('.seqnotes-step, .footnote-ref, .seqnotes-diff-del').forEach((badge) => badge.remove());
  return (clone.textContent ?? '').trim();
}

function revealHeading(heading: Element): void {
  // A heading in a closed <details> is not displayed and would not scroll.
  for (let details = heading.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
    details.open = true;
  }
  heading.scrollIntoView({ block: 'start' });
}

/** Sets up the table of contents of the headings in `root`, empty until `build` is called. */
export function setupToc(root: HTMLElement): Toc {
  const toc = document.createElement('nav');
  toc.className = 'seqnotes-toc';
  toc.hidden = true;
  const tocTitle = document.createElement('div');
  tocTitle.className = 'seqnotes-toc-title';
  // Translated by the extension host (`shell()` in previewPanel.ts), or written in the exported page (`exportPage`).
  tocTitle.textContent = document.body.dataset.seqnotesTocTitle ?? '';
  toc.setAttribute('aria-label', tocTitle.textContent);
  const tocList = document.createElement('ol');
  toc.append(tocTitle, tocList);
  // Outside the root, so the arrow / heading handlers on it do not see the clicks.
  document.body.append(toc);

  let tocHeadings: Element[] = [];
  /** Index of the current item in `tocHeadings`, -1 for none. */
  let tocCurrent = -1;

  function build(enabled: boolean): void {
    const entries = enabled
      ? Array.from(root.querySelectorAll('h1, h2, h3'))
          // Not those of the revision, gone from the document.
          .filter((heading) => !heading.closest('[data-seqnotes-diff="deleted"]'))
          .map((heading) => ({ heading, level: Number(heading.tagName[1]), text: headingText(heading) }))
          .filter((entry) => entry.text)
      : [];
    const minLevel = Math.min(...entries.map((entry) => entry.level));
    const scrollTop = tocList.scrollTop;
    tocList.replaceChildren(
      ...entries.map(({ heading, level, text }) => {
        const item = document.createElement('li');
        item.style.setProperty('--seqnotes-toc-depth', String(level - minLevel));
        const button = document.createElement('button');
        button.type = 'button';
        button.title = text;
        const label = document.createElement('span');
        label.className = 'seqnotes-toc-text';
        label.textContent = text;
        button.append(label);
        // Keeps mouse clicks from focusing the button: the list then closes when the mouse leaves, and keys still scroll the page.
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => revealHeading(heading));
        item.append(button);
        return item;
      }),
    );
    tocList.scrollTop = scrollTop;
    tocHeadings = entries.map((entry) => entry.heading);
    tocCurrent = -1;
    toc.hidden = entries.length === 0;
    updateTocCurrent();
  }

  function updateTocCurrent(): void {
    // The last headings may never reach the threshold; at the end of the page take the last one on the screen.
    // Not on a page that does not scroll: it is at the top, and everything on it is on the screen.
    const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    const threshold = atEnd ? window.innerHeight : window.innerHeight * TOC_CURRENT_RATIO;
    let current = -1;
    for (const [i, heading] of tocHeadings.entries()) {
      const r = heading.getBoundingClientRect();
      // A heading that is not displayed (e.g. in a closed <details>) has an empty rect.
      if (r.height === 0) {
        continue;
      }
      if (r.top > threshold) {
        break;
      }
      current = i;
    }
    if (current === tocCurrent) {
      return;
    }
    setTocCurrent(tocCurrent, false);
    setTocCurrent(current, true);
    tocCurrent = current;
    // Not while open: the list would move under the mouse.
    if (!toc.matches(':hover')) {
      revealTocCurrent();
    }
  }

  function setTocCurrent(index: number, on: boolean): void {
    const item = tocList.children[index];
    if (!item) {
      return;
    }
    item.classList.toggle(TOC_CURRENT, on);
    // For screen readers, which do not see the highlighted line.
    const button = item.querySelector('button')!;
    if (on) {
      button.setAttribute('aria-current', 'location');
    } else {
      button.removeAttribute('aria-current');
    }
  }

  /** Scrolls the list (not the page, as scrollIntoView would) so that the current item is in it. */
  function revealTocCurrent(): void {
    const item = tocList.children[tocCurrent];
    if (!(item instanceof HTMLElement)) {
      return;
    }
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < tocList.scrollTop) {
      tocList.scrollTop = top;
    } else if (bottom > tocList.scrollTop + tocList.clientHeight) {
      tocList.scrollTop = bottom - tocList.clientHeight;
    }
  }

  // The closed and the open list are laid out differently, so bring the current item into view on switching.
  toc.addEventListener('pointerenter', revealTocCurrent);
  toc.addEventListener('pointerleave', revealTocCurrent);
  toc.addEventListener('focusin', (e) => {
    if (!toc.contains(e.relatedTarget as Node | null)) {
      revealTocCurrent();
    }
  });

  let tocFrame = 0;

  function scheduleTocCurrent(): void {
    if (!tocFrame) {
      tocFrame = requestAnimationFrame(() => {
        tocFrame = 0;
        updateTocCurrent();
      });
    }
  }

  window.addEventListener('scroll', scheduleTocCurrent, { passive: true });
  window.addEventListener('resize', scheduleTocCurrent);
  // Headings also move without scrolling, e.g. when a <details> is toggled or an image is loaded.
  new ResizeObserver(scheduleTocCurrent).observe(root);

  return { build };
}

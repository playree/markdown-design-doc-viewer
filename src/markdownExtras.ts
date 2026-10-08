/**
 * markdown-it plugins for Markdown found in design documents that markdown-it does not handle
 * by itself: YAML front matter, GitHub alerts and task lists, plus code highlighting.
 */
import hljs from 'highlight.js/lib/common';
import type { MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';

/** `highlight` option of markdown-it. An empty string makes markdown-it escape the code itself. */
export function highlight(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) {
    return '';
  }
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return '';
  }
}

// The first line of a front matter block must be a `key:` line, so that a document starting with a horizontal rule stays as it is.
// Keys may be non-ASCII (`タイトル:`) or quoted.
const YAML_KEY_RE = /^(?:"[^"]*"|'[^']*'|[^\s#:"'-][^:]*?)\s*:(?:\s|$)/;

/** Hides a YAML front matter block at the top of the document, like the built-in preview does by default. */
function frontMatter(md: MarkdownIt): void {
  md.block.ruler.before('table', 'seqnotes_front_matter', (state: StateBlock, startLine: number, endLine: number) => {
    const line = (n: number): string => state.src.slice(state.bMarks[n], state.eMarks[n]).trimEnd();
    if (startLine !== 0 || state.parentType !== 'root' || line(0) !== '---' || endLine < 2 || !YAML_KEY_RE.test(line(1))) {
      return false;
    }
    for (let n = 1; n < endLine; n++) {
      if (line(n) === '---' || line(n) === '...') {
        // No token: the lines are skipped, and later blocks keep their source lines.
        state.line = n + 1;
        return true;
      }
    }
    return false;
  });
}

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/**
 * Turns `> [!NOTE]` blockquotes into `<div class="markdown-alert markdown-alert-note">` with a title.
 * Like GitHub, only top-level blockquotes with some text after the marker are converted.
 * Runs before the inline rule, so editing the paragraph's content is enough.
 */
function githubAlerts(md: MarkdownIt): void {
  md.core.ruler.after('block', 'seqnotes_alerts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      const inline = tokens[i + 2];
      if (open.type !== 'blockquote_open' || open.level !== 0 || tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') {
        continue;
      }
      const m = ALERT_RE.exec(inline.content);
      if (!m) {
        continue;
      }
      const type = m[1].toLowerCase();
      let close = i + 1;
      while (tokens[close].type !== 'blockquote_close' || tokens[close].level !== open.level) {
        close++;
      }
      if (m[0].length === inline.content.length && close === i + 4) {
        continue;
      }
      open.tag = 'div';
      open.attrJoin('class', `markdown-alert markdown-alert-${type}`);
      tokens[close].tag = 'div';

      inline.content = inline.content.slice(m[0].length);
      // The text now starts on the line after the marker.
      const paragraph = tokens[i + 1];
      if (paragraph.map && inline.content !== '') {
        paragraph.map = [paragraph.map[0] + 1, paragraph.map[1]];
      }
      const title = [new state.Token('paragraph_open', 'p', 1), new state.Token('inline', '', 0), new state.Token('paragraph_close', 'p', -1)];
      title[0].attrSet('class', 'markdown-alert-title');
      title[0].map = open.map;
      title[1].content = type[0].toUpperCase() + type.slice(1);
      title[1].children = [];
      title.forEach((t, k) => (t.level = open.level + (k === 1 ? 2 : 1)));
      title[0].block = title[2].block = true;
      // A marker on a paragraph of its own leaves an empty paragraph behind.
      tokens.splice(i + 1, inline.content === '' ? 3 : 0, ...title);
    }
  });
}

const TASK_RE = /^\[([ xX])\](?=\s|$)\s*/;

/** Renders `- [ ] item` / `- [x] item` with a (read-only) checkbox. */
function taskLists(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'seqnotes_task_lists', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const inline = tokens[i + 2];
      const first = inline?.children?.[0];
      if (tokens[i].type !== 'list_item_open' || tokens[i + 1].type !== 'paragraph_open' || inline.type !== 'inline' || first?.type !== 'text') {
        continue;
      }
      const m = TASK_RE.exec(first.content);
      if (!m) {
        continue;
      }
      first.content = first.content.slice(m[0].length);
      const checkbox: Token = new state.Token('html_inline', '', 0);
      checkbox.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
      inline.children!.unshift(checkbox);
      tokens[i].attrJoin('class', 'task-list-item');
    }
  });
}

export function markdownExtras(md: MarkdownIt): void {
  md.set({ highlight });
  md.use(frontMatter).use(githubAlerts).use(taskLists);
}

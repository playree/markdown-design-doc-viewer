/**
 * markdown-it plugins for Markdown found in design documents that markdown-it does not handle
 * by itself: YAML front matter, GitHub alerts and task lists, plus code highlighting.
 */
import hljs from 'highlight.js/lib/common';
import type { Env, MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';

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

/** A top-level entry of a front matter block, as shown in the preview. */
export interface FrontMatterEntry {
  key: string;
  value: string;
}

const unquote = (s: string): string => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);

/**
 * Reads the top-level `key: value` entries of a YAML front matter block, without a YAML parser:
 * the lines that follow a key (indented or not) are its value. A list (`- item` or `[a, b]`) is joined
 * with commas, a block scalar (`|`, `>`) and other nested values keep their lines.
 */
export function parseFrontMatter(yaml: string): FrontMatterEntry[] {
  const entries: { key: string; rest: string; lines: string[] }[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^\S/.test(line) ? YAML_KEY_RE.exec(line) : null;
    if (m) {
      entries.push({ key: unquote(m[0].replace(/\s*:\s*$/, '')), rest: line.slice(m[0].length).trim(), lines: [] });
    } else if (entries.length > 0 && !/^#/.test(line)) {
      entries[entries.length - 1].lines.push(line);
    }
  }
  return entries.map(({ key, rest, lines }) => {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    const indent = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)![0].length));
    const body = lines.map((l) => l.slice(indent));
    let value: string;
    if (/^[|>][+-]?\d*$/.test(rest)) {
      value = body.join(rest.startsWith('>') ? ' ' : '\n');
    } else if (rest === '' && body.length > 0 && body.every((l) => /^-(\s|$)/.test(l))) {
      value = body.map((l) => unquote(l.slice(1).trim())).join(', ');
    } else if (body.length === 0 && /^\[.*\]$/.test(rest)) {
      value = rest
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter((item) => item !== '')
        .join(', ');
    } else {
      value = [unquote(rest), ...body].filter((l, i) => i > 0 || l !== '').join('\n');
    }
    return { key, value };
  });
}

/**
 * Turns a YAML front matter block at the top of the document into a `front_matter` token, shown as a table
 * of its entries, or hidden like the built-in preview does when `env.frontMatter` is false.
 */
function frontMatter(md: MarkdownIt): void {
  md.block.ruler.before('table', 'seqnotes_front_matter', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    const line = (n: number): string => state.src.slice(state.bMarks[n], state.eMarks[n]).trimEnd();
    if (startLine !== 0 || state.parentType !== 'root' || line(0) !== '---' || endLine < 2 || !YAML_KEY_RE.test(line(1))) {
      return false;
    }
    for (let n = 1; n < endLine; n++) {
      if (line(n) === '---' || line(n) === '...') {
        if (!silent) {
          const token = state.push('front_matter', '', 0);
          token.block = true;
          token.map = [0, n + 1];
          token.content = n > 1 ? state.src.slice(state.bMarks[1], state.eMarks[n - 1]) : '';
        }
        state.line = n + 1;
        return true;
      }
    }
    return false;
  });

  md.renderer.rules.front_matter = (tokens, idx, _options, env: Env | undefined, self) => {
    const entries = env?.frontMatter === false ? [] : parseFrontMatter(tokens[idx].content);
    if (entries.length === 0) {
      return '';
    }
    const escape = md.utils.escapeHtml;
    const token = tokens[idx];
    token.attrJoin('class', 'seqnotes-front-matter');
    const rows = entries.map(({ key, value }) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>\n`).join('');
    return `<table${self.renderAttrs(token)}>\n<tbody>\n${rows}</tbody>\n</table>\n`;
  };
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

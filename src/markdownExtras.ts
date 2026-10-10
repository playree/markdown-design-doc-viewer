/**
 * markdown-it plugins for Markdown found in design documents that markdown-it does not handle
 * by itself: YAML front matter, GitHub alerts and task lists, plus code highlighting.
 */
import hljs from 'highlight.js/lib/common';
import type { MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';
import { formatMessage } from './l10n';
import type { RenderEnv } from './render';

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

/** Drops a trailing ` # comment` from a value. A `#` inside quotes or without a space before it is part of the value. */
function stripComment(s: string): string {
  const quoted = /^(["'])(?:(?!\1).)*\1/.exec(s);
  if (quoted) {
    return /^\s*(?:#.*)?$/.test(s.slice(quoted[0].length)) ? quoted[0] : s;
  }
  const comment = /(?:^|\s)#/.exec(s);
  return comment ? s.slice(0, comment.index).trimEnd() : s;
}

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
      entries.push({ key: unquote(m[0].replace(/\s*:\s*$/, '')), rest: stripComment(line.slice(m[0].length).trim()), lines: [] });
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
      value = body.map((l) => unquote(stripComment(l.slice(1).trim()))).join(', ');
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

/** `type` of a front matter shown as the header of a design document instead of a table. */
const DESIGN_DOC_TYPE = 'design_doc';

/** Entries shown in a row under the title of a design document's header, in this order. */
const DESIGN_DOC_META = [
  { key: 'version', label: 'Version' },
  { key: 'product', label: 'Product' },
  { key: 'status', label: 'Status' },
  { key: 'updated', label: 'Updated' },
];

/**
 * Turns a YAML front matter block at the top of the document into a `front_matter` token, shown as a table
 * of its entries, or hidden like the built-in preview does when `env.frontMatter` is false.
 * With `type: design_doc`, the title and main entries are shown as a header, followed by a table of the others.
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

  md.renderer.rules.front_matter = (tokens, idx, _options, env: RenderEnv | undefined, self) => {
    const entries = env?.frontMatter === false ? [] : parseFrontMatter(tokens[idx].content);
    const escape = md.utils.escapeHtml;
    const token = tokens[idx];
    const table = (rows: FrontMatterEntry[], attrs = ''): string =>
      `<table${attrs} class="seqnotes-front-matter">\n<tbody>\n` +
      rows.map(({ key, value }) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>\n`).join('') +
      '</tbody>\n</table>\n';
    if (entries.find((entry) => entry.key === 'type')?.value.trim() !== DESIGN_DOC_TYPE) {
      return entries.length === 0 ? '' : table(entries, self.renderAttrs(token));
    }
    const t = env?.t ?? formatMessage;
    // An empty value (a template not filled in yet) is left out like a missing key.
    const value = (key: string): string | undefined => {
      const v = entries.find((entry) => entry.key === key)?.value;
      return v?.trim() ? v : undefined;
    };
    const title = value('title');
    const meta = DESIGN_DOC_META.flatMap(({ key, label }) => {
      const v = value(key);
      return v === undefined ? [] : [`<div class="seqnotes-doc-${key}"><dt>${escape(t(label))}</dt><dd>${escape(v)}</dd></div>\n`];
    });
    const rest = entries.filter(({ key }) => key !== 'type' && key !== 'title' && !DESIGN_DOC_META.some((m) => m.key === key));
    const headline =
      title === undefined && meta.length === 0
        ? ''
        : '<div class="seqnotes-doc-headline">\n' +
          (title === undefined ? '' : `<div class="seqnotes-doc-title">${escape(title)}</div>\n`) +
          (meta.length === 0 ? '' : `<dl class="seqnotes-doc-meta">\n${meta.join('')}</dl>\n`) +
          '</div>\n';
    if (headline === '' && rest.length === 0) {
      return '';
    }
    token.attrJoin('class', 'seqnotes-doc-header');
    // The other entries are folded, so that the header stays short.
    const more =
      rest.length === 0
        ? ''
        : `<details class="seqnotes-doc-more">\n<summary>${escape(t('Other metadata ({0})', rest.length))}</summary>\n${table(rest)}</details>\n`;
    return `<div${self.renderAttrs(token)}>\n${headline}${more}</div>\n`;
  };
}

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/** Icons shown before the title of each alert, as on GitHub: Octicons (MIT, GitHub; see ThirdPartyNotices.txt). */
const ALERT_ICONS: Record<string, [name: string, path: string]> = {
  note: ['info', 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'],
  tip: ['light-bulb', 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z'],
  important: ['report', 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'],
  warning: ['alert', 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'],
  caution: ['stop', 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z'],
};

function alertIcon(type: string): string {
  const [name, path] = ALERT_ICONS[type];
  return `<svg class="octicon octicon-${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}"></path></svg>`;
}

/**
 * Turns `> [!NOTE]` blockquotes into `<div class="markdown-alert markdown-alert-note">` with an icon and a title.
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
      // The inline rule appends the parsed title after the icon.
      const icon = new state.Token('html_inline', '', 0);
      icon.content = alertIcon(type);
      title[1].children = [icon];
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

/**
 * Minimal parser for mermaid flowcharts (`graph` / `flowchart`).
 * Only extracts what the preview needs: the nodes with their labels and source lines, the direction
 * of the chart, any `%% @ref <heading>` directive attached to a node and the `%% @link-headings` marker.
 * Edges, subgraphs and styles are skipped.
 */
import { headerLine, readNodes, type DiagramNode, type NodeRef, type ParsedNodeDiagram } from './diagramNodes';
import { skipFrontmatter } from './sequence';

export type FlowchartNode = DiagramNode;

export type ParsedFlowchart = ParsedNodeDiagram;

const HEADER_RE = /^\s*(?:flowchart-elk|graph|flowchart)\b(?:\s*(TB|TD|BT|RL|LR)\b|\s*([<>^]|v\b))?\s*;?/;

// A keyword must be followed by whitespace or the line end, so that nodes named e.g. `classA` are still read.
const NON_NODE_KEYWORDS = /^\s*(style|linkStyle|classDef|class|click|subgraph|end|direction|accTitle|accDescr)(?=[\s:{]|$)/;

const SUBGRAPH_RE = /^\s*subgraph\s+([^\s[]+)/;

// Characters of a node id as mermaid's lexer reads them; `-` only when it does not start a link.
const ID_RE = /^(?:[^\s[\](){}<>|&;:"@,~=-]|-(?![->.]))+/u;

// Longest openers first, so that e.g. `((` is not read as `(`.
const SHAPES: [string, string[]][] = [
  ['(((', [')))']],
  ['((', ['))']],
  ['([', ['])']],
  ['[[', [']]']],
  ['[(', [')]']],
  ['{{', ['}}']],
  ['[/', ['/]', '\\]']],
  ['[\\', ['\\]', '/]']],
  ['(-', ['-)']],
  ['[', [']']],
  ['(', [')']],
  ['{', ['}']],
  ['>', [']']],
];

// Links, with an optional edge id (`e1@-->`) and edge text in pipes (`-->|yes|`).
const LINK_RE = /^\s*(?:[^\s"]+@)?(?:[xo<]?--+[-xo>]|[xo<]?==+[=xo>]|[xo<]?-?\.+-[xo>]?|~~~+)\s*(?:\|(?:"[^"]*"|[^|"])*\|\s*)?/;
// Links with the edge text inside them: `-- text -->`, `== text ==>`, `-. text .->`.
const TEXT_LINK_RES = [
  /^\s*[xo<]?--(?![-xo>])(.*?)--+[-xo>]\s*/,
  /^\s*[xo<]?==(?![=xo>])(.*?)==+[=xo>]\s*/,
  /^\s*[xo<]?-\.(.*?)\.+-[xo>]?\s*/,
];

const SHAPE_DATA_LABEL_RE = /\blabel\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}\n]*))/;

/** Strips the quotes of a `"text"`, and of a markdown string `` "`text`" `` with its bold and italic marks. */
function unquote(text: string): string {
  let s = text.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  if (s.length >= 2 && s.startsWith('`') && s.endsWith('`')) {
    s = s
      .slice(1, -1)
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2');
  }
  return s.trim();
}

/** Reads a node (`id`, `id[label]`, `id@{ label: ... }`, with `:::class`) at the start of `s`. */
function readNode(s: string): { node: NodeRef; length: number } | undefined {
  const id = ID_RE.exec(s);
  if (!id) {
    return undefined;
  }
  let pos = id[0].length;
  let label: string | undefined;

  if (s.startsWith('@{', pos)) {
    const end = s.indexOf('}', pos);
    if (end < 0) {
      return undefined;
    }
    const data = SHAPE_DATA_LABEL_RE.exec(s.slice(pos + 2, end));
    if (data) {
      label = unquote(data[1] ?? data[2] ?? data[3] ?? '');
    }
    pos = end + 1;
  } else {
    const shape = SHAPES.find(([open]) => s.startsWith(open, pos));
    if (shape) {
      const [open, closers] = shape;
      let start = pos + open.length;
      // A quoted label may contain the closing brackets.
      const quoted = /^\s*"/.exec(s.slice(start));
      if (quoted) {
        const close = s.indexOf('"', start + quoted[0].length);
        if (close < 0) {
          return undefined;
        }
        start = close + 1;
      }
      const ends = closers.map((closer) => s.indexOf(closer, start)).filter((i) => i >= 0);
      if (ends.length === 0) {
        return undefined;
      }
      const end = Math.min(...ends);
      label = unquote(s.slice(pos + open.length, end));
      pos = end + closers.find((closer) => s.startsWith(closer, end))!.length;
    }
  }

  const className = /^:::[^\s&;]+/.exec(s.slice(pos));
  if (className) {
    pos += className[0].length;
  }
  return { node: { id: id[0], label }, length: pos };
}

function readLink(s: string): number | undefined {
  const link = LINK_RE.exec(s);
  if (link) {
    return link[0].length;
  }
  for (const re of TEXT_LINK_RES) {
    const m = re.exec(s);
    if (m) {
      return m[0].length;
    }
  }
  return undefined;
}

/** The nodes of a statement line like `A[label] --> B & C`. Stops at the first part it cannot read. */
function readStatements(line: string): NodeRef[] {
  const nodes: NodeRef[] = [];
  let s = line;
  let expectNode = true;
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s === '') {
      break;
    }
    if (s.startsWith(';')) {
      s = s.slice(1);
      expectNode = true;
      continue;
    }
    if (expectNode) {
      const read = readNode(s);
      if (!read) {
        break;
      }
      nodes.push(read.node);
      s = s.slice(read.length);
      const amp = /^\s*&/.exec(s);
      if (amp) {
        s = s.slice(amp[0].length);
      } else {
        expectNode = false;
      }
    } else {
      const length = readLink(s);
      if (length === undefined) {
        break;
      }
      s = s.slice(length);
      expectNode = true;
    }
  }
  return nodes;
}

export function isFlowchart(source: string): boolean {
  const lines = source.split(/\r?\n/);
  return headerLine(lines, skipFrontmatter(lines), HEADER_RE) !== undefined;
}

/**
 * @param source  fence content (without the ``` lines)
 * @param firstLine  0-based document line of the first content line
 */
export function parseFlowchart(source: string, firstLine: number): ParsedFlowchart {
  const lines = source.split(/\r?\n/);
  const start = skipFrontmatter(lines);
  const head = headerLine(lines, start, HEADER_RE);
  const direction = head?.match[1] ?? head?.match[2];
  const horizontal = direction === 'LR' || direction === 'RL' || direction === '<' || direction === '>';

  const subgraphs = new Set<string>();
  const statement = (raw: string, i: number): NodeRef[] => {
    const subgraph = SUBGRAPH_RE.exec(raw);
    if (subgraph) {
      subgraphs.add(subgraph[1]);
    }
    if (NON_NODE_KEYWORDS.test(raw)) {
      return [];
    }
    return readStatements(i === head?.index ? raw.slice(head.match[0].length) : raw);
  };
  return { ...readNodes(lines, start, firstLine, { firstWins: false, idIsLabel: false }, { statement, excluded: subgraphs }), horizontal };
}

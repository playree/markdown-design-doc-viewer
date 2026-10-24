/**
 * Minimal parser for mermaid ER diagrams (`erDiagram`).
 * Only extracts what the preview needs: the entities with their aliases and source lines, the direction
 * of the diagram, any `%% @ref <heading>` directive attached to an entity and the `%% @link-headings` marker.
 * Attributes, relationships, subgraphs and styles are skipped.
 */
import { headerLine, horizontalDirection, readNodes, type NodeRef, type ParsedNodeDiagram } from './diagramNodes';
import { skipFrontmatter } from './sequence';

const HEADER_RE = /^\s*erDiagram\b/;

// A keyword must be followed by whitespace or the line end, so that entities named e.g. `classes` are still read.
const NON_ENTITY_KEYWORDS = /^\s*(style|classDef|class|subgraph|end|direction|accTitle|accDescr)(?=[\s:{]|$)/;

// An entity name as mermaid's lexer reads it, or a quoted one.
const NAME_RE = /^(?:"([^"]*)"|((?:[^\x00-\x7F]|[\w*-])+))/u;
const ALIAS_RE = /^\s*\[\s*(?:"([^"]*)"|([^\]]*?))\s*\]/;
const CLASS_RE = /^:::[\w-]+/;
// The entity at the end of the part of a relationship before its label: `CUSTOMER ||--o{ ORDER`.
const LAST_NAME_RE = /(?:"([^"]*)"|((?:[^\x00-\x7F]|[\w*-])+))(?::::[\w-]+)?\s*$/u;

/** Reads an entity (`NAME`, `"NAME"`, `NAME[alias]`, with `:::class`) at the start of `s`. */
function readEntity(s: string): { id: string; label?: string; length: number } | undefined {
  const name = NAME_RE.exec(s);
  if (!name) {
    return undefined;
  }
  let pos = name[0].length;
  let label: string | undefined;
  for (;;) {
    const cls = CLASS_RE.exec(s.slice(pos));
    const alias = label === undefined ? ALIAS_RE.exec(s.slice(pos)) : null;
    const read = cls ?? alias;
    if (!read) {
      break;
    }
    if (alias && !cls) {
      label = alias[1] ?? alias[2];
    }
    pos += read[0].length;
  }
  return { id: name[1] ?? name[2], label, length: pos };
}

/** The position of the colon before the label of a relationship: not part of a `:::` nor inside quotes. */
function labelColon(s: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') {
      quoted = !quoted;
    } else if (!quoted && s[i] === ':' && s[i - 1] !== ':' && s[i + 1] !== ':') {
      return i;
    }
  }
  return -1;
}

const withoutQuotes = (s: string): string => s.replace(/"[^"]*"/g, '""');

export function isErDiagram(source: string): boolean {
  const lines = source.split(/\r?\n/);
  return headerLine(lines, skipFrontmatter(lines), HEADER_RE) !== undefined;
}

/**
 * @param source  fence content (without the ``` lines)
 * @param firstLine  0-based document line of the first content line
 */
export function parseErDiagram(source: string, firstLine: number): ParsedNodeDiagram {
  const lines = source.split(/\r?\n/);
  const start = skipFrontmatter(lines);
  const head = headerLine(lines, start, HEADER_RE);

  let horizontal = false;
  let subgraphDepth = 0;
  let inAttributes = false;
  // The lines of an attribute block, up to its `}`.
  const skip = (raw: string): boolean => {
    if (inAttributes) {
      inAttributes = !withoutQuotes(raw).includes('}');
      return true;
    }
    return false;
  };
  const statement = (raw: string, i: number): NodeRef[] => {
    // Only the direction of the top level: a subgraph can have its own.
    horizontal = (subgraphDepth === 0 ? horizontalDirection(raw) : undefined) ?? horizontal;
    if (/^\s*subgraph(?=\s|$)/.test(raw)) {
      subgraphDepth++;
    } else if (/^\s*end\s*$/.test(raw)) {
      subgraphDepth = Math.max(0, subgraphDepth - 1);
    }
    if (NON_ENTITY_KEYWORDS.test(raw)) {
      return [];
    }

    const text = (i === head?.index ? raw.slice(head.match[0].length) : raw).trim();
    const lead = readEntity(text);
    if (!lead) {
      return [];
    }
    const rest = text.slice(lead.length).trim();
    if (rest === '' || rest.startsWith('{')) {
      inAttributes = rest.startsWith('{') && !withoutQuotes(rest).includes('}');
      return [{ id: lead.id, label: lead.label, defines: true }];
    }
    // A relationship: `CUSTOMER ||--o{ ORDER : places`.
    const colon = labelColon(rest);
    const other = colon < 0 ? null : LAST_NAME_RE.exec(rest.slice(0, colon));
    const first: NodeRef = { id: lead.id, label: lead.label };
    return other ? [first, { id: other[1] ?? other[2] }] : [first];
  };
  const read = readNodes(lines, start, firstLine, { firstWins: true, idIsLabel: true }, { statement, skip });
  return { ...read, horizontal };
}

/**
 * Minimal parser for mermaid state diagrams (`stateDiagram` / `stateDiagram-v2`).
 * Only extracts what the preview needs: the states (composite ones included) with their descriptions and source lines,
 * the direction of the diagram, any `%% @ref <heading>` directive attached to a state and the `%% @link-headings` marker.
 * The start and end (`[*]`), the forks, joins and choices, the notes, the transitions' labels and the styles are skipped.
 */
import { headerLine, horizontalDirection, readNodes, type NodeRef, type ParsedNodeDiagram } from './diagramNodes';
import { skipFrontmatter } from './sequence';

const HEADER_RE = /^\s*stateDiagram(?:-v2)?(?=\s|$)/;

// A keyword must be followed by whitespace or the line end, so that states named e.g. `classes` are still read.
const NON_STATE_KEYWORDS = /^\s*(classDef|class|style|click|direction|accTitle|accDescr|hide empty description|scale)(?=[\s:{]|$)/i;

// A state id as mermaid's lexer reads it, or the start / end.
const ID = '(\\[\\*\\]|[^:\\s{"-]+)';
const CLASS = '(?::::[\\w-]+)?';
const TRANSITION_RE = new RegExp(`^${ID}${CLASS}\\s*-->\\s*${ID}${CLASS}`);
const DESCRIPTION_RE = new RegExp(`^${ID}\\s*:(?!::)(.*)$`);
const STATE_RE = new RegExp(`^${ID}${CLASS}\\s*$`);
// `state "Description" as id`, `state id`, with `{` for a composite state.
const STATE_AS_RE = /^state\s+"([^"]*)"\s*as\s+([^:\s{"]+)/;
const STATE_KEYWORD_RE = /^state\s+([^:\s{"]+)/;
const PSEUDO_STATE_RE = /<<(?:fork|join|choice)>>|\[\[(?:fork|join|choice)\]\]/i;
const NOTE_RE = /^note\s/i;

const isState = (id: string): boolean => id !== '[*]';

export function isStateDiagram(source: string): boolean {
  const lines = source.split(/\r?\n/);
  return headerLine(lines, skipFrontmatter(lines), HEADER_RE) !== undefined;
}

/**
 * @param source  fence content (without the ``` lines)
 * @param firstLine  0-based document line of the first content line
 */
export function parseStateDiagram(source: string, firstLine: number): ParsedNodeDiagram {
  const lines = source.split(/\r?\n/);
  const start = skipFrontmatter(lines);
  const head = headerLine(lines, start, HEADER_RE);

  let horizontal = false;
  let depth = 0;
  let inNote = false;
  const pseudoStates = new Set<string>();
  // The lines of a note, up to `end note`.
  const skip = (raw: string): boolean => {
    if (inNote) {
      inNote = !/^\s*end\s+note\b/i.test(raw);
      return true;
    }
    return false;
  };
  const statement = (raw: string, i: number): NodeRef[] => {
    const text = (i === head?.index ? raw.slice(head.match[0].length) : raw).trim();
    if (NOTE_RE.test(text)) {
      // `note right of s1` and the lines up to `end note`, unless it is a one-line note (`note right of s1 : text`) or a floating one.
      inNote = !text.includes(':') && !/^note\s+"/i.test(text);
      return [];
    }
    // Only the direction of the top level: a composite state can have its own.
    horizontal = (depth === 0 ? horizontalDirection(text) : undefined) ?? horizontal;
    if (text.startsWith('}')) {
      depth = Math.max(0, depth - 1);
      return [];
    }
    if (NON_STATE_KEYWORDS.test(text) || text === '--') {
      return [];
    }

    if (/^state\s/.test(text)) {
      const as = STATE_AS_RE.exec(text);
      const id = as?.[2] ?? STATE_KEYWORD_RE.exec(text)?.[1];
      if (!id) {
        return [];
      }
      if (PSEUDO_STATE_RE.test(text)) {
        pseudoStates.add(id);
        return [];
      }
      if (text.endsWith('{')) {
        depth++;
      }
      return [{ id, label: as?.[1], defines: true }];
    }
    const transition = TRANSITION_RE.exec(text);
    if (transition) {
      return [transition[1], transition[2]].filter(isState).map((id) => ({ id }));
    }
    const description = DESCRIPTION_RE.exec(text);
    if (description) {
      return isState(description[1]) ? [{ id: description[1], label: description[2].trim(), defines: true }] : [];
    }
    const state = STATE_RE.exec(text);
    return state && isState(state[1]) ? [{ id: state[1], defines: true }] : [];
  };
  const read = readNodes(lines, start, firstLine, { firstWins: true, idIsLabel: true }, { statement, skip, excluded: pseudoStates });
  return { ...read, horizontal };
}

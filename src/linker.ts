import type { Token } from 'markdown-it';
import { isSequenceDiagram, normalizeLabel, parseSequence, type SequenceMessage } from './sequence';

export const END_MARKER_RE = /^\s*<!--\s*seq-notes:end\s*-->\s*$/;

export interface LinkedMessage extends SequenceMessage {
  /** id of the heading this message is linked to. */
  target?: string;
}

export interface DiagramInfo {
  /** Sequential number of the sequence diagram in the document. */
  id: number;
  fenceIndex: number;
  /** Exclusive end of the overview range (token index). Only meaningful when `paired`. */
  rangeEnd: number;
  messages: LinkedMessage[];
  /** true when at least one message is linked and the diagram should be laid out side by side. */
  paired: boolean;
}

export interface LinkWarning {
  line: number;
  message: string;
}

export interface LinkResult {
  diagrams: DiagramInfo[];
  warnings: LinkWarning[];
}

export function isMermaidFence(token: Token): boolean {
  return token.type === 'fence' && token.info.trim().split(/\s+/)[0] === 'mermaid';
}

function isSequenceFence(token: Token): boolean {
  return isMermaidFence(token) && isSequenceDiagram(token.content);
}

/** Plain text of a heading's inline token. */
export function headingText(inline: Token | undefined): string {
  if (!inline) {
    return '';
  }
  if (!inline.children) {
    return inline.content;
  }
  return inline.children
    .map((child) => {
      switch (child.type) {
        case 'text':
        case 'code_inline':
          return child.content;
        case 'softbreak':
        case 'hardbreak':
          return ' ';
        default:
          return '';
      }
    })
    .join('');
}

/**
 * Finds sequence diagrams and resolves their message → heading links.
 * Headings must already carry an `id` attribute.
 *
 * Only top-level (level 0) fences are paired, so the overview range always
 * starts and ends on a top-level block boundary and can be rendered on its own.
 */
export function linkDiagrams(tokens: Token[]): LinkResult {
  const diagrams: DiagramInfo[] = [];
  const warnings: LinkWarning[] = [];

  const sequenceFences = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => isSequenceFence(token));

  for (const { token, index } of sequenceFences) {
    const firstLine = (token.map?.[0] ?? 0) + 1;
    const messages: LinkedMessage[] = parseSequence(token.content, firstLine);
    const diagram: DiagramInfo = { id: diagrams.length, fenceIndex: index, rangeEnd: index + 1, messages, paired: false };
    diagrams.push(diagram);

    if (token.level !== 0) {
      continue;
    }

    let end = index + 1;
    while (end < tokens.length) {
      const t = tokens[end];
      if (t.level === 0 && (isSequenceFence(t) || (t.type === 'html_block' && END_MARKER_RE.test(t.content)))) {
        break;
      }
      end++;
    }
    diagram.rangeEnd = end;

    const headings = new Map<string, string>();
    for (let i = index + 1; i < end; i++) {
      const t = tokens[i];
      const id = t.type === 'heading_open' ? t.attrGet('id') : null;
      if (id) {
        const key = normalizeLabel(headingText(tokens[i + 1]));
        if (!headings.has(key)) {
          headings.set(key, String(id));
        }
      }
    }

    for (const message of messages) {
      const target = headings.get(normalizeLabel(message.ref ?? message.text));
      if (target) {
        message.target = target;
      } else if (message.ref !== undefined) {
        warnings.push({
          line: message.refLine ?? message.line,
          message: `@ref target heading "${message.ref}" was not found after the sequence diagram.`,
        });
      }
    }
    diagram.paired = messages.some((m) => m.target !== undefined);
  }

  return { diagrams, warnings };
}

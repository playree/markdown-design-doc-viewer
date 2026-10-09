import type { MarkdownIt } from 'markdown-it';
import { formatMessage, type Translate } from './l10n';
import { headingText, linkDiagrams } from './linker';
import { normalizeLabel } from './sequence';

export interface Issue {
  /** 0-based line in the Markdown document. */
  line: number;
  message: string;
  severity: 'warning' | 'info';
}

/**
 * Problems of the arrow / node ⇔ heading links, for the editor diagnostics: the warnings shown in the preview,
 * and the arrows and headings the preview marks as unlinked. Sorted by line.
 */
export function collectIssues(md: MarkdownIt, source: string, t: Translate = formatMessage): Issue[] {
  const tokens = md.parse(source, {});
  const { diagrams, warnings } = linkDiagrams(tokens, t);
  const issues: Issue[] = warnings.map((w) => ({ line: w.line, message: w.message, severity: 'warning' }));

  for (const diagram of diagrams.filter((d) => d.paired)) {
    // Without any link, the arrows are not marked as unlinked, so the diagram is reported once instead.
    // A diagram whose only arrows have broken `@ref`s is already reported by their warnings.
    const flowchart = diagram.kind === 'flowchart';
    if (diagram.messages.every((m) => !m.target)) {
      if (diagram.messages.some((m) => m.ref === undefined)) {
        issues.push({
          line: tokens[diagram.fenceIndex].map?.[0] ?? 0,
          message: flowchart
            ? t('No node in the flowchart is linked to a heading. Write the steps as headings after the diagram, with the same text as the nodes.')
            : t('No arrow in the sequence diagram is linked to a heading. Write the steps as headings after the diagram, with the same text as the arrows.'),
          severity: 'info',
        });
      }
      continue;
    }
    // An arrow without a label cannot be linked by a heading, so it is not reported (nodes without a label are not marked).
    for (const m of diagram.messages.filter((m) => m.unlinked && normalizeLabel(m.text) !== '')) {
      const label = normalizeLabel(m.text);
      issues.push({
        line: m.line,
        message: flowchart
          ? t('Node "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the node.', label)
          : t('Arrow "{0}" is not linked to any heading. Add a heading with the same text after the diagram, or write "%% @ref <heading>" above the arrow.', label),
        severity: 'info',
      });
    }
    for (const index of diagram.unlinkedHeadings) {
      const heading = normalizeLabel(headingText(tokens[index + 1]));
      issues.push({
        line: tokens[index].map?.[0] ?? 0,
        message: flowchart
          ? t('No node in the flowchart is linked to heading "{0}".', heading)
          : t('No arrow in the sequence diagram is linked to heading "{0}".', heading),
        severity: 'info',
      });
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

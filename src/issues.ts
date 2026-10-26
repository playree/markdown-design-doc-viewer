import type { MarkdownIt } from 'markdown-it';
import { diagramWording, rowWording } from './diagramWording';
import { formatMessage, type Translate } from './l10n';
import { headingText, linkDiagrams } from './linker';
import { normalizeLabel } from './sequence';
import { tableWarnings } from './tables';
import type { WireframeFiles } from './wireframe';

export interface Issue {
  /** 0-based line in the Markdown document. */
  line: number;
  message: string;
  severity: 'warning' | 'info';
}

/**
 * Problems of the arrow / node ⇔ heading links and of the table options, for the editor diagnostics: the warnings shown in the preview,
 * and the arrows and headings the preview marks as unlinked. Sorted by line. The parts of the wireframes are only
 * checked with their `wireframes` read by the host.
 */
export function collectIssues(md: MarkdownIt, source: string, t: Translate = formatMessage, wireframes?: WireframeFiles): Issue[] {
  const tokens = md.parse(source, { t, wireframes });
  const { diagrams, warnings } = linkDiagrams(tokens, t);
  const issues: Issue[] = [...warnings, ...tableWarnings(tokens)].map((w) => ({ line: w.line, message: w.message, severity: 'warning' }));

  for (const diagram of diagrams.filter((d) => d.paired)) {
    // Without any link, the arrows are not marked as unlinked, so the diagram is reported once instead.
    // A diagram whose only arrows have broken `@ref`s is already reported by their warnings.
    const wording = diagramWording(diagram.kind, t);
    if (diagram.messages.every((m) => !m.target)) {
      if (diagram.messages.some((m) => m.ref === undefined)) {
        issues.push({
          line: tokens[diagram.fenceIndex].map?.[0] ?? 0,
          message: wording.nothingLinked,
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
        message: wording.unlinkedItem(label),
        severity: 'info',
      });
    }
    for (const index of diagram.unlinkedHeadings) {
      const heading = normalizeLabel(headingText(tokens[index + 1]));
      issues.push({
        line: tokens[index].map?.[0] ?? 0,
        message: wording.unlinkedHeading(heading),
        severity: 'info',
      });
    }
    for (const row of diagram.rows.filter((r) => r.unlinked)) {
      issues.push({ line: row.line, message: rowWording(t).unlinked(row.item), severity: 'info' });
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

import * as vscode from 'vscode';
import { inSequenceDiagram, quickFixes, refCandidates, type TextEdit } from './authoring';
import { DIAGNOSTIC_SOURCE } from './diagnostics';
import { createMarkdown } from './render';

const SELECTOR: vscode.DocumentSelector = { language: 'markdown' };

const REF_PREFIX_RE = /^\s*%%\s*@ref\s+/;
const DIRECTIVE_PREFIX_RE = /^\s*%%\s*(@[\w-]*)$/;

const toRange = (edit: TextEdit): vscode.Range => new vscode.Range(edit.start.line, edit.start.character, edit.end.line, edit.end.character);

/**
 * Editor support for writing the links: completion of the `%% @ref` headings and the directives,
 * and quick fixes for the problems reported by the diagnostics.
 */
export function registerAuthoringProviders(): vscode.Disposable {
  const md = createMarkdown();

  const completion: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      const line = document.lineAt(position.line).text;
      const before = line.slice(0, position.character);

      const ref = REF_PREFIX_RE.exec(before);
      if (ref) {
        const candidates = refCandidates(md, document.getText(), position.line);
        // The heading replaces the rest of the line.
        const range = new vscode.Range(position.line, ref[0].length, position.line, line.length);
        return candidates?.map((c, i) => {
          const item = new vscode.CompletionItem(c.text, vscode.CompletionItemKind.Reference);
          item.range = range;
          item.sortText = String(i).padStart(4, '0');
          item.detail = c.linked ? vscode.l10n.t('Already linked to an arrow') : vscode.l10n.t('No arrow linked yet');
          return item;
        });
      }

      const directive = DIRECTIVE_PREFIX_RE.exec(before);
      if (directive && inSequenceDiagram(md, document.getText(), position.line)) {
        const range = new vscode.Range(position.line, position.character - directive[1].length, position.line, position.character);
        const item = (label: string, insertText: string, documentation: string, retrigger: boolean): vscode.CompletionItem => {
          const it = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
          it.range = range;
          it.insertText = insertText;
          it.documentation = documentation;
          if (retrigger) {
            it.command = { command: 'editor.action.triggerSuggest', title: '' };
          }
          return it;
        };
        return [
          item('@seq-notes', '@seq-notes', vscode.l10n.t('Show this sequence diagram side by side with the step headings after it.'), false),
          item('@ref', '@ref ', vscode.l10n.t('Link the next arrow to a heading.'), true),
        ];
      }
      return undefined;
    },
  };

  const codeActions: vscode.CodeActionProvider = {
    provideCodeActions(document, range, context) {
      const diagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);
      const lines = [...new Set(diagnostics.map((d) => d.range.start.line))];
      return lines.flatMap((line) =>
        quickFixes(md, document.getText(), line, vscode.l10n.t).map((fix) => {
          const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, toRange(fix.edit), fix.edit.text);
          action.diagnostics = diagnostics.filter((d) => d.range.start.line === line);
          return action;
        }),
      );
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerCompletionItemProvider(SELECTOR, completion, ' ', '@'),
    vscode.languages.registerCodeActionsProvider(SELECTOR, codeActions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );
}

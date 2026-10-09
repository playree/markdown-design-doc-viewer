import * as vscode from 'vscode';
import { collectIssues } from './issues';
import { createMarkdown } from './render';

const UPDATE_DELAY_MS = 300;

/** Virtual documents such as the original side of a git diff are not reported, as they cannot be fixed. */
const SCHEMES = new Set(['file', 'untitled']);

function enabled(document: vscode.TextDocument): boolean {
  return vscode.workspace.getConfiguration('mdDesignDoc', document).get<boolean>('diagnostics', true);
}

function isTarget(document: vscode.TextDocument): boolean {
  return document.languageId === 'markdown' && SCHEMES.has(document.uri.scheme);
}

/**
 * Reports the link warnings and unlinked arrows/headings of open Markdown documents in the Problems panel,
 * whether or not a preview is open, so that the author (or an AI agent reading the diagnostics) can fix them.
 */
export class DiagnosticsManager implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('mdDesignDoc');
  private readonly md = createMarkdown();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => this.update(document)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) {
          this.schedule(e.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.clear(document.uri)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('mdDesignDoc.diagnostics')) {
          this.updateAll();
        }
      }),
    );
    this.updateAll();
  }

  dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.disposables.forEach((d) => d.dispose());
    this.collection.dispose();
  }

  private updateAll(): void {
    this.collection.clear();
    vscode.workspace.textDocuments.forEach((document) => this.update(document));
  }

  private schedule(document: vscode.TextDocument): void {
    if (!isTarget(document)) {
      return;
    }
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.update(document), UPDATE_DELAY_MS));
  }

  private update(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (document.isClosed || !isTarget(document) || !enabled(document)) {
      this.collection.delete(document.uri);
      return;
    }
    const diagnostics = collectIssues(this.md, document.getText(), vscode.l10n.t).map((issue) => {
      const line = Math.min(issue.line, document.lineCount - 1);
      const diagnostic = new vscode.Diagnostic(
        document.lineAt(line).range,
        issue.message,
        issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = 'Markdown Design Doc';
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
  }

  private clear(uri: vscode.Uri): void {
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.collection.delete(uri);
  }
}

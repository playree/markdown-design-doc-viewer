import * as vscode from 'vscode';
import { readWireframes, WireframeWatcher } from './documentFiles';
import { collectIssues } from './issues';
import { createMarkdown } from './render';

const UPDATE_DELAY_MS = 300;

/** `source` of the diagnostics, also used by the quick fixes to find them. */
export const DIAGNOSTIC_SOURCE = 'Markdown Design Doc';

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
  /** The last update of each document, so that an earlier one that ends later does not replace it. */
  private readonly updates = new Map<string, number>();
  /** Follow the files of the wireframes of each document. */
  private readonly wireframeWatchers = new Map<string, WireframeWatcher>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => void this.update(document)),
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
    this.wireframeWatchers.forEach((watcher) => watcher.dispose());
    this.wireframeWatchers.clear();
    this.disposables.forEach((d) => d.dispose());
    this.collection.dispose();
  }

  private updateAll(): void {
    this.collection.clear();
    vscode.workspace.textDocuments.forEach((document) => void this.update(document));
  }

  private schedule(document: vscode.TextDocument): void {
    if (!isTarget(document)) {
      return;
    }
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => void this.update(document), UPDATE_DELAY_MS));
  }

  private async update(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const seq = (this.updates.get(key) ?? 0) + 1;
    this.updates.set(key, seq);
    if (document.isClosed || !isTarget(document) || !enabled(document)) {
      this.collection.delete(document.uri);
      this.unwatch(key);
      return;
    }
    const { version } = document;
    const source = document.getText();
    const wireframes = await readWireframes(this.md, document.uri, source);
    // Changed meanwhile: updated again after it.
    if (this.updates.get(key) !== seq || document.isClosed || document.version !== version) {
      return;
    }
    let watcher = this.wireframeWatchers.get(key);
    if (!watcher) {
      watcher = new WireframeWatcher(() => this.schedule(document));
      this.wireframeWatchers.set(key, watcher);
    }
    watcher.watch(wireframes.dependencies);
    const diagnostics = collectIssues(this.md, source, vscode.l10n.t, wireframes.files).map((issue) => {
      const line = Math.min(issue.line, document.lineCount - 1);
      const diagnostic = new vscode.Diagnostic(
        document.lineAt(line).range,
        issue.message,
        issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      diagnostic.source = DIAGNOSTIC_SOURCE;
      return diagnostic;
    });
    this.collection.set(document.uri, diagnostics);
  }

  private clear(uri: vscode.Uri): void {
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.updates.delete(key);
    this.unwatch(key);
    this.collection.delete(uri);
  }

  private unwatch(key: string): void {
    this.wireframeWatchers.get(key)?.dispose();
    this.wireframeWatchers.delete(key);
  }
}

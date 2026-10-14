import * as vscode from 'vscode';
import { registerAuthoringProviders } from './authoringProviders';
import { DiagnosticsManager } from './diagnostics';
import { exportHtml } from './exportHtml';
import { compareWithRevision } from './history';
import { PreviewManager, readSettings } from './previewPanel';

function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === 'markdown') {
    return editor.document.uri;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const manager = new PreviewManager(context.extensionUri);

  const open = (column: vscode.ViewColumn) => (arg: unknown) => {
    const uri = targetUri(arg);
    if (!uri) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to preview it.'));
      return;
    }
    manager.show(uri, column);
  };

  context.subscriptions.push(
    manager,
    new DiagnosticsManager(),
    registerAuthoringProviders(),
    vscode.commands.registerCommand('mdDesignDoc.openPreview', open(vscode.ViewColumn.Active)),
    vscode.commands.registerCommand('mdDesignDoc.openPreviewToSide', open(vscode.ViewColumn.Beside)),
    vscode.commands.registerCommand('mdDesignDoc.exportHtml', (arg: unknown) => {
      // From the preview's context menu, the argument is not the document but the preview has the focus.
      const uri = arg instanceof vscode.Uri ? arg : (manager.activeUri() ?? targetUri(undefined));
      if (!uri) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to export it.'));
        return;
      }
      return exportHtml(manager, context.extensionUri, uri);
    }),
    vscode.commands.registerCommand('mdDesignDoc.compareWithRevision', (arg: unknown) => {
      // From the preview's title bar or context menu, the preview has the focus.
      const uri = arg instanceof vscode.Uri ? arg : (manager.activeUri() ?? targetUri(undefined));
      if (!uri) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Open a Markdown file to compare it with its Git history.'));
        return;
      }
      return compareWithRevision(manager, uri);
    }),
    vscode.commands.registerCommand('mdDesignDoc.useFullContentWidth', () => updateSetting('limitContentWidth', false)),
    vscode.commands.registerCommand('mdDesignDoc.limitContentWidth', () => updateSetting('limitContentWidth', true)),
    vscode.commands.registerCommand('mdDesignDoc.toggleTheme', () => (themeUpdate = themeUpdate.then(toggleTheme, toggleTheme))),
  );
}

/** Saves the choice of a preview's title bar button to the setting, which updates the open previews. */
function updateSetting(key: string, value: unknown): Thenable<void> {
  const config = vscode.workspace.getConfiguration('mdDesignDoc');
  // A workspace value would hide a change of the user setting.
  const target = config.inspect(key)?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  return config.update(key, value, target);
}

/** Toggles one after another, so that a quick second click sees the value saved by the first. */
let themeUpdate: Thenable<void> = Promise.resolve();

/** Switches the previews to the other of light and dark; back to `auto` when that is VS Code's own. */
function toggleTheme(): Thenable<void> {
  const kind = vscode.window.activeColorTheme.kind;
  // Same as the webview, which takes any theme other than a light one as dark.
  const vscodeDark = kind !== vscode.ColorThemeKind.Light && kind !== vscode.ColorThemeKind.HighContrastLight;
  const { theme } = readSettings();
  const dark = theme === 'auto' ? vscodeDark : theme === 'dark';
  return updateSetting('theme', !dark === vscodeDark ? 'auto' : dark ? 'light' : 'dark');
}

export function deactivate(): void {}

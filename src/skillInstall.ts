import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { hashSkill, type SkillInstall, skillInstallStatus, withSkillInstall } from './skillInstallState';

/** The name of the Agent Skill, which is also the name of its folder (scripts/skill-files.mjs). */
const SKILL_NAME = 'markdown-design-doc';

/** Where the copies installed by the command are remembered, to offer their update when the extension has a newer skill. */
const STATE_KEY = 'agentSkillInstalls';

/** The extension's skill: its files, relative to its folder, and their hash. */
interface Bundle {
  files: Map<string, Uint8Array>;
  hash: string;
}

/**
 * The command that installs the Agent Skill for AI assistants (built to dist/skill/, also registered for Copilot by
 * `chatSkills` in package.json) into a skills folder, such as Claude Code's; and, on activation, the offer to update
 * the copies it installed when the extension has a newer skill.
 */
export function registerSkillInstaller(context: vscode.ExtensionContext): vscode.Disposable {
  const installer = new SkillInstaller(context);
  void installer.offerUpdates();
  return vscode.commands.registerCommand('mdDesignDoc.installAgentSkill', () => installer.install());
}

class SkillInstaller {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async install(): Promise<void> {
    const parent = await chooseFolder();
    if (!parent) {
      return;
    }
    // A folder named after the skill is taken as its folder, not as the skills folder to put it in.
    const folder = basename(parent) === SKILL_NAME ? parent : vscode.Uri.joinPath(parent, SKILL_NAME);
    const where = displayPath(folder);
    try {
      const bundle = await readBundle(this.context.extensionUri);
      const installed = await readInstalled(folder, bundle);
      if (installed === bundle.hash) {
        await this.remember({ folder: folder.toString(), hash: bundle.hash });
        void vscode.window.showInformationMessage(vscode.l10n.t('The Agent Skill in {0} is up to date.', where));
        return;
      }
      if (installed !== undefined) {
        const overwrite = vscode.l10n.t('Overwrite');
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t('Overwrite the Agent Skill in {0}?', where),
          { modal: true, detail: vscode.l10n.t('It differs from the one of this version of the extension. Changes made to its files will be lost.') },
          overwrite,
        );
        if (answer !== overwrite) {
          return;
        }
      }
      await this.write(folder, bundle);
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Could not install the Agent Skill in {0}: {1}', where, errorMessage(error)));
      return;
    }
    const open = vscode.l10n.t('Open SKILL.md');
    const answer = await vscode.window.showInformationMessage(vscode.l10n.t('Installed the Agent Skill in {0}.', where), open);
    if (answer === open) {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, 'SKILL.md'));
    }
  }

  /** Offers to update the copies installed by the command that are older than the extension's skill and were not changed since. */
  async offerUpdates(): Promise<void> {
    let installs = this.installs();
    if (installs.length === 0) {
      return;
    }
    let bundle: Bundle;
    try {
      bundle = await readBundle(this.context.extensionUri);
    } catch {
      return;
    }
    const outdated: SkillInstall[] = [];
    for (const install of installs) {
      let installed: string | undefined;
      try {
        installed = await readInstalled(vscode.Uri.parse(install.folder), bundle);
      } catch {
        // Unreadable for now (a file system that is not available here): asked again on the next activation.
        continue;
      }
      const status = skillInstallStatus(install, installed, bundle.hash);
      if (status === 'missing') {
        installs = installs.filter((other) => other !== install);
      } else if (status === 'current' && install.hash !== bundle.hash) {
        installs = withSkillInstall(installs, { folder: install.folder, hash: bundle.hash });
      } else if (status === 'outdated') {
        outdated.push(install);
      }
    }
    await this.context.globalState.update(STATE_KEY, installs);
    if (outdated.length === 0) {
      return;
    }
    const where = outdated.map((install) => displayPath(vscode.Uri.parse(install.folder))).join(', ');
    const update = vscode.l10n.t('Update');
    const later = vscode.l10n.t('Later');
    const answer = await vscode.window.showInformationMessage(
      outdated.length === 1
        ? vscode.l10n.t('The Agent Skill for writing design docs installed in {0} is older than the one of this version of the extension. Update it?', where)
        : vscode.l10n.t('The Agent Skills for writing design docs installed in {0} are older than the one of this version of the extension. Update them?', where),
      update,
      later,
    );
    if (answer !== update) {
      // Closed or postponed: not asked again until the extension has another skill (the command still updates it).
      for (const install of outdated) {
        await this.remember({ ...install, declined: bundle.hash });
      }
      return;
    }
    const failed: string[] = [];
    for (const install of outdated) {
      const folder = vscode.Uri.parse(install.folder);
      try {
        await this.write(folder, bundle);
      } catch (error) {
        failed.push(`${displayPath(folder)} (${errorMessage(error)})`);
      }
    }
    if (failed.length > 0) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Could not update the Agent Skill in {0}.', failed.join(', ')));
    } else {
      void vscode.window.showInformationMessage(vscode.l10n.t('Updated the Agent Skill in {0}.', where));
    }
  }

  /** Writes the extension's skill into `folder`, leaving the other files there, and remembers it. */
  private async write(folder: vscode.Uri, bundle: Bundle): Promise<void> {
    for (const [path, content] of bundle.files) {
      const target = vscode.Uri.joinPath(folder, path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      await vscode.workspace.fs.writeFile(target, content);
    }
    await this.remember({ folder: folder.toString(), hash: bundle.hash });
  }

  private installs(): SkillInstall[] {
    const value = this.context.globalState.get<unknown>(STATE_KEY);
    return Array.isArray(value) ? value.filter(isSkillInstall) : [];
  }

  private remember(install: SkillInstall): Thenable<void> {
    return this.context.globalState.update(STATE_KEY, withSkillInstall(this.installs(), install));
  }
}

function isSkillInstall(value: unknown): value is SkillInstall {
  const install = value as Partial<SkillInstall> | null;
  return typeof install?.folder === 'string' && typeof install.hash === 'string' && (install.declined === undefined || typeof install.declined === 'string');
}

interface FolderItem extends vscode.QuickPickItem {
  /** The skills folder to install the skill in; undefined for the item that opens a folder dialog. */
  folder?: vscode.Uri;
}

/** Asks for the skills folder to put the skill in: Claude Code's of the user or of a workspace folder, or one chosen in a dialog. */
async function chooseFolder(): Promise<vscode.Uri | undefined> {
  const items: FolderItem[] = [
    {
      label: '~/.claude/skills',
      description: vscode.l10n.t('Claude Code: all projects'),
      folder: vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.claude', 'skills'),
    },
    ...(vscode.workspace.workspaceFolders ?? []).map(
      (workspaceFolder): FolderItem => ({
        label: `${workspaceFolder.name}/.claude/skills`,
        description: vscode.l10n.t('Claude Code: this project (commit it to share it with the team)'),
        folder: vscode.Uri.joinPath(workspaceFolder.uri, '.claude', 'skills'),
      }),
    ),
    {
      label: `$(folder-opened) ${vscode.l10n.t('Choose a Folder...')}`,
      description: vscode.l10n.t('The skills folder of another AI assistant'),
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Install the Agent Skill for writing design docs with AI'),
    placeHolder: vscode.l10n.t('Choose where to install it (it is copied into a folder named {0} there)', SKILL_NAME),
  });
  if (!picked || picked.folder) {
    return picked?.folder;
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: vscode.l10n.t('Install Here'),
    title: vscode.l10n.t('Choose the skills folder to install the Agent Skill in'),
  });
  return chosen?.[0];
}

/** Reads the extension's skill (dist/skill/markdown-design-doc/). */
async function readBundle(extensionUri: vscode.Uri): Promise<Bundle> {
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'skill', SKILL_NAME);
  const files = new Map<string, Uint8Array>();
  for (const path of await listFiles(root, '')) {
    files.set(path, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path)));
  }
  return { files, hash: hashSkill([...files.keys()], files) };
}

/** The paths of the files under `root`/`dir`, relative to `root`. */
async function listFiles(root: vscode.Uri, dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, dir))) {
    const path = dir ? `${dir}/${name}` : name;
    if (type & vscode.FileType.Directory) {
      paths.push(...(await listFiles(root, path)));
    } else if (type & vscode.FileType.File) {
      paths.push(path);
    }
  }
  return paths;
}

/** The hash of the files of the extension's skill in `folder`, or undefined if it has no SKILL.md. Throws on errors other than missing files. */
async function readInstalled(folder: vscode.Uri, bundle: Bundle): Promise<string | undefined> {
  const files = new Map<string, Uint8Array>();
  for (const path of bundle.files.keys()) {
    try {
      files.set(path, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, path)));
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        throw error;
      }
    }
  }
  return files.has('SKILL.md') ? hashSkill([...bundle.files.keys()], files) : undefined;
}

function basename(uri: vscode.Uri): string {
  return uri.path.replace(/\/+$/, '').split('/').pop() ?? '';
}

/** A folder as shown to the user: its path, with `~` for the home folder. */
function displayPath(uri: vscode.Uri): string {
  if (uri.scheme !== 'file') {
    return uri.toString(true);
  }
  const home = vscode.Uri.file(homedir()).fsPath.replace(/[\\/]+$/, '');
  const path = uri.fsPath;
  // Paths on Windows are not case-sensitive.
  const fold = (text: string) => (process.platform === 'win32' ? text.toLowerCase() : text);
  const separator = process.platform === 'win32' ? '\\' : '/';
  return fold(path) === fold(home) || fold(path).startsWith(fold(home) + separator) ? `~${path.slice(home.length)}` : path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

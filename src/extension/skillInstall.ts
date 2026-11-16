import { homedir } from 'node:os';
import * as vscode from 'vscode';
import {
  hashSkill,
  type InstalledHashes,
  type SkillInstall,
  skillInstallStatus,
  skillRevision,
  staleSkillFiles,
  unrecordedSkillStatus,
} from './skillInstallState';

/** The name of the Agent Skill, which is also the name of its folder (scripts/skill-files.mjs). */
const SKILL_NAME = 'markdown-design-doc';

/**
 * The prefix of the keys of the global state where the copies installed by the command are remembered (one key for each,
 * so that windows writing at the same time do not drop each other's), to offer their update when the extension has a
 * newer skill.
 */
const STATE_PREFIX = 'agentSkillInstall:';

/**
 * The prefix of the keys of the global state where the revision of the extension's skill whose update was offered is
 * remembered, for each copy in a skills folder that the command did not install (unzipped from a release, or written by
 * another tool): its update is offered once for each revision.
 */
const OFFER_PREFIX = 'agentSkillOffer:';

/** The extension's skill: its files, relative to its folder, their hash, and its revision. */
interface Bundle {
  files: Map<string, Uint8Array>;
  hash: string;
  revision: number;
}

/** A skills folder of Claude Code where a copy of the skill may be (`skillFolders`). */
interface SkillFolder {
  folder: vscode.Uri;
  /** The workspace folder of the copy in its `.claude/skills`; undefined for the copy for all projects. */
  workspaceFolder?: string;
}

/** A copy of the skill that the command did not install, older than the extension's: of `revision` when found. */
interface UnrecordedCopy extends SkillFolder {
  revision: number;
}

/**
 * The command that installs the Agent Skill for AI assistants (built to dist/skill/, also registered for Copilot by
 * `chatSkills` in package.json) into a skills folder, such as Claude Code's; and, on activation, the offer to update
 * the copies it installed when the extension has a newer skill.
 */
export function registerSkillInstaller(context: vscode.ExtensionContext): vscode.Disposable {
  const installer = new SkillInstaller(context);
  // A failure (of the global state) is not worth telling: checked again on the next activation.
  installer.offerUpdates().catch(() => undefined);
  return vscode.commands.registerCommand('mdDesignDoc.installAgentSkill', () => installer.install());
}

class SkillInstaller {
  private readonly version: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.version = String((context.extension.packageJSON as { version?: unknown }).version ?? '');
  }

  async install(): Promise<void> {
    const target = await chooseFolder();
    if (!target) {
      return;
    }
    const { parent } = target;
    // The folder of an installed copy is taken as that copy, not as the skills folder to put another one in.
    const folder =
      basename(parent).toLowerCase() === SKILL_NAME && (await exists(vscode.Uri.joinPath(parent, 'SKILL.md'))) ? parent : vscode.Uri.joinPath(parent, SKILL_NAME);
    // A copy for all projects is offered updates in every window, even one with the home folder open.
    const workspaceFolder = target.user ? undefined : vscode.workspace.getWorkspaceFolder(folder)?.uri.toString();
    const where = displayPath(folder);
    try {
      const bundle = await readBundle(this.context.extensionUri);
      const install = this.recall(folder.toString());
      const installed = await readInstalled(folder, bundle, install);
      if (installed?.bundle === bundle.hash) {
        await this.removeStale(folder, install, bundle);
        await this.remember(folder, bundle, workspaceFolder);
        void vscode.window.showInformationMessage(vscode.l10n.t('The Agent Skill in {0} is up to date.', where));
        return;
      }
      if (installed !== undefined && installed.revision > bundle.revision) {
        // Installed from a later release (its zip, or by another tool): not replaced with an older skill without asking.
        const overwrite = vscode.l10n.t('Overwrite');
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t('The Agent Skill in {0} is newer than the one of this version of the extension. Overwrite it with the older one?', where),
          { modal: true, detail: vscode.l10n.t('Its revision is {0}, and that of the extension is {1}.', installed.revision, bundle.revision) },
          overwrite,
        );
        if (answer !== overwrite) {
          return;
        }
      } else if (installed !== undefined && installed.recorded !== install?.hash) {
        // A copy installed by the command and not changed since is updated without asking.
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
      await this.write(folder, install, bundle, workspaceFolder);
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

  /**
   * Offers to update the copies installed by the command that are older than the extension's skill and were not changed
   * since: once for each version of the skill (also when the notification is closed, and in the other windows), and the
   * copies in a project only in a window with that project. Also the copies of an earlier revision that the command did
   * not install, in the skills folders it offers (`~/.claude/skills` and those of the workspace folders): once for each
   * revision, and overwritten only after asking, as their changes cannot be told.
   */
  async offerUpdates(): Promise<void> {
    const open = new Set((vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => workspaceFolder.uri.toString()));
    const installs = this.installs().filter((install) => install.workspaceFolder === undefined || open.has(install.workspaceFolder));
    let bundle: Bundle;
    try {
      bundle = await readBundle(this.context.extensionUri);
    } catch {
      return;
    }
    const outdated: SkillInstall[] = [];
    for (const install of installs) {
      const folder = vscode.Uri.parse(install.folder);
      try {
        const status = skillInstallStatus(install, await readInstalled(folder, bundle, install), bundle, this.version);
        // Applied only if the command (or another window) did not change what is remembered meanwhile.
        if (this.recall(install.folder)?.hash !== install.hash) {
          continue;
        }
        if (status === 'missing') {
          await this.forget(install.folder);
        } else if (status === 'current' && install.hash !== bundle.hash) {
          await this.removeStale(folder, install, bundle);
          await this.remember(folder, bundle, install.workspaceFolder);
        } else if (status === 'outdated') {
          outdated.push(install);
          await this.context.globalState.update(this.key(install.folder), { ...install, offered: bundle.hash });
        }
      } catch {
        // Unreadable for now (a file system that is not available here): checked again on the next activation.
      }
    }
    const unrecorded: UnrecordedCopy[] = [];
    for (const copy of skillFolders()) {
      if (this.recall(copy.folder.toString()) !== undefined) {
        continue;
      }
      try {
        const revision = await readRevision(copy.folder);
        const offerKey = this.offerKey(copy.folder.toString());
        const offered = this.context.globalState.get<unknown>(offerKey);
        if (revision !== undefined && unrecordedSkillStatus(revision, bundle.revision, typeof offered === 'number' ? offered : undefined) === 'outdated') {
          unrecorded.push({ ...copy, revision });
          await this.context.globalState.update(offerKey, bundle.revision);
        }
      } catch {
        // Unreadable for now: checked again on the next activation.
      }
    }
    if (outdated.length === 0 && unrecorded.length === 0) {
      return;
    }
    const folders = [...outdated.map((install) => vscode.Uri.parse(install.folder)), ...unrecorded.map((copy) => copy.folder)];
    const where = folders.map(displayPath).join(', ');
    const update = vscode.l10n.t('Update');
    const later = vscode.l10n.t('Later');
    const answer = await vscode.window.showInformationMessage(
      folders.length === 1
        ? vscode.l10n.t('The Agent Skill for writing design docs installed in {0} is older than the one of this version of the extension. Update it?', where)
        : vscode.l10n.t('The Agent Skills for writing design docs installed in {0} are older than the one of this version of the extension. Update them?', where),
      update,
      later,
    );
    if (answer !== update) {
      // Not asked again until the extension has another skill; the command still updates it.
      return;
    }
    let overwrite = unrecorded.length === 0;
    if (!overwrite) {
      const confirm = vscode.l10n.t('Overwrite');
      overwrite =
        (await vscode.window.showWarningMessage(
          unrecorded.length === 1
            ? vscode.l10n.t('Overwrite the Agent Skill in {0}?', displayPath(unrecorded[0].folder))
            : vscode.l10n.t('Overwrite the Agent Skills in {0}?', unrecorded.map((copy) => displayPath(copy.folder)).join(', ')),
          {
            modal: true,
            detail:
              unrecorded.length === 1
                ? vscode.l10n.t('It was not installed by this extension, so whether its files were changed cannot be told. Changes made to them will be lost.')
                : vscode.l10n.t('They were not installed by this extension, so whether their files were changed cannot be told. Changes made to them will be lost.'),
          },
          confirm,
        )) === confirm;
    }
    const updated: string[] = [];
    const failed: string[] = [];
    for (const install of outdated) {
      const folder = vscode.Uri.parse(install.folder);
      try {
        // Changed since the notification was shown (by the user, or updated from another window): left as it is.
        const current = this.recall(install.folder);
        if (current?.hash === install.hash && (await readInstalled(folder, bundle, current))?.recorded === install.hash) {
          await this.write(folder, current, bundle, current.workspaceFolder);
          updated.push(displayPath(folder));
        }
      } catch (error) {
        failed.push(`${displayPath(folder)} (${errorMessage(error)})`);
      }
    }
    for (const copy of overwrite ? unrecorded : []) {
      try {
        // Installed by the command (from another window), or replaced with another revision, since: left as it is.
        if (this.recall(copy.folder.toString()) === undefined && (await readRevision(copy.folder)) === copy.revision) {
          await this.write(copy.folder, undefined, bundle, copy.workspaceFolder);
          updated.push(displayPath(copy.folder));
        }
      } catch (error) {
        failed.push(`${displayPath(copy.folder)} (${errorMessage(error)})`);
      }
    }
    if (failed.length > 0) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Could not update the Agent Skill in {0}.', failed.join(', ')));
    }
    if (updated.length > 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Updated the Agent Skill in {0}.', updated.join(', ')));
    }
  }

  /** Writes the extension's skill into `folder`, removing the files of the previous version (`install`) it no longer has but leaving the others, and remembers it. */
  private async write(folder: vscode.Uri, install: SkillInstall | undefined, bundle: Bundle, workspaceFolder: string | undefined): Promise<void> {
    for (const [path, content] of bundle.files) {
      const target = vscode.Uri.joinPath(folder, path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      await vscode.workspace.fs.writeFile(target, content);
    }
    await this.removeStale(folder, install, bundle);
    await this.remember(folder, bundle, workspaceFolder);
  }

  /** Removes from `folder` the files that the previous version wrote there (`install`) and the extension's skill no longer has. */
  private async removeStale(folder: vscode.Uri, install: SkillInstall | undefined, bundle: Bundle): Promise<void> {
    for (const path of staleSkillFiles(install, [...bundle.files.keys()])) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, path));
      } catch (error) {
        if (!isFileNotFound(error)) {
          throw error;
        }
      }
    }
  }

  /** The key of the copy in `folder` (a URI): the same for the same folder written with other cases on Windows. */
  private key(folder: string): string {
    return STATE_PREFIX + normalizeFolder(folder);
  }

  /** The key of the revision whose update was offered for the copy in `folder` (a URI) that the command did not install. */
  private offerKey(folder: string): string {
    return OFFER_PREFIX + normalizeFolder(folder);
  }

  private installs(): SkillInstall[] {
    return this.context.globalState
      .keys()
      .filter((key) => key.startsWith(STATE_PREFIX))
      .map((key) => this.context.globalState.get<unknown>(key))
      .filter(isSkillInstall);
  }

  private recall(folder: string): SkillInstall | undefined {
    const install = this.context.globalState.get<unknown>(this.key(folder));
    return isSkillInstall(install) ? install : undefined;
  }

  /** Remembers that `folder` has the extension's skill, and the workspace folder whose windows offer its updates. */
  private async remember(folder: vscode.Uri, bundle: Bundle, workspaceFolder: string | undefined): Promise<void> {
    const install: SkillInstall = {
      folder: folder.toString(),
      hash: bundle.hash,
      files: [...bundle.files.keys()],
      version: this.version,
      ...(workspaceFolder && { workspaceFolder }),
    };
    // Remembered as installed by the command: its offers are those of `install.offered` from now on.
    await this.context.globalState.update(this.offerKey(install.folder), undefined);
    await this.context.globalState.update(this.key(install.folder), install);
  }

  private forget(folder: string): Thenable<void> {
    return this.context.globalState.update(this.key(folder), undefined);
  }
}

/** `folder` (a URI) as the keys of the global state have it: the same for the same folder written with other cases on Windows. */
function normalizeFolder(folder: string): string {
  return process.platform === 'win32' ? folder.toLowerCase() : folder;
}

/** The skills folders of Claude Code (`chooseFolder`): the copies of the skill there, whether the command installed them or not. */
function skillFolders(): SkillFolder[] {
  const copies: SkillFolder[] = [
    { folder: vscode.Uri.joinPath(userSkillsFolder(), SKILL_NAME) },
    ...(vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
      folder: vscode.Uri.joinPath(workspaceFolder.uri, '.claude', 'skills', SKILL_NAME),
      workspaceFolder: workspaceFolder.uri.toString(),
    })),
  ];
  // The home folder open as a workspace folder has the copy for all projects.
  const seen = new Set<string>();
  return copies.filter((copy) => {
    const key = normalizeFolder(copy.folder.toString());
    return !seen.has(key) && seen.add(key);
  });
}

/** Claude Code's skills folder for all projects. */
function userSkillsFolder(): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(homedir()), '.claude', 'skills');
}

function isSkillInstall(value: unknown): value is SkillInstall {
  const install = value as Partial<SkillInstall> | null;
  const optionalString = (field: unknown) => field === undefined || typeof field === 'string';
  return (
    typeof install?.folder === 'string' &&
    typeof install.hash === 'string' &&
    optionalString(install.version) &&
    optionalString(install.offered) &&
    optionalString(install.workspaceFolder) &&
    (install.files === undefined || (Array.isArray(install.files) && install.files.every((file) => typeof file === 'string')))
  );
}

interface FolderItem extends vscode.QuickPickItem {
  /** The skills folder to install the skill in; undefined for the item that opens a folder dialog. */
  folder?: vscode.Uri;
  /** Whether it is the skills folder for all projects. */
  user?: boolean;
}

/**
 * Asks for the skills folder to put the skill in: Claude Code's of the user (`user`) or of a workspace folder, or one
 * chosen in a dialog.
 */
async function chooseFolder(): Promise<{ parent: vscode.Uri; user: boolean } | undefined> {
  const items: FolderItem[] = [
    {
      label: '~/.claude/skills',
      description: vscode.l10n.t('Claude Code: all projects'),
      folder: userSkillsFolder(),
      user: true,
    },
    ...(vscode.workspace.workspaceFolders ?? []).map((workspaceFolder): FolderItem => {
      const folder = vscode.Uri.joinPath(workspaceFolder.uri, '.claude', 'skills');
      return {
        label: `${workspaceFolder.name}/.claude/skills`,
        description: vscode.l10n.t('Claude Code: this project (commit it to share it with the team)'),
        // Workspace folders may have the same name.
        detail: displayPath(folder),
        folder,
      };
    }),
    {
      label: `$(folder-opened) ${vscode.l10n.t('Choose a Folder...')}`,
      description: vscode.l10n.t('The skills folder of another AI assistant'),
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Install the Agent Skill for writing design docs with AI'),
    placeHolder: vscode.l10n.t('Choose where to install it (it is copied into a folder named {0} there)', SKILL_NAME),
  });
  if (!picked) {
    return undefined;
  }
  if (picked.folder) {
    return { parent: picked.folder, user: picked.user === true };
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: vscode.l10n.t('Install Here'),
    title: vscode.l10n.t('Choose the skills folder to install the Agent Skill in'),
  });
  return chosen?.[0] && { parent: chosen[0], user: false };
}

/** Reads the extension's skill (dist/skill/markdown-design-doc/). */
async function readBundle(extensionUri: vscode.Uri): Promise<Bundle> {
  const root = vscode.Uri.joinPath(extensionUri, 'dist', 'skill', SKILL_NAME);
  const files = new Map<string, Uint8Array>();
  for (const path of await listFiles(root, '')) {
    files.set(path, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path)));
  }
  return { files, hash: hashSkill([...files.keys()], files), revision: revisionOf(files.get('SKILL.md')) };
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

/**
 * The hashes of the files in `folder` of the extension's skill, and of those written there when it was installed
 * (`install`), or undefined if it has none of them. Throws on errors other than missing files.
 */
async function readInstalled(folder: vscode.Uri, bundle: Bundle, install: SkillInstall | undefined): Promise<InstalledHashes | undefined> {
  const bundled = [...bundle.files.keys()];
  // Installed before the files were remembered: those of the extension's skill.
  const recorded = install?.files ?? bundled;
  const files = new Map<string, Uint8Array>();
  for (const path of new Set([...bundled, ...recorded])) {
    try {
      files.set(path, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, path)));
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }
  return files.size > 0 ? { bundle: hashSkill(bundled, files), recorded: hashSkill(recorded, files), revision: revisionOf(files.get('SKILL.md')) } : undefined;
}

/** The revision of a skill whose SKILL.md is `skillMd` (`skillRevision`), 0 without it. */
function revisionOf(skillMd: Uint8Array | undefined): number {
  return skillMd ? skillRevision(new TextDecoder().decode(skillMd)) : 0;
}

/** The revision of the copy of the skill in `folder` (`skillRevision`), or undefined without its SKILL.md. Throws on other errors. */
async function readRevision(folder: vscode.Uri): Promise<number | undefined> {
  try {
    return revisionOf(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, 'SKILL.md')));
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
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

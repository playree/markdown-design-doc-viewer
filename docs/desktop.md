# Desktop app

English | [日本語](desktop.ja.md)

The preview of [Markdown Design Doc Viewer](../README.md) as a desktop app for Windows, macOS and Linux, to read design documents without VS Code. It shows a document the same way as the extension's preview: **mermaid sequence diagrams and flowcharts side by side with their step descriptions**, the arrows (or nodes) and headings highlighted together, the warnings of missing links, the table of contents, the zoom of diagrams and images, and the sticky table headers.

The app is a viewer: edit the documents in your editor, and the app shows them again each time they are saved.

## Install

Download the installer of your system from the newest of the [releases of the desktop app](https://github.com/playree/markdown-design-doc-viewer/releases?q=desktop&expanded=true) (tagged `desktop-vX.Y.Z`; the ones marked Pre-release are release candidates):

| System | File |
| --- | --- |
| Windows | `Markdown.Design.Doc.Viewer_<version>_x64-setup.exe` (or the `.msi`) |
| macOS (Apple silicon) | `Markdown.Design.Doc.Viewer_<version>_aarch64.dmg` |
| macOS (Intel) | `Markdown.Design.Doc.Viewer_<version>_x64.dmg` |
| Linux | `.deb` (Debian, Ubuntu), `.rpm` (Fedora…) or `.AppImage` |

The app has its own version, apart from the extension and the command line. Its changes are in [its changelog](../desktop/CHANGELOG.md).

### Warnings of unsigned apps

The installers are not signed yet, so the system warns about them the first time:

- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **macOS**: the app "cannot be opened because Apple cannot check it for malicious software" (or "is damaged"). Open **System Settings** > **Privacy & Security**, and click **Open Anyway** next to the message about the app. If there is no such button, remove the quarantine flag in Terminal:

  ```sh
  xattr -dr com.apple.quarantine "/Applications/Markdown Design Doc Viewer.app"
  ```

- **Linux**: make the AppImage executable (`chmod +x Markdown*.AppImage`). The `.deb` and `.rpm` packages install WebKitGTK 4.1 (`libwebkit2gtk-4.1-0` / `webkit2gtk4.1`), which the app needs, with the package manager.

## Usage

Open a Markdown file (`.md`, `.markdown`):

- with **File** > **Open...** (Ctrl+O, ⌘O on macOS), or the button shown when no file is open
- by dropping it on the window
- from the file manager: **Open with** > **Markdown Design Doc Viewer** in the context menu of the file in the Explorer (Windows) or the Finder (macOS), or **Open With Other Application** in the file managers of Linux
- from the command line: `markdown-design-doc-viewer docs/login.md` (on Windows, the `markdown-design-doc-viewer.exe` in the installation folder)

The installers add the app to the apps that open `.md` and `.markdown` files, without making it their default app. To open them with the app by a double-click, make it the default: **Open with** > **Choose another app** with **Always** (Windows), **Get Info** > **Open with** > **Change All...** (macOS), or the properties of the file (Linux). The AppImage is not added (it is not installed).

When the app is running, a file opened from the file manager or the command line opens in a new window. If a window shows that file already, it comes to the front instead; if a window shows no file, the file opens in it. **File** > **Open...**, dropping a file and the links open the file in their window. **File** > **Close** (Ctrl+W, ⌘W) closes the window, and the app ends with its last window. **File** > **Exit** (on macOS, **Quit** in the app menu) closes all the windows.

When the file is saved, the preview is updated, keeping its scroll position. **File** > **Reload** (Ctrl+R, ⌘R) reads it again.

**View** > **Sidebar** (Ctrl+B, ⌘B) shows or hides a sidebar that lists the Markdown files of a folder and of its subfolders as a tree.

- Whether it is shown, and its width (drag its right edge), are kept for the next launch.
- The folder it lists:
  - It is the folder of the document opened. While the documents opened are in that folder, the folder stays the same.
  - To list another folder, use **File** > **Open Folder...** or the folder button of the sidebar, or drop the folder on the window.
- Choosing a file opens it in the window.
- When files or folders are added, deleted or renamed, the sidebar shows the change right away.
- The sidebar does not list:
  - hidden files and folders (whose name starts with `.`, such as `.git`)
  - `node_modules`
  - folders without Markdown files
- While the sidebar is shown, the diagrams and their step descriptions are shown side by side according to the width of the window less that of the sidebar.

Links:

- `#heading` scrolls to the heading.
- A link to another Markdown file opens it in the window, at the heading of its `#fragment`.
- `http:`, `https:` and `mailto:` links open in the default browser or mail app.
- Other files open with their default app if they are images, PDF, text, CSV, JSON, YAML or Office files. The others (programs, scripts…) are shown in their folder instead of being run.

Images are looked up from the folder of the document, also with a leading `/` (there is no workspace folder as in VS Code).

**File** > **Export as HTML...** saves the document to a single HTML file, chosen in a dialog. It is the same HTML as the extension's **Export Design Doc as HTML**: the diagrams are drawn in the light theme, and the side-by-side layout and the arrow ⇔ heading highlighting work in the browser. The images in the folder of the document (or below it) are embedded in the file; the others are linked with a path relative to it. Once saved, **Open in Browser** shows it.

**View** > **Theme** shows the preview in the colors of the system (light or dark, following its changes), or always light or dark. The menus and texts are in Japanese when the language of the system is Japanese, else in English.

Compared with the extension, the app does not follow an editor (no scroll sync or double-click to jump to a line), and uses the default settings of the extension. To export many documents at once, use the [command line](cli.md).

## Development

The app is in [desktop/](../desktop/): the webview of the extension (webview/main.ts) with a host in TypeScript in place of the extension host, and a thin [Tauri 2](https://tauri.app/) app in Rust ([desktop/src-tauri/](../desktop/src-tauri/)) that reads the files, watches them, and opens the links.

It needs, besides Node.js and pnpm:

- [Rust](https://rustup.rs/) (stable)
- Windows: Visual Studio Build Tools with "Desktop development with C++", and WebView2 (included in Windows 10 and 11)
- macOS: the Xcode Command Line Tools (`xcode-select --install`)
- Linux (Debian, Ubuntu): `sudo apt install build-essential file libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev patchelf`

```sh
pnpm install
pnpm desktop:dev -- -- /absolute/path/to/doc.md   # builds and starts the app, optionally with a file (an absolute path: the app runs in desktop/src-tauri)
pnpm desktop:bundle                               # the installers, in desktop/src-tauri/target/release/bundle/
```

`pnpm desktop:build` builds only the web part (desktop/dist/); both commands above run it first. After changing the Rust dependencies (Cargo.lock), run `pnpm desktop:licenses` to write their licenses to desktop/src-tauri/ThirdPartyLicenses.txt, which the installers include (it needs [cargo-about](https://github.com/EmbarkStudios/cargo-about): `cargo install cargo-about --version 0.9.2 --locked --features cli`, the version CI checks the file with). The app has to be tried on a machine with a display. In CI, the build on Windows, macOS and Linux takes a while, so it runs only when started by hand ([desktop.yml](../.github/workflows/desktop.yml)): run it for changes of desktop/src-tauri, of the Tauri settings or of the dependencies, and before a release.

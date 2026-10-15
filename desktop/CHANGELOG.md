# Changelog of the desktop app

The desktop app has its own version, apart from the extension and the command line (their changes are in [CHANGELOG.md](../CHANGELOG.md)). Its installers are attached to the [releases of the desktop app](https://github.com/playree/markdown-design-doc-viewer/releases?q=desktop&expanded=true) (tagged `desktop-vX.Y.Z`).

## Unreleased

- The installers add the app to the apps that open `.md` and `.markdown` files (Open with in the Explorer and the Finder), without making it their default app.
- A file opened while the app is running opens in a new window, or brings to the front the window that shows it already. **File** > **Close** (Ctrl+W, ⌘W) closes the window, and **File** > **Exit** all the windows.
- **File** > **Export as HTML...** saves the document to a single HTML file, the same as the extension's **Export Design Doc as HTML**: the diagrams, the images of the document's folder embedded, and the side-by-side layout and highlighting in the browser.
- **View** > **Sidebar** (Ctrl+B, ⌘B) shows the Markdown files of the document's folder and of its subfolders as a tree, to switch between the documents. It follows the files added, deleted or renamed, and **File** > **Open Folder...** lists another folder. Whether it is shown, and its width, are kept for the next launch.
- The top of the preview has a small margin, so that the first element (such as the box of the document header) does not touch the top edge.
- Tables of items: an HTML comment before a table (`<!-- table: level=Level merge=Item,"Physical name" -->`) shows two or more columns in one cell (such as the item name and the physical name), and the rows as a tree of the levels in a column, which is hidden: indented with lines, the rows with children emphasized and foldable, and the parents and children of the row under the pointer highlighted. A button at the right of the header row shows the table as it is for a while. Elsewhere, such as on GitHub, it stays a plain table.

## 0.1.0

- The preview is also a desktop app for Windows, macOS and Linux, to read design documents without VS Code. It opens a Markdown file from its menu, by drag and drop or from the command line, shows it like the extension's preview, and updates it when the file is saved. Links to other Markdown files open in the app, and web links in the browser. The installers are not signed yet; see [the desktop app's guide](../docs/desktop.md) for the warnings of the system on the first launch.
- The installers include the licenses and copyright notices of the npm packages bundled into the app (ThirdPartyNotices.txt) and of its Rust crates (ThirdPartyLicenses.txt).

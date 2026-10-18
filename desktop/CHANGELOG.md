# Changelog of the desktop app

The desktop app has its own version, apart from the extension and the command line (their changes are in [CHANGELOG.md](../CHANGELOG.md)). Its installers are attached to the [releases of the desktop app](https://github.com/playree/markdown-design-doc-viewer/releases?q=desktop&expanded=true) (tagged `desktop-vX.Y.Z`).

## Unreleased

- **View** > **Settings...** (Ctrl+,; on macOS in the app menu, ⌘,) opens the settings of the extension (`mdDesignDoc.*`) in the app: the theme, the diagram look, the width for the side-by-side layout, the table of contents, the heading numbers, the front matter, the text width, the sticky table headers and the highlight of table trees. A change applies at once to all the windows, and is kept for the next launch. Before, the app used the defaults of the extension.
- **File** > **Open Recent** and the screen shown when no file is open list the files opened recently (up to 10, the last one first), to open them again. The files opened from the sidebar or a link are not listed. A file no longer found is removed from the list when it is chosen, and the list can be cleared.
- **File** > **Export as HTML...** exports the differences from the commit the document is compared with in the **History** tab, marked as in the window, with a bar to go from one change to the next and to hide or show them.

## 0.2.0

- **View** > **Design Docs** (Ctrl+Shift+D, ⌘⇧D) lists the design documents of the sidebar's folder (`type: design_doc` in their front matter) in place of the document: a table of their titles, file names, versions, products, statuses and update dates, by folder, with a search box and sortable columns. Clicking a title opens the document.
- The installers add the app to the apps that open `.md` and `.markdown` files (Open with in the Explorer and the Finder), without making it their default app.
- A file opened while the app is running opens in a new window, or brings to the front the window that shows it already. **File** > **Close** (Ctrl+W, ⌘W) closes the window, and **File** > **Exit** all the windows.
- **File** > **Export as HTML...** saves the document to a single HTML file, the same as the extension's **Export Design Doc as HTML**: the diagrams, the images of the document's folder embedded, and the side-by-side layout and highlighting in the browser.
- **View** > **Sidebar** (Ctrl+B, ⌘B) shows the Markdown files of the document's folder and of its subfolders as a tree, to switch between the documents. It follows the files added, deleted or renamed, and **File** > **Open Folder...** lists another folder. Whether it is shown, and its width, are kept for the next launch.
- The sidebar has a **History** tab, which lists the Git commits of the document and compares it with the one chosen, like the extension's **Compare Design Doc with Git Revision**: the blocks added, changed and deleted marked in the preview, the words changed highlighted, and a bar at the bottom to go from one change to the next. Choosing the commit again, or closing the bar, shows the document alone again. Git runs only once the tab is shown.
- The **History** tab also shows the branch of the document's repository: choosing another one (a local branch, or a branch of a remote, which creates a local branch that tracks it) switches the repository to it after asking, and shows the document, the files and the history of that branch. Its pull button pulls the branch when it can be fast-forwarded. When Git fails (changes not committed, diverged branches, no upstream…), a dialog tells why and the repository stays as it was.
- The top of the preview has a small margin, so that the first element (such as the box of the document header) does not touch the top edge.
- Tables of items: an HTML comment before a table (`<!-- table: level=Level merge=Item,"Physical name" -->`) shows two or more columns in one cell (such as the item name and the physical name), and the rows as a tree of the levels in a column, which is hidden: indented with lines, the rows with children emphasized and foldable, and the parents and children of the row under the pointer highlighted. A button at the right of the header row shows the table as it is for a while. Elsewhere, such as on GitHub, it stays a plain table.

## 0.1.0

- The preview is also a desktop app for Windows, macOS and Linux, to read design documents without VS Code. It opens a Markdown file from its menu, by drag and drop or from the command line, shows it like the extension's preview, and updates it when the file is saved. Links to other Markdown files open in the app, and web links in the browser. The installers are not signed yet; see [the desktop app's guide](../docs/desktop.md) for the warnings of the system on the first launch.
- The installers include the licenses and copyright notices of the npm packages bundled into the app (ThirdPartyNotices.txt) and of its Rust crates (ThirdPartyLicenses.txt).

# Changelog

This changelog covers the extension and the command line. The desktop app has its own version and [changelog](desktop/CHANGELOG.md).

## 1.2.0

- The margin at the top of the preview, above the box of the document header, is no longer scrolled out of view when the editor is scrolled to the top.
- The title bar of the design doc list (`Show Design Docs`) has the light / dark button too, and its search box takes the colors of the theme chosen with it instead of VS Code's. The search box of the exported `index.html` has the same colors as the one of the light theme.
- `Export Design Doc as HTML` exports the differences from a Git revision while the preview is compared with it (`Compare Design Doc with Git Revision...`), marked as in the preview. A bar at the bottom of the exported page tells the date of the revision ("Compared with the version of …", without its commit, which tells little to the readers), goes from one change to the next, and hides or shows them.
- The command line's `--diff-base <rev>` exports each document with its changes since the git revision `<rev>` (a tag, a commit or a branch); a document the revision does not have is shown as all added. The bar of the page tells the date of the revision. With `--index`, `index.html` has a column of the changes of each document (their numbers, new, or no changes).

## 1.1.0

- `Show Design Docs` lists the design documents of the workspace (`type: design_doc` in their front matter) in a table of their titles, file names, versions, products, statuses and update dates, by folder, with a search box and sortable columns. Clicking a title opens its preview, and the list follows the files added, changed and deleted. The **Design Docs** view of the Explorer shows them as a tree of their titles, with their version and status.
- The command line's `--index-design-docs` lists only the design documents in `index.html`, and `index.html` has the same search box and sortable columns.
- `Compare Design Doc with Git Revision...` (the history button in the preview's title bar, also in its context menu) lists the commits of the document and shows its differences from the one chosen in the preview: the blocks added, changed and deleted are marked with green, blue and red bands, the words changed are highlighted in the changed blocks, and the old version of a changed diagram is shown folded below it. The bar at the bottom goes from one change to the next, and closes the comparison. The differences follow the edits of the document, saved or not. It needs Git.
- The [website](https://playree.github.io/markdown-design-doc-viewer/) ([日本語](https://playree.github.io/markdown-design-doc-viewer/ja/)) on GitHub Pages introduces the extension, the app for Windows, macOS and Linux, the command line and the Agent Skill. The sample design document exported to HTML has moved to [/sample/](https://playree.github.io/markdown-design-doc-viewer/sample/) ([日本語](https://playree.github.io/markdown-design-doc-viewer/ja/sample/)).
- ThirdPartyNotices.txt, in the extension and the npm package, includes the licenses and copyright notices of the npm packages bundled into them (mermaid, markdown-it, DOMPurify, highlight.js and the packages they use).
- The top of the preview has a small margin, so that the first element (such as the box of the document header) does not touch the top edge.
- Tables of items: an HTML comment before a table (`<!-- table: level=Level merge=Item,"Physical name" -->`) shows two or more columns in one cell (such as the item name and the physical name), and the rows as a tree of the levels in a column, which is hidden: indented with lines, the rows with children emphasized and foldable, and the parents and children of the row under the pointer highlighted. Elsewhere, such as on GitHub, it stays a plain table. A button at the right of the header row shows the table as it is for a while (also in exported HTML). Options that cannot be applied are reported as warnings. The highlight can be turned off with `mdDesignDoc.tableTreeHighlight` (`--no-table-tree-highlight` on the command line). See [examples/message-definition.ja.md](examples/message-definition.ja.md) for a sample in Japanese. The [authoring guide for AI assistants](docs/ai-authoring-guide.md) and the Agent Skill tell how to write them.

## 1.0.0

- The [authoring guide for AI assistants](docs/ai-authoring-guide.md) and the usage of the command line are packaged as an Agent Skill, attached to each release: [markdown-design-doc-skill.zip](https://github.com/playree/markdown-design-doc-viewer/releases/latest/download/markdown-design-doc-skill.zip). Upload it to Claude, or unzip it into the skills folder of Claude Code or another assistant, and it is used when the assistant is asked to write a design document, in English or in Japanese.
- The [authoring guide for AI assistants](docs/ai-authoring-guide.md) tells how to use footnotes for side notes, and folded `<details>` sections for content that does not need to be read every time, such as the change history.
- The command line can write a list of the exported documents with `--index`: `index.html` in the output folder, with a table for each folder of the documents' titles (linked), file names, and the `version`, `product`, `status` and `updated` of their front matter. Its title is set with `--index-title`.
- A sample design document exported to HTML is published on GitHub Pages ([English](https://playree.github.io/markdown-design-doc-viewer/), [Japanese](https://playree.github.io/markdown-design-doc-viewer/ja/)), to try the arrow ⇔ heading highlighting, sticky table headers and footnote popups in a browser.

## 0.5.0

- The HTML export runs from the command line too, to convert documents in CI or in a batch: `npx markdown-design-doc-viewer export docs -o site`. The diagrams are rendered with headless Chrome, link warnings are reported (as annotations in GitHub Actions), and `--strict` fails on them.
- Footnotes (`text[^1]` and `[^1]: note`) are rendered, with links between the references and the notes gathered at the end of the document. Hovering a reference shows its note in a popup.
- The header of a design document (`type: design_doc`) is a box with the title on the left and the main entries on the right, separated by lines.
- The preview can be shown in light or dark regardless of VS Code's color theme. The button in the preview's title bar switches it to the other of light and dark, and pressing it again makes it follow VS Code again. The choice is saved in `mdDesignDoc.theme` (`auto` / `light` / `dark`).

## 0.4.0

- With `type: design_doc` in the YAML front matter, the document's `title`, `version`, `product`, `status` and `updated` are shown as a header at the top of the preview, with the other entries in a table folded below it (closed by default).
- The header row of a long table stays at the top of the preview while scrolling through the table (also in exported HTML). It can be turned off with `mdDesignDoc.stickyTableHeader`.
- The arrow numbers shown at the start of linked headings with `autonumber` can be hidden with `mdDesignDoc.headingNumbers`.
- GitHub alerts show the icon of their kind before the title, as on GitHub.
- Images open full screen when clicked, to zoom and pan them like diagrams. Images in a link still open the link.
- In a wide preview, the text is kept in a centered column up to 1280px wide. Diagrams shown beside their steps still use the whole width. The button in the preview's title bar switches the text back to the full width, and the choice is saved in `mdDesignDoc.limitContentWidth` (also applied to exported HTML).

## 0.3.0

- Breaking: the marker is renamed to fit any diagram kind: `%% @seq-notes` → `%% @link-headings`, and `<!-- seq-notes:end -->` → `<!-- link-headings:end -->`. The old names are no longer recognized: diagrams with only the old marker are shown as plain diagrams, and the old markers are reported as warnings so that you can replace them.
- Flowcharts (`graph` / `flowchart`) can be linked to their step headings like sequence diagrams: each node is linked to the heading with the text of its label, or with `%% @ref` above the line defining it. Horizontal flowcharts (`LR` / `RL`) are always shown above their steps instead of beside them.
- `mdDesignDoc.diagramLook` switches the mermaid diagrams to the flat `classic` look, without the shadows of mermaid's default `neo` look.
- YAML front matter is shown at the top of the preview as a table of the document's metadata (title, version, status...). It can be hidden again with `mdDesignDoc.frontMatter`.
- `Ctrl+F` / `Cmd+F` searches the preview.
- In the editor, `%% @ref ` completes the headings of the overview, and the missing-link diagnostics have quick fixes: write a `@ref` to a heading without an arrow, add a heading for the arrow, or fix a broken `@ref`.
- `Export Design Doc as HTML` writes the document to a single HTML file to share or print to PDF from a browser, with the diagrams rendered, images embedded and the arrow ⇔ heading highlighting working.
- Collapsible `<details>` sections are shown in a box, with a chevron that turns when opened and a pointer cursor on the summary, so that they look clickable.
- Diagrams can be opened full screen with the button shown when hovering them, then zoomed with the wheel and panned by dragging.
- Link warnings, arrows without a heading and headings without an arrow are reported in the Problems panel for open Markdown files, even when no preview is open. It can be turned off with `mdDesignDoc.diagnostics`.
- Added an [authoring guide for AI assistants](docs/ai-authoring-guide.md) to copy into `CLAUDE.md`, `AGENTS.md` or similar instructions files.

## 0.2.0

- Renamed to **Markdown Design Doc Viewer** (extension ID `playree.markdown-design-doc-viewer`). It is published as a new extension, so uninstall Markdown Sequence Side Notes and install this one.
- Breaking: settings, commands and the custom editor are renamed from `seqNotes.*` to `mdDesignDoc.*` (for example `seqNotes.splitMinWidth` → `mdDesignDoc.splitMinWidth`, and `seqNotes.editor` → `mdDesignDoc.editor` in `workbench.editorAssociations`). Update your settings accordingly. The document syntax (`%% @seq-notes`, `%% @ref`, `<!-- seq-notes:end -->`) is unchanged.
- Hovering the right edge of the preview opens a table of contents (h1–h3) that jumps to the heading on click. It can be turned off with `mdDesignDoc.toc`.
- The × button temporarily hides the warnings at the top of the preview; they are shown again when they change.
- Warnings, marks and tooltips in the preview follow the VS Code display language (English and Japanese).
- YAML front matter is hidden instead of being rendered as a heading. Code blocks are syntax highlighted, and GitHub alerts and task lists are rendered.
- With `autonumber`, linked headings show the arrow's number. Numbered headings such as `## 3. Fetch user` link to the arrow `Fetch user`.
- Arrows without a linked heading are shown faded, and headings at the level of the linked ones without an arrow get a "no arrow" mark.

## 0.1.0

Initial release.

- Side-by-side preview of mermaid sequence diagrams marked with `%% @seq-notes` and the step descriptions (headings) that follow them, with a line between linked steps. Falls back to the normal vertical layout on narrow panes.
- Arrow ⇔ heading links by matching arrow labels with headings, or explicitly with `%% @ref`. `<!-- seq-notes:end -->` ends the description column. Unresolved links and `@ref` in unmarked diagrams are reported as warnings.
- Editor sync: the preview follows the editor's scroll position and cursor, and double-clicking in the preview jumps to the source line.
- The preview can also be opened as a custom editor from "Reopen Editor With..." and set as the default editor for Markdown files.

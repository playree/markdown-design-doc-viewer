# Changelog

## Unreleased

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

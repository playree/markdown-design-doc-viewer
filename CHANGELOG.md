# Changelog

## Unreleased

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

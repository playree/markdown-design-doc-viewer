# Changelog

## 0.1.0

Initial release.

- Side-by-side preview of mermaid sequence diagrams marked with `%% @seq-notes` and the step descriptions (headings) that follow them, with a line between linked steps. Falls back to the normal vertical layout on narrow panes.
- Arrow ⇔ heading links by matching arrow labels with headings, or explicitly with `%% @ref`. `<!-- seq-notes:end -->` ends the description column. Unresolved links and `@ref` in unmarked diagrams are reported as warnings.
- Editor sync: the preview follows the editor's scroll position and cursor, and double-clicking in the preview jumps to the source line.
- The preview can also be opened as a custom editor from "Reopen Editor With..." and set as the default editor for Markdown files.

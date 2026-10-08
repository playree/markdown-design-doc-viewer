# Changelog

## Unreleased

- **Breaking:** a sequence diagram is shown side by side only when its mermaid block contains `%% @seq-notes` (previously: when at least one arrow was linked). Add the marker to existing documents. A marked diagram is shown side by side even without links, the description column now extends over unmarked diagrams, and `@ref` in an unmarked diagram is reported as a warning.

## 0.1.0

- Initial release: side-by-side preview of mermaid sequence diagrams and their step descriptions, arrow ⇔ heading links (`%% @ref`, `<!-- seq-notes:end -->`), and editor sync.

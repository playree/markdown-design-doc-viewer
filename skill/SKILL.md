---
name: markdown-design-doc
description: Write, edit, review and export design documents in the Markdown format of Markdown Design Doc Viewer, where a mermaid sequence diagram or flowchart marked with %% @link-headings is linked arrow by arrow (node by node) to the step headings after it, with type design_doc front matter. Use when writing or editing a design document or specification in Markdown (設計書, 基本設計, 詳細設計, 仕様書, シーケンス図, フローチャート, 処理概要, 処理フロー), when a Markdown file has type design_doc front matter or %% @link-headings, or when exporting design documents to HTML (HTML エクスポート, HTML 出力) with the markdown-design-doc-viewer or md-design-doc command line.
---

# Markdown design documents

Write the document, and reply to the user, in the user's language: a request in Japanese gets a document with Japanese headings, arrow labels and text. Only the syntax stays as written below: the mermaid keywords, `%% @link-headings`, `%% @ref`, `<!-- link-headings:end -->`, `<details>` / `<summary>`, and the front matter keys and `type: design_doc`.

<!-- include: docs/ai-authoring-guide.md -->

## Check without VS Code

When the diagnostics of VS Code cannot be read, check the document yourself after writing or editing it:

- Every arrow (node) of a diagram with `%% @link-headings` has a step heading with the same text after the diagram, or a `%% @ref` on the line just before it that names one of those headings.
- Every heading at the step level, between the diagram and `<!-- link-headings:end -->`, is linked to an arrow (node).
- If the command line can run (see [Export to HTML](#export-to-html)), export the document with `--strict`. It fails on `@ref` targets that do not exist and markers that have no effect, but it does not report arrows and headings that are only not linked.

## Export to HTML

When the user asks for HTML (to share, publish or print to PDF), export the documents with the command line of the extension:

```sh
npx markdown-design-doc-viewer export docs/login.md -o out   # out/docs/login.html
npx markdown-design-doc-viewer export docs -o site --index   # every Markdown file under docs/, and site/index.html listing them
```

- Add `--lang ja` for Japanese documents.
- Before running it, read [references/cli.md](references/cli.md) for what it needs (Node.js, Chrome or Chromium, and a font for Japanese), its options, its exit status and an example for GitHub Actions.

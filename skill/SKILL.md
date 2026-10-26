---
name: markdown-design-doc
description: Write, edit, review and export design documents in the Markdown format of Markdown Design Doc Viewer, where a mermaid sequence diagram, flowchart, ER diagram or state diagram marked with %% @link-headings is linked arrow by arrow (node by node) to the step headings after it, and a wireframe of a screen written in HTML is linked part by part to its item table and headings, with type design_doc front matter. Use when writing or editing a design document or specification in Markdown (設計書, 基本設計, 詳細設計, 仕様書, シーケンス図, フローチャート, ER 図, 状態遷移図, 処理概要, 処理フロー, 画面設計書, ワイヤーフレーム) or a table of the items of a message, a file or a screen (電文定義, 項目定義, インターフェース定義, ファイルレイアウト, 画面項目定義), when a Markdown file has type design_doc front matter or %% @link-headings, or when exporting design documents to HTML (HTML エクスポート, HTML 出力) with the markdown-design-doc-viewer or md-design-doc command line.
---

# Markdown design documents

Write the document, and reply to the user, in the user's language: a request in Japanese gets a document with Japanese headings, arrow labels and text. Only the syntax stays as written below: the mermaid keywords, `%% @link-headings`, `%% @ref`, `<!-- link-headings:end -->`, `<details>` / `<summary>`, the front matter keys and `type: design_doc`, `<!-- table: level=… merge=… item=… -->` (the column names in it are the headers of the table, in the user's language: `<!-- table: level=階層 merge=項目名,物理名 -->`), and `<!-- wireframe: … -->` with the `data-item` / `data-ref` attributes of a wireframe.

<!-- include: docs/ai-authoring-guide.md -->

## Check without VS Code

When the diagnostics of VS Code cannot be read, check the document yourself after writing or editing it:

- Every arrow (node) of a diagram with `%% @link-headings` has a step heading with the same text after the diagram, or a `%% @ref` on the line just before it that names one of those headings.
- Every heading at the step level, between the diagram and `<!-- link-headings:end -->`, is linked to an arrow (node).
- Every column named in a `<!-- table: … -->` comment is a header of the table right after it, and the level column has an integer in every row.
- Every part (`data-item`) of a wireframe with `link-headings` has a row with its number in the `item=` column of an item table, or a heading numbered like it, after the wireframe; and every such row and heading has a part.
- If the command line can run (see [Export to HTML](#export-to-html)), export the document with `--strict`. It fails on `@ref` targets that do not exist, markers that have no effect and table options that cannot be applied, but it does not report arrows and headings that are only not linked.

## Export to HTML

When the user asks for HTML (to share, publish or print to PDF), export the documents with the command line of the extension:

```sh
npx markdown-design-doc-viewer export docs/login.md -o out   # out/docs/login.html
npx markdown-design-doc-viewer export docs -o site --index   # every Markdown file under docs/, and site/index.html listing them
```

- Add `--lang ja` for Japanese documents.
- Before running it, read [references/cli.md](references/cli.md) for what it needs (Node.js, Chrome or Chromium, and a font for Japanese), its options, its exit status and an example for GitHub Actions.

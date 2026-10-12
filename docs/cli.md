# markdown-design-doc-viewer

[![npm](https://img.shields.io/npm/v/markdown-design-doc-viewer.svg)](https://www.npmjs.com/package/markdown-design-doc-viewer)
[![CI](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

English | [日本語](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/cli.ja.md)

The command line of [Markdown Design Doc Viewer](https://github.com/playree/markdown-design-doc-viewer), to export design documents written in Markdown to single HTML files, in CI or in a batch, without VS Code.

The HTML is the same as the VS Code extension's `Export Design Doc as HTML` command writes: **mermaid sequence diagrams and flowcharts are shown side by side with their step descriptions**, and each arrow (or flowchart node) is linked to its heading, highlighted when hovered or clicked. The diagrams are rendered with headless Chrome and local images are embedded, so the file can be opened in any browser or printed to PDF.

![Sequence diagram on the left, linked step descriptions on the right](https://raw.githubusercontent.com/playree/markdown-design-doc-viewer/main/images/screenshot.png)

**[Live sample](https://playree.github.io/markdown-design-doc-viewer/)**: an HTML file written by this command from [examples/screenshot.md](https://github.com/playree/markdown-design-doc-viewer/blob/main/examples/screenshot.md).

## Usage

```sh
npx markdown-design-doc-viewer export docs -o site     # all the Markdown files under docs/ to site/docs/*.html
npx markdown-design-doc-viewer export docs -o site --index   # plus site/index.html, a list of the documents
npx markdown-design-doc-viewer export README.md        # README.html next to it
```

Installed in a project (`npm install --save-dev markdown-design-doc-viewer`), the command is `md-design-doc`:

```sh
md-design-doc export docs -o site
```

## Requirements

- Node.js 22 or later.
- Chrome or Chromium: `--chrome <path>` or `$CHROME_PATH`, else a Chromium installed with `npx playwright-core install chromium`, else the Google Chrome installed on the system (GitHub Actions' Ubuntu runners have one).
- For documents in Japanese or other CJK languages, a font for them (`fonts-noto-cjk` on Debian / Ubuntu), or their diagrams are drawn with boxes.

## Options

| Option | Description |
|---|---|
| `-o`, `--out-dir <dir>` | Write the HTML files to this folder, in the same subfolders as the documents under `--root`. By default, each one is written next to its document. |
| `--root <dir>` | Folder that image paths starting with `/` are relative to (the workspace in VS Code). Images in it or in the document's folder are embedded; others stay links. Default: the current folder. |
| `--lang <lang>` | Language of the texts added to the document and of the link warnings: `en` (default) or `ja`. |
| `--diagram-look <look>` | Look of the diagrams: `neo` (default, mermaid's, with shadows on flowchart nodes) or `classic` (flat). |
| `--split-min-width <px>` | Minimum window width (px) for the diagrams beside their steps. Default: `1000`. |
| `--full-width` | Do not keep the text in a centered column up to 1280px wide. |
| `--no-heading-numbers` | Do not show the arrow numbers (`autonumber`) at the start of the linked headings. |
| `--no-front-matter` | Hide the YAML front matter (shown as a table of metadata, or as a header with `type: design_doc`). |
| `--no-sticky-table-header` | Do not keep the header row of a long table at the top while scrolling. |
| `--chrome <path>` | Chrome or Chromium to render the diagrams with. |
| `--strict` | Fail when a document has a link warning (a broken `@ref` or a misplaced marker). Arrows and headings that are only not linked do not fail. |
| `--index` | Also write `index.html` in `--out-dir` (required), a list of the exported documents: a table for each folder, with their title (linked), file name, and the `version`, `product`, `status` and `updated` of their front matter. |
| `--index-title <title>` | Title of `index.html`. Default: `Design Docs` (`設計書一覧` with `--lang ja`). |
| `-h`, `--help` | Show the help. |
| `-v`, `--version` | Show the version. |

Folders are searched for `*.md` and `*.markdown` files, including their subfolders, except `node_modules` and folders starting with a dot. Link warnings are written to the standard error (as annotations in GitHub Actions).

The exit status is 1 when a document could not be exported or has a diagram mermaid cannot render (its HTML is written anyway), or with `--strict` a link warning, and 2 for a wrong command line.

## GitHub Actions

For example, to publish the documents of a repository as an artifact of each build:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx markdown-design-doc-viewer export docs -o site
- uses: actions/upload-artifact@v4
  with:
    name: design-docs
    path: site
```

## Writing linked documents

A diagram is linked to the headings after it with `%% @link-headings` in the diagram; arrows and nodes are matched with the headings by their text, or with `%% @ref`. See [Writing linked documents](https://github.com/playree/markdown-design-doc-viewer#writing-linked-documents) for the syntax, and the [authoring guide for AI](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/ai-authoring-guide.md) to have an AI assistant write documents in this format.

To preview the documents while writing them, with the editor and the preview in sync, use the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=playree.markdown-design-doc-viewer).

## License

[MIT](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

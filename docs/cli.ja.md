# markdown-design-doc-viewer

[![npm](https://img.shields.io/npm/v/markdown-design-doc-viewer.svg)](https://www.npmjs.com/package/markdown-design-doc-viewer)
[![CI](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

[English](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/cli.md) | 日本語

[Markdown 設計書ビューア](https://github.com/playree/markdown-design-doc-viewer/blob/main/README.ja.md)のコマンドライン版です。Markdown で書いた設計書を、CI やバッチ処理で VS Code なしに 1 つの HTML ファイルへ書き出します。

書き出す HTML は VS Code 拡張の `設計書を HTML にエクスポート` コマンドと同じです。**mermaid のシーケンス図やフローチャートと処理概要を横並びにして**表示し、図の矢印（フローチャートではノード）と見出しが紐付いて、マウスを載せたりクリックしたりするとハイライトします。図はヘッドレス Chrome で描画し、ローカルの画像は埋め込むので、どのブラウザでも開けて、印刷から PDF にもできます。

![左にシーケンス図、右に紐付いた処理概要](https://raw.githubusercontent.com/playree/markdown-design-doc-viewer/main/images/screenshot.ja.png)

**[サンプル](https://playree.github.io/markdown-design-doc-viewer/ja/)**: このコマンドで [examples/screenshot.ja.md](https://github.com/playree/markdown-design-doc-viewer/blob/main/examples/screenshot.ja.md) から書き出した HTML です。

## 使い方

```sh
npx markdown-design-doc-viewer export docs -o site     # docs/ 以下の Markdown をすべて site/docs/*.html に
npx markdown-design-doc-viewer export docs -o site --index   # 加えて文書の一覧を site/index.html に
npx markdown-design-doc-viewer export README.md        # 隣に README.html を
```

プロジェクトにインストールした場合（`npm install --save-dev markdown-design-doc-viewer`）、コマンド名は `md-design-doc` です。

```sh
md-design-doc export docs -o site
```

## 必要なもの

- Node.js 22 以降。
- Chrome か Chromium。`--chrome <パス>` か `$CHROME_PATH`、なければ `npx playwright-core install chromium` で入れた Chromium、それもなければシステムにインストールされた Google Chrome（GitHub Actions の Ubuntu ランナーには入っています）を使います。
- 日本語などの CJK の文書には、そのフォント（Debian / Ubuntu では `fonts-noto-cjk`）。ないと図の文字が四角で描かれます。

## オプション

| オプション | 説明 |
|---|---|
| `-o`, `--out-dir <dir>` | HTML をこのフォルダに、`--root` 以下での文書と同じサブフォルダ構成で書き出す。省略時は各文書の隣に書き出す |
| `--root <dir>` | `/` で始まる画像パスの基準のフォルダ（VS Code のワークスペースに相当）。この中と文書のフォルダの画像は埋め込み、それ以外はリンクのまま。既定はカレントフォルダ |
| `--lang <lang>` | 文書に加える文言と紐付けの警告の言語。`en`（既定）か `ja` |
| `--diagram-look <look>` | 図の見た目。`neo`（既定。mermaid の標準で、フローチャートのノードに影が付く）か `classic`（影のない平坦な見た目） |
| `--split-min-width <px>` | 図と処理概要を横並びにする最小のウィンドウ幅 (px)。既定は `1000` |
| `--full-width` | 本文を最大 1280px の中央の列に収めない |
| `--no-heading-numbers` | 紐付いた見出しの先頭に矢印の番号（`autonumber`）を表示しない |
| `--no-front-matter` | YAML front matter（メタ情報の表、`type: design_doc` ではヘッダ）を表示しない |
| `--no-sticky-table-header` | 長い表のヘッダ行をスクロール中に上端に固定しない |
| `--chrome <path>` | 図の描画に使う Chrome か Chromium |
| `--strict` | 紐付けの警告（壊れた `@ref` や置き場所の誤ったマーカーなど）があれば失敗にする。紐付いていないだけの矢印・見出しでは失敗しない |
| `--index` | 書き出した文書の一覧を `--out-dir`（必須）の `index.html` にも書き出す。フォルダごとの表に、タイトル（リンク）・ファイル名と、front matter の `version`・`product`・`status`・`updated` を載せる |
| `--index-title <title>` | `index.html` のタイトル。既定は `Design Docs`（`--lang ja` では `設計書一覧`） |
| `-h`, `--help` | ヘルプを表示する |
| `-v`, `--version` | バージョンを表示する |

フォルダはサブフォルダも含めて `*.md` と `*.markdown` を探します（`node_modules` とドットで始まるフォルダは除く）。紐付けの警告は標準エラーに出します（GitHub Actions では注釈になります）。

文書を書き出せなかったとき、mermaid が描画できない図があったとき（HTML は書き出します）、`--strict` で紐付けの警告があったときは終了コード 1、コマンドラインの誤りは 2 で終わります。

## GitHub Actions

たとえば、リポジトリの設計書をビルドごとに成果物として公開するには:

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

## 書き方

図の中に `%% @link-headings` を書くと、その図が後ろの見出しと紐付きます。矢印・ノードと見出しは文言で、または `%% @ref` で対応付けます。記法は [書き方](https://github.com/playree/markdown-design-doc-viewer/blob/main/README.ja.md#書き方) を、AI アシスタントにこの形式で書かせるには [AI 向けの記法ガイド](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/ai-authoring-guide.ja.md) を参照してください。

エディタとプレビューを同期させながら書くには、[VS Code 拡張](https://marketplace.visualstudio.com/items?itemName=playree.markdown-design-doc-viewer)を使ってください。

## ライセンス

[MIT](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

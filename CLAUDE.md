# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ユーザーとの会話は日本語で行うこと。

## ブランチ運用

- `main` で直接作業・コミットしない。ファイルを変更する前に、最新の `main` から `feature/<内容を表す名前>`（例: `feature/seq-notes-marker`）を作成して切り替える。
- `main` への反映は PR 経由で行う（PR は CodeRabbit がレビューする）。
- PR を作る前に、差分をセルフコードレビュー（`/code-review`）し、指摘を反映してから PR を作る。

## 概要

VS Code 拡張「Markdown Design Doc Viewer」（日本語表記: Markdown 設計書ビューア）。設計書 Markdown のビューアで、主な機能として設計書内の mermaid シーケンス図・フローチャートと、その後ろの処理概要（見出し）を横並びでプレビューし、矢印（フローチャートではノード）と見出しを相互に紐付ける。記法・挙動の仕様は [README.md](README.md)（英語）と [README.ja.md](README.ja.md)（日本語）が正（両方を同じ内容で保守する）。

## コマンド

パッケージマネージャは pnpm。lint / formatter の設定はない。

```sh
pnpm build        # esbuild で dist/ に extension.js, webview.js, webview.css を出力
pnpm watch        # 監視ビルド
pnpm typecheck    # tsc --noEmit（src, webview, test, scripts すべて）
pnpm test         # vitest run
pnpm exec vitest run test/render.test.ts -t 'テスト名の一部'   # 単一テスト
pnpm package      # vsce で .vsix を作成
pnpm screenshots  # README の画像（images/screenshot*.png）を examples/screenshot.md から再生成。シーン名を付けるとそれだけ撮る
```

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）は main への push と PR で `typecheck`・`test`・`package` を実行し、.vsix を成果物としてアップロードする。

動作確認は VS Code の F5（`.vscode/launch.json` の "Run Extension"）。ビルド後に `examples/` フォルダを開いた拡張開発ホストが起動するので、[examples/login.md](examples/login.md)（基本の紐付け）、[examples/password-reset.md](examples/password-reset.md)（autonumber・アラート・タスクリストなど）、[examples/link-checks.md](examples/link-checks.md)（紐付け漏れの表示と警告）、[examples/flowchart.md](examples/flowchart.md)（フローチャート、横向きの縦並び）をプレビューする。README のスクリーンショットは [examples/screenshot.md](examples/screenshot.md)（機能ごとの節に分けた撮影用サンプル）から `pnpm screenshots`（[scripts/screenshots.ts](scripts/screenshots.ts)）で撮る。webview を VS Code のライトテーマ・英語の文言を再現したページに載せ、headless Chrome（`playwright-core`）で撮影する。Chrome は `CHROME_PATH`、なければ Playwright のキャッシュ（Chromium または headless shell）から探す（`pnpm exec playwright-core install chromium` で入る）。撮る範囲・ハイライトする項目は `SCENES` で定義する。プレビューの見た目を変えたら撮り直す。

## アーキテクチャ

2 つのバンドルに分かれ、[esbuild.mjs](esbuild.mjs) でそれぞれビルドされる。

- **拡張ホスト**（`src/extension.ts` → `dist/extension.js`, Node/CJS）: Markdown を HTML に変換して webview に送る。
- **webview**（`webview/main.ts` → `dist/webview.js`, ブラウザ/IIFE）: HTML のサニタイズ、mermaid 描画、ハイライト・スクロール同期などの UI。

webview は `src/protocol.ts`（メッセージ型）、`src/render.ts`（`DiagramMeta` 型）、`src/sequence.ts`（`normalizeLabel`）、`src/slug.ts` を import する。これらに `vscode` や Node 依存を持ち込まないこと。

### 変換パイプライン（拡張ホスト側）

1. `PreviewManager`/`Preview`（[src/previewPanel.ts](src/previewPanel.ts)）がドキュメント変更・設定変更を受けて `renderDocument` を呼び、`update` メッセージで HTML を送る。エディタのスクロール・カーソルは `scrollToLine` / `markLine` で送る。
2. [src/render.ts](src/render.ts) の markdown-it プラグインが、見出しに `sn-` 接頭辞付きの一意な id（DOMPurify の DOM clobbering 対策で接頭辞が必要）、各ブロックに `data-line` を付ける。mermaid のフェンスは `<pre>` のまま出力し、図の情報を `data-seqnotes-meta` に JSON で埋め込む（描画は webview 側）。
3. [src/linker.ts](src/linker.ts) の `linkDiagrams` がトークン列からシーケンス図とフローチャート（`DiagramInfo.kind`）を探し、`%% @link-headings` 付きかつトップレベル（level 0）の図だけを横並び対象（`paired`）にする。右カラムの範囲（`<!-- link-headings:end -->`／次の `@link-headings` 付きの図／文書末尾まで）の見出しと、矢印・ノードの文言または `%% @ref` を照合する（フローチャートのノードも `messages` に入る）。解決できない場合は warning を返す。横向き（LR/RL）のフローチャートは `stacked` で、常に縦並びにする（`.seqnotes-pair-stacked`）。
4. `renderDocument` がトークン列をスライスし、`paired` な図を `.seqnotes-pair > .seqnotes-seq-col + .seqnotes-overview-col` で包んで出力する。warning はプレビュー上部に置く。スクロール同期は `data-line` が文書順に並んでいる前提なので、warning には `data-line` ではなく `data-seqnotes-jump` を付ける。

[src/sequence.ts](src/sequence.ts) は mermaid 文法の最小限のパーサで、矢印（メッセージ）の描画順、行番号、`@ref`、`@link-headings` だけを抽出する。[src/flowchart.ts](src/flowchart.ts) はフローチャート版で、ノードの ID・ラベル・行番号、`@ref`、`@link-headings`、方向だけを抽出する。

### webview 側

- `DOMPurify.sanitize` → `mermaid.render`（テーマとソースをキーに SVG をキャッシュ）→ `annotateMessages` の順に処理する。`annotateMessages` は SVG 内のメッセージ要素を、パーサの結果と描画順で対応付ける。数が合わないときだけラベル一致で対応付けるので、`sequence.ts` のメッセージ抽出は mermaid の解釈と件数・順序が一致している必要がある。フローチャートは `annotateNodes` がノード ID（`data-id`、なければ要素 id `<svg id>-flowchart-<ノード ID>-<n>`）で対応付ける。
- 横並びにするかはウィンドウ幅（`mdDesignDoc.splitMinWidth`）で決まり、`body.seqnotes-wide` クラスで切り替える。カラム幅はドラッグで変えられ、`vscode.setState` に保存される。

## テスト

vitest のテストは VS Code API を使わない純粋なモジュール（`sequence.ts`, `flowchart.ts`, `linker.ts`, `render.ts` など）だけを対象にしている。拡張ホストと webview の挙動は F5 で手動確認する。

## その他の注意

- `contributes` の文字列は `package.nls.json` / `package.nls.ja.json` にある。両方を更新すること。
- プレビューや通知に出す文言は英語の原文を `vscode.l10n.t`（`render.ts` / `linker.ts` では引数の `Translate`、[src/l10n.ts](src/l10n.ts)）に通し、日本語訳を `l10n/bundle.l10n.ja.json` に追加すること。webview 側の文言は拡張ホストで翻訳して HTML の data 属性で渡す。
- `.vscodeignore` はホワイトリスト方式。実行時に必要なファイルを増やしたら追記すること。
- 利用者に見える変更は [CHANGELOG.md](CHANGELOG.md) に書く。
- PR は CodeRabbit が日本語でレビューする（`.coderabbit.yaml`）。

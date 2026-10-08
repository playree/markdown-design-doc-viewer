# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ユーザーとの会話は日本語で行うこと。

## ブランチ運用

- `main` で直接作業・コミットしない。ファイルを変更する前に、最新の `main` から `feature/<内容を表す名前>`（例: `feature/seq-notes-marker`）を作成して切り替える。
- `main` への反映は PR 経由で行う（PR は CodeRabbit がレビューする）。
- PR を作る前に、差分をセルフコードレビュー（`/code-review`）し、指摘を反映してから PR を作る。

## 概要

VS Code 拡張「Markdown Sequence Side Notes」。設計書 Markdown 内の mermaid シーケンス図と、その後ろの処理概要（見出し）を横並びでプレビューし、矢印と見出しを相互に紐付ける。記法・挙動の仕様は [README.md](README.md) が正（英語・日本語の両方を同じ内容で保守する）。

## コマンド

パッケージマネージャは pnpm。lint / formatter の設定はない。

```sh
pnpm build        # esbuild で dist/ に extension.js, webview.js, webview.css を出力
pnpm watch        # 監視ビルド
pnpm typecheck    # tsc --noEmit（src, webview, test すべて）
pnpm test         # vitest run
pnpm exec vitest run test/render.test.ts -t 'テスト名の一部'   # 単一テスト
pnpm package      # vsce で .vsix を作成
```

動作確認は VS Code の F5（`.vscode/launch.json` の "Run Extension"）。ビルド後に `examples/` フォルダを開いた拡張開発ホストが起動するので、[examples/login.md](examples/login.md) をプレビューする。

## アーキテクチャ

2 つのバンドルに分かれ、[esbuild.mjs](esbuild.mjs) でそれぞれビルドされる。

- **拡張ホスト**（`src/extension.ts` → `dist/extension.js`, Node/CJS）: Markdown を HTML に変換して webview に送る。
- **webview**（`webview/main.ts` → `dist/webview.js`, ブラウザ/IIFE）: HTML のサニタイズ、mermaid 描画、ハイライト・スクロール同期などの UI。

webview は `src/protocol.ts`（メッセージ型）、`src/render.ts`（`DiagramMeta` 型）、`src/sequence.ts`（`normalizeLabel`）、`src/slug.ts` を import する。これらに `vscode` や Node 依存を持ち込まないこと。

### 変換パイプライン（拡張ホスト側）

1. `PreviewManager`/`Preview`（[src/previewPanel.ts](src/previewPanel.ts)）がドキュメント変更・設定変更を受けて `renderDocument` を呼び、`update` メッセージで HTML を送る。エディタのスクロール・カーソルは `scrollToLine` / `markLine` で送る。
2. [src/render.ts](src/render.ts) の markdown-it プラグインが、見出しに `sn-` 接頭辞付きの一意な id（DOMPurify の DOM clobbering 対策で接頭辞が必要）、各ブロックに `data-line` を付ける。mermaid のフェンスは `<pre>` のまま出力し、図の情報を `data-seqnotes-meta` に JSON で埋め込む（描画は webview 側）。
3. [src/linker.ts](src/linker.ts) の `linkDiagrams` がトークン列からシーケンス図を探し、`%% @seq-notes` 付きかつトップレベル（level 0）の図だけを横並び対象（`paired`）にする。右カラムの範囲（`<!-- seq-notes:end -->`／次の `@seq-notes` 付きの図／文書末尾まで）の見出しと、矢印の文言または `%% @ref` を照合する。解決できない場合は warning を返す。
4. `renderDocument` がトークン列をスライスし、`paired` な図を `.seqnotes-pair > .seqnotes-seq-col + .seqnotes-overview-col` で包んで出力する。warning はプレビュー上部に置く。スクロール同期は `data-line` が文書順に並んでいる前提なので、warning には `data-line` ではなく `data-seqnotes-jump` を付ける。

[src/sequence.ts](src/sequence.ts) は mermaid 文法の最小限のパーサで、矢印（メッセージ）の描画順、行番号、`@ref`、`@seq-notes` だけを抽出する。

### webview 側

- `DOMPurify.sanitize` → `mermaid.render`（テーマとソースをキーに SVG をキャッシュ）→ `annotateMessages` の順に処理する。`annotateMessages` は SVG 内のメッセージ要素を、パーサの結果と描画順で対応付ける。数が合わないときだけラベル一致で対応付けるので、`sequence.ts` のメッセージ抽出は mermaid の解釈と件数・順序が一致している必要がある。
- 横並びにするかはウィンドウ幅（`seqNotes.splitMinWidth`）で決まり、`body.seqnotes-wide` クラスで切り替える。カラム幅はドラッグで変えられ、`vscode.setState` に保存される。

## テスト

vitest のテストは VS Code API を使わない純粋なモジュール（`sequence.ts`, `linker.ts`, `render.ts`）だけを対象にしている。拡張ホストと webview の挙動は F5 で手動確認する。

## その他の注意

- `contributes` の文字列は `package.nls.json` / `package.nls.ja.json` にある。両方を更新すること。
- `.vscodeignore` はホワイトリスト方式。実行時に必要なファイルを増やしたら追記すること。
- 利用者に見える変更は [CHANGELOG.md](CHANGELOG.md) に書く。
- PR は CodeRabbit が日本語でレビューする（`.coderabbit.yaml`）。

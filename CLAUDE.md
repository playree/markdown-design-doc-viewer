# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ブランチ運用

- `main` で直接作業・コミットしない。ファイルを変更する前に、最新の `main` から `feature/<内容を表す名前>`（例: `feature/seq-notes-marker`）を作成して切り替える。
- `main` への反映は PR 経由で行う（PR は CodeRabbit がレビューする）。
- PR を作る前に、差分をセルフコードレビュー（`/code-review`）し、指摘を反映してから PR を作る。

## コミット

- コミットメッセージは変更内容を日本語の 1 行にまとめる（本文は書かない）。
- チケットに対応するときは、末尾にチケット ID を付ける（例: `通知設定の保存に失敗する問題を修正 (MDDV-1)`）。
- コミットと Pull Request には、個人情報（氏名・メールアドレス）や URL を含めない（`Co-Authored-By` などの署名の行も付けない）。

## Pull Request

- 説明は箇条書き程度に簡潔にまとめる。

## 概要

VS Code 拡張「Markdown Design Doc Viewer」（日本語表記: Markdown 設計書ビューア）。設計書 Markdown のビューアで、主な機能として設計書内の mermaid シーケンス図・フローチャートと、その後ろの処理概要（見出し）を横並びでプレビューし、矢印（フローチャートではノード）と見出しを相互に紐付ける。記法・挙動の仕様は [README.md](README.md)（英語）と [README.ja.md](README.ja.md)（日本語）が正（両方を同じ内容で保守する）。CLI の使い方（オプション・終了コードなど）は [docs/cli.md](docs/cli.md) と [docs/cli.ja.md](docs/cli.ja.md) が正で、拡張の README には CLI の短い紹介だけを書く。デスクトップアプリ（`desktop/`、Tauri 2）も同じで、使い方・開発方法は [docs/desktop.md](docs/desktop.md) と [docs/desktop.ja.md](docs/desktop.ja.md) が正。

## コマンド

パッケージマネージャは pnpm。lint / formatter の設定はない。

```sh
pnpm build        # esbuild で dist/ に extension.js, cli.js, webview.js, webview.css, export.js, export.css を出力
pnpm watch        # 監視ビルド
pnpm typecheck    # tsc --noEmit（src, webview, desktop, test, scripts すべて）
pnpm test         # vitest run
pnpm exec vitest run test/render.test.ts -t 'テスト名の一部'   # 単一テスト
pnpm package      # vsce で .vsix を作成
pnpm npm:package  # npm パッケージ（CLI）を .work/npm/ に作る（npm pack / npm publish はそのフォルダに対して行う）
node dist/cli.js export examples -o .work/export   # CLI の HTML エクスポート（ビルド後。npm パッケージの bin `md-design-doc`）
pnpm skill:package # AI 向けの Agent Skill（.work/skill/markdown-design-doc/ と markdown-design-doc-skill.zip）を作る
pnpm desktop:build   # デスクトップアプリの Web 側だけを desktop/dist/ に出力（app.js, app.css, index.html）
pnpm desktop:dev -- -- <絶対パス.md>   # デスクトップアプリをビルドして起動（ファイルは省略可。アプリは desktop/src-tauri で動くので絶対パスで渡す）
pnpm desktop:bundle  # デスクトップアプリのインストーラを desktop/src-tauri/target/release/bundle/ に作る
pnpm desktop:licenses # Rust のクレートのライセンスを desktop/src-tauri/ThirdPartyLicenses.txt に生成（cargo-about。`cargo install cargo-about --version 0.9.2 --locked --features cli` で入る）
pnpm screenshots  # README の画像（images/screenshot*.png、日本語版は *.ja.png）を examples/screenshot.md / screenshot.ja.md から再生成。シーン名・言語（en / ja）を付けるとそれだけ撮る
```

AI 向けの Agent Skill は [scripts/skill-package.mjs](scripts/skill-package.mjs) が [skill/SKILL.md](skill/SKILL.md)（front matter と、ガイドに足す節）の `<!-- include: docs/ai-authoring-guide.md -->` をガイドの本文で置き換え、docs/cli.md を `references/cli.md` にして作る。ガイド・CLI の説明を変えれば Skill も変わるので、Skill 用に二重に書かない。Skill は英語版だけで、日本語の依頼にも対応させる（`description` に日本語のトリガー語を並べ、本文で「ユーザーの言語で書く」と指示する）。`description` は YAML のプレーンスカラーなので `: `・` #`・`<` `>` を含めない（スクリプトが検査する）。

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）は main への push と PR で `typecheck`・`test`・`package` を実行し、.vsix を成果物としてアップロードする。続けて CLI で examples を HTML にエクスポートし（ランナーの Google Chrome を使い、link-checks.md 以外は `--strict` で紐付けの警告を失敗にする）、その HTML と Agent Skill の zip もアップロードする。`build` ジョブではデスクトップアプリの Web 側（`pnpm desktop:build`）もビルドする。Rust とインストーラのビルド（Ubuntu 22.04・macOS の Apple シリコン用と Intel 用・Windows、`cargo clippy -- -D warnings` も実行し、インストーラをアップロードする）は時間がかかるので [.github/workflows/desktop.yml](.github/workflows/desktop.yml) に分け、手動実行（Actions の Run workflow、または `gh workflow run desktop.yml --ref <ブランチ>`）だけにしている。インストーラのビルドの手順（apt パッケージ、pnpm・Node・rustup の準備、MSI を作らない判定など）は再利用できるワークフロー [.github/workflows/desktop-build.yml](.github/workflows/desktop-build.yml)（`workflow_call`）にだけ書き、desktop.yml とリリースの desktop-release.yml はそれを呼ぶ。入力 `release` が true（リリース）のときはキャッシュを使わず、clippy・ライセンスの検査を行わない。desktop-build.yml のサードパーティのアクションは（リリースでも使うので）コミットで固定する。desktop/src-tauri・Tauri の設定・依存を変えたら PR のブランチで実行する。Rust の依存（Cargo.lock）を変えたら `pnpm desktop:licenses` で ThirdPartyLicenses.txt を作り直してコミットする（インストーラに入る。desktop.yml が古くないかを検査する）。

package.json は拡張機能のもので、npm パッケージ（CLI 用）はそこから [scripts/npm-package.mjs](scripts/npm-package.mjs)（`pnpm npm:package`）が `.work/npm/` に作る。npm 用の package.json は npm が使う項目だけにし、`%description%` などのプレースホルダを package.nls.json の英語に置き換える（npm は翻訳しないので）。リポジトリ直下からの `npm publish` は `prepublishOnly` のガードで止める。npm パッケージの README は拡張のものではなく CLI の README（docs/cli.md を README.md に、docs/cli.ja.md を README.ja.md にしてコピーする）で、npm のページと GitHub の両方で同じファイルを表示するのでリンク・画像は絶対 URL で書く。npm に入るのは `scripts/npm-package.mjs` の `FILES` の、vsix に入るのは `.vscodeignore` のホワイトリストのファイルだけ。dist/ に `FILES`（または CLI が使わないものの `DIST_EXCLUDED`）にないファイルがあると `pnpm npm:package` が失敗するので、ビルドの出力を増やしたら両方を見直す。CI でも `pnpm npm:package` を実行する。mermaid などは esbuild でバンドルするので `devDependencies` に置き、CLI が実行時に要る `playwright-core` だけを `dependencies` に置く。

動作確認は VS Code の F5（`.vscode/launch.json` の "Run Extension"）。ビルド後に `examples/` フォルダを開いた拡張開発ホストが起動するので、[examples/login.md](examples/login.md)（基本の紐付け）、[examples/password-reset.md](examples/password-reset.md)（autonumber・アラート・タスクリストなど）、[examples/link-checks.md](examples/link-checks.md)（紐付け漏れの表示と警告）、[examples/flowchart.md](examples/flowchart.md)（フローチャート、横向きの縦並び）、[examples/tables.md](examples/tables.md)（長い表のヘッダ行の固定）、[examples/front-matter.md](examples/front-matter.md)（`type: design_doc` のない front matter の表）をプレビューする。examples は設計書のサンプルなので、先頭の front matter に `type: design_doc` と `product: Example` を書き、`title`（本文の `#` 見出しと同じ文言）・`version`・`status`・`updated` も設定する（front-matter.md だけは表の表示を確かめるため `type` を書かない）。README のスクリーンショットは [examples/screenshot.md](examples/screenshot.md)（機能ごとの節に分けた撮影用サンプル）から `pnpm screenshots`（[scripts/screenshots.ts](scripts/screenshots.ts)）で撮る。README.ja.md 用の日本語版は、同じ構成で訳した [examples/screenshot.ja.md](examples/screenshot.ja.md) から `*.ja.png` に撮る（片方を変えたらもう片方も同じように変える）。この 2 つは GitHub Pages のサンプル（後述のリリース）も兼ねるので、紐付けの警告が出ないように保つ（`--strict` でエクスポートする）。webview を VS Code のライトテーマと各言語の文言（日本語は `l10n/bundle.l10n.ja.json`）を再現したページに載せ、headless Chrome（`playwright-core`）で撮影する。Chrome は `CHROME_PATH`、なければ Playwright のキャッシュ（Chromium または headless shell）から探す（`pnpm exec playwright-core install chromium` で入る）。日本語版には日本語フォント（Noto Sans CJK JP）が要る。撮る範囲・ハイライトする項目は `SCENES`（シーケンス図・フローチャート・紐付け漏れ・設計書の記法・設計書のヘッダ）、言語ごとの撮影元と探す見出しは `LOCALES` で定義する。mermaid のノードのラベルは幅 120px で折り返すので、日本語のラベルは 7 文字程度までにする。プレビューの見た目を変えたら撮り直す。

デスクトップアプリは `pnpm desktop:dev` で動かして確かめる（画面のある環境で行う）。Rust（rustup の stable）のほか、Windows では Visual Studio Build Tools（C++ によるデスクトップ開発）と WebView2、Linux では webkit2gtk-4.1 など（[docs/desktop.ja.md](docs/desktop.ja.md)）が要る。環境変数 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` を付けて起動すると、Windows では CDP（`playwright-core` の `chromium.connectOverCDP`）で DOM を調べたりスクリーンショットを撮ったりできる。

## リリース

拡張機能（VS Code Marketplace）と CLI（npm パッケージ `markdown-design-doc-viewer`）は同じバージョン（package.json の `version`）・同じ GitHub Release（タグ `vX.Y.Z`）で出す。デスクトップアプリは別のバージョン（tauri.conf.json の `version`）・別の Release（タグ `desktop-vX.Y.Z`）で出す（後述）。

### 拡張機能・CLI

1. package.json の `version` を上げ、CHANGELOG.md の `Unreleased` をそのバージョンにして、PR で main に入れる。
2. main から GitHub Release（タグ `vX.Y.Z`）を作る。[.github/workflows/release.yml](.github/workflows/release.yml) が npm に公開する。
   - 公開の前に次を確かめる: タグのコミットが main にあること、タグと `version` が一致すること。
   - 公開する tarball を別のフォルダにインストールし、CLI でエクスポートできることも確かめる。
   - npm の Trusted Publishing（OIDC、トークンなし、provenance 付き）で公開する。プレリリース（`-rc.1` など）は dist-tag `next` で出す。
   - そのバージョンが npm にすでにあれば公開を飛ばす。
   - 続けて Agent Skill の zip（`markdown-design-doc-skill.zip`）を Release に添付する。README は `releases/latest/download/` の固定 URL でリンクしているので、ファイル名を変えない。
   - 同じ Release で [.github/workflows/pages.yml](.github/workflows/pages.yml) が examples/screenshot.md（英語、`/`）と screenshot.ja.md（日本語、`/ja/`）を CLI でエクスポートし、GitHub Pages（https://playree.github.io/markdown-design-doc-viewer/）にサンプルとして公開する。プレリリースでは更新しない。main からの手動実行（workflow_dispatch）でも更新できる。Pages の Source は「GitHub Actions」で、環境 `github-pages` に main とタグ `v*` からのデプロイを許可してある。
3. Marketplace には、Marketplace の管理画面（https://marketplace.visualstudio.com/manage/publishers/playree ）から .vsix をアップロードして公開する（`vsce publish` と PAT は使わない）。
   - .vsix は、タグを checkout した変更のない作業ツリーで `pnpm package` を実行して作る（npm と同じコミットにするため。例: `git worktree add --detach .work/release vX.Y.Z` → `pnpm install --frozen-lockfile` → `pnpm package`）。
   - Marketplace が Trusted Publishing（`vsce publish --oidc`）に対応したら、release.yml に公開のジョブを足して CI から公開するように切り替える。

npm の Trusted Publisher は npmjs.com のパッケージ設定に登録する（GitHub Actions、`playree/markdown-design-doc-viewer`、ワークフロー `release.yml`）。パッケージが npm にないと登録できないので、初回だけは手元から公開してから登録した（手元から公開するときは `pnpm npm:package` → `npm publish .work/npm`）。ワークフローのファイル名を変えると公開できなくなるので、変えるなら登録も直す。

`publish` は npm のライフサイクルスクリプト名（`npm publish` の後に実行される）なので、スクリプトに `publish` という名前を付けないこと。

### デスクトップアプリ

1. desktop/src-tauri/tauri.conf.json の `version` を上げ、[desktop/CHANGELOG.md](desktop/CHANGELOG.md) の `Unreleased` をそのバージョンにして、PR で main に入れる（Cargo.toml の version は使わないので 0.0.0 のまま）。Release を作る前に、main で desktop.yml を手動実行して、3 つの OS でビルドできることを確かめる（リリースと同じ desktop-build.yml でビルドする）。
2. main から GitHub Release（タグ `desktop-vX.Y.Z`、タイトルは「Desktop app X.Y.Z」）を作る。「Set as latest release」は外す（README などは `releases/latest` で拡張の Release を指し、Agent Skill の zip もそこからダウンロードさせているため）。[.github/workflows/desktop-release.yml](.github/workflows/desktop-release.yml) が次を行う。release.yml・pages.yml はこのタグでは動かない。
   - タグのコミットが main にあること、タグと tauri.conf.json の `version` が一致することを確かめる。
   - その Release が Latest になっていたら、拡張の Release（タグ `vX.Y.Z`、プレリリースを除く）のうちバージョンが最も大きいものを Latest に戻す（上の確認が失敗しても行う）。
   - インストーラ（Windows の .msi と NSIS の .exe、macOS の Apple シリコン用と Intel 用の .dmg、Linux の .deb・.rpm・.AppImage）を各 OS でビルドし、Release に添付する。署名はまだしていない。ビルド（desktop-build.yml を `release: true` で呼ぶ。ほかのワークフローが書いたキャッシュを使わない）は依存のコードを実行するので読み取りの権限だけで行い、成果物を受け取った別のジョブ（`upload`、checkout も依存のインストールもしない）が書き込みの権限で添付する。MSI は英字を含むプレリリースのバージョン（`-rc.1` など）を作れないので、そのときの Windows は NSIS だけにする（desktop-build.yml で判定するので desktop.yml も同じ）。

README・docs/desktop.md はデスクトップの Release の一覧（`releases?q=desktop-v`）にリンクしている。タグの形を変えるならリンクも直す。

## アーキテクチャ

3 つのバンドルに分かれ、[esbuild.mjs](esbuild.mjs) でそれぞれビルドされる。デスクトップアプリ（4 つ目）は `--desktop` のときだけ、それだけをビルドする。

- **拡張ホスト**（`src/extension.ts` → `dist/extension.js`, Node/CJS）: Markdown を HTML に変換して webview に送る。
- **webview**（`webview/main.ts` → `dist/webview.js`, ブラウザ/IIFE）: HTML のサニタイズ、mermaid 描画、ハイライト・スクロール同期などの UI。エクスポートした HTML に埋め込むスクリプトは `webview/export.ts` → `dist/export.js`。
- **CLI**（`src/cli.ts` → `dist/cli.js`, Node/CJS）: HTML エクスポートのコマンドライン版。`vscode` を external にしていないので、vscode に依存するモジュールを import するとビルドが失敗する。
- **デスクトップアプリ**（`desktop/main.ts` → `desktop/dist/app.js`, ブラウザ/IIFE。Tauri 2）: 拡張の webview（`webview/main.ts`）をそのまま載せる。[desktop/vscodeShim.ts](desktop/vscodeShim.ts) が `acquireVsCodeApi` のスタブ（state は localStorage）と翻訳した body の data 属性を用意し、[desktop/host.ts](desktop/host.ts) が拡張ホストの代わりに `renderDocument` で HTML にして `update` を送る（設定は拡張の既定値、`syncEditor` は false、`theme` は常に `auto` で、配色は body の `vscode-light` / `vscode-dark` クラスで切り替え、[desktop/theme.css](desktop/theme.css) がその変数を定義する）。メニュー・D&D・開くダイアログも host.ts。パスの処理は [desktop/paths.ts](desktop/paths.ts)（Windows のパスも扱う純粋なモジュール）。Rust 側（[desktop/src-tauri/src/lib.rs](desktop/src-tauri/src/lib.rs)）は薄い層で、ファイルの読み込み（`open_document`）、親フォルダの監視（`document-changed`、rename で保存するエディタにも追従）、画像の asset スコープへの追加（`allow_images`、画像ファイルだけ）、リンクを開く処理（`open_url` は http/https/mailto だけ、`open_path` は文書・画像などだけ既定のアプリで開き、ほかはフォルダで表示）だけを行う。webview には fs・opener の権限を与えない（capabilities/default.json）。ビルドの出力は `desktop/dist/` で、`dist/` には出さない（vsix・npm パッケージに影響させないため）。

HTML エクスポートは、vscode 非依存の共通部分（画像の解決、タイトル、ページの組み立て）が [src/exportPage.ts](src/exportPage.ts) にあり、VS Code のコマンド（[src/exportHtml.ts](src/exportHtml.ts)）と CLI が使う。図の描画はどちらも webview の `exportBody`（`export` メッセージ）で、VS Code ではプレビューの webview、CLI では [src/headless.ts](src/headless.ts) がヘッドレス Chrome に `dist/webview.js` を載せて行う（`pnpm screenshots` も同じ Chrome の探し方を使う）。

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
- 利用者に見える変更は [CHANGELOG.md](CHANGELOG.md) に書く。デスクトップアプリだけの変更は [desktop/CHANGELOG.md](desktop/CHANGELOG.md) に書く（拡張とデスクトップアプリの両方に効く変更は両方に書く）。
- PR は CodeRabbit が日本語でレビューする（`.coderabbit.yaml`）。

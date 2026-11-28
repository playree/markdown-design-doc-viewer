# AGENTS.md

このリポジトリで作業する AI コーディングエージェント（Claude Code・Codex など）への指示。CLAUDE.md はこのファイルを取り込む（`@AGENTS.md`）だけなので、指示はこのファイルに書く。このファイルには作業全体に必要な規約を置き、Codex の既定の読み込み上限（32 KiB）以内に保つ。

## ブランチ運用

- `main` で直接作業・コミットしない。ファイルを変更する前に、最新の `main` から作業ブランチを作成して切り替える。Devuntu のチケットに対応するときは `feature/MDDV-<番号>`（例 `feature/MDDV-1`）、それ以外は `feature/<内容を表す名前>`（例 `feature/seq-notes-marker`）にする。
- `main` への反映は PR 経由で行う（PR は CodeRabbit がレビューする）。
- PR を作る前に、差分をセルフコードレビュー（Claude Code は `/code-review`、Codex は `/review` または `codex review --base main`）し、指摘を反映してから PR を作る。

## コミット

- コミットメッセージは変更内容を日本語の 1 行にまとめる（本文は書かない）。
- チケットに対応するときは、末尾にチケット ID を付ける（例: `通知設定の保存に失敗する問題を修正 (MDDV-1)`）。
- コミットと Pull Request には、個人情報（氏名・メールアドレス）や URL を含めない（`Co-Authored-By` などの署名の行も付けない）。

## Pull Request

- 説明は箇条書き程度に簡潔にまとめる。

## 概要

VS Code 拡張「Markdown Design Doc Viewer」（日本語表記: Markdown 設計書ビューア）。設計書 Markdown のビューアで、主な機能として設計書内の mermaid シーケンス図・フローチャートと、その後ろの処理概要（見出し）を横並びでプレビューし、矢印（フローチャートではノード）と見出しを相互に紐付ける。記法・挙動の仕様は [README.md](README.md)（英語）と [README.ja.md](README.ja.md)（日本語）が正（両方を同じ内容で保守する）。CLI の使い方（オプション・終了コードなど）は [docs/cli.md](docs/cli.md) と [docs/cli.ja.md](docs/cli.ja.md) が正で、拡張の README には CLI の短い紹介だけを書く。デスクトップアプリ（`desktop/`、Tauri 2）も同じで、使い方・開発方法は [docs/desktop.md](docs/desktop.md) と [docs/desktop.ja.md](docs/desktop.ja.md) が正。埋め込みのビューア（`embed/`、npm パッケージ `markdown-design-doc-viewer-embed`）の使い方は [docs/embed.md](docs/embed.md) と [docs/embed.ja.md](docs/embed.ja.md) が正（パッケージの README になる）。

## 開発時に参照する資料

- 実装を変更する前に、[アーキテクチャ](docs/architecture.md) の該当箇所で担当領域の構成と実装上の規約を確認する。
- バージョン更新や公開に関わる作業では、[リリース手順](docs/releasing.md) を確認する。

## コマンド

パッケージマネージャは pnpm。lint / formatter の設定はない。

```sh
pnpm build        # esbuild で dist/ に extension.js, cli.js, webview.js, webview.css, export.js, export.css と Agent Skill（dist/skill/）を出力
pnpm watch        # 監視ビルド
pnpm typecheck    # tsc --noEmit（src, webview, desktop, test, scripts すべて）
pnpm test         # vitest run
pnpm exec vitest run test/render.test.ts -t 'テスト名の一部'   # 単一テスト
pnpm package      # vsce で .vsix を作成
pnpm npm:package  # npm パッケージ（CLI）を .work/npm/ に作る（npm pack / npm publish はそのフォルダに対して行う）
pnpm npm:embed-package # 埋め込みのビューアの npm パッケージを .work/npm-embed/ に作る（embed/dist/ にビルドし、型を出し、Node で import できるかも検査する）
node dist/cli.js export examples -o .work/export   # CLI の HTML エクスポート（ビルド後。npm パッケージの bin `md-design-doc`）
pnpm skill:package # AI 向けの Agent Skill（.work/skill/markdown-design-doc/ と markdown-design-doc-skill.zip）を作る
pnpm skill:bump    # Agent Skill の内容が変わっていれば skill/revision.json の revision を上げる
pnpm pages        # GitHub Pages のサイトを .work/site/ に作る（ビルド後。ランディングページ site/ と images/ の画像、examples/screenshot*.md のエクスポート）
pnpm desktop:build   # デスクトップアプリの Web 側だけを desktop/dist/ に出力（app.js, app.css, index.html）
pnpm desktop:dev -- -- <絶対パス.md>   # デスクトップアプリをビルドして起動（ファイルは省略可。アプリは desktop/src-tauri で動くので絶対パスで渡す）
pnpm desktop:bundle  # デスクトップアプリのインストーラを desktop/src-tauri/target/release/bundle/ に作る
pnpm notices      # バンドルした npm パッケージのライセンスを ThirdPartyNotices.txt に生成（esbuild の metafile から集める）
pnpm desktop:licenses # Rust のクレートのライセンスを desktop/src-tauri/ThirdPartyLicenses.txt に生成（cargo-about。`cargo install cargo-about --version 0.9.2 --locked --features cli` で入る）
pnpm embed:demo   # 埋め込みのビューアのデモ（React のページに 2 つのビューア。HTML の書き出しも）を .work/embed-demo/ に作る（--serve を付けると http://127.0.0.1:8000/ で配信、--package を付けるとソースではなく .work/npm-embed のパッケージを使う）
pnpm screenshots  # README の画像（images/screenshot*.png とアニメーションの images/demo.gif、日本語版は *.ja.png / *.ja.gif）を examples/screenshot.md / screenshot.ja.md から再生成。シーン名・言語（en / ja）を付けるとそれだけ撮る
```

AI 向けの Agent Skill は [scripts/skill-files.mjs](scripts/skill-files.mjs) が [skill/SKILL.md](skill/SKILL.md)（front matter と、ガイドに足す節）の `<!-- include: docs/ai-authoring-guide.md -->` をガイドの本文で置き換え、docs/cli.md を `references/cli.md` にして作る。[scripts/skill-package.mjs](scripts/skill-package.mjs)（`pnpm skill:package`）が Release に添付する zip に、esbuild.mjs が拡張に入れる `dist/skill/markdown-design-doc/` に書き出す（watch では開始時だけ）。拡張では、package.json の `contributes.chatSkills` で Copilot に登録し、コマンド `mdDesignDoc.installAgentSkill`（[src/extension/skillInstall.ts](src/extension/skillInstall.ts)）で Claude Code などのスキルのフォルダにコピーする。コピーした場所・ファイル・内容のハッシュ（改行は LF にそろえる）・拡張のバージョンは globalState にコピーごとのキーで記録し、拡張の Skill が新しくなったら、変更されていないコピーの更新を拡張の有効化時（Markdown を開いたときなど）に 1 回だけ案内する（プロジェクトのコピーはそのフォルダを開いたウィンドウだけで、新しいバージョンの拡張が書いたコピーは案内しない。判定は [src/extension/skillInstallState.ts](src/extension/skillInstallState.ts)）。dist/skill/ は CLI が使わないので npm パッケージには入れない（`DIST_EXCLUDED`）。埋め込みのビューアの npm パッケージには、オフラインで配布するアプリ（MCP サーバーなど）のために `./skill`（`skill.js` の `agentSkill = { name, revision, files }` と型。scripts/npm-embed-package.mjs が書き出す）として入れる。ガイド・CLI の説明を変えれば Skill も変わるので、Skill 用に二重に書かない。Skill の SKILL.md の front matter には連番の `metadata.revision`（[skill/revision.json](skill/revision.json) の値）を入れ、拡張・zip・埋め込みのビューアの npm パッケージなど、どの経路で入れたコピーでも新旧を比べられるようにしている。revision.json には revision を入れる前の Skill のファイルのハッシュも持ち、Skill の内容（docs/ai-authoring-guide.md・docs/cli.md・skill/SKILL.md）が変わったのに revision を上げていなければ `pnpm test`（test/skillRevision.test.ts）と `pnpm skill:package` が失敗する（build は警告だけ）ので、その PR で `pnpm skill:bump` を実行してコミットする（並行する PR が両方上げると revision.json が競合するので、後からマージする方で bump し直す）。拡張は、記録したコピーのほか、記録のない `~/.claude/skills` とワークスペースのフォルダの `.claude/skills` のコピーも revision で比べ、古ければ同梱の revision ごとに 1 回だけ更新を案内する（変更の有無が分からないので確認してから上書きする。案内した revision は globalState の `agentSkillOffer:` に記録）。revision が同梱より大きいコピーは案内せず、コマンドでも確認してから上書きする。Skill は英語版だけで、日本語の依頼にも対応させる（`description` に日本語のトリガー語を並べ、本文で「ユーザーの言語で書く」と指示する）。`description` は YAML のプレーンスカラーなので `: `・` #`・`<` `>` を含めない（スクリプトが検査する）。

CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）は main への push と PR で `typecheck`・`test`・`package` を実行し、.vsix を成果物としてアップロードする。ThirdPartyNotices.txt が古くないか（`pnpm notices` で差分が出ないか）も検査する。続けて CLI で examples を HTML にエクスポートし（ランナーの Google Chrome を使い、link-checks.md 以外は `--strict` で紐付けの警告を失敗にする）、その HTML と Agent Skill の zip、埋め込みのビューアの npm パッケージの tarball もアップロードする。`build` ジョブではデスクトップアプリの Web 側（`pnpm desktop:build`）もビルドする。Rust とインストーラのビルド（Ubuntu 22.04・macOS の Apple シリコン用と Intel 用・Windows、`cargo clippy -- -D warnings` も実行し、インストーラをアップロードする）は時間がかかるので [.github/workflows/desktop.yml](.github/workflows/desktop.yml) に分け、手動実行（Actions の Run workflow、または `gh workflow run desktop.yml --ref <ブランチ>`）だけにしている。インストーラのビルドの手順（apt パッケージ、pnpm・Node・rustup の準備、MSI を作らない判定など）は再利用できるワークフロー [.github/workflows/desktop-build.yml](.github/workflows/desktop-build.yml)（`workflow_call`）にだけ書き、desktop.yml とリリースの desktop-release.yml はそれを呼ぶ。入力 `release` が true（リリース）のときはキャッシュを使わず、clippy・ライセンスの検査を行わない。desktop-build.yml のサードパーティのアクションは（リリースでも使うので）コミットで固定する。desktop/src-tauri・Tauri の設定・依存を変えたら PR のブランチで実行する。Rust の依存（Cargo.lock）を変えたら `pnpm desktop:licenses` で ThirdPartyLicenses.txt を作り直してコミットする（インストーラに入る。desktop.yml が古くないかを検査する）。

GitHub の Security and quality は通知を受けるためだけに使う（確認して手で直す）。有効なのは Secret scanning（push protection 付き）、Dependabot アラート（pnpm-lock.yaml・Cargo.lock・Actions）、CodeQL の既定の設定（default setup。actions・JavaScript/TypeScript・Rust を PR・main への push・週 1 回で解析）、非公開の脆弱性報告（[SECURITY.md](SECURITY.md) で案内）。Dependabot のセキュリティ更新・バージョン更新の PR と Copilot Autofix は使わないので、`.github/dependabot.yml` と CodeQL のワークフローは置かない。アラートを直すために依存を上げたら、`pnpm notices`（Cargo.lock なら `pnpm desktop:licenses`）でライセンスのファイルも作り直す。

package.json は拡張機能のもので、npm パッケージ（CLI 用）はそこから [scripts/npm-package.mjs](scripts/npm-package.mjs)（`pnpm npm:package`）が `.work/npm/` に作る。npm 用の package.json は npm が使う項目だけにし、`%description%` などのプレースホルダを package.nls.json の英語に置き換える（npm は翻訳しないので）。リポジトリ直下からの `npm publish` は `prepublishOnly` のガードで止める。npm パッケージの README は拡張のものではなく CLI の README（docs/cli.md を README.md に、docs/cli.ja.md を README.ja.md にしてコピーする）で、npm のページと GitHub の両方で同じファイルを表示するのでリンク・画像は絶対 URL で書く。npm に入るのは `scripts/npm-package.mjs` の `FILES` の、vsix に入るのは `.vscodeignore` のホワイトリストのファイルだけ。dist/ に `FILES`（または CLI が使わないものの `DIST_EXCLUDED`）にないファイルがあると `pnpm npm:package` が失敗するので、ビルドの出力を増やしたら両方を見直す（[scripts/third-party-notices.mjs](scripts/third-party-notices.mjs) の `ARTIFACTS` も。どの配布物にも割り当てていない出力に npm パッケージが入っていると失敗する）。CI でも `pnpm npm:package` を実行する。mermaid などは esbuild でバンドルするので `devDependencies` に置き、CLI が実行時に要る `playwright-core` だけを `dependencies` に置く。

バンドルした npm パッケージのライセンスは ThirdPartyNotices.txt にあり、vsix・npm パッケージ（CLI と埋め込みのビューア）・デスクトップアプリのインストーラ（tauri.conf.json の `bundle.resources`）に入る。このファイルは手で書かず、[scripts/third-party-notices.mjs](scripts/third-party-notices.mjs)（`pnpm notices`）が esbuild.mjs と同じ設定（[scripts/build-options.mjs](scripts/build-options.mjs) の `buildOptions`）で各バンドルを書き出さずにビルドし、metafile で出力に入ったパッケージの LICENSE・NOTICE などから作る（同じ本文はまとめ、どの配布物に入るかも書く）。依存（pnpm-lock.yaml）やバンドルを変えたら `pnpm notices` で作り直してコミットする（CI が古くないかを検査する）。npm 以外の素材（Octicons など）は [scripts/third-party-notices.extra.txt](scripts/third-party-notices.extra.txt) に書く。ライセンスの本文を含まないパッケージがあると失敗するので、同じプロジェクトのパッケージから取る（スクリプトの `LICENSE_FROM`）。

GitHub Pages のランディングページは [site/](site/) の手書きの静的ページ（`index.html` が英語、`ja/index.html` が日本語、共通の `style.css`。外部のスクリプト・フォントは使わない）。英語と日本語を同じ内容で保守し、文言は README から取る（仕様は README が正）。README の機能・入手方法やスクリーンショットを変えたら合わせて直す。画像は持たず、[scripts/pages.mjs](scripts/pages.mjs) が images/ からアイコンとスクリーンショット・アニメーションをコピーする（`<img>` の `width`・`height` が PNG・GIF の大きさと違うと失敗するので、撮り直したら直す）。編集中は VS Code の拡張 Live Server で `site/index.html` を開くと、変更に追従して表示できる（[.vscode/settings.json](.vscode/settings.json) でルートを site/ にし、images/ と `.work/site` のサンプルを割り当てている。サンプルは `pnpm pages` の後に表示される）。CI でも `pnpm pages` を実行してサイトを作れることを確かめ、成果物 `site` としてアップロードする（公開は Release のときだけなので、マージ前の確認はこれをダウンロードして行う）。

動作確認は VS Code の F5（`.vscode/launch.json` の "Run Extension"）。ビルド後に `examples/` フォルダを開いた拡張開発ホストが起動するので、[examples/login.md](examples/login.md)（基本の紐付け）、[examples/password-reset.md](examples/password-reset.md)（autonumber・アラート・タスクリストなど）、[examples/split-sequence.md](examples/split-sequence.md)（長いシーケンスを分けた図の間のノートのジャンプ）、[examples/link-checks.md](examples/link-checks.md)（紐付け漏れの表示と警告）、[examples/flowchart.md](examples/flowchart.md)（フローチャート、横向きの縦並び）、[examples/er-diagram.md](examples/er-diagram.md)（ER 図のエンティティの紐付け）、[examples/state-diagram.md](examples/state-diagram.md)（状態遷移図の状態・複合状態の紐付け、横向きの縦並び）、[examples/tables.md](examples/tables.md)（長い表のヘッダ行の固定、項目の表のオプション）、[examples/message-definition.ja.md](examples/message-definition.ja.md)（日本語の電文定義。項目の表のオプション）、[examples/front-matter.md](examples/front-matter.md)（`type: design_doc` のない front matter の表）、[examples/wireframe.md](examples/wireframe.md)（ワイヤーフレーム（examples/screens/ の HTML）のパーツと項目の表・見出しの紐付け）をプレビューする。examples は設計書のサンプルなので、先頭の front matter に `type: design_doc` と `product: Example` を書き、`title`（本文の `#` 見出しと同じ文言）・`version`・`status`・`updated` も設定する（front-matter.md だけは表の表示を確かめるため `type` を書かない）。README のスクリーンショットは [examples/screenshot.md](examples/screenshot.md)（機能ごとの節に分けた撮影用サンプル）から `pnpm screenshots`（[scripts/screenshots.ts](scripts/screenshots.ts)）で撮る。README.ja.md 用の日本語版は、同じ構成で訳した [examples/screenshot.ja.md](examples/screenshot.ja.md) から `*.ja.png`（アニメーションは `*.ja.gif`）に撮る（片方を変えたらもう片方も同じように変える）。この 2 つは GitHub Pages のサンプル（[リリース手順](docs/releasing.md)）も兼ねるので、紐付けの警告が出ないように保つ（`--strict` でエクスポートする）。webview を VS Code のライトテーマと各言語の文言（日本語は `l10n/bundle.l10n.ja.json`）を再現したページに載せ、headless Chrome（`playwright-core`）で撮影する。Chrome は `CHROME_PATH`、なければ Playwright のキャッシュ（Chromium または headless shell）から探す（`pnpm exec playwright-core install chromium` で入る）。日本語版には日本語フォント（Noto Sans CJK JP）が要る。撮る範囲・ハイライトする項目は `SCENES`（シーケンス図・フローチャート・紐付け漏れ・設計書の記法・項目の表・ワイヤーフレーム・ノートによる遷移・設計書のヘッダ）、言語ごとの撮影元と探す見出しは `LOCALES` で定義する。README の先頭とランディングページの hero の GIF は `ANIMATIONS` の `demo` で、実際のマウス操作（矢印へのホバー・クリック、見出しへのホバー）を、ページに描いたポインタとともにフレームごとに撮り、gifenc で 1 つのパレットの GIF にする（npm の README（docs/cli.md・cli.ja.md）も同じ GIF を絶対 URL で表示する。og:image は静止画の screenshot.png のまま）。mermaid のノードのラベルは幅 120px で折り返すので、日本語のラベルは 7 文字程度までにする。プレビューの見た目を変えたら撮り直す。

デスクトップアプリは `pnpm desktop:dev` で動かして確かめる（画面のある環境で行う）。Rust（rustup の stable）のほか、Windows では Visual Studio Build Tools（C++ によるデスクトップ開発）と WebView2、Linux では webkit2gtk-4.1 など（[docs/desktop.ja.md](docs/desktop.ja.md)）が要る。環境変数 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` を付けて起動すると、Windows では CDP（`playwright-core` の `chromium.connectOverCDP`）で DOM を調べたりスクリーンショットを撮ったりできる。

## テスト

vitest のテストは VS Code API を使わない純粋なモジュール（`sequence.ts`, `flowchart.ts`, `erDiagram.ts`, `stateDiagram.ts`, `linker.ts`, `render.ts` など）だけを対象にしている（`gitCli.ts` のテストは一時フォルダのリポジトリで git を実行する）。拡張ホストと webview の挙動は F5 で手動確認する。

## その他の注意

- `contributes` の文字列は `package.nls.json` / `package.nls.ja.json` にある。両方を更新すること。
- プレビューや通知に出す文言は英語の原文を `vscode.l10n.t`（`render.ts` / `linker.ts` では引数の `Translate`、[src/shared/l10n.ts](src/shared/l10n.ts)）に通し、日本語訳を `l10n/bundle.l10n.ja.json` に追加すること。webview 側の文言は拡張ホストで翻訳して HTML の data 属性で渡す。
- `.vscodeignore` はホワイトリスト方式。実行時に必要なファイルを増やしたら追記すること。
- 利用者に見える変更は [CHANGELOG.md](CHANGELOG.md) に書く。デスクトップアプリだけの変更は [desktop/CHANGELOG.md](desktop/CHANGELOG.md) に書く（拡張とデスクトップアプリの両方に効く変更は両方に書く）。
- PR は CodeRabbit が日本語でレビューする（`.coderabbit.yaml`）。

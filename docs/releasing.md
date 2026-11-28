# リリース手順

拡張機能（VS Code Marketplace）と CLI（npm パッケージ `markdown-design-doc-viewer`）、埋め込みのビューア（npm パッケージ `markdown-design-doc-viewer-embed`）は同じバージョン（package.json の `version`）・同じ GitHub Release（タグ `vX.Y.Z`）で出す。デスクトップアプリは別のバージョン（tauri.conf.json の `version`）・別の Release（タグ `desktop-vX.Y.Z`）で出す（後述）。

## 拡張機能・CLI・埋め込みのビューア

1. package.json の `version` を上げ、CHANGELOG.md の `Unreleased` をそのバージョンにして、PR で main に入れる。
2. main から GitHub Release（タグ `vX.Y.Z`）を作る。[.github/workflows/release.yml](../.github/workflows/release.yml) が 2 つの npm パッケージを公開する（CLI は `npm` ジョブ、埋め込みのビューアは `npm-embed` ジョブが検査して tarball を作り、`npm-publish`・`npm-embed-publish` ジョブがそれを公開する。依存のコードを実行するジョブに OIDC トークンを要求させないよう、`id-token: write` は checkout も依存のインストールもしない公開のジョブだけに付ける）。
   - 公開の前に次を確かめる: タグのコミットが main にあること、タグと `version` が一致すること。
   - 公開する tarball を別のフォルダにインストールし、CLI でエクスポートできること（埋め込みのビューアは peer の mermaid・React と一緒にインストールして Node で import できること）も確かめる。
   - npm の Trusted Publishing（OIDC、トークンなし、provenance 付き）で公開する。プレリリース（`-rc.1` など）は dist-tag `next` で出す。
   - そのバージョンが npm にすでにあれば公開を飛ばす。
   - 続けて Agent Skill の zip（`markdown-design-doc-skill.zip`）を Release に添付する。README は `releases/latest/download/` の固定 URL でリンクしているので、ファイル名を変えない。
   - 同じ Release で [.github/workflows/pages.yml](../.github/workflows/pages.yml) が `pnpm pages` でサイトを作り、GitHub Pages（https://playree.github.io/markdown-design-doc-viewer/）に公開する。`/`（英語）と `/ja/`（日本語）は紹介用のランディングページ、`/sample/` と `/ja/sample/` は examples/screenshot.md と screenshot.ja.md を CLI でエクスポートしたサンプル。プレリリースでは更新しない。main からの手動実行（workflow_dispatch）でも更新できる。Pages の Source は「GitHub Actions」で、環境 `github-pages` に main とタグ `v*` からのデプロイを許可してある。
3. Marketplace には、Marketplace の管理画面（https://marketplace.visualstudio.com/manage/publishers/playree ）から .vsix をアップロードして公開する（`vsce publish` と PAT は使わない）。
   - .vsix は、タグを checkout した変更のない作業ツリーで `pnpm package` を実行して作る（npm と同じコミットにするため。例: `git worktree add --detach .work/release vX.Y.Z` → `cd .work/release` → `pnpm install --frozen-lockfile` → `pnpm package`）。
   - Marketplace が Trusted Publishing（`vsce publish --oidc`）に対応したら、release.yml に公開のジョブを足して CI から公開するように切り替える。

npm の Trusted Publisher は npmjs.com のパッケージ設定に登録する（GitHub Actions、`playree/markdown-design-doc-viewer`、ワークフロー `release.yml`）。パッケージが npm にないと登録できないので、初回だけは手元から公開してから登録した（手元から公開するときは `pnpm npm:package` → `npm publish .work/npm`）。埋め込みのビューアも同じで、初めて出すリリースでは、version を上げたコミット（main）で `pnpm npm:embed-package` → `npm publish .work/npm-embed`（プレリリースなら `--tag next` を付ける）を手元から行い、Trusted Publisher を登録してから Release を作る（`npm-embed` ジョブは既にあるバージョンを飛ばす）。ワークフローのファイル名を変えると公開できなくなるので、変えるなら登録も直す。

`publish` は npm のライフサイクルスクリプト名（`npm publish` の後に実行される）なので、スクリプトに `publish` という名前を付けないこと。

## デスクトップアプリ

1. desktop/src-tauri/tauri.conf.json の `version` を上げ、[desktop/CHANGELOG.md](../desktop/CHANGELOG.md) の `Unreleased` をそのバージョンにして、PR で main に入れる（Cargo.toml の version は使わないので 0.0.0 のまま）。Release を作る前に、main で desktop.yml を手動実行して、3 つの OS でビルドできることを確かめる（リリースと同じ desktop-build.yml でビルドする）。
2. main から GitHub Release（タグ `desktop-vX.Y.Z`、タイトルは「Desktop app X.Y.Z」）を作る。「Set as latest release」は外す（README などは `releases/latest` で拡張の Release を指し、Agent Skill の zip もそこからダウンロードさせているため）。[.github/workflows/desktop-release.yml](../.github/workflows/desktop-release.yml) が次を行う。release.yml・pages.yml はこのタグでは動かない。
   - タグのコミットが main にあること、タグと tauri.conf.json の `version` が一致することを確かめる。
   - その Release が Latest になっていたら、拡張の Release（タグ `vX.Y.Z`、プレリリースを除く）のうちバージョンが最も大きいものを Latest に戻す（上の確認が失敗しても行う）。
   - インストーラ（Windows の .msi と NSIS の .exe、macOS の Apple シリコン用と Intel 用の .dmg、Linux の .deb・.rpm・.AppImage）を各 OS でビルドし、Release に添付する。署名はまだしていない。ビルド（desktop-build.yml を `release: true` で呼ぶ。ほかのワークフローが書いたキャッシュを使わない）は依存のコードを実行するので読み取りの権限だけで行い、成果物を受け取った別のジョブ（`upload`、checkout も依存のインストールもしない）が書き込みの権限で添付する。MSI は英字を含むプレリリースのバージョン（`-rc.1` など）を作れないので、そのときの Windows は NSIS だけにする（desktop-build.yml で判定するので desktop.yml も同じ）。

README・docs/desktop.md・ランディングページ（site/）はデスクトップの Release の一覧（`releases?q=desktop`）にリンクしている。`q=desktop-v` では Release の検索に何も出ない（`desktop-` や `desktop-v0` なら出る）ので使わない。ノートも検索するので、拡張の Release のノートに desktop という語があるとそれも一覧に出る。タグの形を変えるならリンクも直す。

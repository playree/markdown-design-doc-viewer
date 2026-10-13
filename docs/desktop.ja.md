# デスクトップアプリ

[English](desktop.md) | 日本語

[Markdown 設計書ビューア](../README.ja.md)のプレビューを、Windows・macOS・Linux のデスクトップアプリにしたものです。VS Code がなくても設計書を読めます。表示は拡張機能のプレビューと同じで、**mermaid のシーケンス図・フローチャートと処理概要の横並び**、矢印（ノード）と見出しの相互ハイライト、紐付け漏れの警告、目次、図・画像の拡大表示、表のヘッダ行の固定に対応します。

アプリはビューアです。設計書はエディタで編集し、保存するたびにアプリの表示が更新されます。

## インストール

[最新のリリース](https://github.com/playree/markdown-design-doc-viewer/releases/latest)から、お使いの OS のインストーラをダウンロードします。

| OS | ファイル |
| --- | --- |
| Windows | `Markdown.Design.Doc.Viewer_<バージョン>_x64-setup.exe`（または `.msi`） |
| macOS（Apple シリコン） | `Markdown.Design.Doc.Viewer_<バージョン>_aarch64.dmg` |
| macOS（Intel） | `Markdown.Design.Doc.Viewer_<バージョン>_x64.dmg` |
| Linux | `.deb`（Debian・Ubuntu）、`.rpm`（Fedora など）または `.AppImage` |

アプリのバージョンは、拡張機能・コマンドラインと同じです。

### 署名がないことによる警告

インストーラにはまだ署名がないため、初回に OS が警告を出します。

- **Windows**: SmartScreen の「Windows によって PC が保護されました」が出たら、**詳細情報** → **実行** を押します。
- **macOS**: 「悪質なソフトウェアかどうかを Apple で確認できないため、開けません」（または「壊れているため開けません」）と出たら、**システム設定** > **プライバシーとセキュリティ** を開き、アプリについてのメッセージの横の **このまま開く** を押します。ボタンが出ない場合は、ターミナルで隔離属性を外します。

  ```sh
  xattr -dr com.apple.quarantine "/Applications/Markdown Design Doc Viewer.app"
  ```

- **Linux**: AppImage には実行権限を付けます（`chmod +x Markdown*.AppImage`）。`.deb`・`.rpm` では、アプリに必要な WebKitGTK 4.1（`libwebkit2gtk-4.1-0` / `webkit2gtk4.1`）がパッケージマネージャで入ります。

## 使い方

Markdown ファイル（`.md`、`.markdown`）を次のどれかで開きます。

- **ファイル** > **開く...**（Ctrl+O、macOS では ⌘O）、またはファイルを開いていないときに出るボタン
- ウィンドウへのドラッグ&ドロップ
- コマンドライン: `markdown-design-doc-viewer docs/login.md`（Windows ではインストール先の `markdown-design-doc-viewer.exe`）

ファイルが保存されると、スクロール位置を保ったまま表示を更新します。**ファイル** > **再読み込み**（Ctrl+R、⌘R）でも読み直せます。

リンク:

- `#見出し` はその見出しへスクロールします。
- 別の Markdown ファイルへのリンクは、同じウィンドウで開きます（`#フラグメント` があればその見出しへ）。
- `http:`・`https:`・`mailto:` のリンクは、既定のブラウザやメールアプリで開きます。
- その他のファイルは、画像・PDF・テキスト・CSV・JSON・YAML・Office のファイルなら既定のアプリで開きます。それ以外（プログラムやスクリプトなど）は実行せず、フォルダで表示します。

画像は設計書のフォルダから探します。先頭が `/` のパスも設計書のフォルダが基準です（VS Code のようなワークスペースがないため）。

**表示** > **テーマ** で、OS の配色（ライト・ダーク。切り替えに追従します）か、常にライト・ダークで表示するかを選べます。メニューや文言は、OS の言語が日本語なら日本語、それ以外は英語で表示します。

拡張機能との違い: エディタとの連動（スクロールの同期、ダブルクリックで行へ移動）と HTML エクスポートはありません（エクスポートは拡張機能か[コマンドライン](cli.ja.md)を使ってください）。設定は拡張機能の既定値です。

## 開発

アプリは [desktop/](../desktop/) にあります。拡張機能の webview（webview/main.ts）を、拡張ホストの代わりの TypeScript のホストと組み合わせて動かし、Rust の [Tauri 2](https://tauri.app/) のアプリ（[desktop/src-tauri/](../desktop/src-tauri/)）はファイルの読み込み・監視とリンクを開く処理だけを行います。

Node.js と pnpm のほかに次が必要です。

- [Rust](https://rustup.rs/)（stable）
- Windows: Visual Studio Build Tools（「C++ によるデスクトップ開発」）と WebView2（Windows 10・11 には入っています）
- macOS: Xcode Command Line Tools（`xcode-select --install`）
- Linux（Debian・Ubuntu）: `sudo apt install build-essential file libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev patchelf`

```sh
pnpm install
pnpm desktop:dev -- -- /absolute/path/to/doc.md   # ビルドしてアプリを起動する（ファイルは省略可。アプリは desktop/src-tauri で動くので絶対パスで渡す）
pnpm desktop:bundle                               # インストーラを desktop/src-tauri/target/release/bundle/ に作る
```

`pnpm desktop:build` は Web 側（desktop/dist/）だけをビルドします（上の 2 つのコマンドは最初にこれを実行します）。Rust の依存（Cargo.lock）を変えたら、`pnpm desktop:licenses` でそのライセンスを desktop/src-tauri/ThirdPartyLicenses.txt に書き出してください（インストーラに入ります。[cargo-about](https://github.com/EmbarkStudios/cargo-about) が要ります: `cargo install cargo-about --version 0.9.2 --locked --features cli`。CI が検査に使うのと同じバージョンです）。アプリの動作確認は画面のある環境で行ってください。CI での Windows・macOS・Linux のビルドは時間がかかるので、手動で実行したときだけ動きます（[desktop.yml](../.github/workflows/desktop.yml)）。desktop/src-tauri・Tauri の設定・依存を変えたときと、リリースの前に実行してください。

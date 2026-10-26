# markdown-design-doc-viewer

[![npm](https://img.shields.io/npm/v/markdown-design-doc-viewer.svg)](https://www.npmjs.com/package/markdown-design-doc-viewer)
[![CI](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/playree/markdown-design-doc-viewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

[English](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/cli.md) | 日本語

[Markdown 設計書ビューア](https://github.com/playree/markdown-design-doc-viewer/blob/main/README.ja.md)のコマンドライン版です。Markdown で書いた設計書を、CI やバッチ処理で VS Code なしに 1 つの HTML ファイルへ書き出します。

書き出す HTML は VS Code 拡張の `設計書を HTML にエクスポート` コマンドと同じです。**mermaid のシーケンス図やフローチャートと処理概要を横並びにして**表示し、図の矢印（フローチャートではノード）と見出しが紐付いて、マウスを載せたりクリックしたりするとハイライトします。図はヘッドレス Chrome で描画し、ローカルの画像は埋め込むので、どのブラウザでも開けて、印刷から PDF にもできます。

![シーケンス図の矢印にマウスを載せると右の処理概要がハイライトされ、クリックするとそこまでスクロールし、見出しにマウスを載せると矢印がハイライトされる](https://raw.githubusercontent.com/playree/markdown-design-doc-viewer/main/images/demo.ja.gif)

**[サンプル](https://playree.github.io/markdown-design-doc-viewer/ja/sample/)**: このコマンドで [examples/screenshot.ja.md](https://github.com/playree/markdown-design-doc-viewer/blob/main/examples/screenshot.ja.md) から書き出した HTML です。

## 使い方

```sh
npx markdown-design-doc-viewer export docs -o site     # docs/ 以下の Markdown をすべて site/docs/*.html に
npx markdown-design-doc-viewer export docs -o site --index   # 加えて文書の一覧を site/index.html に
npx markdown-design-doc-viewer export docs -o site --diff-base v1.0   # タグ v1.0 からの差分付きで
npx markdown-design-doc-viewer export README.md        # 隣に README.html を
npx markdown-design-doc-viewer capture http://localhost:5173/signin -o docs/screens/signin.html --width 375   # 画面をワイヤーフレームに
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
| `--no-table-tree-highlight` | ツリーとして表示する表（表のオプションの `level=`）で、マウスを乗せた行の親と子をハイライトしない |
| `--no-toc` | ページの右端にマウスを乗せると開く目次（見出し h1〜h3）を表示しない |
| `--chrome <path>` | 図の描画に使う Chrome か Chromium |
| `--strict` | 警告（壊れた `@ref` や置き場所の誤ったマーカーなどの紐付けの警告、適用できない表のオプション、何にも一致しないワイヤーフレームのパーツのセレクタ（`item.<番号>=`））があれば失敗にする。紐付いていないだけの矢印・見出しでは失敗しない |
| `--diff-base <rev>` | 各文書の、git のリビジョン `<rev>`（タグ・コミット・ブランチ）からの差分を表示する。VS Code 拡張の履歴との比較と同じく、追加・変更・削除したブロックに緑・青・赤の帯を付け、変わった語を強調し、変更した図には変更前の図を折りたたんで添える。ページ下部のバーで前後の変更へ移動したり、差分を隠したり表示したりできる。そのリビジョンの同じパスにない文書（その後に追加・名前を変更したもの）は全体を追加として表示する。git と、クローンにそのリビジョンまでの履歴が必要（[GitHub Actions](#github-actions) を参照）。`--index` と使うと、一覧に各文書の差分の列が付く |
| `--index` | 書き出した文書の一覧を `--out-dir`（必須）の `index.html` にも書き出す。フォルダごとの表に、タイトル（リンク）・ファイル名と、front matter の `version`・`product`・`status`・`updated` を載せる。ページの検索欄で文書を絞り込め、列見出しで並べ替えられる |
| `--index-title <title>` | `index.html` のタイトル。既定は `Design Docs`（`--lang ja` では `設計書一覧`） |
| `--index-design-docs` | `index.html` に設計書（front matter に `type: design_doc`）だけを載せる。ほかの文書もエクスポートはする |
| `-h`, `--help` | ヘルプを表示する |
| `-v`, `--version` | バージョンを表示する |

フォルダはサブフォルダも含めて `*.md` と `*.markdown` を探します（`node_modules` とドットで始まるフォルダは除く）。紐付けの警告と表のオプションの警告は標準エラーに出します（GitHub Actions では注釈になります）。

文書を書き出せなかったとき（`--diff-base` で、不明なリビジョンなどで git が失敗したときも）、mermaid が描画できない図があったとき（HTML は書き出します）、`--strict` で警告があったときは終了コード 1、コマンドラインの誤りは 2 で終わります。

## 画面を撮る

`capture` は、動いている Web アプリ（開発サーバなど。`file:` の URL も使えます）の画面を[ワイヤーフレーム](https://github.com/playree/markdown-design-doc-viewer/blob/main/README.ja.md#ワイヤーフレーム)の HTML ファイルに書き出します。ヘッドレス Chrome で表示したとおりのページを（スクリプトで描画するシングルページアプリも）、スクリプトを除き、効いているスタイルとともに書き出すので、プレビューでブラウザと同じように表示できます。画像と使っているフォントも埋め込むので、ファイル 1 つで表示できます。

```sh
md-design-doc capture http://localhost:5173/signin -o docs/screens/signin.html --width 375
```

- スタイルシートは、スクリプトが追加したルール（CSS-in-JS）も含めて取り込み、撮ったときのウィンドウと同じようにレイアウトされるようにします。`@media` のルールはその幅と高さで残すかを決め、ウィンドウに対する長さ（`100vh`）はピクセルにします。`--width` の値をワイヤーフレームの `width=` に書いてください。
- フォームの部品の状態（入力した文字、チェック、選んだ選択肢）も残します。パスワードの文字は伏せ、隠しフィールドと `<meta>` 要素（セッションのトークンなどを含むことがあるため）は除きます。最前面（top layer）に開いたダイアログ・ポップオーバーは、表示された位置に残します。
- エラーメッセージ、ダイアログ、別のタブなど、初期表示にないものは、ページを操作してから撮ります。`--fill`・`--click`・`--hover`・`--press` を書いた順に実行します。操作で表示されるものは `--wait-for` で待ちます。

  ```sh
  md-design-doc capture http://localhost:5173/signin -o docs/screens/signin-error.html --width 375 \
    --fill '#email=a@example.com' --fill 'input[name=password]=wrong' --click 'button[type=submit]' --wait-for '[role=alert]'
  ```

- 込み入った準備は、`--script` で渡す Playwright のスクリプトで行います。既定のエクスポートの関数はページを開いた後に、`setup` は開く前に、[ページ](https://playwright.dev/docs/api/class-page)を引数に呼ばれます。たとえば画面が要る API の応答を差し替えられます。

  ```js
  // error.mjs
  export async function setup(page) {
    await page.route('**/api/signin', (route) => route.fulfill({ status: 401, json: { message: 'パスワードが違います。' } }));
  }
  export default async function (page) {
    await page.getByLabel('メールアドレス').fill('a@example.com');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.getByRole('alert').waitFor();
  }
  ```

- 画面のパーツには、ワイヤーフレームのオプションで番号を振ります（撮り直しても消えません）: `<!-- wireframe: link-headings width=375 item.1="#email" item.2="button[type=submit]" -->`。
- 撮れないもの: `:hover`・`:focus` の見た目（ホバーで表示される要素は撮れます）、モーダルの `<dialog>` の背景（`::backdrop`）、フレームの中身、Web コンポーネントの Shadow root の中身、動画。

| オプション | 説明 |
|---|---|
| `-o`, `--out <file.html>` | HTML ファイルをここに書き出します（必須）。フォルダがなければ作ります。 |
| `--width <px>` | ウィンドウの幅。既定値: `1280`。 |
| `--height <px>` | ウィンドウの高さ（`100vh` の長さ）。既定値: `800`。ページは長さにかかわらず全体を撮ります。 |
| `--color-scheme <scheme>` | `light`（既定値）か `dark`。システムの配色に従うページ向けです。 |
| `--storage-state <file>` | ページを開くときの Cookie とローカルストレージ。Playwright の [storage state](https://playwright.dev/docs/auth) で、ログインしたユーザーのものなどを渡します。 |
| `--script <file.mjs>` | ページを準備する Playwright のスクリプト（上記）。自分のコードとして、コマンドと同じ権限で動きます。 |
| `--fill <selector>=<text>` | 入力欄に文字を入力します。セレクタは、角かっこ・引用符の外の最初の `=` までです（`input[name=email]=a@example.com`）。 |
| `--click <selector>` | 要素をクリックします。 |
| `--hover <selector>` | 要素の上にポインタを移します。 |
| `--press <key>` | キーを押します（`Enter`、`Escape` など）。 |
| `--wait-for <selector>` | 要素が表示されるまで待ってから撮ります。 |
| `--wait <ms>` | 撮る前にこの時間待ちます（アニメーションなど）。 |
| `--chrome <path>` | ページを開く Chrome か Chromium。 |

セレクタは Playwright のもので、CSS セレクタのほか `text=ログイン` なども使えます。ページはネットワークが落ち着いてから開いたものとし、操作は要素を最大 30 秒待ちます。ページを開けない、操作に失敗したときは終了コード 1 で、ファイルは書きません。コマンドラインの誤りは 2 です。取得できなかった画像・フォントはリンクのまま、スタイルシートは除き、警告を出します。

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

`--diff-base` で前回のリリースからの差分を表示するには、`actions/checkout` が既定では取得しない履歴も取得します。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0   # 比較するタグやコミット
- run: npx markdown-design-doc-viewer export docs -o site --index --diff-base v1.0
```

## 書き方

図の中に `%% @link-headings` を書くと、その図が後ろの見出しと紐付きます。矢印・ノードと見出しは文言で、または `%% @ref` で対応付けます。記法は [書き方](https://github.com/playree/markdown-design-doc-viewer/blob/main/README.ja.md#書き方) を、AI アシスタントにこの形式で書かせるには [AI 向けの記法ガイド](https://github.com/playree/markdown-design-doc-viewer/blob/main/docs/ai-authoring-guide.ja.md) を参照してください。ガイドとこのコマンドの使い方は Agent Skill の [markdown-design-doc-skill.zip](https://github.com/playree/markdown-design-doc-viewer/releases/latest/download/markdown-design-doc-skill.zip) にもしてあります。

エディタとプレビューを同期させながら書くには、[VS Code 拡張](https://marketplace.visualstudio.com/items?itemName=playree.markdown-design-doc-viewer)を使ってください。

## ライセンス

[MIT](https://github.com/playree/markdown-design-doc-viewer/blob/main/LICENSE)

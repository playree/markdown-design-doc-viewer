# ログイン機能 設計書

## シーケンス

```mermaid
%% @seq-notes
sequenceDiagram
    actor User as ユーザー
    participant FE as フロントエンド
    participant API as APIサーバー
    participant Auth as 認証サービス
    participant DB as データベース

    User->>FE: ID・パスワードを入力
    FE->>API: POST /login
    activate API
    API->>Auth: 認証リクエスト
    activate Auth
    Auth->>DB: ユーザー情報を取得
    DB-->>Auth: ユーザーレコード

    alt 認証成功
        %% @ref トークン発行
        Auth-->>API: アクセストークンを発行
        API-->>FE: 200 OK (token)
        FE-->>User: ダッシュボードを表示
    else 認証失敗
        Auth-->>API: 認証エラー
        API-->>FE: 401 Unauthorized
        FE-->>User: エラーメッセージを表示
    end
    deactivate Auth
    deactivate API

    loop 定期的に実行
        FE->>API: GET /notifications
        API-->>FE: 通知一覧
    end
```

## 処理概要

### POST /login

リクエストボディの `id` と `password` を検証し、認証サービスへ転送する。

| 項目 | 型 | 必須 |
|---|---|---|
| id | string | ○ |
| password | string | ○ |

### ユーザー情報を取得

`users` テーブルから `id` をキーに 1 件取得する。

- 存在しない場合は認証失敗とする
- ロック中のユーザーは認証失敗とする

### トークン発行

有効期限 1 時間の JWT を発行する。

### 認証エラー

失敗回数をインクリメントし、5 回連続で失敗した場合はユーザーをロックする。

### GET /notifications

30 秒間隔でポーリングする。

<!-- seq-notes:end -->

## 補足（横並びの対象外）

```mermaid
sequenceDiagram
    A->>B: @seq-notes のないシーケンス図は通常表示
```

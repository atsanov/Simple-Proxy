# 🚀 proxy-lite

astroidv3 ベースの軽量 Web プロキシ。Render + Cloudflare Quick Tunnel 対応。  
リクエストメタデータを Webhook にログ送信（ファイル除外・URL通知分離）。

## ⚙️ 環境変数設定（Render ダッシュボード必須）
| 変数名 | 必須 | 説明 | 例 |
|---|---|---|---|
| `PORT` | はい | サーバーポート | `3300` |
| `WEBHOOK_URL_LOG` | はい | ログ送信用 Webhook URL | `https://discord.com/api/webhooks/...` |
| `WEBHOOK_URL_NOTIFY` | いいえ | アラート送信用 Webhook URL | `https://hooks.slack.com/services/...` |
| `NOTIFY_KEYWORDS` | いいえ | 通知トリガーキーワード（カンマ区切り） | `admin,login,secret` |
| `CF_QUICK_TUNNEL` | いいえ | `true` で Quick Tunnel 有効化 | `false` |

> 🔒 `.env` ファイルはローカル開発用のみ。GitHub 公開時は含めないこと。

## 🚀 デプロイ手順
1. Render で `New Web Service` → このリポジトリを選択
2. Build: `npm ci --omit=dev` / Start: `npm start`
3. `Environment Variables` タブで上記変数を設定
4. Deploy

## 🤖 Render 常時維持 (GAS)
`ping-render.gs` を Google Apps Script に貼り付け、`RENDER_URL` プロパティを設定。  
5分間隔トリガーで `pingRender()` を実行し、スリープを防止。

## 📦 ローカル開発
```bash
npm install
npm start
# http://localhost:3300
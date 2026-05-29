// logger.js
import { request } from 'node:https';
import { URL } from 'node:url';

// ========================================
// 環境変数読み込み
// ========================================
const WEBHOOK_URL = process.env.WEBHOOK_URL;   // 🌐 アクセスURL送信用
const WEBHOOK_LOG = process.env.WEBHOOK_LOG;   // 📝 システムログ用
const NOTIFY_KEYWORDS = (process.env.NOTIFY_KEYWORDS || '')
  .split(',')
  .map(k => k.trim().toLowerCase())
  .filter(Boolean);

// ❌ URL通知から除外するファイル拡張子（正規表現）
const SKIP_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|ogg|mp3|wav|flac|zip|rar|7z|tar|gz|exe|dll|so|pdf|doc|docx|xls|xlsx|ppt|pptx|ico|css|js|mjs|cjs|woff|woff2|ttf|eot|otf|map|wasm)$/i;

/**
 * 🔧 共通: Webhook送信ヘルパー（非同期・タイムアウト・エラー安全）
 */
function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return Promise.resolve(false);
  
  return new Promise((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const data = JSON.stringify(payload);
      
      const options = {
        hostname: url.hostname,
        port: url.protocol === 'https:' ? 443 : 80,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'proxy-lite/1.0'
        },
        timeout: 3000 // 3秒でタイムアウト
      };

      const req = request(options, (res) => {
        res.resume(); // メモリリーク防止
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      
      req.write(data);
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * 🌐 URL送信用: アクセスされたURL・メタデータを送信（ファイル除外）
 */
export async function logAccess(req, metadata = {}) {
  if (!WEBHOOK_URL) return;
  
  const rawUrl = req.url || '';
  
  // ❌ ファイルリクエストは通知除外
  if (SKIP_EXTENSIONS.test(rawUrl)) return;

  const [path, query] = rawUrl.split('?');
  const matchedKeyword = NOTIFY_KEYWORDS.length > 0 
    ? (NOTIFY_KEYWORDS.find(kw => rawUrl.toLowerCase().includes(kw)) || null) 
    : null;

  const payload = {
    type: 'url_access',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: path || '/',
    query: query || null,
    headers: {
      'user-agent': req.headers['user-agent'] || null,
      'referer': req.headers['referer'] || null,
      'ip': req.headers['cf-connecting-ip'] || 
            req.headers['x-forwarded-for'] || 
            req.headers['x-real-ip'] || null
    },
    bareRoute: rawUrl.startsWith('/bare/'),
    uvRoute: rawUrl.startsWith('/uv/'),
    alertKeyword: matchedKeyword, // キーワード一致時のみ設定
    ...metadata
  };

  await sendWebhook(WEBHOOK_URL, payload);
}

/**
 * 📝 システムログ用: サーバーイベント・エラー・状態変化を送信
 */
export async function logSystem(event, data = {}) {
  if (!WEBHOOK_LOG) return;
  
  const payload = {
    type: 'system_log',
    event: event,
    timestamp: new Date().toISOString(),
    ...data
  };
  
  await sendWebhook(WEBHOOK_LOG, payload);
}

/**
 * 🎯 ミドルウェア用ラッパー（Express/Bareのrequestハンドラから呼び出し）
 */
export async function handleWebhooks(req, metadata = {}) {
  await logAccess(req, metadata);
}
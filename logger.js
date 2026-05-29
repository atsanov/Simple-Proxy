import { request } from 'node:https';
import { URL } from 'node:url';

const WEBHOOK_LOG = process.env.WEBHOOK_URL_LOG;
const WEBHOOK_NOTIFY = process.env.WEBHOOK_URL_NOTIFY;
const NOTIFY_KEYWORDS = (process.env.NOTIFY_KEYWORDS || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
const SKIP_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif|mp4|webm|ogg|mp3|wav|flac|zip|rar|7z|tar|gz|exe|dll|so|pdf|doc|docx|xls|xlsx|ppt|pptx|ico|css|js|mjs|cjs|woff|woff2|ttf|eot|otf|map|wasm)$/i;

function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      const url = new URL(webhookUrl);
      const data = JSON.stringify(payload);
      const options = {
        hostname: url.hostname,
        port: url.protocol === 'https:' ? 443 : 80,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': 'proxy-lite/1.0' },
        timeout: 3000
      };
      const req = request(options, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 300); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.write(data);
      req.end();
    } catch { resolve(false); }
  });
}

export async function logRequest(req, metadata = {}) {
  if (!WEBHOOK_LOG) return;
  const rawUrl = req.url || '';
  if (SKIP_EXTENSIONS.test(rawUrl)) return;
  const [path, query] = rawUrl.split('?');
  await sendWebhook(WEBHOOK_LOG, {
    type: 'request_log', timestamp: new Date().toISOString(), method: req.method, path: path || '/', query: query || null,
    headers: { 'user-agent': req.headers['user-agent'] || null, 'referer': req.headers['referer'] || null, 'cf-connecting-ip': req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || null },
    bareRoute: rawUrl.startsWith('/bare/'), uvRoute: rawUrl.startsWith('/uv/'), ...metadata
  });
}

export async function notifyUrlAccess(req, metadata = {}) {
  if (!WEBHOOK_NOTIFY || NOTIFY_KEYWORDS.length === 0) return;
  const rawUrl = (req.url || '').toLowerCase();
  if (SKIP_EXTENSIONS.test(rawUrl)) return;
  const matchedKeyword = NOTIFY_KEYWORDS.find(kw => rawUrl.includes(kw));
  if (!matchedKeyword) return;
  const [path] = rawUrl.split('?');
  await sendWebhook(WEBHOOK_NOTIFY, {
    type: 'url_alert', priority: 'high', timestamp: new Date().toISOString(), alert: { keyword: matchedKeyword, matchedPath: path || '/', fullUrl: rawUrl },
    method: req.method, headers: { 'user-agent': req.headers['user-agent'] || null, 'cf-connecting-ip': req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || null },
    bareRoute: rawUrl.startsWith('/bare/'), ...metadata
  });
}

export async function handleWebhooks(req, metadata = {}) {
  await Promise.allSettled([logRequest(req, metadata), notifyUrlAccess(req, metadata)]);
}
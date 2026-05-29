// ========================================
// index.js - Main Entry Point
// proxy-lite: Lightweight Proxy Server
// ========================================

import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import dotenv from 'dotenv';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Internal modules
import { createBareServerInstance } from './bare.mjs';
import { handleWebhooks, logSystem } from './logger.js';
import wisp from 'wisp-server-node';

// ========================================
// 環境変数・初期設定
// ========================================

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 3300;
const BARE_ROUTE = '/bare/';
const UV_ROUTE = '/uv/';

// ========================================
// Express + Bare Server 初期化
// ========================================

const app = express();
const bare = createBareServerInstance(BARE_ROUTE);
const server = http.createServer();

// 静的ファイルディレクトリ設定
const publicPath = join(__dirname, 'static');

// ========================================
// Express Middleware 設定
// ========================================

// リクエストボディ解析（軽量に制限）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 静的ファイル提供（Ultraviolet + frontend）
app.use(UV_ROUTE, express.static(uvPath, { maxAge: '1d' }));
app.use(express.static(publicPath, { maxAge: '1h' }));

// 🪝 Webhook処理ミドルウェア（Bareルート以外）
app.use((req, res, next) => {
  // Bare Server ルートは下の server.on('request') で処理するためスキップ
  if (req.url.startsWith(BARE_ROUTE)) {
    return next();
  }
  
  // 🔥 非同期でWebhook処理（メイン処理をブロックしない）
  setImmediate(() => {
    handleWebhooks(req, { source: 'express', stage: 'pre' });
  });
  
  next();
});

// ========================================
// HTTP Request Handler
// ========================================

server.on('request', (req, res) => {
  // Bare Server 経由のリクエスト
  if (bare.shouldRoute(req)) {
    // 🪝 アクセスログ送信 (WEBHOOK_URL用)
    setImmediate(() => {
      handleWebhooks(req, { source: 'bare', stage: 'proxy' });
    });
    
    bare.routeRequest(req, res);
    return;
  }
  
  // Express 処理
  app(req, res);
});

// ========================================
// WebSocket / Upgrade Handler
// ========================================

server.on('upgrade', (req, socket, head) => {
  // Bare Server WebSocket
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
    return;
  }
  
  // Wisp Protocol (Ultraviolet用)
  if (req.url.startsWith('/wisp/')) {
    wisp.routeRequest(req, socket, head);
    return;
  }
  
  // 未処理のupgradeは破棄
  socket.destroy();
});

// ========================================
// Cloudflare Quick Tunnel 起動関数
// ========================================

let cloudflareProcess = null;

function startCloudflareTunnel(port) {
  // 環境変数で無効化されている場合はスキップ
  if (process.env.CF_QUICK_TUNNEL !== 'true') {
    return null;
  }
  
  console.log('🔷 Starting Cloudflare Quick Tunnel...');
  
  // cloudflared subprocess 起動
  const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: 'inherit',
    env: { ...process.env, NO_COLOR: '1' }
  });

  cf.on('error', (err) => {
    console.error('❌ Failed to start cloudflared:', err.message);
    logSystem('cloudflare_error', { message: err.message });
  });

  cf.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`⚠️  cloudflared exited with code ${code}`);
      logSystem('cloudflare_exit', { code });
    }
  });

  return cf;
}

// ========================================
// Graceful Shutdown 処理
// ========================================

function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  logSystem('shutdown_initiated', { signal });
  
  // Cloudflare Tunnel プロセスがある場合は終了
  if (cloudflareProcess && !cloudflareProcess.killed) {
    console.log('🔷 Stopping Cloudflare Tunnel...');
    cloudflareProcess.kill('SIGTERM');
  }
  
  // Bare Server 接続クローズ
  bare.close();
  
  // HTTP サーバー終了
  server.close(() => {
    console.log('✅ Server closed. Exiting.');
    process.exit(0);
  });
  
  // 強制終了フェイルセーフ
  setTimeout(() => {
    console.error('⚠️  Forced exit after timeout');
    logSystem('forced_exit', { timeout: true });
    process.exit(1);
  }, 10000);
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  logSystem('uncaught_exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  logSystem('unhandled_rejection', { reason: String(reason) });
});

// ========================================
// Server Start
// ========================================

server.on('listening', () => {
  const addr = server.address();
  const host = addr.address === '::' ? 'localhost' : addr.address;
  const port = addr.port;
  
  console.log('');
  console.log('🚀 proxy-lite started successfully!');
  console.log(`📍 Local:   http://${host}:${port}`);
  console.log(`📍 UV:      http://${host}:${port}${UV_ROUTE}`);
  console.log(`📍 Bare:    http://${host}:${port}${BARE_ROUTE}`);
  console.log('');
  
  // 📝 システムログ送信 (WEBHOOK_LOG用)
  logSystem('server_started', { 
    port, 
    host,
    webhooks: {
      url: process.env.WEBHOOK_URL ? 'configured' : 'missing',
      log: process.env.WEBHOOK_LOG ? 'configured' : 'missing'
    }
  });
  
  // Cloudflare Quick Tunnel 起動
  cloudflareProcess = startCloudflareTunnel(port);
});

// Start server
server.listen({ 
  port: PORT,
  host: '0.0.0.0'  // Render/Docker 対応
}, () => {
  // listening event will fire
});

// Export for testing
export { app, bare, server };
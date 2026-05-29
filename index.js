import http from 'node:http';
import { spawn } from 'node:child_process';
import express from 'express';
import dotenv from 'dotenv';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createBareServerInstance } from './bare.mjs';
import { handleWebhooks } from './logger.js';
import wisp from 'wisp-server-node';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = parseInt(process.env.PORT, 10) || 3300;
const BARE_ROUTE = '/bare/';
const UV_ROUTE = '/uv/';

const app = express();
const bare = createBareServerInstance(BARE_ROUTE);
const server = http.createServer();
const publicPath = join(__dirname, 'static');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(UV_ROUTE, express.static(uvPath, { maxAge: '1d' }));
app.use(express.static(publicPath, { maxAge: '1h' }));

app.use((req, res, next) => {
  if (!req.url.startsWith(BARE_ROUTE)) {
    setImmediate(() => handleWebhooks(req, { source: 'express', stage: 'pre' }));
  }
  next();
});

server.on('request', (req, res) => {
  if (bare.shouldRoute(req)) {
    setImmediate(() => handleWebhooks(req, { source: 'bare', stage: 'proxy' }));
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req)) { bare.routeUpgrade(req, socket, head); }
  else if (req.url.startsWith('/wisp/')) { wisp.routeRequest(req, socket, head); }
  else { socket.destroy(); }
});

function startCloudflareTunnel(port) {
  if (process.env.CF_QUICK_TUNNEL !== 'true') return null;
  console.log('🔷 Starting Cloudflare Quick Tunnel...');
  const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { stdio: 'inherit', env: { ...process.env, NO_COLOR: '1' } });
  cf.on('error', (err) => console.error('❌ cloudflared error:', err.message));
  return cf;
}

let cloudflareProcess = null;
function gracefulShutdown(signal) {
  console.log(`🛑 Received ${signal}. Shutting down...`);
  if (cloudflareProcess && !cloudflareProcess.killed) cloudflareProcess.kill('SIGTERM');
  bare.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => { console.error('💥 Uncaught:', err); gracefulShutdown('uncaughtException'); });

server.on('listening', () => {
  console.log(`🚀 proxy-lite started on port ${PORT}`);
  console.log(`📋 Log Webhook: ${process.env.WEBHOOK_URL_LOG ? '✅' : '❌'} | 🔔 Notify: ${process.env.WEBHOOK_URL_NOTIFY ? '✅' : '❌'}`);
  console.log(`🔷 Cloudflare Tunnel: ${process.env.CF_QUICK_TUNNEL === 'true' ? '✅' : '❌'}`);
  cloudflareProcess = startCloudflareTunnel(PORT);
});

server.listen({ port: PORT, host: '0.0.0.0' });
export { app, bare, server };
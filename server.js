import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { createBareServer } from "@tomphttp/bare-server-node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { createServer } from "node:http";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicPath = path.join(__dirname, "public");

const app = express();
const PORT = process.env.PORT || 10000;
const STATUS_WEBHOOK = process.env.STATUS_WEBHOOK || "";
const LOG_WEBHOOK = process.env.LOG_WEBHOOK || "";
const LOG_DIR = "./logs";

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

// ── Utilities ────────────────────────────────────────────────
function now() { return new Date().toISOString(); }
function sha(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function logFile() {
  return path.join(LOG_DIR, `${new Date().toISOString().split("T")[0]}.log`);
}

let previousHash = "GENESIS";
function appendLog(entry) {
  const raw = JSON.stringify(entry);
  const currentHash = sha(previousHash + raw);
  const finalEntry = { prev_hash: previousHash, current_hash: currentHash, ...entry };
  previousHash = currentHash;
  fs.appendFileSync(logFile(), JSON.stringify(finalEntry) + "\n");
}

async function sendWebhook(url, message) {
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) { console.error("WEBHOOK ERROR:", err); }
}

function truncate(text = "", limit = 1024 * 1024) {
  return text.length <= limit ? text : text.slice(0, limit) + "\n[TRUNCATED]";
}

function blockedUrl(url = "") {
  const blocked = [".mp4",".png",".jpg",".jpeg",".gif",".webp",".svg",
    ".ico",".css",".js",".mjs",".wasm",".woff",".woff2",".ttf",".zip",".pdf"];
  return blocked.some(x => url.toLowerCase().includes(x));
}

function bodyAllowed(contentType = "") {
  const blocked = ["video/","image/","audio/","font/","application/javascript",
    "text/javascript","application/x-javascript","text/html","text/css",
    "application/wasm","application/octet-stream","application/zip","application/pdf"];
  for (const t of blocked) if (contentType.includes(t)) return false;
  const allowed = ["application/json","text/plain","application/xml","text/xml",
    "application/graphql","application/x-www-form-urlencoded","text/markdown"];
  return allowed.some(t => contentType.includes(t));
}

// ── Error handlers ───────────────────────────────────────────
process.on("uncaughtException", async err => {
  console.error(err);
  await sendWebhook(LOG_WEBHOOK, "Uncaught Exception\n```" + String(err.stack || err) + "```");
});
process.on("unhandledRejection", async err => {
  console.error(err);
  await sendWebhook(LOG_WEBHOOK, "Unhandled Rejection\n```" + String(err) + "```");
});

// ── Middleware ───────────────────────────────────────────────
app.use(compression());
app.use(rateLimit({ windowMs: 60 * 1000, max: 500 }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Request/response logger (from Simple-Proxy)
app.use((req, res, next) => {
  const start = Date.now();
  const chunks = [];
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  res.write = (chunk, ...args) => {
    try { chunks.push(Buffer.from(chunk)); } catch {}
    return originalWrite(chunk, ...args);
  };
  res.end = (chunk, ...args) => {
    try {
      if (chunk) chunks.push(Buffer.from(chunk));
      const reqType = String(req.headers["content-type"] || "");
      const resType = String(res.getHeader("content-type") || "");
      appendLog({
        time: now(),
        ip: req.ip,
        method: req.method,
        url: req.originalUrl,
        user_agent: req.headers["user-agent"],
        request_headers: req.headers,
        request_body: bodyAllowed(reqType) ? truncate(JSON.stringify(req.body || {})) : "[SKIPPED]",
        response_status: res.statusCode,
        response_body: bodyAllowed(resType) && !blockedUrl(req.originalUrl)
          ? truncate(Buffer.concat(chunks).toString("utf8")) : "[SKIPPED]",
        duration_ms: Date.now() - start,
      });
    } catch (err) { console.error("LOGGING ERROR:", err); }
    return originalEnd(chunk, ...args);
  };
  next();
});

// ── Static files ─────────────────────────────────────────────
app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));

// ── Routes ───────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true }));

// ── Bare server (UV proxy transport) ─────────────────────────
const bare = createBareServer("/bare/");

// ── HTTP server with wisp support ────────────────────────────
const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    wisp.routeRequest(req, socket, head);
  }
});

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await sendWebhook(STATUS_WEBHOOK, `Proxy online on port ${PORT}`);
});

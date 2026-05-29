import express from "express";
import compression from "compression";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { createBareServer } from "@tomphttp/bare-server-node";
import { spawn } from "child_process";

const app = express();

const PORT = process.env.PORT || 3000;

const STATUS_WEBHOOK =
  process.env.STATUS_WEBHOOK || "";

const LOG_WEBHOOK =
  process.env.LOG_WEBHOOK || "";

const LOG_DIR = "./logs";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

function now() {
  return new Date().toISOString();
}

function sha(data) {
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex");
}

function logFile() {

  const date =
    new Date()
      .toISOString()
      .split("T")[0];

  return path.join(
    LOG_DIR,
    `${date}.log`
  );
}

let previousHash = "GENESIS";

function appendLog(entry) {

  const raw =
    JSON.stringify(entry);

  const currentHash =
    sha(previousHash + raw);

  const finalEntry = {
    prev_hash: previousHash,
    current_hash: currentHash,
    ...entry
  };

  previousHash = currentHash;

  fs.appendFileSync(
    logFile(),
    JSON.stringify(finalEntry) + "\n"
  );
}

async function statusWebhook(message) {

  if (!STATUS_WEBHOOK) return;

  try {

    await fetch(STATUS_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        content: message
      })
    });

  } catch {}
}

async function logWebhook(message) {

  if (!LOG_WEBHOOK) return;

  try {

    await fetch(LOG_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        content: message
      })
    });

  } catch {}
}

process.on(
  "uncaughtException",
  async err => {

    await logWebhook(
      "Uncaught Exception:\n```" +
      String(err.stack || err) +
      "```"
    );
  }
);

process.on(
  "unhandledRejection",
  async err => {

    await logWebhook(
      "Unhandled Rejection:\n```" +
      String(err) +
      "```"
    );
  }
);

function truncate(
  text = "",
  limit = 1024 * 1024
) {

  if (text.length <= limit) {
    return text;
  }

  return (
    text.slice(0, limit) +
    "[TRUNCATED]"
  );
}

function blockedUrl(url = "") {

  const blocked = [
    ".mp4",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".wasm",
    ".css",
    ".js",
    ".mjs",
    ".ico",
    ".svg",
    ".woff",
    ".woff2",
    ".ttf",
    ".zip",
    ".pdf"
  ];

  return blocked.some(x =>
    url.toLowerCase().includes(x)
  );
}

function bodyAllowed(
  contentType = ""
) {

  const blocked = [
    "video/",
    "image/",
    "audio/",
    "font/",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
    "text/html",
    "text/css",
    "application/wasm",
    "application/octet-stream",
    "application/zip",
    "application/pdf"
  ];

  for (const type of blocked) {

    if (
      contentType.includes(type)
    ) {
      return false;
    }
  }

  const allowed = [
    "application/json",
    "text/plain",
    "application/xml",
    "text/xml",
    "application/x-www-form-urlencoded",
    "application/graphql",
    "text/markdown"
  ];

  return allowed.some(type =>
    contentType.includes(type)
  );
}

app.use(compression());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 500
}));

app.use(express.json({
  limit: "1mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "1mb"
}));

app.use((req, res, next) => {

  const start = Date.now();

  const chunks = [];

  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function(chunk, ...args) {

    chunks.push(
      Buffer.from(chunk)
    );

    return originalWrite.call(
      this,
      chunk,
      ...args
    );
  };

  res.end = function(chunk, ...args) {

    if (chunk) {

      chunks.push(
        Buffer.from(chunk)
      );
    }

    let responseBody =
      "[SKIPPED]";

    let requestBody =
      "[SKIPPED]";

    try {

      const responseType =
        String(
          res.getHeader(
            "content-type"
          ) || ""
        );

      const requestType =
        String(
          req.headers[
            "content-type"
          ] || ""
        );

      if (
        bodyAllowed(requestType)
      ) {

        requestBody = truncate(
          JSON.stringify(
            req.body || {}
          )
        );
      }

      if (
        bodyAllowed(responseType) &&
        !blockedUrl(
          req.originalUrl
        )
      ) {

        responseBody = truncate(
          Buffer.concat(chunks)
            .toString("utf8")
        );
      }

    } catch {}

    appendLog({
      time: now(),
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      user_agent:
        req.headers[
          "user-agent"
        ],
      request_headers:
        req.headers,
      request_body:
        requestBody,
      response_status:
        res.statusCode,
      response_body:
        responseBody,
      duration_ms:
        Date.now() - start
    });

    return originalEnd.call(
      this,
      chunk,
      ...args
    );
  };

  next();
});

app.use(
  express.static("./public")
);

app.get(
  "/health",
  (_, res) => {

    res.json({
      ok: true
    });
  }
);

const bare =
  createBareServer("/bare/");

const server = app.listen(
  PORT,
  async () => {

    console.log(
      `Server running on ${PORT}`
    );

    await statusWebhook(
      `Proxy online on port ${PORT}`
    );

    startTunnel();
  }
);

server.on(
  "upgrade",
  (req, socket, head) => {

    if (
      bare.shouldRoute(req)
    ) {

      bare.routeUpgrade(
        req,
        socket,
        head
      );
    }
  }
);

function startTunnel() {

  const tunnel = spawn(
    "./cloudflared",
    [
      "tunnel",
      "--url",
      `http://localhost:${PORT}`
    ]
  );

  let buffer = "";

  tunnel.stdout.on(
    "data",
    async data => {

      buffer +=
        data.toString();

      const match =
        buffer.match(
          /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/
        );

      if (match) {

        const url =
          match[0];

        console.log(
          "Tunnel URL:",
          url
        );

        await statusWebhook(
          `Proxy URL: ${url}`
        );

        buffer = "";
      }
    }
  );

  tunnel.stderr.on(
    "data",
    async data => {

      const text =
        data.toString();

      console.error(text);

      await logWebhook(
        "Cloudflared stderr:\n```" +
        truncate(text, 1500) +
        "```"
      );
    }
  );
}

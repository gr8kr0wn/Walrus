import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import nftsRouter from "./routes/nfts.js";
import { activityRouter, rankingsRouter } from "./routes/marketplace.js";
import marketplaceRouter from "./routes/marketplace.js";
import mintRouter from "./routes/mint.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.join(__dirname, "..", "cache");

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────

app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, same-origin).
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Rate limiting ─────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please slow down." },
});

app.use(limiter);

// ── Body parsing ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: config.network,
    contractConfigured:
      !!config.contractPackageId && !config.contractPackageId.startsWith("0x_"),
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/nfts", nftsRouter);
app.use("/activity", activityRouter);
app.use("/rankings", rankingsRouter);
app.use("/marketplace", marketplaceRouter);
app.use("/mint", mintRouter);

/**
 * POST /upload
 * Proxies binary uploads to Walrus publisher to bypass browser CORS checks,
 * and caches the raw binary payload locally.
 */
app.post("/upload", express.raw({ type: "*/*", limit: "50mb" }), async (req, res, next) => {
  try {
    const contentType = req.headers["content-type"] || "application/octet-stream";
    const targetUrl = process.env.WALRUS_PUBLISHER_URL || "https://publisher.walrus-testnet.walrus.space/v1/blobs";

    const response = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        "content-type": contentType,
      },
      body: req.body,
    });

    const text = await response.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: json.error || `Walrus upload failed with HTTP ${response.status}`,
      });
    }

    // Cache the uploaded buffer locally on the backend
    const blobId = json.blobId || json.newlyCreated?.blobObject?.blobId || json.alreadyCertified?.blobId;
    if (blobId) {
      const safeBlobId = blobId.replace(/[^a-zA-Z0-9_\-]/g, "");
      if (safeBlobId) {
        const filePath = path.join(cacheDir, safeBlobId);
        fs.promises.writeFile(filePath, req.body).catch((err) => {
          console.error("Failed to write post upload to local cache:", err);
        });
      }
    }

    res.json({ success: true, data: json });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /upload/:blobId
 * Serves cached blobs locally or fetches from public Walrus aggregators and caches them on demand.
 */
app.get("/upload/:blobId", async (req, res) => {
  try {
    const { blobId } = req.params;
    const safeBlobId = blobId.replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!safeBlobId) {
      return res.status(400).json({ success: false, error: "Invalid blob ID" });
    }

    const filePath = path.join(cacheDir, safeBlobId);

    // If cached locally, serve instantly!
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache
      return fs.createReadStream(filePath).pipe(res);
    }

    // Otherwise, fetch from public aggregators and cache it
    const WALRUS_AGGREGATORS = [
      "https://aggregator.walrus-testnet.walrus.space/v1",
      "https://wal-aggregator-testnet.staketab.org/v1",
      "https://walrus-testnet-aggregator.nodes.guru/v1",
      "https://walrus.testnet.pops.one/v1",
    ];

    let data = null;
    let contentType = "image/png";

    for (const base of WALRUS_AGGREGATORS) {
      try {
        const response = await fetch(`${base}/${safeBlobId}`);
        if (response.ok) {
          data = await response.arrayBuffer();
          contentType = response.headers.get("content-type") || "image/png";
          break;
        }
      } catch (err) {
        console.warn(`Aggregator ${base} failed: ${err.message}`);
      }
    }

    if (!data) {
      return res.status(404).json({ success: false, error: "Blob not found on aggregators" });
    }

    // Save to local cache folder
    fs.promises.writeFile(filePath, Buffer.from(data)).catch((err) => {
      console.error("Failed to write backend cache:", err);
    });

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(Buffer.from(data));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// ── Error handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || "Internal server error";
  if (status >= 500) {
    console.error("[error]", err);
  }
  res.status(status).json({ success: false, error: message });
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startServer(port = config.port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`WalrusMint backend listening on http://localhost:${port}`);
      resolve(server);
    });
  });
}

// Only auto-start when run directly (not imported by tests).
const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith(new URL(import.meta.url).pathname.replace(/\\/g, "/").replace(/^\/([A-Z]:)/, "$1"));

if (isMain) {
  startServer();
}

export default app;

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDatabase, nowIso } from "./db.js";
import { registerFaceTestRoutes } from "./facetest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const STATIC_FILES = ["index.html", "admin.html", "app.js", "admin.js", "app.css"];

export async function createApp(options = {}) {
  const db = options.db || await ensureDatabase(options.dbPath);
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.locals.db = db;
  app.use(express.json({ limit: "10mb" }));

  app.use((req, res, next) => {
    const origin = req.get("origin") || "";
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-facetest-admin-token");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "unsw-face-api",
      timestamp: nowIso(),
    });
  });

  registerFaceTestRoutes(app, db);

  app.get("/", (_req, res) => {
    res.sendFile(path.join(REPO_ROOT, "index.html"));
  });

  for (const fileName of STATIC_FILES) {
    app.get(`/${fileName}`, (_req, res) => {
      res.sendFile(path.join(REPO_ROOT, fileName));
    });
  }

  app.use("/assets", express.static(path.join(REPO_ROOT, "assets")));

  return app;
}

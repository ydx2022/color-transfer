// 后端服务（Express）：静态托管构建产物 + 健康检查。MVP 仅此；预留文件暂存与多端同步。
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../.."); // web/
const dist = resolve(webRoot, "dist");

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now(), service: "opti-link" }));
app.use(express.static(dist));
app.use(express.static(webRoot));

const port = process.env.PORT ? Number(process.env.PORT) : 4173;
app.listen(port, () => {
  console.log(`[opti-link] server listening on http://0.0.0.0:${port}  (health: /healthz)`);
});

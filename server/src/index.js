import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fstatic from "@fastify/static";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { q, tx, migrate, pool } from "./db.js";
import * as auth from "./auth.js";
import { makeThumb, backfillThumbs } from "./thumbs.js";
import * as ai from "./ai.js";
import { extract } from "./docs.js";
import { MEDIA_DIR, listItems, getItem, saveItem, deleteItem, mergeItems, slug, cleanupOrphans } from "./items.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(here, "..", "..", "public"));
const PORT = +(process.env.PORT || 5010);
const COOKIE = { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", maxAge: auth.SESSION_DAYS * 86400 };
const MAX_UPLOAD = +(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" }, bodyLimit: 10 * 1024 * 1024, trustProxy: true });
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD, files: 1 } });
await app.register(fstatic, { root: PUBLIC_DIR, prefix: "/" });
await fsp.mkdir(MEDIA_DIR, { recursive: true });
await app.register(fstatic, { root: MEDIA_DIR, prefix: "/media/", decorateReply: false, maxAge: "30d", immutable: true });

/* ---------- 鉴权：/api 与 /media 需要登录，写操作需要管理员 ---------- */
const OPEN = new Set(["/api/login", "/api/me", "/api/health", "/api/version"]);
app.decorateRequest("user", null);
app.addHook("onRequest", async (req, reply) => {
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/") && !url.startsWith("/media/")) return;
  req.user = await auth.userFromSession(req.cookies.sid);
  if (OPEN.has(url)) return;
  if (!req.user) return reply.code(401).send({ error: "请先登录" });
  if (req.method !== "GET" && url !== "/api/logout" && req.user.role !== "admin") return reply.code(403).send({ error: "只有馆长可以修改" });
});
app.setErrorHandler((err, req, reply) => {
  if (!err.expose && (!err.statusCode || err.statusCode >= 500)) req.log.error(err);
  reply.code(err.statusCode || 500).send({ error: err.statusCode && (err.statusCode < 500 || err.expose) ? err.message : "服务器错误" });
});

app.get("/api/health", async () => { await q("SELECT 1"); return { ok: true }; });

app.post("/api/login", async (req, reply) => {
  const { name, password } = req.body || {};
  if (auth.tooManyAttempts(req.ip)) return reply.code(429).send({ error: "尝试次数过多，请 15 分钟后再试" });
  const u = (await q("SELECT * FROM users WHERE name=$1", [String(name || "")])).rows[0];
  if (!u || !(await auth.verifyPassword(String(password || ""), u.password_hash))) { auth.recordFail(req.ip); return reply.code(401).send({ error: "用户名或密码错误" }); }
  auth.clearFails(req.ip);
  reply.setCookie("sid", await auth.createSession(u.id), COOKIE);
  return { id: u.id, name: u.name, role: u.role };
});
app.post("/api/logout", async (req, reply) => {
  await q("DELETE FROM sessions WHERE token=$1", [req.cookies.sid]);
  reply.clearCookie("sid", { path: "/" });
  return { ok: true };
});
app.get("/api/me", async req => ({ user: req.user, ai: req.user?.role === "admin" ? await ai.hasAI() : false }));

/* ---------- 邀请朋友（只读访客） ---------- */
app.post("/api/invites", async req => {
  const t = auth.token(18), days = Math.min(+req.body?.days || 7, 90);
  await q("INSERT INTO invites(token,note,expires_at) VALUES ($1,$2, now() + $3::interval)", [t, String(req.body?.note || "").slice(0, 100), `${days} days`]);
  return { url: `/invite/${t}`, days };
});
app.get("/api/invites", async () => (await q(`SELECT i.token,i.note,i.created_at,i.expires_at,u.name AS used_by FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC`)).rows);
app.get("/api/users", async () => (await q("SELECT id,name,role,created_at FROM users ORDER BY id")).rows);
app.delete("/api/users/:id", async (req, reply) => {
  const r = await q("DELETE FROM users WHERE id=$1 AND role='viewer'", [req.params.id]);
  return r.rowCount ? { ok: true } : reply.code(400).send({ error: "无法删除" });
});
app.get("/invite/:token", async (req, reply) => {
  const user = await tx(async c => {
    const inv = (await c.query("SELECT * FROM invites WHERE token=$1 AND expires_at > now() AND used_by IS NULL FOR UPDATE", [req.params.token])).rows[0];
    if (!inv) return null;
    const name = (inv.note || "朋友") + "-" + crypto.randomBytes(2).toString("hex");
    const u = (await c.query("INSERT INTO users(name,role) VALUES ($1,'viewer') RETURNING id", [name])).rows[0];
    await c.query("UPDATE invites SET used_by=$1 WHERE token=$2", [u.id, inv.token]);
    return u;
  });
  if (!user) return reply.code(410).type("text/html").send("<meta charset=utf-8><p style='font:18px serif;text-align:center;margin-top:20vh'>邀请链接已失效或已被使用。</p>");
  reply.setCookie("sid", await auth.createSession(user.id), COOKIE);
  return reply.redirect("/");
});

/* ---------- 藏品 ---------- */
app.get("/api/items", () => listItems());
app.get("/api/items/:id", async (req, reply) => (await getItem(req.params.id)) || reply.code(404).send({ error: "找不到" }));
app.post("/api/items", async req => saveItem(slug(req.body?.alt || req.body?.name), req.body || {}));
app.put("/api/items/:id", async (req, reply) => {
  if (!(await q("SELECT 1 FROM items WHERE id=$1", [req.params.id])).rowCount) return reply.code(404).send({ error: "找不到" });
  return saveItem(req.params.id, req.body || {});
});
// 只改个人体验（状态/评分），不必提交整件藏品
app.patch("/api/items/:id", async (req, reply) => {
  const { status, rating } = req.body || {};
  const r = await q(`UPDATE items SET status=COALESCE($2,status), rating=COALESCE($3,rating), updated_at=now() WHERE id=$1`,
    [req.params.id, ["", "tried", "want"].includes(status) ? status : null, rating == null ? null : Math.max(0, Math.min(5, +rating | 0))]);
  return r.rowCount ? getItem(req.params.id) : reply.code(404).send({ error: "找不到" });
});
app.delete("/api/items/:id", async req => { await deleteItem(req.params.id); return { ok: true }; });
// 合并重复：from 并入 :id，然后删除 from
app.post("/api/items/:id/merge", async req => mergeItems(req.params.id, String(req.body?.from || "")));

/* ---------- 偏好设置（馆长）：如「不是重复」的忽略列表 ---------- */
const PREF_KEYS = new Set(["dupIgnore"]);
app.get("/api/prefs/:key", async (req, reply) => {
  if (!PREF_KEYS.has(req.params.key)) return reply.code(404).send({ error: "未知设置" });
  if (req.user.role !== "admin") return reply.code(403).send({ error: "只有馆长可以查看" });
  return (await q("SELECT value FROM settings WHERE key=$1", ["pref:" + req.params.key])).rows[0]?.value ?? null;
});
app.put("/api/prefs/:key", async (req, reply) => {
  if (!PREF_KEYS.has(req.params.key)) return reply.code(404).send({ error: "未知设置" });
  const v = JSON.stringify(req.body ?? null);
  if (v.length > 200000) return reply.code(413).send({ error: "内容过大" });
  await q("INSERT INTO settings(key,value,updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()", ["pref:" + req.params.key, v]);
  return { ok: true };
});

// 品尝日志字段清洗：笔记与价格至少填一项
function journalFields(b = {}) {
  const price = b.price === "" || b.price == null ? null : +b.price;
  const j = { date: b.date || new Date(), place: String(b.place || "").slice(0, 200), text: String(b.text || "").slice(0, 20000),
    price: Number.isFinite(price) && price >= 0 && price < 1e9 ? price : null,
    currency: String(b.currency || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3),
    amount: String(b.amount || "").slice(0, 50), shop: String(b.shop || "").slice(0, 200) };
  if (!j.text.trim() && j.price == null) throw Object.assign(new Error("请填写笔记或价格"), { statusCode: 400 });
  return j;
}
app.post("/api/items/:id/journal", async req => {
  const j = journalFields(req.body);
  await q("INSERT INTO journal(item_id,date,place,text,price,currency,amount,shop) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [req.params.id, j.date, j.place, j.text, j.price, j.currency, j.amount, j.shop]);
  await q("UPDATE items SET updated_at=now(), status=CASE WHEN status='' THEN 'tried' ELSE status END WHERE id=$1", [req.params.id]);
  return getItem(req.params.id);
});
app.put("/api/journal/:id", async (req, reply) => {
  const j = journalFields(req.body);
  const r = await q("UPDATE journal SET date=$2,place=$3,text=$4,price=$5,currency=$6,amount=$7,shop=$8 WHERE id=$1 RETURNING item_id",
    [req.params.id, j.date, j.place, j.text, j.price, j.currency, j.amount, j.shop]);
  return r.rowCount ? getItem(r.rows[0].item_id) : reply.code(404).send({ error: "找不到" });
});
app.delete("/api/journal/:id", async req => { await q("DELETE FROM journal WHERE id=$1", [req.params.id]); return { ok: true }; });

/* ---------- 媒体上传：流式写盘，数据库只记元数据 ---------- */
const MIME_OK = /^(image\/(jpeg|png|webp|gif|avif|heic)|video\/(mp4|webm|quicktime))$/;
const EXT = { "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/avif":"avif","image/heic":"heic","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov" };
async function storeStream(stream, mime, name) {
  const id = "m-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const d = new Date(), rel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${id}.${EXT[mime]}`;
  const abs = path.join(MEDIA_DIR, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await pipeline(stream, fs.createWriteStream(abs));
  if (stream.truncated) { await fsp.rm(abs, { force: true }); throw Object.assign(new Error(`文件超过 ${MAX_UPLOAD / 1048576}MB 上限`), { statusCode: 413 }); }
  const size = (await fsp.stat(abs)).size;
  const kind = mime.startsWith("video") ? "video" : "image";
  await q("INSERT INTO media(id,kind,name,file,mime,size) VALUES ($1,$2,$3,$4,$5,$6)", [id, kind, String(name || "").slice(0, 200), rel, mime, size]);
  const t = await makeThumb({ id, file: rel, kind, mime }).catch(e => (app.log.warn(`缩略图失败 ${id}: ${e.message}`), {}));
  return { id, kind, name, file: rel, thumb: t.thumb, w: t.width, h: t.height };
}
app.post("/api/media", async req => {
  const f = await req.file();
  if (!f) throw Object.assign(new Error("没有文件"), { statusCode: 400 });
  if (!MIME_OK.test(f.mimetype)) { f.file.resume(); throw Object.assign(new Error("不支持的文件类型：" + f.mimetype), { statusCode: 415 }); }
  return storeStream(f.file, f.mimetype, f.filename);
});

/* ---------- 导入 / 导出 ---------- */
// 兼容旧版纯前端导出的 JSON（含 mediaData 时一并还原图片视频）
app.post("/api/import", { bodyLimit: 2 * 1024 ** 3 }, async req => {
  const d = req.body || {};
  const items = Array.isArray(d) ? d : d.items;
  if (!Array.isArray(items)) throw Object.assign(new Error("格式不正确"), { statusCode: 400 });
  const mediaData = d.mediaData || {};
  let n = 0, files = 0;
  // 第一遍：写入藏品本体（暂不含关系），还原媒体
  for (const it of items) {
    if (!it?.id || !it?.name) continue;
    const media = [];
    for (const m of it.media || []) {
      if (m.url) { media.push(m); continue; }
      if (m.file && (await q("SELECT 1 FROM media WHERE id=$1", [m.id])).rowCount) { media.push(m); continue; }
      const data = mediaData[m.id]; if (!data) continue;
      const mt = /^data:([^;]+);base64,/.exec(data); if (!mt || !MIME_OK.test(mt[1])) continue;
      const { Readable } = await import("node:stream");
      const saved = await storeStream(Readable.from(Buffer.from(data.slice(mt[0].length), "base64")), mt[1], m.name);
      media.push({ ...saved, caption: m.caption || "" });
      if (it.body) it.body = it.body.replaceAll(`![[m:${m.id}]]`, `![[m:${saved.id}]]`);
      files++;
    }
    it.media = media;
    await saveItem(it.id, { ...it, relations: [] }, { created: it.created });
    for (const j of it.journal || []) {
      if (!j?.text && j?.price == null) continue;
      const f = journalFields(j);
      await q(`INSERT INTO journal(item_id,date,place,text,price,currency,amount,shop) SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM journal WHERE item_id=$1 AND date=$2 AND text=$4)`, [it.id, f.date, f.place, f.text, f.price, f.currency, f.amount, f.shop]);
    }
    n++;
  }
  // 第二遍：所有藏品就位后再写关系
  for (const it of items) if (it?.id && it.relations?.length) await saveItem(it.id, it);
  return { items: n, files };
});
app.get("/api/export", async (req, reply) => {
  reply.header("content-disposition", `attachment; filename="gastronomique-${new Date().toISOString().slice(0, 10)}.json"`);
  return { exportedAt: new Date().toISOString(), items: await listItems() };
});

/* ---------- AI：Claude / DeepSeek，密钥加密保存在服务器，仅馆长可用 ---------- */
const adminOnly = (req, reply) => { if (req.user?.role !== "admin") { reply.code(403).send({ error: "只有馆长可以使用" }); return false; } return true; };
app.get("/api/ai/config", async (req, reply) => adminOnly(req, reply) && ai.publicConfig());
app.put("/api/ai/config", async req => ai.saveConfig(req.body || {}));
app.post("/api/ai/test", async req => {
  const t0 = Date.now();
  const r = await ai.complete({ provider: req.body?.provider, prompt: "用不超过十个字回答：佛跳墙是哪里的菜？", maxTokens: 50 });
  return { ...r, ms: Date.now() - t0 };
});
app.post("/api/ai", async req => {
  const { prompt, system, provider } = req.body || {};
  return ai.complete({ prompt, system, provider });
});

/* ---------- AI 整理文档：文件 / 网址 / 文字 → 待审核的藏品与关系 ---------- */
const ORGANIZE_SYS = `你是一座私人食物博物馆的编目员。把用户提供的资料整理成藏品条目，忠实于原文：
- 只写资料中有的事实，不补充、不臆测；资料里的提醒、存疑与“不要误读”的说明要保留。
- 资料中的表格、图片（如有）里的信息同样要整理进对应条目。
- 用中文撰写；外文名放在 alt。
- 只输出 JSON，不要任何解释或代码块标记。`;
const ORGANIZE_SCHEMA = `{
 "items":[{"ref":"r1","type":"ingredient|dish|cuisine|beverage|restaurant|producer|region|culture|event|story",
  "name":"中文名","alt":"原文/外文名","region":"国家 · 地区","country":"ISO 3166-1 两位代码，如 NO、FR、CN；多国用 XX；不确定留空",
  "summary":"一句话","body":"正文，可用 [[名称]] 指向同批或已有藏品；表格内容逐条写清","story":"轶事或冷知识，没有则留空",
  "tags":["…"],"flavor":{"sweet":0,"sour":0,"salty":0,"bitter":0,"umami":0,"spicy":0,"rich":0,"aroma":0},
  "health":{"ingredients":["资料提到的主要配料"],"levels":{}},"existing":"若与已有藏品是同一事物，填已有藏品名称，否则留空"}],
 "relations":[{"from":"r1","to":"r2 或已有藏品名称","label":"产于|用于|属于菜系|代表菜|搭配|起源|生产|供应|相关"}],
 "notes":"整理说明：拆分思路、略去的内容、需要用户核实的地方"
}`;
const parseJsonLoose = t => {
  const s = String(t).replace(/^```(?:json)?\s*|\s*```$/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return JSON.parse(s.slice(a, b + 1));
};
app.post("/api/ai/organize", { bodyLimit: 2 * 1024 * 1024 }, async req => {
  const opts = {};
  let file = null;
  if (req.isMultipart()) {
    for await (const part of req.parts()) {
      if (part.type === "file") file = { buffer: await part.toBuffer(), filename: part.filename };
      else opts[part.fieldname] = part.value;
    }
  } else Object.assign(opts, req.body || {});
  const doc = await extract({ ...(file || {}), url: opts.url, text: opts.text });
  const provider = await ai.resolveProvider(opts.provider);
  const canSee = provider === "claude";
  const existing = (await q("SELECT name, alt FROM items ORDER BY name")).rows.map(r => r.alt ? `${r.name}（${r.alt}）` : r.name).join("、");
  const prompt = `资料来源：${doc.source}${doc.truncated ? "（过长，已截断）" : ""}
${opts.hint ? `整理要求：${opts.hint}\n` : ""}${canSee && doc.images.length ? `附带 ${doc.images.length} 份原件/图片，请一并阅读（正文中的 [图片N] 对应第 N 张）。\n` : ""}
已有藏品（避免重复；同一事物请在 existing 标注）：${existing}

按以下 JSON 结构输出：
${ORGANIZE_SCHEMA}

=== 资料正文 ===
${doc.text}`;
  const t0 = Date.now();
  const r = await ai.complete({ provider, system: ORGANIZE_SYS, prompt, maxTokens: 16000, timeoutMs: 300e3,
    attachments: canSee ? doc.images : [] });
  let data;
  try { data = parseJsonLoose(r.text); }
  catch { throw Object.assign(new Error("AI 返回的内容无法解析，请重试或缩短资料"), { statusCode: 502, expose: true }); }
  return { source: doc.source, chars: doc.chars, truncated: doc.truncated, images: doc.images.length, imagesUsed: canSee ? doc.images.length : 0,
    provider: r.provider, model: r.model, ms: Date.now() - t0,
    items: Array.isArray(data.items) ? data.items : [], relations: Array.isArray(data.relations) ? data.relations : [], notes: data.notes || "" };
});

/* ---------- 版本号与 Service Worker（离线缓存） ---------- */
// 版本 = 前端文件内容的哈希；文件变化即视为新版本
const SHELL = ["index.html", "app.js", "share.js", "styles.css", "manifest.webmanifest", "sw.js"];
let verCache = { at: 0, v: "" };
async function appVersion() {
  if (Date.now() - verCache.at < 5000) return verCache.v;
  const h = crypto.createHash("sha1");
  for (const f of SHELL) h.update(await fsp.readFile(path.join(PUBLIC_DIR, f)).catch(() => ""));
  verCache = { at: Date.now(), v: h.digest("hex").slice(0, 12) };
  return verCache.v;
}
app.get("/api/version", async (req, reply) => { reply.header("cache-control", "no-store"); return { version: await appVersion() }; });
app.get("/sw.js", async (req, reply) => {
  const src = await fsp.readFile(path.join(PUBLIC_DIR, "sw.js"), "utf8");
  reply.header("cache-control", "no-cache").type("text/javascript; charset=utf-8");
  return src.replace("__VERSION__", await appVersion());
});

/* ---------- 启动 ---------- */
async function seedIfEmpty() {
  if ((await q("SELECT 1 FROM items LIMIT 1")).rowCount || process.env.SEED === "false") return;
  const ctx = { window: {} };
  vm.runInNewContext(await fsp.readFile(path.join(PUBLIC_DIR, "seed.js"), "utf8"), ctx);
  const seed = ctx.window.SEED || [];
  for (const it of seed) await saveItem(it.id, { ...it, relations: [] });
  for (const it of seed) if (it.relations?.length) await saveItem(it.id, it);
  app.log.info(`已载入 ${seed.length} 件示例藏品`);
}

await migrate(app.log);
await auth.ensureAdmin(app.log);
await seedIfEmpty();
await cleanupOrphans();
backfillThumbs(app.log).catch(e => app.log.error(e));
setInterval(() => cleanupOrphans().catch(e => app.log.error(e)), 3600e3).unref();

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on("SIGTERM", close); process.on("SIGINT", close);
await app.listen({ port: PORT, host: "0.0.0.0" });

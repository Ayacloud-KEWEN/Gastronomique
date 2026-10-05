// 冒烟测试：node --env-file=.env scripts/smoke-test.mjs [http://localhost:5010]
const B = process.argv[2] || "http://localhost:5010";
let cookie = "", ok = 0, bad = 0;
const check = (name, cond, extra = "") => { cond ? ok++ : bad++; console.log(`${cond ? "✓" : "✗"} ${name} ${extra}`); };
async function call(path, { method = "GET", body, jar = "admin", form } = {}) {
  const headers = {};
  if (jar === "admin" && cookie) headers.cookie = cookie;
  if (jar && jar !== "admin") headers.cookie = jar;
  let b;
  if (form) b = form; else if (body !== undefined) { headers["content-type"] = "application/json"; b = JSON.stringify(body); }
  const r = await fetch(B + path, { method, headers, body: b, redirect: "manual" });
  const set = r.headers.get("set-cookie");
  const txt = await r.text(); let json; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, set: set && set.split(";")[0], headers: r.headers };
}

check("未登录被拒", (await call("/api/items", { jar: null })).status === 401);
const login = await call("/api/login", { method: "POST", body: { name: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASSWORD }, jar: null });
cookie = login.set; check("管理员登录", login.status === 200);
check("错误密码", (await call("/api/login", { method: "POST", body: { name: "admin", password: "x" }, jar: null })).status === 401);

const items = (await call("/api/items")).json;
check("列表", items.length >= 13, `${items.length} 件`);

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData(); fd.append("file", new Blob([png], { type: "image/png" }), "t.png");
const up = await call("/api/media", { method: "POST", form: fd });
check("上传图片", up.status === 200 && up.json.file, up.json?.file);
check("图片缩略图", up.json.thumb?.includes("/thumbs/") && (await fetch(`${B}/media/${up.json.thumb}`, { headers: { cookie } })).headers.get("content-type") === "image/webp", up.json.thumb);

// 大图：应缩到长边 640
const { default: sharp } = await import(new URL("../server/node_modules/sharp/lib/index.js", import.meta.url));
const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#a05030" } }).jpeg().toBuffer();
const fdb = new FormData(); fdb.append("file", new Blob([big], { type: "image/jpeg" }), "big.jpg");
const upb = (await call("/api/media", { method: "POST", form: fdb })).json;
const tb = Buffer.from(await (await fetch(`${B}/media/${upb.thumb}`, { headers: { cookie } })).arrayBuffer());
const tm = await sharp(tb).metadata();
check("大图缩略到 640", tm.width === 640 && tm.height === 427 && upb.w === 3000 && upb.h === 2000, `${tm.width}x${tm.height}，原图 ${upb.w}x${upb.h}，${(big.length/1024)|0}KB → ${(tb.length/1024)|0}KB`);

// 视频：需要传入 TEST_MP4 文件路径
if (process.env.TEST_MP4) {
  const { readFile } = await import("node:fs/promises");
  const fdv = new FormData(); fdv.append("file", new Blob([await readFile(process.env.TEST_MP4)], { type: "video/mp4" }), "v.mp4");
  const upv = (await call("/api/media", { method: "POST", form: fdv })).json;
  check("视频封面帧", upv.kind === "video" && upv.thumb?.endsWith(".webp") && upv.w > 0, `${upv.thumb} ${upv.w}x${upv.h}`);
}

const bad1 = new FormData(); bad1.append("file", new Blob(["x"], { type: "text/plain" }), "a.txt");
check("拒绝非媒体文件", (await call("/api/media", { method: "POST", form: bad1 })).status === 415);

const created = await call("/api/items", { method: "POST", body: { type: "dish", name: "测试菜", body: `![[m:${up.json.id}]]`, relations: [{ to: "fuzhou", label: "起源" }], media: [{ id: up.json.id, caption: "封面" }], flavor: { umami: 9 } } });
const it = created.json;
check("新建藏品", created.status === 200 && it.media.length === 1 && it.relations[0]?.to === "fuzhou" && it.flavor.umami === 5, it?.id);

const mres = await fetch(`${B}/media/${it.media[0].file}`, { headers: { cookie } });
check("登录后可访问媒体", mres.status === 200 && mres.headers.get("content-type") === "image/png");
check("未登录不能访问媒体", (await fetch(`${B}/media/${it.media[0].file}`)).status === 401);
const range = await fetch(`${B}/media/${it.media[0].file}`, { headers: { cookie, range: "bytes=0-9" } });
check("支持 Range（视频拖动）", range.status === 206);

const p = await call(`/api/items/${it.id}`, { method: "PATCH", body: { rating: 4, status: "tried" } });
check("评分", p.json.rating === 4 && p.json.status === "tried");
const j = await call(`/api/items/${it.id}/journal`, { method: "POST", body: { date: "2026-10-05", place: "家", text: "好吃" } });
check("写日志", j.json.journal.length === 1);
check("删日志", (await call(`/api/journal/${j.json.journal[0].id}`, { method: "DELETE" })).status === 200);

const upd = await call(`/api/items/${it.id}`, { method: "PUT", body: { ...it, media: [], body: "" } });
check("移除媒体", upd.json.media.length === 0);
check("移除后文件被删", (await fetch(`${B}/media/${it.media[0].file}`, { headers: { cookie } })).status === 404);

const inv = await call("/api/invites", { method: "POST", body: { note: "小林", days: 3 } });
const acc = await call(inv.json.url, { jar: null });
check("邀请链接登录", acc.status === 302 && acc.set);
const viewer = acc.set;
const vme = await call("/api/me", { jar: viewer });
check("访客身份", vme.json.user?.role === "viewer", vme.json.user?.name);
check("访客可读", (await call("/api/items", { jar: viewer })).status === 200);
check("访客不能写", (await call(`/api/items/${it.id}`, { method: "PATCH", body: { rating: 1 }, jar: viewer })).status === 403);
check("邀请只能用一次", (await call(inv.json.url, { jar: null })).status === 410);

const imp = await call("/api/import", { method: "POST", body: {
  items: [{ id: "old-1", type: "ingredient", name: "旧数据", body: "看图\n![[m:m-old]]", media: [{ id: "m-old", kind: "image", name: "a.png", caption: "旧图" }],
    journal: [{ date: "2026-01-02", text: "好吃" }], relations: [{ to: "comte", label: "相关" }] }],
  mediaData: { "m-old": "data:image/png;base64," + png.toString("base64") } } });
const old = (await call("/api/items/old-1")).json;
check("导入旧版备份", imp.json?.files === 1 && old.media.length === 1 && old.journal.length === 1 && old.relations.length === 1 && old.body.includes(old.media[0].id), JSON.stringify(imp.json));

check("删除藏品", (await call(`/api/items/${it.id}`, { method: "DELETE" })).status === 200);
await call("/api/items/old-1", { method: "DELETE" });
check("导出", (await call("/api/export")).json.items.length >= 13);
console.log(`\n${ok} 通过，${bad} 失败`);
process.exit(bad ? 1 : 0);

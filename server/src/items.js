import fs from "node:fs/promises";
import path from "node:path";
import { q, tx } from "./db.js";

export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "./data/media");
const TYPES = ["ingredient","dish","cuisine","beverage","restaurant","producer","region","culture","event","story"];
const FLAVOR_KEYS = ["sweet","sour","salty","bitter","umami","spicy","rich","aroma"];
// 营养水平只记 0 未填 / 1 少 / 2 适中 / 3 多
const LEVEL_KEYS = ["energy","fat","protein","carb","sugar","sodium"];
const PORTIONS = ["","一口","一小份","一份","一餐","一杯","100g"];

// 统一输出给前端的形状
const SELECT = `
SELECT i.*,
  COALESCE((SELECT json_agg(json_build_object('to',r.to_id,'label',r.label) ORDER BY r.pos) FROM relations r WHERE r.from_id=i.id),'[]') AS relations,
  COALESCE((SELECT json_agg(json_build_object('id',j.id,'date',to_char(j.date,'YYYY-MM-DD'),'place',j.place,'text',j.text,'price',j.price::float8,'currency',j.currency,'amount',j.amount,'shop',j.shop) ORDER BY j.date, j.id) FROM journal j WHERE j.item_id=i.id),'[]') AS journal,
  COALESCE((SELECT json_agg(json_build_object('id',m.id,'kind',m.kind,'name',m.name,'caption',m.caption,'file',m.file,'url',m.url,'thumb',m.thumb,'w',m.width,'h',m.height) ORDER BY m.pos) FROM media m WHERE m.item_id=i.id),'[]') AS media
FROM items i`;
const shape = r => ({
  id:r.id, type:r.type, name:r.name, alt:r.alt, region:r.region, country:r.country, tags:r.tags, status:r.status, rating:r.rating,
  flavor:r.flavor, health:r.health, geo:r.geo, summary:r.summary, body:r.body, story:r.story, source:r.source,
  created:r.created_at.toISOString(), updated:r.updated_at.toISOString(),
  relations:r.relations, journal:r.journal, media:r.media,
});

export async function listItems() { return (await q(`${SELECT} ORDER BY i.updated_at DESC`)).rows.map(shape); }
export async function getItem(id) { const r = (await q(`${SELECT} WHERE i.id=$1`, [id])).rows[0]; return r && shape(r); }

// 输入校验与清洗
const str = (v, max = 20000) => String(v ?? "").slice(0, max);
export function clean(d) {
  if (!TYPES.includes(d.type)) throw Object.assign(new Error("无效的类别"), { statusCode: 400 });
  const name = str(d.name, 200).trim();
  if (!name) throw Object.assign(new Error("名称不能为空"), { statusCode: 400 });
  const flavor = {};
  for (const k of FLAVOR_KEYS) flavor[k] = Math.max(0, Math.min(5, Math.round(+d.flavor?.[k] || 0)));
  const h = d.health || {}, levels = {};
  for (const k of LEVEL_KEYS) { const v = Math.round(+h.levels?.[k] || 0); if (v >= 1 && v <= 3) levels[k] = v; }
  const kcal = Math.round(+h.kcal || 0);
  const list = (a, n, len) => (Array.isArray(a) ? a : []).map(x => str(x, len).trim()).filter(Boolean).slice(0, n);
  const health = {
    ingredients: list(h.ingredients, 20, 40), levels, tags: list(h.tags, 12, 20),
    ...(kcal > 0 && kcal < 10000 ? { kcal } : {}),
    ...(PORTIONS.includes(h.portion) && h.portion ? { portion: h.portion } : {}),
    ...(h.note ? { note: str(h.note, 300) } : {}),
  };
  // 坐标：经纬度必须在有效范围内，否则视为未填
  const lat = +d.geo?.lat, lng = +d.geo?.lng;
  const geo = d.geo && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)
    ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, ...(d.geo.label ? { label: str(d.geo.label, 200) } : {}) } : null;
  return {
    type: d.type, name, health, geo, alt: str(d.alt, 200), region: str(d.region, 200),
    country: /^[A-Z]{2}$/.test(String(d.country || "").toUpperCase()) ? String(d.country).toUpperCase() : "",
    tags: (Array.isArray(d.tags) ? d.tags : []).map(t => str(t, 50).trim()).filter(Boolean).slice(0, 50),
    status: ["tried","want"].includes(d.status) ? d.status : "",
    rating: Math.max(0, Math.min(5, Math.round(+d.rating || 0))),
    flavor, summary: str(d.summary, 1000), body: str(d.body, 100000), story: str(d.story, 20000), source: str(d.source, 1000),
    relations: (Array.isArray(d.relations) ? d.relations : []).filter(r => r?.to).map(r => ({ to: str(r.to, 100), label: str(r.label, 50) || "相关" })),
    media: (Array.isArray(d.media) ? d.media : []).filter(m => m?.id),
  };
}

export const slug = s => (s || "item").toLowerCase().replace(/[^\w一-龥]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);

// 新建或整体更新一件藏品（不含日志）。返回被移除、需要从磁盘删除的媒体文件
export async function saveItem(id, raw, { created } = {}) {
  const d = clean(raw);
  const removedFiles = await tx(async c => {
    await c.query(`
      INSERT INTO items(id,type,name,alt,region,tags,status,rating,flavor,summary,body,story,source,created_at,updated_at,health,geo,country)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz,now()),now(),$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET type=$2,name=$3,alt=$4,region=$5,tags=$6,status=$7,rating=$8,flavor=$9,
        summary=$10,body=$11,story=$12,source=$13,health=$15,geo=$16,country=$17,updated_at=now()`,
      [id, d.type, d.name, d.alt, d.region, d.tags, d.status, d.rating, d.flavor, d.summary, d.body, d.story, d.source, created || null, d.health, d.geo, d.country]);

    await c.query("DELETE FROM relations WHERE from_id=$1", [id]);
    let pos = 0;
    for (const r of d.relations) {
      if (r.to === id) continue;
      await c.query(`INSERT INTO relations(from_id,to_id,label,pos) SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM items WHERE id=$2)
        ON CONFLICT DO NOTHING`, [id, r.to, r.label, pos++]);
    }

    // 媒体：列表中的挂到本藏品并排序；原先挂着但不在列表中的删除
    const keep = d.media.map(m => str(m.id, 100));
    const gone = await c.query("DELETE FROM media WHERE item_id=$1 AND NOT (id = ANY($2)) RETURNING file, thumb", [id, keep]);
    for (const [i, m] of d.media.entries()) {
      if (m.url && !m.file) {
        await c.query(`INSERT INTO media(id,item_id,pos,kind,name,caption,url) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET item_id=$2,pos=$3,caption=$6`,
          [str(m.id, 100), id, i, m.kind === "video" ? "video" : "image", str(m.name, 200), str(m.caption, 500), str(m.url, 2000)]);
      } else {
        await c.query("UPDATE media SET item_id=$2,pos=$3,caption=$4 WHERE id=$1 AND (item_id IS NULL OR item_id=$2)", [str(m.id, 100), id, i, str(m.caption, 500)]);
      }
    }
    return gone.rows.flatMap(r => [r.file, r.thumb]).filter(Boolean);
  });
  await removeFiles(removedFiles);
  return getItem(id);
}

export async function deleteItem(id) {
  const files = await tx(async c => {
    const m = await c.query("DELETE FROM media WHERE item_id=$1 RETURNING file, thumb", [id]);
    await c.query("DELETE FROM items WHERE id=$1", [id]);
    return m.rows.flatMap(r => [r.file, r.thumb]).filter(Boolean);
  });
  await removeFiles(files);
}

export async function removeFiles(files) {
  for (const f of files) {
    const p = path.join(MEDIA_DIR, f);
    if (!p.startsWith(MEDIA_DIR)) continue;
    await fs.rm(p, { force: true }).catch(() => {});
  }
}

// 清理上传后 24 小时仍未关联到藏品的媒体
export async function cleanupOrphans() {
  const r = await q("DELETE FROM media WHERE item_id IS NULL AND created_at < now() - interval '1 day' RETURNING file, thumb");
  await removeFiles(r.rows.flatMap(x => [x.file, x.thumb]).filter(Boolean));
  await q("DELETE FROM sessions WHERE expires_at < now()");
}

// 合并两件藏品：把 from 的日志、媒体、关系与缺失字段并入 keep，然后删除 from
export async function mergeItems(keepId, fromId) {
  if (keepId === fromId) throw Object.assign(new Error("不能与自己合并"), { statusCode: 400 });
  const [k, f] = await Promise.all([getItem(keepId), getItem(fromId)]);
  if (!k || !f) throw Object.assign(new Error("找不到藏品"), { statusCode: 404 });
  const uniq = a => [...new Set(a.filter(Boolean))];
  const appendText = (a, b) => !b || (a || "").includes(b) ? (a || "") : a ? `${a}\n\n${b}` : b;
  const hasF = x => Object.values(x || {}).some(v => +v > 0);
  const rank = { tried: 2, want: 1, "": 0 };
  const kh = k.health || {}, fh = f.health || {};
  const merged = {
    alt: k.alt || (f.name !== k.name ? f.name : f.alt) || "",
    region: k.region || f.region, country: k.country || f.country,
    summary: k.summary || f.summary, source: uniq([k.source, f.source]).join("；").slice(0, 1000),
    body: appendText(k.body, f.body), story: appendText(k.story, f.story),
    tags: uniq([...(k.tags || []), ...(f.tags || [])]).slice(0, 50),
    flavor: hasF(k.flavor) ? k.flavor : f.flavor,
    health: { ...fh, ...kh,
      ingredients: uniq([...(kh.ingredients || []), ...(fh.ingredients || [])]).slice(0, 20),
      tags: uniq([...(kh.tags || []), ...(fh.tags || [])]).slice(0, 12),
      levels: { ...(fh.levels || {}), ...(kh.levels || {}) } },
    geo: k.geo || f.geo,
    status: rank[f.status] > rank[k.status] ? f.status : k.status,
    rating: Math.max(k.rating || 0, f.rating || 0),
    created: [k.created, f.created].sort()[0],
  };
  await tx(async c => {
    await c.query(`UPDATE items SET alt=$2,region=$3,country=$4,summary=$5,source=$6,body=$7,story=$8,tags=$9,flavor=$10,health=$11,geo=$12,
      status=$13,rating=$14,created_at=$15,updated_at=now() WHERE id=$1`,
      [keepId, merged.alt, merged.region, merged.country, merged.summary, merged.source, merged.body, merged.story, merged.tags,
       merged.flavor, merged.health, merged.geo, merged.status, merged.rating, merged.created]);
    await c.query("UPDATE journal SET item_id=$1 WHERE item_id=$2", [keepId, fromId]);
    await c.query("UPDATE media SET item_id=$1, pos=pos+1000 WHERE item_id=$2", [keepId, fromId]);
    // 关系：转移出边与入边，跳过自环与已存在的边
    await c.query(`UPDATE relations r SET from_id=$1 WHERE from_id=$2 AND to_id<>$1
      AND NOT EXISTS (SELECT 1 FROM relations x WHERE x.from_id=$1 AND x.to_id=r.to_id)`, [keepId, fromId]);
    await c.query(`UPDATE relations r SET to_id=$1 WHERE to_id=$2 AND from_id<>$1
      AND NOT EXISTS (SELECT 1 FROM relations x WHERE x.to_id=$1 AND x.from_id=r.from_id)`, [keepId, fromId]);
    // 其他藏品正文里指向 from 的 [[链接]] 改指 keep
    for (const n of uniq([f.name, f.alt])) if (n !== k.name)
      await c.query("UPDATE items SET body=replace(body,$1,$2) WHERE body LIKE '%' || $1 || '%'", [`[[${n}]]`, `[[${k.name}]]`]);
    await c.query("DELETE FROM items WHERE id=$1", [fromId]);
  });
  return getItem(keepId);
}

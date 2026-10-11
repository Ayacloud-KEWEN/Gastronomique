// 菜单扫描：拍照 → AI 识别翻译 → 与馆藏比对（本地名称比对 + AI 语义比对） → 新菜进草稿箱
import { q } from "./db.js";
import * as ai from "./ai.js";

const TYPES = ["ingredient","dish","cuisine","beverage","restaurant","producer","region","culture","event","story"];
const bad = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code, expose: true });
const parseJsonLoose = t => {
  const s = String(t).replace(/^```(?:json)?\s*|\s*```$/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return JSON.parse(s.slice(a, b + 1));
};
const str = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const list = (a, n = 12, len = 40) => (Array.isArray(a) ? a : []).map(x => str(x, len)).filter(Boolean).slice(0, n);

// 名称归一化与二元组相似度（与前端疑似重复检测一致）
const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[\s·・\-–—_'’"“”.,，。、()（）\[\]【】/«»]+/g, "");
const bigrams = s => { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; };
const dice = (a, b) => {
  if (a.length < 2 || b.length < 2) return a === b && a ? 1 : 0;
  const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++;
  return 2 * n / (A.size + B.size);
};
const altParts = s => String(s || "").split(/\s*[·/|,，、]\s*/).filter(Boolean);

/* ---------- 1. 识别与翻译 ---------- */
const READ_SYS = `你是一位精通各国菜单的美食翻译。阅读用户拍摄的餐厅菜单照片，逐道列出菜品：
- 原文菜名照抄（保留重音符号）；中文名要地道、简洁，常见菜用通行译名。
- note 用一两句中文说明这道菜是什么、主要食材和做法，菜单上的配菜、酱汁也写进去；遇到厨房术语顺带解释。
- 看不清的字不要编造，宁可留空；同一道菜只列一次；饮品与酒也要列出（type 用 beverage）。
- 另把菜单里出现的厨房术语、做法与状态用语单独列在 terms（如 à la plancha、confit、meunière、al dente、tataki），不要把普通食材名当术语。
- 只输出 JSON，不要任何解释或代码块标记。`;
const READ_SCHEMA = `{"restaurant":"菜单上能看到的餐厅名，看不到留空","language":"菜单语言，如 法语",
 "dishes":[{"orig":"原文菜名","zh":"中文名","note":"说明","price":"价格原样，如 18 €，没有留空","section":"所在分区，如 前菜","type":"dish|beverage|ingredient","ingredients":["主要食材（中文）"],"tags":["如 法国菜、海鲜"]}],
 "terms":[{"term":"术语原文","lang":"语言，如 法语","zh":"中文译名","explain":"一两句解释：是什么做法或状态","example":"菜单上用到它的一道菜原文"}]}`;

async function readMenu(images, provider, hint) {
  const r = await ai.complete({ provider, system: READ_SYS, attachments: images, maxTokens: 16000, timeoutMs: 240e3,
    prompt: `共 ${images.length} 张菜单照片。${hint ? `补充说明：${hint}\n` : ""}按以下 JSON 结构输出：\n${READ_SCHEMA}` });
  let d;
  try { d = parseJsonLoose(r.text); } catch { throw bad("AI 返回的菜单无法解析，请重拍或少放几张照片后再试", 502); }
  const dishes = (Array.isArray(d.dishes) ? d.dishes : []).map(x => ({
    orig: str(x.orig, 200), name: str(x.zh, 200) || str(x.orig, 200), note: str(x.note, 600), price: str(x.price, 40),
    section: str(x.section, 40), type: TYPES.includes(x.type) ? x.type : "dish", ingredients: list(x.ingredients), tags: list(x.tags, 8, 30),
  })).filter(x => x.name).slice(0, 120);
  const seen = new Set();
  const terms = (Array.isArray(d.terms) ? d.terms : []).map(x => ({
    // 语言只留第一个，如「法语（源自西班牙语）」→「法语」，术语表按它分组
    term: str(x.term, 100), lang: (str(x.lang, 40).match(/[一-鿿]{1,6}语/) || [str(x.lang, 20)])[0], name: str(x.zh, 100), note: str(x.explain, 400), example: str(x.example, 200),
  })).filter(x => x.term && !seen.has(norm(x.term)) && seen.add(norm(x.term))).slice(0, 40);
  return { restaurant: str(d.restaurant, 200), language: str(d.language, 40), dishes, terms, model: r.model, provider: r.provider };
}

/* ---------- 2. 与馆藏比对 ---------- */
// 本地打分：名称相似度，加上食材 / 名称互相包含
function score(dish, it) {
  const dn = [dish.name, dish.orig].map(norm).filter(Boolean);
  // 名称本身、括号里的别名（如「峨螺（海螺）」）与外文名都参与比对
  const inames = [it.name, ...String(it.name).split(/[（）()]/), ...altParts(it.alt)].map(norm).filter(s => s.length >= 2);
  let best = 0;
  for (const a of dn) for (const b of inames) best = Math.max(best, dice(a, b));
  const text = norm([dish.name, dish.orig, dish.note, ...dish.ingredients].join(" "));
  // 「提到」：中文名至少 2 字；外文名至少 4 个字母，避免 Uni 命中 meunière 这类巧合
  const mention = inames.some(b => b.length >= (/[぀-鿿]/.test(b) ? 2 : 4) && text.includes(b));
  return { name: best, mention };
}

const MATCH_SYS = `你是一座私人食物博物馆的编目员。判断餐厅菜单上的每道菜与馆藏条目的关系：
- same：菜单上这道菜与该条目就是同一道菜（允许叫法、语言不同；同一菜式的不同店家版本也算同一道）。
- related：不是同一道菜，但条目是它的主要食材、所属菜系、同类菜或做法，值得一并展示；最多 3 个。
- 只从给出的候选中选，不确定就不选。只输出 JSON。`;

export async function matchMenu(dishes, provider) {
  // 只和具体的食物比对；海报、指南、地区这类总条目会关联到几乎每道菜，反而成了干扰
  const items = (await q("SELECT id, type, name, alt, summary FROM items WHERE type IN ('ingredient','dish','beverage','cuisine')")).rows;
  const byId = new Map(items.map(x => [x.id, x]));
  const out = dishes.map(() => ({ same: null, related: [] }));
  const pool = new Map();   // 交给 AI 的候选
  const todo = [];
  dishes.forEach((d, i) => {
    const ranked = items.map(it => ({ it, s: score(d, it) })).filter(o => o.s.name >= 0.35 || o.s.mention)
      .sort((a, b) => (b.s.name + (b.s.mention ? 0.3 : 0)) - (a.s.name + (a.s.mention ? 0.3 : 0)));
    // 名称几乎一致：直接认定为同一道菜，不必问 AI
    if (ranked[0] && ranked[0].s.name >= 0.88 && ["dish","beverage","ingredient"].includes(ranked[0].it.type) === ["dish","beverage","ingredient"].includes(d.type)) {
      out[i].same = ranked[0].it.id; out[i].by = "name";
      out[i].related = ranked.slice(1).filter(o => o.s.mention).slice(0, 3).map(o => o.it.id);
      return;
    }
    if (!ranked.length) return;
    todo.push(i);
    for (const o of ranked.slice(0, 6)) pool.set(o.it.id, o.it);
  });
  if (todo.length && pool.size) {
    const cands = [...pool.values()].slice(0, 150);
    const prompt = `馆藏候选（id | 类别 | 名称 | 外文名 | 简介）：
${cands.map(c => `${c.id} | ${c.type} | ${c.name} | ${c.alt || ""} | ${String(c.summary || "").slice(0, 60)}`).join("\n")}

菜单上的菜（序号 | 原文 | 中文 | 说明）：
${todo.map(i => `${i} | ${dishes[i].orig} | ${dishes[i].name} | ${dishes[i].note.slice(0, 120)}`).join("\n")}

按 JSON 输出：{"matches":[{"i":序号,"same":"候选 id 或 null","related":["候选 id"]}]}`;
    try {
      const r = await ai.complete({ provider, system: MATCH_SYS, prompt, maxTokens: 16000, timeoutMs: 180e3 });
      for (const m of parseJsonLoose(r.text).matches || []) {
        const i = +m.i; if (!todo.includes(i)) continue;
        if (m.same && pool.has(m.same)) { out[i].same = m.same; out[i].by = "ai"; }
        out[i].related = list(m.related, 3, 100).filter(id => pool.has(id) && id !== out[i].same);
      }
    } catch (e) {
      // 语义比对失败时退回本地结果：只给「相关」，不做同一道菜的认定
      for (const i of todo) out[i].related = items.map(it => ({ it, s: score(dishes[i], it) })).filter(o => o.s.mention).slice(0, 3).map(o => o.it.id);
      out.warning = `语义比对失败，已退回名称比对：${e.message}`;
    }
  }
  const brief = id => { const x = byId.get(id); return x && { id: x.id, name: x.name, type: x.type }; };
  return { results: out.map(o => ({ same: o.same && brief(o.same), by: o.by || "", related: o.related.map(brief).filter(Boolean) })), warning: out.warning || "" };
}

/* ---------- 术语：与「菜单术语」藏品比对，并标出每道菜用到的术语 ---------- */
export const TERM_TAG = "菜单术语";
export async function matchTerms(terms, dishes) {
  const known = (await q("SELECT id, name, alt FROM items WHERE $1 = ANY(tags)", [TERM_TAG])).rows
    .map(x => ({ ...x, keys: [x.name, ...altParts(x.alt)].map(norm).filter(k => k.length >= 3) }));
  const find = t => known.find(k => k.keys.includes(norm(t)));
  const out = terms.map(t => { const k = find(t.term); return { ...t, known: k ? { id: k.id, name: k.name } : null }; });
  // 菜名原文里出现的术语（本次识别的 + 已收录的），用于在结果页标出
  const all = [...out.map(t => ({ key: norm(t.term), term: t.term, id: t.known?.id || "" })),
               ...known.flatMap(k => k.keys.map(key => ({ key, term: k.alt.split(/\s*[·/|]\s*/)[0] || k.name, id: k.id })))];
  const perDish = dishes.map(d => { const o = norm(d.orig); const hit = new Map();
    for (const a of all) if (a.key.length >= 3 && o.includes(a.key) && !hit.has(a.key)) hit.set(a.key, { term: a.term, id: a.id });
    return [...hit.values()]; });
  return { terms: out, perDish };
}

export async function scanMenu({ images = [], provider, hint = "" } = {}) {
  images = (Array.isArray(images) ? images : []).filter(x => /^image\/(jpeg|png|webp|gif)$/.test(x?.mime) && typeof x.data === "string").slice(0, 8)
    .map(x => ({ kind: "image", mime: x.mime, data: x.data }));
  if (!images.length) throw bad("请至少拍一张菜单照片");
  const p = await ai.resolveProvider(provider);
  if (!p) throw bad("尚未配置 AI：请在「AI 探索 → ⚙ 设置」中填写 API Key", 501);
  if (!ai.canSee(p)) throw bad("当前 AI 不能读取图片");
  const t0 = Date.now();
  const menu = await readMenu(images, p, str(hint, 300));
  const m = await matchMenu(menu.dishes, p);
  const t = await matchTerms(menu.terms, menu.dishes);
  return { ...menu, terms: t.terms, dishes: menu.dishes.map((d, i) => ({ ...d, ...m.results[i], terms: t.perDish[i] })), warning: m.warning, ms: Date.now() - t0 };
}

/* ---------- 3. 草稿箱 ---------- */
const shapeDraft = r => ({ id: String(r.id), name: r.name, orig: r.orig, note: r.note, price: r.price, section: r.section, type: r.type,
  tags: r.tags, ingredients: r.ingredients, related: r.related, restaurantId: r.restaurant_id || "", restaurantName: r.restaurant_name,
  ordered: r.ordered, date: r.scanned_on.toISOString().slice(0, 10), created: r.created_at.toISOString() });

export async function listDrafts() {
  return (await q("SELECT * FROM drafts ORDER BY created_at DESC, id")).rows.map(shapeDraft);
}

// 批量加入；同一家餐厅里同名（原文或中文）的菜不重复加入
export async function addDrafts({ dishes = [], restaurantId = "", restaurantName = "" } = {}) {
  const rid = str(restaurantId, 100) && (await q("SELECT 1 FROM items WHERE id=$1", [restaurantId])).rowCount ? restaurantId : null;
  const rname = str(restaurantName, 200);
  const have = (await q("SELECT name, orig, restaurant_id, restaurant_name FROM drafts")).rows;
  const sameRest = h => rid ? h.restaurant_id === rid : !h.restaurant_id && h.restaurant_name === rname;
  let added = 0, skipped = 0;
  for (const d of (Array.isArray(dishes) ? dishes : []).slice(0, 200)) {
    const name = str(d.name, 200); if (!name) continue;
    const orig = str(d.orig, 200);
    if (have.some(h => sameRest(h) && (norm(h.name) === norm(name) || (orig && norm(h.orig) === norm(orig))))) { skipped++; continue; }
    await q(`INSERT INTO drafts(name,orig,note,price,section,type,tags,ingredients,related,restaurant_id,restaurant_name,ordered)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [name, orig, str(d.note, 600), str(d.price, 40), str(d.section, 40), TYPES.includes(d.type) ? d.type : "dish",
       list(d.tags, 8, 30), list(d.ingredients), list(d.related, 5, 100), rid, rname, !!d.ordered]);
    have.push({ name, orig, restaurant_id: rid, restaurant_name: rname }); added++;
  }
  return { added, skipped };
}

export async function deleteDrafts(ids = []) {
  const n = (Array.isArray(ids) ? ids : [ids]).map(x => +x).filter(Number.isInteger);
  if (!n.length) return { deleted: 0 };
  return { deleted: (await q("DELETE FROM drafts WHERE id = ANY($1::bigint[])", [n])).rowCount };
}

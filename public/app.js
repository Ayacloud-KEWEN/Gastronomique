/* Gastronomique · 私人食物博物馆
 * 前端：通过 /api 读写服务器上的 PostgreSQL，媒体文件存放在服务器 /media。 */
(() => {
const TYPES = {
  ingredient:{zh:"食材",en:"Ingredient"}, dish:{zh:"菜品",en:"Dish"}, cuisine:{zh:"菜系",en:"Cuisine"}, beverage:{zh:"饮品",en:"Beverage"},
  restaurant:{zh:"餐馆",en:"Restaurant"}, producer:{zh:"生产者",en:"Producer"}, region:{zh:"地区",en:"Region"},
  culture:{zh:"文化",en:"Culture"}, event:{zh:"事件",en:"Event"}, story:{zh:"故事",en:"Story"},
};
const FLAVORS = {sweet:"甜",sour:"酸",salty:"咸",bitter:"苦",umami:"鲜",spicy:"辣",rich:"醇厚",aroma:"香气"};
const REL_LABELS = ["产于","用于","属于菜系","代表菜","搭配","起源","后裔","同源现象","东西对照","生产","供应","出现于","相关"];
const QUOTES = [
  "“告诉我你吃什么，我就能说出你是什么样的人。” — Brillat-Savarin",
  "“发现一道新菜比发现一颗新星更能造福人类。” — Brillat-Savarin",
  "“烹饪是关于记忆的艺术。”",
  "“每一种食材都携带着一片土地的地址。”",
];
const CFG = "gastronomique.cfg";
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const tc = t => `--tc:var(--t-${t})`;

/* ---------- API ---------- */
let db = { items: [] }, me = null, aiOn = false;
const isAdmin = () => me?.role === "admin";
async function api(path, { method="GET", body, raw } = {}){
  const opt = { method, headers:{} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined){ opt.headers["content-type"] = "application/json"; opt.body = raw ? body : JSON.stringify(body); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/api/login"){ me = null; loginView(); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const upsert = it => { const i = db.items.findIndex(x => x.id===it.id); i<0 ? db.items.push(it) : (db.items[i] = it); return it; };
async function reload(){ db.items = await api("/api/items"); }
const fail = e => toast(e.message || "操作失败");

const cfg = (() => { try { return JSON.parse(localStorage.getItem(CFG)) || {}; } catch { return {}; } })();
const saveCfg = () => { try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch {} };
if (cfg.theme) document.documentElement.dataset.theme = cfg.theme;

/* ---------- media ---------- */
const kindOf = typeOrName => /^video|\.(mp4|webm|mov)(\?|$)/i.test(typeOrName) ? "video" : "image";
const cover = it => (it.media||[])[0];
const mediaUrl = f => "/media/" + f.split("/").map(encodeURIComponent).join("/");
const mediaSrc = m => m.url || mediaUrl(m.file);
// small=true：用缩略图（卡片、编辑器），视频显示封面帧、悬停时播放
function mediaEl(m, cls="", small=false){
  if (!m) return "";
  const dim = m.w && m.h ? ` width="${m.w}" height="${m.h}"` : "";
  const thumb = m.thumb && mediaUrl(m.thumb);
  if (m.kind==="video"){
    if (small && thumb) return `<img class="${cls}" src="${esc(thumb)}" data-video="${esc(mediaSrc(m))}"${dim} alt="" loading="lazy"><span class="play">▶</span>`;
    return `<video class="${cls}" src="${esc(mediaSrc(m))}"${thumb?` poster="${esc(thumb)}"`:""}${dim} autoplay muted loop playsinline preload="metadata"></video>`;
  }
  return `<img class="${cls}" src="${esc(small && thumb ? thumb : mediaSrc(m))}"${dim} alt="${esc(m.caption||m.name||"")}" loading="lazy" decoding="async">`;
}
// 视频卡片：悬停时把封面帧换成视频
document.addEventListener("mouseover", e => {
  const img = e.target.closest?.("img[data-video]"); if (!img) return;
  const v = Object.assign(document.createElement("video"), { src: img.dataset.video, muted: true, loop: true, autoplay: true, playsInline: true, poster: img.src, className: img.className });
  img.nextElementSibling?.classList.contains("play") && img.nextElementSibling.remove();
  img.replaceWith(v);
});

const byId = id => db.items.find(x => x.id === id);
const byName = n => { n = n.trim().toLowerCase(); return db.items.find(x => x.name.toLowerCase()===n || (x.alt||"").toLowerCase()===n || x.id===n); };
const wikiTargets = it => [...(it.body||"").matchAll(/\[\[([^\]]+)\]\]/g)].map(m => byName(m[1])).filter(Boolean);
function edges(){
  const out = [], seen = new Set();
  for (const it of db.items){
    for (const r of it.relations||[]) if (byId(r.to)) { out.push({s:it.id,t:r.to,label:r.label}); seen.add(it.id+">"+r.to); }
    for (const t of wikiTargets(it)) if (!seen.has(it.id+">"+t.id) && !seen.has(t.id+">"+it.id)) { out.push({s:it.id,t:t.id,label:"提及",soft:true}); seen.add(it.id+">"+t.id); }
  }
  return out;
}
function neighbors(id){
  return edges().filter(e => e.s===id || e.t===id).map(e => ({item: byId(e.s===id?e.t:e.s), label:e.label, dir:e.s===id?"out":"in"}));
}

/* ---------- ui helpers ---------- */
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"),2200); }
const chip = t => `<span class="chip t" style="${tc(t)}">${TYPES[t]?.zh||t}</span>`;
const stars = n => n ? `<span class="stars">${"★".repeat(n)}${"☆".repeat(5-n)}</span>` : "";
const statusTxt = s => s==="tried" ? `<span class="status tried">● 已品尝</span>` : s==="want" ? `<span class="status want">○ 想尝</span>` : "";
function card(it){
  const c = cover(it);
  return `<article class="card${c?" has-cover":""}${inCmp(it.id)?" picked":""}" data-go="${esc(it.id)}">
    ${c?`<div class="cover">${mediaEl(c,"",true)}</div>`:""}
    ${chip(it.type)}
    <h3>${esc(it.name)}</h3>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
    <p>${esc(it.summary)}</p>
    <div class="foot"><span>${esc(it.region||"")}</span><span>${stars(it.rating)||statusTxt(it.status)}</span></div>
  </article>`;
}
const grid = items => items.length ? `<div class="grid">${items.map(card).join("")}</div>` : `<div class="empty">展柜还空着——添一件藏品吧。</div>`;
function renderBody(txt, it){
  const find = id => (it?.media||[]).find(m => m.id===id);
  return (txt||"").split(/\n+/).filter(Boolean).map(p => {
    const mm = p.trim().match(/^!\[\[m:([\w-]+)\]\]$/), mu = p.trim().match(/^!\[([^\]]*)\]\((https?:[^)\s]+)\)$/);
    if (mm){ const m = find(mm[1]); return m ? `<figure>${mediaEl(m)}${m.caption?`<figcaption>${esc(m.caption)}</figcaption>`:""}</figure>` : ""; }
    if (mu) return `<figure>${mediaEl({url:mu[2], kind:kindOf(mu[2]), caption:mu[1]})}${mu[1]?`<figcaption>${esc(mu[1])}</figcaption>`:""}</figure>`;
    return "<p>" + esc(p).replace(/\[\[([^\]]+)\]\]/g, (_,n) => {
    const t = byName(n.replace(/&amp;/g,"&"));
    return t ? `<span class="wl" data-go="${esc(t.id)}">${n}</span>` : `<span class="wl missing" data-new="${n}" title="尚未收藏，点击创建">${n}</span>`;
  }) + "</p>"; }).join("");
}
function radar(fl, size=220){
  const keys = Object.keys(FLAVORS), c=size/2, R=c-34, n=keys.length;
  const pt = (i,v) => { const a = -Math.PI/2 + i*2*Math.PI/n; return [c+Math.cos(a)*R*v/5, c+Math.sin(a)*R*v/5]; };
  let g = "";
  for (let l=1;l<=5;l++) g += `<polygon points="${keys.map((_,i)=>pt(i,l).join(",")).join(" ")}" fill="none" stroke="var(--line)"/>`;
  const lab = keys.map((k,i)=>{ const [x,y]=pt(i,6.3); return `<text x="${x}" y="${y}" font-size="11" fill="var(--muted)" text-anchor="middle" dominant-baseline="middle">${FLAVORS[k]}</text>`; }).join("");
  const poly = keys.map((k,i)=>pt(i,+(fl?.[k]||0)).join(",")).join(" ");
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:${size}px">${g}${lab}<polygon points="${poly}" fill="var(--accent)" fill-opacity=".25" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}
// 健康印象：刻意用「少/适中/多」与约数，不做精确营养表
const hasHealth = h => h && (h.ingredients?.length || h.tags?.length || h.kcal || Object.keys(h.levels||{}).length);
function healthPanel(h){
  if (!hasHealth(h)) return "";
  const lv = Object.entries(h.levels||{});
  return `<div class="panel health"><h4>健康印象</h4>
    ${h.kcal?`<div class="kcal-big"><b>约 ${h.kcal}</b> kcal${h.portion?` / ${esc(h.portion)}`:""}</div>`:""}
    ${lv.length?`<div class="meters">${lv.map(([k,v])=>`<div><span>${LEVELS[k]}</span><i class="m m${v}"><b></b><b></b><b></b></i><em>${LEVEL_TXT[v]}</em></div>`).join("")}</div>`:""}
    ${h.ingredients?.length?`<div class="eyebrow" style="margin-top:10px">主要配料</div><div class="tags">${h.ingredients.map(x=>`<span class="tag">${esc(x)}</span>`).join("")}</div>`:""}
    ${h.tags?.length?`<div class="tags" style="margin-top:8px">${h.tags.map(x=>`<span class="htag">${esc(x)}</span>`).join("")}</div>`:""}
    ${h.note?`<p class="muted" style="font-size:13px;margin:8px 0 0">${esc(h.note)}</p>`:""}</div>`;
}
const hasFlavor = f => f && Object.values(f).some(v => +v > 0);

/* ---------- routes ---------- */
const app = $("#app");
let graphStop = null;
function route(){
  if (graphStop) { graphStop(); graphStop = null; }
  app.dataset.pick = "";
  const [path, q] = location.hash.slice(1).split("?");
  const parts = (path||"/").split("/").filter(Boolean);
  const params = new URLSearchParams(q||"");
  const r = parts[0] || "home";
  document.querySelectorAll("#nav a, #moreSheet a").forEach(a => a.classList.toggle("on", a.dataset.r===r));
  // 底部导航：不在四个常用页时，高亮「更多」
  const tabbed = [...document.querySelectorAll("#tabbar a")].some(a => a.dataset.r===r);
  document.querySelectorAll("#tabbar [data-r]").forEach(a => a.classList.toggle("on", a.dataset.r===r || (!tabbed && a.dataset.r==="more")));
  $("#moreSheet").hidden = true;
  G.current = { r, params, id: parts[1] && decodeURIComponent(parts[1]) };
  ({home, discover, atlas, stories, graph, taste, ai, item, map: mapView, compare}[r] || home)(params, parts[1] && decodeURIComponent(parts[1]));
  updateCmpBar();
  $("#shareBtn").hidden = r==="ai";
  if (r!=="graph") window.scrollTo(0,0);
}
window.addEventListener("hashchange", route);
const go = h => location.hash = h;

function home(){
  const items = db.items;
  const day = Math.floor(Date.now()/864e5);
  const pool = items.filter(i => i.summary && i.type!=="region");
  const ex = pool[day % Math.max(pool.length,1)];
  const tried = items.filter(i=>i.status==="tried").length, want = items.filter(i=>i.status==="want").length;
  const regions = new Set(items.map(i=>(i.region||"").split("·")[0].trim()).filter(Boolean));
  const recent = [...items].sort((a,b)=>(b.updated||"").localeCompare(a.updated||"")).slice(0,8);
  app.innerHTML = `
  <section class="hero">
    ${ex ? `<div class="exhibit${cover(ex)?" with-media":""}">${cover(ex)?`<div class="exhibit-media">${mediaEl(cover(ex))}</div>`:""}<div class="exhibit-text">
      <div class="eyebrow">今日展品 · Exhibit No. ${String(items.indexOf(ex)+1).padStart(3,"0")}</div>
      <h1>${esc(ex.name)}</h1><div class="alt">${esc(ex.alt)}</div>
      <p>${esc(ex.summary)}</p>${ex.story?`<div class="story-box">${esc(ex.story)}</div>`:""}
      <div class="plaque">${chip(ex.type)}<span>${esc(ex.region)}</span><a href="#/item/${encodeURIComponent(ex.id)}" style="color:var(--accent);margin-left:auto">进入展柜 →</a></div>
    </div></div>` : `<div class="exhibit"><h1>欢迎</h1><p>你的私人食物博物馆还没有藏品。</p></div>`}
    <div class="stats">
      <div class="stat"><b>${items.length}</b><span>藏品</span></div>
      <div class="stat"><b>${tried}</b><span>已品尝</span></div>
      <div class="stat"><b>${want}</b><span>想尝清单</span></div>
      <div class="stat"><b>${regions.size}</b><span>地区</span></div>
      <div class="stat"><b>${edges().length}</b><span>知识连接</span></div>
      <div class="stat"><b>${items.filter(i=>i.story||i.type==="story").length}</b><span>奇闻轶事</span></div>
      <div class="quote">${QUOTES[day%QUOTES.length]}</div>
    </div>
  </section>
  <div class="section-h"><h2>展厅分区</h2><span class="muted">按类别浏览</span></div>
  <div class="seg">${Object.entries(TYPES).map(([k,v])=>`<button onclick="location.hash='#/discover?type=${k}'" style="${tc(k)}"><span class="dot" style="display:inline-block;margin-right:6px"></span>${v.zh} · ${items.filter(i=>i.type===k).length}</button>`).join("")}</div>
  <div class="section-h"><h2>最近入藏</h2><a class="muted" href="#/discover">全部 →</a></div>
  ${grid(recent)}`;
}

function discover(params){
  const st = { q: params.get("q")||"", type: params.get("type")||"", tag: params.get("tag")||"", sort: "updated" };
  app.innerHTML = `
  <div class="section-h" style="margin-top:0"><h2>图鉴 · Discover</h2><span class="muted" id="cnt"></span></div>
  <div class="filters">
    <input id="fq" placeholder="搜索名称、产地、标签、描述…" value="${esc(st.q)}">
    <button class="sm" id="pickBtn" title="点选卡片加入对比">⚖ 选择对比</button>
    <select id="fs"><option value="updated">最近更新</option><option value="name">名称</option><option value="rating">评分</option><option value="region">地区</option></select>
  </div>
  <div class="seg" id="ft" style="margin-bottom:12px"><button data-t="">全部</button>${Object.entries(TYPES).map(([k,v])=>`<button data-t="${k}">${v.zh}</button>`).join("")}</div>
  <div class="tags" id="ftag" style="margin-bottom:20px"></div>
  <div id="res"></div>`;
  const allTags = [...new Set(db.items.flatMap(i=>i.tags||[]))].sort();
  const draw = () => {
    const q = st.q.toLowerCase();
    let list = db.items.filter(i => (!st.type || i.type===st.type) && (!st.tag || (i.tags||[]).includes(st.tag)) &&
      (!q || [i.name,i.alt,i.region,i.summary,i.body,i.story,(i.tags||[]).join(" ")].join(" ").toLowerCase().includes(q)));
    const s = { updated:(a,b)=>(b.updated||"").localeCompare(a.updated||""), name:(a,b)=>a.name.localeCompare(b.name,"zh"), rating:(a,b)=>(b.rating||0)-(a.rating||0), region:(a,b)=>(a.region||"").localeCompare(b.region||"","zh") }[st.sort];
    list.sort(s);
    $("#res").innerHTML = grid(list); $("#cnt").textContent = `${list.length} 件藏品`;
    document.querySelectorAll("#ft button").forEach(b => b.classList.toggle("on", b.dataset.t===st.type));
    $("#ftag").innerHTML = allTags.map(t=>`<span class="tag" data-tag="${esc(t)}" style="${t===st.tag?"background:var(--accent);color:#fff":""}">#${esc(t)}</span>`).join("");
  };
  $("#fq").oninput = e => { st.q = e.target.value; draw(); };
  const setPick = on => { app.dataset.pick = on ? "1" : ""; $("#pickBtn").classList.toggle("on", on); $("#pickBtn").textContent = on ? "✓ 完成选择" : "⚖ 选择对比"; };
  setPick(false);
  $("#pickBtn").onclick = () => setPick(!app.dataset.pick);
  $("#fs").onchange = e => { st.sort = e.target.value; draw(); };
  $("#ft").onclick = e => { const b=e.target.closest("button"); if(b){ st.type=b.dataset.t; draw(); } };
  $("#ftag").onclick = e => { const t=e.target.dataset.tag; if(t!=null){ st.tag = st.tag===t?"":t; draw(); } };
  draw();
}

function atlas(params){
  const tab = params.get("tab") || "tried";
  const tabs = {tried:"已品尝",want:"想尝清单",journal:"品尝日志"};
  let body;
  if (tab==="journal"){
    const entries = db.items.flatMap(i => (i.journal||[]).map(j => ({...j, it:i}))).sort((a,b)=>b.date.localeCompare(a.date));
    body = entries.length ? entries.map(e=>`<div class="entry"><time>${esc(e.date)}</time> · <a href="#/item/${encodeURIComponent(e.it.id)}" style="color:var(--accent)">${esc(e.it.name)}</a>${e.place?` · <span class="muted">${esc(e.place)}</span>`:""}${priceLine(e)}${e.text?`<div class="prose" style="font-size:15px">${esc(e.text)}</div>`:""}</div>`).join("")
      : `<div class="empty">在任意藏品页面写下「品尝日志」，它们会汇集在这里。</div>`;
  } else {
    body = grid(db.items.filter(i=>i.status===tab).sort((a,b)=>(b.rating||0)-(a.rating||0)));
  }
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>我的 Atlas</h2><span class="muted">个人体验与记录</span></div>
  <div class="seg" style="margin-bottom:20px">${Object.entries(tabs).map(([k,v])=>`<button class="${k===tab?"on":""}" onclick="location.hash='#/atlas?tab=${k}'">${v}</button>`).join("")}</div>${body}`;
}

function stories(){
  const list = db.items.filter(i => i.type==="story" || i.story);
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>奇闻轶事 · Stories</h2><span class="muted">${list.length} 则</span></div>
  ${list.length ? list.map(i=>`<div class="panel" style="margin-bottom:14px;cursor:pointer" data-go="${esc(i.id)}">
    <div style="display:flex;gap:10px;align-items:center">${chip(i.type)}<h3 style="font-size:22px">${esc(i.name)}</h3><span class="muted" style="margin-left:auto;font-size:12px">${esc(i.region)}</span></div>
    <div class="story-box" style="margin:12px 0 0">${esc(i.type==="story" ? i.summary : i.story)}</div></div>`).join("") : `<div class="empty">还没有故事。</div>`}`;
}

function item(_, id){
  const it = byId(id);
  if (!it) { app.innerHTML = `<div class="empty">找不到这件藏品。</div>`; return; }
  const nb = neighbors(id);
  const sameRegion = db.items.filter(x => x.id!==id && it.region && (x.region||"").split("·")[0].trim()===it.region.split("·")[0].trim() && !nb.some(n=>n.item.id===x.id)).slice(0,6);
  app.innerHTML = `
  <div class="detail">
    <div>
      <div style="display:flex;gap:10px;align-items:center">${chip(it.type)}<span class="eyebrow">${esc(it.region)}</span></div>
      <h1>${esc(it.name)}</h1>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
      ${cover(it) && !(it.body||"").includes("m:"+cover(it).id) ? `<figure class="lead">${mediaEl(cover(it))}${cover(it).caption?`<figcaption>${esc(cover(it).caption)}</figcaption>`:""}</figure>` : ""}
      <p class="prose" style="font-size:18px;margin-top:18px">${esc(it.summary)}</p>
      <div class="prose">${renderBody(it.body, it)}</div>
      ${it.story?`<div class="story-box"><div class="eyebrow" style="margin-bottom:6px">轶事</div>${esc(it.story)}</div>`:""}
      ${it.source?`<p class="muted" style="font-size:13px">来源：${esc(it.source)}</p>`:""}
      <div class="journal">
        <div class="section-h" style="margin-top:0"><h2 style="font-size:24px">品尝日志</h2><button class="sm admin" id="addJ">＋ 记一笔</button></div>
        <div id="jform" hidden class="form jform" style="margin-bottom:12px">
          <input type="hidden" id="jid">
          <label>日期<input type="date" id="jd" value="${new Date().toISOString().slice(0,10)}"></label>
          <label>地点 / 场合<input id="jp" placeholder="在哪里、和谁"></label>
          <div class="jprice"><label>价格<input id="jpr" type="number" inputmode="decimal" min="0" step="0.01" placeholder="—"></label>
            <label>币种<select id="jcur">${Object.keys(CURRENCIES).map(c=>`<option ${c===(cfg.lastCurrency||"CNY")?"selected":""}>${c}</option>`).join("")}</select></label></div>
          <label>份量<input id="jam" placeholder="如 50g、一份、一杯" list="jamList"><datalist id="jamList">${["50g","30g","100g","125g","250g","一份","一小份","一杯","一瓶","750ml"].map(v=>`<option value="${v}">`).join("")}</datalist></label>
          <label class="full">在哪买 / 在哪吃<input id="jshop" placeholder="店铺、餐馆或网站" list="shopList"><datalist id="shopList">${[...new Set([...db.items.filter(i=>["restaurant","producer"].includes(i.type)).map(i=>i.name), ...db.items.flatMap(i=>(i.journal||[]).map(j=>j.shop))].filter(Boolean))].map(v=>`<option value="${esc(v)}">`).join("")}</datalist></label>
          <label class="full">笔记<textarea id="jt" placeholder="口感、温度、配酒、当时的心情……"></textarea></label>
          <div class="full" style="display:flex;gap:8px"><button class="primary sm" id="jsave">保存</button><button class="sm ghost" id="jcancel" type="button">取消</button></div>
        </div>
        ${(it.journal||[]).slice().reverse().map((j,k)=>`<div class="entry"><time>${esc(j.date)}</time>${j.place?` · <span class="muted">${esc(j.place)}</span>`:""} <span class="admin" style="float:right"><button class="sm ghost" data-editj="${esc(j.id)}" style="border:none" title="编辑">✎</button><button class="sm ghost" data-delj="${esc(j.id)}" style="border:none" title="删除">×</button></span>${priceLine(j)}${j.text?`<div>${esc(j.text)}</div>`:""}</div>`).join("") || `<p class="muted">还没有记录。</p>`}
      </div>
    </div>
    <aside class="side">
      <div class="panel">
        <h4>我的体验</h4>
        <div class="seg" id="stSeg">${[["tried","已品尝"],["want","想尝"],["","—"]].map(([k,v])=>`<button class="sm ${it.status===k?"on":""}" data-s="${k}">${v}</button>`).join("")}</div>
        <div style="margin-top:10px;font-size:22px;cursor:pointer" id="rate">${[1,2,3,4,5].map(n=>`<span data-r="${n}" style="color:${n<=(it.rating||0)?"var(--gold)":"var(--line)"}">★</span>`).join("")}</div>
      </div>
      ${itemMapPanel(it)}
      ${healthPanel(it.health)}
      ${hasFlavor(it.flavor)?`<div class="panel"><h4>风味轮廓</h4><div style="text-align:center">${radar(it.flavor)}</div></div>`:""}
      <div class="panel"><h4>档案</h4><dl class="kv">
        <dt>类别</dt><dd>${TYPES[it.type]?.zh}</dd><dt>地区</dt><dd>${esc(it.region)||"—"}</dd>
        <dt>入藏</dt><dd>${(it.created||"").slice(0,10)}</dd></dl>
        <div class="tags" style="margin-top:10px">${(it.tags||[]).map(t=>`<a class="tag" href="#/discover?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}</div></div>
      <div class="panel"><h4>知识连接 · ${nb.length}</h4>
        ${nb.map(n=>`<div class="rel" data-go="${esc(n.item.id)}" style="${tc(n.item.type)}"><span class="dot"></span>${esc(n.item.name)}<span class="lbl">${n.dir==="in"?"← ":""}${esc(n.label)}</span></div>`).join("") || `<p class="muted" style="font-size:13px">在正文中用 [[名称]] 或在编辑中添加关系。</p>`}
      </div>
      ${sameRegion.length?`<div class="panel"><h4>同一片土地</h4>${sameRegion.map(x=>`<div class="rel" data-go="${esc(x.id)}" style="${tc(x.type)}"><span class="dot"></span>${esc(x.name)}</div>`).join("")}</div>`:""}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="cmpBtn">${inCmp(it.id) ? "✓ 已在对比中" : "⚖ 加入对比"}</button>
        <button class="admin" id="edit">编辑</button>${aiOn?`<button class="admin" id="askAi">✦ AI 补充轶事</button>`:""}<button class="danger admin" id="del">删除</button>
      </div>
    </aside>
  </div>`;
  const refresh = x => { upsert(x); route(); };
  const patch = body => isAdmin() && api("/api/items/"+encodeURIComponent(it.id), {method:"PATCH", body}).then(refresh, fail);
  $("#stSeg").onclick = e => { const b=e.target.closest("button"); if(b) patch({status:b.dataset.s}); };
  $("#rate").onclick = e => { const r=+e.target.dataset.r; if(!r) return; const rating = it.rating===r?0:r; patch(rating ? {rating, status:"tried"} : {rating}); };
  const jFill = (j = {}) => { $("#jid").value = j.id || ""; $("#jd").value = j.date || new Date().toISOString().slice(0,10); $("#jp").value = j.place || "";
    $("#jpr").value = j.price ?? ""; if (j.currency) $("#jcur").value = j.currency; $("#jam").value = j.amount || ""; $("#jshop").value = j.shop || ""; $("#jt").value = j.text || ""; };
  $("#addJ").onclick = () => { jFill(); $("#jform").hidden = !$("#jform").hidden; };
  $("#jcancel").onclick = () => { $("#jform").hidden = true; jFill(); };
  app.querySelectorAll("[data-editj]").forEach(b => b.onclick = () => { jFill((it.journal||[]).find(j => String(j.id) === b.dataset.editj)); $("#jform").hidden = false; $("#jform").scrollIntoView({block:"center", behavior:"smooth"}); });
  $("#jsave").onclick = () => {
    const body = { date:$("#jd").value, place:$("#jp").value.trim(), text:$("#jt").value.trim(), price:$("#jpr").value, currency:$("#jcur").value, amount:$("#jam").value.trim(), shop:$("#jshop").value.trim() };
    if (!body.text && body.price === "") return toast("请填写笔记或价格");
    if (body.price !== ""){ cfg.lastCurrency = body.currency; saveCfg(); }
    const id = $("#jid").value;
    api(id ? `/api/journal/${id}` : `/api/items/${encodeURIComponent(it.id)}/journal`, {method: id ? "PUT" : "POST", body}).then(refresh, fail); };
  $("#cmpBtn").onclick = () => { if (toggleCompare(it.id)) $("#cmpBtn").textContent = inCmp(it.id) ? "✓ 已在对比中" : "⚖ 加入对比"; };
  initItemMap(it);
  app.querySelectorAll("[data-delj]").forEach(b => b.onclick = () => { if(confirm("删除这条日志？"))
    api("/api/journal/"+b.dataset.delj, {method:"DELETE"}).then(() => api("/api/items/"+encodeURIComponent(it.id))).then(refresh, fail); });
  $("#edit").onclick = () => editor(it);
  $("#del").onclick = () => { if (confirm(`从博物馆中移除「${it.name}」？`)) api("/api/items/"+encodeURIComponent(it.id), {method:"DELETE"}).then(() => {
    db.items = db.items.filter(x=>x!==it); db.items.forEach(x => x.relations = (x.relations||[]).filter(r=>r.to!==it.id)); go("#/discover"); toast("已移除"); }, fail); };
  if ($("#askAi"))   $("#askAi").onclick = () => aiStory(it);
}

/* ---------- editor（手机优先：分区折叠、拍照直传、点选代替输入、草稿自动保存） ---------- */
const LEVELS = {energy:"热量",fat:"脂肪",protein:"蛋白质",carb:"碳水",sugar:"糖",sodium:"盐分"};
const LEVEL_TXT = ["","少","适中","多"];
const PORTIONS = ["一口","一小份","一份","一餐","一杯","100g"];
const HEALTH_TAGS = ["素食","纯素","无麸质","发酵","生食","含酒精","含乳制品","含坚果","海鲜","油炸","高纤维","低温慢煮"];
const DRAFT = "gastronomique.draft";
function chipInput(name, values, placeholder, suggest=[]){
  return `<div class="chipin" data-name="${name}"><div class="chips">${values.map(v=>`<span class="cv">${esc(v)}<button type="button" aria-label="移除">×</button></span>`).join("")}</div>
    <input placeholder="${placeholder}" enterkeyhint="done" autocomplete="off">
    ${suggest.length?`<div class="sugg">${suggest.map(v=>`<button type="button" class="sm" data-add="${esc(v)}">＋${esc(v)}</button>`).join("")}</div>`:""}</div>`;
}
const chipValues = el => [...el.querySelectorAll(".cv")].map(c => c.firstChild.textContent);
function editor(it, preset={}, focus=""){
  const isNew = !it;
  let d = it ? structuredClone(it) : { type:"dish", name:"", alt:"", region:"", tags:[], status:"", rating:0, flavor:{}, health:{}, summary:"", body:"", story:"", source:"", relations:[], journal:[], media:[], ...preset };
  if (isNew && !Object.keys(preset).length){
    try { const dr = JSON.parse(localStorage.getItem(DRAFT)); if (dr?.name && confirm(`继续上次未保存的「${dr.name}」？`)) d = {...d, ...dr}; else localStorage.removeItem(DRAFT); } catch {}
  }
  d.media ||= []; d.flavor ||= {}; d.tags ||= []; d.relations ||= []; d.health = {ingredients:[], levels:{}, tags:[], ...(d.health||{})};
  const h = d.health;
  const opts = db.items.filter(x=>x.id!==d.id).sort((a,b)=>a.name.localeCompare(b.name,"zh"));
  const regions = [...new Set(db.items.map(i=>i.region).filter(Boolean))];
  const allIngr = [...new Set(db.items.flatMap(i=>i.health?.ingredients||[]))].filter(x=>!h.ingredients.includes(x)).slice(0,12);
  const allTags = [...new Set(db.items.flatMap(i=>i.tags||[]))].filter(x=>!d.tags.includes(x)).slice(0,14);
  const relRow = r => `<div class="rel-edit"><select class="rt"><option value="">— 选择藏品 —</option>${opts.map(o=>`<option value="${esc(o.id)}" ${o.id===r.to?"selected":""}>${esc(o.name)} · ${TYPES[o.type].zh}</option>`).join("")}</select>
    <input class="rl" list="rellabels" value="${esc(r.label||"")}" placeholder="关系"><button class="sm ghost rx" type="button">×</button></div>`;
  const has = (...v) => v.some(x => Array.isArray(x) ? x.length : x && (typeof x!=="object" || Object.values(x).some(Boolean)));
  const sec = (title, open, inner, hint="") => `<details class="sec" ${open?"open":""}><summary>${title}${hint?`<small>${hint}</small>`:""}</summary><div class="sec-body">${inner}</div></details>`;
  const dots = (k, v) => `<div class="dots" data-f="${k}"><span>${FLAVORS[k]}</span>${[1,2,3,4,5].map(n=>`<button type="button" class="${n<=v?"on":""}" data-n="${n}" aria-label="${FLAVORS[k]} ${n}"></button>`).join("")}</div>`;
  const lvl = (k, v) => `<div class="lvl" data-l="${k}"><span>${LEVELS[k]}</span>${[1,2,3].map(n=>`<button type="button" class="${v===n?"on":""}" data-n="${n}">${LEVEL_TXT[n]}</button>`).join("")}</div>`;
  $("#modalCard").innerHTML = `
  <div class="ed-head"><button class="ghost ed-icon" id="ecancel" type="button" aria-label="取消" title="取消"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg><span>取消</span></button><h2>${isNew?"新藏品":"编辑藏品"}</h2><button class="primary ed-icon" id="esave" type="button" aria-label="保存" title="保存"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>保存</span></button></div>
  <form id="ef" class="ed" autocomplete="off">
    <div class="typechips">${Object.entries(TYPES).map(([k,v])=>`<button type="button" data-type="${k}" class="${d.type===k?"on":""}" style="${tc(k)}">${v.zh}</button>`).join("")}</div>
    ${sec("基本信息", true, `
      <label>名称 *<input name="name" required value="${esc(d.name)}" placeholder="如：金华火腿" enterkeyhint="next"></label>
      <label>原名 / 外文名<input name="alt" value="${esc(d.alt)}" lang="en" autocapitalize="words"></label>
      <label>地区<input name="region" value="${esc(d.region)}" placeholder="国家 · 地区" list="regionlist"></label>
      <datalist id="regionlist">${regions.map(r=>`<option value="${esc(r)}">`).join("")}</datalist>
      <label>一句话简介<textarea name="summary" rows="2">${esc(d.summary)}</textarea></label>`)}
    ${sec("位置", !!d.geo || focus==="geo" || ["restaurant","region","producer"].includes(d.type), geoSection(d), "餐馆、产区等可标注坐标")}
    ${sec("照片与视频", true, `
      <div class="capture">
        <label class="cap-btn">📷<span>拍照</span><input type="file" accept="image/*" capture="environment" hidden data-up></label>
        <label class="cap-btn">🎬<span>录像</span><input type="file" accept="video/*" capture="environment" hidden data-up></label>
        <label class="cap-btn">🖼<span>相册</span><input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden data-up></label>
      </div>
      <div id="upProg" class="muted" style="font-size:13px"></div>
      <div class="media-edit" id="medList"></div>
      <div class="url-add"><input id="medUrl" placeholder="或粘贴图片/视频网址 https://…" inputmode="url"><button class="sm" type="button" id="medUrlAdd">添加</button></div>`, "第一张为封面")}
    ${sec("我的体验", true, `
      <div class="seg" id="edStatus">${[["tried","已品尝"],["want","想尝"],["","—"]].map(([k,v])=>`<button type="button" class="${d.status===k?"on":""}" data-s="${k}">${v}</button>`).join("")}</div>
      <div class="ed-stars" id="edRate">${[1,2,3,4,5].map(n=>`<button type="button" data-r="${n}" class="${n<=d.rating?"on":""}">★</button>`).join("")}</div>`)}
    ${sec("风味", has(d.flavor), `<div class="dotgrid">${Object.keys(FLAVORS).map(k=>dots(k, +d.flavor[k]||0)).join("")}</div>`, "点圆点打分，再点一次取消")}
    ${sec("健康印象", has(h.ingredients, h.levels, h.tags, h.kcal), `
      <div class="eyebrow">主要配料</div>${chipInput("ingredients", h.ingredients, "输入后按回车，如：猪后腿、盐", allIngr)}
      <div class="kcal"><label>热量约<input name="kcal" type="number" inputmode="numeric" min="0" max="9999" value="${h.kcal||""}" placeholder="—"></label><span>kcal /</span>
        <select name="portion"><option value="">份量</option>${PORTIONS.map(p=>`<option ${h.portion===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="eyebrow">大致水平 <small class="muted">凭印象即可，再点取消</small></div>
      <div class="lvlgrid">${Object.keys(LEVELS).map(k=>lvl(k, h.levels[k]||0)).join("")}</div>
      <div class="eyebrow">饮食标签</div>
      <div class="toggles" id="hTags">${[...new Set([...HEALTH_TAGS, ...h.tags])].map(t=>`<button type="button" class="${h.tags.includes(t)?"on":""}">${esc(t)}</button>`).join("")}</div>
      <label>备注<input name="hnote" value="${esc(h.note||"")}" placeholder="如：传统做法较咸，可配清汤"></label>`, "配料、热量、营养水平")}
    ${sec("正文与轶事", has(d.body, d.story, d.source), `
      <label>正文 <small class="muted">用 [[名称]] 链接其他藏品</small><textarea name="body" rows="6">${esc(d.body)}</textarea></label>
      <label>轶事 / 冷知识<textarea name="story" rows="3">${esc(d.story)}</textarea></label>
      <label>来源 / 参考<input name="source" value="${esc(d.source)}"></label>`)}
    ${sec("标签与关系", has(d.tags, d.relations), `
      <div class="eyebrow">标签</div>${chipInput("tags", d.tags, "输入后按回车", allTags)}
      <div class="eyebrow">关系</div><div id="rels">${d.relations.map(relRow).join("")}</div>
      <button class="sm" type="button" id="addRel">＋ 关系</button>
      <datalist id="rellabels">${REL_LABELS.map(l=>`<option value="${l}">`).join("")}</datalist>`)}
  </form>`;
  openModal(); $("#modal").classList.add("sheet");
  const modal = $("#modal"); modal.dataset.lock = "1"; modal.dataset.dirty = "";
  const form = $("#ef"), body = form.elements.body;
  const getGeo = bindGeo(form, () => { modal.dataset.dirty = "1"; saveDraft(); });
  if (focus === "geo") setTimeout(() => $("#geoQ").closest("details").scrollIntoView({block:"start"}), 100);
  if (isNew && !d.name) setTimeout(() => form.elements.name.focus(), 50);

  // 收集表单为藏品对象
  const collect = () => {
    const f = new FormData(form);
    const levels = {}; form.querySelectorAll(".lvl").forEach(l => { const on = l.querySelector(".on"); if (on) levels[l.dataset.l] = +on.dataset.n; });
    return { ...d, type: form.querySelector(".typechips .on")?.dataset.type || d.type,
      name:(f.get("name")||"").trim(), alt:f.get("alt").trim(), region:f.get("region").trim(), summary:f.get("summary").trim(),
      body:f.get("body"), story:f.get("story").trim(), source:f.get("source").trim(),
      tags: chipValues(form.querySelector('[data-name="tags"]')),
      flavor: Object.fromEntries([...form.querySelectorAll(".dots")].map(x => [x.dataset.f, x.querySelectorAll(".on").length])),
      health: { ingredients: chipValues(form.querySelector('[data-name="ingredients"]')), levels,
        tags: [...form.querySelectorAll("#hTags .on")].map(b => b.textContent), kcal: +f.get("kcal") || undefined, portion: f.get("portion") || undefined, note: f.get("hnote").trim() || undefined },
      relations:[...$("#rels").children].map(r=>({to:$(".rt",r).value,label:$(".rl",r).value.trim()||"相关"})).filter(r=>r.to),
      media: d.media, geo: getGeo() };
  };
  let draftT; const saveDraft = () => { if (!isNew) return; clearTimeout(draftT); draftT = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify(collect())); } catch {} }, 400); };
  form.addEventListener("input", saveDraft); form.addEventListener("click", saveDraft);
  const markDirty = () => modal.dataset.dirty = "1";
  form.addEventListener("input", markDirty);
  form.addEventListener("click", e => { if (e.target.closest("button") && !e.target.closest("summary")) markDirty(); });

  // 点选控件
  const addChip = (box, v) => { v = v.trim(); if (!v || chipValues(box).includes(v)) return;
    box.querySelector(".chips").insertAdjacentHTML("beforeend", `<span class="cv">${esc(v)}<button type="button" aria-label="移除">×</button></span>`); };
  form.onclick = e => {
    const b = e.target.closest("button"); if (!b || !form.contains(b)) return;
    const p = b.parentElement;
    if (b.dataset.type){ p.querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b)); }
    else if (p.id === "edStatus"){ d.status = b.dataset.s; p.querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b)); }
    else if (p.id === "edRate"){ const r = +b.dataset.r; d.rating = d.rating===r ? 0 : r;
      if (d.rating && !d.status){ d.status = "tried"; $("#edStatus").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.s==="tried")); }
      p.querySelectorAll("button").forEach(x => x.classList.toggle("on", +x.dataset.r <= d.rating)); }
    else if (p.classList.contains("dots")){ const n = +b.dataset.n, cur = p.querySelectorAll(".on").length, v = cur===n ? n-1 : n;
      p.querySelectorAll("button").forEach(x => x.classList.toggle("on", +x.dataset.n <= v)); }
    else if (p.classList.contains("lvl")){ const was = b.classList.contains("on"); p.querySelectorAll("button").forEach(x => x.classList.remove("on")); if (!was) b.classList.add("on"); }
    else if (p.id === "hTags") b.classList.toggle("on");
    else if (p.classList.contains("cv")) p.remove();
    else if (b.dataset.add != null){ addChip(b.closest(".chipin"), b.dataset.add); b.remove(); }
  };
  form.querySelectorAll(".chipin input").forEach(inp => {
    const box = inp.closest(".chipin");
    const commit = () => { inp.value.split(/[,，、]/).forEach(v => addChip(box, v)); inp.value = ""; };
    inp.onkeydown = e => { if (e.key==="Enter" || e.key===","){ e.preventDefault(); commit(); } else if (e.key==="Backspace" && !inp.value) box.querySelector(".cv:last-child")?.remove(); };
    inp.onblur = commit;
  });
  form.onsubmit = e => e.preventDefault();

  // 媒体
  const drawMedia = () => { $("#medList").innerHTML = d.media.map((m,i)=>`<div class="mthumb"><div class="mt-img">${mediaEl(m,"",true)}</div>
      <input data-cap="${i}" value="${esc(m.caption||"")}" placeholder="图注">
      <div><button type="button" class="sm" data-ins="${i}">插入正文</button>${i?`<button type="button" class="sm" data-cov="${i}">设为封面</button>`:`<span class="muted" style="font-size:11px">★ 封面</span>`}<button type="button" class="sm ghost" data-rm="${i}">×</button></div></div>`).join(""); };
  const addFiles = async files => {
    for (const [n, f] of files.entries()){
      if (!/^(image|video)\//.test(f.type)) continue;
      if (f.size > 300*1024*1024 && !confirm(`${f.name} 有 ${(f.size/1048576).toFixed(0)}MB，仍要保存吗？`)) continue;
      $("#upProg").textContent = `上传中 ${n+1}/${files.length}：${f.name}（${(f.size/1048576).toFixed(1)}MB）…`;
      const fd = new FormData(); fd.append("file", f);
      try { d.media.push(await api("/api/media", {method:"POST", body:fd})); markDirty(); drawMedia(); saveDraft(); } catch(e){ toast("上传失败：" + e.message); }
    }
    $("#upProg").textContent = "";
  };
  drawMedia();
  form.querySelectorAll("[data-up]").forEach(inp => inp.onchange = e => { addFiles([...e.target.files]); e.target.value=""; });
  $("#medUrlAdd").onclick = () => { const u = $("#medUrl").value.trim(); if (!/^https?:/.test(u)) return toast("请输入 http(s) 网址");
    d.media.push({id:"u-"+Date.now().toString(36), url:u, kind:kindOf(u), name:u.split("/").pop()}); $("#medUrl").value=""; drawMedia(); };
  const mc = $("#modalCard");
  mc.ondragover = e => e.preventDefault();
  mc.ondrop = e => { if (e.dataTransfer.files.length){ e.preventDefault(); addFiles([...e.dataTransfer.files]); } };
  mc.onpaste = e => { const fs = [...e.clipboardData.files]; if (fs.length){ e.preventDefault(); addFiles(fs); } };
  $("#medList").oninput = e => { const i = e.target.dataset.cap; if (i!=null) d.media[i].caption = e.target.value; };
  $("#medList").onclick = e => { const t = e.target.dataset;
    if (t.ins!=null){ const tok = `\n![[m:${d.media[t.ins].id}]]\n`, p = body.selectionStart ?? body.value.length; body.value = body.value.slice(0,p) + tok + body.value.slice(p);
      body.closest("details").open = true; body.focus(); }
    if (t.cov!=null){ d.media.unshift(...d.media.splice(+t.cov,1)); drawMedia(); }
    if (t.rm!=null){ const [m] = d.media.splice(+t.rm,1); body.value = body.value.replaceAll(`![[m:${m.id}]]`,""); drawMedia(); }
  };
  $("#addRel").onclick = () => $("#rels").insertAdjacentHTML("beforeend", relRow({}));
  $("#rels").onclick = e => { if (e.target.classList.contains("rx")) e.target.parentElement.remove(); };
  // 取消：有改动时先确认；未保存的上传由服务器 24 小时后自动清理
  modal._cancel = () => {
    if (modal.dataset.dirty && !confirm(isNew ? "放弃这件新藏品？已填写的内容不会保存。" : "放弃未保存的修改？")) return;
    clearTimeout(draftT);   // 撤销尚未执行的草稿保存，否则关闭后草稿会被写回
    if (isNew) localStorage.removeItem(DRAFT);
    closeModal();
  };
  $("#ecancel").onclick = () => modal._cancel();
  $("#esave").onclick = async e => {
    const out = collect();
    if (!out.name) { toast("请填写名称"); form.elements.name.closest("details").open = true; form.elements.name.focus(); return; }
    e.target.disabled = true;
    try {
      const saved = upsert(await api(isNew ? "/api/items" : "/api/items/"+encodeURIComponent(d.id), {method: isNew?"POST":"PUT", body:out}));
      clearTimeout(draftT); if (isNew) localStorage.removeItem(DRAFT);
      closeModal(); toast(isNew?"已入藏":"已更新"); go("#/item/"+encodeURIComponent(saved.id)); route();
    } catch(err){ fail(err); e.target.disabled = false; }
  };
}
function openModal(){ $("#modal").hidden = false; }
function closeModal(){ const m = $("#modal"); m.hidden = true; m.classList.remove("sheet"); delete m.dataset.lock; delete m.dataset.dirty; m._cancel = null; }
// 点击遮罩：普通弹窗关闭；录入表单（lock）不关闭，只晃动提示，避免误触丢失内容
$("#modal").onclick = e => {
  if (e.target.id !== "modal") return;
  if (!$("#modal").dataset.lock) return closeModal();
  const c = $("#modalCard"); c.classList.remove("nudge"); void c.offsetWidth; c.classList.add("nudge");
  toast("点 × 取消，或点 ✓ 保存");
};
// Esc：录入表单走「取消」流程（有改动会先确认）
const escModal = () => $("#modal").dataset.lock ? $("#modal")._cancel?.() : closeModal();

/* ---------- knowledge graph (自制力导向布局) ---------- */
function graph(){
  const hidden = new Set(cfg.hiddenTypes||[]);
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>知识网络 · Knowledge Graph</h2><span class="muted">拖拽节点 · 滚轮缩放 · 双击打开</span></div>
  <div class="graph-wrap"><canvas id="cv"></canvas>
    <div class="legend" id="lg">${Object.entries(TYPES).map(([k,v])=>`<span data-t="${k}" class="${hidden.has(k)?"off":""}" style="${tc(k)}"><i class="dot"></i>${v.zh}</span>`).join("")}</div>
    <div class="graph-tip" id="gtip"></div></div>`;
  const cv = $("#cv"), ctx = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
  const color = t => css.getPropertyValue("--t-"+t).trim() || "#888";
  const ink = css.getPropertyValue("--ink").trim(), line = css.getPropertyValue("--line").trim(), muted = css.getPropertyValue("--muted").trim();
  let W, H, dpr = devicePixelRatio||1;
  const resize = () => { const r = cv.getBoundingClientRect(); W=r.width; H=r.height; cv.width=W*dpr; cv.height=H*dpr; };
  resize();
  const items = db.items.filter(i=>!hidden.has(i.type));
  const ids = new Set(items.map(i=>i.id));
  const E = edges().filter(e=>ids.has(e.s)&&ids.has(e.t));
  const deg = {}; E.forEach(e=>{deg[e.s]=(deg[e.s]||0)+1; deg[e.t]=(deg[e.t]||0)+1;});
  const N = items.map((it,i) => { const a=i*2.4; return { it, x:Math.cos(a)*(60+i*6), y:Math.sin(a)*(60+i*6), vx:0, vy:0, r:5+Math.sqrt(deg[it.id]||0)*3.5 }; });
  const M = Object.fromEntries(N.map(n=>[n.it.id,n]));
  const L = E.map(e=>({a:M[e.s],b:M[e.t],e}));
  let view = {x:0,y:0,k:1}, drag=null, hover=null, alpha=1, raf, panning=null;
  function tick(){
    if (alpha > 0.01){
      for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++){
        const a=N[i], b=N[j]; let dx=b.x-a.x, dy=b.y-a.y, d2=dx*dx+dy*dy||1, f=1800/d2*alpha;
        const d=Math.sqrt(d2); dx/=d; dy/=d; a.vx-=dx*f; a.vy-=dy*f; b.vx+=dx*f; b.vy+=dy*f;
      }
      for (const l of L){ const dx=l.b.x-l.a.x, dy=l.b.y-l.a.y, d=Math.hypot(dx,dy)||1, f=(d-90)*0.04*alpha; l.a.vx+=dx/d*f; l.a.vy+=dy/d*f; l.b.vx-=dx/d*f; l.b.vy-=dy/d*f; }
      for (const n of N){ n.vx -= n.x*0.004*alpha; n.vy -= n.y*0.004*alpha; if (n!==drag){ n.x+=n.vx; n.y+=n.vy; } n.vx*=0.6; n.vy*=0.6; }
      alpha *= 0.985;
    }
    draw(); raf = requestAnimationFrame(tick);
  }
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    ctx.translate(W/2+view.x, H/2+view.y); ctx.scale(view.k, view.k);
    const hn = hover ? new Set([hover.it.id, ...L.filter(l=>l.a===hover||l.b===hover).flatMap(l=>[l.a.it.id,l.b.it.id])]) : null;
    for (const l of L){
      const on = !hn || (hn.has(l.a.it.id)&&hn.has(l.b.it.id)&&(l.a===hover||l.b===hover));
      ctx.globalAlpha = on?0.9:0.12; ctx.strokeStyle = on&&hover?muted:line; ctx.lineWidth = 1.2/view.k;
      ctx.setLineDash(l.e.soft?[4,4]:[]); ctx.beginPath(); ctx.moveTo(l.a.x,l.a.y); ctx.lineTo(l.b.x,l.b.y); ctx.stroke();
      if (hover && on){ ctx.fillStyle=muted; ctx.font=`${10/view.k}px Inter`; ctx.textAlign="center"; ctx.fillText(l.e.label,(l.a.x+l.b.x)/2,(l.a.y+l.b.y)/2-3); }
    }
    ctx.setLineDash([]);
    for (const n of N){
      const on = !hn || hn.has(n.it.id);
      ctx.globalAlpha = on?1:0.2; ctx.fillStyle = color(n.it.type);
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,7); ctx.fill();
      if (n.it.status==="tried"){ ctx.strokeStyle=ink; ctx.lineWidth=1.5/view.k; ctx.stroke(); }
      if (view.k>0.6 || n===hover || n.r>9){ ctx.fillStyle=ink; ctx.font=`${(n===hover?13:11.5)/view.k}px "Noto Serif SC", serif`; ctx.textAlign="center"; ctx.fillText(n.it.name, n.x, n.y+n.r+13/view.k); }
    }
    ctx.globalAlpha=1;
  }
  const toWorld = (cx,cy) => { const r=cv.getBoundingClientRect(); return [((cx-r.left)-W/2-view.x)/view.k, ((cy-r.top)-H/2-view.y)/view.k]; };
  const hit = (x,y) => N.find(n => Math.hypot(n.x-x,n.y-y) < n.r+4);
  cv.onpointerdown = e => { const [x,y]=toWorld(e.clientX,e.clientY); drag=hit(x,y); if(!drag) panning={x:e.clientX-view.x,y:e.clientY-view.y}; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => {
    const [x,y]=toWorld(e.clientX,e.clientY);
    if (drag){ drag.x=x; drag.y=y; alpha=Math.max(alpha,0.3); }
    else if (panning){ view.x=e.clientX-panning.x; view.y=e.clientY-panning.y; }
    else { hover = hit(x,y)||null; cv.style.cursor = hover?"pointer":"grab"; $("#gtip").textContent = hover ? `${hover.it.name} · ${hover.it.region||""}` : ""; }
  };
  cv.onpointerup = () => { drag=null; panning=null; };
  cv.ondblclick = e => { const n=hit(...toWorld(e.clientX,e.clientY)); if(n) go("#/item/"+encodeURIComponent(n.it.id)); };
  cv.onwheel = e => { e.preventDefault(); view.k = Math.min(3,Math.max(0.3, view.k*(e.deltaY<0?1.1:0.9))); };
  $("#lg").onclick = e => { const s=e.target.closest("[data-t]"); if(!s) return; const t=s.dataset.t; hidden.has(t)?hidden.delete(t):hidden.add(t); cfg.hiddenTypes=[...hidden]; saveCfg(); route(); };
  window.addEventListener("resize", resize);
  tick();
  graphStop = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
}

/* ---------- taste profile ---------- */
function profile(){
  const tried = db.items.filter(i=>i.status==="tried");
  const fl = {}; let w = 0;
  for (const i of tried) if (hasFlavor(i.flavor)){ const wt = (i.rating||3); w+=wt; for (const k in FLAVORS) fl[k]=(fl[k]||0)+(+i.flavor[k]||0)*wt; }
  for (const k in FLAVORS) fl[k] = w ? +(fl[k]/w).toFixed(2) : 0;
  const count = key => { const m={}; tried.forEach(i => key(i).forEach(v => m[v]=(m[v]||0)+(i.rating||3))); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const lv = {}, lc = {};
  for (const i of tried) for (const [k,v] of Object.entries(i.health?.levels||{})){ lv[k] = (lv[k]||0) + v; lc[k] = (lc[k]||0) + 1; }
  const levels = Object.fromEntries(Object.keys(lv).map(k => [k, lv[k]/lc[k]]));
  return { tried, fl, levels, ingredients:count(i=>i.health?.ingredients||[]), regions:count(i=>i.region?[i.region.split("·")[0].trim()]:[]), tags:count(i=>i.tags||[]), types:count(i=>[TYPES[i.type].zh]),
    top: [...tried].sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0,8) };
}
function taste(){
  const p = profile();
  const bars = (arr) => { const mx = arr[0]?.[1]||1; return arr.slice(0,8).map(([k,v])=>`<div class="bar"><span>${esc(k)}</span><i style="width:${v/mx*100}%"></i></div>`).join("") || `<p class="muted">暂无数据</p>`; };
  const fk = Object.entries(p.fl).sort((a,b)=>b[1]-a[1]);
  const persona = fk[0]?.[1] ? `你偏爱 <b>${FLAVORS[fk[0][0]]}</b> 与 <b>${FLAVORS[fk[1][0]]}</b>，对 <b>${FLAVORS[fk.at(-1)[0]]}</b> 着墨最少。` : "给已品尝的藏品打分并填写风味，品味画像会逐渐浮现。";
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>品味档案 · Taste Profile</h2><span class="muted">基于 ${p.tried.length} 件已品尝藏品，按评分加权</span></div>
  <div class="taste">
    <div class="panel"><h4>风味指纹</h4><div style="text-align:center">${radar(p.fl,300)}</div><p class="prose" style="text-align:center;font-size:15px">${persona}</p></div>
    <div class="side">
      <div class="panel"><h4>心之所向 · 地区</h4>${bars(p.regions)}</div>
      <div class="panel"><h4>常见标签</h4>${bars(p.tags)}</div>
      <div class="panel"><h4>类别</h4>${bars(p.types)}</div>
      ${Object.keys(p.levels).length || p.ingredients.length ? `<div class="panel"><h4>饮食倾向</h4>
        ${Object.entries(p.levels).map(([k,v])=>`<div class="bar"><span>${LEVELS[k]}</span><i style="width:${v/3*100}%;background:var(--gold)"></i><small class="muted">${LEVEL_TXT[Math.round(v)]}</small></div>`).join("")}
        ${p.ingredients.length?`<div class="eyebrow" style="margin-top:10px">常吃的配料</div><div class="tags">${p.ingredients.slice(0,12).map(([k])=>`<span class="tag">${esc(k)}</span>`).join("")}</div>`:""}</div>` : ""}
    </div>
  </div>
  <div class="section-h"><h2>我的殿堂级藏品</h2><a href="#/ai" style="color:var(--accent)">✦ 让 AI 基于品味推荐 →</a></div>${grid(p.top)}`;
}

/* ---------- AI：经服务器调用 Claude 或 DeepSeek（密钥只在服务器） ---------- */
let aiCfg = null;
const loadAiCfg = async () => (aiCfg = await api("/api/ai/config"));
async function claude(prompt, system){
  return (await api("/api/ai", {method:"POST", body:{prompt, system, provider: cfg.aiProvider || undefined}})).text;
}
async function aiSettingsOpen(){ try { await loadAiCfg(); aiSettings(); } catch(e){ fail(e); } }
function aiSettings(){
  const c = aiCfg;
  const block = (id, p) => `<div class="panel ai-prov">
      <div style="display:flex;align-items:center;gap:10px"><h3 style="font-size:22px">${p.label}</h3>
        <span class="muted" style="font-size:12px">${p.hasKey ? `已配置 ${esc(p.keyHint)}${p.fromEnv?"（来自 .env）":""}` : "未配置"}</span>
        <label class="chk" style="margin-left:auto"><input type="radio" name="aidef" value="${id}" ${c.default===id?"checked":""}> 默认</label></div>
      <div class="form" style="grid-template-columns:1fr;margin-top:10px">
        <label>API Key<input type="password" data-p="${id}" data-f="key" placeholder="${p.hasKey ? "留空则保持不变" : id==="claude" ? "sk-ant-…" : "sk-…"}" autocomplete="off"></label>
        <label>模型<input data-p="${id}" data-f="model" value="${esc(p.model)}" list="ml-${id}"><datalist id="ml-${id}">${p.models.map(m=>`<option value="${esc(m)}">`).join("")}</datalist></label>
        <details><summary class="muted" style="font-size:12px;cursor:pointer">高级：接口地址（用于代理或兼容服务）</summary>
          <label style="margin-top:6px">Base URL<input data-p="${id}" data-f="baseUrl" value="${esc(p.baseUrl)}" placeholder="${esc(p.defaultBaseUrl)}"></label></details>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="sm" data-test="${id}" ${p.hasKey?"":"disabled"}>测试连接</button>
        ${p.hasKey && !p.fromEnv ? `<button type="button" class="sm ghost" data-clear="${id}">删除密钥</button>` : ""}<span class="muted" style="font-size:12px" id="tr-${id}"></span></div>
    </div>`;
  $("#modalCard").innerHTML = `<h2>AI 设置</h2>
    <p class="muted" style="font-size:13px">密钥加密保存在你的服务器上，不会发送回浏览器，访客无法使用 AI。可同时配置两家，在 AI 页面随时切换。</p>
    <div class="ai-provs">${Object.entries(c.providers).map(([id,p]) => block(id,p)).join("")}</div>
    <div class="actions"><button class="ghost" id="aiClose">关闭</button><button class="primary" id="aiSave">保存</button></div>`;
  openModal();
  const collect = (extra = {}) => {
    const providers = {};
    $("#modalCard").querySelectorAll("[data-p]").forEach(i => { (providers[i.dataset.p] ||= {})[i.dataset.f] = i.value; });
    for (const [id, v] of Object.entries(extra)) Object.assign(providers[id], v);
    return { default: $("#modalCard").querySelector("[name=aidef]:checked")?.value || "", providers };
  };
  const save = async extra => { aiCfg = await api("/api/ai/config", {method:"PUT", body:collect(extra)}); aiOn = aiCfg.available.length > 0; };
  $("#aiClose").onclick = closeModal;
  $("#aiSave").onclick = async () => { try { await save(); closeModal(); toast("AI 设置已保存"); route(); } catch(e){ fail(e); } };
  $("#modalCard").onclick = async e => {
    const t = e.target.dataset;
    if (t.clear && confirm(`删除 ${c.providers[t.clear].label} 的 API Key？`)){ try { await save({[t.clear]:{clearKey:true, key:""}}); aiSettings(); } catch(err){ fail(err); } }
    if (t.test){ const out = $("#tr-"+t.test); out.textContent = "测试中…";
      try { await save(); const r = await api("/api/ai/test", {method:"POST", body:{provider:t.test}}); out.textContent = `✓ ${r.model} · ${r.ms}ms · “${r.text.trim().slice(0,20)}”`; out.style.color = "#4a7f3a"; }
      catch(err){ out.textContent = "✗ " + err.message; out.style.color = "#b33"; } }
  };
}
const SYS = "你是一位博学、挑剔、反商业化的老饕与食物史学者，为一座私人食物博物馆撰写词条。偏爱地域性、手工、有历史与故事的食物；拒绝网红与广告腔。事实不确定时要明说。用中文回答。";
const parseJSON = t => JSON.parse((t.match(/```(?:json)?\s*([\s\S]*?)```/)||[,t])[1].replace(/^[^\[{]*/,"").replace(/[^\]}]*$/,""));
const ENTRY_SCHEMA = `{"type":"ingredient|dish|cuisine|beverage|restaurant|producer|region|culture|event|story","name":"中文名","alt":"原文名","region":"国家 · 地区","summary":"一句话","body":"2-3 段正文，可用 [[名称]] 指向相关条目","story":"一则轶事或冷知识","tags":["..."],"flavor":{"sweet":0,"sour":0,"salty":0,"bitter":0,"umami":0,"spicy":0,"rich":0,"aroma":0},"health":{"ingredients":["3-6 个主要配料"],"kcal":"一份的大致热量整数，饮品/地区等不适用则省略","portion":"一份|一杯|100g","levels":{"energy":"1少 2适中 3多","fat":0,"protein":0,"carb":0,"sugar":0,"sodium":0},"tags":["如 发酵、含酒精、素食"]}}`;
async function ai(){
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>AI 探索 · Discovery</h2>
    <div style="display:flex;gap:8px;align-items:center"><span id="aiProv"></span><button class="sm" id="aiSet">⚙ 设置</button></div></div>
  <div id="aiEmpty"></div>
  <div class="taste">
    <div class="panel"><h4>✦ AI 编目员</h4><p class="muted" style="font-size:13px">输入一个名字，AI 起草一份词条，你审阅修改后入藏。</p>
      <div class="filters"><input id="catQ" placeholder="如：鲱鱼罐头 / 普洱生茶 / Vin Santo"><button class="primary" id="catGo">起草</button></div>
      <div id="catOut"></div></div>
    <div class="panel"><h4>✦ 基于品味的发现</h4><p class="muted" style="font-size:13px">根据你的品味档案与已有收藏，推荐你可能会着迷、但还没有收录的食物。</p>
      <div class="filters"><input id="disQ" placeholder="可选：方向，如「发酵」「巴尔干」「冬天」"><button class="primary" id="disGo">发现</button></div>
      <div id="disOut" class="ai-suggest"></div></div>
  </div>`;
  $("#aiSet").onclick = aiSettingsOpen;
  const busy = (el, on) => { el.disabled = on; el.dataset.t ||= el.textContent; el.textContent = on ? "思考中…" : el.dataset.t; };
  loadAiCfg().then(c => {
    const av = c.available;
    if (!av.length){ $("#aiEmpty").innerHTML = `<div class="panel" style="margin-bottom:16px">尚未配置 AI。点击右上角 <b>⚙ 设置</b>，填写 Claude 或 DeepSeek 的 API Key 即可使用。</div>`; return; }
    if (!av.includes(cfg.aiProvider)) cfg.aiProvider = c.default;
    $("#aiProv").innerHTML = av.length > 1
      ? `<div class="seg">${av.map(id => `<button class="sm ${cfg.aiProvider===id?"on":""}" data-prov="${id}">${c.providers[id].label}</button>`).join("")}</div>`
      : `<span class="muted" style="font-size:13px">${c.providers[av[0]].label} · ${esc(c.providers[av[0]].model)}</span>`;
    $("#aiProv").onclick = e => { const id = e.target.dataset.prov; if (!id) return; cfg.aiProvider = id; saveCfg();
      $("#aiProv").querySelectorAll("button").forEach(b => b.classList.toggle("on", b===e.target)); toast(`已切换到 ${c.providers[id].label}`); };
  }).catch(fail);
  $("#catGo").onclick = async e => {
    const q = $("#catQ").value.trim(); if (!q) return; busy(e.target,true);
    try {
      const d = parseJSON(await claude(`为「${q}」撰写博物馆词条。只输出 JSON：${ENTRY_SCHEMA}\n已有藏品（可在正文用 [[名称]] 链接）：${db.items.map(i=>i.name).join("、")}`, SYS));
      $("#catOut").innerHTML = `<div class="card" style="cursor:default">${chip(d.type)}<h3>${esc(d.name)}</h3><div class="alt">${esc(d.alt)}</div><p style="-webkit-line-clamp:unset">${esc(d.summary)}</p></div><button class="primary sm" id="catUse" style="margin-top:10px">审阅并入藏 →</button>`;
      $("#catUse").onclick = () => editor(null, {...d, source:"AI 起草，待核实"});
    } catch(err){ $("#catOut").innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    busy(e.target,false);
  };
  $("#disGo").onclick = async e => {
    busy(e.target,true);
    const p = profile();
    try {
      const list = parseJSON(await claude(`我的品味：风味偏好 ${JSON.stringify(p.fl)}；钟爱地区 ${p.regions.slice(0,5).map(x=>x[0]).join("、")}；标签 ${p.tags.slice(0,10).map(x=>x[0]).join("、")}；最爱 ${p.top.map(i=>i.name).join("、")}。
已收藏（不要重复）：${db.items.map(i=>i.name).join("、")}。${$("#disQ").value?`探索方向：${$("#disQ").value}。`:""}
推荐 5 个我可能会着迷的冷门食材/菜品/饮品/产区/故事。每个说明为何与我的品味相连。只输出 JSON 数组，每项格式：${ENTRY_SCHEMA.replace(/}$/,',"why":"推荐理由","link":"与哪件已有藏品相关（名称）"}')}`, SYS));
      $("#disOut").innerHTML = list.map((d,i)=>`<div class="card" style="cursor:default">${chip(d.type)}<h3>${esc(d.name)}</h3><div class="alt">${esc(d.alt)} · ${esc(d.region)}</div><p style="-webkit-line-clamp:unset">${esc(d.summary)}</p><p style="color:var(--accent);-webkit-line-clamp:unset">↳ ${esc(d.why)}</p><div class="foot"><span></span><button class="sm" data-i="${i}">加入想尝 ＋</button></div></div>`).join("");
      $("#disOut").onclick = ev => { const i = ev.target.dataset.i; if (i==null) return; const d = list[i]; const l = d.link && byName(d.link);
        editor(null, {...d, status:"want", source:"AI 推荐，待核实", relations: l?[{to:l.id,label:"相关"}]:[]}); };
    } catch(err){ $("#disOut").innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    busy(e.target,false);
  };
}
async function aiStory(it){
  toast("正在翻阅典籍…");
  try {
    const t = await claude(`关于「${it.name}（${it.alt||""}，${it.region||""}）」，讲一则鲜为人知、有据可查的轶事或历史细节，150 字以内，只输出正文。若不确定请注明「据传」。`, SYS);
    const story = (it.story ? it.story + "\n\n" : "") + t.trim() + "（AI 补充）";
    upsert(await api("/api/items/"+encodeURIComponent(it.id), {method:"PUT", body:{...it, story}})); route(); toast("已添加轶事");
  } catch(err){ toast(err.message); }
}

/* ---------- 价格：币种、份量换算 ---------- */
const CURRENCIES = { CNY:"¥", EUR:"€", USD:"$", GBP:"£", JPY:"JP¥", HKD:"HK$", TWD:"NT$", KRW:"₩", SGD:"S$", THB:"฿", IDR:"Rp", AUD:"A$", CAD:"C$", NOK:"", SEK:"", DKK:"", CHF:"" };
const fmtNum = p => (+p).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtPrice = (p, cur) => p == null ? "" : CURRENCIES[cur] ? `${CURRENCIES[cur]}${fmtNum(p)}` : `${fmtNum(p)}${cur ? " " + cur : ""}`;
// 从份量文字中解析克/毫升，用于折算每 100g（ml）价格
function unitOf(amount){
  const m = String(amount||"").match(/(\d+(?:[.,]\d+)?)\s*(kg|公斤|千克|ml|毫升|cl|l|升|g|克)/i); if (!m) return null;
  const n = +m[1].replace(",", "."), u = m[2].toLowerCase();
  const map = { kg:[1000,"g"], "公斤":[1000,"g"], "千克":[1000,"g"], g:[1,"g"], "克":[1,"g"], ml:[1,"ml"], "毫升":[1,"ml"], cl:[10,"ml"], l:[1000,"ml"], "升":[1000,"ml"] };
  const [k, unit] = map[u]; return n > 0 ? { qty: n * k, unit } : null;
}
const per100 = j => { const u = unitOf(j.amount); return j.price != null && u ? { v: j.price / u.qty * 100, unit: u.unit, cur: j.currency } : null; };
function priceLine(j){
  const p = per100(j), parts = [];
  if (j.price != null) parts.push(`<b>${fmtPrice(j.price, j.currency)}</b>${j.amount ? " / " + esc(j.amount) : ""}${p && p.v !== j.price ? ` <span class="muted">≈${fmtPrice(p.v, p.cur)}/100${p.unit}</span>` : ""}`);
  else if (j.amount) parts.push(esc(j.amount));
  if (j.shop) parts.push(`在 ${esc(j.shop)}`);
  return parts.length ? `<div class="price-line">${parts.join(" · ")}</div>` : "";
}
// 一件藏品的价格汇总：最近一次 + 同币种每 100g 区间
function priceSummary(it){
  const js = (it.journal||[]).filter(j => j.price != null).sort((a,b) => b.date.localeCompare(a.date));
  if (!js.length) return null;
  const ps = js.map(per100).filter(Boolean), cur = ps[0]?.cur;
  const same = ps.filter(p => p.cur === cur && p.unit === ps[0].unit).map(p => p.v);
  return { latest: js[0], count: js.length, per100: same.length ? { min: Math.min(...same), max: Math.max(...same), cur, unit: ps[0].unit } : null };
}

/* ---------- 地图（Leaflet + OpenStreetMap） ---------- */
const TILE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const typeColor = t => getComputedStyle(document.documentElement).getPropertyValue("--t-" + t).trim() || "#888";
const hasL = () => typeof window.L !== "undefined";
function baseMap(el, opts = {}){
  const m = L.map(el, { zoomControl: true, attributionControl: true, ...opts });
  L.tileLayer(TILE, { maxZoom: 19, attribution: TILE_ATTR }).addTo(m);
  return m;
}
function marker(it, m){
  return L.circleMarker([it.geo.lat, it.geo.lng], { radius: 8, color: it.status==="tried" ? "#2a2420" : "#fff", weight: 2, fillColor: typeColor(it.type), fillOpacity: .95 }).addTo(m);
}
const popupHtml = it => `<div class="pop">${chip(it.type)}<b>${esc(it.name)}</b>${it.alt?`<div class="muted">${esc(it.alt)}</div>`:""}
  ${it.geo.label?`<div>${esc(it.geo.label)}</div>`:""}<div class="muted">${esc(it.region||"")}${it.status?` · ${it.status==="tried"?"已品尝":"想尝"}`:""}</div>
  <a href="#/item/${encodeURIComponent(it.id)}">进入展柜 →</a></div>`;
const extLinks = g => `<a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=16/${g.lat}/${g.lng}">OpenStreetMap</a> · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}">Google 地图</a>`;

function mapView(params){
  const st = { status: params.get("status") || "", hidden: new Set(cfg.mapHidden || []) };
  const withGeo = db.items.filter(i => i.geo);
  const missing = db.items.filter(i => !i.geo && ["restaurant","region","producer"].includes(i.type));
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>美食地图 · Map</h2><span class="muted">${withGeo.length} 个地点</span></div>
    <div class="filters"><div class="seg" id="mSt">${[["","全部"],["want","想尝"],["tried","已品尝"]].map(([k,v])=>`<button class="sm ${st.status===k?"on":""}" data-s="${k}">${v}</button>`).join("")}</div></div>
    <div class="map-wrap"><div id="bigMap"></div>
      <div class="legend" id="mLg">${Object.entries(TYPES).filter(([k]) => withGeo.some(i => i.type===k)).map(([k,v])=>`<span data-t="${k}" class="${st.hidden.has(k)?"off":""}" style="${tc(k)}"><i class="dot"></i>${v.zh}</span>`).join("")}</div></div>
    ${missing.length && isAdmin() ? `<div class="section-h"><h2 style="font-size:22px">还没有坐标</h2><span class="muted">${missing.length} 个餐馆 / 产区 / 生产者</span></div>
      <div class="tags">${missing.map(i=>`<button class="sm" data-geoedit="${esc(i.id)}">${esc(i.name)} ＋📍</button>`).join("")}</div>` : ""}`;
  app.querySelectorAll("[data-geoedit]").forEach(b => b.onclick = () => editor(byId(b.dataset.geoedit), {}, "geo"));
  if (!hasL()) { $("#bigMap").innerHTML = `<div class="empty">地图组件加载失败（需要联网）。</div>`; return; }
  const m = baseMap($("#bigMap"), { worldCopyJump: true });
  const layer = L.layerGroup().addTo(m), markers = {};
  const draw = () => {
    layer.clearLayers();
    const shown = withGeo.filter(i => (!st.status || i.status===st.status) && !st.hidden.has(i.type));
    shown.forEach(i => { const mk = marker(i, layer); mk.bindPopup(popupHtml(i)); markers[i.id] = mk; });
    return shown;
  };
  const shown = draw();
  const focus = params.get("focus") && byId(params.get("focus"));
  if (focus?.geo){ m.setView([focus.geo.lat, focus.geo.lng], 13); markers[focus.id]?.openPopup(); }
  else if (shown.length) m.fitBounds(L.latLngBounds(shown.map(i => [i.geo.lat, i.geo.lng])).pad(0.2), { maxZoom: 12 });
  else m.setView([30, 10], 2);
  $("#mSt").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.status = b.dataset.s; $("#mSt").querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b)); draw(); };
  $("#mLg").onclick = e => { const s = e.target.closest("[data-t]"); if (!s) return; const t = s.dataset.t;
    st.hidden.has(t) ? st.hidden.delete(t) : st.hidden.add(t); s.classList.toggle("off"); cfg.mapHidden = [...st.hidden]; saveCfg(); draw(); };
  graphStop = () => m.remove();
}

// 藏品页的小地图
function itemMapPanel(it){
  if (!it.geo) return "";
  return `<div class="panel"><h4>位置</h4><div class="mini-map" id="itemMap"></div>
    <div style="font-size:13px;margin-top:8px">${it.geo.label?`${esc(it.geo.label)}<br>`:""}<a href="#/map?focus=${encodeURIComponent(it.id)}" style="color:var(--accent)">在美食地图中查看</a> · ${extLinks(it.geo)}</div></div>`;
}
function initItemMap(it){
  if (!it.geo || !hasL() || !$("#itemMap")) return;
  const m = baseMap($("#itemMap"), { scrollWheelZoom: false, dragging: !matchMedia("(pointer:coarse)").matches });
  m.setView([it.geo.lat, it.geo.lng], 13); marker(it, m);
  graphStop = () => m.remove();
}

// 录入页：位置选择（搜索地名 / 粘贴地图链接 / 当前位置 / 点地图）
function geoSection(d){
  const g = d.geo || {};
  return `<div class="geo-search"><input id="geoQ" placeholder="搜索地名或地址，也可粘贴地图链接" enterkeyhint="search"><button type="button" class="sm" id="geoGo">搜索</button><button type="button" class="sm" id="geoMe">📍 当前位置</button></div>
    <div id="geoRes" class="geo-res"></div>
    <div id="geoMap" class="geo-map"></div>
    <div class="geo-row"><label>纬度<input id="geoLat" inputmode="decimal" value="${g.lat ?? ""}"></label><label>经度<input id="geoLng" inputmode="decimal" value="${g.lng ?? ""}"></label><button type="button" class="sm ghost" id="geoClear">清除</button></div>
    <label>位置说明<input id="geoLabel" value="${esc(g.label||"")}" placeholder="如：Svinøya 老港口仓库"></label>
    <div class="muted" style="font-size:12px">点地图或拖动标记可微调位置。地名搜索由 OpenStreetMap 提供。</div>`;
}
function bindGeo(form, onChange){
  let m, mk;
  const lat = $("#geoLat"), lng = $("#geoLng");
  const val = () => { const a = parseFloat(lat.value), b = parseFloat(lng.value); return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null; };
  const set = (a, b, label, zoom) => {
    lat.value = (+a).toFixed(6); lng.value = (+b).toFixed(6);
    if (label && !$("#geoLabel").value) $("#geoLabel").value = label;
    place(zoom); onChange();
  };
  const place = zoom => {
    if (!m) return; const v = val();
    if (!v){ mk && (m.removeLayer(mk), mk = null); return; }
    if (!mk){ mk = L.marker(v, { draggable: true }).addTo(m); mk.on("dragend", () => { const p = mk.getLatLng(); set(p.lat, p.lng); }); }
    else mk.setLatLng(v);
    m.setView(v, zoom || Math.max(m.getZoom(), 13));
  };
  const init = () => {
    if (m || !hasL()) return;
    m = baseMap($("#geoMap"));
    const others = db.items.filter(i => i.geo);
    if (val()) place(13);
    else if (others.length) m.fitBounds(L.latLngBounds(others.map(i => [i.geo.lat, i.geo.lng])).pad(0.3), { maxZoom: 6 });
    else m.setView([30, 10], 2);
    m.on("click", e => set(e.latlng.lat, e.latlng.lng));
  };
  const details = $("#geoMap").closest("details");
  if (details.open) setTimeout(init, 50);
  details.addEventListener("toggle", () => { if (details.open){ init(); setTimeout(() => m?.invalidateSize(), 50); } });
  lat.oninput = lng.oninput = () => place();
  $("#geoClear").onclick = () => { lat.value = lng.value = ""; place(); onChange(); };
  $("#geoMe").onclick = () => {
    if (!navigator.geolocation || !window.isSecureContext) return toast("定位需要 HTTPS 或 localhost 访问；可改用搜索或点地图");
    toast("正在定位…");
    navigator.geolocation.getCurrentPosition(p => set(p.coords.latitude, p.coords.longitude, "", 16), e => toast("定位失败：" + e.message), { enableHighAccuracy: true, timeout: 15000 });
  };
  const search = async () => {
    const q = $("#geoQ").value.trim(); if (!q) return;
    // 粘贴的地图链接或「纬度, 经度」直接解析
    const mm = q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || q.match(/[?&](?:q|ll|query|mlat)=(-?\d+\.\d+)(?:,|&mlon=)\s*(-?\d+\.\d+)/) || q.match(/^\s*(-?\d+\.\d+)\s*[,，\s]\s*(-?\d+\.\d+)\s*$/);
    if (mm){ set(mm[1], mm[2], "", 15); $("#geoRes").innerHTML = ""; return; }
    $("#geoRes").innerHTML = `<div class="muted">搜索中…</div>`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=zh-CN,en&q=${encodeURIComponent(q)}`);
      const list = await r.json();
      $("#geoRes").innerHTML = list.length ? list.map((x,i) => `<button type="button" data-i="${i}">${esc(x.display_name)}</button>`).join("") : `<div class="muted">没有找到，换个写法或直接点地图。</div>`;
      $("#geoRes").onclick = e => { const i = e.target.closest("[data-i]")?.dataset.i; if (i == null) return; const x = list[i];
        set(x.lat, x.lon, x.name || x.display_name.split(",")[0], x.type === "city" || x.type === "administrative" ? 11 : 16); $("#geoRes").innerHTML = ""; };
    } catch { $("#geoRes").innerHTML = `<div class="muted">搜索失败（需要联网）。</div>`; }
  };
  $("#geoGo").onclick = search;
  $("#geoQ").onkeydown = e => { if (e.key === "Enter"){ e.preventDefault(); search(); } };
  return () => { const v = val(); return v ? { lat: v[0], lng: v[1], ...($("#geoLabel").value.trim() ? { label: $("#geoLabel").value.trim() } : {}) } : null; };
}

/* ---------- 对比品鉴 ---------- */
const CMP_MAX = 6;
const CMP_COLORS = ["#9b3d24","#2f6f8f","#6b8e4e","#b08a3e","#7a4b8c","#3e7f6b"];
const cmpList = () => (cfg.compare ||= []).filter(id => byId(id));
const inCmp = id => cmpList().includes(id);
function toggleCompare(id){
  let l = cmpList();
  if (l.includes(id)) l = l.filter(x => x !== id);
  else if (l.length >= CMP_MAX) { toast(`最多同时对比 ${CMP_MAX} 件`); return false; }
  else l.push(id);
  cfg.compare = l; saveCfg(); updateCmpBar(); return true;
}
function updateCmpBar(){
  let bar = $("#cmpBar");
  if (!bar){ bar = document.createElement("div"); bar.id = "cmpBar"; bar.className = "cmp-bar"; document.body.appendChild(bar);
    bar.onclick = e => { const a = e.target.dataset.a; if (a==="go") go("#/compare"); if (a==="clear"){ cfg.compare = []; saveCfg(); updateCmpBar(); route(); } }; }
  const n = cmpList().length, here = G.current?.r === "compare";
  bar.hidden = !n || here || !me;
  bar.innerHTML = `⚖ 对比 <b>${n}</b> 件 <button class="sm primary" data-a="go">查看</button><button class="sm ghost" data-a="clear">清空</button>`;
}
function radarMulti(list, size = 300){
  const keys = Object.keys(FLAVORS), c = size/2, R = c - 40, n = keys.length;
  const pt = (i,v) => { const a = -Math.PI/2 + i*2*Math.PI/n; return [c+Math.cos(a)*R*v/5, c+Math.sin(a)*R*v/5]; };
  let g = "";
  for (let l=1;l<=5;l++) g += `<polygon points="${keys.map((_,i)=>pt(i,l).join(",")).join(" ")}" fill="none" stroke="var(--line)"/>`;
  g += keys.map((k,i)=>{ const [x,y]=pt(i,6.2); return `<text x="${x}" y="${y}" font-size="12" fill="var(--muted)" text-anchor="middle" dominant-baseline="middle">${FLAVORS[k]}</text>`; }).join("");
  list.forEach(({ it, color }) => { if (hasFlavor(it.flavor))
    g += `<polygon points="${keys.map((k,i)=>pt(i,+(it.flavor[k]||0)).join(",")).join(" ")}" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2"/>`; });
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:${size}px">${g}</svg>`;
}
function compare(){
  const list = cmpList().map((id,i) => ({ it: byId(id), color: CMP_COLORS[i] }));
  const ids = new Set(list.map(x => x.it.id));
  // 推荐加入：与已选藏品同类型或共享标签
  const tags = new Set(list.flatMap(x => x.it.tags||[])), types = new Set(list.map(x => x.it.type));
  const sugg = db.items.filter(i => !ids.has(i.id) && (types.has(i.type) && (i.tags||[]).some(t => tags.has(t)))).slice(0, 12);
  const head = `<div class="section-h" style="margin-top:0"><h2>对比品鉴 · Compare</h2><span class="muted">${list.length} / ${CMP_MAX} 件</span></div>`;
  const addBar = `<div class="cmp-add"><select id="cmpAdd"><option value="">＋ 添加藏品…</option>${sugg.length?`<optgroup label="同类推荐">${sugg.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</optgroup>`:""}
      <optgroup label="全部">${db.items.filter(i=>!ids.has(i.id)).sort((a,b)=>a.name.localeCompare(b.name,"zh")).map(i=>`<option value="${esc(i.id)}">${esc(i.name)} · ${TYPES[i.type].zh}</option>`).join("")}</optgroup></select>
      ${list.length?`<button class="sm ghost" id="cmpClear">清空</button>`:""}</div>`;
  if (list.length < 2){
    app.innerHTML = head + addBar + `<div class="empty">至少选两件藏品来对比。<br><span style="font-size:15px">在「图鉴」点 ⚖ 选择对比，或在藏品页点「⚖ 加入对比」。</span></div>`;
    bindCmp(); return;
  }
  const cell = f => list.map(x => `<td>${f(x.it, x.color)}</td>`).join("");
  const maxOf = k => Math.max(...list.map(x => +(x.it.flavor?.[k]||0)));
  const ps = list.map(x => priceSummary(x.it));
  const p100 = ps.map(p => p?.per100);
  const sameCur = p100.filter(Boolean).length > 1 && p100.filter(Boolean).every(p => p.cur === p100.find(Boolean).cur && p.unit === p100.find(Boolean).unit);
  const cheapest = sameCur ? Math.min(...p100.filter(Boolean).map(p => p.min)) : null;
  const anyLv = Object.keys(LEVELS).filter(k => list.some(x => x.it.health?.levels?.[k]));
  const row = (label, html, cls="") => `<tr class="${cls}"><th>${label}</th>${html}</tr>`;
  app.innerHTML = head + addBar + `
  <div class="cmp-top"><div class="panel cmp-radar"><h4>风味叠加</h4>${radarMulti(list, 320)}
      <div class="cmp-legend">${list.map(x=>`<span><i style="background:${x.color}"></i>${esc(x.it.name)}</span>`).join("")}</div></div></div>
  <div class="cmp-scroll"><table class="cmp">
    <thead><tr><th></th>${list.map(x=>`<th style="border-top:4px solid ${x.color}">
      <div class="cmp-cover">${cover(x.it) ? mediaEl(cover(x.it), "", true) : `<span style="${tc(x.it.type)}">${esc([...x.it.name][0])}</span>`}</div>
      <a href="#/item/${encodeURIComponent(x.it.id)}" class="cmp-name">${esc(x.it.name)}</a>${x.it.alt?`<div class="alt">${esc(x.it.alt)}</div>`:""}
      <button class="sm ghost" data-rm="${esc(x.it.id)}">移除</button></th>`).join("")}</tr></thead>
    <tbody>
      ${row("类别 · 地区", cell(it => `${chip(it.type)}<div class="muted" style="font-size:12px;margin-top:4px">${esc(it.region||"—")}</div>`))}
      ${row("我的评分", cell(it => it.rating ? stars(it.rating) : `<span class="muted">${it.status==="want"?"想尝":"—"}</span>`))}
      ${row("价格", cell((it,c,i) => { const p = priceSummary(it); if (!p) return `<span class="muted">—</span>`;
        const best = p.per100 && cheapest != null && Math.abs(p.per100.min - cheapest) < 1e-9;
        return `${fmtPrice(p.latest.price, p.latest.currency)}${p.latest.amount?` / ${esc(p.latest.amount)}`:""}
          ${p.per100?`<div class="${best?"best":"muted"}" style="font-size:12px">≈${fmtPrice(p.per100.min, p.per100.cur)}${p.per100.max!==p.per100.min?`–${fmtPrice(p.per100.max, p.per100.cur)}`:""}/100${p.per100.unit}${best?" · 最划算":""}</div>`:""}
          ${p.latest.shop?`<div class="muted" style="font-size:12px">${esc(p.latest.shop)}</div>`:""}${p.count>1?`<div class="muted" style="font-size:12px">共 ${p.count} 次记录</div>`:""}`; }), "sec-row")}
      <tr class="grp"><th colspan="${list.length+1}">风味</th></tr>
      ${Object.keys(FLAVORS).filter(k => maxOf(k) > 0).map(k => row(FLAVORS[k], cell(it => { const v = +(it.flavor?.[k]||0), top = v && v === maxOf(k);
        return `<span class="cmp-dots${top?" top":""}">${[1,2,3,4,5].map(n=>`<i class="${n<=v?"on":""}"></i>`).join("")}</span>`; }))).join("")}
      ${anyLv.length || list.some(x => x.it.health?.kcal || x.it.health?.ingredients?.length) ? `<tr class="grp"><th colspan="${list.length+1}">健康印象</th></tr>` : ""}
      ${list.some(x => x.it.health?.kcal) ? row("热量约", cell(it => it.health?.kcal ? `${it.health.kcal} kcal${it.health.portion?` / ${esc(it.health.portion)}`:""}` : `<span class="muted">—</span>`)) : ""}
      ${anyLv.map(k => row(LEVELS[k], cell(it => { const v = it.health?.levels?.[k]; return v ? `<i class="m m${v}"><b></b><b></b><b></b></i> <span class="muted" style="font-size:12px">${LEVEL_TXT[v]}</span>` : `<span class="muted">—</span>`; }))).join("")}
      ${list.some(x => x.it.health?.ingredients?.length) ? row("主要配料", cell(it => (it.health?.ingredients||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join(" ") || `<span class="muted">—</span>`)) : ""}
      <tr class="grp"><th colspan="${list.length+1}">记录</th></tr>
      ${row("品尝次数", cell(it => { const js = it.journal||[]; return js.length ? `${js.length} 次 <span class="muted" style="font-size:12px">· 最近 ${esc(js.map(j=>j.date).sort().at(-1))}</span>` : `<span class="muted">—</span>`; }))}
      ${row("最近笔记", cell(it => { const j = (it.journal||[]).filter(j=>j.text).sort((a,b)=>b.date.localeCompare(a.date))[0]; return j ? `<span style="font-size:13px">${esc(j.text.slice(0,80))}${j.text.length>80?"…":""}</span>` : `<span class="muted">—</span>`; }))}
      ${row("标签", cell(it => (it.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join(" ") || `<span class="muted">—</span>`))}
      ${row("简介", cell(it => `<span style="font-size:13px">${esc(it.summary||"")}</span>`))}
    </tbody></table></div>`;
  bindCmp();
}
function bindCmp(){
  $("#cmpAdd").onchange = e => { if (e.target.value && toggleCompare(e.target.value)) route(); };
  $("#cmpClear") && ($("#cmpClear").onclick = () => { cfg.compare = []; saveCfg(); route(); });
  app.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { toggleCompare(b.dataset.rm); route(); });
}

/* ---------- command palette ---------- */
let sel = 0, results = [];
function openPalette(){ $("#palette").hidden=false; $("#paletteInput").value=""; renderPalette(); $("#paletteInput").focus(); }
function renderPalette(){
  const q = $("#paletteInput").value.trim().toLowerCase();
  results = db.items.filter(i => !q || [i.name,i.alt,i.region,(i.tags||[]).join(" ")].join(" ").toLowerCase().includes(q)).slice(0,30);
  if (q && isAdmin() && !results.some(r=>r.name.toLowerCase()===q)) results.push({create:q});
  sel = Math.min(sel, results.length-1); if (sel<0) sel=0;
  $("#paletteResults").innerHTML = results.map((r,i)=> r.create ? `<div class="pr ${i===sel?"on":""}" data-i="${i}">＋ 新建藏品「${esc(r.create)}」</div>`
    : `<div class="pr ${i===sel?"on":""}" data-i="${i}" style="${tc(r.type)}"><span class="dot"></span>${esc(r.name)} <span class="muted">${esc(r.alt)}</span><small>${TYPES[r.type].zh}</small></div>`).join("");
}
function pick(i){ const r = results[i]; $("#palette").hidden=true; if(!r) return; r.create ? editor(null,{name:r.create}) : go("#/item/"+encodeURIComponent(r.id)); }
$("#paletteInput").oninput = () => { sel=0; renderPalette(); };
$("#paletteInput").onkeydown = e => {
  if (e.key==="ArrowDown"){ sel=Math.min(sel+1,results.length-1); renderPalette(); e.preventDefault(); }
  else if (e.key==="ArrowUp"){ sel=Math.max(sel-1,0); renderPalette(); e.preventDefault(); }
  else if (e.key==="Enter") pick(sel);
};
$("#paletteResults").onclick = e => { const p=e.target.closest(".pr"); if(p) pick(+p.dataset.i); };
$("#palette").onclick = e => { if (e.target.id==="palette") $("#palette").hidden=true; };

/* ---------- global ---------- */
document.addEventListener("keydown", e => {
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); openPalette(); }
  if (e.key==="Escape"){ $("#palette").hidden=true; $("#moreSheet").hidden=true; if (!$("#modal").hidden) escModal(); $(".menu")?.remove(); }
  if (e.key==="n" && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $("#modal").hidden && $("#palette").hidden && isAdmin()) editor(null);
});
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g && app.dataset.pick && g.classList.contains("card") && app.contains(g)) { if (toggleCompare(g.dataset.go)) g.classList.toggle("picked", inCmp(g.dataset.go)); return; }
  if (g && !e.target.closest("button")) { go("#/item/"+encodeURIComponent(g.dataset.go)); return; }
  const n = e.target.closest("[data-new]"); if (n && isAdmin()) editor(null,{name:n.dataset.new});
  if (!e.target.closest(".menu,#menuBtn")) $(".menu")?.remove();
});
$("#searchBtn").onclick = openPalette;
// 手机底部「更多」：显示全部页面
$("#moreBtn").onclick = () => { const n = cmpList().length; $('#moreSheet a[data-r="compare"] span').textContent = n ? `对比 · ${n}` : "对比"; $("#moreSheet").hidden = false; };
$("#moreSheet").onclick = e => { if (e.target.id === "moreSheet" || e.target.closest("a")) $("#moreSheet").hidden = true; };
$("#shareBtn").onclick = () => window.Share?.open();
// 供 share.js 使用的只读上下文
const G = window.G = { get items(){ return db.items; }, cmpList, CMP_COLORS, priceSummary, fmtPrice, TYPES, FLAVORS, LEVELS, LEVEL_TXT, profile, cover, mediaUrl, mediaSrc, byId, edges, current:null };
$("#newBtn").classList.add("admin");
document.body.insertAdjacentHTML("beforeend", `<button class="fab admin" id="fab" aria-label="新藏品">＋</button>`);
$("#fab").onclick = () => editor(null);
$("#newBtn").onclick = () => editor(null);
$("#menuBtn").onclick = () => {
  if ($(".menu")) return $(".menu").remove();
  const m = document.createElement("div"); m.className="menu";
  m.innerHTML = `<div class="muted" style="font-size:12px;padding:4px 14px">${esc(me?.name)} · ${isAdmin()?"馆长":"访客"}</div>
    ${isAdmin()?`<button data-a="invite">✉ 邀请朋友</button><button data-a="ai">✦ AI 设置</button><button data-a="export">⇩ 导出 JSON</button><button data-a="import">⇧ 导入 JSON / 旧版备份</button>`:""}
    <button data-a="theme">◐ 切换明暗</button><button data-a="logout">⎋ 退出登录</button>`;
  document.body.appendChild(m);
  m.onclick = e => {
    const a = e.target.dataset.a; if (!a) return; m.remove();
    if (a==="export") location.href = "/api/export";
    if (a==="import") $("#importFile").click();
    if (a==="invite") inviteView();
    if (a==="ai") aiSettingsOpen();
    if (a==="theme"){ const dark = matchMedia("(prefers-color-scheme: dark)").matches; const cur = cfg.theme || (dark?"dark":"light"); cfg.theme = cur==="dark"?"light":"dark"; document.documentElement.dataset.theme=cfg.theme; saveCfg(); route(); }
    if (a==="logout") api("/api/logout", {method:"POST"}).finally(() => location.reload());
  };
};
async function inviteView(){
  $("#modalCard").innerHTML = `<h2>邀请朋友</h2><p class="muted" style="font-size:14px">朋友打开链接即可以「访客」身份浏览（只读）。每个链接只能使用一次。</p>
    <div class="form"><label>备注（朋友的名字）<input id="ivn" placeholder="如：小林"></label><label>有效期（天）<input id="ivd" type="number" value="7" min="1" max="90"></label></div>
    <div class="actions"><button class="ghost" id="ivc">关闭</button><button class="primary" id="ivg">生成链接</button></div><div id="ivo" style="margin-top:14px"></div>
    <h4 class="eyebrow" style="margin-top:20px">访客</h4><div id="ivu" style="font-size:14px"></div>`;
  openModal();
  const users = async () => { const us = await api("/api/users");
    $("#ivu").innerHTML = us.filter(u=>u.role==="viewer").map(u=>`<div class="rel">${esc(u.name)}<span class="lbl">${u.created_at.slice(0,10)}</span><button class="sm ghost" data-rmu="${u.id}">移除</button></div>`).join("") || `<p class="muted">还没有访客。</p>`; };
  users();
  $("#ivu").onclick = e => { const id = e.target.dataset.rmu; if (id && confirm("移除该访客？")) api("/api/users/"+id, {method:"DELETE"}).then(users, fail); };
  $("#ivc").onclick = closeModal;
  $("#ivg").onclick = async () => { try {
    const r = await api("/api/invites", {method:"POST", body:{note:$("#ivn").value.trim(), days:+$("#ivd").value}});
    const url = location.origin + r.url;
    $("#ivo").innerHTML = `<input readonly value="${esc(url)}" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;background:var(--bg)" onclick="this.select()">`;
    navigator.clipboard?.writeText(url).then(() => toast("链接已复制"), () => {});
  } catch(e){ fail(e); } };
}
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  toast("正在导入…");
  try {
    const r = await api("/api/import", {method:"POST", body: await f.text(), raw:true});
    await reload(); route(); toast(`已导入 ${r.items} 件藏品${r.files?`、${r.files} 个媒体文件`:""}`);
  } catch(err){ toast("导入失败：" + err.message); }
  e.target.value = "";
};

/* ---------- 登录与启动 ---------- */
function loginView(){
  document.body.classList.add("ro", "locked");
  app.innerHTML = `<div class="login exhibit"><div class="eyebrow">Gastronomique</div><h1>私人食物博物馆</h1>
    <p class="muted">本馆仅对馆长与受邀访客开放。</p>
    <form id="lf" class="form" style="grid-template-columns:1fr"><label>用户名<input name="name" autocomplete="username" required></label>
    <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="primary">进入</button><div id="lerr" style="color:#b33;font-size:13px"></div></form></div>`;
  $("#lf").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target);
    try { await api("/api/login", {method:"POST", body:{name:f.get("name"), password:f.get("password")}}); boot(); }
    catch(err){ $("#lerr").textContent = err.message; } };
}
async function boot(){
  try {
    const r = await api("/api/me"); me = r.user; aiOn = r.ai;
    if (!me) return loginView();
    document.body.classList.remove("locked");
    document.body.classList.toggle("ro", !isAdmin());
    document.querySelectorAll('[data-r="ai"]').forEach(a => a.hidden = !isAdmin());
    await reload(); route();
  } catch(e){ app.innerHTML = `<div class="empty">无法连接服务器：${esc(e.message)}</div>`; }
}
window.removeEventListener("hashchange", route);
window.addEventListener("hashchange", () => me && route());
boot();
})();

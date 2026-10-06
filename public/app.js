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
const offlineErr = (msg = "网络不可用（离线）") => Object.assign(new Error(msg), { offline: true });
let cacheRefreshT;
async function api(path, { method="GET", body, raw, timeout } = {}){
  const opt = { method, headers:{} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined){ opt.headers["content-type"] = "application/json"; opt.body = raw ? body : JSON.stringify(body); }
  // 手机明确离线时写操作不再白等；信号很弱时请求可能一直挂着，用超时兜底并视为离线
  if (method !== "GET" && !navigator.onLine) throw offlineErr();
  const ms = timeout ?? (body instanceof FormData ? 180e3 : path.startsWith("/api/ai") || path === "/api/import" ? 330e3 : 15e3);
  opt.signal = AbortSignal.timeout(ms);
  let r;
  try { r = await fetch(path, opt); }
  catch (e) { throw offlineErr(e.name === "TimeoutError" ? "网络太慢，请求超时（已按离线处理）" : undefined); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 503 && j.offline) throw offlineErr(j.error);
  // 写操作成功后，后台刷新一次离线缓存里的藏品列表
  if (r.ok && method !== "GET" && navigator.serviceWorker?.controller){ clearTimeout(cacheRefreshT); cacheRefreshT = setTimeout(() => fetch("/api/items").catch(() => {}), 1500); }
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
  if (m.local){ const u = esc(localUrls.get(m.id) || ""); return m.kind==="video" ? `<video class="${cls}" src="${u}" muted playsinline controls></video>` : `<img class="${cls}" src="${u}" alt="">`; }
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
// 专题：被 ≥3 件藏品以「出现于」指向的藏品（收藏指南、图鉴海报等）
const MEMBER_LABEL = "出现于";
const membersOf = id => db.items.filter(x => (x.relations||[]).some(r => r.to===id && r.label===MEMBER_LABEL));
const collections = () => { const n = {}; for (const x of db.items) for (const r of x.relations||[]) if (r.label===MEMBER_LABEL) n[r.to] = (n[r.to]||0) + 1;
  return db.items.filter(x => n[x.id] >= 3); };
const progress = list => ({ total: list.length, tried: list.filter(x => x.status==="tried").length, want: list.filter(x => x.status==="want").length });
const progBar = p => `<div class="prog"><i style="width:${p.total ? p.tried/p.total*100 : 0}%"></i></div>`;
function colCard(c){
  const p = progress(membersOf(c.id)), cv = cover(c);
  return `<a class="col-card" href="#/item/${encodeURIComponent(c.id)}">${cv?`<div class="col-cover">${mediaEl(cv,"",true)}</div>`:""}
    <div class="col-info"><b>${esc(c.name)}</b><span class="muted">已尝 ${p.tried} / ${p.total}${p.want?` · 想尝 ${p.want}`:""}</span>${progBar(p)}</div></a>`;
}
function card(it){
  const c = cover(it);
  return `<article class="card has-cover${inCmp(it.id)?" picked":""}" data-go="${esc(it.id)}">
    <div class="cover${c?"":" ph"}" style="${tc(it.type)}">${c?mediaEl(c,"",true):`<span>${esc([...(it.name||"·")][0])}</span>`}</div>
    ${chip(it.type)}
    <h3>${esc(it.name)}</h3>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
    <p>${esc(it.summary)}</p>
    <div class="foot"><span>${esc(it.region||"")}</span><span>${stars(it.rating)||statusTxt(it.status)}</span></div>
  </article>`;
}
const grid = items => items.length ? `<div class="grid">${items.map(card).join("")}</div>` : `<div class="empty">展柜还空着——添一件藏品吧。</div>`;
// 行内：转义、**粗体**、[[双链]]
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[\[([^\]]+)\]\]/g, (_,n) => {
  const t = byName(n.replace(/&amp;/g,"&"));
  return t ? `<span class="wl" data-go="${esc(t.id)}">${n}</span>` : `<span class="wl missing" data-new="${n}" title="尚未收藏，点击创建">${n}</span>`;
});
// 正文：支持常用 Markdown（标题、列表、引用、表格），连续行按块合并
function renderBody(txt, it){
  const find = id => (it?.media||[]).find(m => m.id===id);
  const lines = (txt||"").split("\n").map(l => l.trim()).filter(Boolean);
  const out = [];
  const cells = l => l.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
  for (let i = 0; i < lines.length; i++){
    const p = lines[i];
    const mm = p.match(/^!\[\[m:([\w-]+)\]\]$/), mu = p.match(/^!\[([^\]]*)\]\((https?:[^)\s]+)\)$/), h = p.match(/^(#{1,4})\s+(.+)$/);
    if (mm){ const m = find(mm[1]); if (m) out.push(`<figure>${mediaEl(m)}${m.caption?`<figcaption>${esc(m.caption)}</figcaption>`:""}</figure>`); continue; }
    if (mu){ out.push(`<figure>${mediaEl({url:mu[2], kind:kindOf(mu[2]), caption:mu[1]})}${mu[1]?`<figcaption>${esc(mu[1])}</figcaption>`:""}</figure>`); continue; }
    if (h){ const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (p.startsWith("|")){
      const rows = []; while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]); i--;
      const body = rows.filter(r => !/^\|[\s:|-]+\|?$/.test(r)).map(cells);
      const head = rows.length > 1 && /^\|[\s:|-]+\|?$/.test(rows[1]) ? body.shift() : null;
      out.push(`<div class="table-wrap"><table>${head?`<thead><tr>${head.map(c=>`<th>${inline(c)}</th>`).join("")}</tr></thead>`:""}<tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const li = /^([-*]|\d+\.)\s+/;
    if (li.test(p)){
      const ol = /^\d/.test(p), items = []; while (i < lines.length && li.test(lines[i])) items.push(lines[i++].replace(li, "")); i--;
      out.push(`<${ol?"ol":"ul"}>${items.map(x=>`<li>${inline(x)}</li>`).join("")}</${ol?"ol":"ul"}>`); continue;
    }
    if (p.startsWith(">")){ out.push(`<blockquote>${inline(p.replace(/^>\s*/, ""))}</blockquote>`); continue; }
    out.push(`<p>${inline(p)}</p>`);
  }
  return out.join("");
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
  clearAppClick();
  ({home, discover, atlas, stories, graph, taste, ai, item, map: mapView, compare, catalog, dupes}[r] || home)(params, parts[1] && decodeURIComponent(parts[1]));
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
  const recent = [...items].sort((a,b)=>(b.created||"").localeCompare(a.created||"")).slice(0,8);
  // 最近一批：与最新一件同一天入藏的数量
  const lastDay = (recent[0]?.created||"").slice(0,10), batch = lastDay ? items.filter(i => (i.created||"").startsWith(lastDay)).length : 0;
  const cols = collections().map(c => ({ c, p: progress(membersOf(c.id)) }))
    .sort((a,b) => (b.p.want>0) - (a.p.want>0) || b.p.tried/b.p.total - a.p.tried/a.p.total).slice(0,3);
  app.innerHTML = `
  <section class="hero">
    ${ex ? `<div class="exhibit${cover(ex)?" with-media":""}">${cover(ex)?`<div class="exhibit-media">${mediaEl(cover(ex))}</div>`:""}<div class="exhibit-text">
      <div class="eyebrow">今日展品 · Exhibit No. ${String(items.indexOf(ex)+1).padStart(3,"0")}</div>
      <h1>${esc(ex.name)}</h1><div class="exhibit-body clamped"><div class="alt">${esc(ex.alt)}</div>
      <p>${esc(ex.summary)}</p>${ex.story?`<div class="story-box">${esc(ex.story)}</div>`:""}</div>
      <button class="more-toggle" hidden>展开全文 ↓</button>
      <div class="plaque">${chip(ex.type)}<span>${esc(ex.region)}</span><a href="#/item/${encodeURIComponent(ex.id)}" style="color:var(--accent);margin-left:auto">进入展柜 →</a></div>
    </div></div>` : `<div class="exhibit"><h1>欢迎</h1><p>你的私人食物博物馆还没有藏品。</p></div>`}
    <div class="side-col">
      <div class="stats">
        <a class="stat" href="#/catalog"><b>${items.length}</b><span>藏品</span></a>
        <a class="stat" href="#/atlas?tab=tried"><b>${tried}</b><span>已品尝</span></a>
        <a class="stat" href="#/atlas?tab=want"><b>${want}</b><span>想尝</span></a>
        <a class="stat" href="#/catalog?by=region"><b>${regions.size}</b><span>地区</span></a>
        <a class="stat" href="#/graph"><b>${edges().length}</b><span>连接</span></a>
        <a class="stat" href="#/stories"><b>${items.filter(i=>i.story||i.type==="story").length}</b><span>轶事</span></a>
      </div>
      ${cols.length?`<div class="panel home-cols"><div class="section-h" style="margin:0 0 8px"><h4 style="margin:0">专题进度</h4><a class="muted" href="#/atlas?tab=collections">全部 →</a></div>${cols.map(x=>colCard(x.c)).join("")}</div>`:""}
      <div class="quote">${QUOTES[day%QUOTES.length]}</div>
    </div>
  </section>
  <div class="section-h"><h2>展厅分区</h2><span class="muted">按类别浏览</span></div>
  <div class="seg">${Object.entries(TYPES).map(([k,v])=>`<button onclick="location.hash='#/discover?type=${k}'" style="${tc(k)}"><span class="dot" style="display:inline-block;margin-right:6px"></span>${v.zh} · ${items.filter(i=>i.type===k).length}</button>`).join("")}</div>
  <div class="section-h"><h2>最近入藏</h2><span class="muted">${batch > 8 ? `${lastDay.slice(5).replace("-","月")}日一批入藏 ${batch} 件 · ` : ""}<a href="#/catalog?by=time" style="color:var(--accent)">全部 →</a></span></div>
  ${grid(recent)}`;
  const body = app.querySelector(".exhibit-body"), more = app.querySelector(".more-toggle");
  if (body && body.scrollHeight > body.clientHeight + 4) {
    more.hidden = false;
    more.onclick = () => { const c = body.classList.toggle("clamped"); more.textContent = c ? "展开全文 ↓" : "收起 ↑"; };
  } else if (body) body.classList.remove("clamped");
}

const PAGE = 36;
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
    // 分批渲染：先画一页，滚到底部或点「加载更多」再接着画
    let shown = 0;
    const more = () => {
      const next = list.slice(shown, shown += PAGE);
      const g = $("#res .grid"); if (g) g.insertAdjacentHTML("beforeend", next.map(card).join(""));
      const left = list.length - shown, b = $("#moreBtn");
      if (b){ b.hidden = left <= 0; b.textContent = `加载更多（还有 ${left} 件）`; }
    };
    $("#res").innerHTML = list.length ? `<div class="grid"></div><div class="load-more"><button id="moreBtn">加载更多</button></div>` : grid([]);
    if (list.length){ more(); $("#moreBtn").onclick = more;
      st.io?.disconnect(); st.io = new IntersectionObserver(es => es[0].isIntersecting && shown < list.length && more(), { rootMargin: "600px" });
      st.io.observe($("#moreBtn")); }
    $("#cnt").textContent = `${list.length} 件藏品`;
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
  const tabs = {tried:"已品尝",want:"想尝清单",collections:"专题收藏",journal:"品尝日志"};
  let body;
  if (tab==="collections"){
    const cs = collections();
    body = cs.length ? `<div class="col-grid">${cs.map(colCard).join("")}</div>`
      : `<div class="empty">当 3 件以上藏品在「关系」中以「出现于」指向同一件藏品（如一份收藏指南），它就成为一个专题。</div>`;
  } else if (tab==="journal"){
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

// 专题页的收藏清单：按国家分组，勾选即标记「已品尝」
function collectionPanel(it){
  const ms = membersOf(it.id);
  if (ms.length < 3) return "";
  const f = cfg.colFilter || "all", p = progress(ms);
  const key = x => x.alt || x.name;
  ms.sort((a,b) => key(a).localeCompare(key(b), "zh", { numeric: true }));
  const groups = new Map();
  for (const x of ms){ const g = countryName(countryOf(x)) || (x.region||"").split("·")[0].trim() || "其他"; (groups.get(g) || groups.set(g, []).get(g)).push(x); }
  const show = x => f==="all" || (f==="todo" ? x.status!=="tried" : x.status==="tried");
  const row = x => `<li class="cl-row${x.status==="tried"?" done":""}"${show(x)?"":" hidden"}>
    <label class="cl-check" title="${x.status==="tried"?"取消已品尝":"标记为已品尝"}"><input type="checkbox" data-cl="${esc(x.id)}" ${x.status==="tried"?"checked":""} ${isAdmin()?"":"disabled"}><i></i></label>
    ${cover(x)?`<span class="cl-thumb">${mediaEl(cover(x),"",true)}</span>`:""}
    <a href="#/item/${encodeURIComponent(x.id)}" class="cl-name">${esc(x.name)}${(x.tags||[]).includes("首选")?` <span class="cl-top">首选</span>`:""}</a>
    <span class="cl-meta">${stars(x.rating)||statusTxt(x.status)}</span></li>`;
  return `<section class="collection" id="collection">
    <div class="cl-head"><h3>收藏清单</h3><span class="muted">已尝 <b>${p.tried}</b> / ${p.total}${p.want?` · 想尝 ${p.want}`:""}</span>
      <div class="seg" id="clSeg">${[["all","全部"],["todo","未尝"],["done","已尝"]].map(([k,v])=>`<button class="sm ${f===k?"on":""}" data-f="${k}">${v}</button>`).join("")}</div></div>
    ${progBar(p)}
    ${[...groups].map(([g, xs]) => { const gp = progress(xs); return `<div class="cl-group"><div class="cl-gh"><span>${esc(g)}</span><span class="muted">${gp.tried}/${gp.total}</span></div><ul>${xs.map(row).join("")}</ul></div>`; }).join("")}
  </section>`;
}
function bindCollection(it){
  const box = $("#collection"); if (!box) return;
  $("#clSeg").onclick = e => { const b = e.target.closest("button"); if (!b) return; cfg.colFilter = b.dataset.f; saveCfg(); const y = scrollY; route(); scrollTo(0, y); };
  box.onchange = e => {
    const id = e.target.dataset.cl; if (!id) return;
    const status = e.target.checked ? "tried" : "want", x = byId(id);
    api("/api/items/"+encodeURIComponent(id), {method:"PATCH", body:{status}}).then(r => { upsert(r); }, async err => {
      if (!isOffline(err)) { e.target.checked = !e.target.checked; return fail(err); }
      await queueOp({type:"patch", id, body:{status}}); applyPending(); toast("已离线保存，联网后自动同步");
    }).then(() => { const y = scrollY; route(); scrollTo(0, y); });
    if (x) x.status = status;
  };
}
function item(_, id){
  const it = byId(id);
  if (!it) { app.innerHTML = `<div class="empty">找不到这件藏品。</div>`; return; }
  const nb = neighbors(id);
  const sameRegion = db.items.filter(x => x.id!==id && it.region && (x.region||"").split("·")[0].trim()===it.region.split("·")[0].trim() && !nb.some(n=>n.item.id===x.id)).slice(0,6);
  app.innerHTML = `
  <div class="detail">
    <div>
      <div style="display:flex;gap:10px;align-items:center">${chip(it.type)}<span class="eyebrow">${esc(it.region)}</span>${it._pending?`<span class="chip" style="color:var(--gold);border-color:var(--gold)">待同步</span>`:""}</div>
      <h1>${esc(it.name)}</h1>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
      ${cover(it) && !(it.body||"").includes("m:"+cover(it).id) ? `<figure class="lead">${mediaEl(cover(it))}${cover(it).caption?`<figcaption>${esc(cover(it).caption)}</figcaption>`:""}</figure>` : ""}
      <p class="prose" style="font-size:18px;margin-top:18px">${esc(it.summary)}</p>
      ${collectionPanel(it)}
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
        <dt>类别</dt><dd>${TYPES[it.type]?.zh}</dd>${countryOf(it)?`<dt>国家</dt><dd><a href="#/catalog?by=region" style="color:var(--accent)">${esc(countryName(countryOf(it)))}</a></dd>`:""}<dt>地区</dt><dd>${esc(it.region)||"—"}</dd>
        <dt>入藏</dt><dd>${(it.created||"").slice(0,10)}</dd></dl>
        <div class="tags" style="margin-top:10px">${(it.tags||[]).map(t=>`<a class="tag" href="#/discover?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}</div></div>
      <div class="panel"><h4 style="display:flex;justify-content:space-between">知识连接 · ${nb.length}${nb.length?`<a href="#/graph?focus=${encodeURIComponent(it.id)}" style="color:var(--accent);font-weight:400">在网络中查看 →</a>`:""}</h4>
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
  const offlineSave = async op => { await queueOp(op); applyPending(); route(); toast("已离线保存，联网后自动同步"); };
  const patch = body => isAdmin() && api("/api/items/"+encodeURIComponent(it.id), {method:"PATCH", body}).then(refresh,
    e => isOffline(e) ? offlineSave({type:"patch", id:it.id, body}) : fail(e));
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
    api(id ? `/api/journal/${id}` : `/api/items/${encodeURIComponent(it.id)}/journal`, {method: id ? "PUT" : "POST", body}).then(refresh,
      e => isOffline(e) ? offlineSave({type:"journal", id:it.id, body:{...body, id: id || undefined}}) : fail(e)); };
  bindCollection(it);
  $("#cmpBtn").onclick = () => { if (toggleCompare(it.id)) $("#cmpBtn").textContent = inCmp(it.id) ? "✓ 已在对比中" : "⚖ 加入对比"; };
  initItemMap(it);
  app.querySelectorAll("[data-delj]").forEach(b => b.onclick = () => { if(confirm("删除这条日志？"))
    api("/api/journal/"+b.dataset.delj, {method:"DELETE"}).then(() => api("/api/items/"+encodeURIComponent(it.id))).then(refresh, fail); });
  $("#edit").onclick = () => editor(it);
  $("#del").onclick = () => { if (confirm(`从博物馆中移除「${it.name}」？`)) api("/api/items/"+encodeURIComponent(it.id), {method:"DELETE"}).then(() => {
    // 同时清掉本机离线缓存里的这件藏品的图片
    window.caches?.open("media-v1").then(c => (it.media||[]).forEach(m => [m.file, m.thumb].filter(Boolean).forEach(f => c.delete(mediaUrl(f))))).catch(() => {});
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
      <label>国家<select name="country" data-auto="${d.country ? "" : "1"}">${countryOptions(d.country || inferCountry(d.region))}</select></label>
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
  // 地区文字变化时，若国家未手动选过，自动推断
  form.elements.region.addEventListener("input", () => { const sel = form.elements.country;
    if (sel.dataset.auto){ const c = inferCountry(form.elements.region.value); if (c) sel.value = c; } });
  form.elements.country.addEventListener("change", e => e.target.dataset.auto = "");
  if (focus === "geo") setTimeout(() => $("#geoQ").closest("details").scrollIntoView({block:"start"}), 100);
  if (isNew && !d.name) setTimeout(() => form.elements.name.focus(), 50);

  // 收集表单为藏品对象
  const collect = () => {
    const f = new FormData(form);
    const levels = {}; form.querySelectorAll(".lvl").forEach(l => { const on = l.querySelector(".on"); if (on) levels[l.dataset.l] = +on.dataset.n; });
    return { ...d, type: form.querySelector(".typechips .on")?.dataset.type || d.type,
      name:(f.get("name")||"").trim(), alt:f.get("alt").trim(), region:f.get("region").trim(), country:f.get("country") || "", summary:f.get("summary").trim(),
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
      try { d.media.push(await api("/api/media", {method:"POST", body:fd})); markDirty(); drawMedia(); saveDraft(); }
      catch(e){
        if (!isOffline(e)) { toast("上传失败：" + e.message); continue; }
        const id = "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        await OB.putFile(id, f); localUrls.set(id, URL.createObjectURL(f));
        d.media.push({ id, kind: kindOf(f.type), name: f.name, local: true }); markDirty(); drawMedia();
        toast("离线：照片已暂存在本机，联网后自动上传");
      }
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
    if (isNew){
      const sim = db.items.map(x => ({ x, s: similarity({ ...out, id: "new" }, x) })).filter(o => o.s.score >= 0.8).sort((a,b) => b.s.score - a.s.score)[0];
      if (sim && !confirm(`已有相似藏品「${sim.x.name}」（${sim.s.why}）。\n仍要新建一件吗？`)) return;
    }
    e.target.disabled = true;
    const finish = (id, msg) => { clearTimeout(draftT); if (isNew) localStorage.removeItem(DRAFT); closeModal(); toast(msg); go("#/item/"+encodeURIComponent(id)); route(); };
    try {
      if (String(d.id||"").startsWith("tmp-")) throw Object.assign(new Error("待同步"), { offline: true });   // 尚未同步的离线新建：继续走队列
      await uploadLocalMedia(out);
      const saved = upsert(await api(isNew ? "/api/items" : "/api/items/"+encodeURIComponent(d.id), {method: isNew?"POST":"PUT", body:out}));
      finish(saved.id, isNew ? "已入藏" : "已更新");
    } catch(err){
      if (!isOffline(err)) { fail(err); e.target.disabled = false; return; }
      if (isNew){ const tmpId = "tmp-" + Date.now().toString(36); await queueOp({ type:"create", tmpId, body:out }); }
      else await queueOp({ type:"update", id:d.id, body:out });
      applyPending(); finish(isNew ? pendingOps.at(-1).tmpId : d.id, "已离线保存，联网后自动同步");
    }
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
/* 知识网络
   - 总览：专题成员默认收进专题节点（显示件数），隐藏孤立节点；只给重要节点写名字
   - 聚焦：搜索或单击节点 → 只看它 1～2 层以内的邻居，侧栏列出连接；双击打开藏品 */
function graph(params){
  const hidden = new Set(cfg.hiddenTypes||[]);
  const g = cfg.graph ||= { expand:false, isolated:false, depth:1 };
  const focusId = params?.get("focus") || "";
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>知识网络 · Knowledge Graph</h2><span class="muted">单击聚焦 · 双击打开 · 拖拽 / 滚轮缩放</span></div>
  <div class="graph-bar">
    <div class="graph-search"><input id="gq" placeholder="搜索藏品并聚焦…" autocomplete="off"><div class="graph-sug" id="gsug" hidden></div></div>
    ${focusId?`<div class="seg" id="gdepth">${[1,2].map(d=>`<button class="sm ${g.depth===d?"on":""}" data-d="${d}">${d} 层</button>`).join("")}</div><button class="sm" id="gall">← 返回总览</button>`
      :`<label class="gchk"><input type="checkbox" id="gexp" ${g.expand?"checked":""}> 展开专题成员</label><label class="gchk"><input type="checkbox" id="giso" ${g.isolated?"checked":""}> 显示孤立藏品</label>`}
  </div>
  <div class="graph-wrap"><canvas id="cv"></canvas>
    <div class="legend" id="lg">${Object.entries(TYPES).map(([k,v])=>`<span data-t="${k}" class="${hidden.has(k)?"off":""}" style="${tc(k)}"><i class="dot"></i>${v.zh}</span>`).join("")}</div>
    <div class="graph-zoom"><button class="sm" data-z="in" aria-label="放大">＋</button><button class="sm" data-z="out" aria-label="缩小">－</button><button class="sm" data-z="fit" aria-label="适应窗口">⤢</button></div>
    <aside class="graph-info" id="ginfo" hidden></aside>
    <div class="graph-stat muted" id="gstat"></div></div>`;
  const cv = $("#cv"), ctx = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
  const color = t => css.getPropertyValue("--t-"+t).trim() || "#888";
  const ink = css.getPropertyValue("--ink").trim(), line = css.getPropertyValue("--line").trim(), muted = css.getPropertyValue("--muted").trim(), paper = css.getPropertyValue("--paper").trim(), accent = css.getPropertyValue("--accent").trim();
  let W, H, dpr = devicePixelRatio||1;
  const resize = () => { const r = cv.getBoundingClientRect(); W=r.width; H=r.height; cv.width=W*dpr; cv.height=H*dpr; };
  resize();

  // ---- 选出要画的节点和边 ----
  const all = edges();
  const hubOf = {};   // 成员 → 专题
  const colIds = new Set(collections().map(c => c.id));
  for (const e of all) if (e.label===MEMBER_LABEL && colIds.has(e.t)) hubOf[e.s] ||= e.t;
  let ids, E;
  if (focusId && byId(focusId)){
    ids = new Set([focusId]);
    for (let d = 0; d < g.depth; d++){ const add = []; for (const e of all){ if (ids.has(e.s)) add.push(e.t); if (ids.has(e.t)) add.push(e.s); } add.forEach(x => ids.add(x)); }
    for (const id of [...ids]) if (id!==focusId && hidden.has(byId(id)?.type)) ids.delete(id);
    E = all.filter(e => ids.has(e.s) && ids.has(e.t));
  } else {
    const rep = id => !g.expand && hubOf[id] ? hubOf[id] : id;   // 收起时，成员的连接改挂到专题上
    const seen = new Set(); E = [];
    for (const e of all){
      const s = rep(e.s), t = rep(e.t); if (s===t) continue;
      if (hidden.has(byId(s)?.type) || hidden.has(byId(t)?.type)) continue;
      const k = s < t ? s+"|"+t : t+"|"+s; if (seen.has(k)) continue; seen.add(k);
      E.push({ ...e, s, t });
    }
    ids = new Set(E.flatMap(e => [e.s, e.t]));
    if (!g.expand) for (const c of colIds) if (!hidden.has(byId(c)?.type)) ids.add(c);   // 专题即使没有外部连接也显示
    if (g.isolated) for (const it of db.items) if (!hidden.has(it.type) && (g.expand || !hubOf[it.id])) ids.add(it.id);
  }
  const deg = {}; E.forEach(e=>{deg[e.s]=(deg[e.s]||0)+1; deg[e.t]=(deg[e.t]||0)+1;});
  const size = {}; if (!focusId && !g.expand) for (const m in hubOf) size[hubOf[m]] = (size[hubOf[m]]||0) + 1;
  const items = [...ids].map(byId).filter(Boolean);
  const N = items.map((it,i) => { const a=i*2.4, rr=30+Math.sqrt(i)*28;
    return { it, x:Math.cos(a)*rr, y:Math.sin(a)*rr, vx:0, vy:0, n:size[it.id]||0,
      r: it.id===focusId ? 14 : size[it.id] ? 9+Math.sqrt(size[it.id])*2.2 : 4.5+Math.sqrt(deg[it.id]||0)*2.6 }; });
  const M = Object.fromEntries(N.map(n=>[n.it.id,n]));
  const L = E.map(e=>({a:M[e.s],b:M[e.t],e})).filter(l => l.a && l.b);
  if (M[focusId]) { M[focusId].x = M[focusId].y = 0; }
  // 名字只写给连接最多的一部分节点，放大或悬停时再显示其余
  const labelRank = [...N].sort((a,b)=>b.r-a.r); const labelMin = labelRank[Math.min(labelRank.length-1, focusId?60:24)]?.r || 0;
  $("#gstat").textContent = `${N.length} 个节点 · ${L.length} 条连接`;

  let view = {x:0,y:0,k:1}, drag=null, hover=null, sel=M[focusId]||null, alpha=1, raf, panning=null, moved=false;
  function tick(){
    if (alpha > 0.005){
      step();
    }
    draw(); raf = requestAnimationFrame(tick);
  }
  function step(){
    for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++){
      const a=N[i], b=N[j]; let dx=b.x-a.x, dy=b.y-a.y, d2=dx*dx+dy*dy||1; if (d2 > 160000) continue;
      const f=(1400+(a.r+b.r)*60)/d2*alpha, d=Math.sqrt(d2); dx/=d; dy/=d; a.vx-=dx*f; a.vy-=dy*f; b.vx+=dx*f; b.vy+=dy*f;
    }
    for (const l of L){ const dx=l.b.x-l.a.x, dy=l.b.y-l.a.y, d=Math.hypot(dx,dy)||1, rest=(focusId?90:60)+l.a.r+l.b.r, f=(d-rest)*0.05*alpha; l.a.vx+=dx/d*f; l.a.vy+=dy/d*f; l.b.vx-=dx/d*f; l.b.vy-=dy/d*f; }
    for (const n of N){ const gr = deg[n.it.id] ? 0.006 : 0.03; n.vx -= n.x*gr*alpha; n.vy -= n.y*gr*alpha;   // 孤立节点拉近些，避免把整张图挤小
      if (n!==drag && !(focusId && n.it.id===focusId)){ n.x+=n.vx; n.y+=n.vy; } n.vx*=0.55; n.vy*=0.55; }
    alpha *= 0.975;
  }
  function fit(){
    if (!N.length) return;
    const xs = N.map(n=>n.x), ys = N.map(n=>n.y), pad = 70;
    // 信息栏占去的空间：宽屏在右侧，手机在底部
    const box = $("#ginfo"), open = !box.hidden, side = open && W > 860 ? 300 : 0, bottom = open && W <= 860 ? box.offsetHeight + 10 : 0;
    const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
    view.k = Math.max(0.2, Math.min(2.2, (W-side-pad*2)/((x1-x0)||1), (H-bottom-pad*2)/((y1-y0)||1)));
    view.x = -(x0+x1)/2*view.k - side/2; view.y = -(y0+y1)/2*view.k - bottom/2;
  }
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    ctx.translate(W/2+view.x, H/2+view.y); ctx.scale(view.k, view.k);
    const act = hover || sel;
    const hn = act ? new Set([act.it.id, ...L.filter(l=>l.a===act||l.b===act).flatMap(l=>[l.a.it.id,l.b.it.id])]) : null;
    const actDeg = hn ? hn.size - 1 : 0;   // 连接太多时不写关系名，免得糊成一片
    for (const l of L){
      const on = !hn || l.a===act || l.b===act;
      ctx.globalAlpha = on ? (act ? 0.9 : 0.45) : 0.06; ctx.strokeStyle = on&&act ? muted : line; ctx.lineWidth = (on&&act?1.4:1)/view.k;
      ctx.setLineDash(l.e.soft?[4/view.k,4/view.k]:[]); ctx.beginPath(); ctx.moveTo(l.a.x,l.a.y); ctx.lineTo(l.b.x,l.b.y); ctx.stroke();
      if (act && on && view.k > 0.5 && actDeg <= 15){ ctx.globalAlpha=0.85; ctx.fillStyle=muted; ctx.font=`${10/view.k}px Inter, sans-serif`; ctx.textAlign="center"; ctx.fillText(l.e.label,(l.a.x+l.b.x)/2,(l.a.y+l.b.y)/2-3/view.k); }
    }
    ctx.setLineDash([]);
    const labels = [];
    for (const n of N){
      const on = !hn || hn.has(n.it.id);
      ctx.globalAlpha = on?1:0.15; ctx.fillStyle = color(n.it.type);
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,7); ctx.fill();
      if (n.n){ ctx.lineWidth=3/view.k; ctx.strokeStyle=paper; ctx.stroke(); ctx.lineWidth=1.2/view.k; ctx.strokeStyle=color(n.it.type); ctx.beginPath(); ctx.arc(n.x,n.y,n.r+3/view.k,0,7); ctx.stroke();
        ctx.fillStyle="#fff"; ctx.font=`600 ${Math.max(9, n.r*0.8)/view.k*Math.min(view.k,1)}px Inter, sans-serif`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText(n.n, n.x, n.y); ctx.textBaseline="alphabetic"; }
      if (n.it.status==="tried"){ ctx.strokeStyle=ink; ctx.lineWidth=1.5/view.k; ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,7); ctx.stroke(); }
      if (n===sel){ ctx.strokeStyle=accent; ctx.lineWidth=2.5/view.k; ctx.beginPath(); ctx.arc(n.x,n.y,n.r+5/view.k,0,7); ctx.stroke(); }
      const show = n===act || (hn ? hn.has(n.it.id) && (view.k>0.7 || n.r>=labelMin) : (n.r >= labelMin || view.k > 1.3));
      if (show && on) labels.push(n);
    }
    // 简单避让：按重要性依次放，已占位置重叠就跳过（当前节点除外）
    const boxes = [];
    labels.sort((a,b)=>(b===act)-(a===act) || b.r-a.r);
    for (const n of labels){
      const fs = (n===act?14:12)/view.k; ctx.font=`${n===act?"600 ":""}${fs}px "Noto Serif SC", serif`;
      const w = ctx.measureText(n.it.name).width, x = n.x - w/2, y = n.y + n.r + 4/view.k, h = fs*1.25;
      if (n!==act && boxes.some(b => x < b.x+b.w && x+w > b.x && y < b.y+b.h && y+h > b.y)) continue;
      boxes.push({x,y,w,h});
      ctx.globalAlpha=1; ctx.lineWidth=3/view.k; ctx.strokeStyle=paper; ctx.textAlign="center"; ctx.textBaseline="top";
      ctx.strokeText(n.it.name, n.x, y); ctx.fillStyle=ink; ctx.fillText(n.it.name, n.x, y); ctx.textBaseline="alphabetic";
    }
    ctx.globalAlpha=1;
  }
  const toWorld = (cx,cy) => { const r=cv.getBoundingClientRect(); return [((cx-r.left)-W/2-view.x)/view.k, ((cy-r.top)-H/2-view.y)/view.k]; };
  const hit = (x,y) => { let best=null, bd=Infinity; for (const n of N){ const d=Math.hypot(n.x-x,n.y-y); if (d < n.r+6/view.k && d < bd){ best=n; bd=d; } } return best; };
  const focusUrl = id => "#/graph?focus=" + encodeURIComponent(id);
  function info(n){
    const box = $("#ginfo"); if (!n){ box.hidden = true; return; }
    const it = n.it, nb = neighbors(it.id), ms = colIds.has(it.id) ? membersOf(it.id) : [];
    box.hidden = false;
    box.innerHTML = `<button class="sm ghost gi-x" aria-label="关闭">×</button>${chip(it.type)}<h3>${esc(it.name)}</h3>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
      ${it.summary?`<p>${esc(it.summary)}</p>`:""}
      <div class="gi-act"><a class="primary sm btn" href="#/item/${encodeURIComponent(it.id)}">打开藏品</a>${it.id!==focusId?`<a class="sm btn" href="${focusUrl(it.id)}">聚焦此处</a>`:""}</div>
      ${ms.length?`<div class="eyebrow">专题成员 · ${ms.length}</div>`:""}
      <div class="eyebrow">连接 · ${nb.length}</div>
      <div class="gi-list">${nb.slice(0,40).map(x=>`<a class="rel" href="${focusUrl(x.item.id)}" style="${tc(x.item.type)}"><span class="dot"></span>${esc(x.item.name)}<span class="lbl">${x.dir==="in"?"← ":""}${esc(x.label)}</span></a>`).join("")}${nb.length>40?`<div class="muted" style="font-size:12px">还有 ${nb.length-40} 条…</div>`:""}</div>`;
    box.querySelector(".gi-x").onclick = () => { sel = null; info(null); };
  }
  if (sel) info(sel);
  cv.onpointerdown = e => { const [x,y]=toWorld(e.clientX,e.clientY); drag=hit(x,y); moved=false; if(!drag) panning={x:e.clientX-view.x,y:e.clientY-view.y,cx:e.clientX,cy:e.clientY}; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => {
    const [x,y]=toWorld(e.clientX,e.clientY);
    if (drag){ if (Math.hypot(drag.x-x, drag.y-y) > 2/view.k) moved = true; drag.x=x; drag.y=y; drag.vx=drag.vy=0; alpha=Math.max(alpha,0.15); }
    else if (panning){ if (Math.hypot(e.clientX-panning.cx, e.clientY-panning.cy) > 3) moved = true; view.x=e.clientX-panning.x; view.y=e.clientY-panning.y; }
    else { hover = hit(x,y)||null; cv.style.cursor = hover?"pointer":"grab"; }
  };
  cv.onpointerup = () => { if (!moved){ sel = drag || null; info(sel); } drag=null; panning=null; };
  cv.onpointerleave = () => { hover = null; };
  cv.ondblclick = e => { const n=hit(...toWorld(e.clientX,e.clientY)); if(n) go("#/item/"+encodeURIComponent(n.it.id)); };
  const zoom = (f, cx = W/2, cy = H/2) => { const k = Math.min(4, Math.max(0.15, view.k*f)), r = k/view.k;
    view.x = (cx - W/2) - ((cx - W/2) - view.x)*r; view.y = (cy - H/2) - ((cy - H/2) - view.y)*r; view.k = k; };
  cv.onwheel = e => { e.preventDefault(); const r=cv.getBoundingClientRect(); zoom(e.deltaY<0?1.12:0.89, e.clientX-r.left, e.clientY-r.top); };
  app.querySelector(".graph-zoom").onclick = e => { const z = e.target.closest("[data-z]")?.dataset.z; if (z==="in") zoom(1.25); if (z==="out") zoom(0.8); if (z==="fit") fit(); };
  $("#lg").onclick = e => { const s=e.target.closest("[data-t]"); if(!s) return; const t=s.dataset.t; hidden.has(t)?hidden.delete(t):hidden.add(t); cfg.hiddenTypes=[...hidden]; saveCfg(); route(); };
  const opt = (id, k) => { const el = $(id); if (el) el.onchange = () => { g[k] = el.checked; saveCfg(); route(); }; };
  opt("#gexp", "expand"); opt("#giso", "isolated");
  if ($("#gdepth")) $("#gdepth").onclick = e => { const b = e.target.closest("[data-d]"); if (b){ g.depth = +b.dataset.d; saveCfg(); route(); } };
  if ($("#gall")) $("#gall").onclick = () => go("#/graph");
  // 搜索：名称、外文名、标签
  const q = $("#gq"), sug = $("#gsug");
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    const hits = s ? db.items.filter(i => [i.name, i.alt, (i.tags||[]).join(" ")].join(" ").toLowerCase().includes(s)).slice(0, 8) : [];
    sug.hidden = !hits.length;
    sug.innerHTML = hits.map(i => `<a href="${focusUrl(i.id)}" style="${tc(i.type)}"><span class="dot"></span>${esc(i.name)}<span class="muted">${esc(i.alt||"")}</span></a>`).join("");
  };
  q.onkeydown = e => { if (e.key==="Enter"){ const a = sug.querySelector("a"); if (a) location.hash = a.getAttribute("href"); } if (e.key==="Escape"){ q.value=""; sug.hidden=true; } };
  q.onblur = () => setTimeout(() => sug.hidden = true, 150);
  window.addEventListener("resize", resize);
  // 先离屏算到基本稳定再显示：打开即是整理好、对齐窗口的图，不再有「炸开」的过程
  const t0 = performance.now(); while (alpha > 0.02 && performance.now() - t0 < 400) step();
  fit(); tick();
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
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="sm" data-test="${id}">测试连接</button>
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
    if (t.test){
      const out = $("#tr-"+t.test), btn = e.target;
      const typed = $("#modalCard").querySelector(`[data-p="${t.test}"][data-f="key"]`).value.trim();
      if (!typed && !c.providers[t.test].hasKey){ out.textContent = "请先填写 API Key"; out.style.color = "#b33"; return; }
      // 先保存刚填写的密钥与模型，再测试；测试可能需要十几秒，期间显示进度
      btn.disabled = true; out.style.color = ""; const t0 = Date.now();
      out.textContent = "保存并测试中…";
      const tick = setInterval(() => out.textContent = `测试中… ${Math.round((Date.now()-t0)/1000)} 秒`, 1000);
      try {
        await save(); c.providers = aiCfg.providers;
        const r = await api("/api/ai/test", {method:"POST", body:{provider:t.test}, timeout: 90e3});
        out.textContent = `✓ 连接成功 · ${r.model} · ${(r.ms/1000).toFixed(1)} 秒 · “${r.text.trim().slice(0,20)}”`; out.style.color = "#4a7f3a";
      } catch(err){ out.textContent = "✗ " + err.message; out.style.color = "#b33"; }
      clearInterval(tick); btn.disabled = false;
    }
  };
}
const SYS = "你是一位博学、挑剔、反商业化的老饕与食物史学者，为一座私人食物博物馆撰写词条。偏爱地域性、手工、有历史与故事的食物；拒绝网红与广告腔。事实不确定时要明说。用中文回答。";
const parseJSON = t => JSON.parse((t.match(/```(?:json)?\s*([\s\S]*?)```/)||[,t])[1].replace(/^[^\[{]*/,"").replace(/[^\]}]*$/,""));
const ENTRY_SCHEMA = `{"type":"ingredient|dish|cuisine|beverage|restaurant|producer|region|culture|event|story","name":"中文名","alt":"原文名","region":"国家 · 地区","summary":"一句话","body":"2-3 段正文，可用 [[名称]] 指向相关条目","story":"一则轶事或冷知识","tags":["..."],"flavor":{"sweet":0,"sour":0,"salty":0,"bitter":0,"umami":0,"spicy":0,"rich":0,"aroma":0},"health":{"ingredients":["3-6 个主要配料"],"kcal":"一份的大致热量整数，饮品/地区等不适用则省略","portion":"一份|一杯|100g","levels":{"energy":"1少 2适中 3多","fat":0,"protein":0,"carb":0,"sugar":0,"sodium":0},"tags":["如 发酵、含酒精、素食"]}}`;
async function ai(){
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>AI 探索 · Discovery</h2>
    <div style="display:flex;gap:8px;align-items:center"><span id="aiProv"></span><button class="sm" id="aiSet">⚙ 设置</button></div></div>
  <div id="aiEmpty"></div>
  ${organizePanel()}
  <div class="taste">
    <div class="panel"><h4>✦ AI 编目员</h4><p class="muted" style="font-size:13px">输入一个名字，AI 起草一份词条，你审阅修改后入藏。</p>
      <div class="filters"><input id="catQ" placeholder="如：鲱鱼罐头 / 普洱生茶 / Vin Santo"><button class="primary" id="catGo">起草</button></div>
      <div id="catOut"></div></div>
    <div class="panel"><h4>✦ 基于品味的发现</h4><p class="muted" style="font-size:13px">根据你的品味档案与已有收藏，推荐你可能会着迷、但还没有收录的食物。</p>
      <div class="filters"><input id="disQ" placeholder="可选：方向，如「发酵」「巴尔干」「冬天」"><button class="primary" id="disGo">发现</button></div>
      <div id="disOut" class="ai-suggest"></div></div>
  </div>`;
  $("#aiSet").onclick = aiSettingsOpen;
  bindOrganize();
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

/* ---------- 国家（ISO 两位代码）与推断 ---------- */
// [中文名, 推断用的别名（含常见地区/城市）]
const COUNTRIES = {
  CN:["中国",["中国","中國","china","福建","福州","浙江","衢州","金华","广东","四川","云南","北京","上海","江苏","湖南","山东"]],
  TW:["台湾",["台湾","臺灣","taiwan"]], HK:["香港",["香港","hong kong"]], MO:["澳门",["澳门","澳門","macau"]],
  JP:["日本",["日本","japan","东京","京都","大阪","北海道"]], KR:["韩国",["韩国","韓國","korea"]],
  TH:["泰国",["泰国","thailand","曼谷"]], VN:["越南",["越南","vietnam"]], ID:["印尼",["印尼","印度尼西亚","indonesia","苏门答腊","巴厘"]],
  MY:["马来西亚",["马来西亚","malaysia","槟城"]], SG:["新加坡",["新加坡","singapore"]], PH:["菲律宾",["菲律宾","philippines"]],
  IN:["印度",["印度","india"]], TR:["土耳其",["土耳其","turkey","türkiye","伊斯坦布尔"]], IR:["伊朗",["伊朗","iran"]],
  LB:["黎巴嫩",["黎巴嫩","lebanon"]], IL:["以色列",["以色列","israel"]], GE:["格鲁吉亚",["格鲁吉亚","georgia"]],
  FR:["法国",["法国","france","巴黎","paris","汝拉","jura","波尔多","勃艮第","香槟","普罗旺斯","多尔多涅","dordogne","新阿基坦","阿尔萨斯","诺曼底","布列塔尼"]],
  IT:["意大利",["意大利","italy","italia","阿马尔菲","皮埃蒙特","托斯卡纳","西西里","伦巴第","威尼托","撒丁"]],
  ES:["西班牙",["西班牙","spain","españa","赫雷斯","安达卢西亚","加泰罗尼亚","巴斯克","德埃萨"]], PT:["葡萄牙",["葡萄牙","portugal","波尔图"]],
  DE:["德国",["德国","germany"]], AT:["奥地利",["奥地利","austria"]], CH:["瑞士",["瑞士","switzerland"]], BE:["比利时",["比利时","belgium"]],
  NL:["荷兰",["荷兰","netherlands","holland"]], GB:["英国",["英国","united kingdom","苏格兰","英格兰","威尔士","伦敦"]], IE:["爱尔兰",["爱尔兰","ireland"]],
  DK:["丹麦",["丹麦","denmark"]], SE:["瑞典",["瑞典","sweden"]], NO:["挪威",["挪威","norway","norge","罗弗敦","lofoten","特罗姆瑟","tromsø","塞尼亚","senja"]],
  FI:["芬兰",["芬兰","finland"]], IS:["冰岛",["冰岛","iceland"]], RU:["俄罗斯",["俄罗斯","russia"]], PL:["波兰",["波兰","poland"]],
  HU:["匈牙利",["匈牙利","hungary"]], CZ:["捷克",["捷克","czech"]], GR:["希腊",["希腊","greece"]], HR:["克罗地亚",["克罗地亚","croatia"]],
  US:["美国",["美国","usa","united states","加州","纽约"]], CA:["加拿大",["加拿大","canada"]], MX:["墨西哥",["墨西哥","mexico"]],
  PE:["秘鲁",["秘鲁","peru"]], BR:["巴西",["巴西","brazil"]], AR:["阿根廷",["阿根廷","argentina"]], CL:["智利",["智利","chile"]],
  MA:["摩洛哥",["摩洛哥","morocco"]], TN:["突尼斯",["突尼斯","tunisia","tunisie"]], EG:["埃及",["埃及","egypt"]], ET:["埃塞俄比亚",["埃塞俄比亚","ethiopia"]], ZA:["南非",["南非","south africa"]],
  AU:["澳大利亚",["澳大利亚","australia"]], NZ:["新西兰",["新西兰","new zealand"]],
  XX:["多国 / 跨地区",["全球","多国","斯堪的纳维亚","scandinavia","地中海","古罗马"]],
};
const countryName = c => COUNTRIES[c]?.[0] || "";
// 显示用的国家：已保存的优先，否则按地区文字推断（老数据无需逐件重新保存）
const countryOf = it => it.country || inferCountry(it.region);
// 从「国家 · 地区」等文字推断国家：按词从左到右，命中第一个即返回
function inferCountry(...texts){
  for (const t of texts) {
    for (const token of String(t||"").toLowerCase().split(/[·・\/,，、|()（）]+/)) {
      const w = token.trim(); if (!w) continue;
      for (const [code, [, aliases]] of Object.entries(COUNTRIES)) if (aliases.some(a => w.includes(a.toLowerCase()))) return code;
    }
  }
  return "";
}
// 二级地区：取「国家 · 地区 细分」中地区的第一个词，如「罗弗敦 Reine」「罗弗敦 Svolvær」都归入「罗弗敦」
const subRegion = it => ((it.region||"").split(/[·・]/)[1] || "").trim().split(/\s+|\s*\/\s*/)[0];
const countryOptions = sel => `<option value="">— 未指定 —</option>` + Object.entries(COUNTRIES)
  .sort((a,b) => a[0]==="XX" ? 1 : b[0]==="XX" ? -1 : a[1][0].localeCompare(b[1][0], "zh-Hans-u-co-pinyin"))
  .map(([c,[n]]) => `<option value="${c}" ${c===sel?"selected":""}>${n}</option>`).join("");

/* ---------- 拼音首字母（借助浏览器的拼音排序规则，无需字典） ---------- */
const PY_COLLATOR = new Intl.Collator("zh-Hans-u-co-pinyin");
const PY_BOUND = "阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀".split(""), PY_LETTER = "ABCDEFGHJKLMNOPQRSTWXYZ".split("");
function initialOf(s){
  const ch = [...String(s||"").trim()][0] || "";
  const latin = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/[a-z]/i.test(latin)) return latin.toUpperCase();
  if (/[0-9]/.test(ch) || !/[㐀-鿿]/.test(ch)) return "#";
  let i = PY_BOUND.length - 1;
  while (i > 0 && PY_COLLATOR.compare(ch, PY_BOUND[i]) < 0) i--;
  return PY_LETTER[i];
}

/* ---------- 馆藏目录 ---------- */
function catalog(params){
  const st = { by: params.get("by") || cfg.catBy || "region", q: params.get("q") || "", tag: params.get("tag") || "", status: "" };
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>馆藏目录 · Index</h2><span class="muted" id="ctCount"></span></div>
    <div class="filters"><input id="ctQ" placeholder="在目录中查找：名称、原名、地区、标签…" value="${esc(st.q)}" type="search">
      <div class="seg" id="ctSt">${[["","全部"],["tried","已品尝"],["want","想尝"]].map(([k,v])=>`<button class="sm ${k===st.status?"on":""}" data-s="${k}">${v}</button>`).join("")}</div></div>
    <div class="seg ct-tabs" id="ctBy">${[["region","地区"],["az","A–Z"],["type","类别"],["time","时间"]].map(([k,v])=>`<button class="${k===st.by?"on":""}" data-by="${k}">${v}</button>`).join("")}</div>
    <div id="ctTags" class="tags ct-tagline"></div>
    <div id="ctTools"></div>
    <div class="ct-wrap"><div id="ctBody"></div><div class="az-rail" id="azRail"></div></div>`;
  const allTags = [...new Set(db.items.flatMap(i => i.tags||[]))].sort((a,b) => PY_COLLATOR.compare(a,b));
  const row = it => {
    const tasted = (it.journal||[]).map(j => j.date).sort().at(-1);
    return `<a class="ct-row" href="#/item/${encodeURIComponent(it.id)}" style="${tc(it.type)}"><span class="dot"></span>
      <span class="ct-name">${esc(it.name)}${it.alt?` <i>${esc(it.alt)}</i>`:""}</span>
      <span class="ct-meta">${st.by!=="type"?`<em>${TYPES[it.type].zh}</em>`:""}${st.by!=="region"&&it.region?`<em>${esc(it.region.split(/[·・]/)[0].trim())}</em>`:""}${st.by==="time"&&tasted?`<em>尝于 ${tasted}</em>`:""}</span>
      <span class="ct-st">${it.rating?`<span class="stars">${"★".repeat(it.rating)}</span>`:it.status==="tried"?"●":it.status==="want"?"○":""}</span></a>`;
  };
  const group = (key, title, list, open, extra="") => `<details class="ct-group" ${open?"open":""} id="g-${esc(key)}"><summary><span>${title}</span><b>${list.length}</b></summary>${extra}${list.map(row).join("")}</details>`;
  const byPinyin = (a,b) => PY_COLLATOR.compare(a.name, b.name);
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const list = db.items.filter(i => (!st.status || i.status===st.status) && (!st.tag || (i.tags||[]).includes(st.tag)) &&
      (!q || [i.name, i.alt, i.region, countryName(countryOf(i)), (i.tags||[]).join(" "), i.summary].join(" ").toLowerCase().includes(q)));
    $("#ctCount").textContent = `${list.length} / ${db.items.length} 件`;
    $("#ctTags").innerHTML = allTags.map(t => `<span class="tag" data-tag="${esc(t)}" style="${t===st.tag?"background:var(--accent);color:#fff":""}">#${esc(t)}</span>`).join("");
    const expand = !!q || !!st.tag || list.length <= 40;
    let html = "", letters = [];
    const guessed = db.items.filter(i => !i.country && inferCountry(i.region)).length;
    $("#ctTools").innerHTML = st.by === "region" && guessed && isAdmin()
      ? `<div class="ct-fix">其中 ${guessed} 件的国家是按地区文字自动归类的，尚未保存。<button class="sm" id="ctInfer">保存为正式数据</button></div>` : "";
    if (st.by === "region"){
      const by = new Map();
      for (const it of list) { const c = countryOf(it);
        if (!by.has(c)) by.set(c, new Map());
        const sub = subRegion(it) || "（未细分）"; const m = by.get(c); m.set(sub, [...(m.get(sub)||[]), it]); }
      const keys = [...by.keys()].sort((a,b) => (!a) - (!b) || (a==="XX") - (b==="XX") || PY_COLLATOR.compare(countryName(a), countryName(b)));
      html = keys.map(c => {
        const subs = [...by.get(c).entries()].sort((a,b) => (a[0]==="（未细分）") - (b[0]==="（未细分）") || PY_COLLATOR.compare(a[0], b[0]));
        const n = subs.reduce((s,[,l]) => s + l.length, 0);
        const inner = subs.length === 1 ? subs[0][1].sort(byPinyin).map(row).join("")
          : subs.map(([s,l]) => `<div class="ct-sub">${esc(s)} <span>${l.length}</span></div>${l.sort(byPinyin).map(row).join("")}`).join("");
        const title = c ? esc(countryName(c) || c) : "未标国家";
        const fix = !c && isAdmin() ? `<div class="ct-fix muted">地区文字里没有可识别的国家，请在藏品编辑页选择</div>` : "";
        return `<details class="ct-group" ${expand || keys.length <= 6 ? "open" : ""} id="g-${c||"none"}"><summary><span>${title}</span><b>${n}</b></summary>${fix}${inner}</details>`;
      }).join("");
    } else if (st.by === "az"){
      const by = {};
      for (const it of list) (by[initialOf(it.name)] ||= []).push(it);
      letters = Object.keys(by).sort((a,b) => (a==="#") - (b==="#") || a.localeCompare(b));
      html = letters.map(L => `<div class="az-sec" id="az-${L}"><div class="az-h">${L}</div>${by[L].sort(byPinyin).map(row).join("")}</div>`).join("");
    } else if (st.by === "type"){
      html = Object.entries(TYPES).map(([k,v]) => { const l = list.filter(i => i.type===k).sort(byPinyin);
        return l.length ? group(k, `<span class="dot" style="${tc(k)};display:inline-block;margin-right:8px"></span>${v.zh}`, l, expand) : ""; }).join("");
    } else {
      const by = new Map();
      for (const it of [...list].sort((a,b) => (b.created||"").localeCompare(a.created||""))) { const m = (it.created||"").slice(0,7); by.set(m, [...(by.get(m)||[]), it]); }
      html = [...by.entries()].map(([m,l], i) => group(m, `${m.slice(0,4)} 年 ${+m.slice(5)} 月入藏`, l, expand || i < 3)).join("");
    }
    $("#ctBody").innerHTML = html || `<div class="empty">没有符合条件的藏品。</div>`;
    const ALL = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
    $("#azRail").hidden = st.by !== "az";
    $("#azRail").innerHTML = ALL.map(L => `<button data-az="${L}" ${letters.includes(L)?"":"disabled"}>${L}</button>`).join("");
    $("#ctInfer") && ($("#ctInfer").onclick = inferAll);
  };
  const inferAll = async () => {
    const todo = db.items.filter(i => !i.country).map(i => ({ it: i, c: inferCountry(i.region) })).filter(x => x.c);   // 只看地区文字：外文名里的「俄罗斯鲟」等是物种名，不是产地
    const left = db.items.filter(i => !i.country).length - todo.length;
    if (!todo.length) return toast("没有能从地区文字推断出国家的藏品，请在编辑页手动选择");
    const sample = todo.slice(0, 12).map(x => `· ${x.it.name}（${x.it.region||"—"}）→ ${countryName(x.c)}`).join("\n");
    if (!confirm(`将为 ${todo.length} 件藏品设置国家：\n\n${sample}${todo.length > 12 ? `\n…等 ${todo.length} 件` : ""}\n\n${left ? `另有 ${left} 件无法推断，保持未标。\n` : ""}继续？`)) return;
    let ok = 0;
    for (const { it, c } of todo) { try { upsert(await api("/api/items/"+encodeURIComponent(it.id), {method:"PUT", body:{...it, country:c}})); ok++; } catch(e){ if (e.offline) break; } }
    toast(`已设置 ${ok} 件`); draw();
  };
  $("#ctQ").oninput = e => { st.q = e.target.value; draw(); };
  $("#ctSt").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.status = b.dataset.s; $("#ctSt").querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b)); draw(); };
  $("#ctBy").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.by = cfg.catBy = b.dataset.by; saveCfg(); $("#ctBy").querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b)); draw(); };
  $("#ctTags").onclick = e => { const t = e.target.dataset.tag; if (t == null) return; st.tag = st.tag===t ? "" : t; draw(); };
  $("#azRail").onclick = e => { const L = e.target.dataset.az; if (L) document.getElementById("az-"+L)?.scrollIntoView({ behavior:"smooth", block:"start" }); };
  draw();
}

/* ---------- 重复检测 ---------- */
const normName = s => String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s·・\-–—_'’"“”.,，。、()（）\[\]【】/]+/g, "");
const bigrams = s => { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i+2)); return a; };
const dice = (a, b) => { if (a.length < 2 || b.length < 2) return a === b ? 1 : 0; const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return 2*n / (A.size + B.size); };
// 名称键：名称本身 + 外文名的各段；isName 标记是否来自名称
const nameKeys = it => {
  const out = [{ k: normName(it.name), isName: true }];
  for (const p of String(it.alt||"").split(/[·・\/]/)) { const k = normName(p); if (k.length >= 2 && !out.some(o => o.k === k)) out.push({ k, isName: false }); }
  return out.filter(o => o.k.length >= 2);
};
// 两件藏品的相似度：0 表示不相似；>0 时返回 {score, why}
// 至少一方必须是名称本身参与比较：外文名常写地点或描述（如「Tromsø」「Italian caviar」），两个外文名相同不算重复
function similarity(a, b){
  const ka = nameKeys(a), kb = nameKeys(b);
  let best = { score: 0, why: "" };
  for (const x of ka) for (const y of kb) {
    if (!x.isName && !y.isName) continue;
    if (x.k === y.k) return { score: 1, why: x.isName && y.isName ? "名称相同" : "名称与外文名相同" };
    if (a.type !== b.type) continue;
    const d = dice(x.k, y.k);
    if (d >= 0.8 && d > best.score) best = { score: d, why: "名称非常接近" };
    const [s, l] = x.k.length <= y.k.length ? [x.k, y.k] : [y.k, x.k];
    if (s.length >= 3 && l.includes(s) && s.length / l.length >= 0.6 && 0.8 > best.score) best = { score: 0.8, why: "名称包含" };
  }
  return best;
}
const pairKey = (a, b) => [a, b].sort().join("|");
let dupIgnore = null;
async function loadDupIgnore(){ if (dupIgnore) return dupIgnore; try { dupIgnore = new Set(await api("/api/prefs/dupIgnore") || []); } catch { dupIgnore = new Set(); } return dupIgnore; }
function findDuplicates(ignore = new Set()){
  const out = [], items = db.items.filter(i => !String(i.id).startsWith("tmp-"));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const s = similarity(items[i], items[j]);
    if (s.score && !ignore.has(pairKey(items[i].id, items[j].id))) out.push({ a: items[i], b: items[j], ...s });
  }
  return out.sort((x, y) => y.score - x.score);
}
async function dupes(){
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>疑似重复 · Duplicates</h2><span class="muted">检查中…</span></div>`;
  const ign = await loadDupIgnore();
  const list = findDuplicates(ign);
  const card = it => `<div class="dup-side" style="${tc(it.type)}">${chip(it.type)}
      <a class="dup-name" href="#/item/${encodeURIComponent(it.id)}">${esc(it.name)}</a>${it.alt?`<div class="alt">${esc(it.alt)}</div>`:""}
      <div class="muted dup-meta">${esc(it.region||"—")}${countryOf(it)?` · ${countryName(countryOf(it))}`:""}</div>
      <p>${esc((it.summary||"").slice(0,90))}</p>
      <div class="muted dup-meta">日志 ${(it.journal||[]).length} · 媒体 ${(it.media||[]).length} · 关系 ${(it.relations||[]).length} · 入藏 ${(it.created||"").slice(0,10)}</div></div>`;
  app.innerHTML = `<div class="section-h" style="margin-top:0"><h2>疑似重复 · Duplicates</h2><span class="muted">${list.length} 组</span></div>
    <p class="muted" style="font-size:13px">按名称与原名的相似度找出可能重复的藏品。合并会把另一件的日志、图片、关系、标签与缺失的字段并入保留的一件，然后删除另一件。</p>
    ${list.length ? list.map((p,i) => `<div class="dup" data-i="${i}">
      <div class="dup-why">${esc(p.why)} · 相似度 ${Math.round(p.score*100)}%</div>
      <div class="dup-pair">${card(p.a)}${card(p.b)}</div>
      ${isAdmin()?`<div class="dup-act"><button class="sm" data-keep="a">保留左边，合并右边</button><button class="sm" data-keep="b">保留右边，合并左边</button><button class="sm ghost" data-not>不是重复</button></div>`:""}
    </div>`).join("") : `<div class="empty">没有发现疑似重复。</div>`}`;
  app.onclick = async e => {
    const box = e.target.closest(".dup"); if (!box || !e.target.closest("button")) return;
    const p = list[+box.dataset.i];
    if (e.target.dataset.not != null){
      ign.add(pairKey(p.a.id, p.b.id));
      try { await api("/api/prefs/dupIgnore", {method:"PUT", body:[...ign]}); box.remove(); toast("已标记为不是重复"); } catch(err){ fail(err); }
      return;
    }
    const [keep, from] = e.target.dataset.keep === "a" ? [p.a, p.b] : [p.b, p.a];
    if (!confirm(`把「${from.name}」合并进「${keep.name}」？\n「${from.name}」的日志、图片、关系、标签会转到「${keep.name}」，然后被删除。此操作不能撤销。`)) return;
    try {
      upsert(await api(`/api/items/${encodeURIComponent(keep.id)}/merge`, {method:"POST", body:{from: from.id}}));
      await reload(); toast(`已合并到「${keep.name}」`); route();
    } catch(err){ fail(err); }
  };
}
// 路由切换时清掉 dupes 页挂在 #app 上的点击处理
const clearAppClick = () => { app.onclick = null; };

/* ---------- AI 整理文档 ---------- */
function organizePanel(){
  return `<div class="panel org"><h4>✦ 整理文档</h4>
    <p class="muted" style="font-size:13px">上传 Word / PDF、填写网址或粘贴文字，AI 会拆成藏品与关系的清单，你逐条审核后再入藏。用 Claude 时，文档里的图片与表格截图也会被读取。</p>
    <div class="seg" id="orgSrc"><button class="sm on" data-src="file">上传文件</button><button class="sm" data-src="url">网址</button><button class="sm" data-src="text">粘贴文字</button></div>
    <div class="org-in" data-p="file"><label class="upload">＋ 选择文件（.docx / .pdf / .txt / .md）<input type="file" id="orgFile" accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" hidden></label> <span id="orgFileName" class="muted"></span></div>
    <div class="org-in" data-p="url" hidden><input id="orgUrl" placeholder="https://…" inputmode="url"></div>
    <div class="org-in" data-p="text" hidden><textarea id="orgText" rows="6" placeholder="粘贴研究笔记、菜单、文章…"></textarea></div>
    <div class="filters" style="margin-top:8px"><input id="orgHint" placeholder="可选：整理要求，如「只整理餐馆」「每种鱼子酱单独成条」"><button class="primary" id="orgGo">开始整理</button></div>
    <div id="orgOut"></div></div>`;
}
function bindOrganize(){
  let src = "file", file = null;
  $("#orgSrc").onclick = e => { const b = e.target.closest("button"); if (!b) return; src = b.dataset.src;
    $("#orgSrc").querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b));
    document.querySelectorAll(".org-in").forEach(p => p.hidden = p.dataset.p !== src); };
  $("#orgFile").onchange = e => { file = e.target.files[0] || null; $("#orgFileName").textContent = file ? `${file.name}（${(file.size/1024).toFixed(0)} KB）` : ""; };
  $("#orgGo").onclick = async e => {
    const fd = new FormData();
    if (src === "file"){ if (!file) return toast("请先选择文件"); fd.append("file", file); }
    if (src === "url"){ const u = $("#orgUrl").value.trim(); if (!u) return toast("请填写网址"); fd.append("url", u); }
    if (src === "text"){ const t = $("#orgText").value.trim(); if (!t) return toast("请粘贴文字"); fd.append("text", t); }
    if ($("#orgHint").value.trim()) fd.append("hint", $("#orgHint").value.trim());
    if (cfg.aiProvider) fd.append("provider", cfg.aiProvider);
    const btn = e.target, t0 = Date.now(); btn.disabled = true;
    const tick = setInterval(() => btn.textContent = `整理中… ${Math.round((Date.now()-t0)/1000)} 秒`, 1000);
    $("#orgOut").innerHTML = `<p class="muted">正在读取文档并请 AI 整理，长文档可能需要 1–3 分钟。</p>`;
    try { renderOrganized(await api("/api/ai/organize", {method:"POST", body:fd})); }
    catch(err){ $("#orgOut").innerHTML = `<p style="color:#b33">${esc(err.message)}</p>`; }
    clearInterval(tick); btn.disabled = false; btn.textContent = "开始整理";
  };
}
function renderOrganized(r){
  const items = r.items.map((it, i) => {
    const probe = { ...it, id: "probe" + i, type: TYPES[it.type] ? it.type : "dish" };
    const dup = it.existing && byName(it.existing) || db.items.map(x => ({ x, s: similarity(probe, x) })).filter(o => o.s.score >= 0.8).sort((a,b) => b.s.score - a.s.score)[0]?.x;
    return { ...it, type: probe.type, ref: it.ref || "r" + (i+1), dup, pick: !dup };
  });
  const out = $("#orgOut");
  const draw = () => {
    out.innerHTML = `<div class="org-sum">来源：${esc(r.source)} · ${r.chars} 字${r.truncated?"（已截断）":""}${r.images?` · 图片/原件 ${r.imagesUsed}/${r.images} 份已读取`:""} · ${esc(r.provider)} ${esc(r.model)} · ${Math.round(r.ms/1000)} 秒</div>
      ${r.images && !r.imagesUsed ? `<p class="muted" style="font-size:13px">当前使用的 AI 不能读取图片，文档中的图片与截图内容未被整理；如需要，请切换到 Claude 再整理。</p>` : ""}
      ${r.notes?`<div class="story-box" style="margin:10px 0">${esc(r.notes)}</div>`:""}
      <div class="org-bar"><label class="chk"><input type="checkbox" id="orgAll" ${items.every(i=>i.pick)?"checked":""}> 全选</label>
        <span class="muted">${items.length} 件 · ${r.relations.length} 条关系</span><button class="primary sm" id="orgImport">导入选中 ${items.filter(i=>i.pick).length} 件</button></div>
      ${items.map((it, i) => `<div class="org-item${it.pick?"":" off"}" data-i="${i}" style="${tc(it.type)}">
        <input type="checkbox" data-f="pick" ${it.pick?"checked":""}>
        <div class="org-main">
          <div class="org-line"><select data-f="type">${Object.entries(TYPES).map(([k,v]) => `<option value="${k}" ${k===it.type?"selected":""}>${v.zh}</option>`).join("")}</select>
            <input data-f="name" value="${esc(it.name)}"><input data-f="alt" value="${esc(it.alt||"")}" placeholder="原名"></div>
          <div class="muted org-meta">${esc(it.region||"")}${it.country?` · ${countryName(String(it.country).toUpperCase())||it.country}`:""}${(it.tags||[]).length?` · #${(it.tags||[]).map(esc).join(" #")}`:""}</div>
          <div class="org-sumtext">${esc(it.summary||"")}</div>
          ${it.dup?`<div class="org-dup">⚠ 可能与已有藏品重复：<a href="#/item/${encodeURIComponent(it.dup.id)}" target="_blank">${esc(it.dup.name)}</a>（默认不导入；导入后可在「疑似重复」中合并）</div>`:""}
          <details><summary class="muted">正文与轶事</summary><div class="prose" style="font-size:14px">${renderBody(it.body||"")}${it.story?`<div class="story-box">${esc(it.story)}</div>`:""}</div></details>
        </div></div>`).join("")}`;
  };
  draw();
  out.oninput = out.onchange = e => {
    if (e.target.id === "orgAll"){ items.forEach(i => i.pick = e.target.checked); draw(); return; }
    const box = e.target.closest(".org-item"); if (!box) return;
    const it = items[+box.dataset.i], f = e.target.dataset.f;
    if (f === "pick"){ it.pick = e.target.checked; draw(); } else if (f) it[f] = e.target.value;
  };
  out.onclick = async e => {
    if (e.target.id !== "orgImport") return;
    const chosen = items.filter(i => i.pick && i.name?.trim());
    if (!chosen.length) return toast("没有选中的条目");
    const stamp = Date.now().toString(36);
    const idOf = Object.fromEntries(chosen.map((it, i) => [it.ref, `ai-${stamp}-${i}`]));
    const resolve = to => idOf[to] || byName(String(to||""))?.id;
    const payload = chosen.map(it => ({ ...it, id: idOf[it.ref], country: String(it.country||"").toUpperCase(),
      source: `AI 整理：${r.source}`, status: "", rating: 0, media: [], journal: [],
      relations: r.relations.filter(x => x.from === it.ref && resolve(x.to)).map(x => ({ to: resolve(x.to), label: x.label || "相关" })) }));
    e.target.disabled = true;
    try {
      const res = await api("/api/import", {method:"POST", body:{ items: payload }});
      await reload(); toast(`已导入 ${res.items} 件，可在「馆藏目录」查看`); go("#/catalog?by=time");
    } catch(err){ fail(err); e.target.disabled = false; }
  };
}

/* ---------- 离线：本地队列（IndexedDB）与同步 ---------- */
const OB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => { const r = indexedDB.open("gastronomique-offline", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("ops", { keyPath: "key", autoIncrement: true }); r.result.createObjectStore("files"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const run = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); };
  return {
    add: op => run("ops", "readwrite", s => s.add(op)), put: op => run("ops", "readwrite", s => s.put(op)),
    all: () => run("ops", "readonly", s => s.getAll()), del: k => run("ops", "readwrite", s => s.delete(k)),
    putFile: (k, b) => run("files", "readwrite", s => s.put(b, k)), getFile: k => run("files", "readonly", s => s.get(k)),
    delFile: k => run("files", "readwrite", s => s.delete(k)),
  };
})();
const localUrls = new Map();     // 离线时添加的照片：本地 blob 预览地址
let pendingOps = [], syncing = false;
const isOffline = e => e && e.offline;
async function queueOp(op){ await OB.add({ ...op, at: Date.now() }); await refreshPending(); }
async function refreshPending(){
  try { pendingOps = await OB.all(); } catch { pendingOps = []; }
  for (const op of pendingOps) for (const m of op.body?.media || []) if (m.local && !localUrls.has(m.id)) {
    const b = await OB.getFile(m.id).catch(() => null); if (b) localUrls.set(m.id, URL.createObjectURL(b)); }
  updateNetPill();
}
// 把尚未同步的改动叠加到本地数据上，离线时也能看到自己刚录的内容
function applyPending(){
  for (const op of pendingOps) {
    const it = byId(op.id);
    if (op.type === "create" && !byId(op.tmpId)) db.items.unshift({ ...op.body, id: op.tmpId, created: new Date(op.at).toISOString(), updated: new Date(op.at).toISOString(), journal: [], _pending: true });
    if (op.type === "update" && it) Object.assign(it, op.body, { _pending: true });
    if (op.type === "patch" && it) Object.assign(it, op.body, { _pending: true });
    if (op.type === "journal" && it) { it.journal = [...(it.journal||[]).filter(j => j.id !== op.body.id), { ...op.body, id: op.body.id || "tmp-j" + op.key }]; it._pending = true; }
  }
}
function updateNetPill(){
  let p = $("#netPill");
  if (!p){ p = document.createElement("button"); p.id = "netPill"; p.className = "net-pill"; p.onclick = () => navigator.onLine ? syncOutbox(true) : toast("当前离线，联网后会自动同步");
    $(".top-actions").prepend(p); }
  const n = pendingOps.length, err = pendingOps.some(o => o.error);
  p.hidden = navigator.onLine && !n;
  p.className = "net-pill" + (!navigator.onLine ? " off" : err ? " err" : "");
  p.textContent = !navigator.onLine ? (n ? `离线 · 待同步 ${n}` : "离线") : syncing ? "同步中…" : `${err ? "⚠ " : ""}待同步 ${n}`;
  p.title = err ? pendingOps.find(o => o.error).error : "";
}
// 把藏品里暂存在本机的照片上传到服务器，并替换为正式的媒体记录（联网保存与离线同步共用）
async function uploadLocalMedia(body){
  if (!body?.media) return body;
  const out = [];
  for (const m of body.media) {
    if (!m.local) { out.push(m); continue; }
    const blob = await OB.getFile(m.id); if (!blob) continue;
    const fd = new FormData(); fd.append("file", new File([blob], m.name || "photo", { type: blob.type }));
    const up = await api("/api/media", { method: "POST", body: fd });
    if (body.body) body.body = body.body.replaceAll(`![[m:${m.id}]]`, `![[m:${up.id}]]`);
    out.push({ ...up, caption: m.caption || "" });
    await OB.delFile(m.id); localUrls.delete(m.id);
  }
  body.media = out;
  return body;
}
async function syncOutbox(manual){
  if (syncing || !navigator.onLine) return;
  await refreshPending(); if (!pendingOps.length) return;
  syncing = true; updateNetPill();
  const idMap = {};
  let done = 0, stopped = "";
  for (const op of pendingOps) {
    try {
      const realId = id => idMap[id] || id;
      const body = op.body ? structuredClone(op.body) : undefined;
      if (body) await uploadLocalMedia(body);
      if (body?.relations) body.relations = body.relations.map(r => ({ ...r, to: realId(r.to) })).filter(r => !String(r.to).startsWith("tmp-"));
      if (op.type === "create"){ const s = await api("/api/items", { method: "POST", body }); idMap[op.tmpId] = s.id; }
      if (op.type === "update") await api("/api/items/" + encodeURIComponent(realId(op.id)), { method: "PUT", body });
      if (op.type === "patch") await api("/api/items/" + encodeURIComponent(realId(op.id)), { method: "PATCH", body });
      if (op.type === "journal") await api(body.id && !String(body.id).startsWith("tmp-") ? `/api/journal/${body.id}` : `/api/items/${encodeURIComponent(realId(op.id))}/journal`,
        { method: body.id && !String(body.id).startsWith("tmp-") ? "PUT" : "POST", body: { ...body, id: undefined } });
      // 后续操作若引用了刚创建的临时 id，换成真实 id
      for (const later of pendingOps) if (later !== op && later.id && idMap[later.id]) later.id = idMap[later.id];
      await OB.del(op.key); done++;
    } catch(e){
      if (isOffline(e)) { stopped = "离线"; break; }
      op.error = e.message; await OB.put(op); stopped = e.message; break;
    }
  }
  syncing = false;
  await refreshPending();
  if (done){ await reload(); applyPending(); route(); }
  if (done || manual) toast(stopped ? `已同步 ${done} 项；未完成：${stopped}` : `已同步 ${done} 项离线改动`);
  const cur = G.current; if (cur?.r === "item" && idMap[cur.id]) go("#/item/" + encodeURIComponent(idMap[cur.id]));
}
window.addEventListener("online", () => { updateNetPill(); syncOutbox(); });
window.addEventListener("offline", updateNetPill);

/* ---------- 版本更新提示 ---------- */
let swReg = null, appVer = "";
function showUpdate(){
  if ($("#updBar")) return;
  const b = document.createElement("div"); b.id = "updBar"; b.className = "upd-bar";
  b.innerHTML = `<span>✦ 有新版本可用</span><button class="primary sm">刷新</button><button class="ghost sm" aria-label="稍后">×</button>`;
  b.querySelector(".primary").onclick = () => {
    if (pendingOps.length && !navigator.onLine && !confirm("还有离线改动未同步（不会丢失，刷新后继续保留）。现在刷新？")) return;
    if (swReg?.waiting) swReg.waiting.postMessage("SKIP_WAITING"); else location.reload();
  };
  b.querySelector(".ghost").onclick = () => b.remove();
  document.body.appendChild(b);
}
async function initUpdates(){
  try { appVer = (await fetch("/api/version", { cache: "no-store" }).then(r => r.json())).version || ""; } catch {}
  if ("serviceWorker" in navigator && window.isSecureContext){
    try {
      swReg = await navigator.serviceWorker.register("/sw.js");
      if (swReg.waiting && navigator.serviceWorker.controller) showUpdate();
      swReg.addEventListener("updatefound", () => { const w = swReg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) showUpdate(); }); });
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading){ reloading = true; location.reload(); } });
      const check = () => swReg.update().catch(() => {});
      setInterval(check, 30 * 60e3); document.addEventListener("visibilitychange", () => !document.hidden && check());
      return;
    } catch {}
  }
  // 不支持 Service Worker（如局域网 http 访问）：定期比对版本号
  const check = async () => { try { const v = (await fetch("/api/version", { cache: "no-store" }).then(r => r.json())).version; if (v && appVer && v !== appVer) showUpdate(); } catch {} };
  setInterval(check, 10 * 60e3); document.addEventListener("visibilitychange", () => !document.hidden && check());
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
    ${isAdmin()?`<button data-a="invite">✉ 邀请朋友</button><button data-a="ai">✦ AI 设置</button><button data-a="dupes">⧉ 疑似重复</button><button data-a="export">⇩ 导出 JSON</button><button data-a="import">⇧ 导入 JSON / 旧版备份</button>`:""}
    <button data-a="theme">◐ 切换明暗</button><button data-a="logout">⎋ 退出登录</button>
    <div class="muted" style="font-size:11px;padding:6px 14px 2px">版本 ${esc(appVer || "—")}${"serviceWorker" in navigator && window.isSecureContext ? " · 支持离线" : " · 离线需 HTTPS"}</div>`;
  document.body.appendChild(m);
  m.onclick = e => {
    const a = e.target.dataset.a; if (!a) return; m.remove();
    if (a==="export") location.href = "/api/export";
    if (a==="import") $("#importFile").click();
    if (a==="invite") inviteView();
    if (a==="dupes") go("#/dupes");
    if (a==="ai") aiSettingsOpen();
    if (a==="theme"){ const dark = matchMedia("(prefers-color-scheme: dark)").matches; const cur = cfg.theme || (dark?"dark":"light"); cfg.theme = cur==="dark"?"light":"dark"; document.documentElement.dataset.theme=cfg.theme; saveCfg(); route(); }
    if (a==="logout"){
      if (pendingOps.length && !confirm(`还有 ${pendingOps.length} 项离线改动未同步，退出后仍会保留在本机。继续退出？`)) return;
      navigator.serviceWorker?.controller?.postMessage("CLEAR_PRIVATE");
      api("/api/logout", {method:"POST"}).finally(() => location.reload());
    }
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
let updatesInit = false;
async function boot(){
  if (!updatesInit){ updatesInit = true; initUpdates(); }
  try {
    const r = await api("/api/me"); me = r.user; aiOn = r.ai;
    if (!me) return loginView();
    document.body.classList.remove("locked");
    document.body.classList.toggle("ro", !isAdmin());
    document.querySelectorAll('[data-r="ai"]').forEach(a => a.hidden = !isAdmin());
    await refreshPending();
    if (navigator.onLine && pendingOps.length) await syncOutbox();
    await reload(); applyPending(); route();
  } catch(e){ app.innerHTML = e.offline
      ? `<div class="empty">当前离线，本机还没有缓存的数据。<br><span style="font-size:15px">请先联网打开一次，之后就可以离线浏览和录入。</span></div>`
      : `<div class="empty">无法连接服务器：${esc(e.message)}</div>`; }
}
window.removeEventListener("hashchange", route);
window.addEventListener("hashchange", () => me && route());
boot();
})();

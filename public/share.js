/* Gastronomique · 分享图生成
 * 用 Canvas 按页面类型排版一张图片（非截屏），可下载 / 复制 / 调用系统分享。 */
(() => {
const $ = (s, r=document) => r.querySelector(s);
const SIZES = {
  "3:4":  { w:1080, h:1440, label:"3:4 · 小红书 / Instagram" },
  "1:1":  { w:1080, h:1080, label:"1:1 · 朋友圈 / 微博" },
  "9:16": { w:1080, h:1920, label:"9:16 · 快拍 / Story" },
};
const THEMES = {
  paper: { bg:"#f5efe4", card:"#fbf7ef", ink:"#2a2420", muted:"#7a6f63", line:"#e2d7c5", accent:"#9b3d24", gold:"#b08a3e", label:"米纸" },
  night: { bg:"#171412", card:"#211d1a", ink:"#ece4d8", muted:"#a39684", line:"#3a332d", accent:"#e07a55", gold:"#d4ad5f", label:"夜色" },
};
const TYPE_COLOR = { ingredient:"#6b8e4e", dish:"#b5562f", cuisine:"#c9861a", beverage:"#7a4b8c", restaurant:"#2f6f8f", producer:"#8c6d2f", region:"#3e7f6b", culture:"#a0465f", event:"#5a5f9e", story:"#8a5a3c" };
const SERIF = `"Cormorant Garamond","Noto Serif SC",Georgia,serif`, CN = `"Noto Serif SC",serif`, SANS = `Inter,"PingFang SC","Microsoft YaHei",sans-serif`;
const opts = { size:"3:4", theme:"paper", showStory:true, showFlavor:true };
try { Object.assign(opts, JSON.parse(localStorage.getItem("gastronomique.share")) || {}); } catch {}

/* ---------- 绘图工具 ---------- */
let C, T, W, H;
const font = (px, fam=CN, weight=400, italic=false) => C.font = `${italic?"italic ":""}${weight} ${px}px ${fam}`;
// 中英文混排换行：英文按单词，中文按字
function wrap(text, maxW, maxLines=99){
  const tokens = String(text||"").replace(/\s+/g," ").trim().match(/[A-Za-z0-9'’\-.,]+\s?|./gu) || [];
  const lines = []; let cur = "";
  for (const t of tokens){
    if (C.measureText(cur + t).width > maxW && cur){ lines.push(cur.trimEnd()); cur = t.trimStart(); if (lines.length === maxLines) break; }
    else cur += t;
  }
  if (lines.length < maxLines && cur) lines.push(cur.trimEnd());
  if (lines.length === maxLines && tokens.join("").length > lines.join("").length + 1){
    let l = lines[maxLines-1]; while (l && C.measureText(l + "…").width > maxW) l = l.slice(0,-1); lines[maxLines-1] = l + "…";
  }
  return lines;
}
function text(str, x, y, maxW, lh, maxLines){ const ls = wrap(str, maxW, maxLines); ls.forEach((l,i) => C.fillText(l, x, y + i*lh)); return y + ls.length*lh; }
function spaced(str, x, y, sp){ for (const ch of str){ C.fillText(ch, x, y); x += C.measureText(ch).width + sp; } return x; }
const spacedW = (str, sp) => [...str].reduce((w,ch) => w + C.measureText(ch).width + sp, 0) - sp;
function rr(x,y,w,h,r){ C.beginPath(); C.roundRect(x,y,w,h,r); }
const imgCache = new Map();
function loadImg(src){
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgCache.get(src);
}
function drawCover(img, x, y, w, h){
  const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
  C.drawImage(img, (img.width - sw)/2, (img.height - sh)/2, sw, sh, x, y, w, h);
}
// 只用站内图片（外链会污染画布导致无法导出）
const imgOf = (m, big) => !m || m.url ? null : (m.kind==="video" || !big) ? (m.thumb ? G.mediaUrl(m.thumb) : m.kind==="image" ? G.mediaUrl(m.file) : null) : G.mediaUrl(m.file);

function frame(){
  C.fillStyle = T.bg; C.fillRect(0,0,W,H);
  C.strokeStyle = T.line; C.lineWidth = 2; C.strokeRect(36,36,W-72,H-72);
}
function header(sub){
  font(22, SANS, 600); C.fillStyle = T.muted; C.textBaseline = "alphabetic";
  spaced("GASTRONOMIQUE", 84, 108, 6);
  if (sub){ const w = spacedW(sub, 3); spaced(sub, W-84-w, 108, 3); }
}
function footer(){
  C.fillStyle = T.line; C.fillRect(84, H-128, W-168, 2);
  const logo = imgCache.get("icons/logo-192.png")?.ready;   // 预加载的标志
  let x = 84;
  if (logo){ C.save(); rr(84, H-108, 48, 48, 11); C.clip(); C.drawImage(logo, 84, H-108, 48, 48); C.restore(); x += 64; }
  font(30, SERIF, 600, true); C.fillStyle = T.ink; C.fillText("Gastronomique", x, H-76);
  font(20, CN); C.fillStyle = T.muted;
  const s = `私人食物博物馆 · ${new Date().toISOString().slice(0,10)}`; C.fillText(s, W-84-C.measureText(s).width, H-80);
}
function chip(label, color, x, y){
  font(22, CN, 600); const w = C.measureText(label).width + 36;
  rr(x, y-30, w, 42, 21); C.strokeStyle = color; C.lineWidth = 2; C.stroke();
  C.fillStyle = color; C.fillText(label, x+18, y-2); return x + w + 14;
}
function radar(fl, cx, cy, R, labels=true){
  const keys = Object.keys(G.FLAVORS), n = keys.length;
  const pt = (i,v) => { const a = -Math.PI/2 + i*2*Math.PI/n; return [cx + Math.cos(a)*R*v/5, cy + Math.sin(a)*R*v/5]; };
  C.strokeStyle = T.line; C.lineWidth = 1.5;
  for (let l=1; l<=5; l++){ C.beginPath(); keys.forEach((_,i) => C.lineTo(...pt(i,l))); C.closePath(); C.stroke(); }
  C.beginPath(); keys.forEach((k,i) => C.lineTo(...pt(i, +(fl?.[k]||0)))); C.closePath();
  C.fillStyle = T.accent + "40"; C.fill(); C.strokeStyle = T.accent; C.lineWidth = 3; C.stroke();
  if (labels){ font(Math.min(28, Math.max(20, R/7)), CN); C.fillStyle = T.muted; C.textAlign = "center"; C.textBaseline = "middle";
    keys.forEach((k,i) => C.fillText(G.FLAVORS[k], ...pt(i, 6.4))); C.textAlign = "left"; C.textBaseline = "alphabetic"; }
}
const hasFlavor = f => f && Object.values(f).some(v => +v > 0);

/* ---------- 各类分享图 ---------- */
async function drawItem(it){
  frame(); header(G.TYPES[it.type]?.en.toUpperCase());
  const img = await loadImg(imgOf(G.cover(it), true));
  let y = 150;
  if (img){
    const ih = Math.round(H * (H > 1500 ? 0.42 : H > 1200 ? 0.38 : 0.34));
    C.save(); rr(84, y, W-168, ih, 4); C.clip(); drawCover(img, 84, y, W-168, ih); C.restore();
    y += ih + 70;
  } else y += 80;
  let x = chip(G.TYPES[it.type]?.zh || "", TYPE_COLOR[it.type] || T.accent, 84, y);
  if (it.region){ font(24, CN); C.fillStyle = T.muted; C.fillText(it.region, x, y-4); }
  y += 30;
  const nameSize = img ? 76 : 104;
  font(nameSize, CN, 700); C.fillStyle = T.ink; y = text(it.name, 84, y + nameSize, W-168, nameSize*1.15, 2) - nameSize*1.15;   // y = 最后一行基线
  if (it.alt){ font(38, SERIF, 500, true); C.fillStyle = T.muted; y = text(it.alt, 84, y + 58, W-168, 46, 1) - 46; }
  if (it.rating){ font(34, SANS); C.fillStyle = T.gold; C.fillText("★".repeat(it.rating) + "☆".repeat(5-it.rating), 84, y + 52); y += 52; }
  const hl = opts.showHealth !== false && it.health ? [healthLine(it.health, "  ·  "), (it.health.ingredients||[]).slice(0,5).join("、")].filter(Boolean) : [];
  const bottom = H - 170 - hl.length * 46;
  const flavor = opts.showFlavor && hasFlavor(it.flavor);
  const rW = flavor ? 270 : 0;
  font(30, CN); C.fillStyle = T.ink;
  const room = Math.floor((bottom - y - 40) / 48);
  if (it.summary && room > 0) y = text(it.summary, 84, y + 64, W-168-(flavor && !it.story ? rW : 0), 48, Math.min(room, 6));
  const story = opts.showStory && it.story;
  if (story){
    const left = Math.floor((bottom - y - 60) / 44);
    if (left >= 2){
      font(27, CN); const ls = wrap(story, W-168-40-(flavor ? rW : 0), Math.min(left, 7));
      const top = y + 40;
      C.fillStyle = T.gold; C.fillRect(84, top, 5, ls.length*44 + 6);
      C.fillStyle = T.muted; ls.forEach((l,i) => C.fillText(l, 84+30, top + 34 + i*44));
      y = top + ls.length*44 + 10;
    }
  }
  if (hl.length){
    let hy = H - 170 - hl.length * 46 + 20;
    C.fillStyle = T.line; C.fillRect(84, hy - 34, W - 168, 1.5);
    hl.forEach((line, i) => { font(24, CN); C.fillStyle = i ? T.muted : T.ink;
      C.fillText((i ? "配料  " : "健康  ") + wrap(line, W - 168 - 80, 1)[0], 84, hy + 10 + i * 42); });
  }
  if (flavor){ const R = img ? 92 : Math.min(150, Math.max(92, (bottom - y - 120) / 2.6)); radar(it.flavor, W-84-R-40, bottom - R*1.35 - 10, R); }
  footer();
}

async function drawList(title, sub, items){
  frame(); header(sub);
  font(72, CN, 700); C.fillStyle = T.ink; let y = text(title, 84, 230, W-168, 84, 2);
  font(26, CN); C.fillStyle = T.muted; C.fillText(`${items.length} 件藏品`, 84, y + 10);
  y += 60;
  const cols = H > 1500 ? 2 : 3, rowsAvail = H - 170 - y;
  const gap = 24, cw = (W - 168 - gap*(cols-1)) / cols;
  const ideal = cols === 2 ? cw * 0.95 : cw * 1.15;
  // 行数按理想高度四舍五入，再把卡片高度调整到正好填满版面
  const rows = Math.max(1, Math.min(Math.ceil(items.length / cols), Math.round((rowsAvail - 30 + gap) / (ideal + gap))));
  const tileH = Math.min(ideal * 1.25, (rowsAvail - 30 + gap) / rows - gap);
  const shown = items.slice(0, rows * cols);
  const imgs = await Promise.all(shown.map(it => loadImg(imgOf(G.cover(it)))));
  shown.forEach((it, i) => {
    const x = 84 + (i % cols) * (cw + gap), ty = y + Math.floor(i / cols) * (tileH + gap);
    const ih = tileH - (cols === 2 ? 156 : 140);   // 底部固定留给文字
    C.fillStyle = T.card; rr(x, ty, cw, tileH, 6); C.fill(); C.strokeStyle = T.line; C.lineWidth = 1.5; C.stroke();
    C.save(); rr(x, ty, cw, ih, 6); C.clip();
    if (imgs[i]) drawCover(imgs[i], x, ty, cw, ih);
    else { const c = TYPE_COLOR[it.type] || T.accent; C.fillStyle = c + "22"; C.fillRect(x, ty, cw, ih);
      font(ih*0.5, CN, 700); C.fillStyle = c + "88"; C.textAlign = "center"; C.textBaseline = "middle"; C.fillText([...it.name][0], x+cw/2, ty+ih/2+4); C.textAlign = "left"; C.textBaseline = "alphabetic"; }
    C.restore();
    C.fillStyle = TYPE_COLOR[it.type] || T.accent; C.beginPath(); C.arc(x+24, ty+ih+38, 7, 0, 7); C.fill();
    font(20, CN); C.fillStyle = T.muted; C.fillText(G.TYPES[it.type]?.zh + (it.region ? " · " + it.region.split("·")[0].trim() : ""), x+40, ty+ih+45);
    font(cols===2 ? 36 : 30, CN, 700); C.fillStyle = T.ink; text(it.name, x+20, ty+ih+(cols===2?94:88), cw-40, 40, 1);
    if (it.alt){ font(cols===2 ? 26 : 22, SERIF, 500, true); C.fillStyle = T.muted; text(it.alt, x+20, ty+ih+(cols===2?132:120), cw-40, 30, 1); }
  });
  if (items.length > shown.length){ font(24, CN); C.fillStyle = T.muted; const s = `…以及另外 ${items.length - shown.length} 件`; C.fillText(s, W-84-C.measureText(s).width, H-150); }
  footer();
}

async function drawStories(list){
  frame(); header("STORIES");
  font(72, CN, 700); C.fillStyle = T.ink; C.fillText("奇闻轶事", 84, 230);
  let y = 300; const bottom = H - 180;
  for (const it of list){
    const body = it.type === "story" ? it.summary : it.story;
    font(40, CN, 700); const head = wrap(it.name, W-168, 1);
    font(28, CN); const ls = wrap(body, W-168-30, 5);
    const need = 60 + ls.length * 44 + 40;
    if (y + need > bottom) break;
    font(40, CN, 700); C.fillStyle = T.ink; C.fillText(head[0], 84, y + 44);
    font(22, CN); C.fillStyle = TYPE_COLOR[it.type]; const r = it.region || ""; C.fillText(r, W-84-C.measureText(r).width, y + 40);
    C.fillStyle = T.gold; C.fillRect(84, y + 70, 5, ls.length*44);
    font(28, CN); C.fillStyle = T.muted; ls.forEach((l,i) => C.fillText(l, 84+30, y + 100 + i*44));
    y += need + 20;
  }
  footer();
}

async function drawTaste(){
  const p = G.profile();
  frame(); header("TASTE PROFILE");
  font(72, CN, 700); C.fillStyle = T.ink; C.fillText("我的品味档案", 84, 230);
  font(26, CN); C.fillStyle = T.muted; C.fillText(`基于 ${p.tried.length} 件已品尝的藏品`, 84, 280);
  const R = Math.max(130, Math.min(280, (H - 860) / 2.6)), cy = 330 + R * 1.3;
  radar(p.fl, W/2, cy, R);
  const fk = Object.entries(p.fl).sort((a,b) => b[1]-a[1]);
  let y = cy + R * 1.3 + 50;
  if (fk[0]?.[1]){
    font(34, CN); C.fillStyle = T.ink; C.textAlign = "center";
    C.fillText(`偏爱「${G.FLAVORS[fk[0][0]]}」与「${G.FLAVORS[fk[1][0]]}」`, W/2, y); C.textAlign = "left"; y += 80;
  }
  const colW = (W - 168 - 40) / 2;
  const bars = (title, arr, x) => {
    let yy = y; font(22, SANS, 600); C.fillStyle = T.muted; spaced(title, x, yy, 4); yy += 44;
    const mx = arr[0]?.[1] || 1;
    const step = Math.min(64, Math.max(46, (H - 200 - yy) / 6));
    for (const [k,v] of arr.slice(0, 6)){
      if (yy > H - 190) break;
      font(28, CN); C.fillStyle = T.ink; text(k, x, yy, 170, 30, 1);
      C.fillStyle = T.accent; rr(x+185, yy-16, (colW-195) * v/mx, 14, 7); C.fill(); yy += step;
    }
  };
  bars("心之所向 · 地区", p.regions, 84);
  bars("最爱的藏品", p.top.slice(0,5).map(i => [i.name, i.rating || 1]), 84 + colW + 40);
  footer();
}

async function drawGraph(){
  frame(); header("KNOWLEDGE GRAPH");
  font(72, CN, 700); C.fillStyle = T.ink; C.fillText("我的食物知识网络", 84, 230);
  font(26, CN); C.fillStyle = T.muted; C.fillText(`${G.items.length} 件藏品 · ${G.edges().length} 条连接`, 84, 280);
  const src = $("#cv");
  if (src){
    const top = 320, bh = H - 170 - top - 20, bw = W - 168;
    C.fillStyle = T.card; rr(84, top, bw, bh, 6); C.fill();
    const s = Math.min(bw / src.width, bh / src.height);
    const dw = src.width * s, dh = src.height * s;
    C.drawImage(src, 84 + (bw-dw)/2, top + (bh-dh)/2, dw, dh);
  }
  footer();
}

async function drawCompare(items){
  frame(); header("TASTING COMPARISON");
  font(64, CN, 700); C.fillStyle = T.ink; C.fillText("对比品鉴", 84, 220);
  font(26, CN); C.fillStyle = T.muted; text(items.map(i => i.name).join(" · "), 84, 268, W-168, 34, 2);
  const colors = G.CMP_COLORS;
  // 叠加风味图
  const R = Math.min(230, (H - 900) / 2.3 + 120), cy = 330 + R * 1.3;
  const keys = Object.keys(G.FLAVORS), n = keys.length;
  const pt = (i,v) => { const a = -Math.PI/2 + i*2*Math.PI/n; return [W/2 + Math.cos(a)*R*v/5, cy + Math.sin(a)*R*v/5]; };
  C.strokeStyle = T.line; C.lineWidth = 1.5;
  for (let l=1; l<=5; l++){ C.beginPath(); keys.forEach((_,i) => C.lineTo(...pt(i,l))); C.closePath(); C.stroke(); }
  items.forEach((it, k) => { if (!hasFlavor(it.flavor)) return;
    C.beginPath(); keys.forEach((f,i) => C.lineTo(...pt(i, +(it.flavor[f]||0)))); C.closePath();
    C.fillStyle = colors[k] + "22"; C.fill(); C.strokeStyle = colors[k]; C.lineWidth = 4; C.stroke(); });
  font(24, CN); C.fillStyle = T.muted; C.textAlign = "center"; C.textBaseline = "middle";
  keys.forEach((k,i) => C.fillText(G.FLAVORS[k], ...pt(i, 6.3))); C.textAlign = "left"; C.textBaseline = "alphabetic";
  // 每件一行：色块、名称、评分、价格、突出风味
  let y = cy + R * 1.3 + 50;
  const rowH = Math.min(96, (H - 180 - y) / items.length);
  items.forEach((it, k) => {
    if (y + rowH > H - 160) return;
    C.fillStyle = colors[k]; rr(84, y, 10, rowH - 18, 5); C.fill();
    font(32, CN, 700); C.fillStyle = T.ink; C.fillText(wrap(it.name, 440, 1)[0], 114, y + 32);
    const p = G.priceSummary(it), meta = [it.rating ? "★".repeat(it.rating) : "", topFlavors(it.flavor).join(" / ")].filter(Boolean).join("   ");
    font(22, CN); C.fillStyle = T.muted; C.fillText(wrap(meta || G.TYPES[it.type].zh, 520, 1)[0], 114, y + 66);
    if (p){ const s1 = G.fmtPrice(p.latest.price, p.latest.currency) + (p.latest.amount ? " / " + p.latest.amount : "");
      const s2 = p.per100 ? `≈${G.fmtPrice(p.per100.min, p.per100.cur)}/100${p.per100.unit}` : "";
      font(28, SERIF, 600); C.fillStyle = T.ink; C.fillText(s1, W - 84 - C.measureText(s1).width, y + 32);
      if (s2){ font(22, CN); C.fillStyle = T.muted; C.fillText(s2, W - 84 - C.measureText(s2).width, y + 66); } }
    y += rowH;
  });
  footer();
}

/* ---------- 根据当前页面选择版式 ---------- */
function pageItems(){
  return [...document.querySelectorAll("#app [data-go]")].map(el => G.byId(el.dataset.go)).filter((x,i,a) => x && a.indexOf(x) === i);
}
function plan(){
  const { r, id, params } = G.current || {};
  if (r === "item"){ const it = G.byId(id); return it && { kind:"item", name: it.name, items:[it], run: () => drawItem(it), item:true }; }
  if (r === "compare"){ const list = G.cmpList().map(G.byId); return list.length >= 2 && { kind:"compare", name:"对比品鉴", items:list, run: () => drawCompare(list) }; }
  if (r === "taste") return { kind:"taste", name: "品味档案", items: G.profile().top, run: drawTaste };
  if (r === "graph") return { kind:"graph", name: "知识网络", items: G.items, run: drawGraph };
  if (r === "stories"){ const list = G.items.filter(i => i.type==="story" || i.story); return { kind:"stories", name: "奇闻轶事", items: list, run: () => drawStories(list) }; }
  if (r === "atlas"){ const tab = params?.get("tab") || "tried"; const label = {tried:"我品尝过的", want:"我想尝的", journal:"最近的品尝日志"}[tab];
    const list = tab === "journal" ? pageItems() : G.items.filter(i => i.status === tab).sort((a,b) => (b.rating||0)-(a.rating||0));
    return { kind: tab === "journal" ? "journal" : "list", name: label, items: list, run: () => drawList(label, "MY ATLAS", list) }; }
  if (r === "discover"){ const list = pageItems(); const t = $("#ft button.on")?.dataset.t; const title = t ? `${G.TYPES[t].zh}图鉴` : "食物图鉴";
    return { kind:"list", name: title, items: list, run: () => drawList(title, "DISCOVER", list) }; }
  const list = pageItems().length ? pageItems() : G.items;
  return { kind:"list", name: "我的食物博物馆", items: list, run: () => drawList("我的食物博物馆", "COLLECTION", list) };
}

/* ---------- 可编辑文案：按平台生成，可在框内修改后复制 / 下载 ---------- */
const PLATFORMS = {
  xhs:   { label:"小红书", ext:"txt" },
  weibo: { label:"微博 / 朋友圈", ext:"txt" },
  md:    { label:"Markdown 长文", ext:"md" },
  plain: { label:"纯文本", ext:"txt" },
};
const TYPE_EMOJI = { ingredient:"🧂", dish:"🍲", cuisine:"🥢", beverage:"🍷", restaurant:"🍽", producer:"👨‍🌾", region:"🗺", culture:"📜", event:"🎪", story:"📖" };
const cleanBody = t => String(t||"").split("\n").filter(l => !/^\s*!\[/.test(l)).join("\n").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
const firstClause = t => { const c = String(t||"").split(/[，。；！？,.;!?]/)[0].trim(); return c.length <= 20 ? c : c.slice(0, 19) + "…"; };
const stars = n => n ? "★".repeat(n) + "☆".repeat(5-n) : "";
const topFlavors = f => Object.entries(f||{}).filter(([,v]) => v >= 3).sort((a,b) => b[1]-a[1]).slice(0,3).map(([k]) => G.FLAVORS[k]);
function healthLine(h, sep=" · "){
  if (!h) return "";
  const parts = [];
  if (h.kcal) parts.push(`约 ${h.kcal} kcal${h.portion ? " / " + h.portion : ""}`);
  for (const k of Object.keys(G.LEVELS)) if (h.levels?.[k]) parts.push(`${G.LEVELS[k]}${G.LEVEL_TXT[h.levels[k]]}`);
  return parts.join(sep);
}
const hashtags = (items, fmt) => {
  const set = new Set(["美食", "食物志"]);
  for (const it of items.slice(0, 6)){ (it.tags||[]).slice(0,2).forEach(t => set.add(t)); if (it.region) set.add(it.region.split("·")[0].trim()); }
  const arr = [...set].slice(0, 8);
  return fmt === "weibo" ? arr.map(t => `#${t}#`).join(" ") : arr.map(t => `#${t}`).join(" ");
};

function itemText(it, fmt){
  const flav = topFlavors(it.flavor), hl = healthLine(it.health), ing = it.health?.ingredients || [];
  const body = cleanBody(it.body);
  if (fmt === "md"){
    const cov = G.cover(it), blocks = [
      `# ${it.name}${it.alt ? ` · *${it.alt}*` : ""}`,
      `> ${G.TYPES[it.type].zh}${it.region ? " · " + it.region : ""}${it.rating ? " · " + stars(it.rating) : ""}`,
      cov && !cov.url && cov.kind === "image" ? `![${it.name}](images/01.${cov.file.split(".").pop()})` : "",
      it.summary, body,
      it.story ? `## 轶事\n\n${it.story}` : "",
      flav.length ? `## 风味\n\n${flav.join("、")}` : "",
      (hl || ing.length || it.health?.tags?.length) ? `## 健康印象\n\n${[hl, ing.length ? "主要配料：" + ing.join("、") : "", (it.health?.tags||[]).join(" / ")].filter(Boolean).map(x => "- " + x).join("\n")}` : "",
    ];
    return blocks.filter(Boolean).join("\n\n") + "\n";
  }
  if (fmt === "xhs") return [
    `${TYPE_EMOJI[it.type]||"🍴"} ${it.name}｜${firstClause(it.summary) || G.TYPES[it.type].zh}`, "",
    it.alt ? `🏷 ${it.alt}` : "", it.region ? `📍 ${it.region}` : "", it.rating ? `⭐ ${stars(it.rating)}` : "", "",
    it.summary, body ? "\n" + body : "",
    it.story ? `\n💡 冷知识：${it.story}` : "",
    flav.length ? `\n👅 风味：${flav.join(" / ")}` : "",
    ing.length ? `🥢 配料：${ing.join("、")}` : "",
    hl ? `⚖️ ${hl}` : "",
    "", hashtags([it], fmt),
  ].join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").trim();
  if (fmt === "weibo") return `【${it.name}】${it.summary}${it.story ? " " + it.story : ""}${flav.length ? `（风味：${flav.join("、")}）` : ""} ${hashtags([it], fmt)}`;
  return [it.name + (it.alt ? `（${it.alt}）` : ""), [G.TYPES[it.type].zh, it.region, stars(it.rating)].filter(Boolean).join(" · "), "", it.summary, body ? "\n" + body : "",
    it.story ? `\n轶事：${it.story}` : "", flav.length ? `风味：${flav.join("、")}` : "", ing.length ? `配料：${ing.join("、")}` : "", hl].filter(x => x !== "").join("\n");
}
function listText(title, items, fmt){
  const n = Math.min(items.length, fmt === "weibo" ? 6 : 20);
  if (fmt === "md") return `# ${title}\n\n${items.slice(0, n).map((it,i) => `${i+1}. **${it.name}**${it.alt ? ` *${it.alt}*` : ""} — ${G.TYPES[it.type].zh}${it.region ? " · " + it.region : ""}\n   ${it.summary}`).join("\n")}\n`;
  if (fmt === "xhs") return `📚 ${title}｜${items.length} 件私藏\n\n${items.slice(0, n).map((it,i) => `${TYPE_EMOJI[it.type]||"🍴"} ${i+1}. ${it.name}${it.region ? "（" + it.region.split("·")[0].trim() + "）" : ""}\n${it.summary}`).join("\n\n")}\n\n${hashtags(items, fmt)}`;
  if (fmt === "weibo") return `【${title}】${items.slice(0, n).map(it => it.name).join("、")}${items.length > n ? " 等 " + items.length + " 件" : ""}。${hashtags(items, fmt)}`;
  return `${title}\n\n${items.slice(0, n).map((it,i) => `${i+1}. ${it.name} — ${it.summary}`).join("\n")}`;
}
function storiesText(items, fmt){
  const body = items.slice(0, 10).map(it => ({ t: it.name, s: it.type === "story" ? it.summary : it.story }));
  if (fmt === "md") return `# 奇闻轶事\n\n${body.map(b => `## ${b.t}\n\n${b.s}`).join("\n\n")}\n`;
  if (fmt === "xhs") return `📖 那些关于食物的奇闻轶事\n\n${body.map(b => `🔸 ${b.t}\n${b.s}`).join("\n\n")}\n\n${hashtags(items, fmt)}`;
  if (fmt === "weibo") return `【食物冷知识】${body[0] ? body[0].t + "：" + body[0].s : ""} ${hashtags(items, fmt)}`;
  return body.map(b => `${b.t}\n${b.s}`).join("\n\n");
}
function tasteText(fmt){
  const p = G.profile(), fk = Object.entries(p.fl).sort((a,b) => b[1]-a[1]);
  const fav = fk[0]?.[1] ? `${G.FLAVORS[fk[0][0]]}、${G.FLAVORS[fk[1][0]]}` : "";
  const regions = p.regions.slice(0,5).map(x => x[0]).join("、"), top = p.top.slice(0,5).map(i => i.name).join("、");
  const lv = Object.entries(p.levels||{}).map(([k,v]) => `${G.LEVELS[k]}${G.LEVEL_TXT[Math.round(v)]}`).join("、");
  if (fmt === "md") return `# 我的品味档案\n\n基于 ${p.tried.length} 件已品尝的藏品。\n\n- **偏爱风味**：${fav || "—"}\n- **心之所向**：${regions || "—"}\n- **最爱**：${top || "—"}\n${lv ? `- **饮食倾向**：${lv}\n` : ""}`;
  if (fmt === "xhs") return `👅 我的品味档案\n\n尝过 ${p.tried.length} 件之后，发现自己——\n💛 偏爱：${fav || "还在探索"}\n📍 常去：${regions || "—"}\n🏆 最爱：${top || "—"}${lv ? `\n⚖️ 饮食倾向：${lv}` : ""}\n\n${hashtags(p.tried, fmt)}`;
  if (fmt === "weibo") return `我的品味档案：偏爱${fav || "（探索中）"}，最爱 ${top}。${hashtags(p.tried, fmt)}`;
  return `我的品味档案\n偏爱风味：${fav}\n常去地区：${regions}\n最爱：${top}${lv ? "\n饮食倾向：" + lv : ""}`;
}
function graphText(fmt){
  const E = G.edges(), deg = {};
  E.forEach(e => { deg[e.s] = (deg[e.s]||0)+1; deg[e.t] = (deg[e.t]||0)+1; });
  const hubs = Object.entries(deg).sort((a,b) => b[1]-a[1]).slice(0,5).map(([id,n]) => `${G.byId(id)?.name}（${n}）`);
  const pairs = E.filter(e => !e.soft).slice(0, 8).map(e => `${G.byId(e.s)?.name} —${e.label}→ ${G.byId(e.t)?.name}`);
  if (fmt === "md") return `# 我的食物知识网络\n\n${G.items.length} 件藏品，${E.length} 条连接。\n\n## 连接最多的节点\n\n${hubs.map(h => "- " + h).join("\n")}\n\n## 一些有趣的连接\n\n${pairs.map(p => "- " + p).join("\n")}\n`;
  if (fmt === "xhs") return `🕸 我的食物知识网络\n\n${G.items.length} 件藏品，${E.length} 条连接，慢慢长成了一张网：\n\n${pairs.map(p => "🔗 " + p).join("\n")}\n\n${hashtags(G.items, fmt)}`;
  if (fmt === "weibo") return `我的食物知识网络：${G.items.length} 件藏品、${E.length} 条连接。${pairs[0] || ""} ${hashtags(G.items, fmt)}`;
  return `我的食物知识网络\n${G.items.length} 件藏品，${E.length} 条连接\n\n${pairs.join("\n")}`;
}
function journalText(fmt){
  const entries = G.items.flatMap(i => (i.journal||[]).map(j => ({...j, it:i}))).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (fmt === "md") return `# 最近的品尝日志\n\n${entries.map(e => `### ${e.date} · ${e.it.name}${e.place ? " · " + e.place : ""}\n\n${e.text}`).join("\n\n")}\n`;
  if (fmt === "xhs") return `📝 最近吃到的\n\n${entries.map(e => `🗓 ${e.date}｜${e.it.name}${e.place ? " @" + e.place : ""}\n${e.text}`).join("\n\n")}\n\n${hashtags(entries.map(e => e.it), fmt)}`;
  if (fmt === "weibo") return entries[0] ? `${entries[0].date} 吃到了【${entries[0].it.name}】：${entries[0].text} ${hashtags([entries[0].it], fmt)}` : "";
  return entries.map(e => `${e.date} ${e.it.name}\n${e.text}`).join("\n\n");
}
function compareText(items, fmt){
  const price = it => { const p = G.priceSummary(it); return p ? G.fmtPrice(p.latest.price, p.latest.currency) + (p.latest.amount ? "/" + p.latest.amount : "") + (p.per100 ? `（≈${G.fmtPrice(p.per100.min, p.per100.cur)}/100${p.per100.unit}）` : "") : "—"; };
  const rows = [["类别", it => G.TYPES[it.type].zh], ["地区", it => it.region || "—"], ["评分", it => stars(it.rating) || "—"],
    ["突出风味", it => topFlavors(it.flavor).join("、") || "—"], ["价格", price], ["主要配料", it => (it.health?.ingredients||[]).join("、") || "—"]];
  if (fmt === "md") return `# 对比品鉴\n\n| | ${items.map(i => i.name).join(" | ")} |\n|---|${items.map(() => "---").join("|")}|\n${rows.map(([k,f]) => `| ${k} | ${items.map(f).join(" | ")} |`).join("\n")}\n`;
  if (fmt === "weibo") return `【对比品鉴】${items.map(i => `${i.name}${i.rating ? " " + "★".repeat(i.rating) : ""}`).join(" vs ")} ${hashtags(items, fmt)}`;
  const head = fmt === "xhs" ? `⚖️ 对比品鉴｜${items.map(i => i.name).join(" vs ")}\n` : `对比品鉴：${items.map(i => i.name).join(" vs ")}\n`;
  return head + "\n" + items.map((it, i) => `${fmt === "xhs" ? ["🔴","🔵","🟢","🟡","🟣","🟤"][i] + " " : `${i+1}. `}${it.name}${it.alt ? `（${it.alt}）` : ""}\n${rows.slice(1).map(([k,f]) => `${k}：${f(it)}`).join("\n")}`).join("\n\n") + (fmt === "xhs" ? `\n\n${hashtags(items, fmt)}` : "");
}
function makeText(fmt){
  const c = current;
  if (c.kind === "compare") return compareText(c.items, fmt);
  if (c.kind === "item") return itemText(c.items[0], fmt);
  if (c.kind === "taste") return tasteText(fmt);
  if (c.kind === "graph") return graphText(fmt);
  if (c.kind === "stories") return storiesText(c.items, fmt);
  if (c.kind === "journal") return journalText(fmt);
  return listText(c.name, c.items, fmt);
}

/* ---------- 极简 ZIP（仅存储不压缩，图片本身已压缩） ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n=0; n<256; n++){ let c=n; for (let k=0; k<8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i=0; i<u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), time = (d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1), date = ((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for (const f of files){
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    [[0,0x04034b50,4],[4,20,2],[6,0x0800,2],[8,0,2],[10,time,2],[12,date,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2],[28,0,2]]
      .forEach(([o,v,s]) => s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    [[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x0800,2],[10,0,2],[12,time,2],[14,date,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[30,0,2],[32,0,2],[34,0,2],[36,0,2],[38,0,4],[42,off,4]]
      .forEach(([o,v,s]) => s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s,a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  [[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,cdSize,4],[16,off,4]].forEach(([o,v,s]) => s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type:"application/zip" });
}
async function bundle(text, fmt){
  const enc = new TextEncoder(), files = [];
  files.push({ name:`文案-${PLATFORMS[fmt].label.replace(/[\s/]+/g,"")}.${PLATFORMS[fmt].ext}`, data: enc.encode(text) });
  if (fmt !== "md") files.push({ name:"文章.md", data: enc.encode(makeText("md")) });
  files.push({ name:`分享图-${opts.size.replace(":","x")}.png`, data: new Uint8Array(await (await toBlob()).arrayBuffer()) });
  // 原图：单件藏品取全部图片，列表取每件的封面（最多 20 张）
  const media = current.kind === "item" ? (current.items[0].media||[]) : current.items.slice(0, 20).map(G.cover).filter(Boolean);
  let n = 0;
  for (const m of media){
    if (m.url || m.kind !== "image") continue;
    const r = await fetch(G.mediaUrl(m.file)); if (!r.ok) continue;
    const owner = current.kind === "item" ? "" : "-" + (current.items.find(i => G.cover(i) === m)?.name || "");
    files.push({ name:`images/${String(++n).padStart(2,"0")}${owner}.${m.file.split(".").pop()}`, data: new Uint8Array(await r.arrayBuffer()) });
  }
  return zip(files);
}
const save = (blob, name) => { const u = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href:u, download:name }).click(); setTimeout(() => URL.revokeObjectURL(u), 3000); };

/* ---------- 预览弹窗 ---------- */
let canvas, current;
async function render(){
  const sz = SIZES[opts.size]; T = THEMES[opts.theme]; W = sz.w; H = sz.h;
  canvas.width = W; canvas.height = H; C = canvas.getContext("2d");
  await document.fonts.ready;
  await Promise.all([`700 40px "Noto Serif SC"`, `400 30px "Noto Serif SC"`, `italic 500 30px "Cormorant Garamond"`, `600 30px "Cormorant Garamond"`].map(f => document.fonts.load(f, "博物馆Aa").catch(()=>{})));
  const lp = loadImg("icons/logo-192.png"); lp.ready = await lp;   // 页脚标志，需先加载完成
  await current.run();
}
const baseName = () => `gastronomique-${current.name.replace(/[\\/:*?"<>|\s]+/g, "-")}`;
const fileName = () => `${baseName()}-${opts.size.replace(":","x")}.png`;
const toBlob = () => new Promise(r => canvas.toBlob(r, "image/png"));

async function open(){
  current = plan(); if (!current) return;
  const seg = (key, map) => `<div class="seg">${Object.entries(map).map(([k,v]) => `<button type="button" class="sm ${opts[key]===k?"on":""}" data-k="${key}" data-v="${k}">${v.label}</button>`).join("")}</div>`;
  opts.platform ||= "xhs";
  $("#modalCard").innerHTML = `<div class="share-head"><h2>分享 · ${esc(current.name)}</h2>
      <div class="seg share-tabs"><button type="button" class="on" data-tab="img">🖼 分享图</button><button type="button" data-tab="txt">✎ 可编辑文案</button></div></div>
    <div class="share-wrap" data-pane="img">
      <div class="share-preview"><canvas id="shareCv"></canvas></div>
      <div class="share-side">
        <div class="eyebrow">尺寸</div>${seg("size", SIZES)}
        <div class="eyebrow">配色</div>${seg("theme", THEMES)}
        ${current.item ? `<div class="eyebrow">内容</div>
          <label class="chk"><input type="checkbox" data-o="showStory" ${opts.showStory?"checked":""}> 显示轶事</label>
          <label class="chk"><input type="checkbox" data-o="showFlavor" ${opts.showFlavor?"checked":""}> 显示风味图</label>
          <label class="chk"><input type="checkbox" data-o="showHealth" ${opts.showHealth!==false?"checked":""}> 显示健康印象</label>` : ""}
        <div class="share-actions">
          <button class="primary" id="shDl">⇩ 下载 PNG</button>
          <button id="shCopy">⧉ 复制图片</button>
          ${navigator.canShare ? `<button id="shShare">⇪ 系统分享</button>` : ""}
        </div>
        <p class="muted" style="font-size:12px">图片只包含本页内容，不含登录信息或链接；外链图片不会被画入。</p>
      </div>
    </div>
    <div class="share-text" data-pane="txt" hidden>
      <div class="eyebrow">平台</div>${seg("platform", PLATFORMS)}
      <textarea id="shText" spellcheck="false"></textarea>
      <div class="muted" style="font-size:12px" id="shCount"></div>
      <div class="share-actions row">
        <button class="primary" id="shTxtCopy">⧉ 复制文案</button>
        <button id="shTxtDl">⇩ 下载文本</button>
        <button id="shZip">⇩ 素材包 .zip</button>
        <button class="ghost" id="shReset">↺ 重新生成</button>
      </div>
      <p class="muted" style="font-size:12px">文案可直接在框内修改。素材包含：文案、Markdown 文章、分享图和原图，方便在剪映、Canva、公众号编辑器里继续加工。</p>
    </div>
    <div class="actions"><span></span><button class="ghost" id="shClose">关闭</button></div>`;
  document.getElementById("modal").hidden = false;
  canvas = $("#shareCv");
  const persist = () => { try { localStorage.setItem("gastronomique.share", JSON.stringify(opts)); } catch {} };
  const rerender = async () => { persist(); $(".share-preview").classList.add("busy"); await render(); $(".share-preview").classList.remove("busy"); };
  const ta = $("#shText");
  let edited = false;
  const fill = () => { ta.value = makeText(opts.platform); edited = false; count(); };
  const count = () => { $("#shCount").textContent = `${[...ta.value].length} 字${opts.platform === "weibo" && [...ta.value].length > 140 ? " · 超过 140 字" : ""}${opts.platform === "xhs" && [...ta.value].length > 1000 ? " · 小红书正文上限约 1000 字" : ""}`; };
  ta.oninput = () => { edited = true; count(); };
  fill();
  $("#modalCard").onclick = async e => {
    const tab = e.target.closest("[data-tab]");
    if (tab){ tab.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x===tab));
      document.querySelectorAll("[data-pane]").forEach(p => p.hidden = p.dataset.pane !== tab.dataset.tab); return; }
    const b = e.target.closest("[data-k]");
    if (!b) return;
    if (b.dataset.k === "platform" && edited && !confirm("切换平台会重新生成文案，覆盖你的修改，继续？")) return;
    opts[b.dataset.k] = b.dataset.v; b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x===b));
    if (b.dataset.k === "platform"){ persist(); fill(); } else rerender();
  };
  $("#modalCard").onchange = e => { const o = e.target.dataset.o; if (o){ opts[o] = e.target.checked; rerender(); } };
  $("#shClose").onclick = () => document.getElementById("modal").hidden = true;
  $("#shDl").onclick = async () => save(await toBlob(), fileName());
  $("#shCopy").onclick = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob() })]); toast("已复制，可直接粘贴到聊天或社交平台"); }
    catch { toast("当前浏览器不支持复制图片，请下载"); }
  };
  $("#shShare") && ($("#shShare").onclick = async () => {
    const f = new File([await toBlob()], fileName(), { type:"image/png" });
    if (navigator.canShare({ files:[f] })) navigator.share({ files:[f], title: current.name, text: makeText(opts.platform) }).catch(() => {});
    else toast("此设备不支持分享图片，请下载");
  });
  $("#shTxtCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast("文案已复制"); } catch { ta.select(); document.execCommand("copy"); toast("文案已复制"); }
  };
  $("#shTxtDl").onclick = () => save(new Blob([ta.value], { type:"text/plain;charset=utf-8" }), `${baseName()}.${PLATFORMS[opts.platform].ext}`);
  $("#shZip").onclick = async e => { e.target.disabled = true; toast("正在打包素材…");
    try { save(await bundle(ta.value, opts.platform), `${baseName()}-素材包.zip`); } catch(err){ toast("打包失败：" + err.message); }
    e.target.disabled = false; };
  $("#shReset").onclick = () => { if (!edited || confirm("放弃修改并重新生成？")) fill(); };
  await rerender();
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); }

window.Share = { open };
})();

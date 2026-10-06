// 文档解析：Word / PDF / 网页 / 纯文本 → 文字（保留表格结构）＋ 图片
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import sharp from "sharp";

const MAX_TEXT = 80000, MAX_IMAGES = 12;
const fail = (msg, code = 400) => Object.assign(new Error(msg), { statusCode: code });

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);

// HTML → 纯文本：表格转成「单元格 | 单元格」行，段落、标题、列表各占一行
export function htmlToText(html) {
  let h = String(html)
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) =>
    "\u0001" + [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).join(" | ") + "\u0001");
  h = h.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/table|\/section|\/article)\b[^>]*>/gi, "\n")
       .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => "\n" + "#".repeat(+n) + " ");
  // 表格行用 \u0001 标记，最后折叠为单个换行，避免行间出现空行
  return decode(h.replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").replace(/\u0001\s*\u0001/g, "\n").replace(/\u0001/g, "\n")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// 图片统一缩到长边 1568px（Claude 推荐上限），太小的装饰图忽略
async function normImage(buf) {
  const img = sharp(buf, { limitInputPixels: 1e8 });
  const m = await img.metadata();
  if (!m.width || Math.max(m.width, m.height) < 160) return null;
  const out = await img.rotate().resize(1568, 1568, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { kind: "image", mime: "image/jpeg", data: out.toString("base64") };
}

async function fromDocx(buf) {
  const raw = [];
  const { value: html } = await mammoth.convertToHtml({ buffer: buf }, {
    convertImage: mammoth.images.imgElement(async img => { raw.push(await img.read()); return { src: `#img${raw.length}` }; }),
  });
  const marked = html.replace(/<img[^>]*src="#img(\d+)"[^>]*>/g, (_, n) => `[图片${n}]`);
  const images = [];
  for (const [i, b] of raw.entries()) {
    if (images.length >= MAX_IMAGES) break;
    const im = await normImage(b).catch(() => null);
    if (im) images.push({ ...im, label: `图片${i + 1}` });
  }
  return { text: htmlToText(marked), images, imageTotal: raw.length };
}

async function fromPdf(buf) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  // Claude 可直接阅读 PDF 原件（含表格与图片），限 30MB
  const attach = buf.length <= 30 * 1024 * 1024 ? [{ kind: "pdf", data: buf.toString("base64") }] : [];
  return { text: String(text || "").trim(), images: attach, pages: totalPages };
}

async function fromUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw fail("网址需以 http(s):// 开头");
  const res = await fetch(url, { signal: AbortSignal.timeout(20e3), redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (Gastronomique personal food museum)", accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" } });
  if (!res.ok) throw fail(`网页读取失败：HTTP ${res.status}`, 502);
  const len = +res.headers.get("content-length") || 0;
  if (len > 15 * 1024 * 1024) throw fail("网页过大");
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(url)) return fromPdf(buf);
  const html = buf.toString("utf8");
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const main = html.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0] || html;
  return { text: (title ? `# ${title}\n\n` : "") + htmlToText(main), images: [] };
}

export async function extract({ buffer, filename = "", url, text }) {
  let r, source;
  if (buffer) {
    source = filename;
    const ext = filename.toLowerCase().split(".").pop();
    if (ext === "docx") r = await fromDocx(buffer);
    else if (ext === "pdf") r = await fromPdf(buffer);
    else if (["txt", "md", "markdown", "csv"].includes(ext)) r = { text: buffer.toString("utf8"), images: [] };
    else if (["html", "htm"].includes(ext)) r = { text: htmlToText(buffer.toString("utf8")), images: [] };
    else if (ext === "doc") throw fail("暂不支持旧版 .doc，请在 Word 中另存为 .docx");
    else throw fail("支持 .docx / .pdf / .txt / .md / .html");
  } else if (url) { source = url; r = await fromUrl(url.trim()); }
  else if (text?.trim()) { source = "粘贴的文字"; r = { text: text.trim(), images: [] }; }
  else throw fail("请上传文件、填写网址或粘贴文字");
  const truncated = r.text.length > MAX_TEXT;
  if (!r.text && !r.images.length) throw fail("没有读到文字内容（扫描版 PDF 需要 Claude 才能识别）");
  return { source, ...r, text: r.text.slice(0, MAX_TEXT), truncated, chars: r.text.length };
}

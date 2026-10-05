import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { q } from "./db.js";
import { MEDIA_DIR } from "./items.js";

const SIZE = +(process.env.THUMB_SIZE || 640);   // 长边像素
sharp.concurrency(2);                             // 树莓派上限制并发，避免占满 CPU
sharp.cache(false);

const thumbPath = file => file.replace(/^(.*)\/([^/]+)\.[^.]+$/, "$1/thumbs/$2.webp");

// 从视频第 1 秒截取一帧（短于 1 秒则取第一帧）
function ffmpegFrame(src) {
  return new Promise((resolve, reject) => {
    const run = ss => {
      const p = spawn("ffmpeg", ["-v", "error", ...(ss ? ["-ss", ss] : []), "-i", src, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
      const chunks = []; let err = "";
      p.stdout.on("data", c => chunks.push(c));
      p.stderr.on("data", c => err += c);
      p.on("error", reject);
      p.on("close", code => {
        const buf = Buffer.concat(chunks);
        if (code === 0 && buf.length) resolve(buf);
        else if (ss) run(null);
        else reject(new Error(err || "ffmpeg 失败"));
      });
    };
    run("1");
  });
}

// 为一条媒体生成缩略图，返回 { thumb, width, height }
export async function makeThumb({ id, file, kind, mime }) {
  const src = path.join(MEDIA_DIR, file), rel = thumbPath(file), out = path.join(MEDIA_DIR, rel);
  await fs.mkdir(path.dirname(out), { recursive: true });
  try {
    const animated = mime === "image/gif" || mime === "image/webp";
    const input = kind === "video" ? await ffmpegFrame(src) : src;
    const img = sharp(input, { animated: kind !== "video" && animated, limitInputPixels: 2e8 }).rotate();
    const meta = await sharp(input, { animated: false }).metadata();
    // 动图保留动画，但限制尺寸更小以控制体积
    const size = kind !== "video" && animated && (meta.pages || 1) > 1 ? Math.min(SIZE, 400) : SIZE;
    await img.resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 }).toFile(out);
    const portrait = meta.orientation >= 5;
    const width = portrait ? meta.height : meta.width, height = portrait ? meta.width : (meta.pageHeight || meta.height);
    await q("UPDATE media SET thumb=$2, width=$3, height=$4, thumb_failed=false WHERE id=$1", [id, rel, width, height]);
    return { thumb: rel, width, height };
  } catch (e) {
    await q("UPDATE media SET thumb_failed=true WHERE id=$1", [id]);
    throw e;
  }
}

// 启动时为旧媒体补生成缩略图（后台逐个处理）
export async function backfillThumbs(log) {
  const { rows } = await q("SELECT id,file,kind,mime FROM media WHERE file IS NOT NULL AND thumb IS NULL AND NOT thumb_failed ORDER BY created_at");
  if (!rows.length) return;
  log.info(`补生成缩略图：${rows.length} 个`);
  for (const m of rows) await makeThumb(m).catch(e => log.warn(`缩略图失败 ${m.id}: ${e.message}`));
}

#!/usr/bin/env bash
# 导出全部数据为一个迁移包（数据库 + 图片视频），用于搬到另一台机器（如树莓派）。
# 用法：在项目根目录运行  ./scripts/migrate-export.sh
# 产物：backups/gastronomique-migrate-YYYYMMDD-HHMM.tar
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1            # Windows Git Bash 下避免路径被改写
set -a; source .env; set +a
DATA="${DATA_DIR:-./data}"
STAMP=$(date +%Y%m%d-%H%M)
WORK=$(mktemp -d)
OUT="backups/gastronomique-migrate-$STAMP.tar"
mkdir -p backups

echo "→ 导出数据库…"
docker compose exec -T db pg_dump -U gastro -d gastronomique -Fc > "$WORK/db.dump"
[ -s "$WORK/db.dump" ] || { echo "数据库导出失败"; exit 1; }

echo "→ 打包图片视频…"
mkdir -p "$WORK/media"
[ -d "$DATA/media" ] && cp -R "$DATA/media/." "$WORK/media/"

ITEMS=$(docker compose exec -T db psql -U gastro -d gastronomique -tAc "select count(*) from items")
FILES=$(find "$WORK/media" -type f | wc -l | tr -d ' ')
printf 'exported_at=%s\nitems=%s\nmedia_files=%s\n' "$(date -Iseconds)" "$ITEMS" "$FILES" > "$WORK/manifest.txt"

tar -cf "$OUT" -C "$WORK" .
rm -rf "$WORK"
echo "✓ 完成：$OUT（藏品 $ITEMS 件，媒体文件 $FILES 个，$(du -h "$OUT" | cut -f1)）"
echo "  把这个文件和 .env 一起复制到新机器，然后运行 ./scripts/migrate-import.sh $OUT"

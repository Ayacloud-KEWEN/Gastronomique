#!/usr/bin/env bash
# 每日备份：数据库导出 + 媒体目录增量同步。建议加入 crontab：
#   0 3 * * * cd /home/pi/gastronomique && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
# .env 若在 Windows 上编辑过会带 CRLF，docker compose 与 shell 都会读错，先统一为 LF
[ -f .env ] && sed -i 's/\r$//' .env
source .env
DEST="${BACKUP_DIR:-./backups}"
DATA="${DATA_DIR:-./data}"
mkdir -p "$DEST/db" "$DEST/media"
STAMP=$(date +%F)
docker compose exec -T db pg_dump -U gastro -d gastronomique -Fc > "$DEST/db/gastronomique-$STAMP.dump"
rsync -a --delete "$DATA/media/" "$DEST/media/"
# 只保留最近 30 天的数据库备份
find "$DEST/db" -name '*.dump' -mtime +30 -delete
echo "$(date) 备份完成 → $DEST"
# 恢复：docker compose exec -T db pg_restore -U gastro -d gastronomique --clean < backups/db/xxx.dump

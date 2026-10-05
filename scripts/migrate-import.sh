#!/usr/bin/env bash
# 在新机器上导入迁移包。会用迁移包的内容【替换】当前数据库与媒体文件。
# 用法：./scripts/migrate-import.sh backups/gastronomique-migrate-xxxx.tar
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
PKG="${1:?用法：$0 <迁移包.tar>}"
[ -f "$PKG" ] || { echo "找不到 $PKG"; exit 1; }
# .env 若在 Windows 上编辑过会带 CRLF，docker compose 与 shell 都会读错，先统一为 LF
[ -f .env ] && sed -i 's/\r$//' .env
set -a; source .env; set +a
DATA="${DATA_DIR:-./data}"
WORK=$(mktemp -d)
tar -xf "$PKG" -C "$WORK"
cat "$WORK/manifest.txt"

read -r -p "将用迁移包替换本机的全部藏品和媒体文件，继续？[y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "已取消"; exit 0; }

echo "→ 启动数据库…"
docker compose up -d db
until docker compose exec -T db pg_isready -U gastro -d gastronomique >/dev/null 2>&1; do sleep 2; done
docker compose stop app >/dev/null 2>&1 || true

echo "→ 恢复数据库…"
docker compose exec -T db psql -U gastro -d gastronomique -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T db pg_restore -U gastro -d gastronomique --no-owner < "$WORK/db.dump"

echo "→ 恢复图片视频…"
mkdir -p "$DATA/media"
cp -R "$WORK/media/." "$DATA/media/"
rm -rf "$WORK"

echo "→ 启动应用…"
docker compose up -d --build app
sleep 5
ITEMS=$(docker compose exec -T db psql -U gastro -d gastronomique -tAc "select count(*) from items")
echo "✓ 完成：当前藏品 $ITEMS 件。登录账号与密码和原机器相同。"

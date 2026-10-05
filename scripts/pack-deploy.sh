#!/usr/bin/env bash
# 在电脑上运行：把程序、配置(.env)和最新数据打成一个部署包，复制到树莓派即可。
# 用法：./scripts/pack-deploy.sh      产物：backups/gastronomique-deploy-日期.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

echo "① 导出最新数据…"
./scripts/migrate-export.sh
DATA_PKG=$(ls -t backups/gastronomique-migrate-*.tar | head -1)

echo "② 打包程序…"
STAMP=$(date +%Y%m%d-%H%M)
OUT="backups/gastronomique-deploy-$STAMP.tar.gz"
tar -czf "$OUT" \
  --exclude='server/node_modules' \
  public server scripts Dockerfile docker-compose.yml .dockerignore .env.example README.md .env \
  -C backups "$(basename "$DATA_PKG")"
# 数据包放在部署包根目录，解压后位于 ./gastronomique-migrate-*.tar
[ -s "$OUT" ] || { echo "打包失败"; exit 1; }
echo "✓ 部署包：$OUT（$(du -h "$OUT" | cut -f1)）"
echo "  内含 .env（密码与密钥），请只通过自己的网络传输，不要上传到网盘或发给他人。"

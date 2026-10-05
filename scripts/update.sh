#!/usr/bin/env bash
# 在树莓派上运行：从 GitHub 拉取最新代码并重建。只更新程序，不会改动数据。
# 用法：./scripts/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && sed -i 's/\r$//' .env   # 统一 .env 换行（Windows 编辑过会带 CRLF）

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "本机有未提交的代码改动，已停止（避免覆盖）："; git status --short --untracked-files=no; exit 1
fi
OLD=$(git rev-parse --short HEAD)
git pull --ff-only
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ]; then echo "已是最新版本（$NEW）"; exit 0; fi

echo "→ 更新 $OLD → $NEW："; git log --oneline "$OLD..$NEW"
docker compose up -d --build        # 数据库迁移在应用启动时自动执行
docker image prune -f >/dev/null    # 清理旧镜像，节省空间
echo "✓ 更新完成"

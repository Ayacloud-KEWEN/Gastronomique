#!/usr/bin/env bash
# 在树莓派上运行（解压部署包后，在项目目录里）：安装/更新并导入数据。
# 用法：./scripts/pi-install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "未安装 Docker。先运行：curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker \$USER，然后重新登录"; exit 1; }
docker compose version >/dev/null || { echo "缺少 docker compose 插件"; exit 1; }
[ -f .env ] || { echo "缺少 .env（应随部署包一起带来）"; exit 1; }
[ "$(uname -m)" = "aarch64" ] || echo "提示：当前架构 $(uname -m)，建议使用 64 位系统"

# .env 若在 Windows 上编辑过会带 CRLF，docker compose 与 shell 都会读错，先统一为 LF
[ -f .env ] && sed -i 's/\r$//' .env
set -a; source .env; set +a
DATA="${DATA_DIR:-./data}"
mkdir -p "$DATA/media" backups
echo "数据目录：$DATA（$(df -h "$DATA" | awk 'NR==2{print $4" 可用"}')）"

echo "→ 构建并启动（首次约需 3–5 分钟）…"
docker compose up -d --build

PKG=$(ls -t gastronomique-migrate-*.tar backups/gastronomique-migrate-*.tar 2>/dev/null | head -1 || true)
if [ -n "$PKG" ]; then
  echo "→ 发现数据包 $PKG"
  ./scripts/migrate-import.sh "$PKG"
  mv "$PKG" backups/ 2>/dev/null || true
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true); IP=${IP:-树莓派IP}
echo
echo "✓ 部署完成：http://$IP:${PORT:-5010}"
command -v tailscale >/dev/null && echo "  Tailscale：http://$(tailscale ip -4 2>/dev/null | head -1):${PORT:-5010}"

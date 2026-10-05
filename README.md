# Gastronomique · 私人食物博物馆

收集世界美食、食材、饮品、餐馆与奇闻轶事的私人百科。没有商业推荐，只记录你的品味。

```
public/            前端（纯 HTML/CSS/JS，无构建步骤）
server/            后端（Node 22 + Fastify + PostgreSQL）
  migrations/      数据库结构（启动时自动执行）
  src/index.js     接口、鉴权、上传、AI 代理
scripts/           备份脚本、冒烟测试
docker-compose.yml PostgreSQL + 应用
```

## 数据如何存放

| 内容 | 位置 |
|---|---|
| 藏品、关系、品尝日志、用户 | PostgreSQL（`data/postgres`） |
| 图片 / 动图 / 视频 | 磁盘文件 `data/media/年/月/xxx.webp`，数据库只记路径 |
| 缩略图 | 上传时自动生成 `thumbs/xxx.webp`（长边 640px；视频取第 1 秒画面，动图保留动画） |
| Anthropic API Key | 服务器环境变量，不会发到浏览器 |

权限：**馆长**（admin）可编辑；**访客**通过一次性邀请链接进入，只读。

**健康印象**（`items.health`）：主要配料、约略热量与份量、热量/脂肪/蛋白质/碳水/糖/盐分的「少·适中·多」三档、饮食标签。刻意不做精确营养成分表。

**分享**：每页右上角「⇪ 分享」——
- 分享图：Canvas 排版的 PNG（3:4 / 1:1 / 9:16，米纸 / 夜色）
- 可编辑文案：按小红书 / 微博 / Markdown / 纯文本生成，可在框内修改后复制；「素材包 .zip」含文案、Markdown 文章、分享图与原图

---

## 部署到树莓派 5

### 快速流程（推荐：从 GitHub 拉取）
代码在 GitHub；**数据和 `.env` 不在仓库里**（仓库是公开的），首次部署时单独复制一次。

```bash
# ① 树莓派上：克隆代码
git clone https://github.com/Ayacloud-KEWEN/Gastronomique.git ~/gastronomique

# ② 电脑上（Git Bash，项目根目录）：导出最新数据，连同 .env 复制到树莓派
./scripts/migrate-export.sh
scp .env backups/gastronomique-migrate-*.tar pi@树莓派IP:~/gastronomique/

# ③ 树莓派上：构建、启动、导入数据
cd ~/gastronomique && ./scripts/pi-install.sh
```

**以后更新程序**（电脑上改完代码并推送到 GitHub 后），在树莓派上：
```bash
cd ~/gastronomique && ./scripts/update.sh     # 只更新程序，不动数据；数据库迁移自动执行
```
> 不要再运行 `pi-install.sh`：它会用数据包替换树莓派上的数据。
> 备选：不用 GitHub 时，可用 `./scripts/pack-deploy.sh` 把程序与数据打成一个包复制过去。

下面是分步说明与可选配置。

### 1. 准备
- 系统：Raspberry Pi OS 64-bit（Bookworm）
- **强烈建议用 NVMe/USB SSD 存数据**，SD 卡频繁写数据库容易损坏。

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 重新登录后生效
```

### 2. 上传代码并配置
把本目录复制到树莓派（如 `~/gastronomique`），然后：

```bash
cd ~/gastronomique
cp .env.example .env
nano .env        # 设置 DB_PASSWORD、ADMIN_PASSWORD；DATA_DIR 指向 SSD，如 /mnt/ssd/gastronomique
```

### 3. 启动
```bash
docker compose up -d --build
docker compose logs -f app      # 看到 "Server listening" 即成功
```
浏览器打开 `http://树莓派IP:5010`，用 `.env` 里的管理员账号登录。首次启动会载入 13 件示例藏品（`SEED=false` 可关闭）。

### 4. 把电脑上的数据搬到树莓派
**不要直接复制 `data/postgres` 文件夹**：PostgreSQL 数据文件不保证在 x86 与 ARM 之间通用。用迁移脚本：

```bash
# 在电脑上（项目根目录，Git Bash）
./scripts/migrate-export.sh          # 生成 backups/gastronomique-migrate-日期.tar（数据库 + 图片视频）
```
把 **迁移包** 和 **`.env` 文件** 复制到树莓派的项目目录（`.env` 要原样带过去：保存的 AI 密钥用它加密，换了密码就解不开）。然后在树莓派上：
```bash
./scripts/migrate-import.sh backups/gastronomique-migrate-日期.tar
```
导入后账号密码、藏品、关系、日志、图片视频、AI 设置都与电脑上一致。

### 4b. 从旧版（纯浏览器版）迁移
在旧版中点「⋯ → 完整备份（含图片视频）」导出 JSON，然后在新版「⋯ → 导入 JSON / 旧版备份」导入即可，图片视频会一并还原。

### 5. 给朋友访问
- **推荐 Tailscale**：树莓派和朋友设备都装 Tailscale，通过内网地址访问，无需开放端口。
- **公网访问**：使用 Cloudflare Tunnel，或路由器转发 + Caddy 自动 HTTPS。启用 HTTPS 后在 `.env` 设置 `COOKIE_SECURE=true`。

Caddy 示例（`/etc/caddy/Caddyfile`）：
```
food.example.com {
    reverse_proxy localhost:5010
    request_body { max_size 600MB }
}
```

然后在网页「⋯ → 邀请朋友」生成一次性链接发给朋友。

### 5b. Tailscale HTTPS（如 https://kevin.xxx.ts.net:5010）
1. Tailscale 管理后台 → DNS：开启 **MagicDNS** 与 **HTTPS Certificates**。
2. 让应用只监听本机另一个端口，把 5010 留给 Tailscale。`.env` 中：
   ```
   PORT=127.0.0.1:5011
   COOKIE_SECURE=true
   ```
   然后 `docker compose up -d`。
3. 让 Tailscale 在 5010 提供 HTTPS 并转发到应用：
   ```bash
   sudo tailscale serve --bg --https=5010 http://127.0.0.1:5011
   tailscale serve status
   ```
4. 访问 `https://<机器名>.<tailnet>.ts.net:5010`。HTTPS 下「📍 当前位置」可用。
撤销：`sudo tailscale serve --https=5010 off`。

### 6. 备份
```bash
chmod +x scripts/backup.sh
crontab -e
# 每天 3 点备份：
0 3 * * * cd /home/pi/gastronomique && ./scripts/backup.sh >> backups/backup.log 2>&1
```
`.env` 中可设 `BACKUP_DIR=/mnt/usb/backup` 备份到另一块盘。恢复数据库：
```bash
docker compose exec -T db pg_restore -U gastro -d gastronomique --clean < backups/db/gastronomique-YYYY-MM-DD.dump
```

### 7. 常用维护
```bash
git pull && docker compose up -d --build                         # 更新
docker compose exec app node src/cli.js passwd admin 新密码       # 忘记密码
docker compose exec db psql -U gastro gastronomique               # 进入数据库
node --env-file=.env scripts/smoke-test.mjs http://localhost:5010  # 冒烟测试（会创建并删除测试数据）
```

## 本地开发
```bash
docker compose up -d db                 # 只起数据库（需在 compose 中给 db 加 ports: ["5432:5432"]）
cd server && npm install
DATABASE_URL=postgres://gastro:密码@localhost:5432/gastronomique ADMIN_PASSWORD=xxx npm run dev
```

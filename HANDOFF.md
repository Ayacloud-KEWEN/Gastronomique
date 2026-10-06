# HANDOFF · 接续文档

给接手开发的人（或下一次会话的 AI 助手）。读完这份即可开始工作。功能与里程碑见 [docs/PROGRESS.md](docs/PROGRESS.md)，部署见 [README.md](README.md)。

## 1. 当前状态（2026-10-05）

- 代码：GitHub `main` 分支，全部功能已提交。
- 开发机（Windows）：Docker 开发模式运行在 `localhost:5010`，含真实数据。
- 树莓派 5：已克隆到 `/mnt/ssd/gastronomique`，正在执行 `pi-install.sh`；随后按 README「Tailscale HTTPS」改为 `PORT=127.0.0.1:5011` + `tailscale serve --https=5010`。**尚未确认部署完成**，接手时先问用户进展。
- 部署完成后**以树莓派数据为准**；开发机数据只用于测试。

## 2. 用户偏好

- **用中文交流**，界面文案也用中文。
- 用户在手机上大量使用：任何界面改动都要验证 375px 宽度。
- 风格：博物馆/老饕感，反商业化；不要加入推荐、广告腔内容。
- 仓库是**公开**的：不要提交 `.env`、`data/`、`backups/`、`temp/`（私人研究与旅行笔记），文档中不写 IP、域名、账号。

## 3. 开发环境

```bash
# 开发模式：public/ 与 server/src 挂载进容器
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```
| 改了什么 | 生效方式 |
|---|---|
| `public/*` | 刷新浏览器 |
| `server/src/*`、新迁移 | `docker compose restart app` |
| 依赖 / Dockerfile | 上面命令加 `--build` |

- 登录：`admin`，密码见本机 `.env` 的 `ADMIN_PASSWORD`（不要写进文档或聊天）。
- 数据库：开发模式下映射到 `127.0.0.1:15432`（Windows 保留了 5432）。
- 后端测试：`node --env-file=.env scripts/smoke-test.mjs`

## 4. 代码地图

```
public/
  index.html      页面骨架、顶部导航、手机底部导航与「更多」面板
  app.js          全部前端逻辑（单个 IIFE）。按注释分段：
                  API · media · 维基链接/边 · UI 工具 · 路由与各页面
                  · 编辑器(editor) · 知识网络(graph) · 品味档案 · AI
                  · 价格/地图/对比 · 国家/目录/重复检测/整理文档/离线队列/版本更新
                  · 命令面板 · 启动(boot)
  sw.js           Service Worker：外壳缓存优先、API 网络优先（6 秒超时回落缓存）、媒体缓存优先
  share.js        分享：Canvas 版式(draw*)、文案生成(*Text)、ZIP 打包
  styles.css      样式；颜色变量在 :root（含 --t-<类别>），末尾按功能追加
  seed.js         空库时的示例藏品
  icons/ manifest.webmanifest
server/
  src/index.js    路由、鉴权钩子、上传、导入导出、启动
  src/items.js    藏品读写与校验（clean）；SELECT 聚合关系/日志/媒体
  src/ai.js       Claude / DeepSeek 调用，密钥加密；Claude 可附带图片 / PDF 原件
  src/docs.js     文档解析：docx（mammoth，保留表格与图片）、pdf（unpdf）、网页、纯文本
  src/thumbs.js   缩略图（sharp，视频经 ffmpeg 取帧）
  src/auth.js     scrypt 密码、会话、登录限速
  migrations/     00N_*.sql，启动时自动执行
scripts/          pi-install / update / migrate-export / migrate-import / backup / pack-deploy / smoke-test
```

**前端约定**
- 全局数据 `db.items`；修改后用 `upsert()` 更新本地并 `route()` 重绘。
- 请求一律经 `api(path, {method, body})`；401 自动跳登录。
- 新页面：写函数 → 加入 `route()` 的映射 → `index.html` 顶部导航与「更多」面板各加一项。
- `window.G` 是给 share.js 的只读上下文；新增分享用的数据要在这里导出。
- 编辑器 `editor(item, preset, focus)`：`collect()` 汇总表单；弹窗 `dataset.lock` 防误关。
- **离线**：`api()` 在网络失败、超时（普通 15 秒、上传 3 分钟）或手机离线时抛出 `{offline:true}`；调用方用 `isOffline(e)` 判断后 `queueOp()` 入队。队列操作类型：`create`（临时 id `tmp-*`）/`update`/`patch`/`journal`；离线照片存为 `local-*` 媒体，`uploadLocalMedia()` 负责补传。新增写操作时，记得同样处理离线分支。
- **版本**：`/api/version` 与 `/sw.js` 里的版本号 = 前端外壳文件的哈希。改了 `public/` 就是新版本；页面通过 Service Worker 的 waiting 状态（或 http 环境下轮询版本号）显示「刷新」按钮。新增需要离线可用的静态文件时，加到 `sw.js` 的 `SHELL` 和 `index.js` 的 `SHELL` 列表。
- **国家**：`items.country` 为 ISO 两位代码（`XX` = 多国）；`inferCountry()` 只看地区文字。

**后端约定**
- 新字段：写迁移 → `items.js` 的 `SELECT`/`shape`/`clean`/`saveItem` 参数 → 前端。
- 写操作默认仅馆长（`onRequest` 钩子统一判断）。
- 错误：`statusCode < 500` 或 `expose: true` 的消息会返回给前端。

## 5. 踩过的坑（务必注意）

1. **Windows 下用 shell 传转义字符不可靠**：`\r`、`\{` 等经 bash heredoc / python -c 多层转义后会变成真实控制字符。改文件时用 Write/Edit 工具或写成独立 `.py` 脚本，改完用 `cat -A` 或读字节验证。
2. **CRLF**：Windows 上编辑的 `.env` 带 CRLF，docker compose 会把 `PORT` 读成 `5010\r`。各脚本读取前都会执行 `sed -i 's/\r$//' .env`；仓库用 `.gitattributes` 强制 LF。
3. **带 `width/height` 属性的 `<img>`**：容器只设宽度时高度会被撑成原图像素，必须显式设置 `height:auto` 或 `100%`。
4. **DELETE 请求不要带 `content-type: application/json` 且无 body**：Fastify 会返回 400，导致删除静默失败。
5. **可滚动的 flex 容器**里，子元素要设 `flex-shrink:0`，否则会被压扁。
6. 底部导航不要用 `<nav>` 标签，旧的 `nav a.on` 样式会命中它。
7. 定时保存草稿后关闭弹窗，要 `clearTimeout`，否则草稿会被写回。
8. Nominatim 在 Git Bash 中用 curl 查含 `ø` 等字符的地名会因编码失败；在 Node 或浏览器里请求正常。查询时遵守每秒 1 次。
9. 分享图只能画同源图片（外链图片会污染画布导致无法导出）。
10. **弱网下请求可能长时间挂起而不是失败**：所有写请求都必须有超时（已在 `api()` 里统一处理），否则离线保存会迟迟不触发。
11. 推断国家不要使用外文名：「俄罗斯鲟」「波斯鲟」是物种名，不是产地。
12. 重复检测时，至少一方必须是**名称本身**：外文名常被写成地点或描述（如「Tromsø」「Italian caviar」），两个外文名相同不算重复。
13. 非 HTTPS（局域网 http）下 `window.caches`、`navigator.serviceWorker` 都不存在，访问前要判断，并写成 `window.caches?.`。
14. 测试 Service Worker 更新时，改前端文件后需要 `reg.update()` 再点刷新；页面处于后台时浏览器不会触发可见性检查。

## 6. 部署与更新

- 首次部署：README「部署到树莓派 5 → 快速流程」。
- 之后更新：开发机改代码 → 提交推送 → 树莓派运行 `./scripts/update.sh`（只更新程序，迁移自动执行）。
- **不要在已部署的树莓派上再运行 `pi-install.sh`**：它会用数据包覆盖数据。
- 数据搬迁：`migrate-export.sh` → 复制 tar 和 `.env` → `migrate-import.sh`。`.env` 必须原样带走（AI 密钥用它派生的密钥加密）。

## 7. 建议的下一步

1. 跟进树莓派部署与 Tailscale HTTPS 是否成功；部署后在树莓派上跑一次 `smoke-test.mjs`（它会创建并删除测试数据）。
2. 树莓派上：「目录 → 地区 → 未标国家 → 按地区文字自动推断国家」，整理已有数据。
3. 配置每日备份 cron，并考虑异地备份。
4. 用真实 API Key 跑通 AI 编目、发现与整理文档。
5. 用户感兴趣的新功能：旅行清单视图、反向链接。

## 8. 交接检查清单

- [ ] 问用户：树莓派部署与 Tailscale 是否完成？
- [ ] `git pull`，确认本地与 `main` 一致
- [ ] 启动开发模式，跑 `smoke-test.mjs`
- [ ] 改动后：375px 手机尺寸验证 → 提交 → 推送 → 提醒用户在树莓派运行 `update.sh`

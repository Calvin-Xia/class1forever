# 部署与开发指南

**当前正式更新入口：推送 main，由 Actions 串行发布 CF Worker 与 EO Makers 正式项目。** 保留线上版本、数据、密钥、路由及 DNS；新旧脚本协调发布以支持同 Host 切线。完整步骤见 [CI 发布协议](docs/ci-deployment.md)，实际接入状态见 [正式分流验收](docs/production-readiness-20261015.md)。下文单 Worker 命令为历史迁移/首次初始化参考，不应直接用于当前双端生产更新。

这份文档对应当前仓库的部署模型：**Astro 6 SSR + Cloudflare Worker + Workers Assets + KV**。站点仍然是公开站点，但完整学生数据不再进入任何静态产物；公开页面只读聚合数据，姓名和学校信息在口令验证后按地区读取。

> 部署口径已从 Cloudflare Pages 改成 **Worker**：`wrangler.jsonc` 的 `main` 指向适配器统一入口
> （`@astrojs/cloudflare/entrypoints/server`），静态资产走 `ASSETS` 绑定（目录 `./dist`）。
> 本文所有命令都是 Worker 口径（`wrangler deploy` / `wrangler secret put`），**不再有** `wrangler pages ...`。
> 生产域名切换与 Pages 下线是人工 gate：完整清单（密钥、KV 核对、回滚、发布后检查项、人工步骤 M1–M10）
> 见 `docs/cutover-runbook.md`（历史迁移记录；当前已合并 Worker 迁移）；
> **Pages 项目保留到人工确认后才下线**（它就是回滚后路）。

当前双平台域名方向优先评估 `map.calvin-xia.cn` 的 DNSPod GeoDNS + CF for SaaS，原 302/独立域名作为备选。根域留在 CF，父区 map NS 已存在；SaaS 官方 CDN 不兼容风险、子区回答、证书续期与同 Host Cookie 门禁仍需实测，不能仅添加 CNAME 宣布完成。用户 CF 支付资料已确认存在。具体状态/人工上线步骤见 [双平台方案](docs/edgeone-cloudflare-dual-deployment-plan.md)、[运行手册](docs/dual-deployment-runbook.md) 和 [最新本地实施记录](docs/local-continuation-20261015.md)。本轮实施本地可验证部分，不执行下面的部署/密钥/数据命令。

## 1. 部署模型

当前线上能力拆分如下：

- `GET /api/map/public`
  返回公开的省市聚合统计，只包含人数和地区覆盖信息。

- `POST /api/auth/details`
  校验口令，成功后签发 `HttpOnly` 会话 Cookie。

- `GET /api/map/details`
  只在会话有效时返回某个省份或城市的姓名、学校信息。

- `CLASS_MAP_DATA` KV
  保存两份数据：
  - `students:raw:v1`: 完整学生数据，仅服务端读取。
  - `students:public:v1`: 公开聚合数据，供地图初始化使用。

- `npm run build`
  唯一构建入口：`node build.js`，依次跑静态安全断言（防止有人把 `js/data.js` 或整包学生数据重新引回静态面、
  脚本同源无内联、`script-src` 无 `unsafe-inline`、省份白名单与 `js/province/` 一致、配色对比度）、
  `wrangler types --check`、`astro check`、`astro build` 与产物扫描。**本地起站与契约测试都依赖这一步的产物。**

- `npm run check:runtime`
  真起一次本地 Worker（无需凭据）：断言渲染页无内联脚本、文档响应与静态资产的安全头逐条一致、
  `/.dev.vars` / `/js/data.js` / `js/vendor/echarts.min.js` 不可请求。

- `npm run dev:local`
  不需要 Cloudflare 凭据的本地完整通路（本地 Worker + 本地 KV + 演示口令 `demo`），见 §4.2。

- `npm run test:api`
  四个 API 路由的成功/失败态契约断言，自己起本地 Worker、不读 `.dev.vars`，见 §4.2。

## 2. Cloudflare 侧准备

### 2.1 登录 Cloudflare 账号

首次在本机操作前，先确认 Wrangler 已登录：

```bash
npx wrangler login
npx wrangler whoami
```

如果 `whoami` 看不到正确账号，后续的 KV 上传和手动部署都会失败。

### 2.2 准备 KV Namespace

项目需要一个名为 `CLASS_MAP_DATA` 的 KV 绑定，生产和预览环境各用一个 namespace。

如需新建，可执行：

```bash
npx wrangler kv namespace create CLASS_MAP_DATA
npx wrangler kv namespace create CLASS_MAP_DATA --preview
```

当前仓库的 `wrangler.jsonc` 已经包含：

- 顶层 `kv_namespaces[0].binding = "CLASS_MAP_DATA"`
- 生产 `id`
- 预览 `preview_id`
- `remote: true`

`remote: true` 的作用是：本地执行 `npm run cf:dev` 时，Worker 直接读取 Cloudflare 上的远端 KV，而不是读一个空的本地模拟 KV。

如果你更换了 Cloudflare 账号或重新创建了 namespace，要同步更新 `wrangler.jsonc` 中对应的 `id` 和 `preview_id`。

### 2.3 配置 Secrets 与公开变量

必须配置两个 Secrets：

- `DETAILS_PASSPHRASE`
- `DETAILS_SESSION_SECRET`

可以在 Cloudflare 控制台（Worker `class1forever` → Settings → Variables and Secrets）设置，也可以用 Wrangler：

```bash
npx wrangler secret put DETAILS_PASSPHRASE
npx wrangler secret put DETAILS_SESSION_SECRET
```

> 注意：**Pages 项目的 Secrets 与 Worker 的 Secrets 是两套**。切换那天需要把这两个名字重新绑到 Worker 上，
> 否则详情功能直接不可用（`npx wrangler secret list` 核对名字）。
> 预览环境同名配置：`npx wrangler secret put DETAILS_PASSPHRASE --env preview`（以及 `DETAILS_SESSION_SECRET`）——
> 但先看一下 `docs/cutover-runbook.md` §4 关于 `--env preview` 实际绑到哪个 KV namespace 的提醒。

可选变量：

- `DETAILS_HINT`

这个变量只用于前端提示，不参与安全校验。当前仓库已经在 `wrangler.jsonc` 的 `vars` 和 `env.preview.vars` 中提供了示例值；你可以按需要修改文案，但不要把真正的口令写进去。

## 3. 数据准备与上传

### 3.1 支持的数据来源

上传脚本支持两种输入方式：

1. 环境变量 `STUDENTS_DATA`
2. 本地未提交的 `js/data.js`

无论使用哪种来源，数据最终都只会进入 Cloudflare KV，不会重新生成给前端直接加载的静态文件。

### 3.2 数据格式要求

每条记录至少应包含：

- `name`
- `school`
- `province`
- `city`

示例：

```json
[
  {
    "name": "xxx",
    "school": "北京电子科技学院",
    "city": "丰台区",
    "province": "北京"
  }
]
```

脚本会在上传前做规范化处理，并生成：

- 原始明细数据 `students:raw:v1`
- 公开地图数据 `students:public:v1`

### 3.3 上传命令

先做 dry run：

```bash
npm run data:upload -- --dry-run
```

上传到生产环境：

```bash
npm run data:upload
```

上传到预览环境：

```bash
npm run data:upload:preview
```

如果你想显式指定本地数据文件，可以附加 `--source`：

```bash
npm run data:upload -- --source path/to/data.js
```

推荐流程是：

1. `npm run data:upload -- --dry-run`
2. `npm run data:upload:preview`
3. 本地验证无误后，再执行 `npm run data:upload`

## 4. 本地开发

### 4.1 准备 `.dev.vars`

复制 `.dev.vars.example` 为 `.dev.vars`，至少填入：

```bash
DETAILS_PASSPHRASE=你的口令
DETAILS_SESSION_SECRET=一段足够长的随机字符串
DETAILS_HINT=前端提示语，可选
```

`.dev.vars` 只用于本地开发，不应提交到仓库。

### 4.2 启动本地环境（不需要 Cloudflare 凭据）

推荐用完整通路：它把 Astro 构建产物交给 `wrangler dev`，本地 KV 里预置夹具数据，演示口令是 `demo`。

```bash
npm run build      # 先产出 dist/
npm run dev:local  # http://127.0.0.1:8788
```

- `--port 9000` 换端口；`--reset` 先清空本地 KV；`--public-file` / `--raw-file` 指真实数据文件。
- 想看真实聚合数字（公开数据只有人数，可以安全导出）：

  ```bash
  npx wrangler kv key get students:public:v1 \
    --namespace-id=<wrangler.jsonc 里的 preview_id> --remote --text > public.json
  STUDENTS_PUBLIC_FILE=public.json npm run dev:local
  ```

  `students:raw:v1` 含姓名与学校，不要导出、也不要入库。
- 只想先写本地 KV、自己起 `astro dev` 时用 `npm run seed:local`。

> **Windows 沙箱提示**：workerd 需要往临时目录写文件。如果 `npm run build` / `npm run dev:local` /
> `npm run test:api` 报 `CreateDirectory #5 拒绝访问` 或 workerd 起不来，把 `TEMP` 与 `TMP`
> 指向工作区内的目录再执行，例如：
> `TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run test:api`。

> **同源 POST 需要 `Origin` 头**：Astro 默认开启 `security.checkOrigin`，会拒绝没有 `Origin` 头
> 且 Content-Type 为空/表单类型的 POST（403 `Cross-site POST form submissions are forbidden`）。
> 浏览器对每个 POST（含同源）自动带上，所以页面里不用做任何事；用 `curl` / Node 脚本联调时
> 要手动加 `-H "Origin: http://127.0.0.1:8788"`。
>
> 并发提醒：本地 KV 是 miniflare 的 SQLite 目录，同一 state 目录只允许一个写者。
> 同时跑多个 `dev:local` / `test:api` 时请用 `--state-dir`（测试已经默认用独立的 state-test）。

不要用 `python -m http.server` 代替这些命令。静态服务器只能打开页面，无法提供 `/api/*` 路由，也无法验证口令流程。

需要验证远端 KV 与真实口令时再用 `npm run cf:dev`（Worker 形态的 `wrangler dev`，读 `wrangler.jsonc` 里
KV 的 `remote: true`，需要先 `npx wrangler login`）。旧版 `tests/dev-server.mjs`（假 API）已退役，
不再是可执行主路径。

### 4.3 为什么本地会提示“地图公开数据尚未配置”

如果你在本地打开页面时看到这条提示，一般有两个原因：

1. 预览环境 KV 里还没有 `students:public:v1`
2. `wrangler.jsonc` 中的 `preview_id` 指向了错误的 namespace

优先检查：

```bash
npm run data:upload:preview
```

如果上传成功但页面仍然为空，再检查 `wrangler.jsonc` 是否仍然指向正确的预览 KV。

### 4.4 本地推荐验证项

至少手动验证以下内容：

1. 匿名访问时地图可正常显示，且页面源码中没有 `js/data.js`
2. 开启详情模式后，输入正确口令可以查看地区详情
3. 错误口令会返回失败提示
4. 钻取省份和城市时，详情面板能正确更新
5. 悬停省份时底部色带图例同步标出对应人数
6. 缩放和拖动被限制在可视范围内，地图不会被拖出画面
7. 分享按钮能生成包含地图、图例与统计数字的 PNG

## 5. 部署（Worker 口径）

本分支的部署面是 Cloudflare Worker + Workers Assets，命令都是 Worker 口径：

```bash
npx wrangler login              # 只做一次
npx wrangler whoami             # 确认账号与权限
npm run build                   # 产出 dist/
npx wrangler secret put DETAILS_PASSPHRASE        # 首次/轮换时
npx wrangler secret put DETAILS_SESSION_SECRET
npx wrangler deploy             # 部署 Worker + Assets；输出里有 Version ID 与 workers.dev 地址
npx wrangler deployments list   # 记录 Version ID（回滚要用）
```

先预览、不切流量：

```bash
npx wrangler versions upload --preview-alias cutover-preview
# → cutover-preview-class1forever.<subdomain>.workers.dev
```

不落盘的部署面体检（不需要凭据）：`npm run worker:dryrun`。

### 5.1 CI 部署（GitHub Actions → Workers + Makers）

仓库自带 `.github/workflows/deploy.yml`：**推 `main`**（或手动 `workflow_dispatch`）时执行
`npm ci` → `npm run check:dual` → 只读线上预检/保留旧公开脚本 → EO 兼容部署 → CF 正式部署 → EO 最终正式部署 → 双端读回验收。完整协议与失败语义见 [CI 发布说明](docs/ci-deployment.md)。构建或预检失败不触碰生产。

在 **Settings → Secrets and variables → Actions** 里配置：

| Secret | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Worker 读写及对应 zone Worker routes 的读取/保留权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 可选 | 若设置，必须与固定生产账号一致 |
| `EDGEONE_API_TOKEN` | ✅ | 该 Makers 正式项目的读取与 production 部署权限 |

> 两项 `DETAILS_*` 应用密钥必须已在 Worker 上；CI 沿用线上值，不再从仓库 Secret 自动覆盖。EO 私有 KV 配置同样保留。数据上传、版本激活、密钥轮换与 DNS 变更不属于此自动发布流程。

**Cloudflare Pages 的自动部署不是这个 workflow 管的** —— 它来自 Cloudflare 上
`class1forever` 这个 **Pages 项目**的 Git 集成。要停掉它、改成只走 Workers，见 5.2。

### 5.2 停掉 Pages 自动部署，只走 Workers

两套独立的“Pages”都要知道：

1. **Cloudflare Pages**（`class1forever.pages.dev`）：Git 集成在 **Cloudflare Dashboard**
   → Workers & Pages → `class1forever`(Pages) → **Settings → Builds & deployments**
   → 关掉 **Automatic deployments**（或断开 Git 连接）。合并/上线稳定后再按 M7 删除整个项目
   （观察期前留着当回滚后路）。
2. **GitHub Pages**（`calvin-xia.github.io/class1forever`）：仓库 **Settings → Pages**
   → Source 设为 **None**（它源码是 `main`，与本分支无关，但如果你想彻底只留 Workers 就一并关掉）。

这两步都是**账号/仓库设置，仓库里的文件改不动它们**；属于人工 gate（`docs/cutover-runbook.md` §8 M6/M7/M9）。

## 6. Cloudflare 侧设置核对

切换后建议确认：

- Worker 名：`class1forever`（`wrangler.jsonc` 的 `name`）
- 兼容性日期：`2026-03-06`；兼容性开关：`nodejs_compat`、`global_fetch_strictly_public`
- 绑定：`ASSETS`（Workers Assets，目录 `./dist`）、`CLASS_MAP_DATA`（KV，id `e6c9c4ff9bc84aa4979184515e713ecb`）、
  `SESSION` / `IMAGES`（适配器注入）
- Secrets：`DETAILS_PASSPHRASE`、`DETAILS_SESSION_SECRET`
- 自定义域名 / 路由：从 Pages 项目改指到该 Worker（人工）

**Pages 项目在观察期结束前不要删**（回滚后路）。手动部署不再用 `wrangler pages deploy`，见 §5。

## 7. 手动部署

```bash
npm run build
npx wrangler deploy          # Worker + Assets；不带参数
npx wrangler rollback        # 需要回退时：用上一个版本重新部署（也可指定 VERSION_ID）
```

彻底回滚可以把域名/路由切回 Pages 项目（该项目全程未被本次迁移修改）。完整回滚步骤与触发条件
见 `docs/cutover-runbook.md` §6。

## 8. 发布后检查

每次发布后，至少确认以下几点：

1. 地图首页能够正常加载并显示公开人数统计（`window.__mapProbe.read().booted === true`）
2. 浏览器 `Network` 和 `Sources` 中不存在 `js/data.js` 或完整学生名单
3. 输入正确口令后，可以查看某个省份或城市的同学信息
4. 输入错误口令返回失败提示，连续错误超过阈值会被限制
5. 删除或篡改 Cookie 后，再请求详情会被拒绝
6. 预览环境和生产环境都已配置对应的 KV 与 Secrets
7. 渲染页没有内联脚本，CSP 仍是 `script-src 'self'`；`/.dev.vars`、`/js/data.js`、
   `/js/vendor/echarts.min.js` 都是 404
8. 自定义域名与 `workers.dev` 地址的 5 条安全头与静态资产响应逐条一致

更细的浏览器侧清单（含触摸长按、分享图范围/日期、弹窗 inert 与焦点归还、窄屏无横滚）
见 `docs/cutover-runbook.md` §7 与 `AGENTS.md` 的 14 项人工 smoke。

## 9. 常见问题

### 9.1 `wrangler kv bulk put failed with exit code unknown`

常见原因有三类：

1. 当前终端环境拦截了 `wrangler` 的子进程执行
2. 本机没有完成 `wrangler login`
3. 当前账号没有目标 namespace 的权限

排查顺序建议是：

```bash
npx wrangler whoami
npm run data:upload -- --dry-run
npm run data:upload
```

如果是在受限沙箱里运行，有时不是 Cloudflare 配置错，而是本地执行权限不足。

### 9.2 推送到 GitHub 后没有自动部署（Worker 侧）

检查：

1. 仓库里是否有 `CLOUDFLARE_API_TOKEN`（Settings → Secrets and variables → Actions）；
   deploy workflow 见 §5.1
2. `wrangler.jsonc` 的 `main` / `assets` 是否被破坏（`npm run build` 会拦住大部分）
3. `secrets.required` 的两个应用密钥是否已在 Worker 上（CI 同步或 `wrangler secret put`）
4. 若还在看 Pages 的自动部署：那是 **Cloudflare Pages 项目**的 Git 集成，不是本 workflow；
   停用步骤见 §5.2

### 9.3 本地详情功能一直拿不到数据

优先检查：

1. `.dev.vars` 是否存在且值完整（用 `npm run dev:local` 的本地通路不需要 `.dev.vars`，口令固定是 `demo`）
2. `DETAILS_PASSPHRASE` 是否和远端环境一致
3. `preview_id` 是否正确
4. 是否先执行了 `npm run data:upload:preview`

## 10. 敏感数据处理建议

- 不要提交 `.dev.vars`、`.dev.vars.*`、`js/data.js`
- 不要把完整学生数据重新写回 `index.html`、`js/` 或其他静态资源
- 如果曾经误提交过敏感数据，建议清理 Git 历史后再继续公开托管
- 在分享预览链接或生产链接前，先手动检查浏览器网络请求，确认不会下发整包明细

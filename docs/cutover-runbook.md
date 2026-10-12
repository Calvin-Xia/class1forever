# 生产切换包（l4_cutover）：Astro 6 SSR + Cloudflare Worker + Workers Assets

- 节点：`l4_cutover`（图 `astro-migration`，class=standard），执行者 `exec-cutover`（叶子，未转派、未使用 subagent）。
- 日期：2026-10-13；分支 `astro-migration`；基线 `main` = `90c182bc31b877ad1d9de16068d7fd2e8fa3c77c`。
- 环境：`node v24.12.0` / `wrangler 4.149.0` / `astro 6.4.8`；`TEMP`/`TMP` 指向 `$PWD/.wrangler/probe-tmp`。
- 一句话：**切换包 + 人工 gate**。本节点产出部署命令、密钥与 KV 清单、预览/验证记录、回滚步骤、发布后检查项、
  人工步骤清单；**生产域名切换与 Pages 下线由人工执行**（见 §8）。agent 未触碰任何生产配置，未写 KV。

> 本文件里的 Cloudflare 命令口径按 Workers 官方文档（经 context7 核对：
> `developers.cloudflare.com/workers/wrangler/commands/workers`、`.../workers/configuration/secrets`、
> `.../workers/versions-and-deployments/...`）。**F-5 整改**：文档里所有 Pages 口径
> （`wrangler pages deploy` / `wrangler pages secret put`）一律换成 Worker 口径
> （`wrangler deploy` / `wrangler secret put`）；Pages 项目**保留**到人工确认后才下线（§8 M7）。

---

## 1. 切换前后的形态

| | 切换前（线上，`main`） | 切换后（本分支） |
|---|---|---|
| 托管 | Cloudflare **Pages** 项目 `class1forever` | Cloudflare **Worker** `class1forever` + Workers **Assets** |
| 地址 | `https://class1forever.pages.dev/` | `<worker>.<subdomain>.workers.dev`（+ 人工绑定的自定义域名） |
| 入口 | 静态 `index.html` + `js/boot.js`（经典脚本） | `@astrojs/cloudflare/entrypoints/server`（Astro SSR，产物在 `dist/`） |
| API | Pages Functions `functions/api/**` | Astro 端点 `src/pages/api/**`（同一套契约） |
| 配置 | `wrangler.jsonc` 的 `pages_build_output_dir: "."` | `main` + `assets: { binding: "ASSETS", directory: "./dist" }` |
| 数据 | KV `CLASS_MAP_DATA` 两个键 | **同一个** KV 绑定、**同样两个键**（逐字不变，见 §4） |
| 密钥 | Pages 项目 Secrets | **Worker** Secrets（需重新绑定，见 §3） |

值得强调：**切换不改数据面、不搬 KV、不重新上传数据**。Pages 与 Worker 共用同一个
`CLASS_MAP_DATA` namespace，所以切换只是"谁来读这两个键"变了。

---

## 2. 部署命令（Worker 口径）

### 2.1 本地先跑门禁（不需要任何凭据）

```bash
npm ci
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run build   # 静态断言 + astro check + astro build + 产物扫描
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run check:runtime   # 真起一次本地 Worker 的运行时门禁
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run test:api        # 四路由契约（19 项）
```

### 2.2 不落盘的部署面体检（本次已跑，见 §5.1）

```bash
npm run worker:dryrun     # = wrangler deploy --dry-run --outdir .wrangler-dryrun
```

### 2.3 生产部署（人工，需要凭据）

```bash
npx wrangler login
npx wrangler whoami                 # 确认账号/权限
npx wrangler secret put DETAILS_PASSPHRASE        # 见 §3
npx wrangler secret put DETAILS_SESSION_SECRET
npm run build
npx wrangler deploy                 # 部署 Worker + Assets；输出里给 Version ID 与 workers.dev 地址
npx wrangler deployments list       # 记录本次 Deployment / Version ID（回滚要用）
```

### 2.4 先预览、不切流量的两种做法（人工）

```bash
# (a) 只上传版本，不部署（Version URL；文档：wrangler versions upload）
npx wrangler versions upload --preview-alias cutover-preview
#   → 预览地址形如 cutover-preview-class1forever.<subdomain>.workers.dev
#   （官方文档明确：alias 只能在 versions upload 时指定，输出形如 <alias>-<worker-name>.<subdomain>.workers.dev）

# (b) 只上传版本、拿 Version URL 后手工核对
npx wrangler versions upload
npx wrangler versions list
```

> 若用「先 `wrangler deploy` 到 workers.dev、确认无误后再把自定义域名切过去」，那也是一条合法路径
> （Worker 名 `class1forever` 是新对象，不会自动接管 Pages 的域名）。**但必须人工确认**：
> `wrangler deploy` 会立刻把该 Worker 的 `workers.dev` 地址与任何已挂在该 Worker 名下的路由/域名指向新版本。

---

## 3. 需要重新绑定的密钥（Worker Secrets）

| 名称 | 类型 | 取值来源 | 切换时动作 |
|---|---|---|---|
| `DETAILS_PASSPHRASE` | Secret | 与线上 Pages 项目**同一口令**（人已知，仓库里没有） | `npx wrangler secret put DETAILS_PASSPHRASE` |
| `DETAILS_SESSION_SECRET` | Secret | 一段足够长的随机串（人已知/可重生成） | `npx wrangler secret put DETAILS_SESSION_SECRET` |
| `DETAILS_HINT` | 普通变量（非密钥） | `wrangler.jsonc` 的 `vars.DETAILS_HINT`（公开提示语） | 无需动作，随配置部署 |

- 两个 Secret **只从运行时 env 读取**（`import { env } from 'cloudflare:workers'`），不硬编码、不入库。
- 本地开发用 `.dev.vars`（gitignore）；`npm run dev:local` 用自己派生的本地配置注入演示口令 `demo`，不读 `.dev.vars`。
- 注意：Pages 项目的 Secrets 与 Worker 的 Secrets **是两套**。切换前 Worker 侧没有这两个 Secret 时，
  详情功能会 500/401——**先绑 Secret 再部署**（顺序见 §2.3）。
- `DETAILS_SESSION_SECRET` 换了值等于让所有已签发会话失效（12h TTL 的 Cookie 签名校验失败）。这是可接受的，
  但要有意识：**切换当天所有人需要重新输入口令**。

核对命令：

```bash
npx wrangler secret list            # 应列出上面两个名字（不显示取值）
```

---

## 4. KV 绑定核对清单（逐字不变）

`wrangler.jsonc` 与 `main` 的差异**只在文件头部**（`pages_build_output_dir` → `main`/`assets`/`compatibility_flags`）；
`kv_namespaces`、`vars`、`env.preview` 三块**零 diff**（读数见 §9.2）。

| 项 | 期望值 | 在哪里核对 |
|---|---|---|
| 绑定名 | `CLASS_MAP_DATA` | `wrangler.jsonc` `kv_namespaces[0].binding`；`npx wrangler deploy --dry-run` 的 bindings 表 |
| 生产 namespace id | `e6c9c4ff9bc84aa4979184515e713ecb` | 同上；dry-run 输出里以 `env.CLASS_MAP_DATA (e6c9c4ff…)` 呈现 |
| 预览 namespace id | `2761c6566ea945c2ac44da3a916cb840` | `wrangler.jsonc` 的 `kv_namespaces[0].preview_id` 与 `env.preview.kv_namespaces[0].id` |
| 远程读 | `remote: true` | `wrangler.jsonc`（`cf:dev` 走远端 KV） |
| 明细键 | `students:raw:v1`（**仅服务端**） | 不需要动；门禁断言它不出现在客户端面 |
| 公开键 | `students:public:v1`（前端读） | 不需要动；门禁断言明细键不进产物 |

**本次切换不需要重新上传数据**（两键沿用既有内容）。agent **没有**执行任何 KV 写入，
两键的存在性与内容属人工核对项（M4）。

⚠️ **预览环境绑定风险（本节实测发现，人工必须确认）**：`--env preview` 的 dry-run 读数里，
`CLASS_MAP_DATA` 解析到的仍然是**生产 id** `e6c9c4ff9bc84aa4979184515e713ecb`。原因：适配器生成的
`dist/server/wrangler.json` 不带 `env.preview` 块（只有 `preview_id` 与 `definedEnvironments: ["preview"]`），
wrangler 部署时用的是这份重定向后的配置。所以：

- 做预览（§2.4）前，先在 dry-run / 控制台确认这次实际绑到哪个 namespace；
- 若确实需要读预览 namespace，需在部署时显式改绑（或在适配器产物里补回 `env.preview`），**不要想当然**。

另两个由适配器注入的绑定（dry-run 读数）：`env.SESSION`（KV，无 id，首次部署会创建）、`env.IMAGES`（Images）。

---

## 5. 预览部署与验证记录

### 5.1 凭据缺口（如实披露）

```text
$ npx wrangler whoami
 ⛅️ wrangler 4.149.0
X [ERROR] Not logged in. Your auth token has expired and could not be refreshed, and the environment is
          non-interactive. Run `wrangler login` in an interactive terminal or set a CLOUDFLARE_API_TOKEN.
```

→ **本环境没有可用凭据，agent 不能做真预览部署**。按 brief 的无凭据路径处理：

- 已做：`npm run worker:dryrun`（部署面体检，不落盘、不触网写操作）；
- 已做：`wrangler versions upload --dry-run`、`wrangler deploy --dry-run --env preview`（只编译校验）；
- 未做：**真预览部署**（未登录 → 无 Version/Deployment，无预览地址），已降级为人工步骤 **M1/M2**（§8）。

### 5.2 dry-run 读数（部署面体检，`EXIT=0`）

日志：`.wrangler/probe-tmp/l4-dryrun.log`（`npm run worker:dryrun`）

```text
Using redirected Wrangler configuration.
 - Configuration being used: "dist\server\wrangler.json"
 - Original user's configuration: "wrangler.jsonc"
Total Upload: 1178.16 KiB / gzip: 253.68 KiB   （16 modules）
✨ Read 49 files from the assets directory ...\dist\client
Your Worker has access to the following bindings:
  env.SESSION                                      KV Namespace
  env.CLASS_MAP_DATA (e6c9c4ff9bc84aa4979184515e713ecb)  KV Namespace
  env.IMAGES                                       Images
  env.ASSETS                                       Assets
  env.DETAILS_HINT ("语文老师的姓名拼音（例：张三就输入"zhangsan"）")  Environment Variable
--dry-run: exiting now.
```

### 5.3 「预览环境等价验证」：本地 Worker 渲染路径（`npm run dev:local`）

没有 Cloudflare 凭据时，**本地 Worker（wrangler dev × astro build 产物，本地 KV 夹具 + 演示口令 demo）**
是最接近预览的环境；首页与四路由都在这里跑通：

日志/证据：`.wrangler/probe-tmp/l4-astrodev/devlocal-probe-out.txt`、`devlocal-index.html`、
`devlocal-public.json`、`devlocal-details.json`

```text
GET /                    status=200 bytes=12041
  fingerprint href="css/main.css"        = 0（旧站指纹）
  fingerprint js/boot.js                 = 0（旧站指纹）
  fingerprint href="/favicon.svg"        = 1（新站指纹）
  fingerprint map-frame                  = 9
  fingerprint region-table               = 4
  inline <script> without src            = 0
  <script> tags total                    = 3
  /_astro/ asset links                   = 5
GET /api/map/public      status=200 keys=detailAccess,detailModeAvailable,detailsHint,generatedAt,provinces,stats,version
                         vary=Cookie cache=no-store
POST /api/auth/details   status=200 set-cookie=detail_session=… body={"authenticated":true}
POST /api/auth/details   (wrong) status=401 body={"error":"invalid_passphrase",…,"remainingAttempts":9}
GET /api/map/details     status=200 keys=city,count,people,province province=浙江 count=2 people=2
GET /api/map/details     (anon)  status=401 body={"error":"detail_auth_required",…}
POST /api/auth/logout    status=200 set-cookie=detail_session=; Path=/; HttpOnly; Secur…
GET /.dev.vars                   status=404
GET /js/data.js                  status=404
GET /js/vendor/echarts.min.js    status=404
```

### 5.4 dev 遮蔽处置（F-2）与两处渲染通路验证

**问题**：仓库根 `index.html` 会被 Vite 的静态中间件先命中，`astro dev` 的 `GET /` 返回**旧站页面**，
在 astro dev 里"验证首页"会验错对象（`l2_motion` 记为 F-2）。

**处置（非破坏、可回滚）**：把旧入口**归档**为 `legacy/index.html`（`git mv`，内容零改动，
sha256 与 `main:index.html` 逐字节相同：`babad1aa4606efa62ccdadb1f7f39993692b929336cd60e78252b2286c78feda`），
`js/**`、`css/**`、`functions/**` **原地不动**（对照资产与视觉基线，见 §9.3）。新增 `legacy/README.md` 说明归档原因与回滚命令。
`build.js` 的 Gate A 新增一条断言：**仓库根不得再出现 `index.html`**（否则 `npm run build` 失败并提示 `git mv` 回归档位）。

两处通路的实测指纹（`astro dev` 证据：`.wrangler/probe-tmp/l4-astrodev/astro-dev-probe-out.txt`）：

| 通路 | `GET /` | 旧站指纹 | 新站指纹 |
|---|---|---|---|
| `astro dev`（`:8985`，`--host 127.0.0.1`） | 200 / 81830 B | `href="css/main.css"`=0、`js/boot.js`=0、`href="favicon.svg"`=0 | `href="/favicon.svg"`=1、`map-frame`=41、`region-table`=24、`@vite/client`=1 |
| `wrangler dev`（`dev:local` `:8788`） | 200 / 12041 B | 同上全 0 | `href="/favicon.svg"`=1、`map-frame`=9、`region-table`=4、`/_astro/`=5 |

`astro dev` 下 `/api/map/public` 返回 **503 `public_data_unavailable`**（Astro 路由被执行，只是模拟 KV 没有数据）
——这条同时也是"`/` 与 `/api/*` 都走 Astro 路由"的证据。

> 环境备注（可复现）：`astro dev` 默认只监听 `[::1]`，本沙箱对 IPv6 回环 connect 返回 `EACCES`，
> 所以探针用 `--host 127.0.0.1`；`wrangler dev` 默认就是 `127.0.0.1`，无需处理。

### 5.5 门禁复跑（本节点改动后）

```text
$ TEMP=$PWD/.wrangler/probe-tmp TMP=$PWD/.wrangler/probe-tmp npm run build      → EXIT=0
✅ 构建与静态安全门禁通过：静态断言 16 组（含对比度/调色板 37 项）、astro check 与 astro build 退出码 0、产物扫描无泄漏。
   （16 = l3_gates 的 15 组 + 本节点新增的「旧站入口已归档」1 组）
$ npm run worker:dryrun                                                          → EXIT=0
$ npx wrangler versions upload --dry-run                                         → EXIT=0
```

> **进程卫生（真实事故，披露）**：切换包落地后第一次复跑 `npm run build` 时报
> `EPERM, Permission denied: …\dist\client`。原因不是代码，而是本节点的 `dev:local` 探针收尾只杀了
> **监听端口**的 wrangler 进程，启动器 `node scripts/local-runtime.mjs …` 仍活着并把 wrangler/workerd
> 重新拉起，持续持有 `dist/client`。修法：按进程树杀掉启动器（`taskkill /PID <launcher> /T /F`）。
> 之后同一棵树复跑 `npm run build` → **EXIT=0**。日志：`.wrangler/probe-tmp/l4-build-tip.log`。
> 教训与 `docs/build-gates.md` 的「dist 争用」一条一致：跑门禁前先确认 88xx/89xx 无 dev server；
> 若报 EPERM 且路径含 `dist`，先找**启动器**（不只是端口占用者）。

---

## 6. 回滚

### 6.1 部署面（Worker）

```bash
npx wrangler deployments list        # 找到上一个 Deployment / Version ID
npx wrangler rollback <VERSION_ID>   # 官方语义：用该版本立即创建一个新部署（默认回退到上一版本）
npx wrangler versions deploy <VERSION_ID>@100% -y   # 等价的显式写法（渐进部署 API）
```

> 官方文档（context7 核对）：`wrangler rollback [<VERSION_ID>]`「Immediately creates a new deployment using the
> specified version ID across all deployed routes and domains. Defaults to the version uploaded prior to the latest
> version if VERSION_ID is omitted.」

**最强回滚**：把域名/路由切回 Pages 项目 —— 因为 Pages 项目与 `main` 分支在本节点全程未被修改，
切换失败时线上形态可以**原样退回**（这是 §8 M7 要求 Pages 保留的原因）。

### 6.2 代码面

```bash
git checkout main                    # 基线 = 90c182bc31b877ad1d9de16068d7fd2e8fa3c77c（切换前线上形态）
# 或只回滚某一步：git revert <SHA>（提交点见 §10）
git mv legacy/index.html index.html  # 单独回滚 dev 遮蔽处置（会重新遮蔽 astro dev 的 /）
```

### 6.3 回滚触发条件（任一即回滚）

1. 首页 5xx / 白屏，或地图渲染不出来（`window.__mapProbe.read().booted !== true`）；
2. 四个路由任一不符合契约（字段缺失、匿名可读明细、口令校验失效、限流阈值不一致）；
3. 出现 CSP 违规或 inline script 被拦（`script-src 'self'`）；
4. 页面/网络里出现整包学生明细（`students:raw:v1` / `js/data.js` / 姓名学校列表）—— **最高优先级**；
5. `/.dev.vars`、`/js/data.js`、`/js/vendor/echarts.min.js` 任一可请求（非 404）。

---

## 7. 发布后检查项（浏览器侧）

切换后按 `AGENTS.md` 的 14 项人工 smoke 复跑（记录在 `docs/parity-acceptance-l3.md`），并至少确认：

1. 首页 200，`window.__mapProbe.read()` → `booted: true`、`activeMapId: 'cn/china'`、`zoom: 1.25`、`aspectScale: 1`、`scaleLimit.min: 1.25`、`whitelistCount: 31`；控制台 **0 报错**。
2. 渲染页脚本全部外链（3 个 `/_astro/*.js`，0 个内联脚本体），CSP 仍是 `script-src 'self'`。
3. 公开聚合：`GET /api/map/public` 200，响应头含 `Vary: Cookie` 与 `Cache-Control: no-store`；地图色带与人数正常。
4. 口令流程：错误口令 401（`remainingAttempts` 递减）、连续 10 次后 429；正确口令签发 HttpOnly Cookie；
   匿名 `GET /api/map/details` 401；登录后按省返回 `{province,city,count,people}`；`退出查看` 清会话。
5. 悬停省份出卡片、色带同步标记；有数据省份点击下钻、Esc/返回全国；台湾/香港/澳门/南海诸岛不请求省级脚本。
6. 触摸设备：**600ms 长按**仍能下钻（`TapFallback` 路径，非 zrender 的 300ms 补发）。
7. 分享图：全国/省级/空态三种范围文案与文件名正确（`蹭饭地图_<范围>_<日期>.png`，日期取本地时区）。
8. 键盘 passes：焦点环可见；口令弹窗与抽屉打开时背景 `inert`、Esc 关闭且焦点归还。
9. 窄屏（375/414/480px）无横向滚动、控件不重叠。
10. 敏感面：`/.dev.vars`、`/js/data.js`、`/js/vendor/echarts.min.js` 全部 404；`Sources` 里无 `js/data.js`。
11. 自定义域名（如启用）与 `workers.dev` 地址都能打开，且 `curl -I` 的 5 条安全头与静态资产响应**逐条一致**。
12. 观察 24–48h：Workers 指标无 5xx 抬升、`wrangler tail` 无未捕获异常。

---

## 8. 人工步骤清单（交接项，agent 不可代劳）

> cp3（`人工步骤清单待用户确认`，verifier=`human`）就是等这份清单被确认。**agent 不自签。**

| # | 步骤 | 命令 / 位置 | 为什么必须人工 |
|---|---|---|---|
| **M1** | 登录并确认账号权限 | `npx wrangler login` → `npx wrangler whoami` | 凭据在人手上（本环境 token 已过期且非交互） |
| **M2** | **真预览部署 + 验证**（首页 + 四路由） | `npx wrangler versions upload --preview-alias cutover-preview`（或 `npx wrangler deploy` 后先验 workers.dev）→ 按 §7 的 1–4 条核对 | 需要凭据；agent 已做 dry-run 与本地 Worker 等价验证（§5.2/§5.3） |
| **M3** | 绑定两个 Secret | `npx wrangler secret put DETAILS_PASSPHRASE`、`npx wrangler secret put DETAILS_SESSION_SECRET`（`npx wrangler secret list` 核对） | 取值只有人知道，绝不入库 |
| **M4** | 核对 KV 绑定与两个键 | 部署页 bindings 表 / 控制台：`CLASS_MAP_DATA` = `e6c9c4ff…`；`students:raw:v1`、`students:public:v1` 存在且**未被改写** | 生产数据只读核对；agent 不碰生产 KV |
| **M5** | 确认 `--env preview` 实际绑到的 namespace | 见 §4 的 ⚠️；必要时改 `env.preview` 或显式改绑 | 会决定预览读的是哪份数据 |
| **M6** | 生产域名切换 | 在 Cloudflare 控制台把自定义域名/路由从 Pages 项目指到 Worker `class1forever` | 生产配置；不可逆度最高 |
| **M7** | 观察期后下线 Pages 项目 | 控制台删除/停用 Pages 项目（**在确认线上稳定之后**） | 保留期就是回滚后路，不能提前砍 |
| **M8** | 发布后按 §7 全量复跑 + 观察期 | 浏览器逐条 + `npx wrangler tail` | 真实网络与真实数据下的人工确认 |
| **M9** | 若走 Git 集成：把 Worker 的 Git 连接与 production branch 换成 `astro-migration` 合并后的 `main` | 控制台 Workers Builds | 属生产配置；且需要先决定合并策略 |
| **M10** | ADR-0001..0004 的 accept | `docs/adr/00*.md` | ADR 的 accept 是人的裁决（图里四个 ADR 仍是 `proposed`） |

---

## 9. 生产未变更的读数（repo 侧可核）

### 9.1 分支与提交

```text
$ git rev-parse main                      → 90c182bc31b877ad1d9de16068d7fd2e8fa3c77c
$ git rev-parse HEAD                      → 90c182bc31b877ad1d9de16068d7fd2e8fa3c77c  （本节点开工时；切换包自身的提交点见 §10）
$ git rev-parse --abbrev-ref HEAD         → astro-migration
$ git remote -v                           → origin  git@github.com:Calvin-Xia/class1forever.git
```

`main` **未被 push、未被修改**；本节点**未 push 远端**（no push）。

### 9.2 配置面

```text
$ git diff main -- wrangler.jsonc
  只有文件头部一处 hunk：- "pages_build_output_dir": "."  →  + "main"/"compatibility_flags"/"assets"
  kv_namespaces（含 id / preview_id / remote）、vars、env.preview 三块零 diff
```

### 9.3 对照资产零改动

```text
$ git diff main --name-status -- js/ css/ DESIGN.md
D  js/vendor/echarts.min.js          ← 唯一差异，是 ADR-0002 授权的 vendor 退役（l3_gates 已交付，非本节点引入）
（css/** 与 DESIGN.md 无差异；js/china.js、js/province/**、js/palette.js、js/map.js、js/geo.js、js/motion.js 均无差异）

$ git show main:index.html | sha256sum   → babad1aa4606efa62ccdadb1f7f39993692b929336cd60e78252b2286c78feda
$ sha256sum legacy/index.html            → babad1aa4606efa62ccdadb1f7f39993692b929336cd60e78252b2286c78feda   （逐字节相同）
```

### 9.4 生产侧（agent 未执行任何写操作）

- 未 `wrangler pages ...`（任何子命令）、未改 Pages 项目、未改域名/路由、未写 KV 两键、未 `wrangler deploy`；
- 只执行了：`npx wrangler whoami`（只读）、`npm run worker:dryrun`、`npx wrangler versions upload --dry-run`、
  `npx wrangler deploy --dry-run --env preview`（三者都 `--dry-run`，不落盘/不写云端）。

---

## 10. 提交策略与可回滚提交点

### 10.1 入库策略

| 对象 | 策略 | 理由 |
|---|---|---|
| `docs/**`、`legacy/README.md`、`CONTEXT-MAP.md`、`DECISIONS.md` | **提交** | 迁移的契约/门禁/验收/切换包就是交付物 |
| `worker-configuration.d.ts` | **提交**（本节点前已在索引里，本节点确保它随迁移一起落盘） | `l3_gates` P1 + `l3_verify` 复核判据：`git ls-files --cached` 可见、未被 `.gitignore` 匹配、`wrangler types --check` 通过 |
| `.graph/` **设计态**（`graph.yaml`、`nodes/`、`edges/`） | **提交** | 图的计划与执行证据（checkpoint/execution report）随代码留档 |
| `.graph/` **运行时缓存**（`index/`、`**/snapshots/`、`**/.locks/`） | **不提交**（`.gitignore`） | 9.8 MB 的快照与索引缓存是工具运行时状态，`graph` 可重算 |
| `.pi/`（agent 目标池/运行态） | **不提交**（`.gitignore`） | pi 的运行态，不是项目源码 |
| `js/data.js`、`.dev.vars`、`output/`、`.wrangler/`、`dist/` | 不提交（既有 gitignore） | 明细数据与密钥绝不入库 |

### 10.2 提交点（按逻辑分组）

| 提交 | SHA | 内容 | 回滚含义 |
|---|---|---|---|
| C1 | `a2cd64dabf2bd7ab475dac2e9f0a0772a368e3fa` | 迁移主体：Astro/Worker 工程配置、`src/**`、`public/**`、脚本与测试、`build.js` 门禁重写、CI、`.gitignore`、生成类型、旧入口归档（`R100`）、vendor 退役（两处删除） | `git checkout main` 整体退回旧站；单独恢复某件东西：`git checkout main -- js/vendor/echarts.min.js`、`git mv legacy/index.html index.html` |
| C2 | `abc1d2019fb31b60003655da86ed3f0ebf160bff` | 补文档：迁移契约、门禁分层、验收记录、context/ADR、`CONTEXT-MAP.md`、`DECISIONS.md` | 纯文档 |
| C3 | `28dbd546d246d88aed968d52eaf46d63f2c0e75a` | 本切换包 `docs/cutover-runbook.md` | 纯文档 |
| C4 | `0fdcfb845b070b64d42f8acb24630a3f5ca61227` | 文档同步：`AGENTS.md` / `README.md` / `DEPLOYMENT.md` → Worker 口径（F-5） | 纯文档 |
| C5 | `50c99c4b4596917f234396c23734036c1e0deae3` | 迁移图设计态入库 + `.graph/**` 运行时缓存与 `.pi/` 忽略 | `git revert` 不影响部署面 |
| C6 | （本提交）在切换包里回填 C1–C5 的 SHA | 纯文档 |

**绿色保证在分支尖**（C6 后复跑：`npm run build` `EXIT=0`（静态断言 16 组）、`npm run worker:dryrun` `EXIT=0`、
`npm run dev:local` 首页 + 四路由均通）。中间提交按逻辑分组，**不保证逐个单独可构建**：
`main` 的旧 `build.js` 把 `index.html` 与 `js/vendor/echarts.min.js` 列为必需文件，所以这两件事
必须和「新门禁」在同一个提交里落地（这就是 C1 把工程面、归档与 vendor 退役放在一起的原因）。
**回滚点是分支尖与 `main`，不是中间提交。**

> 注：C5 的图设计态提交里 `nodes/l4_cutover.yaml` 是本节点**执行中**的快照（不含最终 execution report），
> 属可接受的记录延迟；图的真相源是工作区的 `.graph/`，不是这份快照。

### 10.3 分支读数

```text
$ git log --oneline main..HEAD
50c99c4 chore: 纳入迁移图的设计态，忽略运行时缓存
0fdcfb8 docs: 同步 AGENTS/README/DEPLOYMENT 到 Worker 口径
28dbd54 docs: 补生产切换包与人工 gate 清单
abc1d20 docs: 补齐迁移契约、构建门禁、验收记录与上下文/ADR
a2cd64d feat: 迁移到 Astro 6 SSR + Cloudflare Worker + Workers Assets

$ git rev-parse --abbrev-ref HEAD   → astro-migration
$ git rev-parse main                → 90c182bc31b877ad1d9de16068d7fd2e8fa3c77c
$ git rev-parse HEAD                → 见 C6（本提交）
$ git rev-list --count main..HEAD   → 6
```

**未 push 远端**（no push）；`main` 未被修改。

---

## 11. 已知风险与未决项

1. **无凭据 → 真预览部署未执行**（§5.1/§8 M1/M2）。这是本节点最大的缺口，已降级为人工步骤。
2. **`--env preview` 可能绑到生产 KV**（§4 ⚠️）：dry-run 实测读数如此。人工部署前必须确认。
3. **`SESSION` / `IMAGES` 绑定由适配器注入**：`SESSION` 无 id，首次部署会**创建**一个 KV namespace（新资源）；
   `IMAGES` 需要账号开通 Images。这两项在 dry-run 里可见但**没有**在 `wrangler.jsonc` 里显式声明。
4. **ADR-0001..0004 仍为 `proposed`**：accept 是人的裁决（M10）。ADR-0002 的产物退役已按设计执行。
5. **P2（smoke 13「台湾」子项）待人类裁定**（`docs/acceptance-l3-verify.md` §5.3）：新旧站事件序列逐字相同，
   判为非迁移回归，但与 `AGENTS.md` smoke 13 的文字期望不符。切换验收时应一并裁定。
6. **`WORKERS_CI` / Git 集成**：本分支未 push，Worker 的 Git 构建连接与 production branch 属人工配置（M9）。
7. **文档口径**：`DEPLOYMENT.md` / `README.md` / `AGENTS.md` 已在本节点同步为 Worker 口径（C5）；
   若还有人从旧文档复制 `wrangler pages ...` 命令，按 §2 的 Worker 口径替换。

---

## 12. 证据索引（真实路径）

| 内容 | 路径 | 是否入库 |
|---|---|---|
| 本切换包 | `docs/cutover-runbook.md` | ✅ |
| 归档说明与回滚命令 | `legacy/README.md` | ✅ |
| 归档的旧入口（与 `main` 逐字节相同） | `legacy/index.html` | ✅ |
| `npm run build` 复跑日志（EXIT=0，16 组） | `.wrangler/probe-tmp/l4-build.log` | ❌（scratch） |
| `npm run worker:dryrun` 日志（EXIT=0） | `.wrangler/probe-tmp/l4-dryrun.log` | ❌ |
| `astro dev` 指纹读数 / 渲染页 | `.wrangler/probe-tmp/l4-astrodev/astro-dev-probe-out.txt` / `astro-dev-index.html` | ❌ |
| `dev:local` 首页+四路由读数 / 渲染页 / 路由 JSON | `.wrangler/probe-tmp/l4-astrodev/devlocal-probe-out.txt` / `devlocal-index.html` / `devlocal-public.json` / `devlocal-details.json` | ❌ |
| `main:index.html` 对照副本（sha256 用） | `.wrangler/probe-tmp/l4-astrodev/main-index.html` | ❌ |
| 上游：构建门禁分层 | `docs/build-gates.md` | ✅ |
| 上游：等价性契约 | `docs/migration-parity.md` | ✅ |
| 上游：l3 等价性验收（14 项 smoke） | `docs/parity-acceptance-l3.md` | ✅ |
| 上游：l3 三层验收 + 交叉复核签署 | `docs/acceptance-l3-verify.md` | ✅ |

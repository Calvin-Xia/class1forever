# 构建与静态安全门禁（l3_gates）

迁移后守门的是**一条命令**：`npm run build` = `node build.js`。它把类型检查、静态安全断言、
对比度/调色板同值断言、`astro build` 与产物扫描串成一条链，退出码非 0 即视为不合格。

```bash
# 完整门禁（静态断言 → astro check → astro build → 产物断言）
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run build

# 只跑静态断言（约 3 秒：含 wrangler types --check 与对比度断言）
node build.js --static-only

# 只跑产物断言（dist/ 必须已构建，诊断或往产物里注入错误时用）
node build.js --artifacts-only

# 运行时门禁：真起一次本地 Worker，对真实 HTTP 响应断言
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run check:runtime

# 真浏览器手势回归（需先 npm run build；首次需 npx playwright install --with-deps chromium）
npm run test:touch

# 全套（构建门禁 + 运行时门禁 + 四路由契约）
npm run check
```

> **`test:touch` 独立于 `npm run check`**：Playwright 的浏览器二进制不进 `npm ci`，所以 CI 在
> `test:api` 之后单独一步 `npx playwright install --with-deps chromium`，再跑 `npm run test:touch`
> （顺序见 `.github/workflows/ci.yml`：build → check:runtime → test:api → install chromium → test:touch
> → check:edgeone → …）。`npm run check` 本地仍只串 `build + check:runtime + test:api`。

> **Windows 沙箱**：`astro build` / `wrangler dev` 会通过 workerd 建临时目录，必须把 `TEMP`/`TMP`
> 指到工作区内（如 `.wrangler/probe-tmp`），否则报 `CreateDirectory: #5 拒绝访问`。这条**不写进
> package.json**，因为它只对本机沙箱成立，CI（Linux）不需要。
>
> **dist 争用**：`astro build` 会清空 `dist/`；若有别的 `dev:local` / `test:api` 正持有 `dist/client`，
> 会以 EPERM 失败。跑门禁前确认 88xx/89xx 端口没有别的实例；失败信息里 build.js 会直接提示这一条。

## 门禁分层与对应的验收要求（l3_gates 的 9 条 DoD）

| 层 | 断言 | 覆盖的 DoD |
| --- | --- | --- |
| A 静态 | 关键文件齐全（**面向新站**：不再把旧站 `index.html` / `js/boot.js` / `functions/**` 当必需；含 `src/platform` 目录；2026-10-17 起把 `tests/map-touch.test.mjs` 也列进必需文件数组）；且**仓库根不得再出现 `index.html`** —— 它会被 Vite 的静态中间件先命中，让 `astro dev` 的 `GET /` 返回旧站页面（`l2_motion` 的 F-2）。旧入口归档在 `legacy/index.html`（与 `main:index.html` 逐字节相同），见 `legacy/README.md` | — |
| A2 静态 | 生成类型 `worker-configuration.d.ts` 必须在位、**不被 `.gitignore`**，且 `wrangler types --check` 通过（与 `wrangler.jsonc` 无漂移） | 新树/CI 可构建 |
| B 静态 | 明细数据与密钥名不得出现在**客户端面**（`src/**`、`public/**`、`js/**` **默认都是客户端面**，只有显式 server-only 名单 —— `src/platform/**`、`src/pages/api/**`、`src/middleware.ts`、`src/lib/{data,api-handlers,auth,http,types,security-headers}.ts`、`js/data.js` —— 除外；编译后的 `dist/client/**` 同理）：`students:raw:v1`、`js/data.js`、`DETAILS_PASSPHRASE`、`DETAILS_SESSION_SECRET` | 2、4 |
| C 静态 | 脚本同源、`.astro` 里没有无 `src` 的 `<script is:inline>`、无 Highcharts 残留 | 1 |
| D 静态 | `src/lib/geo-loader.ts` 的 `AVAILABLE_PROVINCE_FILES` 与 `js/province/*.js` **逐名双向一致**，省级懒加载 glob 未被改，生成文件仍以 `CMapGeo.register(...)` 开头 | 3 |
| E 静态 | `script-src` 不含 `unsafe-inline`（`public/_headers` 与 `src/lib/security-headers.ts` 两处都查） | 1、9 |
| F 静态 | 对比度 + CSS token ↔ 画布调色板同值（`scripts/check-contrast.js`，39 项 = 21 对比度 + 13 同值 + 5 热力单调；同值含 `tokens.seal` ↔ `--color-accent-tertiary` 与 `tokens.highlight` ↔ `--color-highlight`） | 1 |
| G 静态 | 自建 ECharts vendor 链已退役：产物/生成器文件不存在、`package.json` 无 `vendor:build`、CI 无同步步骤、没有任何地方**加载** `js/vendor/echarts.min.js`、`echarts` 依赖在位 | 7 |
| H 静态 | `public/_headers` 与 `src/lib/security-headers.ts` 两处同源声明逐条（含 CSP 逐字）一致，防止静态资产与文档响应漂移 | 6、8 |
| I 静态 | Node 版本门禁：`package.json` 的 `engines.node`、CI 的 `node-version` 与 `astro` / `wrangler` / `@astrojs/react` 的 engines 互相满足；遇到读不懂的 range 直接失败（不静默放过）。CI 的 `node-version` 若解析失败（如改成矩阵表达式）**立即收口退出**，不把 `null` 传进 `satisfies()`；某个依赖的 manifest 缺失时打印 warning（不再静默 `continue`），并提示先 `npm ci` | 5 |
| J | `astro check` 退出码 0 | 1 |
| K | `astro build` 退出码 0（两个 astro 阶段都跑，类型错误不遮蔽产物扫描；任一失败最后统一退出 1） | 1 |
| L 产物 | `dist/client/_headers` 必须包含 `public/_headers` 的全部内容，且额外内容只能是适配器注入的 `/_astro/*` 长缓存规则；`dist/server/wrangler.json` / `entry.mjs` 在位；客户端产物无明细键/密钥名/名单文件/vendor 加载；**任何 `dist/**` 文件里不得出现 `.dev.vars`** 或密钥类取值；服务端产物不得硬编码密钥字面量 | 4、6 |
| M 运行时 | 真起 Worker：渲染页 `<script>` 全部带 `src`（0 个内联脚本）、文档响应与静态资产的 5 条安全头**逐条一致**、`script-src` 无 `unsafe-inline`、`/.dev.vars` / `/js/data.js` / `/js/vendor/echarts.min.js` 都不可请求 | 6、9 |
| N 真浏览器 | `npm run test:touch`（`tests/map-touch.test.mjs`，真 Chromium + CDP 原生触摸事件，11 个用例）：轻点可下钻省份→下钻；长按 ≥300ms / 右键 / 轻点台湾→面板打开且**保持打开**；「地区一览」「查看」「详情」键盘等价；一次手势**恰好一条**激活（`source` 唯一）；加载态在 `#map` 之外且下钻期间可见；触摸后真实鼠标在窗口外必须记 `source='map'`（设备判别回归）；页面脚本伪造 `pointerdown(mouse)` 不得把轻点改写成 `source='map'`（`isTrusted` 收口回归） | 交互 A6/A7/A10 |
| 人工 | 真 Chromium 打开首页，`window.__mapProbe.read().booted === true`（createRoot 挂载的岛屿真的水合了）、3 个外链 chunk 全同源、控制台 0 报错 | 9 |

## 复核修正（2026-10-16，task-3）

1. **B 层的判定方向反过来了**：以前是白名单（列出哪些目录算客户端面），新增一个 `src/` 子目录会静默漏检；
   现在 `src/**` / `public/**` / `js/**` 默认都是客户端面，只有显式 server-only 名单除外，
   并把 `src/platform` 加进 Gate A 的必需文件。
2. **I 层两处不再静默**：CI `node-version` 解析失败立即 `reportFailures()`（以前会把 `null` 交给
   `satisfies()`，抛出的是一段与 CI 无关的 TypeError）；依赖 manifest 缺失改为 warning 并提示 `npm ci`。
3. **F 层 37 → 39 项**：`requiredTokens` 补 `color-bg-secondary`，新增 `tokens.seal` ↔
   `--color-accent-tertiary`、`tokens.highlight` ↔ `--color-highlight` 两条同值断言（11 → 13 对）；
   `readTokens` 的锚点改成真正的 `:root {` 规则，注释里出现 “:root” 字样不再干扰解析。
4. **CI 的 `node --check` 语法扫描容忍目录缺失**：`js/`、`functions/` 等旧站资产迁到 `legacy/` 之后，
   扫描循环按 `[ -d … ]` 跳过而不是让 `find` 报错（否则 legacy 迁移后 CI 会红）。
5. **CI/deploy 工作流加固**：`ci.yml` 加 `permissions: contents: read` 与 `timeout-minutes: 30`；
   `deploy.yml` 超时 30 → 60（六阶段串行切换不该被自身超时截断）；三个官方 Action 钉到 `v4` tag
   当前指向的 commit SHA。

## 旧站入口归档（`l4_cutover` 追加的一条断言）

`l2_motion` 记的 **F-2**：仓库根的 `index.html` 会被 Vite 的静态中间件先命中，`astro dev` 的 `GET /`
返回的是旧站页面，在 astro dev 里「验证首页」会验错对象。切换节点（`l4_cutover`）把旧入口`git mv`
到 `legacy/index.html`（内容零改动，sha256 与 `main:index.html` 相同）；其后（2026-10-16）退役实现
也一并 `git mv` 归档到 `legacy/`（`legacy/js/*`、`legacy/css/main.css`、`legacy/functions/**`），
仓库根只留 `js/china.js`、`js/province/**` 与本地专用的 `js/data.js`（见 `legacy/README.md`）。

Gate A 因此多一条：根 `index.html` 存在 → `npm run build` 失败，并提示
`git mv index.html legacy/index.html`；`legacy/index.html` 不在位只给 warning（允许有意删掉归档）。
静态断言组数因此从 **15** 变为 **16**；完整读数与两处通路的实测指纹见 `docs/cutover-runbook.md` §5.4。

## 真浏览器手势门禁（2026-10-17 新增）

`tests/map-touch.test.mjs` 用真 Chromium 驱动页面：轻点用 `page.touchscreen.tap`，长按用 CDP
`Input.dispatchTouchEvent`（touchStart → **真等 600ms** → touchEnd）。它固化的是只有真浏览器才会出现的
时序：`touchend` 之后 zrender 与 Chromium 都可能补发 click，一次触摸很容易被记成两条激活，或让迟到的
click 打在刚盖上的遮罩上把面板关掉（该缺陷已复发两次；2026-10-13 曾以「旧站等价行为」被接受，
2026-10-17 用户授权推翻并修复，见 `docs/parity-touch-compare.md`）。

- 本地顺序：`npm run build` → `npx playwright install --with-deps chromium`（只需一次）→
  `npm run test:touch`。启动形态与 `test:api` 相同（自己起 `wrangler dev`，`--state-dir` 隔离在
  `.wrangler/local/state-touch`，演示口令 `demo`，不读 `.dev.vars`）。
- CI 顺序：`build` → `check:runtime` → `test:api` → 单独装 Chromium → `test:touch` → 其余 EdgeOne /
  同源会话 / 双部署门禁（见 `.github/workflows/ci.yml`）。`build.js` 的必需文件数组已包含本测试文件。
- 现有 **11 个用例**（T14 当时为 `tests 10 / pass 10`；T17 新增第 11 条后 T18 全绿 `tests 11 / pass 11`；锚点
  `tests/map-touch.test.mjs`，SHA256 `87E288DE…`、1123 行）：桌面左键下钻、右键开面板并保持、触摸轻点恰好
  一条激活、长按开面板并保持、轻点台湾开面板并保持、地区一览「查看」/「详情」键盘等价、桌面与触摸最终状态
  一致，T14 的两条回归——**加载态可见性**（`#map-loading` 在 DOM、`aria-hidden`、下钻期间 `display:flex` 且
  文案正确、结束后 `none`，`tests/map-touch.test.mjs:900-948`）与**设备判别**（触摸后真实鼠标左键：click 到
  图表必须按设备放行、没到图表必须 0 激活；窗口外 ≥900ms 必须记 `source='map'`，
  `tests/map-touch.test.mjs:950-1050`）——以及 T17 的**伪造 pointerdown 收口**
  （`tests/map-touch.test.mjs:1057-1122`）：页面脚本伪造 `pointerdown(pointerType='mouse')` 后轻点台湾，
  必须仍恰好一条 `source='touch-tap'`、不产生第二条激活、面板保持打开；**反向验证**：去掉
  `handlePointerDown` 里的 `isTrusted` 判定后该用例复红（报 `实际 map`）。
- 断言失败时会打印手势轨迹（`touchstart` / `touchend`、浏览器补发 click 的 target、`map:drill-start`、
  `map:view-change`、`__mapProbe.read().activations`），用来区分「测试脚本问题」与「实现回归」。
- 触摸后约 700ms 内鼠标左键不响应**不是本门禁或让位守卫引入的**：是 zrender 自身的 `touching` 闸门
  （`zrender/lib/core/env.js:69-71` + `HandlerProxy.js:38-48` / `:197-210`，旧站同版本 zrender 6.1.0 相同），
  边界与源码证据见 `docs/parity-touch-compare.md` 的「2026-10-17 二次修订」。
- 完整门禁当前打印「静态断言 18 组」（T5/T14 实测：静态 13 + `astro check`/`astro build` 2 + `dist/client`
  字体 1 + 产物 2），以 `build.js` 实际输出为准；`--static-only` 下是 13 组。

## 生成类型（`worker-configuration.d.ts`）为什么是门禁的一部分

`worker-configuration.d.ts` 是 `npm run cf:types`（= `wrangler types`）的产物：`Env` 的绑定类型
（`CLASS_MAP_DATA: KVNamespace`、`ASSETS: Fetcher`、两个 `DETAILS_*`）与
`declare module 'cloudflare:workers'` 都在它里面，而 `src/pages/api/**` 的三个路由都
`import { env } from 'cloudflare:workers'`。它同时是 `tsconfig.json` 的 `include` 项。

**口径（依据 Cloudflare Workers 官方 TypeScript 文档，经 context7 核对）：提交生成类型进仓库，
并在 CI 里用 `wrangler types --check` 验证它没过时**（官方示例就是 `npx wrangler types --check`
→ `npm run build` → `npm test`；`--check` 在类型过期时以退出码 1 结束）。本仓库因此:

- 把该文件**提交进仓库**（它没被 `.gitignore`）；
- 在 `node build.js` 的静态段加入三项拦截：文件不存在（给可操作提示）、被 `.gitignore` 吞掉、
  与 `wrangler.jsonc` 漂移（`wrangler types --check`，约 1.3s）；
- 保留“改了 `wrangler.jsonc` 的绑定/兼容性开关后重跑 `npm run cf:types`”的提醒（`tsconfig.json`
  的 include 注释与 `package.json` 的 `//` 说明里都有）。

反例（执行报告里有完整读数）：删掉该文件 → `npm run build` 在 Gate A2 失败（同时 `astro check`
会报 ts(2307)）；把它写进 `.gitignore` → 失败；给 `wrangler.jsonc` 加一个 var 而不同步重跑 →
`wrangler types --check` 失败。

## 两个「构建期副产物」的处理

1. **`dist/server/.dev.vars`**：`astro build` 里 wrangler 的打包步骤会把仓库根的 `.dev.vars`
   拷进 outdir（构建日志里的 `Using secrets defined in .dev.vars` 就是它）。门禁**只认这一种
   可预期的复制件**并在产物扫描前就地删除（打印一行 `🧹`/`⚠️` 说明）；除此之外任何
   `dist/**/.dev.vars*` 一律判失败。运行时门禁另外证明 `/.dev.vars` 返回 404。
   影响面：`npm run dev:local` / `test:api` 用自己派生的本地配置（显式注入演示口令），
   不依赖这个副本，所以删掉不影响任何本地通路。
2. **`dist/client/_headers`**：适配器会往 `_headers` 前面插一段 `/_astro/*` 的
   `Cache-Control: public, max-age=31536000, immutable`。门禁按「public 内容原样包含 + 额外内容
   只能是这一段」判定，而不是要求逐字节相同。

## 反例验证（门禁有效性）

`l3_gates` 的执行报告里记了 **19 个注入反例**（14 个静态 + 5 个产物），做法都是
「注入 → 断言 `node build.js` 以退出码 1 失败且命中的是**预期的**那条断言 → 按 sha256 校验还原」：

- 静态：页面 import `js/data.js`、客户端模块提到 `students:raw:v1` / `DETAILS_SESSION_SECRET`、
  白名单少一个省、`<script is:inline>`、两处 CSP 加 `unsafe-inline`、两处 `Referrer-Policy` 漂移、
  放回 vendor 产物/生成器、组件重新加载 vendor 路径、engines 抬到 `>=99`、CI node 降回 20、
  重新引入 Highcharts、把 `--color-text-muted` 调浅。
- 产物：客户端 chunk 里塞明细键 / 密钥名 / vendor 加载路径、服务端 bundle 里写死密钥取值、
  `dist/client/.dev.vars`。

## 与 ADR 的关系

> 状态更新（2026-10-13）：ADR-0001..0004 已由用户 **accept**（`docs/adr/00*.md` 的 `**Status：**`
> 已从 `proposed` 改为 `accepted`）。本节下文提到的两个 ADR 均为已 accept 的生效决策。

- **ADR-0002（已 accept，2026-10-13）**：本节点按该 ADR 的设计执行了 vendor 退役（删除
  `js/vendor/echarts.min.js` 与 `scripts/build-vendor.mjs`、移除 `package.json` 的 `vendor:build`、
  删掉 CI 的同步步骤）。ADR 已由用户 accept（`docs/adr/0002-*.md` 的 Status 已为 accepted），
  本文件的门禁 G 就是它落地后的防线。
  保留 `scripts/vendor/echarts-entry.mjs` 作为「模块集参考」：`src/lib/echarts.ts` 的注释以它为准
  （该文件在 l3_gates 的边界外，删掉会造成注释即刻失真）。
- **ADR-0004（已 accept，2026-10-13）**：门禁在源码层（`.astro` 无 `is:inline`）+ 运行时层（渲染页 0 内联脚本、
  CSP 无 `unsafe-inline`）+ 浏览器层（`window.__mapProbe` 已定义）三处守它。

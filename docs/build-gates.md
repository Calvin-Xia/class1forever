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

# 全套（构建门禁 + 运行时门禁 + 四路由契约）
npm run check
```

> **Windows 沙箱**：`astro build` / `wrangler dev` 会通过 workerd 建临时目录，必须把 `TEMP`/`TMP`
> 指到工作区内（如 `.wrangler/probe-tmp`），否则报 `CreateDirectory: #5 拒绝访问`。这条**不写进
> package.json**，因为它只对本机沙箱成立，CI（Linux）不需要。
>
> **dist 争用**：`astro build` 会清空 `dist/`；若有别的 `dev:local` / `test:api` 正持有 `dist/client`，
> 会以 EPERM 失败。跑门禁前确认 88xx/89xx 端口没有别的实例；失败信息里 build.js 会直接提示这一条。

## 门禁分层与对应的验收要求（l3_gates 的 9 条 DoD）

| 层 | 断言 | 覆盖的 DoD |
| --- | --- | --- |
| A 静态 | 关键文件齐全（**面向新站**：不再把旧站 `index.html` / `js/boot.js` / `functions/**` 当必需）；且**仓库根不得再出现 `index.html`** —— 它会被 Vite 的静态中间件先命中，让 `astro dev` 的 `GET /` 返回旧站页面（`l2_motion` 的 F-2）。旧入口归档在 `legacy/index.html`（与 `main:index.html` 逐字节相同），见 `legacy/README.md` | — |
| A2 静态 | 生成类型 `worker-configuration.d.ts` 必须在位、**不被 `.gitignore`**，且 `wrangler types --check` 通过（与 `wrangler.jsonc` 无漂移） | 新树/CI 可构建 |
| B 静态 | 明细数据与密钥名不得出现在**客户端面**（`src/components|scripts|layouts|styles|pages|lib`、`public/`、`js/`，以及编译后的 `dist/client/**`）：`students:raw:v1`、`js/data.js`、`DETAILS_PASSPHRASE`、`DETAILS_SESSION_SECRET` | 2、4 |
| C 静态 | 脚本同源、`.astro` 里没有无 `src` 的 `<script is:inline>`、无 Highcharts 残留 | 1 |
| D 静态 | `src/lib/geo-loader.ts` 的 `AVAILABLE_PROVINCE_FILES` 与 `js/province/*.js` **逐名双向一致**，省级懒加载 glob 未被改，生成文件仍以 `CMapGeo.register(...)` 开头 | 3 |
| E 静态 | `script-src` 不含 `unsafe-inline`（`public/_headers` 与 `src/lib/security-headers.ts` 两处都查） | 1、9 |
| F 静态 | 对比度 + CSS token ↔ 画布调色板同值（`scripts/check-contrast.js`，37 项） | 1 |
| G 静态 | 自建 ECharts vendor 链已退役：产物/生成器文件不存在、`package.json` 无 `vendor:build`、CI 无同步步骤、没有任何地方**加载** `js/vendor/echarts.min.js`、`echarts` 依赖在位 | 7 |
| H 静态 | `public/_headers` 与 `src/lib/security-headers.ts` 两处同源声明逐条（含 CSP 逐字）一致，防止静态资产与文档响应漂移 | 6、8 |
| I 静态 | Node 版本门禁：`package.json` 的 `engines.node`、CI 的 `node-version` 与 `astro` / `wrangler` / `@astrojs/react` 的 engines 互相满足；遇到读不懂的 range 直接失败（不静默放过） | 5 |
| J | `astro check` 退出码 0 | 1 |
| K | `astro build` 退出码 0（两个 astro 阶段都跑，类型错误不遮蔽产物扫描；任一失败最后统一退出 1） | 1 |
| L 产物 | `dist/client/_headers` 必须包含 `public/_headers` 的全部内容，且额外内容只能是适配器注入的 `/_astro/*` 长缓存规则；`dist/server/wrangler.json` / `entry.mjs` 在位；客户端产物无明细键/密钥名/名单文件/vendor 加载；**任何 `dist/**` 文件里不得出现 `.dev.vars`** 或密钥类取值；服务端产物不得硬编码密钥字面量 | 4、6 |
| M 运行时 | 真起 Worker：渲染页 `<script>` 全部带 `src`（0 个内联脚本）、文档响应与静态资产的 5 条安全头**逐条一致**、`script-src` 无 `unsafe-inline`、`/.dev.vars` / `/js/data.js` / `/js/vendor/echarts.min.js` 都不可请求 | 6、9 |
| 人工 | 真 Chromium 打开首页，`window.__mapProbe.read().booted === true`（createRoot 挂载的岛屿真的水合了）、3 个外链 chunk 全同源、控制台 0 报错 | 9 |

## 旧站入口归档（`l4_cutover` 追加的一条断言）

`l2_motion` 记的 **F-2**：仓库根的 `index.html` 会被 Vite 的静态中间件先命中，`astro dev` 的 `GET /`
返回的是旧站页面，在 astro dev 里「验证首页」会验错对象。切换节点（`l4_cutover`）把旧入口`git mv`
到 `legacy/index.html`（内容零改动，sha256 与 `main:index.html` 相同），`js/**` / `css/**` /
`functions/**` 原地不动。

Gate A 因此多一条：根 `index.html` 存在 → `npm run build` 失败，并提示
`git mv index.html legacy/index.html`；`legacy/index.html` 不在位只给 warning（允许有意删掉归档）。
静态断言组数因此从 **15** 变为 **16**；完整读数与两处通路的实测指纹见 `docs/cutover-runbook.md` §5.4。

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

- **ADR-0002（proposed）**：本节点按该 ADR 的设计执行了 vendor 退役（删除
  `js/vendor/echarts.min.js` 与 `scripts/build-vendor.mjs`、移除 `package.json` 的 `vendor:build`、
  删掉 CI 的同步步骤）。ADR 本身仍是 `proposed`，**accept 是人类的事**。
  保留 `scripts/vendor/echarts-entry.mjs` 作为「模块集参考」：`src/lib/echarts.ts` 的注释以它为准
  （该文件在 l3_gates 的边界外，删掉会造成注释即刻失真）。
- **ADR-0004（proposed）**：门禁在源码层（`.astro` 无 `is:inline`）+ 运行时层（渲染页 0 内联脚本、
  CSP 无 `unsafe-inline`）+ 浏览器层（`window.__mapProbe` 已定义）三处守它。

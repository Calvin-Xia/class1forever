# class1forever

班级同学分布地图。公开页面只展示省市聚合统计；姓名和学校信息在口令验证后按地区读取。生产使用 Cloudflare Worker + KV 与 EdgeOne Makers + 私有 KV，通过华为云地域 DNS 共用 `map.calvin-xia.cn`。

双平台命令：`npm run check:dual`、`npm run build:edgeone`、`npm run dev:edgeone:fixture`。状态、上线确认与回滚见 [双平台实施操作包](docs/dual-deployment-runbook.md)，数据工具见 [数据发布操作包](docs/data-release-runbook.md)。

最新线上状态见 [正式分流验收](docs/production-readiness-20261015.md)。推送 main 自动串行发布 CF Worker 与 EO 正式项目，保留数据、密钥和 DNS，并协调新旧公开脚本；见 [CI 发布协议](docs/ci-deployment.md)。`npm run dev:same-host:fixture`、[GeoDNS 预检](docs/geodns-preflight.md) 与 [完整字体分片](docs/font-subsets.md) 提供本地验证路径。

Forked from [lvris/map](https://github.com/lvris/map)

## 访问地址

- 当前 Cloudflare Worker：[蹭饭地图](https://class1forever.calvin-xia.workers.dev/)
- 正式地址：[map.calvin-xia.cn](https://map.calvin-xia.cn/)，华为云中国大陆线路 → EO，全网默认 → CF。两端 TLS/正式 API 已验收，部分 ECS 选路与长期续期仍待观察。
- 原 `class1forever.calvin-xia.cn` 已有 CNAME，保留不改；国家 302 与独立 cn/global 为备选/回滚，未因文档调整自动启用。

已合并的迁移将部署面改成 **Cloudflare Worker + Workers Assets**。原 Pages 资源保留，本次双平台域名切换由用户确认后执行；历史迁移
命令、密钥、KV 核对、回滚与人工步骤见 `docs/cutover-runbook.md`。

## 当前架构

项目已经从“静态打包整份学生数据”的方式切换到 Cloudflare Worker + KV：

- 公开页面只请求 `/api/map/public`，只返回省市聚合统计。
- 完整学生数据只保存在 Cloudflare KV 绑定 `CLASS_MAP_DATA` 中。
- 输入口令后，前端通过 `/api/auth/details` 建立登录状态。
- 建立登录状态后，前端再按地区请求 `/api/map/details`，只拿当前地区的姓名和学校信息。
- `js/data.js` 只作为本地上传脚本的数据来源，不再被网页直接加载。

这样做的目的，是避免把完整学生名单作为静态资源直接发给所有访问者。

## 前端地图

地图用 Apache ECharts 渲染，几何数据、渲染库、页面逻辑三者是分开的：

- `legacy/js/geo.js`（迁移前实现，仅对照）只提供 `CMapGeo` 注册表，不依赖任何图表库；新站的对应层是 `src/lib/geo-loader.ts`。
- `js/china.js` 与 `js/province/*.js` 是导出好的 GeoJSON，只调用 `CMapGeo.register(...)`。
- `legacy/js/map.js` 把需要的条目交给 ECharts，负责上色、下钻、悬浮卡片、缩放限制与分享图（已迁移到 `src/lib/**` + `src/scripts/**`）。
- `src/styles/palette.ts` 是画布调色板（迁移前的 `legacy/js/palette.js` 只作对照）：新站的地图与分享图
  可以正常 `import`，canvas 上的颜色与字体都从这里取，页面侧同值变量在 `src/styles/main.css` 的 `:root`。
- `legacy/js/motion.js`（现役对应 `src/scripts/motion.ts`）只做光标墨晕、按钮磁吸、卡片聚光三件事，纯原生、无依赖，
  在 `prefers-reduced-motion` 或没有精确指针的设备上完全不注册监听。

渲染库不走 CDN：ECharts 是 npm 依赖（`echarts`），由 Vite 打进 `/_astro/*` 的同源 chunk，
页面因此仍然可以完全离线用，`_headers` 里的 CSP 也保持 `script-src 'self'`。
迁移前提交在仓库里的按需产物 `js/vendor/echarts.min.js` 与它的生成脚本已按 ADR-0002 退役删除。

## 仓库结构

- `legacy/index.html`: 迁移前的旧入口，**已归档**（根目录不再有 `index.html`，否则会遮蔽 `astro dev` 的 `/`）；新站对应 `src/pages/index.astro`。
- `legacy/js/boot.js`: 按顺序加载渲染库、几何数据与页面脚本，失败时给出重试入口。
- `legacy/js/geo.js`: 地图几何数据注册表，以及可下钻省份白名单（门禁实际读 `src/lib/geo-loader.ts` 的同名白名单）。
- `js/china.js`, `js/province/*.js`: 全国与各省 GeoJSON。
- `legacy/js/map.js`: 地图渲染、公开数据、详情查看交互、分享图。
- `legacy/js/palette.js`: 地图与分享图共用的调色板与 canvas 字体（迁移前实现，仅对照；现役是 `src/styles/palette.ts`）。
- `legacy/js/motion.js`: L2 动效层（光标墨晕、磁吸、聚光），无第三方依赖。
- `favicon.svg`: 站点图标 —— 纸面 + 方环 + 罗盘玫瑰（北点朱砂）。**刻意不含地图几何**，原因见下方「已知限制」。
- `legacy/css/main.css`: 页面样式、地图控件、悬浮卡片、移动端样式（迁移前实现，仅对照；现役是 `src/styles/main.css`）。
- `legacy/functions/`: 迁移前的 Pages Functions 接口（等价性对照；本分支跑的是 `src/pages/api/**`）。
- `shared/data-model.mjs`: 数据规范化、公开聚合统计生成逻辑。
- `scripts/upload-kv-data.mjs`: 将本地数据写入 Cloudflare KV。
- `scripts/check-contrast.js`: 关键配色的对比度断言，以及 `src/styles/main.css` 与 `src/styles/palette.ts` 的同值校验（不再读迁移前的 `legacy/css/main.css` / `legacy/js/palette.js`）。
- `scripts/local-runtime.mjs`: 本地运行通路（不需要 Cloudflare 凭据）：从构建产物派生本地 Worker 配置、把夹具数据写进本地 KV、起 `wrangler dev`。
- `tests/api-contract.test.mjs`: 四个 API 路由的成功/失败态契约断言（`npm run test:api`）。
- `tests/dev-server.mjs`: 迁移前的本地假 API 服务器，**已退役**，不再是可执行主路径（保留仅为对照）。它按路径加载 `legacy/js/geo.js`（几何数据 `js/china.js`、`js/province/**` 仍在仓库根），CI 只对它做 `node --check`。
- `astro.config.mjs`, `tsconfig.json`, `worker-configuration.d.ts`: Astro 6 SSR 工程配置、TypeScript 严格预设，以及 `wrangler types` 生成的绑定类型。
- `src/`: 新站源码（`pages/` 路由、`components/`、`layouts/`、`lib/`、`styles/`）；`pages/api/**` 是四个接口路由。
- `legacy/`（`index.html`、`js/`、`css/`、`functions/`）: 迁移前的 Pages 实现，**已整体归档**（只有 `js/china.js`、`js/province/**` 与本地未入库的 `js/data.js` 留在仓库根），不再是本分支的运行/部署主路径；见 `legacy/README.md`。
- `DESIGN.md`: 视觉设计规范（纸本图志），改样式前先读它。
- `wrangler.jsonc`: Cloudflare Worker + Workers Assets / KV 绑定配置（`main` 指向适配器入口，静态资源走 `ASSETS` 绑定）。
- `.dev.vars.example`: 本地开发需要的 secret 模板。
- `DEPLOYMENT.md`: 更完整的部署与排障说明。

## 常用命令

- `npm install`
  安装依赖。首次接手项目时先执行一次。

- `npx wrangler login`
  登录 Cloudflare 账号。上传 KV、往 Worker 写 secret（`npx wrangler secret put <KEY>`）之前需要先完成。

- `npm run build`
  唯一入口：`node build.js`，依次跑静态安全断言（明细数据与密钥名不进客户端面、脚本同源无内联、
  `script-src` 无 `unsafe-inline`、`public/_headers` 与 `src/lib/security-headers.ts` 防漂移、
  省份白名单与 `js/province/` 一致、Node engines 匹配、对比度/调色板同值），再跑
  `wrangler types --check`、`astro check`、`astro build` 与产物扫描，产出 `dist/`。

- `npm run astro:check`
  Astro + TypeScript 类型检查（包含 `src/**` 与生成类型）。

- `npm run dev:local`
  **不需要 Cloudflare 凭据的完整通路**（推荐）：从 `dist/` 派生一份本地 Worker 配置，
  把夹具数据写进本地 KV（`students:public:v1` / `students:raw:v1`），再起 `wrangler dev`：
  http://127.0.0.1:8788。演示口令是 `demo`。**需要先 `npm run build`**。
  参数：`--port 9000`、`--reset`（先清空本地 KV）、`--public-file <路径>`、`--raw-file <路径>`。

- `npm run seed:local`
  只把夹具数据写进本地 KV，不起服务（配合 `astro dev` 或 `npm run cf:dev` 用）。

- `npm run test:api`
  四个 API 路由的成功/失败态契约断言（`node --test`），自己起本地 Worker、
  自己写本地 KV，不读 `.dev.vars`、不需要 Cloudflare 凭据。**需要先 `npm run build`**。

- `npm run dev`
  `astro dev`：Astro 开发服务器，绑定走本地模拟，KV 是本地空数据；口令等 secret 来自 `.dev.vars`。
  旧入口已归档到 `legacy/index.html`，所以它渲染的是**新站**。

- `npm run cf:dev`
  `wrangler dev`：Worker 运行时，读 `wrangler.jsonc` 里 KV 的 `remote: true`，因此会连
  Cloudflare 上的远端 KV，需要先 `npx wrangler login`。

- `npm run check:runtime`
  真起一次本地 Worker（不需要凭据）：断言渲染页没有内联脚本、文档响应与静态资产的安全头逐条一致、
  `/.dev.vars` / `/js/data.js` / `js/vendor/echarts.min.js` 都不可请求。

- `npm run cf:types`
  重新生成 `worker-configuration.d.ts`（`wrangler types`）。改了 `wrangler.jsonc` 的绑定后必须重跑；
  `npm run build` 里已经包含 `wrangler types --check` 防漂移。

- `npm run data:upload -- --dry-run`
  检查当前数据源是否能正确生成 KV 需要的两份数据。

- `npm run data:upload -- --release-id <id>`
  以版本化键上传生产数据（`students_raw_<id>` / `students_public_<id>`）。**生产数据更新必须走 release**：
  或者用 `scripts/data-release.mjs`（prepare / verify / verify-readback），或者给上传脚本加 `--release-id`。

- `npm run data:upload`
  不带 `--release-id` 时只写固定键 `students:raw:v1` / `students:public:v1`，脚本会打印警告；
  线上若已启用 `DATA_RELEASE_ID`，这两个固定键不会被读取。

- `npm run data:upload:preview -- --release-id <id>`
  上传预览环境数据到 Cloudflare KV（同样建议带 `--release-id`）。

### 用真实聚合数据调试前端

公开数据只有人数，可以安全导出，用来看真实数字下的渲染效果：

```bash
npx wrangler kv key get students_public_<DATA_RELEASE_ID> \
  --namespace-id=<wrangler.jsonc 里的 preview_id> --remote --text > public.json
# 线上未启用 DATA_RELEASE_ID 时才读固定键 students:public:v1
STUDENTS_PUBLIC_FILE=public.json npm run dev:local
```

`students_raw_<id>`（未启用 `DATA_RELEASE_ID` 时是 `students:raw:v1`）含姓名与学校，不要导出、也不要提交；如果确实需要本地验证详情面板，
只在本地用 `STUDENTS_RAW_FILE=<本地文件> npm run dev:local`，文件不要入库。


## 首次接手项目

推荐按下面顺序完成初始化：

1. 执行 `npm install`。
2. 执行 `npx wrangler login`，确认 Cloudflare 账号可用。
3. 复制 `.dev.vars.example` 为 `.dev.vars`，填入本地调试所需的 secret。
4. 检查 `wrangler.jsonc` 中的 `CLASS_MAP_DATA` 绑定、`preview_id`、`remote: true` 是否仍然指向正确环境。
5. 执行 `npm run data:upload -- --dry-run` 检查本地数据。
6. 执行 `npm run data:upload:preview -- --release-id <id>`，先把预览环境数据上传到 KV（生产更新必须带 release ID，见「常用命令」）。
7. 执行 `npm run build`，再执行 `npm run dev:local` 起本地站（演示口令 `demo`，不需要 Cloudflare 账号）。
   要连远端预览 KV 时才用 `npm run cf:dev`（需先 `npx wrangler login`）。

## 本地开发

### 1. 准备本地变量

复制 `.dev.vars.example` 为 `.dev.vars`，填入本地开发所需值：

```bash
DETAILS_PASSPHRASE=你的口令
DETAILS_SESSION_SECRET=一段足够长的随机字符串
DETAILS_HINT=前端显示的提示语，可选
```

`.dev.vars` 已在 `.gitignore` 中忽略，不会提交到仓库。

### 2. 准备数据

上传脚本支持两种数据来源：

- 环境变量 `STUDENTS_DATA`
- 本地未提交的 `js/data.js`

如果本地保留了 `js/data.js`，它只会被上传脚本读取，不会被网页直接访问。

### 3. 上传测试数据

先检查：

```bash
npm run data:upload -- --dry-run
```

再上传到 Cloudflare KV（**生产更新必须带 `--release-id`**）：

```bash
npm run data:upload -- --release-id <id>
```

不带 `--release-id` 的 `npm run data:upload` 只写固定键 `students:raw:v1` / `students:public:v1`，
脚本会打印警告；线上若已启用 `DATA_RELEASE_ID`，固定键不会被读取。

如果你希望本地开发优先读取预览环境 KV，则执行：

```bash
npm run data:upload:preview -- --release-id <id>
```

### 4. 启动本地开发服务

**推荐：不需要 Cloudflare 账号的完整通路**（带 `/api/*`、本地 KV 与演示口令）：

```bash
npm run build      # 先产出 dist/
npm run dev:local  # http://127.0.0.1:8788，演示口令 demo
```

它会把夹具数据写进本地 KV（`.wrangler/local/state`），并派生一份本地 Worker 配置，
因此不会碰到 `.dev.vars` 里的真实密钥，也不会连任何线上资源。想在真实聚合数字下调试，
用 `STUDENTS_PUBLIC_FILE=public.json npm run dev:local`（见上一节）。

> Windows 沙箱提示：workerd 需要往临时目录写文件。如果 `npm run build` / `npm run dev:local` /
> `npm run test:api` 报 `CreateDirectory #5 拒绝访问`（或 workerd 起不来），把 `TEMP` 和 `TMP`
> 指向工作区内的目录再执行即可，例如：
> `TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run test:api`。

> 同源 POST 必须带 `Origin` 头（Astro 默认开启 `security.checkOrigin`，挡住跨站表单提交）。
> 浏览器对每个 POST（含同源）会自动带上，不用管；用 `curl` / Node 脚本联调时请手动加
> `-H "Origin: http://127.0.0.1:8788"`，否则会收到 403 `Cross-site POST form submissions are forbidden`。

需要验证远端预览 KV 与真实口令时，再改用（必须先 `npx wrangler login`）：

```bash
TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run cf:dev   # TEMP/TMP 仅本机 Windows 沙箱需要
```

当前 `wrangler.jsonc` 已为 `CLASS_MAP_DATA` 配置 `remote: true` 和 `preview_id`。因此 `cf:dev`
会直接读 Cloudflare 上的远端 KV；而 `dev:local` / `astro dev` 读的是本地模拟 KV。

如果本地打开后看到“地图公开数据尚未配置”，通常说明预览环境 KV 里还没有对应键：未启用 `DATA_RELEASE_ID` 时是 `students:public:v1`，启用后是 `students_public_<id>`。先执行一次 `npm run data:upload:preview -- --release-id <id>`（或线上实际使用的发布配置）再重试。

## 部署方式

### 部署（Worker 口径）

本分支的部署面是 **Cloudflare Worker + Workers Assets**，不再使用 `wrangler pages deploy`：

```bash
npx wrangler login
npx wrangler secret put DETAILS_PASSPHRASE
npx wrangler secret put DETAILS_SESSION_SECRET
npm run build
npx wrangler deploy            # 部署 Worker + Assets；也可先 npx wrangler versions upload 预览
```

KV 绑定沿用 `CLASS_MAP_DATA` 的同一个 `id` / `preview_id`，两个数据键不需要重传；
**Pages 项目保留到人工确认后再下线**。完整的切换包（密钥清单、KV 核对、回滚、发布后检查项、
人工步骤 M1–M10）见 `docs/cutover-runbook.md`。

上方命令保留为早期单 Worker 迁移参考；当前双端生产更新使用 [main 协调发布](docs/ci-deployment.md)，不要用裸 `wrangler deploy` 覆盖已上线的路由/激活配置。

## 推送前检查

建议在提交前确认以下几点：

1. `.dev.vars` 没有被加入暂存区。
2. `js/data.js` 没有被加入暂存区。
3. `npm run build` 能正常通过（含 `astro build`）。
4. `npm run test:api` 能正常通过。
5. `npm run check:runtime` 能正常通过。
5. 本地页面可以正常显示公开地图。
6. 输入正确口令后，可以查看某个地区的同学信息。
7. 浏览器 `Network` 与 `Sources` 中不存在 `js/data.js` 或整包学生名单。

`npm run dev:local` 起来之后，可以照着下面这份清单手动过一遍：

1. 地图正常渲染，底部色带显示「0 人 ~ 当前最大值」。
2. 鼠标悬停省份时出现卡片，色带上同步标出对应人数。
3. 单击有数据的省份下钻，左上角出现「返回全国」，按 Esc 或点它都能回到全国视图。
4. 台湾、香港、澳门、南海诸岛没有省级地图，点击时直接弹出人数面板，控制台不应出现 404。
5. 滚轮或按钮放大地图后拖动，地图不会被拖出可视区域；缩放不会小于铺满视图。
6. 点击「同学信息」输入错误口令会被拒绝，输入正确口令后可以查看地区明细。
7. 点「退出查看」后回到未登录状态，缓存的明细被清空。
8. 分享按钮能生成 PNG，图片里包含地图、色带图例和统计数字。
9. 用窄屏或手机访问，控件不重叠、页面不出现横向滚动。
10. 只用键盘走一遍：Tab 时每个按钮都有可见焦点环；口令弹窗打开后 Tab 不会跑到背景控件，Esc 关闭后焦点回到「同学信息」；底部面板关闭后焦点回到地图。宽屏（≥768px）下面板是居中的 560px 抽屉。
11. 展开「地区一览」，用 Tab 走到某行的「查看」按钮并回车，效果应和在地图上点该地区一致；切换排序后 `aria-sort` 应跟着换列。
12. 系统开启"降低动效"后刷新：地图换色与下钻不应再有缓动，标题也不再逐字落墨。


## 注意事项

- 本项目数据仅供内部使用，请勿外传。
- 如果历史提交里出现过 `js/data.js` 或其他敏感文件，建议额外清理 Git 历史。
- 更完整的 Cloudflare 配置、部署与排障说明见 `DEPLOYMENT.md`。

### 无障碍与已知限制

地图本身是一个 `role="img"` 的 canvas，省份和城市无法被聚焦，所以**点地图这件事没有键盘路径**。
为此页面上加了一块「地区一览」折叠表：它把当前视野里的地区按人数或名称排好，每行一个按钮，
走的是和地图点击完全相同的 `activateRegion()`，因此键盘和读屏用户能拿到同样的结果。

已经做到的：工具条按钮有可见焦点环、`#details-btn` 用 `aria-pressed` 暴露切换状态；打开底部
面板或口令弹窗时背景 `inert`、Esc 可关闭、关闭后焦点归还给触发元素，面板收起时里面的按钮
会一起 `hidden`（否则 Tab 会停到屏幕外的隐藏控件上）；下钻/返回会把当前地区写进页脚那条
`role="status"` 的播报；口令表单有 `aria-describedby` / `aria-invalid` 与显隐开关；"降低动效"
同时覆盖 CSS 和 ECharts 画布动画；关键配色的对比度由 `npm run build` 里的静态检查守住
（`scripts/check-contrast.js`）。

仍然做不到的：地图的拖拽平移与缩放依赖指针，键盘只能用 +/− 与「重置视图」按钮；hover
悬浮卡片在触屏和键盘下都不出现（改用点击地区或地区一览按钮打开面板）。要彻底补上这一环
需要把渲染换成 SVG。

触屏上的行为：**点省份直接下钻**（和桌面一致），没有省级地图的地区（台湾 / 香港 / 澳门 /
南海诸岛）点开聚合面板；各地人数随时能在「地区一览」里看到。

地图的触摸点击有一层自己的兜底（`TapFallback`）：zrender 只给 300ms 以内的触摸补发 click，
慢一点的点按会被静默丢掉，而地区一览是普通 DOM 按钮不受影响 —— 这正是"列表能进、地图点不动"
的原因。兜底用更宽松的阈值（位移 ≤14px、时长 ≤900ms）自己判一次点击，并用时间戳与 zrender
去重，保证一次触摸只触发一次。

### favicon 为什么不是地图

站点图标是一枚「纸面 + 印章形方环 + 罗盘玫瑰（北点朱砂）」，**刻意不含任何地图几何**。

中国地图按规范要带南海诸岛插图，而 32px 的图标放不下第二幅插图；任何"简化版国境线"都必然
要按面积把那些岛礁当碎点筛掉。早期版本试过从 `js/china.js` 提取剪影（外环投影后把相邻省份
共享的边界两两抵消，得到一条干净的国境线，3588 字节），形状是对的，但**南海诸岛直接消失了**
—— 简化地图一定会丢东西，所以这个图形就不该是地图。

改用图志本身的语汇：方环取印章的方形轮廓，环内是制图用的罗盘玫瑰。纸面 / 墨绿 / 朱砂三色
仍然齐全，尺寸从 16px 到 128px 都可读，文件不到 1KB。如果将来要做地图式的图标，只能是抽象
的制图符号，不能是残缺的国界轮廓。

## 许可证

MIT License

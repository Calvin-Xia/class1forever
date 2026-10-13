# 迁移等价性契约（l1_spec）

本文件冻结现站（`main` 分支形态：静态 HTML5 + Cloudflare Pages Functions + KV）的**对外契约**，
作为 `astro-migration` 图全部下游节点的唯一参照。迁移到 Astro 6 SSR（@astrojs/cloudflare，`output:'server'`）
+ ECharts 6 + TypeScript + React 岛屿之后，下列每一条都必须逐条等价，不得增删语义。

- 冻结基准：本仓库 `astro-migration` 分支工作区（未提交改动前的现站实现），核对命令见 §6。
- 核对视角：以「可被命令 / 文件 / 读数逐条核对」为准；每条附**可观察判据**。
- 契约来源（只读）：`functions/api/**`、`functions/_lib/**`、`shared/data-model.mjs`、`js/**`、
  `css/main.css`、`index.html`、`_headers`、`build.js`、`scripts/check-contrast.js`、`AGENTS.md`。
- 后端事实（迁移后不变）：KV 绑定名 `CLASS_MAP_DATA`，键 `students:raw:v1`（明细，仅服务端）、
  `students:public:v1`（公开聚合）。

---

## §1 四个 API 路由契约

公共响应头（由 `functions/_lib/http.mjs` 的 `jsonResponse` 统一施加）：
`Content-Type: application/json; charset=utf-8`、`Cache-Control: no-store`（调用方未显式覆盖时）。
错误体统一形状（`errorResponse`）：`{ "error": <code>, "message": <中文提示>, ...extras }`。
四个路由**都不得**被任何缓存层存下——`no-store` 是契约的一部分。

### 1.1 `GET /api/map/public`

- **请求**：无 body、无参数。`Cookie` 头可选（用于计算 `detailAccess`）。
- **响应 200**（公开聚合 + 开关位，字段来自 KV `students:public:v1` 展开，再叠加三个字段）：

  | 字段 | 类型 | 说明 |
  |------|------|------|
  | `version` | string | 聚合数据版本，现为 `"v1"`（`shared/data-model.mjs` `DATA_VERSION`） |
  | `generatedAt` | string | ISO 时间戳，上传脚本写入 |
  | `stats.total` | number | 总人数 |
  | `stats.provinces` | number | 覆盖省级区域数 |
  | `stats.cities` | number | 覆盖城市数 |
  | `provinces` | object | `省名 -> { count:number, cities: {城市名: number} }` |
  | `detailAccess` | boolean | 本次请求是否带有效会话；`DETAILS_SESSION_SECRET` 缺失时为 `false` |
  | `detailModeAvailable` | boolean | `Boolean(DETAILS_PASSPHRASE && DETAILS_SESSION_SECRET)` |
  | `detailsHint` | string | `env.DETAILS_HINT \|\| ''`（未配则为空串，字段仍存在） |

- **响应头**：额外 `Vary: Cookie`。语义：响应体随会话状态变化（`detailAccess` 翻转），
  任何共享缓存必须按 `Cookie` 分桶；迁移后必须保留该头，否则已登录用户的响应可能被
  匿名请求复用。
- **错误 503** `public_data_unavailable`（`地图数据还没准备好，请稍后再试。`）：KV 读不到聚合数据
  （`loadPublicDataset` 抛错）。服务端 `console.error` 记录，详情不透给前端。

### 1.2 `POST /api/auth/details`

- **请求**：`Content-Type: application/json`，body `{ "passphrase": string }`。
- **响应 200**：`{ "authenticated": true }`，响应头 `Set-Cookie: detail_session=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`。
- **错误**

  | 状态 | `error` | `message` | 附带字段 | 触发条件 |
  |------|---------|-----------|----------|----------|
  | 503 | `detail_auth_not_configured` | `暂时无法查看详情，请稍后再试。` | — | `DETAILS_PASSPHRASE` 或 `DETAILS_SESSION_SECRET` 缺失 |
  | 400 | `invalid_request_body` | `请求有误，请重试。` | — | body 不是合法 JSON |
  | 400 | `passphrase_required` | `请输入口令。` | — | `passphrase` 缺失或非 string |
  | 429 | `too_many_attempts` | `尝试次数太多，请 15 分钟后再试。` | — | 当前窗口失败次数 `>= 10` |
  | 401 | `invalid_passphrase` | `口令不对，请重试。` | `remainingAttempts:number` | 口令比对失败（常量时间比较） |

- **限流契约**：窗口 `15 * 60 * 1000` ms，上限 `10` 次（`functions/_lib/auth.mjs`
  `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_ATTEMPTS`）。KV 键形状
  `auth:rate:<clientIp>:<floor(now / 15min)>`，`expirationTtl = ceil(15000ms / 1000) = 900` 秒。
  IP 取 `CF-Connecting-IP`，缺失记为 `'unknown'`。**先查限流后比对口令**；失败 `+1`；
  成功 `delete` 该键；`remainingAttempts = max(0, 10 - count - 1)`。
  注意：计数键按 `clientIp` 分桶，故同一 IP 的失败在 15 分钟窗口内累计。
- **Cookie 属性**：`HttpOnly`（JS 不可读）、`Secure`、`SameSite=Lax`、`Path=/`、
  `Max-Age=43200`（= 12h，`SESSION_TTL_MS / 1000`）。迁移后属性逐项不得放宽。
- **令牌**：`base64url(JSON.stringify({exp})) + "." + base64url(HMAC-SHA256(secret, encodedPayload))`，
  用 WebCrypto；`exp = Date.now() + 12h`。校验时用常量时间比较签名，且 `exp` 必须为 number 且 `> Date.now()`。
- **安全中间件：Astro `security.checkOrigin`（迁移新增的一层，旧站没有）**。Astro 6 默认开启
  `security.checkOrigin`（实现：`node_modules/astro/dist/core/app/middlewares.js` 的
  `createOriginCheckMiddleware`），它在**进入任何路由之前**先判一次，规则如下：

  | 请求形状 | 判据 | 结果 |
  |----------|------|------|
  | 安全方法（`GET`/`HEAD`/`OPTIONS`） | 不检查 | 进路由 |
  | **无** `Content-Type`（包括无 body 的 POST） | 必须 `Origin === url.origin` | 不满足 → **403** `Cross-site POST form submissions are forbidden` |
  | 有 `Content-Type` 且是表单类（`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`） | 必须 `Origin === url.origin` | 不满足 → **403** 同上 |
  | 有 `Content-Type` 且非表单类（如 `application/json`） | 不检查 | 进路由 |

  **403 是有意的安全行为，不是缺陷**：它挡的是跨站表单提交。浏览器对每个 POST（含同源）都会
  自动带 `Origin`，所以页面里旧前端那种 `fetch('/api/auth/logout', { method: 'POST' })`（无
  `Content-Type`）照旧 200；会被拦的只有不发 `Origin` 的调用方（curl、Node 脚本、测试），它们
  需要手动加 `-H "Origin: <站点源>"`。被拦时响应体是纯文本，且**不下发任何 Cookie**。
  因此上面那张错误表要这样读：`invalid_request_body` 只在请求通过 checkOrigin（带了同源
  `Origin`，或带 `Content-Type: application/json`）之后才可达；不带 `Origin` 且无 `Content-Type`
  的 POST 会先在中间件层被 403 拦掉。行数不变、语义叠加——这是**有意保留**的迁移差异，
  已在 `tests/api-contract.test.mjs` 固定：
  「失败态（契约 §1.2）：带同源 Origin、无 body 的 POST → 400 invalid_request_body」、
  「安全行为（有意为之）：不带 Origin 头的 POST → 403 Cross-site POST form submissions are forbidden」。

### 1.3 `GET /api/map/details`

- **请求**：查询参数 `province`（必填）、`city`（可选）。会话必须有效。
- **响应 200**：

  | 字段 | 类型 | 说明 |
  |------|------|------|
  | `province` | string | 规范化后的省名（应用别名表，见 1.5） |
  | `city` | string \| null | 规范化后的城市名；未传或为 `''`/`'null'`/`'undefined'` 时为 `null` |
  | `count` | number | 命中人数 |
  | `people` | array | `[{ name, school, city, province }]`，排序见下 |

- **排序契约**（`sortPeople`）：先 `city`（`localeCompare(zh-CN)`），再 `school`，最后 `name`。
  迁移后必须同序，否则同一地区的名单顺序漂移。
- **错误**

  | 状态 | `error` | `message` | 触发条件 |
  |------|---------|-----------|----------|
  | 503 | `detail_auth_not_configured` | `暂时无法查看详情，请稍后再试。` | `DETAILS_SESSION_SECRET` 缺失 |
  | 401 | `detail_auth_required` | `请先输入口令。` | 无有效会话（含令牌过期/签名不符） |
  | 400 | `province_required` | `缺少地区信息，请重新选择。` | `province` 参数缺失（`searchParams.get` 返回 `null`） |
  | 400 | `invalid_region_query` | = 校验抛出的中文消息 | `province` 为纯空白，或 `city` 非 string |
  | 503 | `detail_data_unavailable` | `这个地区暂时打不开，请稍后再试。` | KV 明细读不到 / 数据不合规（`normalizeStudents` 抛错） |

- 参数与数据错误严格分离：参数问题一律 400 且回显校验消息；KV/数据问题一律 503 且只在服务端
  `console.error`，不冒充 400、不透内部信息。

### 1.4 `POST /api/auth/logout`

- **请求**：无 body，**不需要**会话。
- **响应 200**：`{ "authenticated": false }`，响应头
  `Set-Cookie: detail_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`。
- **错误**：无（该路由不读 KV、不读 env，恒 200）。语义为「清除 Cookie」；
  清 Cookie 通过 `Max-Age=0` 而非删除服务端状态（会话是无状态签名令牌）。
- **但「恒 200」有个前提**：§1.2 记的 checkOrigin 中间件同样作用于此路由。无 `Content-Type`
  的 POST 必须带同源 `Origin`（浏览器自动带；curl/脚本要手动加 `-H "Origin: <站点源>"`），
  否则中间件会在进路由前就回 403，Cookie 不会被清。可对照断言（`tests/api-contract.test.mjs`）：
  「成功态（真实前端路径）：带同源 Origin 头的匿名 POST → 200 并清 Cookie（Max-Age=0），
  不需要有效会话」、「成功态（等价路径）：带 JSON Content-Type 的匿名 POST → 200
  （checkOrigin 对 JSON 请求不适用）」、「安全行为（有意为之，不是缺陷）：不带 Origin 头的
  POST → 403 Cross-site POST form submissions are forbidden」。

### 1.5 契约中的共享数据模型（迁移后沿用）

- `DATA_KEYS = { raw: 'students:raw:v1', public: 'students:public:v1' }`，`DATA_VERSION = 'v1'`。
- 省级别名表（`normalizeProvince`）：北京市→北京、天津市→天津、上海市→上海、重庆市→重庆、
  内蒙古自治区→内蒙古、广西壮族自治区→广西、西藏自治区→西藏、宁夏回族自治区→宁夏、
  新疆维吾尔自治区→新疆、香港特别行政区→香港、澳门特别行政区→澳门。
- 文本规范化：`trim()` + 连续空白折叠为单个空格；空串抛错。
- 必填字段：`name`、`school`、`city`、`province`。
- 聚合口径：`stats.provinces` 为去重省数，`stats.cities` 为去重 `省::市` 数，
  `provinces[省].cities[市]` 为计数。

---

## §2 交互与可达性清单

每条给出「应当发生什么」+「可观察判据」，并标注现实现的承载位置。

| # | 契约 | 可观察判据 | 现实现位置 |
|---|------|-----------|-----------|
| A1 | 点击有数据的省份下钻（进入省级地图）；省级视野点击地区打开信息面板 | 点省份后地图换成该省几何、左上出现「返回全国」；URL 不跳转 | `activateRegion()`：`canDrill = Boolean(point.drilldownFile) && !isActiveProvinceView()` |
| A2 | 返回全国：左上按钮与 `Esc` 都能回全国视野 | 两种情况地图都变回全国几何、「返回全国」消失、缩放回到适配比例 | `js/map.js:2153` 的 `keydown` Escape 分支 + `ui.backButton` |
| A3 | 台湾 / 香港 / 澳门 / 南海点击**只开信息面板**，不发省份脚本请求 | 点击后 Network 面板**不出现** `js/province/*.js` 请求；信息面板打开 | `js/geo.js` `hasProvinceFile()` 白名单（31 个）；`js/map.js:986` 用白名单决定是否下钻 |
| A4 | 缩放不可低于适配比例（也不高于上限） | 连续缩小到底后，地图仍完整填满布局框、不出现大面积空白；`BASE_ZOOM` 同时是 `scaleLimit.min` 与初始 `zoom` | `js/map.js:71` `BASE_ZOOM = 1.25`、`:1230-1234` `zoom` / `scaleLimit{min:1.25,max:8}`、`:1500` 乘数夹紧 |
| A5 | 拖动不可把地图拖出视口 | 往任一方向大幅拖动后，地图内容仍在视口内（自动回弹）；回弹阈值 0.5px | `js/map.js:74` `ROAM_TOLERANCE_PX = 0.5`、`clampMapRoam()`（`:1462` 起的位移判定） |
| A6 | 触摸「长按后轻点」仍能下钻（不依赖 zrender 的 300ms click 窗口） | 按住 600ms 再松手（位移 ≤14px）仍下钻或开面板；一次手势只触发一次 | `js/map.js:1606` `TapFallback`：`MAX_MOVE_PX=14`、`MAX_DURATION_MS=900`、`DEDUPE_MS=450`，射线法 `pointInRing` + `convertFromPixel` |
| A7 | 触摸设备上点省份直接下钻（没有「先开聚合面板」这一步） | 单次轻点即进入省级地图 | `activateRegion()` 无 `isTouchDevice` 分支 |
| A8 | 弹窗（底部面板 / 口令弹窗）打开时背景 inert，关闭后焦点归还 | 弹窗打开时 Tab 无法落在背景控件上；关闭后焦点回到打开它的按钮 / 地图锚点 | `FocusScope`（`js/map.js:335` 起，记录 `inerted`、恢复） |
| A9 | 面板关闭后 `#bs-*` 控件不可被 Tab 到 | 关闭面板后从页首连续 Tab，焦点顺序**不经过** `#bs-close`/`#bs-primary-btn`/`#bs-drilldown-btn` | 面板用 `bottom` 滑出屏幕，`BottomSheet.updateButtons()` 同步置 `hidden`（`js/map.js:444-446`） |
| A10 | 「地区一览」是键盘/读屏的等价路径：每个地区一个按钮 | 展开后每一地区行都有 `button[data-region]`；Enter 触发结果与点地图一致 | `js/map.js:renderRegionTable()` / `handleRegionTableClick()`，两路径同走 `activateRegion()` |
| A11 | 排序切换时 `aria-sort` 只落在当前排序列 | 切到「按地区名」后 `#region-th-name` 为 `ascending`/`descending`，`#region-th-count` 为 `none`（反之亦然） | `js/map.js:1940-1953`；`index.html:165-166` 初始 `name=none`、`count=descending` |
| A12 | 视口宽度 ≤480px 时无横向滚动 | 375/414/480px 宽度下 `document.documentElement.scrollWidth <= clientWidth`（无横向滚动条） | `css/main.css:1875` `@media (max-width: 480px)`（收窄内边距、隐藏角落装饰与版权/比例尺） |
| A13 | 「reduce motion」下不动画：地图不播入场动画、标题不逐字落下 | OS 开启 reduce motion 后刷新：choropleth 直接呈现、标题一次性出现、`atmosphere__glow` 不显示、`magnet` 无位移 | CSS：`css/main.css:1962` `@media (prefers-reduced-motion: reduce)`；canvas 侧：`js/map.js:1280` `chartAnimationEnabled()` 喂给 `animation`/`animationDuration` |
| A14 | 窄视口下图例 `0 人` 刻度不压住左下缩放控件 | <768px 宽度时图例右移缩短，左下 44px 缩放组与 `0 人` 不重叠 | `js/map.js` `legendLayout()` 读 `window.innerWidth` |
| A15 | 读屏播报数字跟随视野（省级视野绝不念全国总数） | 省级视野下 `#interaction-note` 为「覆盖 N 座城市，共 M 位同学」或空状态句，不含全国总数 | `js/map.js:updateInteractionNote()` + `getProvinceSummary()` |

> 迁移注意（互不重叠地保留）：A3 的白名单是**防止必然 404 的省份脚本请求**的手段，不是「不支持下钻」；
> 新增省份文件时必须同步 `js/geo.js` 白名单，`npm run build` 会校验一致性（见 §4）。

---

## §3 视觉契约

### 3.1 12 个必需 CSS 变量（`css/main.css` `:root`，缺一个 `npm run build` 失败）

由 `scripts/check-contrast.js` 的 `requiredTokens` 逐一断言存在：

```
--color-bg-primary          #f7f4ec
--color-bg-card             #fffdf8
--color-text-primary        #17241f
--color-text-secondary      #4c5852
--color-text-muted          #5b6660
--color-accent-primary      #4f7f63
--color-accent-secondary    #9ed3bd
--color-accent-strong       #1f5245
--color-accent-strong-hover #1a4539
--color-accent-tertiary     #a63c31
--color-highlight           #e0b463
--color-border              #ddd6c6
```

**可观察判据**：`npm run build` 打印的对比度断言数 = 37 且退出码 0（删掉任一声明即报
「对比度检查需要的 CSS 变量不存在：--color-…」）。另：`--color-text-muted` 必须**同时**在
`--color-bg-primary`（5.44:1）与更深的 `--color-bg-secondary`（4.75:1）上 ≥4.5:1——
地图版权与比例尺刻度坐在衬纸上，只对页面底断言是漏检。

### 3.2 11 组 CSS ↔ `js/palette.js` 同值对

由 `check-contrast.js` 的 `assertSame` 逐条断言（改一处必失败）：

| # | `js/palette.js` | CSS 变量 |
|---|-----------------|----------|
| 1 | `heat[0]` | `--color-bg-secondary` |
| 2 | `heat[3]` | `--color-accent-primary` |
| 3 | `heat[5]` | `--color-accent-strong-hover` |
| 4 | `regionBorder` | `--color-border` |
| 5 | `mapLabel` | `--color-text-primary` |
| 6 | `visualMapText` | `--color-text-secondary` |
| 7 | `share.statValue` | `--color-accent-primary` |
| 8 | `share.headerFrom` | `--color-accent-strong` |
| 9 | `share.headerTo` | `--color-accent-strong-hover` |
| 10 | `share.background` | `--color-bg-primary` |
| 11 | `snapshotBackground` | `--color-bg-secondary` |

另需保持：`heat` 色带**逐档变深**（`check-contrast.js` 按亮度单调递减断言），
`heat[1]/heat[2]/heat[4]` 只在 canvas 上使用、无对应 CSS 变量。

### 3.3 对比度 AA 判据（`scripts/check-contrast.js`，共 37 条断言）

阈值：正文 4.5:1；大字号（≥24px，或 ≥18.66px 粗体）3:1；非文字 UI 组件（焦点环）3:1（WCAG 2.2 AA / 1.4.11）。
关键条目（迁移后必须保持）：

- `--color-text-secondary` 与 `--color-text-muted` 在 `--color-bg-primary` **与** `--color-bg-secondary` 上 ≥4.5:1。
- `--color-text-primary` 在 `--color-bg-card` 上 ≥4.5:1。
- 白字在 `--color-accent-strong`、`--color-accent-strong-hover`、`--color-accent-tertiary`，以及登录按钮渐变中点（三色 ↔ strong 的混合）上 ≥4.5:1。
- `--color-accent-secondary`、`--color-highlight` 在深色卡片（`--color-text-primary`）上 ≥4.5:1。
- `--color-accent-primary` 在页面底上 ≥3:1（焦点环）。
- 口令反馈的 error / success 色（`.auth-modal__feedback[data-variant=…]` 里的**字面量**，是唯一允许出现在 `:root` 之外的两种颜色）在 `--color-bg-card` 上 ≥4.5:1。
- 分享图：标题（42px）在头部渐变中点 ≥3:1；副标题（18px）≥4.5:1；统计数字（36px 粗体）≥3:1、标签（16px）≥4.5:1；图例文字压在半透明胶囊合成色上 ≥4.5:1。
- 地图标签在最浅热力色上 ≥4.5:1。

**可观察判据**：`npm run build` 输出 37 项达标；把任一 `:root` 色值调暗/调浅到阈值以下即报具体比值。

---

## §4 安全契约

均以 `build.js` 的静态检查为闸门（`npm run build` 失败即违反）：

| # | 契约 | 可观察判据 | 闸门位置 |
|---|------|-----------|----------|
| S1 | 页面不引用 `js/data.js` | `grep -n 'js/data.js' index.html` 无输出；`npm run build` 通过 | `build.js` 检查 2 |
| S2 | 无跨源 `<script src>` | index.html 的 script src 全部相对路径 | `build.js` 检查 3（`^(https?:)?//` 即失败） |
| S3 | 无内联 `<script>`（含空/纯空白块） | 正则 `<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?</script>` 无命中 | `build.js` 检查 3 |
| S4 | `_headers` 的 `script-src` 不含 `unsafe-inline` | `grep -n 'unsafe-inline' _headers` 在 script-src 段无命中（style-src 的 `unsafe-inline` 是既有例外） | `build.js` 检查 6 |
| S5 | 省份白名单与 `js/province/` 数量一致 | `js/geo.js` `AVAILABLE_PROVINCE_FILES` 31 项 === `ls js/province/*.js \| wc -l` = 31，且双向无缺无多 | `build.js` 检查 5 |
| S6 | 每个省份文件以 `CMapGeo.register("cn/<slug>",` 开头，`js/china.js` 以 `CMapGeo.register("cn/china",` 开头 | `npm run build` 通过（逐文件校验前 200 字节） | `build.js` 检查 5 |
| S7 | 渲染库不是 Highcharts（已换 ECharts） | `grep -ni highcharts index.html js/map.js js/boot.js js/geo.js _headers css/main.css` 无输出 | `build.js` 检查 4 |
| S8 | 密钥只来自运行时 env，绝不硬编码 | `env.DETAILS_PASSPHRASE` / `env.DETAILS_SESSION_SECRET` / `env.DETAILS_HINT` / `env.CLASS_MAP_DATA`；仓库内不含口令/密钥字面量；`js/data.js`、`.dev.vars` 不入库 | 人工 + `.gitignore` |

**可观察判据（一次性）**：`npm run build` 退出码 0 且打印「✅ 静态检查通过 … 对比度断言 37 项全部达标」。

---

## §5 14 项人工 smoke 清单（与 `AGENTS.md` Testing Guidelines 一致）

| # | 操作 | 可观察判据 |
|---|------|-----------|
| 1 | `npm run dev:local`（需先 `npm run build`；演示口令 `demo`；要看真实聚合数字用 `STUDENTS_PUBLIC_FILE=public.json npm run dev:local`）打开 http://127.0.0.1:8788 | 地图渲染完成，色带图例出现，只有公开聚合数字（无姓名/学校） |
| 2 | 悬浮一个省份 | 出现悬浮卡片，图例在该数值上标出色带位置 |
| 3 | 点击有数据的省份下钻；用「返回全国」或 `Esc` 上钻 | 进入省级地图并加载该省脚本；返回后回到全国视野 |
| 4 | 点击台湾/香港/澳门/南海 | 信息面板打开，Network 无省份脚本请求 |
| 5 | 缩放与拖动 | 地图不能被拖出视口；缩放不低于适配比例 |
| 6 | 口令流程 | 错误口令被拒；登录后详情可加载；「退出查看」清会话与缓存详情 |
| 7 | 分享按钮 | 生成含地图、图例带、统计的 PNG；省级视图数字为该省；文件名为 `蹭饭地图_<范围>_<日期>.png` |
| 8 | ≤480px 窄视口 | 控件不重叠，无横向滚动 |
| 9 | 键盘遍历 | 每个按钮有可见焦点环；口令弹窗打开时 Tab 到不了背景控件，Esc 焦点回「同学信息」；关闭底部面板焦点回地图 |
| 10 | 展开「地区一览」，Tab 到某行「查看」按 Enter | 结果与点地图该地区一致；切排序后 `aria-sort` 换列 |
| 11 | 面板打开再关闭，从页首 Tab | 焦点顺序绝不停在 `#bs-*` 控件（关闭时位于 y≈1660） |
| 12 | OS 开 reduce motion 后刷新 | choropleth 不动画，标题不逐字落下 |
| 13 | 触摸设备（或 `playwright-cli open --device "iPhone 15"`） | 点省份即下钻；点台湾**开面板后随即被同一次触摸合成的 click 关掉**（合成 click 落在刚盖上的遮罩上）；按住 >300ms 的点击仍生效（走 `TapFallback`） |
| 14 | `npm run build`；`npm run data:upload -- --dry-run` | 两条命令均成功（后者不实际写入 KV） |

> **smoke 13「台湾」子项的口径（2026-10-13 用户裁定，补记）**：上表第 13 行的台湾子项以**实测**为准 ——
> 「轻点台湾＝打开信息面板，但同一次触摸合成的 click 落在刚盖上的遮罩上把面板关掉」。这是**迁移前既有行为**
> （新旧站事件序列逐字相同），用户已**接受该等价性 override**；`AGENTS.md` smoke 13 与此同步改写，
> 裁定与证据记录见 `docs/parity-touch-compare.md` 的「裁决记录」。桌面端点击（上表第 4 行）不受影响：面板打开并保持。

> **smoke 第 1 项实跑记录**（2026-10-12，`l2_contract_rev` 节点，本分支）：
>
> ```text
> $ TEMP=... TMP=... npm run dev:local -- --port 8910 --reset
> ✅ 本地站点已就绪：http://127.0.0.1:8910（演示口令 demo，Ctrl+C 结束）
>
> $ curl -i http://127.0.0.1:8910/
> HTTP/1.1 200 OK
> Content-Type: text/html
> Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; …
>
> $ curl -i http://127.0.0.1:8910/api/map/public
> HTTP/1.1 200 OK
> Cache-Control: no-store
> Vary: Cookie
> {"version":"v1","stats":{"total":6,"provinces":3,"cities":4},"provinces":{"北京":{"count":3,…
> ```
>
> 读数：页面 200、`id="map"` 挂载点在、页内 **0** 处 `school` 字段（只有公开聚合）；
> **但此时页面没有任何 `<script>` 标签**——地图岛（`l2_map`）与样式迁移（`l2_visual`）还未落地，
> 所以本项后半句「地图渲染完成、色带图例出现」**当前不可验证**，需在这两个节点通过后重跑本项。
> 本行记录的就是这个部分结论，不是「已验证通过」。

---

## §6 对照核对记录（留档）

- **核对人**：`exec-backend`（`l1_spec` 叶子执行者，未转派、未使用 subagent）。
- **核对日期**：2026-10-12，基准提交 `90c182b`（`astro-migration` 分支工作区）。
- **核对方式**：只读源码逐行比对 + 命令实测读数 + `npm run build` 静态闸门；未改动任何实现文件。
- **下游引用约定**：本文件的条目 id 即为引用锚点——路由用 `§1.x`，交互/可达性 `A1–A15`，
  视觉 `V3.1 / V3.2 / V3.3`（及表内序号 1–11），安全 `S1–S8`，smoke `1–14`。
  下游节点在 plan/DoD 里可直接写「等价于 migration-parity A6」这种指代。

### 6.1 路由契约核对（cp1）

| 契约条目 | 核对方式 | 核对读数 |
|----------|----------|----------|
| §1 公共头 `Content-Type` / `Cache-Control: no-store` | 读 `functions/_lib/http.mjs` | `jsonResponse` 在缺省时设 `application/json; charset=utf-8` 与 `no-store` |
| §1 错误体 `{error,message,…}` | 读 `http.mjs:errorResponse` | 形状一致，`extras` 展开到顶层 |
| §1.1 public 字段与 `Vary: Cookie` | 读 `functions/api/map/public.js` | 展开 `dataset` 后叠加 `detailAccess`/`detailModeAvailable`/`detailsHint`，头仅 `Vary: Cookie` |
| §1.1 503 `public_data_unavailable` | 读 `public.js` catch + `_lib/data.mjs:loadPublicDataset` | KV 空/非对象时抛 `Public map dataset is not configured in KV.` |
| §1.2 200 与 `Set-Cookie` 属性 | 读 `functions/api/auth/details.js` + `_lib/auth.mjs:buildSessionCookie` | `detail_session`、`Path=/`、`HttpOnly`、`Secure`、`SameSite=Lax`、`Max-Age=43200` |
| §1.2 五个错误码 | 读 `auth/details.js` 分支 | 503/400/400/429/401 顺序与条件逐条一致 |
| §1.2 限流阈值/窗口/键/TTL | 读 `_lib/auth.mjs` | `RATE_LIMIT_WINDOW_MS=15*60*1000`、`RATE_LIMIT_MAX_ATTEMPTS=10`、键 `auth:rate:<ip>:<bucket>`、`expirationTtl=900`、IP 取 `CF-Connecting-IP`（缺省 `unknown`） |
| §1.2 `remainingAttempts` | 读 `auth/details.js` | `Math.max(0, 10 - count - 1)` |
| §1.2 令牌格式/常量时间/exp | 读 `_lib/auth.mjs` | base64url(payload).base64url(HMAC-SHA256)、`safeEqual` 逐字节异或、`typeof exp === 'number' && exp > Date.now()` |
| §1.3 200 字段与排序 | 读 `_lib/data.mjs:buildDetailsPayload` + `shared/data-model.mjs:sortPeople` | `{province,city,count,people}`；排序 city→school→name（`zh-CN`） |
| §1.3 五个错误码 | 读 `map/details.js` | 503/401/400/400/503 逐条一致 |
| §1.3 `city` 归一化 | 读 `_lib/data.mjs:normalizeQueryCity` | 非 string 抛错；`''`/`'null'`/`'undefined'` → `null` |
| §1.4 logout 200 与清 Cookie | 读 `functions/api/auth/logout.js` + `buildClearedSessionCookie` | `{authenticated:false}`，`Max-Age=0`，不读 env/KV |
| §1.5 键名/别名/版本 | 读 `shared/data-model.mjs` | `students:raw:v1`、`students:public:v1`、`v1`、11 条别名逐条一致 |

### 6.2 交互 / 视觉 / 安全核对（cp2）

| 契约条目 | 核对方式 | 核对读数 |
|----------|----------|----------|
| A1/A7/A10 统一下钻入口 | 读 `js/map.js:activateRegion()` | `canDrill` 仅取决于 `drilldownFile` 与当前视野，无 `isTouchDevice` 分支；点击与表格行同走此函数 |
| A2 Esc 返回 | 读 `js/map.js:2153` 附近 `keydown` | `event.key === 'Escape'` 分支调用上钻 |
| A3 白名单不发脚本 | 读 `js/geo.js:hasProvinceFile` + `js/map.js:986` | 仅白名单内 `filename` 才下钻；白名单 31 项 |
| A4 缩放夹紧 | 读 `js/map.js` | `BASE_ZOOM = 1.25` 同时是初始 `zoom` 与 `scaleLimit.min`，`ZOOM_MAX = 8`，`applyMapZoom` 双重夹紧 |
| A5 拖动夹紧 | 读 `js/map.js` | `ROAM_TOLERANCE_PX = 0.5`，`clampMapRoam()` 越界回弹，最小比例时交还自动居中 |
| A6 触摸兜底 | 读 `js/map.js:TapFallback` | `MAX_MOVE_PX=14`、`MAX_DURATION_MS=900`、`DEDUPE_MS=450`，`convertFromPixel` + 射线法 |
| A8 inert 与焦点归还 | 读 `js/map.js:FocusScope` | 打开前记录焦点来源，`element.inert = true`，关闭时按外层占用情况恢复 |
| A9 关闭后面板控件不可 Tab | 读 `js/map.js:BottomSheet.updateButtons` | 非 active 时 `closeButton/primaryButton/drilldownButton.hidden = true` |
| A11 `aria-sort` | 读 `js/map.js:renderRegionTable` + `index.html:165-166` | 仅当前排序列非 `none`；初始 `name=none`、`count=descending` |
| A12 ≤480px | 读 `css/main.css:1875` | 收窄内边距并隐藏角落装饰、版权、比例尺 |
| A13 reduce-motion | 读 `css/main.css:1962` + `js/map.js:chartAnimationEnabled` | CSS 三属性 `!important` 归零 + canvas 侧读同一媒体查询 |
| A14 图例布局 | 读 `js/map.js:1154 legendLayout()` | 读 `window.innerWidth` 决定图例长度/位置 |
| A15 读屏数字 | 读 `js/map.js:updateInteractionNote` | 省级视野用 `getProvinceSummary()`，不追加全国总数 |
| V3.1 12 变量 | 命令：`npm run build` | ✅ 通过，「对比度断言 37 项全部达标」；12 个 `requiredTokens` 逐一断言存在 |
| V3.2 11 组同值对 | 命令：`npm run build`；读 `scripts/check-contrast.js` | 11 条 `assertSame` 全过；`heat` 六档亮度单调递减亦断言 |
| V3.3 对比度 AA | 命令：`npm run build` | 37 条断言含 `--color-text-muted` 在 `--color-bg-primary` 与 `--color-bg-secondary` 两处 ≥4.5:1 |
| S1 不引 `js/data.js` | 命令：`grep -c 'js/data.js' index.html` | `0` |
| S2 无跨源 script | 命令：`grep -n 'script[^>]*src' index.html` | 唯一一条：`<script src="js/boot.js" defer></script>`（同源相对路径） |
| S3 无内联 script | 命令：`npm run build`（build.js 检查 3） | 通过 |
| S4 `script-src` 无 `unsafe-inline` | 读 `_headers` + `build.js` 检查 6 | `script-src 'self'`；`unsafe-inline` 只出现在 `style-src`（既有例外，闸门只查 script-src） |
| S5 白名单 = 目录数量 | 命令：`ls js/province/*.js \| wc -l` = 31；`grep -c "^        '" js/geo.js` = 31 | 31 === 31 |
| S6 register 前缀 | 命令：`npm run build`（build.js 检查 5 逐文件） | 通过 |
| S7 无 Highcharts | 命令：`npm run build`（build.js 检查 4） | 通过 |
| S8 密钥来自 env | 读 `functions/api/**` 与 `_lib/**` | 全部经 `env.DETAILS_*` / `env.CLASS_MAP_DATA`，无字面量密钥 |

### 6.3 边界与差异说明（如实记录）

1. `invalid_region_query` 的 `message` 直接复用校验抛出的中文串。现可从路由触达的是
   「`province` 为纯空白」一条（`searchParams.get` 永远返回 string|null，不会命中 non-string 的 TypeError 分支）。
   迁移后如改用其它取参方式，需自己保住「参数错 → 400 + 中文消息」这一语义。
2. `!province` 只拦 `null`；`?province=`（空串）与 `?province=%20` 都会落到 `invalid_region_query`（400），
   而非 `province_required`。下游实现必须保持这个分流。
3. `Vary: Cookie` 目前只有 `/api/map/public` 需要；`/api/map/details` 以 401 表达会话差异，
   不参与共享缓存（`no-store`）。不要顺手给所有路由加 `Vary`，也不要漏掉 public 这一条。
4. 限流计数按 `clientIp` 分桶；本地 `npm run dev:local` / `cf:dev` 下 `CF-Connecting-IP` 可能缺失，
   此时所有请求共享 `unknown` 桶——本地复现 429 时按此预期。（原先此条写的旧本地假 API 脚本已随
   `tests/dev-server.mjs` 退役，见 §7。）
5. 视觉契约目前有 37 条断言、12 个必需变量、11 组同值对，三个数字必须与
   `scripts/check-contrast.js` 保持一致；迁移若把对比度检查改写成 TS，需保留同等断言数或明确记录变更。
6. `git status --short` 中 `.graph/`、`.pi/`、`CONTEXT-MAP.md`、`DECISIONS.md`、`docs/` 为未跟踪项
   （图与文档目录尚未提交）；`functions/`、`js/`、`css/` 无任何改动——见 §6.4 收尾读数。

### 6.4 收尾读数（写报告前实测）

```text
$ npm run build
✅ 静态检查通过：地图数据仍由 Cloudflare Pages Functions + KV 提供，前端渲染使用本地 ECharts；对比度断言 37 项全部达标。

$ ls js/province/*.js | wc -l
31

$ git status --short
?? .graph/
?? .pi/
?? CONTEXT-MAP.md
?? DECISIONS.md
?? docs/
```

---

## §7 修订记录（`l2_contract_rev`，2026-10-12）

`l1_test` 执行期发现的三处漂移在本节收口。**§1–§6 的既有核对读数保持原样**（它们是
`l1_spec` 当时的实测），本节只记录新增与差异；下游引用时以本节为准。

1. **补记 Astro `security.checkOrigin` 中间件**（§1.2 新增一节，§1.4 补充「恒 200」的前提）。
   它是迁移新增的一层、旧站没有：非 `GET`/`HEAD`/`OPTIONS` 且**无 `Content-Type`**（或 `Content-Type`
   是表单类）时必须 `Origin === url.origin`，否则中间件在进路由前回 **403**
   `Cross-site POST form submissions are forbidden`；`application/json` 这类非表单 `Content-Type`
   不检查。**403 是有意的安全行为，不是缺陷**：浏览器对每个 POST（含同源）自动带 `Origin`，
   所以页面里的旧前端写法照旧 200；只有 curl / Node 脚本这类不发 `Origin` 的调用方需要手动加
   `-H "Origin: <站点源>"`。事实来源：`node_modules/astro/dist/core/app/middlewares.js`
   （`createOriginCheckMiddleware`）+ 真浏览器实测（Playwright/Chromium，同源页面执行
   `fetch('/api/auth/logout', { method: 'POST' })` → 200）；已固化为 `tests/api-contract.test.mjs`
   的 5 条断言，本文件 §1.2/§1.4 逐条引用了这些用例名。
2. **本地通路改名**：旧的本地假 API 脚本（`tests/dev-server.mjs`，其 npm 脚本已从 package.json 删除）
   不再是指引目标；本地开发/联调改指 `npm run dev:local`（需先 `npm run build`，演示口令 `demo`，
   真实聚合数据用 `STUDENTS_PUBLIC_FILE=...`）。§5 的 smoke 第 1 项与 §6.3 第 4 条已同步；
   本文件不再出现旧脚本名。
3. **smoke 第 1 项实跑记录**：见 §5 表格下方的「实跑记录」块（2026-10-12）：通路本身通过
   （`/` 200 + CSP、`/api/map/public` 200 聚合 JSON + `Vary: Cookie`），但地图岛未落地，
   「地图渲染 + 色带图例」这半句标为**待复跑**（`l2_map` / `l2_visual` 之后）。

仍存在、本节点边界外的遗留项（已上报，未在此修）：

- `build.js` 的通过文案仍写着「地图数据仍由 Cloudflare Pages Functions + KV 提供」，那是旧静态门禁
  的打印字符串（§6.4 的记录就是它的原样输出）；该文件属于旧门禁，改它不在本节点范围。
- `docs/migration-parity.md` §2 的「现实现位置」列全部指向旧站 `js/map.js` —— 它们描述的是
   **等价性基准**，迁移到 `src/` 岛屿后需由相关节点逐条重新落地并标注新位置。

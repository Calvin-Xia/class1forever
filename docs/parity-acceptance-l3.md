# l3_parity 验收记录：旧清单在新站复跑

- 节点：`l3_parity`（图 `astro-migration`），执行者 `exec-parity`（叶子，未转派、未使用 subagent）。
- 日期：2026-10-12；分支 `astro-migration`，基准提交 `90c182b`。
- 验收真相源：`docs/migration-parity.md`（l1_spec 冻结）+ `AGENTS.md` Testing Guidelines 的 Manual smoke 1–14。
- 新站运行路径（硬约束）：`npm run dev:local` = `wrangler dev × astro build 产物`（Worker 渲染路径），**未使用 `astro dev`**。
  - 默认夹具站：`http://127.0.0.1:8912`（演示口令 `demo`，KV 夹具北京3/浙江2/四川1）。
  - 31 省对照站：`http://127.0.0.1:8914`（`STUDENTS_PUBLIC_FILE`/`STUDENTS_RAW_FILE` = `.wrangler/parity/fixtures/parity-*.json`）。
- 旧站参照：`git archive HEAD`（= `main` 形态）解到 `.wrangler/parity/old-site/`，由 `.wrangler/parity/old-site-server.mjs`
  提供静态文件 + 同源 `/api/*`（用同一份夹具）；不修改工作区任何实现文件。
- build/dev 均带 `TEMP=$PWD/.wrangler/probe-tmp TMP=...`；各 serve/KV 用独立 `--state-dir`；跑 build 前 `netstat` 确认 88xx/89xx 无 dev server 占 dist。

> **后续状态（2026-10-17，用户授权）** —— 本文件正文是 2026-10-12 的验收读数，**保持原样**；
> 其中**触摸结论已被 2026-10-17 的产品变更取代**：smoke 13 的台湾子项与 A6「长按仍下钻」不再是现行口径。
> 现行手势语义：轻点可下钻省份 = 下钻；轻点台湾/港澳/南海 = 面板打开**并保持**；长按 ≥300ms = 面板打开；
> 鼠标右键 = 面板。经用户授权，这是**主动偏离等价性基线的产品变更，不是迁移回归修复**（修复
> 「面板被同一次触摸迟到的合成 click 关掉」这一基线缺陷）。现行口径与实测轨迹见
> `docs/parity-touch-compare.md` 的「新裁定（2026-10-17）」/「T5 实测轨迹」、`docs/migration-parity.md` §8、
> `AGENTS.md` smoke 13。

## 结论

- **14 项 smoke：全部通过**（逐条证据见下；smoke 13 的台湾子项按「与旧站一致」判定，见发现 F-P1）。
- **可达性清单 A1–A15：全部通过**。
- **安全清单 S1–S8：全部通过**（网络与源码均无完整学生数据、无跨源与内联脚本）。
- **视觉清单 V3.1/V3.2/V3.3：全部通过**（对比度/调色板 37 条断言达标）。
- **DoD#3 31 省数据与中文地名：新站与旧站逐字段一致**（含已知的「市」后缀不匹配现象，两边同样不上色）。
- **DoD#4 真实浏览器同源 POST：未被 `security.checkOrigin` 拦成 403**（F-1 已复现为「有意的 403 只发生在无 Origin 的调用方」）。
- 不通过项：**0**。发现 1 条（F-P1，非迁移回归，与旧站逐字一致）。

## 证据索引（真实路径）

| 内容 | 路径 |
|------|------|
| smoke 1–7 报告 | `.wrangler/parity/evidence/parity-smoke-1-7.md` / `.json` |
| smoke 8–14 报告 | `.wrangler/parity/evidence/parity-smoke-8-14.md` / `.json` |
| 安全 + 视觉报告 | `.wrangler/parity/evidence/parity-security-visual.md` / `.json` |
| 31 省对照报告 | `.wrangler/parity/evidence/parity-31-provinces.md` / `.json` |
| 31 省对照快照 | `.wrangler/parity/evidence/parity-31-provinces-snapshot.json` |
| 口令浏览器报告 | `.wrangler/parity/evidence/parity-auth-browser.md` / `.json` |
| smoke 14 build 输出 | `.wrangler/parity/evidence/smoke14-npm-build.log` |
| smoke 14 data:upload 输出 | `.wrangler/parity/evidence/smoke14-data-upload-dryrun.log` |
| 截图目录 | `.wrangler/parity/evidence/shots/`（smoke1/2/4/5/6/8/12/13、share-national/zhejiang、a14-bottom-strip-480） |
| 新旧站触摸对照 | `docs/parity-touch-compare.md`（原始输出 `.wrangler/parity/evidence/parity-touch-new.txt` / `-old.txt`） |
| 证据脚本（scratch） | `.wrangler/parity/parity-smoke-1-7.mjs`、`parity-smoke-8-14.mjs`、`parity-security-visual.mjs`、`parity-31-provinces.mjs`、`parity-auth-browser.mjs`、`harness.mjs`、`gen-parity-fixtures.mjs`、`old-site-server.mjs` |

---

## 1. 14 项人工 smoke 逐条

| # | 结论 | 可观察证据 |
|---|------|-----------|
| 1 | 通过 | `dev:local` 站 `/` 200 + CSP；chart `booted=true`、初始视野 35 个数据点；`visualMap` continuous `0→3 人`、6 档色带；`/api/map/public` 响应字段仅 `version/generatedAt/stats/provinces/detailAccess/detailModeAvailable/detailsHint`，无 `name`/`school`、无「示例甲…」；页面可见文本无姓名/学校。截图 `shots/smoke1-national.png` |
| 2 | 通过 | 悬浮 `浙江` → `.map-tooltip` 可见，文本「浙江 / 2人 / 覆盖城市 1 座」；`visualMap.hoverLink=true`。截图 `shots/smoke2-hover.png` |
| 3 | 通过 | 点 `浙江` → `activeProvince=浙江`、`activeMapId=cn/zhejiang`，按需加载 `/_astro/zhejiang.DPCA4wJq.js`；`#map-back-btn` 可见；`#interaction-note` 为「当前查看 浙江。覆盖 1 座城市，共 2 位同学。」（不含全国总数 6）；「返回全国」与 `Esc` 均回 `cn/china` |
| 4 | 通过 | 台湾/香港/澳门/南海诸岛：点后 `#bottom-sheet.active` 打开、`activeProvince=null`、Network 无任何省份脚本请求（对 4 例逐一断言）。截图 `shots/smoke4-*.png` |
| 5 | 通过 | 连续缩小：`zoom=1.25`（不低于 `BASE_ZOOM`）；最小比例地图完整可见 + 横向居中 + 纵向铺满；大幅拖动后自动回正；放大 4.15× 后拖到边角仍完全盖住容器；重置回 1.25 |
| 6 | 通过 | 错误口令 → `#auth-feedback[data-variant=error]`「口令不对，请重试。 剩余 9 次尝试。」且 `access=false`；正确口令 `demo` → `access=true`；登录后点浙江明细卡出现「示例丁/示例理工」；「退出查看」→ `POST /api/auth/logout` + `Set-Cookie … Max-Age=0`，`access=false`、按钮回「同学信息」；重新登录再开浙江会**重新请求** `/api/map/details`（1→2 次）证明本地缓存已清 |
| 7 | 通过 | 分享按钮下载 PNG（348KB，PNG 魔数校验通过，含地图/图例带/统计）；全国：`蹭饭地图_全国_2026-10-12.png`，统计 `[总人数 6, 覆盖省份 3, 覆盖城市 4]`；省级：`蹭饭地图_浙江_2026-10-12.png`，统计 `[浙江人数 2, 覆盖城市 1, 占全班 33%]`。图 `shots/share-national.png`、`shots/share-zhejiang.png` |
| 8 | 通过 | 375/414/480px：`scrollWidth <= clientWidth`（375/375、414/414、480/480）；缩放控件簇（x27–71）与左上工具栏无重叠。截图 `shots/smoke8-480.png` |
| 9 | 通过 | 键盘 Tab 遍历：所有获得焦点的按钮均 `:focus-visible` + `solid` outline；口令弹窗打开 → `.page-wrapper.inert=true`、焦点在弹窗内、Tab 不出弹窗（`escaped=[]`）；`Esc` 焦点回 `#details-btn`；底部面板打开 → 背景 inert + 焦点在面板；关闭 → 焦点回 `#map` |
| 10 | 通过 | 展开「地区一览」→ 35 个 `button[data-region]`；聚焦浙江行「查看」按 Enter → `activeProvince=浙江`、`activeMapId=cn/zhejiang`（`source=ledger`），与点地图一致；排序切换 `aria-sort` 在 `region-th-name` ⇄ `region-th-count` 之间正确互斥 |
| 11 | 通过 | 面板关闭后 `#bs-close`/`#bs-primary-btn`/`#bs-drilldown-btn` 均 `hidden=true`；从页首连续 Tab 40 次，焦点从不落在 `#bs-*`（`hitsSheetControls=[]`） |
| 12 | 通过 | `emulateMedia(reducedMotion: 'reduce')` 后：`chart.animation=false`、`animationDuration=0`；`.page__title .char` opacity=1；`.atmosphere__glow display:none`；`.magnet transform:none`。截图 `shots/smoke12-reduced-motion.png` |
| 13 | 通过（台湾子项按等价判定，见 F-P1） | 触摸视口（390×844, hasTouch）：轻点 `北京` 直接下钻（无「先开聚合面板」步骤）；按住 600ms 再松手仍下钻且走 `TapFallback`（`source=touch`），一次手势只激活一次；点 `台湾` 未下钻、广播 `map:region-activate(canDrill=false)` 并渲染台湾公开卡（与旧站逐字一致）。截图 `shots/smoke13-touch.png`；对照见 `docs/parity-touch-compare.md` |
| 14 | 通过 | `npm run build` 退出码 0：「静态断言 13 组（含对比度/调色板 37 项）、astro check 与 astro build 退出码 0、产物扫描无泄漏」（`smoke14-npm-build.log`）；`npm run data:upload -- --dry-run` 退出码 0，输出 `stats {total:44, provinces:13, cities:18}`（`smoke14-data-upload-dryrun.log`） |

## 2. 可达性清单 A1–A15

| 条目 | 结论 | 证据 |
|------|------|------|
| A1 统一下钻入口 | 通过 | 点省份 → `activeProvince`/`activeMapId` 正确；`activations` 记录 `source=map`（**按输入设备区分**：鼠标为 `'map'`、触摸轻点为 `'touch-tap'`、长按为 `'touch-hold'`；2026-10-17 起）；「地区一览」同走 `activateRegion`（`source=ledger`） |
| A2 返回全国（按钮 + Esc） | 通过 | 两条路径都回 `cn/china` |
| A3 台湾/香港/澳门/南海只开面板、不发省脚本 | 通过 | 4 例逐一点击：无 `/_astro/<省slug>.*.js` 请求 |
| A4 缩放不低于适配比例 | 通过 | `zoom=1.25 === scaleLimit.min`；缩到底地图完整铺满 |
| A5 拖动不拖出视口 | 通过 | 最小比例拖动回正；放大拖边角仍盖满容器 |
| A6 长按 >300ms 仍下钻 | 通过 | 600ms 手势 `source=touch`，一次手势一次激活 |
| A7 触摸上点省份直接下钻 | 通过 | 单次轻点即进省级地图 |
| A8 弹层 inert 与焦点归还 | 通过 | 弹窗/面板打开 `.page-wrapper.inert=true`、焦点移入；关闭焦点归还 `#details-btn` / `#map` |
| A9 关闭后 `#bs-*` 不可 Tab | 通过 | 三个按钮 `hidden`，Tab 40 次不命中 |
| A10 地区一览等价路径 | 通过 | 35 行按钮；Enter 与点地图一致 |
| A11 `aria-sort` 只落当前列 | 通过 | 初始 `name=none/count=descending`，切换后互斥 |
| A12 ≤480px 无横向滚动 | 通过 | 375/414/480 三档 `scrollWidth<=clientWidth` |
| A13 reduce motion 不动画 | 通过 | canvas `animation=false`；标题 opacity=1；glow 隐藏；magnet 无位移 |
| A14 窄视口 `0 人` 刻度不压缩放控件 | 通过 | `left: center→56`、长度 `340→200`（读 `window.innerWidth`）；480px 截图 `shots/a14-bottom-strip-480.png` 显示 `0 人` 起点 x≈88，缩放簇右缘 x=71，不重叠 |
| A15 读屏数字跟随视野 | 通过 | 省级念「覆盖 N 座城市，共 M 位同学」，不含全国总数 |

## 3. 安全清单 S1–S8

| 条目 | 结论 | 证据 |
|------|------|------|
| S1 页面不引用 `js/data.js` | 通过 | 渲染页 HTML 无 `js/data.js`；`npm run build` 通过 |
| S2 无跨源 `<script src>` | 通过 | 渲染页 3 个 `<script>` 全部 `/_astro/*.js` 同源 |
| S3 无内联 `<script>` | 通过 | 非空白内联块 = 0（`src/` 里的动态 import 脚本被 Astro 编成外链 chunk） |
| S4 `script-src` 无 `unsafe-inline` | 通过 | `public/_headers` 与运行时 CSP 均为 `script-src 'self'`（`style-src` 保留既有 `unsafe-inline`） |
| S5 白名单与目录一致 | 通过 | `src/lib/geo-loader.ts` 31 项 === `js/province/*.js` 31 个，双向无缺无多 |
| S6 `CMapGeo.register` 前缀 | 通过 | 31 个省级文件 + `china.js` 前 200 字节前缀校验通过 |
| S7 非 Highcharts | 通过 | `src/`、`public/`、`index.html` 无 `highcharts` 引用 |
| S8 密钥只来自运行时 env | 通过 | `.dev.vars`、`js/data.js` 不在 git 索引；四个路由无密钥字面量，均经 `env.DETAILS_*` / `CLASS_MAP_DATA` |

补充（网络与源码无完整学生数据）：页面加载期间抓取的文档 + 全部 JS/JSON 响应均无夹具姓名（`示例*`）；
`/api/map/public` 无 `name`/`school` 字段；运行时文档响应头含 CSP(nosniff/DENY) 与 `Cache-Control: no-store`。

## 4. 视觉清单 V3.1–V3.3

- **V3.1**：`src/styles/main.css` `:root` 的 12 个必需变量逐一存在且取值等于契约（独立解析核对）。
- **V3.2**：11 组 CSS ↔ `src/styles/palette.ts` 同值对由 `check-contrast.js` 的 `assertSame` 断言（含 `heat` 六档亮度单调递减）。
- **V3.3**：`node scripts/check-contrast.js` 的 `check(root, fail)` 返回 **37**，覆盖
  `--color-text-muted` 在 `--color-bg-primary` 与 `--color-bg-secondary` 两处底色（非只对页面底断言）。
- `npm run build` 打印「静态断言 13 组（含对比度/调色板 37 项）」。

## 5. DoD#3 31 省数据与中文地名（新站 vs 旧站）

- 夹具：`.wrangler/parity/fixtures/parity-public.json`（31 省、60 城市、122 人），两侧喂同一份。
- **全国视野**：数据点 35 个（含全部省级区域）、色带满量程 5，逐字段（`name/value/cityCount/drilldownFile`）一致。
- **逐省下钻**：31 个省级视野的 `mapId` + 色带满量程 + 每个城市数据点逐字段**完全一致（mismatched=0）**。
- **正对照**：数据城市名与 GeoJSON 同名时正常上色且数值正确（北京 `东城区:1/西城区:3`、河北 `石家庄:2/唐山:1`、安徽 `合肥:1/芜湖:3`）。
- **已知现象（非回归）**：浙江 public `{"杭州市":3}`、四川 `{"成都市":2}` 带「市」后缀，GeoJSON 城市 feature 名为 `杭州/宁波/…`、`成都/自贡/…`（不带后缀），
  匹配失败 → 该省所有地块 `value=0`（不上色）；**新站与旧站逐字一致**（同一套匹配逻辑）。
- 完整快照：`.wrangler/parity/evidence/parity-31-provinces-snapshot.json`。

## 6. DoD#4 真实浏览器同源 POST（F-1 复核）

- `POST /api/auth/details`：浏览器带 `Origin: http://127.0.0.1:8912` → 200（200 + `Set-Cookie`），非 403。
- `POST /api/auth/logout`（**无 `Content-Type`**，正是 `checkOrigin` 会检查的形状）：浏览器带同源 `Origin` → 200 + 清 Cookie（`Max-Age=0`），非 403；「退出查看」前端路径同样如此。
- 反证（中间件确实在生效）：`curl -X POST /api/auth/logout`（无 Origin）→ **403 `Cross-site POST form submissions are forbidden`**；
  同一请求加 `-H "Origin: <站点源>"` → 200。即 §1.4 所述「有意的安全行为」。

## 7. 发现

### F-P1（非迁移回归，留裁决方决策）：触摸点不可下钻地区时面板 open-then-close

- 现象：触摸设备上轻点 `台湾`（不可下钻）→ 面板内容**先打开**（`#bottom-sheet.active`，渲染台湾公开卡），
  约 10ms 后被**同一次触摸合成的 `click`**（落在刚盖上的 `#bs-overlay`）触发 `closeSheet()` 关闭。
- 复现：`node .wrangler/parity/probe-touch-taiwan-tap.mjs http://127.0.0.1:8912`（新站）与 `…:8913`（旧站）。
- 证据：`docs/parity-touch-compare.md`，原始输出 `.wrangler/parity/evidence/parity-touch-new.txt` / `-old.txt`。
- 判定：**旧站（`git archive HEAD`）表现出完全相同的时序**（同样是 open → overlay click → close），
  故按等价性判据「新站与旧站一致」不构成迁移回归。此行为与 `AGENTS.md` smoke 13 的文字期望
  （「Tap 台湾: the sheet opens instead」）不符，属**等价性基线自身的既有问题**，由主控/裁决方决定是否
  单独开票修复基线（本节点只验证、不改实现）。
- 桌面端不受影响：cp1 smoke 4 中点击台湾面板正常打开并保持。

### 其他观察（不构成本节点不通过）

- 错误口令会产生一条浏览器 console 的 `Failed to load resource: 401`（`/api/auth/details`）——这是浏览器对失败 fetch 的常规记录，非 pageerror/CSP 报错。
- 视口宽度变化不会实时重建色带图例的长度（仅下一次 view change 重建），与 `AGENTS.md` 记录一致，旧站同源。

## 8. 与本节点的边界

- 本节点只验证与记录，**未修改任何实现文件**（`src/**`、`js/**`、`css/**`、`_headers`、`wrangler.jsonc` 等）。
- 证据脚本与存档均在 `.wrangler/parity/`（scratch，不属于交付物）；未新增任何依赖。

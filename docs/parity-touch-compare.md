# 触摸点不可下钻地区：新旧站对照记录（F-P1）

- 日期：2026-10-12；节点 `l3_parity`。
- 目的：判定「触摸点台湾 → 面板打开后立即关闭」是否为新站迁移回归。
- 方法：同一条 Playwright 脚本、同一触摸合成方式，分别打新站与旧站。

## 被测对象

| 站点 | 来源 | 地址 |
|------|------|------|
| 新站 | `npm run dev:local`（Worker 渲染路径 × astro build 产物） | `http://127.0.0.1:8912` |
| 旧站 | `git archive HEAD`（`main` 形态等价性基线）+ 同源 `/api` 顶替 | `http://127.0.0.1:8913` |

两侧喂同一份夹具（`scripts/local-runtime.mjs` 的 `FIXTURE_STUDENTS`）。

## 复现命令

```bash
# 旧站存档
rm -rf .wrangler/parity/old-site && mkdir -p .wrangler/parity/old-site
git archive HEAD | tar -x -C .wrangler/parity/old-site
node .wrangler/parity/old-site-server.mjs --port 8913 &

# 对照（Playwright `page.touchscreen.tap`，390×844 / hasTouch / isMobile）
TEMP="$PWD/.wrangler/probe-tmp" TMP="$TEMP" node .wrangler/parity/probe-touch-taiwan-tap.mjs http://127.0.0.1:8912
TEMP="$PWD/.wrangler/probe-tmp" TMP="$TEMP" node .wrangler/parity/probe-touch-taiwan-tap.mjs http://127.0.0.1:8913
```

## 读数（两边逐字一致）

`#bottom-sheet` 的 class 变更序列 + 合成 click 的落点：

```text
sheet-class  bottom-sheet active      ← 地图广播 map:region-activate(canDrill=false)，抽屉岛打开
click        target = bs-overlay      ← 同一次触摸在 touchend 后合成的 click，落在刚盖上的遮罩
sheet-class  bottom-sheet             ← closeSheet()
overlay-click                          ← #bs-overlay 的 click 监听触发
```

- 新站：`{ sheetActive:false, bsContent:"公开概况\n台湾\n0人\n覆盖城市 0 座…" }`
- 旧站：`{ sheetActive:false, bsContent:"公开概况\n台湾\n0人\n覆盖城市 0 座…" }`

原始输出：`.wrangler/parity/evidence/parity-touch-new.txt`、`.wrangler/parity/evidence/parity-touch-old.txt`。

## 判定

- 面板**确实打开过**（渲染出台湾公开卡），随即被同一次触摸的合成 click 关闭。
- **旧站（`main` 等价基线）行为完全相同**，因此这是基线既有行为，**不是新站迁移回归**。
- 与 `AGENTS.md` smoke 13 的文字期望不一致，属基线问题；是否单独开票修复由主控/裁决方决定。
- **桌面端不受影响**（cp1 smoke 4：点击台湾面板打开并保持）。

## 裁决记录（2026-10-13，用户）

- **裁定：接受等价性 override。** 不按 `AGENTS.md` 旧版 smoke 13 的文字期望（「Tap 台湾: the sheet opens instead」）判缺陷：
  新旧站事件序列逐字一致 → 这是**基线既有行为**，不是新站迁移回归；「面板打开过、随即被同一次触摸的合成 click 关掉」是既定语义。
- **随之落地的文字更正**（本次纯文档提交）：`AGENTS.md` smoke 13 已改写为实测口径 ——
  「轻点台湾＝打开信息面板，但同一次触摸合成的 click 会落在刚盖上的遮罩上把面板关掉」，
  并注明这是迁移前既有行为、引用本文件与证据。
- **有意不动**：不修改 `js/map.js` / `src/**` 的任何交互逻辑（本次裁定只改文档；若要修「打开后不被合成 click 关掉」，
  属独立开票，且需要重新过一轮触摸对照与 smoke 13）。
- **证据仍然有效**：`.wrangler/parity/evidence/parity-touch-{new,old}.txt`（scratch，未入库）、
  本文件 §读数 的 `sheet-class` / `click` 序列。

---

## 新裁定（2026-10-17，用户授权）：推翻 2026-10-13 的等价性 override

> 上文 §判定 与 §裁决记录（2026-10-13）**原文保留**，作为历史记录；其结论由本节取代。
> 本节是本次变更的定性依据：**经用户授权的主动偏离等价性基线（产品变更），不是迁移回归修复。**

- **新裁定**：上一节的「接受等价性 override」不再有效。「轻点台湾 → 面板打开后又被同一次触摸关掉」
  判定为**迁移前基线的缺陷**并修复；今后 parity 轮次看到「面板保持打开」是预期行为，**不得判成回归**。
- **根因**：触摸端的问题不是「面板不该打开」，而是**同一次触摸迟到的原生 click 打在了刚激活的全屏遮罩上**，
  把面板关掉。zrender 只在 `touchend` 距 `touchstart` <300ms 时补发 click
  （`zrender/lib/dom/HandlerProxy.js` 的 `TOUCH_CLICK_DELAY`），超出窗口的点击由 `TapFallback` 自己处理；
  但浏览器仍可能为同一次手势补发原生 click。落点分两种：**开面板**的手势（台湾轻点、长按）落在刚盖上的
  `#bs-overlay`；**轻点可下钻省份**时落在 `CANVAS` 上（见下文 T5 轨迹）。
- **不要用「加载层吸收 click」解释激活唯一性**：T5 当时 `echarts.init(#map)` 会经 zrender `Painter` 构造的
  `root.innerHTML = ''`（`zrender/lib/canvas/Painter.js:114`）把 `#map-loading` 从 DOM 删掉（轨迹
  `{"exists":false}`）；**2026-10-17 二次修订（T9）已把它移到 `.map-frame` 下、恢复可见**（见下文「二次修订」）。
  无论加载层在不在，激活去重的机制都是 `src/lib/tap-fallback.ts` 的 `ownsTouchGesture()` **让位守卫**
  （图表 `click`/`contextmenu` 先判它、来自触摸手势就跳过），加上 `#bs-overlay` 只认 `pointerdown`；
  浏览器补发的 DOM click 落点会随界面状态变化（下钻时落在可见的 `#map-loading`、开面板时落 `#bs-overlay`），
  不要依赖落点。
- **为什么 2026-10-12 没看出来**：zrender 的 UA 判据 `/Edge?\/([\d.]+)/` 匹配不到 `EdgA/`（Edge Android）
  与 `EdgiOS/`，所以安卓全系（含 Edge）都走 touch 分支；那次对照里新旧站序列逐字一致，只说明**两台被测
  浏览器都补发了迟到 click**。差异来自浏览器是否在长按/点按后补发 click，不是 zrender 分支差异。
- **修法**：`#bs-overlay` 的关闭触发由 `click` 改为 `pointerdown`（`#auth-overlay` 不动：它没有这个迟到
  click 问题）。该手势的 `pointerdown` 在遮罩还是 `pointer-events: none` 时就已派发，因此不会命中；
  鼠标点遮罩仍然即时关闭，正常的 `pointerdown`+`pointerup` 点击语义不变。
- **同批引入的手势语义**（与本节裁定同属一个产品变更）：
  - 全国视野：轻点 / 鼠标左键可下钻 → 下钻；不可下钻（台湾/香港/澳门/南海）→ 开面板。
  - 全国视野：**长按（≥300ms，位移 ≤14px）→ 开面板**；按压满 300ms 出现 `#map-press-ring` 按压反馈
    （`data-visible="true"`，`touchend` / `touchcancel` / 超过 2000ms 置回 `"false"`）。
  - 全国视野：**鼠标右键 → 开面板**（抑制浏览器右键菜单）。
  - 省级视野：轻点 / 长按 → 开面板。
  - **激活来源按输入设备区分**：鼠标 `source='map'`、触摸轻点 `'touch-tap'`、长按 `'touch-hold'`、
    右键 `'right-click'`；「地区一览」为 `'ledger'` / `'ledger-detail'`，抽屉按钮 `'sheet'`。
    一次手势必须恰好产生**一条**激活。
  - 「详情模式」（`#details-btn`）不再门禁地图点击：职责收窄为决定面板默认展开「同学信息」还是公开卡、
    以及承载「退出查看」；按钮已从地图框移到页头（`.plate__eyebrow` 行右侧）。
  - `TapFallback` 阈值：`MAX_MOVE_PX=14`、`HOLD_MIN_MS=300`、`MAX_DURATION_MS=2000`、`DEDUPE_MS=450`
    （原 `MAX_DURATION_MS=900`；>2000ms 的按压不算点击）；轻点与长按按持有时长分流
    （<300ms → 自动分流；300–2000ms → 强制面板）。

### 新的期望事件序列

同一条触摸脚本、同一读数口径（`#bottom-sheet` 的 class 变更序列 + 合成 click 的落点），390×844 / hasTouch / isMobile：

```text
sheet-class  bottom-sheet active      ← 地图广播 map:region-activate(canDrill=false)，抽屉岛打开
click        target = bs-overlay      ← 迟到 click 仍会落下，但遮罩只认 pointerdown，不再关闭
sheet-class  bottom-sheet active      ← 面板保持 active
sheetActive: true
```

- **判据**：触摸点台湾（不可下钻）后 `#bottom-sheet` 保持 `active`，`sheetActive === true`；内容为该地区
  公开卡（详情模式开启且已登录时为「同学信息」）。同一次手势只允许产生**一次**激活（`TapFallback` 与
  zrender / 浏览器补发的 click 之间由 `ownsTouchGesture()` 让位守卫兜住）。
- **回归覆盖**：`tests/map-touch.test.mjs`（`npm run test:touch`）用真 Chromium + CDP 原生触摸事件固化
  这条序列——轻点下钻、长按/右键/台湾轻点开面板且保持、地区一览键盘等价；这类缺陷只有真浏览器能抓，
  已经复发两次（本文件 F-P1 与 2026-10-17 这次），不再只靠人工 smoke。
- **证据留档**：2026-10-12 的读数与 2026-10-13 裁定的原文仍在上文，**不删除、不改写**；本节只追加取代关系。

### T5 实测轨迹（实现定格后，2026-10-17）

时钟以该次手势的 `touchstart` 为 0；轨迹来自真 Chromium（与 `npm run test:touch` 同一套触摸仿真），
`activations` 读 `window.__mapProbe.read().activations`。

```text
触摸轻点 北京（可下钻）
+17ms   touchstart
+30ms   touchend
+32ms   map:drill-start
+39ms   浏览器补发 click → target = CANVAS
+106ms  map:view-change
        activations = 1 条，source = "touch-tap"
```

- 轻点可下钻省份时，迟到 click 落在 **canvas** 上；`src/lib/map-island.ts` 的 `handleRegionClick`
  先判 `ownsTouchGesture()`、是触摸手势就直接 return，所以不会多出一条 `source='map'` 的激活。
- `#map-loading` 在 T5 时刻**不存在于 DOM**：`echarts.init()` 经 zrender `Painter` 构造的
  `root.innerHTML = ''`（`zrender/lib/canvas/Painter.js:114`）把静态加载层删掉了（T5 轨迹 `{"exists":false}`）。
  **这是修复前的状态**：T9 之后加载层已移到 `.map-frame` 下、下钻期间可见（下钻轨迹里的 DOM click 落点因此
  变成 `#map-loading`，见「二次修订」）；但无论落点如何，保证一次手势一条激活的仍是 `ownsTouchGesture()`
  对 zrender 内部合成 click 的让位——「迟到 click 被加载层吸收」不能当作去重机制。

```text
触摸长按 600ms 北京 / 轻点 台湾（不可下钻）
+638ms  touchend
+639ms  map:region-activate{source:"touch-hold"}   （台湾轻点为 source:"touch-tap"）
+676ms  浏览器补发 click → target = bs-overlay
        +250ms 与 +1250ms 两个观察点：面板仍 active
```

- 开面板的手势，迟到 click 落在刚盖上的 `#bs-overlay`；遮罩只监听 `pointerdown`
  （`src/lib/dialogs-island.ts` 的 `onOverlayPointerDown`），所以面板保持 active。
- 触摸长按还可能补发 `contextmenu`；同一让位守卫会跳过它，不会记成 `'right-click'`，
  也不会误触发右键分支。

---

## 2026-10-17 二次修订（T9 加载态 / T13 设备判别 / T14 归因更正）

> 这是**同一次产品变更（2026-10-17 用户授权）的后续修复**，不是新变更；上文 T5 轨迹记录的是修复前的状态。

- **T9 加载态可见性（已修）**：`#map-loading` 从 `#map` 内移到 **`.map-frame` 的直接子元素**（`#map` 的兄弟，
  几何/层叠不变），并加 `aria-hidden="true"`；下钻时 `display:flex` + 「正在加载 <省> 地图...」，完成后
  `display:none`。这样它不会再被 `echarts.init()` 的 zrender `Painter` 清理（`root.innerHTML=''`，
  `Painter.js:114`）删掉；读屏通路仍是 `#map[aria-busy]` 与页脚 `role=status`，加载层本身不进无障碍树。
  `.map-loading` 带 `background: var(--color-bg-primary-translucent)`（与 `.cdn-error` 同一 token），
  因为文案会压在有深端的 choropleth 上（`#35604d` 一类）。旧站同样是「加载层在 `#map` 里、被初始化删掉」的结构，
  所以这次可见化是**同一次变更的已记录改进（不是回归）**。证据：
  `MapSection.astro` 的加载层注释、`src/lib/map-island.ts:125-148`、`tests/map-touch.test.mjs:900-948`；
  T14 轨迹（`.wrangler/probe-tmp/t14-touch-valid.log`，scratch）：boot 后
  `exists=true aria-hidden=true insideMap=false display=none`，下钻时间线
  `none → flex（正在加载 北京 地图...）→ none`。
- **T13 设备判别（已加）**：`ownsTouchGesture()` 不再只看时间窗——在同一个 viewportRoot 上以 capture 阶段
  监听 `pointerdown`，记录 `pointerType === 'mouse'` 的时间戳（`src/lib/tap-fallback.ts:340-346`）；
  触摸窗口内出现真实鼠标按下（`lastMousePointerDownAt > lastTouchGestureAt`）就放行鼠标事件
  （`tap-fallback.ts:108-116`）。内核不给 `pointerdown` 时戳保持 0，自动退回「450ms 内一律让位」的旧行为
  （安全方向：宁可吞一次鼠标点击，不把一次触摸记成两条）。探针 `.wrangler/probe-tmp/pointer-probe.mjs`
  （scratch）：触摸轻点/长按**不会**补发 `pointerdown(mouse)`，派生 click 自带 `pointerType='touch'`；
  真实鼠标是 `pointerdown(mouse) → mousedown → mouseup → click(mouse)`。
- **T14 归因更正（关键）**：触摸结束后鼠标左键约 **700ms** 的死区**不是**这个守卫造成的，而是
  **zrender 自身的 `touching` 闸门**（旧站同版本 zrender 6.1.0，从 `90c182b:js/vendor/echarts.min.js`
  恢复比对 → **基线既有行为，不是本次引入**）。源码双证：
  - `zrender/lib/core/env.js:69-71`：`pointerEventsSupported` 只对 Edge/IE 为 true，所以
    Chrome/Firefox/Safari 走 touch+mouse 分支；
  - `zrender/lib/dom/HandlerProxy.js:38-48` 的 `setTouchTimer()` 把 `scope.touching` 保持 **700ms**；
  - 同文件 `:197-210`：这段窗口里 mouse 监听被整体跳过，触摸后的鼠标 click 根本到不了 ECharts。
  因此在 Chromium 上 `ownsTouchGesture()` 的鼠标放行分支**不可达**，T13 的收益只落在 pointer-events
  分支（Edge/IE）。
- **实测边界**（tests-ci 在 T14 实测；`tests/map-touch.test.mjs:889-896` 记录了同一组数字）：

  | 触摸结束后 Δ | `chart.on('click')` 派发 | 最终激活 | 归因 |
  |---|---|---|---|
  | Δ≈3ms（让位窗口内） | 0 | 无（不是被吞，是根本没到） | zrender `touching` 闸门 |
  | Δ≈628ms | 0 | 无 | 同上（<700ms） |
  | Δ≈668ms | 0 | 无 | 同上（<700ms） |
  | Δ≈741ms | 恢复 | 1 条 `source='map'` | 越过 700ms 闸门 |

  T14 回归用例的断言是「不变式 + 条件分支」：一次鼠标点击**最多一条**激活；click 到了图表时必须按设备
  放行（不吞、不记两条）；没到图表时必须 0 激活且不开面板；窗口外（≥900ms）同一动作必须生效
  （`tests/map-touch.test.mjs:950-1050`；T14 读数：窗口内 Δ=3ms `echartsClick=0 activations=[]`，
  窗口外 `source='map'` 且面板打开）。
- **理论盲区（map-core 上报，仍然保留、不写成已排除）**：若某内核违反规范、对触摸也补发**受信任的**
  `pointerdown(pointerType='mouse')`，让位窗口会放行合成 click。**Chromium 上 T19 实测（补丁 dist 反向）
  该失败形态是"误标 1 条"**——source 由 `'touch-tap'` 变成 `'map'`，而不是两条：450ms 去重吸收了
  TapFallback 那条，zrender 的 700ms 触摸-鼠标闸门又挡住了兼容 click，没有多余事件到达图表。
  在指针事件内核（Edge/IE）上还推得到一条**未实测**的路径：长按场景下 TapFallback 的激活与无闸门的
  兼容 click 可能并存 → 两条激活。因此这条仍是开放盲区。安全方向是让位；Android/iOS 实测无此行为。**页面脚本伪造已收口（T17，2026-10-17 用户授权）**：`handlePointerDown`
  现只接受 `event && event.isTrusted && event.pointerType === 'mouse'`（`src/lib/tap-fallback.ts:347`）——
  `dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }))` 造出的是 untrusted 事件，
  不会进戳，zrender 合成 click 保持 `'touch-tap'`、也不会多出第二条激活；老内核不返回 `isTrusted` 时
  条件为 falsy → 不记戳 → 退回「触摸窗口内一律让位」的安全方向。真实用户输入不受影响：真实触摸派生的
  click 自带 `pointerType='touch'`、其前没有 `pointerdown(mouse)`。回归用例：`test:touch` 第 11 条
  「页面脚本伪造 pointerdown 后真实轻点必须仍记 `source='touch-tap'`」——去掉 `isTrusted` 判定即复红
  （报 `实际 map`）。**注意与上一条是两条独立盲区**：`isTrusted` 只关掉「页面脚本伪造」这一条；
  「内核违反规范、合成 trusted 的 `pointerdown(pointerType='mouse')`」仍然保留，`isTrusted` 对它无效。
- **落点澄清（别把 T14 轨迹误读成「加载层吸收」）**：下钻的一次轻点里，浏览器补发的 DOM click 落点
  变成可见的 `#map-loading`（T14：+51ms 加载层 `flex`，+65ms `click target=map-loading`）——这只是落点事实；
  zrender 内部的合成 click 发生在加载层出现之前，靠的仍是 `ownsTouchGesture()` 让位，而不是加载层遮挡。

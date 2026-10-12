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

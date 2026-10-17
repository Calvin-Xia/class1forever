# 纸本图志 · DESIGN.md

> 金鹰 1 班蹭饭地图 视觉设计规范 · 版本 1.0
> 本文档是 `src/styles/main.css`、`src/styles/palette.ts`、`src/pages/index.astro`、`src/scripts/motion.ts` 的唯一视觉依据；迁移前的 `legacy/css/main.css`、`legacy/js/palette.js`、`legacy/index.html`、`legacy/js/motion.js` 只作对照，门禁与运行页都不再读它们。

---

## 1. Visual Theme & Atmosphere

### 设计哲学

把这张地图当成**一页手工地图册**来做，而不是一个「网页应用」。

页面是一张宣纸：底子是米白，纹理极轻，绛紫色的经纬网格压在纸面之下。地图不是贴着阴影浮起来的圆角卡片，而是**裱在纸页上的一幅图版** —— 只有发丝级的描边、四角的小切口、以及一圈比纸面稍深的衬底。信息层不是「UI」，是**印刷**：墨绿的字、朱砂的印、等宽的图例刻度。

### 氛围关键词

`宣纸` `墨绿` `朱砂印` `经纬网格` `图版` `发丝线` `印刷感` `安静`

### 一句话定调

**一页摊在书桌上的手绘地图册，墨还没干透。**

### 与旧版的差异（明确的转向）

| 维度 | 旧版 | 新版 |
|------|------|------|
| 色相 | 陶土橙 + 青 | 墨绿 + 朱砂（冷暖互换） |
| 中文字体 | 无中文字族，系统回退 | 思源宋体 + 思源黑体 |
| 卡片形态 | 20–28px 大圆角 + 重投影 | 2–4px 小圆角 + 发丝描边 |
| 装饰 | 漂浮渐变光斑、流动彩条 | 经纬网格、纸纹、光标墨晕 |
| 标题 | 渐变填充文字 | 纯墨色逐字落墨 |
| 图标 | emoji（⚠️） | 内联 SVG |
| 弹窗 | 毛玻璃遮罩 + 渐变按钮 | 纸面色遮罩 + 实色朱砂/墨绿 |

---

## 2. Color Palette & Roles

```css
:root {
    /* —— 纸面 —— */
    --color-bg-primary:            #f7f4ec;  /* 宣纸米白：页面底 */
    --color-bg-secondary:          #eae5d8;  /* 衬纸：内嵌区、地图无数据底色 */
    --color-bg-card:               #fffdf8;  /* 卡纸：抽屉、弹窗、按钮面 */
    --color-bg-sunken:             #f0ebdf;  /* 凹槽：输入框、次级按钮 */

    /* —— 墨 —— */
    --color-text-primary:          #17241f;  /* 墨绿黑：正文、标题、地图标注 */
    --color-text-secondary:        #4c5852;  /* 次级墨：说明文字、图例刻度 */
    --color-text-muted:            #5b6660;  /* 弱化墨：版权、辅助信息（衬纸上 4.75:1） */

    /* —— 主色：苔墨绿 —— */
    --color-accent-primary:        #4f7f63;  /* 焦点环、统计数字、热力第 4 档 */
    --color-accent-secondary:      #9ed3bd;  /* 墨色卡片上的强调文字 */
    --color-accent-strong:         #1f5245;  /* 实心按钮底、分享图头部起点 */
    --color-accent-strong-hover:   #1a4539;  /* 按钮 hover、热力第 6 档 */

    /* —— 副色：朱砂 —— */
    --color-accent-tertiary:       #a63c31;  /* 印章、详情按钮激活态 */
    --color-accent-tertiary-deep:  #8b2f26;  /* 朱砂 hover */
    --color-highlight:             #e0b463;  /* 藤黄：墨色卡片上的数值 */

    /* —— 线 —— */
    --color-border:                #ddd6c6;  /* 发丝线、地图省界 */
    --color-border-light:          #ebe6da;  /* 极浅分隔线 */
    --color-border-strong:         #c9c0ad;  /* 输入框、可交互控件描边 */

    /* —— 影 —— */
    --color-shadow:                rgba(23, 36, 31, 0.07);
    --color-shadow-dark:           rgba(23, 36, 31, 0.16);

    /* —— 墨色卡片（tooltip / 名册）—— */
    --color-ink-card:              #17241f;
    --color-ink-card-2:            #22322b;
    --color-ink-card-hover:        #2c3f37;
    --color-on-ink:                #f4f1e8;
    --color-on-ink-muted:          rgba(244, 241, 232, 0.74);
    --color-on-ink-line:           rgba(244, 241, 232, 0.16);

    /* —— 遮罩 —— */
    --color-scrim:                 rgba(23, 36, 31, 0.52);
}
```

**RGB 辅助值**（供 `rgba()` 组合使用，不单独定义变量）：
`--color-text-primary` = `23, 36, 31` · `--color-accent-strong` = `31, 82, 69` · `--color-accent-tertiary` = `166, 60, 49` · `--color-accent-primary` = `79, 127, 99`

### 热力色带（6 档，亮度严格递减）

| 档 | 色值 | 相对亮度 | 语义 |
|----|------|---------|------|
| 0 | `#eae5d8` | 0.785 | 无数据 / 0 人 |
| 1 | `#d2dbc2` | 0.683 | 1 档 |
| 2 | `#96b58a` | 0.414 | 2 档 |
| 3 | `#4f7f63` | 0.177 | 3 档（= accent-primary） |
| 4 | `#35604d` | 0.097 | 4 档 |
| 5 | `#1a4539` | 0.048 | 5 档（= accent-strong-hover） |

> 亮度必须单调递减，否则色阶不再对应人数 —— `scripts/check-contrast.js` 会逐档校验并让 `npm run build` 失败。

---

## 3. Typography Rules

### 字体族

```css
--font-display: 'Noto Serif SC', 'DM Serif Display', 'Songti SC', 'SimSun', serif;
--font-body:    'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
--font-mono:    ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Consolas', monospace;
```

**中文必须由中文字族承担**，英文字族只做拉丁字符的补充 —— 中文字族写在前面，靠 `font-family` 链自动分流。

### 自托管字体

两平台使用同源 `public/fonts/` WOFF2；`src/styles/fonts.css` 声明完整字族和字重。保留官方 OFL 许可证，固定上游提交、内容哈希和完整字集证据见 `public/fonts/manifest.json`。页面不再请求 Google Fonts。

完整字体源约 18.8MB，保存在非静态目录 `font-sources/`。当前两套 Noto 按完整 cmap 的 Unicode 顺序分片，通过 `unicode-range` 按需下载；DM Serif 保留完整哈希文件。分片库总大小约 23.5MB，优化对象是页面实际下载量，非字库总量。字体使用 `font-display: swap`；ECharts 首次测量地名与分享图绘字前显式等待对应字体。保留完整字集、字重轴、OFL 与可复现生成，不能只裁固定页面文案或依赖真实名单。覆盖、重建与浏览器实测见 [字体说明](docs/font-subsets.md) 和 [实施记录](docs/local-continuation-20261015.md)。

### 字号层级

| 角色 | 字号 | 行高 | 字距 | 字重 | 字体 |
|------|------|------|------|------|------|
| 主标题 `.page__title` | `clamp(2.25rem, 5.5vw, 3.75rem)` | 1.15 | 0.06em | 600 | display |
| 图志眉标 `.plate__eyebrow` | 0.78rem | 1.6 | 0.24em | 500 | mono |
| 描述 `.page__description` | `clamp(0.95rem, 2.2vw, 1.0625rem)` | 1.8 | 0.02em | 400 | body |
| 图幅信息 `dt` | 0.7rem | 1.5 | 0.18em | 500 | mono |
| 图幅信息 `dd` | 0.85rem | 1.6 | 0.02em | 400 | body |
| 正文 / 名册 | 0.9rem | 1.75 | 0.02em | 400 | body |
| 按钮 / 控件 | 0.88rem | 1.4 | 0.04em | 700 | body |
| 图例刻度（canvas） | 12px | — | — | 600 | body |

**硬性要求**：正文 ≥ 15px、行高 ≥ 1.7、字距 ≥ 0.02em。

**禁止**：仅配置英文字体让中文回退；`font-weight: 300` 以下的细体（思源宋体细体在浅底上会散）。

---

## 4. Component Stylings

### 4.1 图版卡片 `.map-container`

```css
.map-container {
    position: relative;
    padding: 16px;
    background: var(--color-bg-card);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    box-shadow: 0 1px 0 var(--color-border-light),
                0 18px 40px -28px var(--color-shadow-dark);
}
```
`≤768px` 时内边距收到 8px，`≤480px` 时 4px 且圆角降到 4px。图版内部 `.map-frame` 再上一层 1px `--color-border-light` 描边与 48px 经纬衬格。

> 命名注意：`.plate` 是**扉页的栅格容器**（正文 + 图幅信息栏），不是卡片；卡片本体是 `.map-container`。

### 4.2 主按钮 `.btn--primary`（墨绿实心）

| 状态 | 表现 |
|------|------|
| default | `background: var(--color-accent-strong)` `color: #fff` `border-radius: 3px` |
| hover | `background: var(--color-accent-strong-hover)` `transform: translateY(-1px)` |
| active | `transform: translateY(0)` `background: var(--color-accent-strong-hover)` |
| focus-visible | `outline: 2px solid var(--color-accent-primary); outline-offset: 2px` |
| disabled | `opacity: .55; cursor: not-allowed; transform: none` |

> **焦点环不得参与 transition** —— `transition: all` 会让 Tab 后的描边晚 150ms 才成形，看起来像没有焦点提示。只过渡 hover 会变的属性。

### 4.3 次按钮 `.btn--ghost`（纸面描边）

default `background: var(--color-bg-card); border: 1px solid var(--color-border-strong); color: var(--color-text-primary)`
hover `background: var(--color-bg-sunken); border-color: var(--color-text-secondary)`
active `background: var(--color-border-light)`
focus-visible 同 4.2 · disabled 同 4.2

### 4.4 工具栏芯片 `.chip`（返回 / 同学信息 / 层级徽标）

```css
.chip {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 40px; padding: 0 12px;
    background: rgba(255, 253, 248, 0.92);
    border: 1px solid var(--color-border-strong);
    border-radius: 3px;
    color: var(--color-text-secondary);
    font: 700 0.85rem/1 var(--font-body);
    letter-spacing: 0.04em;
}
```
- hover（可点击芯片）→ 墨底纸字：`background: var(--color-accent-strong); color: var(--color-bg-card)`
- 朱砂激活（`[data-active="true"]` 的同学信息）→ `background: var(--color-accent-tertiary); color: #fff`
- 移动端 `min-height: 44px`（触摸目标红线）

### 4.5 墨色标签卡 `.tooltip`

纸面上唯一的深色元素 —— 像一枚压印的铭牌。

```css
.tooltip {
    padding: 14px 16px;
    background: linear-gradient(155deg, var(--color-ink-card) 0%, var(--color-ink-card-2) 100%);
    border: 1px solid rgba(244, 241, 232, 0.10);
    border-radius: 3px;
    box-shadow: 0 14px 32px -18px rgba(23, 36, 31, 0.55);
}
```
- 顶部 2px 朱砂标线 `.tooltip::before`
- `.series` 眉标：`--color-accent-secondary`，0.68rem，字距 0.18em
- `.profile .name`：`--color-on-ink`，display 字体
- `.profile .value`：`--color-highlight`，700
- 名册行 `.pinfo`：发丝分隔 + 序号；hover → `--color-ink-card-hover`

### 4.6 名册（底部抽屉内容区）

非等大网格的**名录阵列**：
```
┌ 01  示例市 ──────────── 示例大学 ┐   ← 序号 + 城市分组头（mono，发丝下划线）
│  01  示例甲    示例市    示例大学  │   ← 交错入场，hover 底色上浮
│  02  示例乙    示例市    示例大学  │
└ 02  示例市乙 ────────────────────┘
```
- 城市分组头：`--color-accent-secondary`，mono，`border-bottom: 1px dashed var(--color-on-ink-line)`
- 行 hover：`background: var(--color-ink-card-hover)`
- 每行入场 `animation-delay: calc(var(--i) * 28ms)`

### 4.7 印章 `.plate__seal`

朱砂方印，右倾 3.5°，落印动画。
```css
.plate__seal {
    width: 54px; height: 54px;
    display: grid; place-items: center;
    background: var(--color-accent-tertiary);
    color: var(--color-bg-card);
    font: 600 1.05rem/1.05 var(--font-display);
    letter-spacing: 0.08em;
    border-radius: 2px;
    transform: rotate(-3.5deg);
    box-shadow: inset 0 0 0 2px rgba(255, 253, 248, 0.36);
}
```

### 4.8 输入框 `.auth-modal__input`

default `background: var(--color-bg-card); border: 1px solid var(--color-border-strong); border-radius: 3px; padding: 14px 16px`
focus `border-color: var(--color-accent-primary); box-shadow: 0 0 0 3px rgba(79, 127, 99, 0.16); outline: none`
disabled `background: var(--color-bg-sunken); color: var(--color-text-muted)`

### 4.9 焦点环（全局）

```css
:where(button, a, input, [tabindex]):focus-visible {
    outline: 2px solid var(--color-accent-primary);
    outline-offset: 2px;
    border-radius: 2px;
}
```
`#map` 与 `#bottom-sheet` 是**程序化焦点的锚点**（关闭弹层时把焦点还回去），保持 `outline: none`。

### 4.10 地区一览 `.region-ledger`

图表画在 canvas 上，地区和城市无法聚焦 —— 这块折叠表是键盘与读屏的**替代路径**，不是装饰。

- 外壳用原生 `<details>` + `<summary>`：天然可键盘操作、自带展开/折叠状态播报，默认收起，不把 34 行塞给所有人（`progressive-disclosure`）。
- 内部是原生 `<table>`：`<th scope="col">` 表头、`<th scope="row">` 地区名、`aria-sort` 只标在当前真正排序的那一列上。
- 每行**两个** `.region-table__btn`：「查看」（`data-action="view"`，轻点语义：可下钻则进省地图，否则开公开人数面板）与「详情」（`data-action="detail"`，强制开面板）。`aria-label` 必须说清按下去会发生什么（`进入 X 地图详情` / `查看 X 的公开人数`；「详情」为 `查看 X 的人数与同学信息`，未登录时补「需先输入口令」）。「详情」用 `.region-table__btn--secondary` 降一档呈现主次。
- **表头不许 `position: sticky`**：粘性表头 + `position: fixed` 的底部面板会一起盖住 Tab 进入的行内按钮（WCAG 2.2 2.4.11）。

```css
.region-table__btn {
    min-height: 36px;              /* ≤768px 提到 44px */
    padding: 0 14px;
    background: var(--color-bg-card);
    border: 1px solid var(--color-border-strong);
    border-radius: 3px;
    color: var(--color-text-primary);
    font: 700 0.82rem/1 var(--font-body);
    cursor: pointer;
    touch-action: manipulation;
}
.region-table__num {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;   /* 数字列不跳宽 */
}
```

### 4.11 面板头 `.bs-header`

显式标题 + 关闭按钮。**不要再用装饰横杠暗示「下滑关闭」** —— 本页没有实现拖拽，那是假提示。

```css
.bs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border-light);
}
.bs-close {
    width: 40px; height: 40px;      /* ≤768px 提到 44px */
    background: transparent;
    border: 0;
    border-radius: 3px;
    color: var(--color-text-secondary);
}
```
面板靠 `bottom` 位移收起、DOM 常驻，所以 `#bs-close` 与两个 `.bs-btn` 在面板非 `.active` 时**必须同时 `hidden`**，否则 Tab 会停在 y≈1660 的屏幕外控件上。

### 4.12 口令显隐开关 `.auth-modal__toggle`

口令是姓名拼音，打错了看不出来。开关贴在输入框右侧（输入框 `padding-right: 52px`）。

| 状态 | 表现 |
|------|------|
| default | `aria-pressed="false"`，眼睛图标，无斜杠 |
| revealed | `aria-pressed="true"`，`data-revealed="true"`，**多一道斜杠** + 字色转 `--color-accent-strong` |
| hover | `background: var(--color-bg-sunken)` |
| active | `background: var(--color-border-light)` |
| focus-visible | 同 4.9 |

状态**不能只靠颜色**：斜杠是给色觉障碍用户的第二个信号（`color-not-only`）。

### 4.13 图标系统 `.icon`

全部图标画在同一个 **24×24 网格**上，内容留在 3.2–20.8 之间。尺寸、线宽、端点、颜色只由
`src/styles/main.css` 的「图标系统」一节决定（迁移前同名节在 `legacy/css/main.css`，仅对照），**组件里不再各写一个 px 值**。

**尺寸只有四档**：

| 档位 | 尺寸 | 用在哪 |
|------|------|--------|
| `--icon-xs` | 14px | 折叠指示箭头 |
| `--icon-sm` | 16px | 工具栏芯片、缩放三键、两处关闭按钮 |
| `--icon-md` | 20px | 分享按钮、口令显隐 |
| `--icon-lg` | 24px | 加载失败面板 |

**线宽按网格反算**，让"渲染后"的视觉线宽恒定在 `--icon-stroke`（1.5px）：

```css
.icon     { stroke-width: calc(var(--icon-stroke) * 24 / 16); }  /* 16px 显示 */
.icon--xs { stroke-width: calc(var(--icon-stroke) * 24 / 14); }
.icon--md { stroke-width: calc(var(--icon-stroke) * 24 / 20); }
.icon--lg { stroke-width: calc(var(--icon-stroke) * 24 / 24); }
```

为什么不是"24 网格里都写同一个数"：同一个 `1.7` 在 16px 下只有 1.13px、在 24px 下却有
1.7px，并排就是一粗一细。实测四档的实际渲染值**全部是 1.50px**。

**图标清单与语义**（语义取自用途，不是取自图形长什么样）：

| 图形 | 语义 | 用在哪 |
|------|------|--------|
| 向下箭头入托盘 | 导出 / 保存（**不是**社交分享） | 分享按钮 |
| 左箭头 | 返回上层 | 「返回全国」 |
| 加 / 减号 | 缩放 | 缩放控件 |
| 四角括号 | 回到铺满视图 | 重置视图 |
| 右尖角（展开时转 90°） | 可展开 | 地区一览 |
| 叉号 | 关闭 | 面板头、口令弹窗 |
| 眼睛 + 斜杠 | 口令显隐 | 口令输入框 |
| 三角感叹号 | 加载失败 | 错误面板 |

**护栏**：

- 路径上**不写任何 `stroke-*` 表现属性**，否则会盖过 `.icon` 的 CSS。
- 图标一律是**内联 SVG**：不用 emoji、不用字体图标、不用文本字符当图标
  （原先 `#auth-close` 用的是文字「×」、返回按钮用的是「←」，两处都已换掉）。
- 装饰性图标 `aria-hidden="true"`；图标按钮的**可访问名写在按钮上**，不写在图标里。
- 同一页同一层级只用一种描边风格：本页全部是描边图标，没有填充图标。
- 新增图标时：24 网格 → 内容留在 3.2–20.8 → 只写 `d`/`points` → 挑一个尺寸档。

---

## 5. Layout Principles

- **容器**：页面 `max-width: 1320px`；图版 `max-width: 1180px`；地区一览与页脚同样 1180px
- **扉页栅格**：`grid-template-columns: minmax(0, 1fr) 216px`，右侧为图幅信息栏；≤900px 单列堆叠，信息栏转为横向两列
- **间距梯度**：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`（`--space-1` … `--space-8`）
- **图版内边距**：桌面 16px，移动 8px
- **地图高度**：`clamp(320px, 68vh, 760px)`
- **留白哲学**：宁可留白，不要填充。扉页与图版之间 48px，图版与页脚之间 24px。

---

## 6. Depth & Elevation

纸质界面几乎不用阴影，深度靠**线**和**衬底**表达。阴影只保留两级，且都极短、极散：

| 层级 | 用途 | 值 |
|------|------|-----|
| 0 平 | 纸面、芯片 | 无阴影，或 `0 1px 0 var(--color-border-light)` |
| 1 浮 | 图版、抽屉、弹窗 | `0 1px 0 var(--color-border-light), 0 18px 40px -28px var(--color-shadow-dark)` |
| 2 覆 | 墨色标签卡 | `0 14px 32px -18px rgba(23, 36, 31, 0.55)` |

**禁止**：`filter: drop-shadow` 叠加大范围模糊；卡片 hover 时把阴影从 0 直接跳到 48px 模糊。

---

## 7. Animation & Interaction

### 档位：L2 流畅交互

依赖：**零外部库**。纯 CSS 动画 + 一个同源脚本 `legacy/js/motion.js`（现役对应 `src/scripts/motion.ts`；原生 `IntersectionObserver` + `requestAnimationFrame`）。

> 为什么不用 GSAP / Lenis：本项目 CSP 为 `script-src 'self'`，跨域脚本直接被 `build.js` 拦下；且本页是单屏工具页，没有滚动叙事，引入滚动库只有成本没有收益。

### 7.1 氛围层（Background）

```css
.atmosphere {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image:
        /* 光标墨晕 */
        radial-gradient(560px circle at var(--mx, 50%) var(--my, 30%),
            rgba(79, 127, 99, 0.10), transparent 62%),
        /* 经纬网格 */
        repeating-linear-gradient(to right, rgba(23,36,31,0.045) 0 1px, transparent 1px 92px),
        repeating-linear-gradient(to bottom, rgba(23,36,31,0.045) 0 1px, transparent 1px 92px);
}
```
- `--mx / --my` 由 `legacy/js/motion.js`（现役 `src/scripts/motion.ts`）写入，**pointermove 必须 rAF 节流**
- 仅在 `matchMedia('(hover: hover)')` 下更新
- 纸纹用极低透明度 SVG `feTurbulence` 作 `data:` URI 背景（`img-src 'self' data:` 已放行）

### 7.2 首屏签名：标题逐字落墨

```css
.page__title .char {
    display: inline-block;
    opacity: 0;
    transform: translateY(0.5em);
    animation: ink-drop 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: calc(var(--i) * 55ms + 120ms);
}
@keyframes ink-drop {
    0%   { opacity: 0; transform: translateY(0.5em); letter-spacing: 0.3em; }
    60%  { opacity: 1; }
    100% { opacity: 1; transform: translateY(0); letter-spacing: inherit; }
}
```
**这里用 `letter-spacing` + `translateY`，不用 `filter: blur()`** —— 字距从松到紧已有「洇开」的观感，而 blur 会让 9 个字符同时占 GPU 内存。

### 7.3 印章落印

```css
@keyframes seal-stamp {
    0%   { opacity: 0; transform: rotate(-3.5deg) scale(1.6); }
    55%  { opacity: 1; transform: rotate(-3.5deg) scale(0.94); }
    100% { opacity: 1; transform: rotate(-3.5deg) scale(1); }
}
```

### 7.4 图版揭示

```css
@keyframes plate-reveal {
    from { opacity: 0; clip-path: inset(0 0 100% 0); }
    to   { opacity: 1; clip-path: inset(0 0 0 0); }
}
```
`clip-path` 单次动画，不产生持续合成层。

### 7.5 动效清单（L2 签名组合）

**首屏只保留两处内容动画**（`excessive-motion` 上限是 1–2 个/屏）：

1. `ink-drop` —— 标题逐字落墨；
2. `plate-reveal` —— 图版揭示。

其余（眉标、描述、图幅信息栏、印章、页脚）不再各自入场，跟着 `.page` 的整页淡入出现。
改版前首屏同时跑 **17 个动画 / 6 个动画组**，`document.getAnimations()` 一次就能数出来。

| 类别 | 落点 | 实现 |
|------|------|------|
| Text — Hero H1 | 标题逐字落墨（唯一的文字入场） | CSS `--i` 交错，700ms 一次性 |
| Text — Section H2 | 抽屉标题、地区一览标题 | 静态排版，不做动画 |
| Text — Label | 眉标字距收拢 | 静态 |
| Animation — 元素级 | 按钮磁吸（≤4px）、卡片聚光、`:active` 按下态 | `legacy/js/motion.js`（rAF 节流）+ CSS |
| Component — 交互构件 | 纸版抽屉 / 地区一览表 / 印章徽标 / 图例标尺 | CSS 过渡 + ECharts visualMap |
| Background — 氛围层 | 经纬网格 + 纸纹 + 光标墨晕 | CSS + `--mx/--my` |

### 7.6 性能红线（与爆点同等优先级）

- `filter: blur()` 不得用于任何移动中的元素
- `backdrop-filter: blur()` ≤ 14px，且不得覆盖大面积滚动区
- `pointermove` 必须 rAF 节流；`(hover: hover)` 之外不绑定
- 单页一次性入场动画结束后不保留 `will-change`
- 不使用 Lenis / scroll-jacking / pin

### 7.7 降低动效

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```
`legacy/js/motion.js` 在 `prefers-reduced-motion: reduce` 或 `(hover: none)` 下**完全不注册**光标/磁吸监听。

**ECharts 要单独处理**：地图画在 canvas 上，上面这段媒体查询够不着它。`legacy/js/map.js` 的
`chartAnimationEnabled()` 读同一个查询，喂给 `animation` / `animationDuration` /
`animationDurationUpdate`。实测开启降低动效后 `getOption().animation === false`、
`animationDuration === 0`。改动效时两半必须一起改，否则只降了一半。

---

## 8. Do's and Don'ts

### Do

1. **所有颜色走 CSS 变量**。`src/styles/main.css` 出现裸色值只允许三处例外，且都写在注释里说明原因：`:root` 的定义处、`.auth-modal__feedback[data-variant=...]` 的两个色值（`scripts/check-contrast.js` 用正则直接读它们，写 `var(...)` 会解析失败）、以及 `.atmosphere__grid` 遮罩里的 `black`（那是 alpha 通道，不是设计色）。
2. **改色必须同时改两处**：`src/styles/main.css` 的 `:root` 与 `src/styles/palette.ts` 的 `tokens`。`scripts/check-contrast.js` 有 13 对同值断言（迁移前的 `legacy/css/main.css` / `legacy/js/palette.js` 只是对照副本，不在断言里）。
3. **中文排版用中文字族**，行高 ≥ 1.7、字距 ≥ 0.02em、正文 ≥ 15px。
4. **发丝线优先于阴影**。想区分层级，先想「加一条线」，再想「加一层影」。
5. **热力色带逐档变深**，并保证 `mapLabel` 在最浅一档上 ≥ 4.5:1。
6. **焦点环用 `--color-accent-primary`**，`outline-offset: 2px`，且不参与 transition。
7. **触摸目标 ≥ 44×44px**（移动端）。
8. **图标一律内联 SVG**，`stroke: currentColor`，随文字颜色走。
9. **动效服务于「印刷」隐喻**：落墨、落印、翻页，而不是弹跳、光晕、粒子。
10. **保留全部既有 ID 与类名契约**（`legacy/js/map.js` 依赖它们）。
11. **对比度断言要覆盖一个色值实际落到的每一种底色**。`--color-text-muted` 曾经只对页面底断言（5.12:1），可它实际坐在衬纸上的两处（地图版权、比例尺刻度）只有 **4.48:1** —— 只对一种底色断言就是漏检。现在是 39 条（迁移前 37 条）。
12. **交互控件统一加 `touch-action: manipulation`**，`#map` 除外：它需要保留原生拖拽与双指缩放。

### Don't

1. **不要**再引入渐变填充文字（`-webkit-text-fill-color: transparent`）—— 与墨色印刷相悖。
2. **不要**再用漂浮的 `radial-gradient` 圆形光斑和 `gradient-flow` 流动彩条。
3. **不要**用 emoji 当图标。
4. **不要**用 12px 以上的圆角 —— 纸版是方的，圆角只做 2–4px 的「倒边」。
5. **不要**在移动元素上使用 `filter: blur()` 或大范围 `backdrop-filter`。
6. **不要**使用 `transition: all`（会把 focus ring 拖进过渡，破坏键盘可见性）。
7. **不要**硬编码色值到 `legacy/js/map.js` —— 画布颜色统一从 `CMapPalette` 取。
8. **不要**给地图容器加 `overflow: hidden` 之外的裁剪，也**不要**改 `aspectScale` 与 `BASE_ZOOM`（几何数据是 EPSG:3415 预投影）。
9. **不要**新增跨域 `<script>` 或内联 `<script>`（`build.js` 会直接失败）。
10. **不要**把 `#map` 变成可 Tab 聚焦的控件 —— 它只是焦点锚点；键盘选地区的路径是「地区一览」表。
11. **不要**给 `.region-table thead th` 加 `position: sticky`，也不要新增其他会盖住焦点的大面积粘性 UI（WCAG 2.2 2.4.11）。
12. **不要**用装饰元素暗示尚未实现的手势 —— 面板原来那条 2px 横杠就是在暗示「可下滑关闭」，代码里却没有拖拽处理。
13. **不要**让面板收起时把 `#bs-close` / `#bs-primary-btn` / `#bs-drilldown-btn` 留在焦点序列里。

---

## 9. Responsive Behavior

| 断点 | 策略 |
|------|------|
| ≥ 1024px | 扉页双栏（正文 + 216px 信息栏）；地图 `68vh`；工具栏横排单行 |
| 900–1024px | 扉页双栏收窄，信息栏 180px |
| 768–900px | 扉页单列，信息栏转为横向两列网格；地图 `62vh` |
| ≤ 768px | 抽屉居中为 `min(560px, calc(100% - 32px))`；芯片 `min-height: 44px`；缩放按钮 44×44；地图 `58vh` |
| ≤ 480px | 标题 `2rem`、图幅信息栏转单列；隐藏 `.map-credit` 与 `.map-scale`；地图 `clamp(280px, 52vh, 520px)`；地区表格内边距收到 8px；名册行允许换行 |
| ≤ 520px 高 + 横屏 | 地图 `clamp(220px, 52vh, 420px)`，扉页上下留白收紧。不加这条的话 `min-height: 320px` 会把地图顶到视口高度的 85%（实测 812×375） |
| 200% 文字放大 | 印章用 `em` 定尺寸跟着字号长（原来写死 54px，"蹭饭"两个字会顶出方框）；`.chip` 用 `min-height` 而非固定高度。实测无裁剪、无横向溢出 |

**触摸目标**：所有 `button` / `a` / `input` 在 ≤ 768px 下 `min-height: 44px`（`.map-zoom__btn` 为 44×44 方形，`.region-table__btn` 与 `.auth-modal__toggle` 同样提到 44px）。

**横向溢出**：≤ 600px 不允许出现横向滚动条；长地名用 `overflow-wrap: anywhere`，不用 `text-overflow: ellipsis` 截断关键信息。

**生成器**：`.map-credit` 与 `.map-scale` 在 ≤ 480px 隐藏，避免与缩放控件争夺右下角。

---

## 附：与既有工程约束的对应关系

| 约束来源 | 本规范如何满足 |
|----------|----------------|
| `build.js` 无内联/跨域脚本 | 动效集中在同源 `legacy/js/motion.js`（现役 `src/scripts/motion.ts`）；SVG 内联，无 CDN |
| `build.js` 无 Highcharts 残留 | 不受影响 |
| `check-contrast.js` 12 个必需变量 | §2 全部提供，且都在首个 `:root` 块内 |
| `check-contrast.js` 39 条断言 | 全部色值已按 WCAG 2.2 AA 核算通过（含「弱化墨/次级墨 × 衬纸」两对） |
| 13 对 CSS ↔ palette 同值 | §2 与 `src/styles/palette.ts` 的 `tokens` 一一对应（旧 `legacy/js/palette.js` 仅对照） |
| `_headers` CSP | 字体走同源 `/fonts/`（`font-src 'self'`）；纸纹用 `data:`（在 `img-src` 白名单） |
| `favicon.svg` 不含地图几何 | 32px 放不下中国地图规范要求的南海诸岛插图，任何按面积简化的国境线剪影都会把那些岛礁当碎点筛掉（早期版本确实丢了）。改用图志语汇：纸面 + 印章形方环 + 罗盘玫瑰，北点朱砂。手写 SVG，约 700 字节 |
| `legacy/js/map.js` 不可 `import` | 画布色与字体仍从 `window.CMapPalette` 读 |
| 几何数据不可手改 | 本规范不触碰 `js/china.js` 与 `js/province/*.js` |

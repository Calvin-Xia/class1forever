/**
 * 地图渲染与分享图共用的调色板（迁移自 `js/palette.js`，取值逐字不变）。
 *
 * 为什么是 TypeScript 模块而不是经典脚本 + 全局注册表：新站的地图与分享图由
 * TS/React 岛屿承载，可以正常 `import`，不再需要 `js/geo.js` 那种「经典脚本 +
 * `window.CMapPalette`」的绕路（那个绕路只是因为 `js/map.js` 不能用 import）。
 *
 * 两个真相源的分工：
 * - 页面侧：`src/styles/main.css` 的 `:root`（12 个必需变量都声明在那里）；
 * - 画布侧：本模块。ECharts 不认 CSS 变量，只能把同值 token 复制一份到 JS 侧。
 * 两边的对应关系写在每条的注释里，`scripts/check-contrast.js` 会逐对校验同值，
 * 只改一处就会让 `npm run build` 失败。
 *
 * ⚠️ 本文件必须保持「顶层 `export const` + `as const`、取值都是字面量」的稳定形状：
 * `scripts/check-contrast.js` 会摘掉 TS 语法后直接用 vm 求值来读这些取值。
 * 形状变了（改用函数、计算值或 `export default`）门禁会明确报错，不会静默放过。
 *
 * 设计依据见 DESIGN.md「纸本图志」：宣纸米白 + 墨绿 + 朱砂。
 */

/** 与 `src/styles/main.css` 的 `:root` 逐一对应的原始 token。 */
export const tokens = {
    paper: '#f7f4ec', // --color-bg-primary
    inset: '#eae5d8', // --color-bg-secondary
    border: '#ddd6c6', // --color-border
    ink: '#17241f', // --color-text-primary
    inkMuted: '#4c5852', // --color-text-secondary
    accent: '#4f7f63', // --color-accent-primary
    accentSoft: '#9ed3bd', // --color-accent-secondary
    accentStrong: '#1f5245', // --color-accent-strong
    accentStrongHover: '#1a4539', // --color-accent-strong-hover
    seal: '#a63c31', // --color-accent-tertiary
    highlight: '#e0b463' // --color-highlight
} as const;

/**
 * 画布上的字体也得跟 CSS 一致：ECharts 不认识 CSS 变量，
 * 写在这里至少让「页面字体」与「canvas 字体」只有一个来源。
 * 这里刻意不写 -apple-system / BlinkMacSystemFont：canvas 的 font 简写
 * 对非标准关键字更挑剔，整串解析失败会静默退回默认字体。
 */
export const fonts = {
    body: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    display: "'Noto Serif SC', 'Songti SC', 'SimSun', serif"
} as const;

export const palette = {
    /**
     * 人数越多颜色越深，第 0 档同时用作无数据地区的底色。
     * 后三档是逐步加深的同一色相，改色时保持亮度单调递减。
     * 第 1、2、5 档只在 canvas 上用，没有对应的 CSS 变量。
     */
    heat: [tokens.inset, '#d2dbc2', '#96b58a', tokens.accent, '#35604d', tokens.accentStrongHover],

    regionBorder: tokens.border,
    hoverArea: tokens.accentSoft,
    // 悬浮描边用朱砂：绿色色阶上，冷色描边会糊在一起，印章红才跳得出来。
    hoverBorder: tokens.seal,
    mapLabel: tokens.ink,
    mapLabelEmphasis: '#ffffff',
    visualMapText: tokens.inkMuted,
    snapshotBackground: tokens.inset,

    fonts,

    /**
     * 字外描边。地图标注与图例刻度都会压到深色地块上，
     * 靠一圈浅色（或深色）描边保住可读性，比例尺本体不铺底板。
     */
    mapLabelHalo: 'rgba(255, 253, 248, 0.92)',
    mapLabelEmphasisHalo: 'rgba(23, 36, 31, 0.55)',
    visualMapHalo: 'rgba(255, 253, 248, 0.92)',
    hoverShadow: 'rgba(166, 60, 49, 0.32)',
    indicatorShadow: 'rgba(23, 36, 31, 0.22)',

    share: {
        background: tokens.paper,
        /**
         * 头部渐变。整条带上压着 42px 白标题和 18px 白副标题，
         * 按渐变中点校验：9.76:1，两者都过 AA；
         * 起点用 accentStrong 而不是 accent（主绿上压不住白字）。
         */
        headerFrom: tokens.accentStrong,
        headerTo: tokens.accentStrongHover,
        headerTitle: '#ffffff',
        headerSubtitle: '#ffffff',
        legendPill: 'rgba(255, 255, 255, 0.94)',
        legendText: tokens.inkMuted,
        statsBackground: '#fbf7ec',
        statValue: tokens.accent,
        statLabel: tokens.inkMuted,
        footerBackground: tokens.inset,
        footerText: tokens.inkMuted,
        rule: 'rgba(23, 36, 31, 0.14)'
    }
} as const;

export type Tokens = typeof tokens;
export type Palette = typeof palette;

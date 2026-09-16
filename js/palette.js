/**
 * @fileoverview 地图渲染与分享图共用的调色板。
 *
 * css/main.css 的 :root 里有一份等值的 --color-* 变量，而 js/map.js 是经典脚本、
 * 不能用 import 读模块，所以这里沿用 js/geo.js 的做法：经典脚本 + 全局注册表，
 * 至少让 JS 这一侧只有一个来源。
 *
 * tokens 里逐条标了对应的 CSS 变量名，两边必须一起改；
 * scripts/check-contrast.js 会读这份调色板和 CSS 变量做对比度断言。
 */

(function (global) {
    'use strict';

    const tokens = {
        paper: '#faf7f2',              // --color-bg-primary
        inset: '#f5efe6',              // --color-bg-secondary
        border: '#e0d8cc',             // --color-border
        ink: '#2d2a26',                // --color-text-primary
        inkMuted: '#5c5650',           // --color-text-secondary
        accent: '#c4704b',             // --color-accent-primary
        accentSoft: '#e8a87c',         // --color-accent-secondary
        accentStrong: '#b05a38',       // --color-accent-strong
        accentStrongHover: '#a85a3a'   // --color-accent-strong-hover
    };

    global.CMapPalette = {
        /**
         * 人数越多颜色越深，第 0 档同时用作无数据地区的底色。
         * 后三档是逐步加深的同一色相，改色时保持亮度单调递减。
         */
        heat: [tokens.inset, '#e8c4a8', '#d9a87c', tokens.accent, '#b56540', tokens.accentStrongHover],

        regionBorder: tokens.border,
        hoverArea: tokens.accentSoft,
        hoverBorder: tokens.accent,
        mapLabel: tokens.ink,
        mapLabelEmphasis: '#ffffff',
        visualMapText: tokens.inkMuted,
        snapshotBackground: tokens.inset,

        share: {
            background: tokens.paper,
            /**
             * 头部渐变。整条带上压着 42px 白标题和 18px 白副标题，
             * 按渐变中点校验：4.91:1，两者都过 AA；
             * 起点用 accentStrong 而不是 accent（中点只有 4.26:1，副标题会差一点）。
             */
            headerFrom: tokens.accentStrong,
            headerTo: tokens.accentStrongHover,
            headerTitle: '#ffffff',
            headerSubtitle: '#ffffff',
            legendPill: 'rgba(255, 255, 255, 0.94)',
            legendText: tokens.inkMuted,
            statsBackground: '#fffaf5',
            statValue: tokens.accent,
            statLabel: tokens.inkMuted,
            footerBackground: tokens.inset,
            footerText: tokens.inkMuted
        }
    };
})(window);

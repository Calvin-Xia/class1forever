/**
 * @fileoverview 关键配色的对比度静态检查。
 *
 * 由 build.js 调用：任何一项不达标都会让 `npm run build` 失败，CI 也会一起拦下。
 *
 * 色值现在有两个来源，这里两个都读——css/main.css 的 :root 变量，以及
 * js/palette.js 里给地图和分享图用的调色板。两边本该保持一致，所以除了对比度，
 * 还顺带校验对应项是否同值：只改一处会立刻失败，而不是等分享图和页面颜色对不上
 * 才发现。
 *
 * 阈值按 WCAG 2.2 AA：正文 4.5:1，大字号（≥24px，或 ≥18.66px 粗体）3:1，
 * 焦点环这类非文字 UI 组件 3:1（1.4.11）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3;
const AA_UI = 3;

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** 支持 #rrggbb 与 rgb()/rgba()，已经解析过的颜色原样返回。 */
function parseColor(value) {
    if (value && typeof value === 'object' && typeof value.r === 'number') {
        return value;
    }

    const text = String(value === undefined || value === null ? '' : value).trim();

    const hex = HEX_PATTERN.exec(text);
    if (hex) {
        const number = parseInt(hex[1], 16);
        return {
            r: (number >> 16) & 255,
            g: (number >> 8) & 255,
            b: number & 255,
            a: 1
        };
    }

    const rgb = RGB_PATTERN.exec(text);
    if (rgb) {
        return {
            r: Number(rgb[1]),
            g: Number(rgb[2]),
            b: Number(rgb[3]),
            a: rgb[4] === undefined ? 1 : Number(rgb[4])
        };
    }

    return null;
}

/** 把半透明前景压到底色上，得到实际渲染出来的颜色。 */
function composite(front, back) {
    const alpha = front.a === undefined ? 1 : front.a;
    return {
        r: front.r * alpha + back.r * (1 - alpha),
        g: front.g * alpha + back.g * (1 - alpha),
        b: front.b * alpha + back.b * (1 - alpha),
        a: 1
    };
}

/** 两个实色各取一半，用来校验渐变中间那段（文字通常压在渐变中点）。 */
function mix(first, second) {
    return {
        r: (first.r + second.r) / 2,
        g: (first.g + second.g) / 2,
        b: (first.b + second.b) / 2,
        a: 1
    };
}

function channelLuminance(value) {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function luminance(color) {
    return 0.2126 * channelLuminance(color.r) +
        0.7152 * channelLuminance(color.g) +
        0.0722 * channelLuminance(color.b);
}

function contrastRatio(front, back) {
    const first = luminance(front);
    const second = luminance(back);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

/** 读 css/main.css 的 :root 自定义属性。 */
function readTokens(css) {
    const start = css.indexOf(':root');
    const block = start === -1 ? '' : css.slice(start, css.indexOf('}', start));
    const tokens = {};
    const pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let match = pattern.exec(block);

    while (match !== null) {
        tokens[match[1]] = match[2].trim();
        match = pattern.exec(block);
    }

    return tokens;
}

/** 取某条规则里的 color，规则名写错时返回 null，由调用方报失败。 */
function readRuleColor(css, selector) {
    const start = css.indexOf(selector);
    if (start === -1) {
        return null;
    }

    const block = css.slice(start, css.indexOf('}', start));
    const match = /(?:^|[\s;])color:\s*([^;]+);/.exec(block);
    return match ? match[1].trim() : null;
}

/** js/palette.js 是经典脚本，用 vm 跑一遍取全局注册表，与 build.js 读 geo.js 的方式一致。 */
function readPalette(rootDirectory) {
    const context = vm.createContext({ window: {} });
    vm.runInContext(
        fs.readFileSync(path.join(rootDirectory, 'js/palette.js'), 'utf8'),
        context,
        { filename: 'js/palette.js' }
    );
    return context.window.CMapPalette;
}

/** 报错时把解析后的颜色还原成可读文本，渐变中点这类计算值才不会打印成 [object Object]。 */
function formatColor(color) {
    const values = [color.r, color.g, color.b].map(function(value) {
        return Math.round(value).toString(16).padStart(2, '0');
    });
    const hex = '#' + values.join('');
    return color.a === undefined || color.a === 1 ? hex : hex + ' (' + color.a + ' alpha)';
}

function check(rootDirectory, fail) {
    const css = fs.readFileSync(path.join(rootDirectory, 'css/main.css'), 'utf8');
    const tokens = readTokens(css);
    const palette = readPalette(rootDirectory);

    const requiredTokens = [
        'color-bg-primary',
        'color-bg-card',
        'color-text-primary',
        'color-text-secondary',
        'color-text-muted',
        'color-accent-primary',
        'color-accent-secondary',
        'color-accent-strong',
        'color-accent-strong-hover',
        'color-accent-tertiary',
        'color-highlight',
        'color-border'
    ];
    const missingTokens = requiredTokens.filter(function(name) {
        return !tokens[name];
    });

    if (missingTokens.length > 0) {
        fail(`对比度检查需要的 CSS 变量不存在：${missingTokens.map(name => '--' + name).join('、')}`);
        return 0;
    }

    if (!palette || !palette.share || !Array.isArray(palette.heat)) {
        fail('js/palette.js 没有导出预期的调色板结构。');
        return 0;
    }

    let assertions = 0;

    function assert(label, foreground, background, minimum) {
        assertions += 1;
        const front = parseColor(foreground);
        const back = parseColor(background);

        if (!front || !back) {
            fail(`对比度检查读不懂颜色：${label}（${foreground} on ${background}）`);
            return;
        }

        const ratio = contrastRatio(composite(front, back), back);
        if (ratio < minimum) {
            fail(`${label} 对比度 ${ratio.toFixed(2)}:1，低于 ${minimum}:1（${formatColor(front)} on ${formatColor(back)}）`);
        }
    }

    function assertSame(label, actual, expected) {
        assertions += 1;
        const first = parseColor(actual);
        const second = parseColor(expected);

        if (!first || !second || first.r !== second.r || first.g !== second.g || first.b !== second.b) {
            fail(`${label} 两处色值不一致：${actual} 与 ${expected}，改色时请一起改。`);
        }
    }

    /* 页面文字 */
    assert('次要文字 --color-text-secondary 在页面底色上', tokens['color-text-secondary'], tokens['color-bg-primary'], AA_TEXT);
    assert('弱化文字 --color-text-muted 在页面底色上', tokens['color-text-muted'], tokens['color-bg-primary'], AA_TEXT);
    assert('正文色 --color-text-primary 在卡片底色上', tokens['color-text-primary'], tokens['color-bg-card'], AA_TEXT);

    /* 实心橙底上的白字：按钮 */
    assert('白字 on --color-accent-strong（实心按钮底色）', '#ffffff', tokens['color-accent-strong'], AA_TEXT);
    assert('白字 on --color-accent-strong-hover（按钮 hover/active）', '#ffffff', tokens['color-accent-strong-hover'], AA_TEXT);
    assert('白字 on --color-accent-tertiary（登录按钮渐变起点）', '#ffffff', tokens['color-accent-tertiary'], AA_TEXT);
    assert(
        '白字 on 登录按钮渐变中点',
        '#ffffff',
        mix(parseColor(tokens['color-accent-tertiary']), parseColor(tokens['color-accent-strong'])),
        AA_TEXT
    );

    /* 深色悬浮卡片上的文字 */
    assert('hover 卡片强调色 on 深色卡片', tokens['color-accent-secondary'], tokens['color-text-primary'], AA_TEXT);
    assert('hover 卡片高亮值 on 深色卡片', tokens['color-highlight'], tokens['color-text-primary'], AA_TEXT);

    /* 焦点环属于非文字 UI 组件，按 3:1 要求；它带 offset，落在浅色底上 */
    assert('焦点环 --color-accent-primary 在页面底色上', tokens['color-accent-primary'], tokens['color-bg-primary'], AA_UI);

    /* 口令反馈文字 */
    const errorColor = readRuleColor(css, '.auth-modal__feedback[data-variant="error"]');
    const successColor = readRuleColor(css, '.auth-modal__feedback[data-variant="success"]');
    if (!errorColor || !successColor) {
        fail('找不到 .auth-modal__feedback 的错误/成功配色规则，选择器可能被改过。');
    } else {
        assert('口令错误提示色在弹窗底色上', errorColor, tokens['color-bg-card'], AA_TEXT);
        assert('口令成功提示色在弹窗底色上', successColor, tokens['color-bg-card'], AA_TEXT);
    }

    /* 分享图：文字压在头部渐变上，按中点校验 */
    const shareMidpoint = mix(parseColor(palette.share.headerFrom), parseColor(palette.share.headerTo));
    assert('分享图标题（42px）在头部渐变中点', palette.share.headerTitle, shareMidpoint, AA_LARGE_TEXT);
    assert('分享图副标题（18px）在头部渐变中点', palette.share.headerSubtitle, shareMidpoint, AA_TEXT);
    assert('分享图统计数字（36px 粗体）', palette.share.statValue, palette.share.statsBackground, AA_LARGE_TEXT);
    assert('分享图统计标签（16px）', palette.share.statLabel, palette.share.statsBackground, AA_TEXT);
    assert('分享图页脚文字', palette.share.footerText, palette.share.footerBackground, AA_TEXT);
    assert(
        '分享图图例文字压在半透明胶囊上',
        palette.share.legendText,
        composite(parseColor(palette.share.legendPill), parseColor(palette.share.background)),
        AA_TEXT
    );

    /* 地图：标签压在最浅的热力色上（最深的几档另有白色描边兜底） */
    assert('地图标签在最浅热力色上', palette.mapLabel, palette.heat[0], AA_TEXT);

    /* CSS 与调色板的同值约定 */
    assertSame('热力色第 1 档 与 --color-bg-secondary', palette.heat[0], tokens['color-bg-secondary']);
    assertSame('热力色第 4 档 与 --color-accent-primary', palette.heat[3], tokens['color-accent-primary']);
    assertSame('热力色第 6 档 与 --color-accent-strong-hover', palette.heat[5], tokens['color-accent-strong-hover']);
    assertSame('地图边框 与 --color-border', palette.regionBorder, tokens['color-border']);
    assertSame('地图标签色 与 --color-text-primary', palette.mapLabel, tokens['color-text-primary']);
    assertSame('图例文字色 与 --color-text-secondary', palette.visualMapText, tokens['color-text-secondary']);
    assertSame('分享图统计数字 与 --color-accent-primary', palette.share.statValue, tokens['color-accent-primary']);
    assertSame('分享图头部起点 与 --color-accent-strong', palette.share.headerFrom, tokens['color-accent-strong']);
    assertSame('分享图头部终点 与 --color-accent-strong-hover', palette.share.headerTo, tokens['color-accent-strong-hover']);
    assertSame('分享图底色 与 --color-bg-primary', palette.share.background, tokens['color-bg-primary']);
    assertSame('快照底色 与 --color-bg-secondary', palette.snapshotBackground, tokens['color-bg-secondary']);

    /* 热力色带必须逐档变深，否则色阶不再对应人数 */
    const ramp = palette.heat.map(color => luminance(parseColor(color)));
    for (let index = 1; index < ramp.length; index += 1) {
        assertions += 1;
        if (ramp[index] >= ramp[index - 1]) {
            fail(`热力色带第 ${index + 1} 档不比第 ${index} 档深：${palette.heat[index - 1]} → ${palette.heat[index]}`);
        }
    }

    return assertions;
}

module.exports = { check };

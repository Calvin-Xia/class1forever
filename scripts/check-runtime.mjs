#!/usr/bin/env node
/**
 * 运行时门禁：真起一次 Worker（`wrangler dev` + 本地 KV，无需 Cloudflare 凭据），
 * 对**真实 HTTP 响应**断言四件静态检查做不到的事：
 *
 *   1. 渲染页的 `<script>` 全部带 `src`（没有任何内联脚本体）——ADR-0004 的水合前提；
 *   2. 文档响应（`/`）与静态资产响应（`/favicon.svg`）的安全响应头**逐条一致**
 *      （CSP / nosniff / referrer / x-frame-options / permissions-policy），
 *      缺失或不一致即失败：`public/_headers` 管静态资产、`src/lib/security-headers.ts` 管文档响应；
 *   3. 文档响应的 `script-src` 不含 `unsafe-inline`；
 *   4. 部署面拿不到不该拿的东西：`/.dev.vars`、`/js/data.js`（完整名单）、
 *      `/js/vendor/echarts.min.js`（已退役的自建产物）都必须不是 200；
 *      渲染页里也不含明细键 `students:raw:v1`。
 *
 * 用法：
 *   node scripts/check-runtime.mjs                 # 默认端口 8899、状态目录 .wrangler/local/state-gates
 *   node scripts/check-runtime.mjs --port 8901 --state-dir .wrangler/local/state-x
 *   npm run check:runtime
 *
 * 前置：先 `npm run build`（本地配置由 `dist/server/wrangler.json` 派生）。
 */
import path from 'node:path';
import { startLocalServer, writeLocalConfig, LOCAL_DIR } from './local-runtime.mjs';

const failures = [];
const passed = [];
const notes = [];

function fail(message) {
    failures.push(message);
}

function pass(label) {
    passed.push(label);
}

/** 五条安全响应头：文档响应与静态资产必须逐条一致。 */
const SECURITY_HEADERS = [
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Permissions-Policy'
];

function directiveOf(csp, name) {
    const match = String(csp || '').match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`, 'i'));
    return match ? match[1].trim() : '';
}

function argumentOf(argv, flag) {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
}

const argv = process.argv.slice(2);
const port = Number(argumentOf(argv, '--port') || process.env.GATES_PORT || 8899);
const stateDir = argumentOf(argv, '--state-dir') || path.join(LOCAL_DIR, 'state-gates');

try {
    writeLocalConfig();
} catch (error) {
    console.error(`❌ 派生本地运行时配置失败：${error && error.message ? error.message : error}`);
    console.error('   先跑 `npm run build` 生成 dist/（本脚本只读 dist/server/wrangler.json，不改产物）。');
    process.exit(1);
}

let server;
try {
    server = await startLocalServer({ port, persistTo: stateDir });
} catch (error) {
    console.error(`❌ 本地 Worker 未能就绪：${error && error.message ? error.message : error}`);
    console.error('   若提示端口占用，换 `--port`；若提示 dist 缺失，先 `npm run build`。');
    process.exit(1);
}

try {
    /* ── 文档响应 ─────────────────────────────────────────────────────────── */
    const response = await fetch(`${server.url}/`);
    const html = await response.text();
    console.log(`▶ GET / → ${response.status} ${response.headers.get('content-type')}（${html.length} 字节）`);

    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
    const inlineTags = scriptTags.filter((tag) => !/\ssrc\s*=/i.test(tag));
    const inlineBodies = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter(
        (match) => match[1].trim().length > 0
    );
    if (inlineTags.length > 0) {
        fail(`渲染页有 ${inlineTags.length} 个不带 src 的 <script>（内联脚本会被 CSP 拦掉、岛屿不会水合）：${inlineTags.join(' ')}`);
    }
    if (inlineBodies.length > 0) {
        fail(`渲染页有 ${inlineBodies.length} 个带脚本主体的内联 <script>。`);
    }
    if (scriptTags.length === 0) {
        fail('渲染页没有任何 <script>：岛屿（地图 / 抽屉 / 动效 / 分享）不会挂载。');
    } else if (inlineTags.length === 0) {
        pass(`渲染页 ${scriptTags.length} 个 <script> 全部带 src、0 个内联脚本`);
    }

    const scriptSources = scriptTags
        .map((tag) => (tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i) || [])[1])
        .filter(Boolean);
    for (const source of scriptSources) {
        if (!source.startsWith('/')) {
            fail(`渲染页引用了跨源脚本 ${source}：script-src 'self' 不允许，且 build.js 的同源断言也要求同源。`);
            continue;
        }
        const asset = await fetch(`${server.url}${source}`, { method: 'HEAD' });
        const contentType = asset.headers.get('content-type') || '';
        if (asset.status !== 200 || !/javascript/i.test(contentType)) {
            fail(`渲染页引用的脚本 ${source} 不可用：status=${asset.status} content-type=${contentType}`);
        }
    }
    if (scriptSources.length > 0) {
        pass(`${scriptSources.length} 个外链脚本 chunk 全部同源且 200 + JS content-type`);
    }

    const styleSources = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]
        .map((match) => (match[0].match(/\shref\s*=\s*["']([^"']+)["']/i) || [])[1])
        .filter(Boolean);
    const externalStyles = styleSources.filter((source) => !source.startsWith('/'));
    if (externalStyles.length > 0) {
        console.log(`    （外部样式表 ${externalStyles.length} 个：${externalStyles.join(', ')} —— 字体服务在 CSP style-src 白名单里，只记录不请求）`);
    }
    for (const source of styleSources.filter((source) => source.startsWith('/'))) {
        const asset = await fetch(`${server.url}${source}`, { method: 'HEAD' });
        if (asset.status !== 200) {
            fail(`渲染页引用的样式 ${source} 不可用：status=${asset.status}`);
        }
    }
    const localStyles = styleSources.filter((source) => source.startsWith('/'));
    if (localStyles.length > 0) {
        pass(`${localStyles.length} 个同源样式表可访问（token 随产物发布）`);
    }

    const documentHeaders = {};
    for (const name of SECURITY_HEADERS) {
        const value = response.headers.get(name);
        documentHeaders[name] = value;
        console.log(`    ${name}: ${value === null ? '(缺失)' : value}`);
        if (value === null) {
            fail(`文档响应缺少安全头 ${name}（src/lib/security-headers.ts 没有生效）。`);
        }
    }

    const scriptSource = directiveOf(documentHeaders['Content-Security-Policy'], 'script-src');
    if (!scriptSource) {
        fail('文档响应的 CSP 里没有 script-src 指令。');
    } else if (scriptSource.includes('unsafe-inline')) {
        fail(`文档响应的 script-src 含 unsafe-inline（${scriptSource}）。`);
    } else if (documentHeaders['Content-Security-Policy']) {
        pass(`文档响应 script-src = ${scriptSource}（无 unsafe-inline）`);
    }

    if (html.includes('students:raw:v1')) {
        fail('渲染页里出现明细 KV 键 students:raw:v1：明细数据不得进入客户端。');
    } else {
        pass('渲染页不含明细键 students:raw:v1');
    }

    /* ── 静态资产响应：安全头必须与文档响应逐条一致 ─────────────────────────── */
    const assetResponse = await fetch(`${server.url}/favicon.svg`, { method: 'HEAD' });
    console.log(`▶ HEAD /favicon.svg → ${assetResponse.status}（静态资产侧头部对照）`);
    let headerMismatch = 0;
    for (const name of SECURITY_HEADERS) {
        const documentValue = documentHeaders[name];
        const assetValue = assetResponse.headers.get(name);
        console.log(`    ${name}: ${assetValue === null ? '(缺失)' : assetValue.slice(0, 70)}`);
        if (assetValue === null) {
            fail(`静态资产响应缺少安全头 ${name}（public/_headers 没有生效或格式被改坏）。`);
            headerMismatch += 1;
        } else if (documentValue !== assetValue) {
            fail(`安全头 ${name} 在文档响应与静态资产响应上不一致：文档="${documentValue}" 资产="${assetValue}"。`);
            headerMismatch += 1;
        }
    }
    if (headerMismatch === 0) {
        pass(`文档响应与静态资产的 ${SECURITY_HEADERS.length} 条安全头逐条一致`);
    }

    /* ── 部署面不得可请求的路径 ───────────────────────────────────────────── */
    for (const [probePath, label] of [
        ['/.dev.vars', '本地密钥文件'],
        ['/js/data.js', '完整学生名单'],
        ['/js/vendor/echarts.min.js', '已退役的自建 ECharts 产物']
    ]) {
        const probe = await fetch(`${server.url}${probePath}`, { method: 'HEAD' });
        console.log(`    HEAD ${probePath} → ${probe.status}`);
        if (probe.status === 200) {
            fail(`${probePath}（${label}）返回 200：它不该能被请求到。`);
        } else {
            pass(`${probePath} 不可请求（status=${probe.status}）`);
        }
    }

    for (const note of notes) {
        console.log(`⚠️  ${note}`);
    }

    if (failures.length > 0) {
        for (const message of failures) {
            console.error(`❌ ${message}`);
        }
        console.error(`\n❌ 运行时门禁未通过（${failures.length} 条失败）。`);
    } else {
        console.log(`\n✅ 运行时门禁通过：${passed.length} 组断言（脚本全外链 ${scriptTags.length} 个、安全头两处一致、越权路径不可达）。`);
    }
} finally {
    server.stop();
}

process.exit(failures.length > 0 ? 1 : 0);

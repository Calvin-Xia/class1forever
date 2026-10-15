#!/usr/bin/env node
/**
 * 构建与静态安全门禁（**单入口**）。
 *
 * 用法：
 *   node build.js                 # 完整门禁：静态断言 → astro check → astro build → 产物断言
 *   node build.js --static-only   # 只跑静态断言（不调 astro，约 1 秒；改断言时用）
 *   node build.js --artifacts-only # 只跑产物断言（dist/ 必须已构建；诊断与负测试用）
 *   npm run build                 # 等价于 `node build.js`
 *
 * 门禁覆盖（对应 l3_gates 的 9 条 DoD）：
 *   A. 关键文件齐全（**面向新站**：不再把旧站 index.html / js/boot.js / functions 当必需；
 *      另外断言旧站入口**不在仓库根**，否则 astro dev 的 `/` 会被它遮蔽）
 *   B. 学生明细数据不得回到客户端（源码 + 产物两层）
 *   C. 脚本同源、HTML 无内联脚本（`.astro` 的 `is:inline` 无 src 即失败）、无 Highcharts 残留
 *   D. 省份白名单与 `js/province/` 目录逐名一致（两向）＋生成文件外形未被改动
 *   E. `script-src` 不允许 `unsafe-inline`（`public/_headers` 与 `src/lib/security-headers.ts` 两处）
 *   F. 对比度 + CSS↔画布调色板同值断言（`scripts/check-contrast.js`）
 *   G. 自建 ECharts vendor 链已按 ADR-0002 退役（产物、生成器、脚本、CI 步骤、引用面）
 *   H. `public/_headers` 与 `src/lib/security-headers.ts` 两处同源声明防漂移（逐条 + CSP 逐字）
 *   I. Node 版本门禁：`package.json` 的 engines、CI 的 node-version 与依赖 engines 互相匹配
 *   J. 类型检查：`astro check`（退出码必须为 0）
 *   K. 构建：`astro build`（退出码必须为 0）
 *   L. 产物断言：`dist/` 无 `.dev.vars`、客户端面向产物无密钥名/明细键/vendor 引用、
 *      `dist/client/_headers` 与源一致、`dist/server/wrangler.json` 在位
 *
 * 与旧门禁的关系：旧 build.js 守的是「静态 HTML + Pages Functions」形态；这一版守的是
 * 「Astro SSR Worker + Workers Assets」形态，断言强度不降（见 docs/build-gates.md 的对照表）。
 *
 * 注意（本机 Windows）：`astro build` 会清空 `dist/`；若有别的 dev server（`npm run dev:local`
 * / `test:api`）正持有 `dist/client`，会以 EPERM 失败。跑门禁前先确认 88xx/89xx 端口没有
 * 别的实例（本文件在 astro build 失败时会打印这条提示）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const checkContrast = require('./scripts/check-contrast.js');
const { localToolEnvironment } = require('./scripts/local-tool-env.cjs');

const rootDirectory = __dirname;
const argv = new Set(process.argv.slice(2));
const staticOnly = argv.has('--static-only');
const artifactsOnly = argv.has('--artifacts-only');

/** 断言失败信息（非空即退出码 1）。 */
const failures = [];
/** 通过项计数（汇总行用）。 */
const passed = [];
/** 不失败但值得写进日志的提示。 */
const warnings = [];

function fail(message) {
    failures.push(message);
}

function pass(label) {
    passed.push(label);
}

function warn(message) {
    warnings.push(message);
}

function absolute(relativePath) {
    return path.join(rootDirectory, relativePath);
}

function exists(relativePath) {
    return fs.existsSync(absolute(relativePath));
}

function read(relativePath) {
    return fs.readFileSync(absolute(relativePath), 'utf8');
}

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.astro', '.wrangler', '.graph', 'dist', 'coverage']);
const TEXT_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.astro', '.html', '.htm', '.css',
    '.json', '.jsonc', '.yml', '.yaml', '.md', '.txt', '.svg', '.mts', '.cts'
]);

/** 递归列出某个目录下的文件（相对仓库根的 POSIX 风格路径）。 */
function walk(relativeDirectory) {
    const found = [];
    const stack = [relativeDirectory];
    while (stack.length > 0) {
        const current = stack.pop();
        const full = absolute(current);
        if (!fs.existsSync(full)) {
            continue;
        }
        for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
            const relative = `${current}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!SKIP_DIRECTORIES.has(entry.name)) {
                    stack.push(relative);
                }
            } else if (entry.isFile()) {
                found.push(relative);
            }
        }
    }
    return found.sort();
}

/* ── A. 关键文件齐全（面向新站） ───────────────────────────────────────────── */

const requiredFiles = [
    'package.json',
    'astro.config.mjs',
    'tsconfig.json',
    'wrangler.jsonc',
    'public/_headers',
    'public/favicon.svg',
    'src/pages/index.astro',
    'src/layouts/BaseLayout.astro',
    'src/middleware.ts',
    'src/components/MapSection.astro',
    'src/components/BottomSheet.astro',
    'src/components/AuthModal.astro',
    'src/components/RegionLedger.astro',
    'src/lib/security-headers.ts',
    'src/lib/geo-loader.ts',
    'src/lib/map-bridge.ts',
    'src/lib/map-model.ts',
    'src/lib/map-island.ts',
    'src/lib/echarts.ts',
    'src/scripts/map-island-boot.ts',
    'src/scripts/dialogs-island-boot.ts',
    'src/scripts/share-boot.ts',
    'src/scripts/motion.ts',
    'src/styles/main.css',
    'src/styles/palette.ts',
    'js/china.js',
    'js/province',
    'shared/data-model.mjs',
    'scripts/check-contrast.js',
    'scripts/check-runtime.mjs',
    'scripts/local-runtime.mjs',
    'tests/api-contract.test.mjs',
    '.github/workflows/ci.yml'
];

for (const relativePath of requiredFiles) {
    if (!exists(relativePath)) {
        fail(`缺少必要文件: ${relativePath}`);
    }
}
pass(`关键文件齐全（${requiredFiles.length} 项）`);

/* 旧站入口不得回到仓库根：根 `index.html` 会被 Vite 的静态中间件先命中，`astro dev` 的
   `GET /` 就返回旧站页面而不是新站（`l2_motion` 的 F-2）——在 astro dev 里“验证首页”会验错
   对象。旧入口已归档到 `legacy/index.html`（与 `main:index.html` 逐字节相同），见 legacy/README.md。 */
if (exists('index.html')) {
    fail(
        '仓库根出现了 index.html：它会让 astro dev 的 GET / 返回旧站页面而不是新站' +
            '（Vite 静态中间件先于 Astro 路由）。旧入口的归档位置是 legacy/index.html，' +
            '请用 `git mv index.html legacy/index.html` 归位。'
    );
} else if (exists('legacy/index.html')) {
    pass('旧站入口已归档（仓库根无 index.html，legacy/index.html 在位）');
} else {
    warn('未找到归档的旧入口 legacy/index.html：它应与 main:index.html 逐字节相同，供对照与回滚。');
}

/* ── A2. 生成类型（wrangler types 的产物） ────────────────────────────────────
 * `worker-configuration.d.ts` 是 `npm run cf:types`（= `wrangler types`）的产物：
 * `Env` 的绑定类型与 `declare module 'cloudflare:workers'` 都在它里面，而
 * `src/pages/api/**` 的三个路由都 `import { env } from 'cloudflare:workers'`。
 * 官方（Cloudflare Workers → TypeScript）的建法是：**把生成类型提交进仓库**，并在 CI 里用
 * `wrangler types --check` 验证它没过时。这里把三种失败拦下来：
 *   ① 文件不存在（新树 / 漏提交）—— 不拦的话到 astro check 就是一条难懂的 ts(2307)
 *   ② 被 `.gitignore` 吞掉 —— 那样 CI 的新树永远拿不到它
 *   ③ 与 `wrangler.jsonc` 漂移 —— 改了绑定却忘了重跑生成（下面的 `--check`）
 */
const TYPES_FILE = 'worker-configuration.d.ts';
if (!exists(TYPES_FILE)) {
    fail(
        `缺少 ${TYPES_FILE}：它是 \`npm run cf:types\`（wrangler types）的产物，官方建议提交进仓库，` +
            '否则 CI 的新树里没有绑定类型（astro check 会报 ts(2307)）。跑一次 `npm run cf:types` 并提交生成结果。'
    );
} else {
    /* --no-index：按 .gitignore 的规则判定，不看索引。已跟踪的文件被补上一条例外规则同样会命中 ——
       那种状态会让人误以为它是「纯生成物」，下一个人就可能不再提交它。 */
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', TYPES_FILE], { cwd: rootDirectory });
    if (ignored.error || typeof ignored.status !== 'number') {
        warn('本机没有可用的 git，跳过「生成类型是否被 .gitignore 匹配」这一条。');
    } else if (ignored.status === 0) {
        fail(
            `${TYPES_FILE} 被 .gitignore 的规则匹配了：生成类型必须提交进仓库（官方建议），不要把它当生成物忽略掉 ——` +
                '一旦它没被跟踪，CI 的新树就会缺绑定类型（astro check 报 ts(2307)）。'
        );
    } else {
        pass(`生成类型 ${TYPES_FILE} 在位且未被 .gitignore 匹配`);
    }
}

/* ── B. 明细数据 / 密钥名不得出现在客户端面 ─────────────────────────────── */

/** 明细键：只能出现在服务端数据层、本地通路、测试与文档里。 */
const RAW_KEY = 'students:raw:v1';
/** 明细数据文件：只允许上传脚本、测试与文档提到它。 */
const DETAIL_DATA_FILE = 'js/data.js';
/** 会进入浏览器 / 静态资源的目录（含以后新增的 src/lib/* 客户端模块）。 */
const CLIENT_SURFACE_PREFIXES = [
    'src/components/',
    'src/scripts/',
    'src/layouts/',
    'src/styles/',
    'src/pages/',
    'src/lib/',
    'public/',
    'js/'
];
/** 明确属于服务端的源码：数据层、鉴权、安全头、中间件与 API 路由。 */
const SERVER_ONLY_FILES = new Set([
    'src/lib/data.ts',
    'src/lib/api-handlers.ts',
    'src/lib/auth.ts',
    'src/lib/http.ts',
    'src/lib/types.ts',
    'src/lib/security-headers.ts',
    'src/middleware.ts',
    'js/data.js'
]);

function isClientSurface(file) {
    if (SERVER_ONLY_FILES.has(file) || file.startsWith('src/pages/api/')) {
        return false;
    }
    return CLIENT_SURFACE_PREFIXES.some((prefix) => file.startsWith(prefix));
}

const sourceFiles = [...walk('src'), ...walk('public'), ...walk('js'), ...walk('shared')];

for (const file of sourceFiles) {
    if (!isClientSurface(file) || !TEXT_EXTENSIONS.has(path.extname(file))) {
        continue;
    }
    const text = read(file);
    if (text.includes(RAW_KEY)) {
        fail(`${file} 引用了明细 KV 键 ${RAW_KEY}：它只能出现在服务端数据层（src/lib/data.ts / shared/data-model.mjs），不能进客户端与静态资源。`);
    }
    if (text.includes(DETAIL_DATA_FILE)) {
        fail(`${file} 引用了 ${DETAIL_DATA_FILE}：完整学生名单不能回到静态资源里（只有上传脚本与测试可以读它）。`);
    }
    if (/DETAILS_(PASSPHRASE|SESSION_SECRET)/.test(text)) {
        fail(`${file} 提到了口令/会话密钥的变量名：它们只能出现在服务端路由与本地通路脚本里，客户端出现即视为泄露面。`);
    }
}
pass('明细数据与密钥名未进入客户端面（源码层）');

/* ── C. 脚本同源、无内联脚本、无 Highcharts ───────────────────────────────── */

for (const file of [...walk('src'), ...walk('public')]) {
    const extension = path.extname(file);
    if (extension !== '.astro' && extension !== '.html') {
        continue;
    }
    const text = read(file);
    for (const match of text.matchAll(/<script\b[^>]*>/gi)) {
        const tag = match[0];
        const sourceMatch = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i);
        const hasSource = Boolean(sourceMatch);
        const isInline = /\sis:inline\b/i.test(tag);
        if (isInline && !hasSource) {
            fail(`${file} 里有 <script is:inline>（无 src）：内联脚本会被 CSP script-src 'self' 拦掉，请按 ADR-0004 用 <script> + 动态 import + createRoot。`);
        }
        if (hasSource && /^(https?:)?\/\//i.test(sourceMatch[1])) {
            fail(`${file} 引用了跨源脚本 ${sourceMatch[1]}；脚本必须同源加载。`);
        }
    }
}

/* Highcharts 残留：旧站换 ECharts 时留下的硬约束，继续守。 */
for (const file of [...walk('src'), ...walk('js'), ...walk('public'), ...walk('css')]) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) {
        continue;
    }
    if (/highcharts/i.test(read(file))) {
        fail(`${file} 仍在引用 Highcharts。`);
    }
}
pass('脚本同源、无内联脚本、无 Highcharts 残留');

/* ── D. 省份白名单与 js/province 一致 ─────────────────────────────────────── */

const geoLoaderSource = read('src/lib/geo-loader.ts');
const whitelistMatch = geoLoaderSource.match(/export const AVAILABLE_PROVINCE_FILES[^=]*=\s*\[([\s\S]*?)\]/);
if (!whitelistMatch) {
    fail('src/lib/geo-loader.ts 里找不到 AVAILABLE_PROVINCE_FILES 的字面量数组（门禁靠它比对 js/province/）。');
} else {
    const declared = [...whitelistMatch[1].matchAll(/['"]([a-z0-9_]+)['"]/gi)].map((match) => match[1]).sort();
    const onDisk = fs
        .readdirSync(absolute('js/province'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => name.replace(/\.js$/, ''))
        .sort();

    const missing = onDisk.filter((name) => !declared.includes(name));
    const extra = declared.filter((name) => !onDisk.includes(name));
    if (missing.length > 0) {
        fail(`src/lib/geo-loader.ts 的 AVAILABLE_PROVINCE_FILES 缺少: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
        fail(`src/lib/geo-loader.ts 的 AVAILABLE_PROVINCE_FILES 多出: ${extra.join(', ')}`);
    }

    if (!/import\.meta\.glob\(\s*['"]\.\.\/\.\.\/js\/province\/\*\.js['"]\s*\)/.test(geoLoaderSource)) {
        fail('src/lib/geo-loader.ts 的省级懒加载 glob（../../js/province/*.js）被改过：白名单与真实可加载文件会脱钩。');
    }

    /* 生成文件外形（上游生成 + 零改动约束，ADR-0003）：注册调用必须还在。 */
    for (const slug of onDisk) {
        if (!read(`js/province/${slug}.js`).slice(0, 200).startsWith(`CMapGeo.register("cn/${slug}",`)) {
            fail(`js/province/${slug}.js 没有以 CMapGeo.register("cn/${slug}", ...) 开头。`);
        }
    }
    if (!read('js/china.js').startsWith('CMapGeo.register("cn/china",')) {
        fail('js/china.js 没有以 CMapGeo.register("cn/china", ...) 开头。');
    }
    pass(`省份白名单与 js/province/ 一致（${onDisk.length} 个省）`);
}

/* ── E. script-src 不允许 unsafe-inline ──────────────────────────────────── */

/** 取出某个 CSP 串里的某条指令（如 script-src）。 */
function directiveOf(csp, name) {
    const match = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s([^;]*)`, 'i'));
    return match ? match[1].trim() : '';
}

/* ── H. 两处同源声明防漂移（先解析，E 复用） ───────────────────────────────── */

/** 解析 public/_headers 里 `/*` 段落的头部表（返回 [name, value] 数组，保序）。 */
function parseHeadersFile(text) {
    const headers = [];
    let currentSection = null;
    for (const rawLine of text.split(/\r?\n/)) {
        if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) {
            continue;
        }
        if (/^\s/.test(rawLine)) {
            const match = rawLine.match(/^\s+([A-Za-z-]+):\s*(.*)$/);
            if (match && currentSection === '/*') {
                headers.push([match[1], match[2].trim()]);
            }
            continue;
        }
        currentSection = rawLine.trim();
    }
    return headers;
}

/** 解析 src/lib/security-headers.ts 的 DOCUMENT_SECURITY_HEADERS（只读字面量对）。 */
function parseSecurityHeadersTable(text) {
    const body = text.match(/DOCUMENT_SECURITY_HEADERS[^=]*=\s*\[([\s\S]*?)\n\];/);
    if (!body) {
        return null;
    }
    return [...body[1].matchAll(/\[\s*'([A-Za-z-]+)'\s*,\s*(?:'([^']*)'|"([^"]*)")\s*\]/g)].map((match) => [
        match[1],
        match[2] === undefined ? match[3] : match[2]
    ]);
}

const headersFile = read('public/_headers');
const declaredStaticHeaders = parseHeadersFile(headersFile);
const documentHeaders = parseSecurityHeadersTable(read('src/lib/security-headers.ts'));

if (declaredStaticHeaders.length === 0) {
    fail('public/_headers 里没有解析到任何头部（`/*` 段落的缩进格式可能被改过）。');
}
if (!documentHeaders || documentHeaders.length === 0) {
    fail('src/lib/security-headers.ts 里解析不到 DOCUMENT_SECURITY_HEADERS 的字面量表。');
} else if (declaredStaticHeaders.length !== documentHeaders.length) {
    fail(
        `响应头两处声明条数不一致：public/_headers ${declaredStaticHeaders.length} 条 vs ` +
            `src/lib/security-headers.ts ${documentHeaders.length} 条（静态资产走 _headers，文档响应走 TS 表）。`
    );
} else {
    for (let index = 0; index < declaredStaticHeaders.length; index += 1) {
        const [staticName, staticValue] = declaredStaticHeaders[index];
        const [documentName, documentValue] = documentHeaders[index];
        if (staticName !== documentName) {
            fail(`响应头第 ${index + 1} 条名字不一致：public/_headers 是 ${staticName}，src/lib/security-headers.ts 是 ${documentName}。`);
        } else if (staticValue !== documentValue) {
            fail(`响应头 ${staticName} 取值不一致：public/_headers 与 src/lib/security-headers.ts 必须逐字相同（CSP 尤其）。`);
        }
    }
    if (failures.length === 0) {
        pass(`响应头两处声明逐条一致（${declaredStaticHeaders.length} 条）`);
    }
}

for (const [file, headers] of [
    ['public/_headers', declaredStaticHeaders],
    ['src/lib/security-headers.ts', documentHeaders || []]
]) {
    const csp = (headers.find(([name]) => name.toLowerCase() === 'content-security-policy') || [])[1] || '';
    const scriptSource = directiveOf(csp, 'script-src');
    if (!scriptSource) {
        fail(`${file} 的 CSP 里没有 script-src 指令。`);
    } else if (scriptSource.includes('unsafe-inline')) {
        fail(`${file} 的 script-src 仍包含 unsafe-inline。`);
    }
}
if (failures.length === 0) {
    pass('script-src 两处都没有 unsafe-inline');
}

/* ── F. 对比度与调色板同值断言 ────────────────────────────────────────────── */

const contrastAssertions = checkContrast.check(rootDirectory, fail);
pass(`对比度 / 调色板同值断言（${contrastAssertions} 项）`);

/* ── G. 自建 ECharts vendor 链已退役（ADR-0002） ───────────────────────────── */

const vendorArtifacts = ['js/vendor/echarts.min.js', 'scripts/build-vendor.mjs'];
for (const relativePath of vendorArtifacts) {
    if (exists(relativePath)) {
        fail(`${relativePath} 应已按 ADR-0002 退役（ECharts 直接由 Vite 从 npm 打包，不再提交自建 bundle）。`);
    }
}

const packageJson = JSON.parse(read('package.json'));
if (packageJson.scripts && packageJson.scripts['vendor:build']) {
    fail('package.json 里仍有 vendor:build 脚本；自建 vendor 链退役后它不应存在。');
}
const hasEchartsDependency = ['dependencies', 'devDependencies'].some(
    (key) => packageJson[key] && packageJson[key].echarts
);
if (!hasEchartsDependency) {
    fail('package.json 缺少 echarts 依赖：新站的 ECharts 走 Vite 打包 npm 依赖（ADR-0002）。');
}

const ciWorkflow = read('.github/workflows/ci.yml');
if (/build-vendor|vendor:build/.test(ciWorkflow)) {
    fail('CI 工作流里仍有自建 vendor 产物的同步步骤（ADR-0002 要求连同产物一起退役）。');
}

/* “引用”取的是「真的去加载它」：`src=` / `import()` / `from '…'` / `fetch('…'`。
   文档注释里提到这个路径（例如 src/lib/echarts.ts 说明模块集对应关系）不算引用。
   迁移前的经典脚本 js/boot.js / js/map.js 仍写着这条路径，但它们是仓库根的**等价性对照资产**
   （与 main 保持零 diff，见 docs/cutover-runbook.md §7），不在本断言的扫描面内；
   扫描面只覆盖新站会真正送达浏览器的位置（src/、public/、package.json、astro.config.mjs、CI）。
   旧入口 index.html 已归档到 legacy/（见 legacy/README.md）。 */
const VENDOR_LOAD_PATTERN = /(?:\ssrc\s*=\s*|import\s*\(\s*|from\s+|fetch\s*\(\s*)['"`]?[^'"`\n]*js\/vendor\/echarts\.min\.js/;
const vendorReferenceSurface = [...walk('src'), ...walk('public'), 'package.json', 'astro.config.mjs', '.github/workflows/ci.yml'];
for (const file of vendorReferenceSurface) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) {
        continue;
    }
    if (VENDOR_LOAD_PATTERN.test(read(file))) {
        fail(`${file} 仍会加载 js/vendor/echarts.min.js：新站必须走 npm 的 echarts（ADR-0002）。`);
    }
}
if (failures.length === 0) {
    pass('自建 ECharts vendor 链已退役且无人加载');
}

/* ── I. Node 版本门禁（CI 的 node-version 与依赖 engines 匹配） ─────────────── */

function parseVersion(text) {
    const match = String(text).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

function compareVersions(a, b) {
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) {
            return a[index] < b[index] ? -1 : 1;
        }
    }
    return 0;
}

/**
 * 极简 semver 判定：只支持门禁实际会用到的形式（`>=`、`>`、`<=`、`<`、`^`、精确版本、
 * 空格表示「同时满足」、`||` 表示「任一满足」）。遇到不认识的形式返回 null（门禁按失败处理），
 * 这样依赖若是换了 range 写法，我们会明确报错而不是静默放过。
 */
function satisfies(version, range) {
    const alternatives = String(range).split('||');
    for (const alternative of alternatives) {
        const comparators = alternative.trim().split(/\s+/).filter(Boolean);
        if (comparators.length === 0) {
            return null;
        }
        let all = true;
        for (const comparator of comparators) {
            const match = comparator.match(/^(>=|<=|>|<|\^|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
            if (!match) {
                return null;
            }
            const target = [Number(match[2]), Number(match[3] || 0), Number(match[4] || 0)];
            const order = compareVersions(version, target);
            const operator = match[1] || '=';
            let ok;
            switch (operator) {
                case '>=':
                    ok = order >= 0;
                    break;
                case '>':
                    ok = order > 0;
                    break;
                case '<=':
                    ok = order <= 0;
                    break;
                case '<':
                    ok = order < 0;
                    break;
                case '^':
                    ok = order >= 0 && version[0] === target[0];
                    break;
                default:
                    ok = order === 0;
            }
            if (!ok) {
                all = false;
                break;
            }
        }
        if (all) {
            return true;
        }
    }
    return false;
}

const localNode = process.version;
const localNodeVersion = parseVersion(localNode);
const engines = packageJson.engines || {};
if (!engines.node) {
    fail('package.json 缺少 engines.node：Node 版本下限必须写进依赖清单（astro 6 要求 >=22.12.0），门禁才能比对。');
}

const ciNodeRaw = (ciWorkflow.match(/^\s*node-version:\s*(.+)$/m) || [])[1];
const ciNodeMatch = ciNodeRaw && ciNodeRaw.trim().replace(/['"]/g, '').match(/^(\d+)(?:\.\d+)*$/);
const ciNodeVersion = ciNodeMatch ? parseVersion(ciNodeMatch[1]) : null;
if (!ciNodeVersion) {
    fail(
        `CI 的 node-version 解析失败（读到 ${ciNodeRaw ? ciNodeRaw.trim() : '(缺失)'}）：` +
            '门禁需要字面量版本号（如 24）。若改成矩阵表达式，请同步扩展 build.js 的解析。'
    );
}

const engineChecks = [{ label: 'package.json 自身 engines.node', range: engines.node }];
for (const dependency of ['astro', 'wrangler', '@astrojs/cloudflare', '@astrojs/react']) {
    const manifestPath = `node_modules/${dependency}/package.json`;
    if (!exists(manifestPath)) {
        continue;
    }
    const manifest = JSON.parse(read(manifestPath));
    if (manifest.engines && manifest.engines.node) {
        engineChecks.push({ label: `${dependency}@${manifest.version}`, range: manifest.engines.node });
    }
}
for (const { label, range } of engineChecks) {
    const localOk = satisfies(localNodeVersion, range);
    const ciOk = satisfies(ciNodeVersion, range);
    if (localOk === null || ciOk === null) {
        fail(`Node 版本范围 ${label} = "${range}" 用了门禁读不懂的写法；请扩展 build.js 的 satisfies()。`);
        continue;
    }
    if (!localOk) {
        fail(`本机 Node ${localNode} 不满足 ${label} 的 engines.node "${range}"。`);
    }
    if (!ciOk) {
        fail(`CI 的 Node ${ciNodeMatch[1]} 不满足 ${label} 的 engines.node "${range}"。`);
    }
}
if (failures.length === 0) {
    pass(`Node 版本门禁（本机 ${localNode}、CI ${ciNodeMatch[1]}；比对 ${engineChecks.length} 条 engines）`);
}

/* ── 静态断言汇总：先失败先退出，不浪费一次 astro build ─────────────────────── */

function reportFailures() {
    for (const message of failures) {
        console.error(`❌ ${message}`);
    }
    console.error(`\n❌ 静态门禁未通过（${failures.length} 条失败）。修完再跑 \`node build.js\`。`);
    process.exit(1);
}

/**
 * `wrangler types --check`：官方推荐的「生成类型没过时」门禁（不重新生成，只校验）。
 * 它等价于「生成步骤必须先于 build」：只要 `wrangler.jsonc` 的绑定/兼容性开关改过而没重跑
 * `npm run cf:types`，这里就红，而不是等到 astro check 报一堆绑定不存在的怪错。
 */
function runWranglerTypesCheck() {
    const wranglerBin = path.join('node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (!exists(wranglerBin)) {
        fail('node_modules/wrangler 不存在：先 `npm ci`。');
        return false;
    }
    console.log('');
    console.log('▶ wrangler types --check（生成类型是否与 wrangler.jsonc 一致）');
    const result = spawnSync(process.execPath, [absolute(wranglerBin), 'types', '--check'], {
        cwd: rootDirectory,
        stdio: 'inherit',
        env: localToolEnvironment()
    });
    if (result.error) {
        fail(`wrangler types --check 启动失败：${result.error.message}`);
        return false;
    }
    if (result.status !== 0) {
        fail(
            `wrangler types --check 退出码 ${result.status}：${TYPES_FILE} 与 wrangler.jsonc 不一致。` +
                '改了绑定、兼容性日期或 compatibility_flags 之后，必须重跑 `npm run cf:types` 并提交生成结果。'
        );
        return false;
    }
    pass('wrangler types --check 通过（生成类型与 wrangler.jsonc 一致）');
    return true;
}

if (exists(TYPES_FILE)) {
    runWranglerTypesCheck();
}

function checkFonts(directory) {
    const result = spawnSync(process.execPath, [absolute('scripts/check-font-subsets.mjs'),
        '--assets-root', absolute(directory)], { cwd: rootDirectory, stdio: 'inherit', env: localToolEnvironment() });
    if (result.status !== 0) fail(`完整字体分片/哈希/OFL 门禁失败：${directory}`);
    else pass(`完整字体分片/哈希/OFL：${directory}`);
}
checkFonts('public');

if (failures.length > 0) {
    reportFailures();
}

if (staticOnly) {
    console.log(
        `✅ 静态断言通过（${passed.length} 组）：${passed.join('；')}。` +
            '已按 --static-only 跳过 astro check / astro build / 产物断言。'
    );
    process.exit(0);
}

/* ── J / K. astro check 与 astro build ───────────────────────────────────── */

const astroPackagePath = 'node_modules/astro/package.json';
if (!exists(astroPackagePath)) {
    fail('node_modules/astro 不存在：先 `npm ci`。');
    reportFailures();
}
const astroBin = path.join('node_modules', 'astro', JSON.parse(read(astroPackagePath)).bin.astro);
if (!exists(astroBin)) {
    fail(`找不到 astro 可执行入口 ${astroBin}：先 \`npm ci\`。`);
    reportFailures();
}

/* 两个 astro 阶段都跑（不半途退出）：一次 `npm run build` 就能同时看到类型错误与产物扫描
   结果。任一阶段失败，最后统一以退出码 1 结束。 */
function runAstro(command) {
    console.log(`\n▶ astro ${command}`);
    const result = spawnSync(process.execPath, [absolute(astroBin), command], {
        cwd: rootDirectory,
        stdio: 'inherit',
        env: localToolEnvironment()
    });
    if (result.error) {
        fail(`astro ${command} 启动失败：${result.error.message}`);
        return false;
    }
    if (result.status !== 0) {
        fail(`astro ${command} 退出码 ${result.status}（应为 0）。`);
        return false;
    }
    pass(`astro ${command} 退出码 0`);
    return true;
}

const typeCheckOk = artifactsOnly ? true : runAstro('check');
const buildOk = artifactsOnly ? true : runAstro('build');
if (buildOk) checkFonts('dist/client');
if (artifactsOnly) {
    console.log('\n▶ --artifacts-only：跳过 astro check / astro build，直接对现有 dist/ 跑产物断言。');
}

if (!buildOk) {
    console.error(
        '\n提示：astro build 未成功。若输出里有 EPERM/EACCES 且路径含 dist，通常是另一个 dev server\n' +
            '（npm run dev:local / npm run test:api）正持有 dist/client：先停掉它（netstat 看 88xx/89xx）再重跑。'
    );
}
if (!typeCheckOk && buildOk) {
    warn('astro check 未通过但产物成功产出：下游产物断言仍然执行了（类型错误不遮蔽产物扫描）。');
}

/* ── L. 产物断言（dist/） ─────────────────────────────────────────────────── */

function looksBinary(buffer) {
    const head = buffer.subarray(0, 8000);
    return head.includes(0);
}

const distFiles = buildOk ? walk('dist') : [];
if (buildOk && distFiles.length === 0) {
    fail('dist/ 是空的：astro build 没有产出任何文件。');
}

const clientPrefix = 'dist/client/';
const clientFiles = distFiles.filter((file) => file.startsWith(clientPrefix));
if (buildOk && clientFiles.length === 0) {
    fail('dist/client/ 为空：Workers Assets（ASSETS 绑定）没有可服务的静态产物。');
}
for (const required of ['dist/client/_headers', 'dist/client/favicon.svg', 'dist/server/wrangler.json', 'dist/server/entry.mjs']) {
    if (buildOk && !exists(required)) {
        fail(`构建产物缺少 ${required}。`);
    }
}

/* 产物消毒（F-3）：wrangler 的构建步骤会把仓库根的 `.dev.vars` 拷进 outdir
   （构建日志里的 `Using secrets defined in .dev.vars` 就是它干的）。密钥副本不该留在产物里：
   这里只认「dist/server/.dev.vars」这一种可预期的复制件并就地删除；其它任何 .dev.vars*
   （比如 dist/client/.dev.vars）都是异常产物，交给下面的扫描直接报错。 */
const wranglerVarsCopy = 'dist/server/.dev.vars';
if (buildOk && exists(wranglerVarsCopy)) {
    fs.rmSync(absolute(wranglerVarsCopy), { force: true });
    const index = distFiles.indexOf(wranglerVarsCopy);
    if (index !== -1) {
        distFiles.splice(index, 1);
    }
    warn(`${wranglerVarsCopy} 由 wrangler 构建时从仓库根拷入，已就地移除（密钥只应从运行时 env / wrangler secrets 注入）。`);
}

/* 静态资产的安全头：public/_headers 的内容必须原样出现在产物里，适配器额外注入的那一段只能是
   已知的 `/_astro/*` 长缓存规则（@astrojs/cloudflare 的固定行为），多出别的内容即漂移。 */
const EXPECTED_INJECTED_HEADERS = '/_astro/*\n  Cache-Control: public, max-age=31536000, immutable';
if (exists('dist/client/_headers') && buildOk) {
    const normalize = (text) => text.replace(/\r\n/g, '\n').trim();
    const publicHeaders = normalize(read('public/_headers'));
    const builtHeaders = normalize(read('dist/client/_headers'));
    if (!builtHeaders.includes(publicHeaders)) {
        fail('dist/client/_headers 里找不到 public/_headers 的内容：静态资产的安全头会与源声明漂移。');
    } else {
        const injected = builtHeaders.replace(publicHeaders, '').trim();
        if (injected !== EXPECTED_INJECTED_HEADERS) {
            fail(
                'dist/client/_headers 里除了 public/_headers 与适配器注入的 /_astro/* 长缓存规则之外还有别的内容：' +
                    `${JSON.stringify(injected.slice(0, 120))}`
            );
        }
    }
}

/** 客户端面向产物：不许出现明细键、密钥名、明细数据文件与 vendor 引用。 */
const clientForbidden = [
    [RAW_KEY, '明细 KV 键'],
    ['students_raw_', '版本化明细 KV 键'],
    [DETAIL_DATA_FILE, '完整名单文件'],
    ['DETAILS_PASSPHRASE', '口令变量名'],
    ['DETAILS_SESSION_SECRET', '会话密钥变量名'],
    ['(加载 js/vendor/echarts.min.js)', '对已退役自建 ECharts 产物的加载']
];

let scannedFiles = 0;
for (const file of distFiles) {
    if (!buildOk) {
        break;
    }
    const buffer = fs.readFileSync(absolute(file));
    if (/\.dev\.vars/.test(path.basename(file))) {
        fail(`构建产物里出现 ${file}：.dev.vars 绝不能进 dist（它只在本地、且被 gitignore）。`);
        continue;
    }
    if (looksBinary(buffer)) {
        continue;
    }
    const text = buffer.toString('utf8');
    scannedFiles += 1;
    if (file.startsWith(clientPrefix)) {
        for (const [token, label] of clientForbidden) {
            const hit = token.startsWith('(') ? VENDOR_LOAD_PATTERN.test(text) : text.includes(token);
            if (hit) {
                fail(`客户端产物 ${file} 里出现${label}：它只能留在服务端，不能随静态资源发布。`);
            }
        }
    }
    /* 服务端产物允许出现变量名，但不允许出现硬编码取值。 */
    const hardcoded = text.match(/DETAILS_(?:PASSPHRASE|SESSION_SECRET)\s*[:=]\s*['"`]([^'"`]{6,})['"`]/);
    if (hardcoded) {
        fail(`产物 ${file} 里出现硬编码的密钥字面量（DETAILS_* = "…"）：密钥只能从运行时 env 读取。`);
    }
}

/* 本地 .dev.vars 的实际取值（如果存在）不得出现在产物里。
   只比对真正的密钥类键（*_SECRET / *_PASSPHRASE / *_TOKEN / *_KEY）：DETAILS_HINT 这类
   公开提示语本来就在 wrangler.jsonc 的 vars 里，天然会出现在产物中。 */
if (exists('.dev.vars')) {
    const secretValues = read('.dev.vars')
        .split(/\r?\n/)
        .map((line) => {
            const separator = line.indexOf('=');
            if (separator === -1) {
                return null;
            }
            const name = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
            return /(PASSPHRASE|SECRET|TOKEN|_KEY)$/i.test(name) ? value : null;
        })
        .filter((value) => value && value.length >= 6);
    for (const value of secretValues) {
        for (const file of distFiles) {
            const buffer = fs.readFileSync(absolute(file));
            if (!looksBinary(buffer) && buffer.toString('utf8').includes(value)) {
                fail(`产物 ${file} 里出现了 .dev.vars 的实际取值：部署密钥绝不能进构建产物。`);
            }
        }
    }
    pass(`本地产物未包含 .dev.vars 的密钥类取值（${secretValues.length} 条值参与比对）`);
} else {
    warn('.dev.vars 不存在（CI 正常情形），跳过「实际密钥取值不得进产物」这一条；文件存在性检查仍然生效。');
}

for (const message of warnings) {
    console.log(`⚠️  ${message}`);
}

if (failures.length > 0) {
    reportFailures();
}
pass(`产物扫描（${scannedFiles} 个文本文件、${distFiles.length} 个产物文件）`);

console.log(
    `\n✅ 构建与静态安全门禁通过：静态断言 ${passed.length} 组（含对比度/调色板 ${contrastAssertions} 项）` +
        (artifactsOnly ? '、产物扫描无泄漏（--artifacts-only：本次未跑 astro 阶段）' : '、astro check 与 astro build 退出码 0、产物扫描无泄漏') +
        '。\n' +
        '   部署面：Cloudflare Worker + Workers Assets（ASSETS 绑定，目录 dist/client），页面由 Astro SSR 渲染；\n' +
        '   数据面：KV 绑定 CLASS_MAP_DATA 的两个键（公开聚合 students:public:v1 给前端，明细 students:raw:v1 只在服务端）；\n' +
        '   前端渲染：npm 依赖的 ECharts 由 Vite 打包（自建 vendor 链路已按 ADR-0002 退役）。'
);

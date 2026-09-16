const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDirectory = __dirname;
const failures = [];

function fail(message) {
    failures.push(message);
}

function absolute(relativePath) {
    return path.join(rootDirectory, relativePath);
}

function read(relativePath) {
    return fs.readFileSync(absolute(relativePath), 'utf8');
}

/* 1. 关键文件齐全 */
const requiredFiles = [
    'index.html',
    'js/boot.js',
    'js/geo.js',
    'js/china.js',
    'js/palette.js',
    'js/map.js',
    'js/vendor/echarts.min.js',
    'functions/api/map/public.js',
    'functions/api/map/details.js',
    'functions/api/auth/details.js',
    'functions/api/auth/logout.js',
    'shared/data-model.mjs'
];

for (const relativePath of requiredFiles) {
    if (!fs.existsSync(absolute(relativePath))) {
        fail(`缺少必要文件: ${relativePath}`);
    }
}

/* 2. 完整学生数据不能回到静态资源里 */
const indexHtml = read('index.html');
if (indexHtml.includes('js/data.js')) {
    fail('index.html 仍在加载 js/data.js，生产环境不能再公开静态学生数据。');
}

/* 3. 脚本必须同源加载，index.html 不允许内联脚本，CSP 才能收紧到 script-src 'self' */
const scriptSources = [...indexHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
for (const source of scriptSources) {
    if (/^(https?:)?\/\//.test(source)) {
        fail(`index.html 引用了跨域脚本 ${source}；脚本必须同源加载。`);
    }
}
if (/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(indexHtml)) {
    fail('index.html 仍有内联脚本；内联脚本会迫使 CSP 放开 unsafe-inline。');
}

/* 4. 渲染库必须已经换成 ECharts */
const sourceFiles = ['index.html', 'js/map.js', 'js/boot.js', 'js/geo.js', '_headers', 'css/main.css'];
for (const relativePath of sourceFiles) {
    if (/highcharts/i.test(read(relativePath))) {
        fail(`${relativePath} 仍在引用 Highcharts。`);
    }
}

/* 5. 省级地图名单必须和 js/province 目录一致 */
const geoContext = vm.createContext({ window: {} });
vm.runInContext(read('js/geo.js'), geoContext, { filename: 'js/geo.js' });
const geoRegistry = geoContext.window.CMapGeo;

if (!geoRegistry || typeof geoRegistry.register !== 'function') {
    fail('js/geo.js 没有正确导出 CMapGeo 注册表。');
} else {
    const declared = [...geoRegistry.availableProvinceFiles].sort();
    const onDisk = fs
        .readdirSync(absolute('js/province'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => name.replace(/\.js$/, ''))
        .sort();

    const missing = onDisk.filter((name) => !declared.includes(name));
    const extra = declared.filter((name) => !onDisk.includes(name));

    if (missing.length > 0) {
        fail(`js/geo.js 的 AVAILABLE_PROVINCE_FILES 缺少: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
        fail(`js/geo.js 的 AVAILABLE_PROVINCE_FILES 多出: ${extra.join(', ')}`);
    }

    for (const slug of onDisk) {
        const head = read(`js/province/${slug}.js`).slice(0, 200);
        if (!head.startsWith(`CMapGeo.register("cn/${slug}",`)) {
            fail(`js/province/${slug}.js 没有以 CMapGeo.register("cn/${slug}", ...) 开头。`);
        }
    }

    if (!read('js/china.js').startsWith('CMapGeo.register("cn/china",')) {
        fail('js/china.js 没有以 CMapGeo.register("cn/china", ...) 开头。');
    }
}

/* 6. CSP 不允许内联脚本 */
const headers = read('_headers');
const scriptSourceDirective = (headers.match(/script-src[^;]*/) || [''])[0];
if (scriptSourceDirective.includes('unsafe-inline')) {
    fail('_headers 的 script-src 仍包含 unsafe-inline。');
}

if (failures.length > 0) {
    for (const message of failures) {
        console.error(`❌ ${message}`);
    }
    process.exit(1);
}

console.log('✅ 静态检查通过：地图数据仍由 Cloudflare Pages Functions + KV 提供，前端渲染使用本地 ECharts。');

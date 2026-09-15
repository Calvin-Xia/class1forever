/**
 * 本地前端调试服务器。
 *
 * 用假的公开数据顶替 Cloudflare Pages Functions 与 KV 绑定，
 * 因此不需要 Cloudflare 账号就能验证地图渲染、下钻、口令流程与分享图。
 *
 *   node tests/dev-server.mjs          # http://127.0.0.1:8788
 *   PORT=9000 node tests/dev-server.mjs
 *
 * 口令默认是 demo，可用 DETAILS_PASSPHRASE 覆盖。
 *
 * 想看真实聚合数字时，先用 wrangler 把 KV 里的公开数据导出来，再指向它：
 *   npx wrangler kv key get students:public:v1 --namespace-id=<preview_id> --remote --text > public.json
 *   PUBLIC_DATA_FILE=public.json npm run dev:mock
 * 公开数据里只有聚合人数，可以安全导出；students:raw:v1 含姓名，不要导出。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { buildPublicDataset, filterStudentsByRegion, sortPeople } from '../shared/data-model.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8788);
const passphrase = process.env.DETAILS_PASSPHRASE || 'demo';
const sessionCookie = 'detail_session=dev-mock-session';

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
};

const SCHOOLS = [
    '万州二中',
    '北京电子科技学院',
    '重庆大学',
    '浙江大学',
    '四川大学',
    '武汉大学',
    '上海交通大学'
];

/**
 * 在沙箱里跑一遍地图数据脚本，拿到和浏览器一致的几何数据。
 */
function loadGeoRegistry() {
    const context = vm.createContext({});
    // 数据脚本用的是裸标识符 CMapGeo，所以要让沙箱里的 window 指向沙箱自身。
    vm.runInContext('globalThis.window = globalThis;', context);
    const run = (relativePath) => {
        vm.runInContext(readFileSync(path.join(rootDirectory, relativePath), 'utf8'), context, {
            filename: relativePath
        });
    };

    run(path.join('js', 'geo.js'));
    run(path.join('js', 'china.js'));

    for (const name of readdirSync(path.join(rootDirectory, 'js', 'province'))) {
        if (name.endsWith('.js')) {
            run(path.join('js', 'province', name));
        }
    }

    return context.window.CMapGeo;
}

function createRandom(seedValue) {
    let seed = seedValue;
    return function random() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
}

/**
 * 依据真实省市名称生成一份稳定的假数据，方便肉眼判断聚合数字是否符合预期。
 */
function buildMockStudents(geo) {
    const random = createRandom(20260915);
    const students = [];
    const seenProvinces = new Set();

    for (const feature of geo.get('cn/china').features) {
        const province = feature.properties.name;
        if (seenProvinces.has(province)) {
            continue;
        }
        seenProvinces.add(province);

        const filename = feature.properties.filename;
        const cityFeatures = geo.hasProvinceFile(filename) ? geo.get(`cn/${filename}`).features : [];
        const cities = cityFeatures.length > 0
            ? [...new Set(cityFeatures.map((item) => item.properties.name))]
            : [`${province}市区`];

        const provinceTotal = Math.floor(random() * 4);

        for (let index = 0; index < provinceTotal; index += 1) {
            students.push({
                name: `${province}同学${index + 1}`,
                school: SCHOOLS[Math.floor(random() * SCHOOLS.length)],
                city: cities[Math.floor(random() * cities.length)],
                province
            });
        }
    }

    return students;
}

const geoRegistry = loadGeoRegistry();
const mockStudents = buildMockStudents(geoRegistry);

const publicDataFile = process.env.PUBLIC_DATA_FILE;
const publicDataset = publicDataFile
    ? JSON.parse(readFileSync(path.resolve(publicDataFile), 'utf8'))
    : buildPublicDataset(mockStudents);

function sendJson(response, status, body, headers = {}) {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...headers
    });
    response.end(payload);
}

function hasSession(request) {
    return (request.headers.cookie || '').includes('detail_session=');
}

async function handleApi(request, response, url) {
    if (url.pathname === '/api/map/public' && request.method === 'GET') {
        sendJson(response, 200, {
            ...publicDataset,
            detailAccess: hasSession(request),
            detailModeAvailable: true,
            detailsHint: '本地调试口令是 demo'
        });
        return true;
    }

    if (url.pathname === '/api/auth/details' && request.method === 'POST') {
        let body = null;
        try {
            const chunks = [];
            for await (const chunk of request) {
                chunks.push(chunk);
            }
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch (_error) {
            body = null;
        }

        if (body && body.passphrase === passphrase) {
            sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': `${sessionCookie}; Path=/; HttpOnly` });
            return true;
        }

        sendJson(response, 401, {
            error: 'invalid_passphrase',
            message: '口令不对，请重试。',
            remainingAttempts: 9
        });
        return true;
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        sendJson(
            response,
            200,
            { authenticated: false },
            { 'Set-Cookie': 'detail_session=; Path=/; HttpOnly; Max-Age=0' }
        );
        return true;
    }

    if (url.pathname === '/api/map/details' && request.method === 'GET') {
        if (!hasSession(request)) {
            sendJson(response, 401, { error: 'detail_auth_required', message: '请先输入口令。' });
            return true;
        }

        const province = url.searchParams.get('province');
        const city = url.searchParams.get('city');
        if (!province) {
            sendJson(response, 400, { error: 'province_required', message: '缺少地区信息，请重新选择。' });
            return true;
        }

        const people = sortPeople(filterStudentsByRegion(mockStudents, { province, city }));
        sendJson(response, 200, {
            province,
            city,
            count: people.length,
            people
        });
        return true;
    }

    return false;
}

async function serveStatic(response, url) {
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = path.join(rootDirectory, path.normalize(requested));

    if (!target.startsWith(rootDirectory)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    try {
        const content = await readFile(target);
        response.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(target)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        response.end(content);
    } catch (_error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found: ' + requested);
    }
}

createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);

    handleApi(request, response, url)
        .then((handled) => {
            if (!handled) {
                return serveStatic(response, url);
            }
            return undefined;
        })
        .catch((error) => {
            console.error(error);
            sendJson(response, 500, { error: 'mock_server_error', message: '本地调试服务器出错。' });
        });
}).listen(port, '127.0.0.1', () => {
    console.log(`本地调试服务器已启动: http://127.0.0.1:${port}`);
    if (publicDataFile) {
        console.log(`公开聚合数据：${path.resolve(publicDataFile)}（${publicDataset.stats.total} 位同学，${publicDataset.stats.provinces} 个省级区域）`);
        console.log('注意：详情接口仍返回假同学，只用来验证前端交互。');
    } else {
        console.log(`假数据：${mockStudents.length} 位同学，覆盖 ${Object.keys(publicDataset.provinces).length} 个省级区域`);
    }
    console.log(`口令：${passphrase}`);
});

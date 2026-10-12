/**
 * @fileoverview 四个 API 路由的契约断言，断言对象是 docs/migration-parity.md §1。
 *
 * 为什么是「起本地服务 + 真请求」而不是 vitest workers 测试池：
 * 契约里要守的东西有一半在 HTTP 层 —— Vary / Cache-Control / Set-Cookie 属性、
 * 以及 Astro 路由层本身的路径与方法匹配。把 `astro build` 的产物用 cloudflare
 * 适配器入口 + `wrangler dev` 跑起来再发真请求，验证的就是线上同一套组装
 * （Astro 路由 → 适配器 handler → KV 绑定），比只调用 handler 更接近部署形态；
 * 依赖为 0（node:test + node:assert），CI 与本地都不需要额外框架。
 *
 * 本地 KV 与演示口令由 scripts/local-runtime.mjs 提供，不读 .dev.vars，
 * 因此没有 Cloudflare 凭据也能跑。运行：`npm run test:api`（需先 `npm run build`）。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEMO_PASSPHRASE,
    FIXTURE_STUDENTS,
    LOCAL_CONFIG_PATH,
    LOCAL_EMPTY_STATE_DIR,
    LOCAL_TEST_STATE_DIR,
    prepareLocalRuntime,
    resetLocalState,
    startLocalServer
} from '../scripts/local-runtime.mjs';
import { normalizeStudents, sortPeople } from '../shared/data-model.mjs';

// 端口避开 8788（`npm run dev:local` 默认）与 8790–8799（同一批次里别的节点会用）；
// 可用 TEST_PORT 覆盖。
const PORT = Number(process.env.TEST_PORT || 8890);

let server;
let base;
let sessionCookie;

function jsonPost(body) {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    };
}

function api(pathname, init) {
    return fetch(`${base}${pathname}`, init);
}

async function readJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (_error) {
        throw new Error(`响应不是合法 JSON（${response.status}）：${text.slice(0, 200)}`);
    }
}

before(async () => {
    // 用独立的 state-test 目录：与 `npm run dev:local` 的默认目录（.wrangler/local/state）分开，
    // 并发时不会两个进程抢同一个本地 KV（miniflare 的 SQLite）。
    const { configPath, persistTo } = await prepareLocalRuntime({
        reset: true,
        stateDir: LOCAL_TEST_STATE_DIR
    });
    server = await startLocalServer({ port: PORT, configPath, persistTo });
    base = server.url;
});

after(() => {
    if (server) {
        server.stop();
    }
});

describe('GET /api/map/public', () => {
    test('成功态：公开聚合 + detailAccess/detailModeAvailable/detailsHint，带 Vary: Cookie 与 Cache-Control: no-store', async () => {
        const response = await api('/api/map/public');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('vary') || '', /(^|,\s*)Cookie(\s*,|$)/);

        const body = await readJson(response);
        assert.equal(body.version, 'v1');
        assert.deepEqual(body.stats, { total: 6, provinces: 3, cities: 4 });
        assert.equal(body.provinces['北京'].count, 3);
        assert.deepEqual(body.provinces['北京'].cities, { 海淀区: 2, 朝阳区: 1 });
        assert.equal(body.detailAccess, false);
        assert.equal(body.detailModeAvailable, true);
        assert.equal(typeof body.detailsHint, 'string');
    });

    test('失败态：KV 里没有 students:public:v1 时 503 public_data_unavailable', async () => {
        // 用一份独立的空 KV 持久化目录再起一个 Worker：不靠「运行中删键」
        // （另一个进程写本地 KV 不一定立刻被已启动的 miniflare 看到，会变成 flaky）。
        resetLocalState(LOCAL_EMPTY_STATE_DIR);
        const empty = await startLocalServer({
            port: PORT + 1,
            configPath: LOCAL_CONFIG_PATH,
            persistTo: LOCAL_EMPTY_STATE_DIR
        });
        try {
            const response = await fetch(`${empty.url}/api/map/public`);
            assert.equal(response.status, 503);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            const body = await readJson(response);
            assert.equal(body.error, 'public_data_unavailable');
            assert.equal(typeof body.message, 'string');
        } finally {
            empty.stop();
        }
    });
});

describe('POST /api/auth/details', () => {
    test('成功态：正确口令换 200 {authenticated:true} + 会话 Cookie（HttpOnly/Secure/SameSite=Lax/Path=//Max-Age=43200）', async () => {
        const response = await api('/api/auth/details', jsonPost({ passphrase: DEMO_PASSPHRASE }));
        assert.equal(response.status, 200);
        assert.deepEqual(await readJson(response), { authenticated: true });

        const cookie = response.headers.get('set-cookie');
        assert.ok(cookie, '必须返回 Set-Cookie');
        assert.match(cookie, /^detail_session=/);
        for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=43200']) {
            assert.ok(cookie.includes(attribute), `Cookie 缺少 ${attribute}：${cookie}`);
        }
        sessionCookie = cookie.split(';')[0];
    });

    test('失败态：错误口令 401 invalid_passphrase，remainingAttempts 按 10 - 已失败次数 - 1 递减', async () => {
        const response = await api('/api/auth/details', jsonPost({ passphrase: 'definitely-wrong' }));
        assert.equal(response.status, 401);
        const body = await readJson(response);
        assert.equal(body.error, 'invalid_passphrase');
        assert.equal(body.remainingAttempts, 9);
    });

    test('失败态：请求体不是合法 JSON → 400 invalid_request_body', async () => {
        const response = await api('/api/auth/details', jsonPost('{not json'));
        assert.equal(response.status, 400);
        assert.equal((await readJson(response)).error, 'invalid_request_body');
    });

    test('失败态：缺少 passphrase 字段 → 400 passphrase_required', async () => {
        const response = await api('/api/auth/details', jsonPost({}));
        assert.equal(response.status, 400);
        assert.equal((await readJson(response)).error, 'passphrase_required');
    });

    // Astro 6 默认开启 security.checkOrigin（有意保留）：对「没有 Origin 头」且 Content-Type
    // 为空/表单类型的 POST，它在进路由之前就回 403。带同源 Origin 时行为与旧站一致。
    test('失败态（契约 §1.2）：带同源 Origin、无 body 的 POST → 400 invalid_request_body', async () => {
        const response = await api('/api/auth/details', { method: 'POST', headers: { origin: base } });
        assert.equal(response.status, 400);
        assert.equal((await readJson(response)).error, 'invalid_request_body');
    });

    test('安全行为（有意为之）：不带 Origin 头的 POST → 403 Cross-site POST form submissions are forbidden', async () => {
        const response = await api('/api/auth/details', { method: 'POST' });
        assert.equal(response.status, 403);
        assert.match(await response.text(), /Cross-site POST form submissions are forbidden/);
    });

    test('失败态：连续失败达 10 次后进入限流（第 11 次请求 429 too_many_attempts）', async () => {
        // 上面「错误口令」用例已经消耗 1 次配额，这里补齐到 10 次，第 11 次应被拦。
        let last;
        let firstLimited = null;
        for (let attempt = 2; attempt <= 12; attempt += 1) {
            last = await api('/api/auth/details', jsonPost({ passphrase: `wrong-${attempt}` }));
            if (last.status === 429) {
                firstLimited = attempt;
                break;
            }
        }
        assert.equal(firstLimited, 11, `限流应在第 11 次尝试触发，实际在第 ${firstLimited} 次`);
        const body = await readJson(last);
        assert.equal(body.error, 'too_many_attempts');
        assert.equal(typeof body.message, 'string');
    });
});

describe('GET /api/map/details', () => {
    const fixtureSorted = (region) => sortPeople(
        normalizeStudents(FIXTURE_STUDENTS).filter((student) => student.province === region.province)
    );

    test('成功态：带会话按省返回 {province,city,count,people}，people 按 city → school → name 排序', async () => {
        const response = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC', {
            headers: { cookie: sessionCookie }
        });
        assert.equal(response.status, 200);
        const body = await readJson(response);
        assert.equal(body.province, '北京');
        assert.equal(body.city, null);
        assert.equal(body.count, 3);
        assert.deepEqual(body.people, fixtureSorted({ province: '北京' }));
        for (const person of body.people) {
            assert.deepEqual(Object.keys(person).sort(), ['city', 'name', 'province', 'school']);
        }
    });

    test('成功态：省级别名归一（北京市 → 北京）与城市筛选（city=海淀区）', async () => {
        const alias = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC%E5%B8%82', {
            headers: { cookie: sessionCookie }
        });
        assert.equal(alias.status, 200);
        const aliasBody = await readJson(alias);
        assert.equal(aliasBody.province, '北京');
        assert.equal(aliasBody.count, 3);

        const city = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC&city=%E6%B5%B7%E6%B7%80%E5%8C%BA', {
            headers: { cookie: sessionCookie }
        });
        assert.equal(city.status, 200);
        const cityBody = await readJson(city);
        assert.equal(cityBody.city, '海淀区');
        assert.equal(cityBody.count, 2);

        const nullCity = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC&city=null', {
            headers: { cookie: sessionCookie }
        });
        assert.equal(nullCity.status, 200);
        assert.equal((await readJson(nullCity)).city, null);
    });

    test('失败态：不带会话 → 401 detail_auth_required', async () => {
        const response = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC');
        assert.equal(response.status, 401);
        assert.equal((await readJson(response)).error, 'detail_auth_required');
    });

    test('失败态：伪造会话 Cookie → 401 detail_auth_required', async () => {
        const response = await api('/api/map/details?province=%E5%8C%97%E4%BA%AC', {
            headers: { cookie: 'detail_session=forged.signature' }
        });
        assert.equal(response.status, 401);
        assert.equal((await readJson(response)).error, 'detail_auth_required');
    });

    test('失败态：缺 province 参数 → 400 province_required', async () => {
        const response = await api('/api/map/details', { headers: { cookie: sessionCookie } });
        assert.equal(response.status, 400);
        assert.equal((await readJson(response)).error, 'province_required');
    });

    test('失败态：province 为纯空白 → 400 invalid_region_query（与缺参数分流）', async () => {
        const response = await api('/api/map/details?province=%20', { headers: { cookie: sessionCookie } });
        assert.equal(response.status, 400);
        const body = await readJson(response);
        assert.equal(body.error, 'invalid_region_query');
        assert.equal(typeof body.message, 'string');
    });
});

describe('POST /api/auth/logout', () => {
    // 安全层说明（该行为有意保留，不去关掉 Astro 的 checkOrigin）：
    //   Astro 6 默认对「无 Origin 头」且 Content-Type 为空/表单类型的 POST 在进路由前回 403。
    //   浏览器对每个 POST（含同源）都会自动带 Origin，所以真实前端路径就是下面第一条断言；
    //   curl / 脚本联调需要手动加 `-H "Origin: <站点源>"`。
    test('成功态（真实前端路径）：带同源 Origin 头的匿名 POST → 200 并清 Cookie（Max-Age=0），不需要有效会话', async () => {
        const response = await api('/api/auth/logout', { method: 'POST', headers: { origin: base } });
        assert.equal(response.status, 200);
        assert.deepEqual(await readJson(response), { authenticated: false });
        const cookie = response.headers.get('set-cookie');
        assert.ok(cookie, '必须返回 Set-Cookie');
        assert.match(cookie, /^detail_session=;/);
        for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) {
            assert.ok(cookie.includes(attribute), `Cookie 缺少 ${attribute}：${cookie}`);
        }
    });

    test('成功态（等价路径）：带 JSON Content-Type 的匿名 POST → 200（checkOrigin 对 JSON 请求不适用）', async () => {
        const response = await api('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
        assert.equal(response.status, 200);
        assert.deepEqual(await readJson(response), { authenticated: false });
        const cookie = response.headers.get('set-cookie');
        assert.ok(cookie && cookie.includes('Max-Age=0'), `Cookie 缺少 Max-Age=0：${cookie}`);
    });

    test('安全行为（有意为之，不是缺陷）：不带 Origin 头的 POST → 403 Cross-site POST form submissions are forbidden', async () => {
        const response = await api('/api/auth/logout', { method: 'POST' });
        assert.equal(response.status, 403);
        assert.match(await response.text(), /Cross-site POST form submissions are forbidden/);
        assert.equal(response.headers.get('set-cookie'), null, '被安全层拦下时不应下发任何 Cookie');
    });

    test('失败态：契约只接受 POST，GET 不应成功', async () => {
        const response = await api('/api/auth/logout');
        assert.ok(response.status >= 400, `GET 不应成功，实际 ${response.status}`);
    });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { demoKV, DEMO_RELEASE } from '../scripts/edgeone-local.mjs';

/*
 * 前置：`node scripts/build-edgeone.mjs --artifacts-only --package-cli`（需要
 * EDGEONE_CLI_ENTRY 指向已安装的 edgeone/edgeone-dist/cli.js）产出的
 * dist-edgeone/.edgeone/edge-functions/index.js。
 *
 * 因此这个用例**只在部署流程（.github/workflows/deploy.yml）里执行**，不在 ci.yml 里：
 * CI 不装 Makers CLI，也不跑打包步骤。CI 侧覆盖同一份 API 契约的是
 * `npm run check:edgeone` 里的 tests/edgeone-adapter.test.mjs（未打包的 edge-functions）。
 */
test('CLI combined fetch entry serves API, login, details, logout and static fallback', async () => {
    const kv = demoKV();
    kv.values.set('classmap_runtime_config', JSON.stringify({ DATA_RELEASE_ID: DEMO_RELEASE,
        DETAILS_PASSPHRASE: 'demo', DETAILS_SESSION_SECRET: 'package-test-only-signing-secret' }));
    let handler;
    const originFetch = async () => new Response('<html>static page</html>');
    vm.runInNewContext(fs.readFileSync(new URL('../dist-edgeone/.edgeone/edge-functions/index.js', import.meta.url), 'utf8'), {
        crypto: webcrypto, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
        console, atob, btoa, setTimeout, clearTimeout, CLASS_MAP_DATA: kv, fetch: originFetch,
        addEventListener(type, listener) { assert.equal(type, 'fetch'); handler = listener; }
    });
    assert.equal(typeof handler, 'function');
    async function request(pathname, options = {}) {
        const request = new Request('https://example.test' + pathname, options);
        request.eo = { clientIp: '127.0.0.1' };
        let response;
        handler({ request, respondWith(value) { response = value; }, waitUntil() {} }, { fetch: originFetch });
        return response;
    }
    const pub = await request('/api/map/public');
    assert.equal(pub.status, 200);
    assert.equal((await pub.json()).stats.total, 6);
    const login = await request('/api/auth/details', { method: 'POST', headers: {
        Origin: 'https://example.test', 'Content-Type': 'application/json'
    }, body: JSON.stringify({ passphrase: 'demo' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const details = await request('/api/map/details?province=' + encodeURIComponent('浙江'), { headers: { cookie } });
    assert.equal(details.status, 200);
    assert.equal((await details.json()).count, 2);
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://example.test', cookie } })).status, 200);
    assert.equal((await request('/')).status, 200);
});

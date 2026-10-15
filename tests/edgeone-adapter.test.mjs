import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startEdgeoneFixture } from '../scripts/edgeone-local.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

let server, adapter;
before(async () => {
    server = await startEdgeoneFixture();
    adapter = await import(pathToFileURL(path.resolve('.edgeone-local/adapter.mjs')).href);
});
after(() => server?.stop());

test('EdgeOne 缺可信元数据时登录 fail closed；伪造 CF/XFF 不能替代', async () => {
    const untrusted = await startEdgeoneFixture({ trustedIp: null });
    try {
        const response = await fetch(untrusted.url + '/api/auth/details', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '1.2.3.4' },
            body: JSON.stringify({ passphrase: 'demo' }) });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error, 'trusted_ip_unavailable');
        assert.equal(response.headers.get('set-cookie'), null);
    } finally { untrusted.stop(); }
});

test('版本物理键读取；缺/非法版本不读 Cloudflare 旧键', async () => {
    const response = await fetch(server.url + '/api/map/public');
    assert.equal(response.headers.get('x-data-release'), 'demo_20261014');
    assert.equal((await response.json()).stats.total, 6);
    for (const release of ['', '../private', 'a'.repeat(65)]) {
        const invalid = await startEdgeoneFixture({ env: { DATA_RELEASE_ID: release } });
        try {
            const failure = await fetch(invalid.url + '/api/map/public');
            assert.equal(failure.status, 503);
            assert.equal(failure.headers.get('cache-control'), 'no-store');
            assert.equal(failure.headers.get('vary'), 'Cookie');
        } finally { invalid.stop(); }
    }
});

test('Makers 限流键合法、IP 隐去、过期值不计数；delete 删除相同物理键', async () => {
    const values = new Map();
    const kv = { async get(k) { return values.get(k) ?? null; }, async put(k,v) { values.set(k,v); }, async delete(k) { values.delete(k); } };
    const store = adapter.makersStore(kv, 'demo-hmac-only');
    const logical = 'auth:rate:2001:db8::1:123';
    await store.put(logical, '9', { expirationTtl: 900 });
    const physical = [...values.keys()][0];
    assert.match(physical, /^auth_rate_[a-f0-9]{64}$/);
    assert.equal(physical.includes('2001'), false);
    assert.equal(await store.get(logical), '9');
    values.set(physical, JSON.stringify({ value: '9', expiresAt: Date.now() - 1 }));
    assert.equal(await store.get(logical), null);
    await store.delete(logical);
    assert.equal(values.size, 0);
});

test('同源保护遵循 Astro：表单/无类型拒绝外站，JSON 原契约保留；HEAD无体', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
        const headers = { origin: 'https://attacker.invalid' };
        if (type) headers['content-type'] = type;
        const request = new Request('https://map.example/api/auth/logout', { method: 'POST', headers });
        assert.equal(adapter.originRejection(request).status, 403);
    }
    const request = new Request('https://map.example/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
    assert.equal(adapter.originRejection(request), null);
    const head = await fetch(server.url + '/api/map/public', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});

test('独立会话密钥拒绝另站Cookie；匿名/登录/退出无缓存串会话', async () => {
    const global = await startEdgeoneFixture({ env: { DETAILS_SESSION_SECRET: 'different-global-demo-secret' } });
    try {
        const login = await fetch(server.url + '/api/auth/details', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: '{"passphrase":"demo"}' });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal(login.headers.get('set-cookie').includes('Domain='), false);
        const local = await fetch(server.url + '/api/map/public', { headers: { cookie } });
        assert.equal((await local.json()).detailAccess, true);
        const other = await fetch(global.url + '/api/map/public', { headers: { cookie } });
        assert.equal((await other.json()).detailAccess, false);
        const anonymous = await fetch(server.url + '/api/map/public');
        assert.equal((await anonymous.json()).detailAccess, false);
        for (const response of [local, other, anonymous]) {
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.equal(response.headers.get('vary'), 'Cookie');
        }
        const logout = await fetch(server.url + '/api/auth/logout', { method: 'POST', headers: { origin: server.url } });
        assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
        const detail = await fetch(server.url + '/api/map/details?province=北京');
        assert.equal(detail.status, 401);
    } finally { global.stop(); }
});

test('构建时 env 密钥不能绕过私有 KV 配置；配置缺失/损坏拒绝服务', async () => {
    const secretVars = { DATA_RELEASE_ID: 'demo_20261014', DETAILS_PASSPHRASE: 'demo', DETAILS_SESSION_SECRET: 'compiled-demo-key' };
    const request = new Request('https://fixture.example/api/auth/details', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: '{"passphrase":"demo"}' });
    request.eo = { clientIp: '127.0.0.1' };
    for (const config of [null, '{bad json', '[]', '{"DATA_RELEASE_ID":123}']) {
        const kv = { async get() { return config; }, async put() {}, async delete() {} };
        const response = await adapter.edgeoneApi({ request, env: secretVars }, kv);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal((await response.text()).includes('compiled-demo-key'), false);
    }
});

test('私有配置在下次请求激活版本，未完整写新版本不回退或混读', async () => {
    const previous = server.kv.values.get('classmap_runtime_config');
    const config = JSON.parse(previous);
    try {
        server.kv.values.set('classmap_runtime_config', JSON.stringify({ ...config, DATA_RELEASE_ID: 'new_demo' }));
        const missing = await fetch(server.url + '/api/map/public');
        assert.equal(missing.status, 503);
        server.kv.values.set('students_public_new_demo', server.kv.values.get('students_public_demo_20261014'));
        const response = await fetch(server.url + '/api/map/public');
        assert.equal(response.headers.get('x-data-release'), 'new_demo');
        assert.equal((await response.json()).stats.total, 6);
        const login = await fetch(server.url + '/api/auth/details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"demo"}' });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const details = await fetch(server.url + '/api/map/details?province=北京', { headers: { cookie } });
        assert.equal(details.status, 503);
        assert.equal((await details.json()).error, 'detail_data_unavailable');
    } finally {
        server.kv.values.set('classmap_runtime_config', previous);
        server.kv.values.delete('students_public_new_demo');
    }
    assert.equal((await fetch(server.url + '/api/map/public')).headers.get('x-data-release'), 'demo_20261014');
});

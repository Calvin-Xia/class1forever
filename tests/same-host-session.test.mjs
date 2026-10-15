import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSameHostFixture } from '../scripts/same-host-local.mjs';

test('同 Host：CF/EO 独立密钥、Cookie 覆盖、切回重登、多标签共享退出与缓存头', async () => {
    const fixture = await startSameHostFixture();
    // 两个标签页共享同一个浏览器 Cookie jar；HTTP 测试不声称验证真实浏览器属性执行。
    let cookie = '';
    async function request(pathname, init = {}) {
        const response = await fetch(fixture.url + pathname, {
            ...init, headers: { origin: fixture.url, ...(cookie ? { cookie } : {}), ...init.headers }
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            assert.match(setCookie, /^detail_session=/);
            for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(setCookie.includes(attribute));
            assert.equal(/Domain=/i.test(setCookie), false);
            cookie = setCookie.includes('Max-Age=0') ? '' : setCookie.split(';')[0];
        }
        assert.equal(response.headers.get('cache-control'), 'no-store');
        if (pathname === '/api/map/public') assert.equal(response.headers.get('vary'), 'Cookie');
        return response;
    }
    const publicAccess = async () => (await (await request('/api/map/public')).json()).detailAccess;
    const login = () => request('/api/auth/details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"passphrase":"demo"}' });
    try {
        assert.equal(await publicAccess(), false);
        assert.equal((await login()).status, 200);
        const cfCookie = cookie;
        assert.equal(await publicAccess(), true);
        assert.equal((await request('/api/map/details?province=北京')).status, 200);
        fixture.select('edgeone');
        assert.equal(await publicAccess(), false);
        assert.equal((await request('/api/map/details?province=北京')).status, 401);
        assert.equal(cookie, cfCookie, '被另一端拒绝时不得自动删除另一标签的新 Cookie');
        assert.equal((await login()).status, 200);
        assert.notEqual(cookie, cfCookie, '相同 Host/name/path 的新登录覆盖浏览器 Cookie');
        assert.equal(await publicAccess(), true);
        assert.equal((await request('/api/map/details?province=北京')).status, 200);
        fixture.select('cloudflare');
        assert.equal(await publicAccess(), false);
        assert.equal((await request('/api/map/details?province=北京')).status, 401);
        assert.equal((await login()).status, 200);
        assert.equal(await publicAccess(), true);
        assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 200);
        assert.equal(cookie, '');
        assert.equal(await publicAccess(), false);
        fixture.select('edgeone');
        assert.equal(await publicAccess(), false);
        assert.equal((await request('/api/map/details?province=北京')).status, 401);
        assert.ok(fixture.observations.some(item => item.platform === 'cloudflare' && item.status === 200));
        assert.ok(fixture.observations.some(item => item.platform === 'edgeone' && item.status === 401));
    } finally { fixture.stop(); }
});

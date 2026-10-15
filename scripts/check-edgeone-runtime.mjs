import assert from 'node:assert/strict';
import { startEdgeoneFixture } from './edgeone-local.mjs';
import { checkFontHttp } from './check-font-http.mjs';

const server = await startEdgeoneFixture();
try {
    const page = await fetch(server.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const asset = await fetch(server.url + '/favicon.svg');
    for (const key of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy']) {
        assert.ok(page.headers.get(key));
        assert.equal(page.headers.get(key), asset.headers.get(key));
    }
    assert.match(page.headers.get('content-security-policy'), /font-src 'self'/);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        assert.match(match[1], /src="\/(?!\/)/);
        assert.equal(match[2].trim(), '');
    }
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|students_raw_|DETAILS_SESSION_SECRET/);
    const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
    const code = await fetch(server.url + script);
    assert.equal(code.status, 200);
    assert.equal(code.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await checkFontHttp(server.url);
    for (const path of ['/.dev.vars', '/js/data.js', '/js/vendor/echarts.min.js', '/edge-functions/api/map/public.js', '/edgeone.json']) {
        assert.equal((await fetch(server.url + path)).status, 404);
    }
    console.log('EdgeOne built artifact HTTP fixture: headers, cache policy, external scripts and private-path checks passed. This is not a Makers/CDN runtime probe.');
} finally { server.stop(); }

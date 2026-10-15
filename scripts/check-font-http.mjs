import assert from 'node:assert/strict';
import fs from 'node:fs';

/** 只验证本地 HTTP 字体资产响应；不把夹具头当线上 CDN 证据。 */
export async function checkFontHttp(base) {
    const manifest = JSON.parse(fs.readFileSync('public/fonts/manifest.json', 'utf8'));
    let count = 0;
    for (const family of manifest.families) {
        for (const shard of [family.shards[0], family.shards.at(-1)]) {
            const response = await fetch(`${base}/fonts/${shard.file}`, { method: 'HEAD' });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
            assert.match(response.headers.get('content-type'), /font\/woff2/);
            count += 1;
        }
    }
    const metadata = await fetch(`${base}/fonts/manifest.json`, { method: 'HEAD' });
    assert.equal(metadata.status, 200);
    assert.doesNotMatch(metadata.headers.get('cache-control') || '', /immutable/);
    const fullSource = await fetch(`${base}/font-sources/noto-sans-sc.aef8c34277af.woff2`, { method: 'HEAD' });
    assert.equal(fullSource.status, 404);
    return count;
}

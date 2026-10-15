import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncDualAssets } from '../scripts/sync-dual-assets.mjs';

function fixture(run) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classmap-dual-assets-'));
    const cf = path.join(root, 'cf');
    const eo = path.join(root, 'eo');
    fs.mkdirSync(cf); fs.mkdirSync(eo);
    try { run(cf, eo); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('cached CF and EO module URLs remain byte-identical after changing target', () => fixture((cf, eo) => {
    fs.writeFileSync(path.join(cf, 'map.cf.js'), 'import("./zhejiang.cf.js");');
    fs.writeFileSync(path.join(cf, 'zhejiang.cf.js'), 'export const region="浙江";');
    fs.writeFileSync(path.join(eo, 'map.eo.js'), 'import("./zhejiang.eo.js");');
    fs.writeFileSync(path.join(eo, 'zhejiang.eo.js'), 'export const region="浙江";');
    assert.equal(fs.existsSync(path.join(eo, 'zhejiang.cf.js')), false);
    assert.deepEqual(syncDualAssets(cf, eo), { files: 4, copiedToCloudflare: 2, copiedToEdgeone: 2 });
    for (const name of fs.readdirSync(cf)) assert.deepEqual(fs.readFileSync(path.join(cf, name)), fs.readFileSync(path.join(eo, name)));
    assert.deepEqual(syncDualAssets(cf, eo), { files: 4, copiedToCloudflare: 0, copiedToEdgeone: 0 });
}));

test('same URL with different bytes is rejected before copying any missing file', () => fixture((cf, eo) => {
    fs.writeFileSync(path.join(cf, 'only-cf.js'), 'export {};');
    fs.writeFileSync(path.join(cf, 'shared.js'), 'const value=1;');
    fs.writeFileSync(path.join(eo, 'shared.js'), 'const value=2;');
    assert.throws(() => syncDualAssets(cf, eo), /DUAL_ASSET_URL_COLLISION/);
    assert.deepEqual(fs.readdirSync(eo), ['shared.js']);
}));

test('source maps are rejected before exposing the additional build surface', () => fixture((cf, eo) => {
    fs.writeFileSync(path.join(cf, 'entry.js'), 'export {};');
    fs.writeFileSync(path.join(eo, 'entry.js.map'), '{}');
    assert.throws(() => syncDualAssets(cf, eo), /DUAL_ASSET_PRIVATE_FILE/);
    assert.equal(fs.existsSync(path.join(cf, 'entry.js.map')), false);
}));

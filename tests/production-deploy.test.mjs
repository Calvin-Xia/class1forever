import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { coordinatedDeploy, deploymentCandidate, validateManifest } from '../scripts/production-deploy.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/production.json', import.meta.url), 'utf8'));
const state = () => ({ release: 'prod_20261015_01', sessionNamespace: config.sessionNamespace, dataNamespace: config.dataNamespace, workersDev: true, previews: true, routes: [...config.routes.map(pattern => ({ pattern, script: config.worker })), { pattern: 'other.example/*', script: 'other-worker' }] });
const built = () => ({ name: config.worker, main: './entry.mjs', assets: { binding: 'ASSETS', directory: '../client' }, kv_namespaces: [{ binding: 'SESSION' }, { binding: 'CLASS_MAP_DATA', id: config.dataNamespace }], vars: { DETAILS_HINT: 'public hint' } });

test('candidate preserves active release, both existing routes, SESSION and entry flags', () => {
    const result = deploymentCandidate(built(), state());
    assert.equal(result.vars.DATA_RELEASE_ID, 'prod_20261015_01');
    assert.equal(result.kv_namespaces.find(x => x.binding === 'SESSION').id, config.sessionNamespace);
    assert.deepEqual(result.routes.map(x => x.pattern), config.routes);
    assert.equal(result.workers_dev, true); assert.equal(result.preview_urls, true);
    assert.equal(result.secrets, undefined);
    assert.throws(() => deploymentCandidate(built(), { ...state(), sessionNamespace: 'unexpected' }), /BINDINGS_MISMATCH/);
    assert.throws(() => deploymentCandidate(built(), { ...state(), routes: [] }), /ROUTES_MISMATCH/);
    assert.throws(() => deploymentCandidate(built(), { ...state(), workersDev: false }), /ENTRY_DISABLED/);
});

test('public history manifest rejects traversal, duplicates, invalid hashes and non-chunks', () => {
    const valid = { schema: 1, files: [{ name: 'zhejiang.hash.js', sha256: 'a'.repeat(64) }] };
    assert.equal(validateManifest(valid), valid);
    for (const name of ['../.dev.vars', 'data.json', 'x.js.map', '/etc/passwd', 'nested/file.js']) assert.throws(() => validateManifest({ schema: 1, files: [{ name, sha256: 'a'.repeat(64) }] }));
    assert.throws(() => validateManifest({ ...valid, files: [...valid.files, ...valid.files] }));
    assert.throws(() => validateManifest({ schema: 1, files: [] }));
});

test('both asset sets become available before a page can introduce new imports', async () => {
    const order = [];
    const names = ['edgeoneCompatibility', 'verifyEdgeoneAssets', 'cloudflare', 'verifyCloudflareAssets', 'edgeoneFinal', 'verifyFinal'];
    await coordinatedDeploy(Object.fromEntries(names.map(name => [name, async () => order.push(name)])));
    assert.deepEqual(order, names);
});

test('EO compatibility failure prevents any CF change; final EO failure stops final success', async () => {
    for (const failed of ['verifyEdgeoneAssets', 'edgeoneFinal']) {
        const order = [];
        const names = ['edgeoneCompatibility', 'verifyEdgeoneAssets', 'cloudflare', 'verifyCloudflareAssets', 'edgeoneFinal', 'verifyFinal'];
        await assert.rejects(coordinatedDeploy(Object.fromEntries(names.map(name => [name, async () => { order.push(name); if (name === failed) throw new Error('fixture failure'); }]))));
        assert.deepEqual(order, names.slice(0, names.indexOf(failed) + 1));
    }
});

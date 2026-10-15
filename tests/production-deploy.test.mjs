import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coordinatedDeploy, deploymentCandidate, validateManifest, validatePreviousPage, responseDiagnostic, stageCompatibility } from '../scripts/production-deploy.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/production.json', import.meta.url), 'utf8'));
const state = () => ({ release: 'prod_20261015_01', sessionNamespace: config.sessionNamespace, dataNamespace: config.dataNamespace, workersDev: true, previews: true, routes: [...config.routes.map(pattern => ({ pattern, script: config.worker })), { pattern: 'other.example/*', script: 'other-worker' }] });
const built = () => ({ name: config.worker, main: './entry.mjs', assets: { binding: 'ASSETS', directory: '../client' }, kv_namespaces: [{ binding: 'SESSION' }, { binding: 'CLASS_MAP_DATA', id: config.dataNamespace }], vars: { DETAILS_HINT: 'public hint' } });

test('compatibility retains the literal .edgeone basename required by Makers CLI', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classmap-package-'));
    try {
        fs.mkdirSync(path.join(root, 'dist-edgeone/.edgeone/assets'), { recursive: true });
        fs.mkdirSync(path.join(root, 'dist-edgeone/.edgeone/edge-functions'), { recursive: true });
        fs.mkdirSync(path.join(root, '.wrangler/production'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist-edgeone/.edgeone/assets/index.html'), 'new HTML');
        fs.writeFileSync(path.join(root, 'dist-edgeone/.edgeone/edge-functions/index.js'), 'compiled API');
        fs.writeFileSync(path.join(root, '.wrangler/production/previous-index.html'), 'previous HTML');
        stageCompatibility(root);
        const directory = path.join(root, '.wrangler/production/edgeone-compatibility');
        assert.deepEqual(fs.readdirSync(directory), ['.edgeone']);
        assert.equal(fs.readFileSync(path.join(directory, '.edgeone/assets/index.html'), 'utf8'), 'previous HTML');
        assert.equal(fs.readFileSync(path.join(directory, '.edgeone/edge-functions/index.js'), 'utf8'), 'compiled API');
        assert.throws(() => stageCompatibility(root), /ALREADY_EXISTS/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('transport diagnostics expose challenge classification without response bodies or cookies', () => {
    const result = responseDiagnostic('cloudflare', { status: 403,
        headers: { server: 'cloudflare', 'cf-mitigated': 'challenge', 'set-cookie': 'private-cookie' },
        bytes: Buffer.from('<span class="cf-error-code">1010</span> private-body') });
    assert.equal(result.errorCode, '1010');
    assert.equal(result.challenge, 'challenge');
    assert.doesNotMatch(JSON.stringify(result), /private-cookie|private-body/);
});

test('previous page ignores documented placeholders but requires all live chunk references', () => {
    const manifest = { files: [{ name: 'app.hash.js' }, { name: 'app.hash.css' }] };
    const html = '<!-- documented /_astro/motion.<hash>.js -->' +
        '<link href="/_astro/app.hash.css" rel="stylesheet">' +
        '<script type="module" src="/_astro/app.hash.js"></script>';
    assert.doesNotThrow(() => validatePreviousPage(html, manifest));
    assert.throws(() => validatePreviousPage(html + '<astro-island component-url="/_astro/missing.hash.js">', manifest), /NOT_IN_PREVIOUS_MANIFEST/);
    assert.throws(() => validatePreviousPage(html + '<script>unsafe()</script>', manifest), /SCRIPT_UNSAFE/);
    assert.throws(() => validatePreviousPage('<script src="https://external.example/app.js"></script>', manifest), /SCRIPT_UNSAFE/);
});

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

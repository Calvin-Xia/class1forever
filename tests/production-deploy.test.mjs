import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coordinatedDeploy, deploymentCandidate, validateManifest, validatePreviousPage, responseDiagnostic, stageCompatibility, deploy, cloudflareState, edgeoneProject, edgeoneProductionDeployment, assertEdgeoneProductionUnchanged, assertMainNotSuperseded, assertProductionEnvironment, assertUnchangedSincePrepare } from '../scripts/production-deploy.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/production.json', import.meta.url), 'utf8'));
const state = () => ({ release: 'prod_20261015_01', sessionNamespace: config.sessionNamespace, dataNamespace: config.dataNamespace, workersDev: true, previews: true, routes: [...config.routes.map(pattern => ({ pattern, script: config.worker })), { pattern: 'other.example/*', script: 'other-worker' }] });
const built = () => ({ name: config.worker, main: './entry.mjs', assets: { binding: 'ASSETS', directory: '../client' }, kv_namespaces: [{ binding: 'SESSION' }, { binding: 'CLASS_MAP_DATA', id: config.dataNamespace }], vars: { DETAILS_HINT: 'public hint' } });

/* 可注入读取的固定 payload：让守卫的负例完全离线，不碰真实 Cloudflare / EdgeOne。
   `mutate` 用来构造某一个字段漂移的变体。 */
function cloudflareApi(mutate = () => {}) {
    const payloads = {
        settings: { bindings: [
            { name: 'DATA_RELEASE_ID', text: 'prod_20261015_01' },
            { name: 'SESSION', namespace_id: config.sessionNamespace },
            { name: 'CLASS_MAP_DATA', namespace_id: config.dataNamespace },
            { name: 'DETAILS_PASSPHRASE', type: 'secret_text' },
            { name: 'DETAILS_SESSION_SECRET', type: 'secret_text' }
        ] },
        routes: [{ pattern: 'other.example/*', script: 'other-worker' }, { pattern: config.routes[0], script: config.worker }, { pattern: config.routes[1], script: config.worker }],
        subdomain: { enabled: true, previews_enabled: true },
        deployments: { deployments: [{ versions: [{ version_id: 'v1' }] }] }
    };
    mutate(payloads);
    return async (suffix) => {
        if (suffix.endsWith('/settings')) return payloads.settings;
        if (suffix.endsWith('/subdomain')) return payloads.subdomain;
        if (suffix.endsWith('/deployments')) return payloads.deployments;
        return payloads.routes;
    };
}

const cfState = (overrides = {}) => ({
    release: 'prod_20261015_01', sessionNamespace: config.sessionNamespace, dataNamespace: config.dataNamespace,
    workersDev: true, previews: true, version: 'v1',
    routes: [...config.routes].sort().map(pattern => ({ pattern, script: config.worker })),
    ...overrides
});
const before = (overrides = {}) => ({
    cloudflare: cfState(), edgeoneProjectId: config.edgeoneProjectId, edgeoneProductionDeployment: 'eo-production-1',
    public: { release: 'prod_20261015_01', data: { stats: { total: 6 } } }, ...overrides
});
const mainEnvironment = (overrides = {}) => ({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40), ...overrides });
const deployDependencies = (overrides = {}) => ({
    environment: mainEnvironment(), readMainSha: async () => 'a'.repeat(40), readState: () => before(),
    cloudflare: async () => cfState(), edgeone: async () => ({ ProjectId: config.edgeoneProjectId, Name: config.edgeoneProject, Area: 'global' }),
    edgeoneProduction: async () => 'eo-production-1', ...overrides
});

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

test('cloudflareState derives release, both KV bindings, routes and entry flags from the injected API', async () => {
    const derived = await cloudflareState(cloudflareApi());
    assert.equal(derived.release, 'prod_20261015_01');
    assert.equal(derived.sessionNamespace, config.sessionNamespace);
    assert.equal(derived.dataNamespace, config.dataNamespace);
    assert.deepEqual(derived.routes.map(x => x.pattern), [config.routes[0], config.routes[1], 'other.example/*'].sort());
    assert.equal(derived.workersDev, true);
    assert.equal(derived.previews, true);
    assert.equal(derived.version, 'v1');
    await assert.rejects(cloudflareState(cloudflareApi(p => { p.settings.bindings = p.settings.bindings.filter(b => b.name !== 'DETAILS_SESSION_SECRET'); })), /EXISTING_SECRETS_MISSING/);
    await assert.rejects(cloudflareState(cloudflareApi(p => { p.settings.bindings = p.settings.bindings.filter(b => b.name !== 'DATA_RELEASE_ID'); })), /ACTIVE_DATA_RELEASE_MISSING/);
    await assert.rejects(cloudflareState(cloudflareApi(p => { p.settings.bindings = p.settings.bindings.map(b => b.name === 'DETAILS_PASSPHRASE' ? { ...b, type: 'plain_text' } : b); })), /EXISTING_SECRETS_MISSING/);
});

test('edgeoneProject and edgeoneProductionDeployment read the pinned project and only the Production deployment', async () => {
    const api = (payload) => async () => payload;
    const project = { ProjectId: config.edgeoneProjectId, Name: config.edgeoneProject, Area: 'global' };
    assert.equal((await edgeoneProject(api({ Projects: [project] }))).ProjectId, config.edgeoneProjectId);
    await assert.rejects(edgeoneProject(api({ Projects: [{ ...project, Area: 'cn' }] })), /EXISTING_EDGEONE_PROJECT_MISMATCH/);
    assert.equal(await edgeoneProductionDeployment(api({ Deployments: [
        { DeploymentId: 'eo-preview-new', Env: 'Preview' }, { DeploymentId: 'eo-production-1', Env: 'Production' }
    ] })), 'eo-production-1');
    await assert.rejects(edgeoneProductionDeployment(api({ Deployments: [{ DeploymentId: 'eo-preview-new', Env: 'Preview' }] })), /EXISTING_EDGEONE_PRODUCTION_MISSING/);
    await assert.rejects(edgeoneProductionDeployment(api({})), /EXISTING_EDGEONE_PRODUCTION_MISSING/);
});

test('production guards reject anything but a main-branch GitHub Actions run', async () => {
    for (const environment of [
        {},
        { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/dev', GITHUB_SHA: 'a'.repeat(40) },
        { GITHUB_ACTIONS: 'false', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40) },
        { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'abc123' },
        { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main' }
    ]) {
        assert.throws(() => assertProductionEnvironment(environment), /PRODUCTION_REQUIRES_MAIN_GITHUB_ACTIONS/);
        /* deploy() 必须在读 before.json / 连网之前就中止：readState 被调用本身即失败。 */
        await assert.rejects(deploy(deployDependencies({ environment, readState: () => { throw new Error('UNREACHED_STATE_READ'); } })), /PRODUCTION_REQUIRES_MAIN_GITHUB_ACTIONS/);
    }
    assert.doesNotThrow(() => assertProductionEnvironment(mainEnvironment()));
});

test('deploy re-checks main and aborts when a newer commit landed or the remote is unreachable', async () => {
    await assert.rejects(deploy(deployDependencies({ readMainSha: async () => 'b'.repeat(40) })), /MAIN_SUPERSEDED_BEFORE_DEPLOY/);
    await assert.rejects(deploy(deployDependencies({ readMainSha: async () => null })), /MAIN_SHA_UNAVAILABLE/);
    await assert.rejects(deploy(deployDependencies({ readMainSha: async () => '' })), /MAIN_SHA_UNAVAILABLE/);
    assert.throws(() => assertMainNotSuperseded(null, 'a'.repeat(40)), /MAIN_SHA_UNAVAILABLE/);
    assert.throws(() => assertMainNotSuperseded('b'.repeat(40), 'a'.repeat(40)), /MAIN_SUPERSEDED/);
    assert.doesNotThrow(() => assertMainNotSuperseded('a'.repeat(40), 'a'.repeat(40)));
});

test('deploy aborts when Cloudflare, EO production or the EO project changed since prepare', async () => {
    await assert.rejects(deploy(deployDependencies({ cloudflare: async () => cfState({ release: 'prod_20261015_02' }) })), /PRODUCTION_CHANGED_SINCE_PREPARE/);
    await assert.rejects(deploy(deployDependencies({ edgeoneProduction: async () => 'eo-production-2' })), /EDGEONE_PRODUCTION_CHANGED_SINCE_PREPARE/);
    await assert.rejects(deploy(deployDependencies({ edgeone: async () => ({ ProjectId: 'makers-other' }) })), /EDGEONE_PROJECT_CHANGED_SINCE_PREPARE/);
    /* 旧 before.json（没有 edgeoneProductionDeployment 字段）必须失败关闭，而不是当作没变化。 */
    await assert.rejects(deploy(deployDependencies({ readState: () => before({ edgeoneProductionDeployment: undefined }) })), /EDGEONE_PRODUCTION_CHANGED_SINCE_PREPARE/);
    assert.throws(() => assertUnchangedSincePrepare({ a: 1 }, { a: 2 }, 'PRODUCTION_CHANGED_SINCE_PREPARE'), /PRODUCTION_CHANGED_SINCE_PREPARE/);
    assert.doesNotThrow(() => assertUnchangedSincePrepare({ a: 1 }, { a: 1 }, 'PRODUCTION_CHANGED_SINCE_PREPARE'));
});

test('the final EO phase refuses to publish when EO production is not the compatibility deployment', () => {
    assert.throws(() => assertEdgeoneProductionUnchanged('eo-compatibility-1', 'eo-out-of-band'), /EDGEONE_PRODUCTION_DEPLOYMENT_CHANGED/);
    assert.throws(() => assertEdgeoneProductionUnchanged(undefined, 'eo-compatibility-1'), /EDGEONE_PRODUCTION_DEPLOYMENT_CHANGED/);
    assert.throws(() => assertEdgeoneProductionUnchanged('eo-compatibility-1', 'eo-compatibility-1'.toUpperCase()), /EDGEONE_PRODUCTION_DEPLOYMENT_CHANGED/);
    assert.doesNotThrow(() => assertEdgeoneProductionUnchanged('eo-compatibility-1', 'eo-compatibility-1'));
});

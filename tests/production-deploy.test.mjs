import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinatedDeploy, deployEdgeone, deploymentCandidate, eoApi, validateManifest, validatePreviousPage, responseDiagnostic, stageCompatibility, deploy, cloudflareState, edgeoneProject, edgeoneProductionDeployment, assertEdgeoneProductionUnchanged, assertMainNotSuperseded, assertProductionEnvironment, assertUnchangedSincePrepare, verifyAssets, classifyFailure } from '../scripts/production-deploy.mjs';

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

/* 2026-10-16 的线上发布：EO 兼容包其实已经发上去了（清单从 89 变 108 个文件），
   但随后的控制面读回拿到一个没有 Deployments 数组的响应，`live.Deployments.some(...)`
   抛 TypeError，被顶层 catch 归类成不可诊断的 PRODUCTION_DEPLOY_FAILED。以下三个用例
   把「响应形状不对」与「CLI 之后发生了什么」固定成可分类、可回归的行为。 */
function withEdgeoneCliEntry(operation) {
    const previous = process.env.EDGEONE_CLI_ENTRY;
    process.env.EDGEONE_CLI_ENTRY = fileURLToPath(import.meta.url);
    return Promise.resolve()
        .then(operation)
        .finally(() => {
            if (previous === undefined) delete process.env.EDGEONE_CLI_ENTRY;
            else process.env.EDGEONE_CLI_ENTRY = previous;
        });
}

test('EO deploy refuses to continue when the control plane omits the deployment list', async () => {
    await withEdgeoneCliEntry(() => assert.rejects(
        deployEdgeone(path.join(os.tmpdir(), 'classmap-package/.edgeone'), 'edgeone-compatibility', 'production', {
            verifyProject: async () => ({ ProjectId: config.edgeoneProjectId }),
            run: () => '{"deploymentId":"abc123"}',
            describe: async () => ({ RequestId: 'fixture-without-deployments' })
        }),
        /EDGEONE_DEPLOYMENTS_MISSING/
    ));
});

test('EO deploy accepts a successful production deployment through the injected control plane', async () => {
    await withEdgeoneCliEntry(async () => {
        const id = await deployEdgeone(path.join(os.tmpdir(), 'classmap-package/.edgeone'), 'edgeone-compatibility', 'production', {
            verifyProject: async () => ({ ProjectId: config.edgeoneProjectId }),
            run: () => '{"deploymentId":"abc123"}',
            describe: async () => ({ Deployments: [{ DeploymentId: 'abc123', Status: 'Success', Env: 'Production' }] })
        });
        assert.equal(id, 'abc123');
    });
});

test('EO control-plane transport and body failures get their own codes instead of an opaque failure', async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.EDGEONE_API_TOKEN;
    process.env.EDGEONE_API_TOKEN = 'fixture-token';
    try {
        globalThis.fetch = async () => {
            const error = new Error('fixture timeout');
            error.name = 'TimeoutError';
            throw error;
        };
        await assert.rejects(eoApi('DescribePagesDeployments', {}), /EDGEONE_API_TIMEOUT/);

        globalThis.fetch = async () => new Response('<html>gateway</html>', { status: 502 });
        await assert.rejects(eoApi('DescribePagesDeployments', {}), /EDGEONE_API_INVALID_BODY_502/);

        globalThis.fetch = async () => new Response(JSON.stringify({ Data: { Response: { Deployments: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } });
        const payload = await eoApi('DescribePagesDeployments', {});
        assert.deepEqual(payload, { Deployments: [] });
    } finally {
        globalThis.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.EDGEONE_API_TOKEN;
        else process.env.EDGEONE_API_TOKEN = originalToken;
    }
});

/* 2026-10-17 的线上发布被「读回太急」卡住：EO 兼容部署控制面确认后 **0.54 秒**就读回资产，
   新 chunk 还没传播到边缘 → `LIVE_ASSET_BYTES_MISMATCH_EDGEONE`（事后复现：123 个文件逐字节
   不符 0 个）。以下三个用例把「有界重试」「逐文件诊断」「错误码不变」固定下来，全部用注入的
   request 离线构造，不碰生产网络。 */
const assetSha = value => crypto.createHash('sha256').update(value).digest('hex');
const assetBodies = names => new Map(names.map(name => [name, Buffer.from('body-of-' + name)]));
const assetManifest = names => ({ schema: 1, files: names.map(name => ({ name, sha256: assetSha('body-of-' + name) })) });

test('asset read-back retries while the edge is still propagating and keeps the success line shape', async () => {
    const names = ['app.aaaa.js', 'chunk.bbbb.css', 'motion.cccc.js'];
    const bodies = assetBodies(names);
    const lines = [];
    let pass = 0;

    await verifyAssets('edgeone', {
        manifest: assetManifest(names),
        delays: [0, 0, 0],
        sleep: async () => { pass += 1; }, // 每次「等待」＝进入下一轮
        log: line => lines.push(line),
        request: async (_platform, pathname) => {
            const name = pathname.replace('/_astro/', '');
            /* 第一轮：边缘还没传播（两个新 chunk 404）；第二轮：齐全。 */
            if (pass === 0 && name !== names[0]) return { status: 404, headers: {}, bytes: Buffer.from('not propagated yet') };
            return { status: 200, headers: {}, bytes: bodies.get(name) };
        }
    });

    const retries = lines.map(line => JSON.parse(line)).filter(entry => entry.phase === 'verify-assets-retry');
    assert.equal(retries.length, 1);
    assert.equal(retries[0].platform, 'edgeone');
    assert.equal(retries[0].attempt, 1);
    assert.equal(retries[0].maxAttempts, 3);
    assert.equal(retries[0].failed, 2);
    assert.deepEqual(retries[0].names.slice().sort(), [names[1], names[2]].sort());
    assert.deepEqual(retries[0].statuses, [404, 404]);
    assert.equal(retries[0].digestMismatch, 0);
    assert.equal(retries[0].nextRetryInMs, 0);

    /* 成功那一行的形状保持不变：外部验收脚本可能按字段读它。 */
    assert.deepEqual(JSON.parse(lines.at(-1)), { phase: 'verify-assets', platform: 'edgeone', files: 3, passed: true });
    assert.equal(lines.length, 2);
});

test('a file that never appears fails only after the bounded retries, with name and status in the message', async () => {
    const names = ['app.aaaa.js', 'chunk.bbbb.css'];
    const bodies = assetBodies(names);
    const lines = [];
    const missing = names[1];

    await assert.rejects(
        verifyAssets('edgeone', {
            manifest: assetManifest(names),
            delays: [0, 0, 0],
            sleep: async () => {},
            log: line => lines.push(line),
            request: async (_platform, pathname) =>
                pathname.endsWith(missing)
                    ? { status: 404, headers: {}, bytes: Buffer.from('still missing') }
                    : { status: 200, headers: {}, bytes: bodies.get(names[0]) }
        }),
        error => {
            assert.match(error.message, /^LIVE_ASSET_BYTES_MISMATCH_EDGEONE/);
            assert.match(error.message, /platform=edgeone/);
            assert.match(error.message, /attempts=3/);
            assert.match(error.message, /failed=1/);
            assert.ok(error.message.includes(missing), `消息里应有失败文件名 ${missing}：${error.message}`);
            assert.ok(error.message.includes('"status":404'), `消息里应有 HTTP 状态：${error.message}`);
            assert.ok(error.message.includes('"live":"-"'), `404 没有 live digest，应为 "-"：${error.message}`);
            assert.ok(error.message.includes(`"expected":"${assetSha('body-of-' + missing).slice(0, 12)}"`), error.message);
            return true;
        }
    );

    const retries = lines.map(line => JSON.parse(line)).filter(entry => entry.phase === 'verify-assets-retry');
    assert.equal(retries.length, 3, '每一轮失败都要打一行 retry JSON');
    assert.deepEqual(retries.map(entry => entry.failed), [1, 1, 1]);
    assert.equal(retries.at(-1).nextRetryInMs, null, '最后一轮不应再声明下一次间隔');
});

test('a byte difference is reported with both digests and stays distinguishable from a 404', async () => {
    const names = ['app.aaaa.js', 'chunk.bbbb.css'];
    const bodies = assetBodies(names);
    const lines = [];
    const tampered = names[1];
    const tamperedBytes = Buffer.from('tampered bytes');

    await assert.rejects(
        verifyAssets('cloudflare', {
            manifest: assetManifest(names),
            delays: [0],
            sleep: async () => {},
            log: line => lines.push(line),
            request: async (_platform, pathname) =>
                pathname.endsWith(tampered)
                    ? { status: 200, headers: {}, bytes: tamperedBytes }
                    : { status: 200, headers: {}, bytes: bodies.get(names[0]) }
        }),
        error => {
            assert.match(error.message, /^LIVE_ASSET_BYTES_MISMATCH_CLOUDFLARE/);
            assert.ok(error.message.includes(tampered), error.message);
            assert.ok(error.message.includes('"status":200'), error.message);
            assert.ok(!error.message.includes('"status":404'), `字节不同必须与 404 可区分：${error.message}`);
            assert.ok(error.message.includes(`"live":"${assetSha(tamperedBytes).slice(0, 12)}"`), error.message);
            assert.ok(error.message.includes(`"expected":"${assetSha('body-of-' + tampered).slice(0, 12)}"`), error.message);
            return true;
        }
    );

    const retries = lines.map(line => JSON.parse(line)).filter(entry => entry.phase === 'verify-assets-retry');
    assert.equal(retries.length, 1);
    assert.equal(retries[0].digestMismatch, 1);
    assert.deepEqual(retries[0].statuses, [200]);
});

test('the top-level classifier keeps the error code and only surfaces structured detail for classified codes', () => {
    const classified = classifyFailure(new Error('LIVE_ASSET_BYTES_MISMATCH_EDGEONE platform=edgeone attempts=5 failed=1 details=[{"name":"x.js","status":404}]'));
    assert.equal(classified.classified, true);
    assert.equal(classified.code, 'LIVE_ASSET_BYTES_MISMATCH_EDGEONE');
    assert.match(classified.detail, /platform=edgeone/);
    assert.match(classified.detail, /"name":"x\.js"/);

    /* 未分类的错误绝不透出 message：它可能带 URL、响应片段或凭据，只允许暴露 name 类别。 */
    const opaque = classifyFailure(new TypeError('https://user:secret@api.example/v1?token=abc failed with 500'));
    assert.equal(opaque.classified, false);
    assert.equal(opaque.code, 'PRODUCTION_DEPLOY_FAILED');
    assert.equal(opaque.detail, '');
    assert.equal(opaque.cause, 'TYPEERROR');

    assert.equal(classifyFailure(new Error('MAIN_SUPERSEDED_BEFORE_DEPLOY')).code, 'MAIN_SUPERSEDED_BEFORE_DEPLOY');
    assert.equal(classifyFailure(new Error('MAIN_SUPERSEDED_BEFORE_DEPLOY')).detail, '');
});

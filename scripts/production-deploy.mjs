import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { syncDualAssets } from './sync-dual-assets.mjs';
import { queryDns, isPublicIpv4 } from './geodns-preflight.mjs';
import toolEnvironment from './local-tool-env.cjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORK = path.join(ROOT, '.wrangler/production');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/production.json'), 'utf8'));
const transportAddresses = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const check = (condition, code) => { if (!condition) throw new Error(code); };
const read = name => JSON.parse(fs.readFileSync(path.join(WORK, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(WORK, name), JSON.stringify(value, null, 2) + '\n');

export function validateManifest(manifest) {
    check(manifest?.schema === 1 && Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000, 'INVALID_PUBLIC_ASSET_MANIFEST');
    const seen = new Set();
    for (const file of manifest.files) {
        check(typeof file.name === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css)$/.test(file.name) && !file.name.includes('..') && /^[a-f0-9]{64}$/.test(file.sha256) && !seen.has(file.name), 'INVALID_PUBLIC_ASSET_ENTRY');
        seen.add(file.name);
    }
    return manifest;
}

export function validatePreviousPage(html, previous) {
    // Only actual markup references resources; comments may document placeholder URLs.
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const match of markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) check(/\bsrc="\/(?!\/)/.test(match[1]) && match[2].trim() === '', 'EXISTING_PAGE_SCRIPT_UNSAFE');
    for (const match of markup.matchAll(/\/_astro\/([A-Za-z0-9_.-]+)/g)) check(previous.files.some(file => file.name === match[1]), 'EXISTING_PAGE_NOT_IN_PREVIOUS_MANIFEST');
}

export function deploymentCandidate(built, state, root = ROOT) {
    check(built.name === config.worker && /^[A-Za-z0-9_]{1,64}$/.test(state.release || '') && state.sessionNamespace === config.sessionNamespace && state.dataNamespace === config.dataNamespace, 'PRODUCTION_BINDINGS_MISMATCH');
    check(state.workersDev === true && state.previews === true, 'EXISTING_WORKER_ENTRY_DISABLED');
    check(isDeepStrictEqual(state.routes.filter(x => x.script === config.worker).map(x => x.pattern).sort(), [...config.routes].sort()), 'PRODUCTION_ROUTES_MISMATCH');
    const candidate = structuredClone(built);
    for (const key of ['configPath', 'userConfigPath', 'topLevelName', 'definedEnvironments']) delete candidate[key];
    candidate.account_id = config.accountId;
    candidate.main = path.resolve(root, 'dist/server', built.main);
    candidate.assets.directory = path.resolve(root, 'dist/server', built.assets.directory);
    candidate.workers_dev = state.workersDev; candidate.preview_urls = state.previews;
    candidate.routes = config.routes.map(pattern => ({ pattern, zone_id: config.zoneId }));
    candidate.kv_namespaces = candidate.kv_namespaces.map(binding => binding.binding === 'SESSION' ? { ...binding, id: state.sessionNamespace } : binding);
    check(candidate.kv_namespaces.some(x => x.binding === 'SESSION') && candidate.kv_namespaces.some(x => x.binding === 'CLASS_MAP_DATA' && x.id === state.dataNamespace), 'BUILT_KV_BINDINGS_MISMATCH');
    candidate.vars = { ...candidate.vars, DATA_RELEASE_ID: state.release };
    return candidate;
}

// Failure-order tests exercise this exact connected-deployment sequence.
export async function coordinatedDeploy(actions) {
    await actions.edgeoneCompatibility();
    await actions.verifyEdgeoneAssets();
    await actions.cloudflare();
    await actions.verifyCloudflareAssets();
    await actions.edgeoneFinal();
    await actions.verifyFinal();
}

async function cfApi(suffix) {
    check(process.env.CLOUDFLARE_API_TOKEN, 'MISSING_CLOUDFLARE_API_TOKEN');
    if (process.env.CLOUDFLARE_ACCOUNT_ID) check(process.env.CLOUDFLARE_ACCOUNT_ID === config.accountId, 'CLOUDFLARE_ACCOUNT_MISMATCH');
    const r = await fetch('https://api.cloudflare.com/client/v4' + suffix, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json(); check(r.ok && j.success, `CLOUDFLARE_API_${r.status}`); return j.result;
}

async function eoApi(Action, fields) {
    check(process.env.EDGEONE_API_TOKEN, 'MISSING_EDGEONE_API_TOKEN');
    const r = await fetch('https://pages-api.cloud.tencent.com/v1', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EDGEONE_API_TOKEN}` }, body: JSON.stringify({ Action, ...fields }), signal: AbortSignal.timeout(20000) });
    const j = await r.json(); check(r.ok && j.Data?.Response && !j.Data.Response.Error, `EDGEONE_API_${r.status}`); return j.Data.Response;
}

async function cloudflareState() {
    const base = `/accounts/${config.accountId}/workers/scripts/${config.worker}`;
    const [settings, routes, entry, deployments] = await Promise.all([cfApi(base + '/settings'), cfApi(`/zones/${config.zoneId}/workers/routes`), cfApi(base + '/subdomain'), cfApi(base + '/deployments')]);
    const binding = name => settings.bindings.find(x => x.name === name);
    const release = binding('DATA_RELEASE_ID')?.text;
    check(typeof release === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(release), 'ACTIVE_DATA_RELEASE_MISSING');
    check(['DETAILS_PASSPHRASE', 'DETAILS_SESSION_SECRET'].every(name => binding(name)?.type === 'secret_text'), 'EXISTING_SECRETS_MISSING');
    return { release, routes: routes.map(x => ({ pattern: x.pattern, script: x.script })).sort((a, b) => a.pattern.localeCompare(b.pattern)), sessionNamespace: binding('SESSION')?.namespace_id, dataNamespace: binding('CLASS_MAP_DATA')?.namespace_id, workersDev: entry.enabled, previews: entry.previews_enabled, version: deployments.deployments[0].versions[0].version_id };
}

async function edgeoneProject() {
    const j = await eoApi('DescribePagesProjects', { Filters: [{ Name: 'ProjectId', Values: [config.edgeoneProjectId] }], Offset: 0, Limit: 10 });
    const project = j.Projects?.find(x => x.ProjectId === config.edgeoneProjectId);
    check(project?.Name === config.edgeoneProject && project.Area === 'global', 'EXISTING_EDGEONE_PROJECT_MISMATCH'); return project;
}

const probeHeaders = { 'User-Agent': 'classmap-production-ci/1.0', Accept: '*/*' };

export function responseDiagnostic(platform, response) {
    const html = response.bytes.toString('utf8');
    return { platform, status: response.status, server: response.headers.server,
        cache: response.headers['cache-control'], contentType: response.headers['content-type'],
        challenge: response.headers['cf-mitigated'], ray: response.headers['cf-ray'],
        errorCode: html.match(/(?:error code:|error-code">)\s*(\d{4})/i)?.[1] };
}

async function request(platform, pathname, headers = probeHeaders) {
    const target = platform === 'cloudflare' ? config.cloudflareTarget : config.edgeoneTarget;
    if (!transportAddresses.has(target)) {
        const dns = await queryDns('google', target, 'A');
        const address = dns.Answer?.find(x => x.type === 1 && isPublicIpv4(x.data))?.data;
        check(address, 'PLATFORM_PUBLIC_ADDRESS_UNAVAILABLE');
        transportAddresses.set(target, address);
    }
    const address = transportAddresses.get(target);
    return new Promise((resolve, reject) => {
        const req = https.get({ hostname: config.host, servername: config.host, path: pathname, headers, agent: false, rejectUnauthorized: true,
            lookup: (_h, options, cb) => options.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4) }, response => {
            const buffers = []; response.on('data', bytes => buffers.push(bytes));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(buffers) }));
        });
        req.setTimeout(20000, () => req.destroy(new Error('EDGEONE_REQUEST_TIMEOUT'))); req.on('error', reject);
    });
}

async function publicData(platform) {
    const r = await request(platform, '/api/map/public');
    console.log(JSON.stringify({ phase: 'public-api-preflight', ...responseDiagnostic(platform, r) }));
    check(r.status === 200 && r.headers['cache-control'] === 'no-store', 'PUBLIC_API_UNAVAILABLE');
    const data = JSON.parse(r.bytes); check(data.detailModeAvailable === true, 'DETAIL_AUTH_UNAVAILABLE');
    return { release: r.headers['x-data-release'], data };
}

async function diagnoseTransport() {
    for (const [platform, headers, caller] of [['cloudflare', {}, 'missing-user-agent'], ['cloudflare', probeHeaders, 'identified-ci'], ['edgeone', probeHeaders, 'identified-ci']]) {
        const response = await request(platform, '/api/map/public', headers);
        console.log(JSON.stringify({ phase: 'transport-diagnostic', caller, ...responseDiagnostic(platform, response) }));
    }
}

async function parallelFiles(files, operation) {
    for (let index = 0; index < files.length; index += 6) await Promise.all(files.slice(index, index + 6).map(operation));
}

async function prepare() {
    fs.mkdirSync(WORK, { recursive: true });
    const [state, project, cfPublic, eoPublic] = await Promise.all([cloudflareState(), edgeoneProject(), publicData('cloudflare'), publicData('edgeone')]);
    check(state.release === cfPublic.release && state.release === eoPublic.release && isDeepStrictEqual(cfPublic.data, eoPublic.data), 'PLATFORM_DATA_OR_RELEASE_DIFFER');
    const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/server/wrangler.json'), 'utf8'));
    write('wrangler.json', deploymentCandidate(built, state));
    const active = await request('cloudflare', '/deployment-assets.json');
    let previous;
    if (active.status === 404) {
        previous = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/production-assets-bootstrap.json'), 'utf8'));
        const deployments = await eoApi('DescribePagesDeployments', { ProjectId: config.edgeoneProjectId, Offset: 0, Limit: 1, OrderBy: 'CreatedOn', Order: 'Desc' });
        check(state.version === previous.workerVersion && deployments.Deployments?.[0]?.DeploymentId === previous.edgeoneDeployment, 'BOOTSTRAP_DEPLOYMENT_DRIFT');
    } else { check(active.status === 200, 'PREVIOUS_ASSET_MANIFEST_UNAVAILABLE'); previous = JSON.parse(active.bytes); }
    validateManifest(previous);
    const archive = path.join(WORK, 'previous'); fs.mkdirSync(archive, { recursive: true });
    await parallelFiles(previous.files, async file => {
        const r = await request('cloudflare', '/_astro/' + file.name);
        check(r.status === 200 && digest(r.bytes) === file.sha256, 'PREVIOUS_PUBLIC_ASSET_MISMATCH');
        fs.writeFileSync(path.join(archive, file.name), r.bytes);
    });
    const cfAssets = path.join(ROOT, 'dist/client/_astro'), eoAssets = path.join(ROOT, 'dist-edgeone/static/_astro');
    syncDualAssets(cfAssets, archive); syncDualAssets(cfAssets, eoAssets);
    const manifest = validateManifest({ schema: 1, files: fs.readdirSync(cfAssets).sort().map(name => ({ name, sha256: digest(fs.readFileSync(path.join(cfAssets, name))) })) });
    for (const directory of ['dist/client', 'dist-edgeone/static']) fs.writeFileSync(path.join(ROOT, directory, 'deployment-assets.json'), JSON.stringify(manifest) + '\n');
    write('assets.json', manifest);
    const oldPage = await request('edgeone', '/');
    check(oldPage.status === 200 && /<html\b/i.test(oldPage.bytes.toString()), 'EXISTING_EDGEONE_PAGE_MISSING');
    validatePreviousPage(oldPage.bytes.toString(), previous);
    fs.writeFileSync(path.join(WORK, 'previous-index.html'), oldPage.bytes);
    write('before.json', { cloudflare: state, edgeoneProjectId: project.ProjectId, public: cfPublic, previousFiles: previous.files.length, retainedFiles: manifest.files.length });
    console.log(JSON.stringify({ prepared: true, release: state.release, previousFiles: previous.files.length, retainedFiles: manifest.files.length, cloudWrites: false }));
}

export function stageCompatibility(root = ROOT) {
    const work = path.join(root, '.wrangler/production');
    // The CLI recognizes precompiled output by the literal .edgeone basename.
    const compatibility = path.join(work, 'edgeone-compatibility/.edgeone');
    check(!fs.existsSync(compatibility), 'COMPATIBILITY_PACKAGE_ALREADY_EXISTS');
    fs.cpSync(path.join(root, 'dist-edgeone/.edgeone'), compatibility, { recursive: true });
    fs.copyFileSync(path.join(work, 'previous-index.html'), path.join(compatibility, 'assets/index.html'));
    check(fs.existsSync(path.join(compatibility, 'edge-functions/index.js')), 'COMPATIBILITY_API_MISSING');
    console.log('Compatibility package prepared with previous public HTML and retained/new public chunks.');
}

function runCli(script, args, extraEnvironment, label) {
    const child = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, env: toolEnvironment.localToolEnvironment({ CI: '1', ...extraEnvironment }), input: 'y\n', encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 4000000 });
    let output = (child.stdout || '') + '\n' + (child.stderr || '');
    for (const secret of [process.env.CLOUDFLARE_API_TOKEN, process.env.EDGEONE_API_TOKEN].filter(Boolean)) output = output.replaceAll(secret, 'REDACTED');
    output = output.replace(/eo_token=[^&"\s]+/g, 'eo_token=REDACTED');
    fs.writeFileSync(path.join(WORK, label + '.private.log'), output);
    if (child.status !== 0) console.error(output.split('\n').filter(line => /error|permission|authentication|unauthorized|forbidden|code:/i.test(line)).join('\n').slice(-2000));
    check(child.status === 0, label.toUpperCase().replaceAll('-', '_') + '_FAILED'); return output;
}

async function deployEdgeone(directory, label, environment = 'production') {
    await edgeoneProject(); // Never allow CLI's implicit project creation.
    check(process.env.EDGEONE_CLI_ENTRY && fs.existsSync(process.env.EDGEONE_CLI_ENTRY), 'EDGEONE_CLI_MISSING');
    console.log(JSON.stringify({ phase: label, status: 'publishing', projectId: config.edgeoneProjectId }));
    check(path.basename(directory) === '.edgeone', 'EDGEONE_PRECOMPILED_DIRECTORY_REQUIRED');
    const output = runCli(process.env.EDGEONE_CLI_ENTRY, ['makers', 'deploy', directory, '--name', config.edgeoneProject, '--token', process.env.EDGEONE_API_TOKEN, '--env', environment, '--skip-ai-gateway-sync', '--json'], {}, label);
    const id = output.match(/"deploymentId":"([a-z0-9]+)"/)?.[1]; check(id, 'EDGEONE_DEPLOYMENT_ID_MISSING');
    const live = await eoApi('DescribePagesDeployments', { ProjectId: config.edgeoneProjectId, Offset: 0, Limit: 5, OrderBy: 'CreatedOn', Order: 'Desc' });
    check(live.Deployments.some(x => x.DeploymentId === id && x.Status === 'Success' && x.Env === (environment === 'preview' ? 'Preview' : 'Production')), 'EDGEONE_DEPLOYMENT_NOT_SUCCESS');
    console.log(JSON.stringify({ phase: label, deploymentId: id, projectId: config.edgeoneProjectId }));
    if (environment === 'preview') {
        const result = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(x => x.deploymentId === id);
        check(result?.url, 'EDGEONE_PREVIEW_URL_MISSING');
        return { id, url: result.url };
    }
    return id;
}

async function verifyPreview() {
    const deployment = await deployEdgeone(path.join(ROOT, 'dist-edgeone/.edgeone'), 'edgeone-preview', 'preview');
    const base = new URL(deployment.url);
    check(base.protocol === 'https:' && base.hostname === `classmap-cn-${deployment.id}.edgeone.cool`, 'EDGEONE_PREVIEW_HOST_MISMATCH');
    const get = pathname => new Promise((resolve, reject) => {
        const url = new URL(base); url.pathname = pathname;
        const req = https.get(url, { headers: probeHeaders, agent: false, rejectUnauthorized: true }, response => {
            const buffers = []; response.on('data', b => buffers.push(b));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(buffers) }));
        });
        req.setTimeout(20000, () => req.destroy(new Error('PREVIEW_REQUEST_TIMEOUT'))); req.on('error', reject);
    });
    const before = read('before.json');
    const response = await get('/api/map/public');
    check(response.status === 200 && response.headers['cache-control'] === 'no-store' && response.headers['x-data-release'] === before.public.release && isDeepStrictEqual(JSON.parse(response.bytes), before.public.data), 'PREVIEW_PUBLIC_API_MISMATCH');
    check((await get('/')).status === 200, 'PREVIEW_PAGE_UNAVAILABLE');
    const manifest = await get('/deployment-assets.json');
    check(manifest.status === 200 && isDeepStrictEqual(JSON.parse(manifest.bytes), read('assets.json')), 'PREVIEW_MANIFEST_MISMATCH');
    console.log(JSON.stringify({ phase: 'edgeone-preview', deploymentId: deployment.id, runtimeVerified: true }));
}

async function verifyAssets(platform) {
    const manifest = read('assets.json');
    await parallelFiles(manifest.files, async file => {
        const r = await request(platform, '/_astro/' + file.name);
        check(r.status === 200 && digest(r.bytes) === file.sha256, 'LIVE_ASSET_BYTES_MISMATCH_' + platform.toUpperCase());
    });
    console.log(JSON.stringify({ phase: 'verify-assets', platform, files: manifest.files.length, passed: true }));
}

async function deploy() {
    check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || ''), 'PRODUCTION_REQUIRES_MAIN_GITHUB_ACTIONS');
    const before = read('before.json'); check(isDeepStrictEqual(await cloudflareState(), before.cloudflare), 'PRODUCTION_CHANGED_SINCE_PREPARE');
    const result = { sha: process.env.GITHUB_SHA, release: before.cloudflare.release, phases: [] }; write('result.json', result);
    const record = (phase, fields = {}) => { result.phases.push({ phase, ...fields }); write('result.json', result); };
    await coordinatedDeploy({
        async edgeoneCompatibility() { record('edgeone-compatibility', { deploymentId: await deployEdgeone(path.join(WORK, 'edgeone-compatibility/.edgeone'), 'edgeone-compatibility') }); },
        async verifyEdgeoneAssets() {
            await verifyAssets('edgeone');
            check(isDeepStrictEqual(await publicData('edgeone'), before.public), 'COMPATIBILITY_PUBLIC_API_CHANGED');
            check((await request('edgeone', '/')).status === 200, 'COMPATIBILITY_PAGE_UNAVAILABLE');
            record('edgeone-assets-and-runtime-verified');
        },
        async cloudflare() {
            console.log(JSON.stringify({ phase: 'cloudflare', status: 'publishing', worker: config.worker }));
            const output = runCli(path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ['deploy', '--config', path.join(WORK, 'wrangler.json'), '--keep-vars'], { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: config.accountId }, 'cloudflare');
            const version = output.match(/Current Version ID: ([a-f0-9-]+)/)?.[1]; check(version, 'CLOUDFLARE_VERSION_MISSING'); record('cloudflare', { version });
        },
        async verifyCloudflareAssets() { await verifyAssets('cloudflare'); record('cloudflare-assets-verified'); },
        async edgeoneFinal() { record('edgeone-final', { deploymentId: await deployEdgeone(path.join(ROOT, 'dist-edgeone/.edgeone'), 'edgeone-final') }); },
        async verifyFinal() {
            const state = await cloudflareState(), previous = before.cloudflare;
            check(isDeepStrictEqual({ ...state, version: previous.version }, previous), 'CLOUDFLARE_CONFIG_CHANGED');
            for (const platform of ['cloudflare', 'edgeone']) {
                check(isDeepStrictEqual(await publicData(platform), before.public), 'FINAL_PUBLIC_DATA_CHANGED');
                const manifest = await request(platform, '/deployment-assets.json');
                check(manifest.status === 200 && isDeepStrictEqual(JSON.parse(manifest.bytes), read('assets.json')), 'FINAL_ASSET_MANIFEST_MISMATCH');
                check((await request(platform, '/')).status === 200, 'FINAL_PAGE_UNAVAILABLE');
            }
            await verifyAssets('edgeone'); record('final-runtime-verified', { stats: before.public.data.stats, preservedRoutes: state.routes.length, dataAndSecretsUnchanged: true });
        }
    });
    result.success = true; write('result.json', result);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dual production deployment\n\n- Commit: ${result.sha}\n- Release: ${result.release}\n- CF and EO production verified; previous chunks retained.\n- Data, existing secrets, KV bindings and DNS preserved.\n- Public chunks per platform: ${read('assets.json').files.length}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const commands = { diagnose: diagnoseTransport, prepare, 'stage-compatibility': stageCompatibility, 'verify-preview': verifyPreview, deploy };
    Promise.resolve().then(() => { check(process.argv.length === 3 && Object.hasOwn(commands, process.argv[2]), 'INVALID_PRODUCTION_COMMAND'); return commands[process.argv[2]](); }).catch(error => {
        console.error(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PRODUCTION_DEPLOY_FAILED' })); process.exitCode = 1;
    });
}

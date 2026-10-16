import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    ROOT, HOST, ROUTE, validateConfig, isPublicIpv4, summarizeDns, observeDns, queryDns,
    fixedRequestOptions, probeTls, observeRouting, assessStatus, makeCandidate, writeCandidate
} from '../scripts/geodns-preflight.mjs';

function config() {
    return { ...JSON.parse(readFileSync(path.join(ROOT, 'config/geodns.example.json'), 'utf8')),
        cloudflareTarget: 'saas.fixture-provider.net', edgeoneTarget: 'makers.fixture-provider.net',
        fallbackOrigin: 'fallback-fixture.calvin-xia.cn' };
}

test('template is intentionally incomplete; validation rejects placeholders, same targets and workers.dev', () => {
    assert.throws(() => validateConfig(JSON.parse(readFileSync(path.join(ROOT, 'config/geodns.example.json'), 'utf8'))), /CF_TARGET/);
    for (const cloudflareTarget of [null, '', 'CF_SAAS_CNAME_TARGET', 'your-host.provider.net', 'map-saas.example.com', 'test.invalid', 'https://valid.provider.net', 'valid.provider.net.', '127.0.0.1']) {
        assert.throws(() => validateConfig({ ...config(), cloudflareTarget }));
    }
    assert.throws(() => validateConfig({ ...config(), edgeoneTarget: config().cloudflareTarget }), /TARGETS_NOT_DISTINCT/);
    assert.throws(() => validateConfig({ ...config(), cloudflareTarget: 'class1forever.calvin-xia.workers.dev' }), /WORKERS_DEV/);
    assert.equal(validateConfig(config()).host, HOST);
});

test('scope allows only map host, apex @ and exact route, never zone-wide takeover', () => {
    for (const workerRoute of ['*/*', '*.calvin-xia.cn/*', 'calvin-xia.cn/*', 'map.calvin-xia.cn*', 'map.calvin-xia.cn/api/*']) {
        assert.throws(() => validateConfig({ ...config(), workerRoute }), /INVALID_SCOPE/);
    }
    assert.throws(() => validateConfig({ ...config(), recordName: 'map' }), /INVALID_SCOPE/);
    assert.throws(() => validateConfig({ ...config(), fallbackOrigin: 'fallback.other.net' }), /FALLBACK_OUTSIDE/);
});

test('delegation matches the current Huawei child zone and rejects stale or mixed nameservers', () => {
    assert.equal(validateConfig(config()).nameservers.length, 4);
    for (const nameservers of [
        ['f1g1ns1.dnspod.net', 'f1g1ns2.dnspod.net'],
        config().nameservers.slice(1),
        [...config().nameservers.slice(1), 'ns1.other-provider.net'],
        [...config().nameservers.slice(1), config().nameservers[1]]
    ]) assert.throws(() => validateConfig({ ...config(), nameservers }), /INVALID_DELEGATION_EXPECTATION/);
    assert.equal(validateConfig({ ...config(), nameservers: [...config().nameservers].reverse() }).host, HOST);
});

test('DNS output distinguishes recursive NXDOMAIN from unknown authoritative delegation and redacts addresses', async () => {
    const result = await observeDns(async () => ({ Status: 3, AD: false,
        Answer: [{ name: `${HOST}.`, type: 1, TTL: 90, data: '198.18.5.157' }],
        Authority: [{ name: 'calvin-xia.cn.', type: 6, TTL: 120, data: 'ns.dnspod.net. hostmaster.dnspod.net. 1 2 3 4 60' }],
        Comment: 'Response from private diagnostic IP 36.155.149.35' }));
    assert.equal(result.parentDelegation, 'unknown');
    assert.equal(result.childAuthoritativeAnswer, 'unknown');
    assert.equal(result.observations.length, 14);
    assert.ok(result.observations.every((observation) => observation.authoritative === 'unknown' && observation.rcode === 3));
    assert.equal(result.observations[0].negativeAuthority[0].data.minimum, '60');
    assert.doesNotMatch(JSON.stringify(result), /198\.18\.5\.157|36\.155\.149\.35/);
    const failed = await observeDns(async () => { throw new Error('secret should not print'); });
    assert.doesNotMatch(JSON.stringify(failed), /secret should/);
});

test('DoH uses only approved HTTPS resolver and query types, disallows redirects', async () => {
    let called = false;
    await queryDns('google', HOST, 'A', async (url, options) => {
        called = true;
        assert.equal(url.origin, 'https://dns.google');
        assert.equal(url.searchParams.get('name'), HOST);
        assert.equal(options.redirect, 'error');
        assert.deepEqual(Object.keys(options.headers), ['accept']);
        return { ok: true, json: async () => ({ Status: 0 }) };
    });
    assert.ok(called);
    await assert.rejects(queryDns('unapproved', HOST, 'A'), /INVALID_DOH/);
    assert.throws(() => summarizeDns({}, HOST, 'A'), /INVALID_DOH/);
});

test('fixed TLS transport pins target address, retains real Host/SNI and mandatory verification', async () => {
    const options = fixedRequestOptions(HOST, '1.1.1.1');
    assert.equal(options.hostname, HOST);
    assert.equal(options.servername, HOST);
    assert.equal(options.headers.Host, HOST);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.method, 'HEAD');
    options.lookup(HOST, {}, (_error, address, family) => { assert.equal(address, '1.1.1.1'); assert.equal(family, 4); });
    const result = await probeTls('1.1.1.1', (requestOptions) => {
        assert.equal(requestOptions.rejectUnauthorized, true);
        const request = new EventEmitter();
        request.end = () => queueMicrotask(() => request.emit('error', Object.assign(new Error('provider secret'), { code: 'CERT_HAS_EXPIRED' })));
        return request;
    });
    assert.equal(result.tls, 'failed');
    assert.equal(result.error, 'CERT_HAS_EXPIRED');
    assert.doesNotMatch(JSON.stringify(result), /provider secret|1\.1\.1\.1/);
});

test('Fake-IP/private transport is rejected and fixed target success is never platform proof', async () => {
    for (const address of ['198.18.5.157', '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '203.0.113.1', '100.64.0.1', '::1',
        /* 保留段表必须覆盖旧硬编码漏掉的那些：192.0.0.0/24 里不止 .0/.2，还有 .9/.10；
           6to4 relay anycast、TEST-NET 各段、基准测试段与保留/组播段同样不能当公网目标。 */
        '192.0.0.9', '192.0.0.170', '192.88.99.1', '192.0.2.1', '198.51.100.7', '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.19.255.255']) {
        assert.equal(isPublicIpv4(address), false, address);
        assert.throws(() => fixedRequestOptions(HOST, address), /UNSAFE/);
    }
    /* 表不能宽到把真实公网地址也拦下。 */
    for (const address of ['1.1.1.1', '8.8.8.8', '104.16.0.1', '192.0.1.1', '223.255.255.255']) {
        assert.equal(isPublicIpv4(address), true, address);
    }
    let probes = 0;
    const result = await observeRouting(config(), async (_resolver, name) => ({ Status: 0,
        Answer: [{ type: 1, data: name === HOST ? '198.18.5.157' : '1.1.1.1' }] }), async () => {
        probes += 1; return { tls: 'verified', platform: 'unknown', workerRoute: 'unknown' };
    });
    assert.equal(probes, 4);
    assert.equal(result.productionReady, false);
    assert.equal(result.observations.filter((entry) => entry.mode === 'recursive-selection' && entry.error === 'NON_PUBLIC_OR_FAKE_IP_ANSWER').length, 2);
    assert.doesNotMatch(JSON.stringify(result), /198\.18\.5\.157|1\.1\.1\.1/);
});

test('probeTls arms its timeout before the request and settles a synchronous failure without leaking values', async () => {
    const thrown = await probeTls('1.1.1.1', () => { throw new Error('provider secret detail'); });
    assert.equal(thrown.tls, 'failed');
    assert.equal(thrown.error, 'TLS_OR_NETWORK_FAILURE');
    assert.doesNotMatch(JSON.stringify(thrown), /provider secret detail|1\.1\.1\.1/);

    /* 同步派发 response：timer 必须先于请求存在，done() 才能清掉它；同时事后不能 destroy
       一个已经 resolve 的请求。 */
    let destroyed = false;
    const verified = await probeTls('1.1.1.1', (_options, onResponse) => {
        const request = new EventEmitter();
        request.end = () => onResponse({ socket: { authorized: true, getPeerCertificate: () => ({ valid_to: 'Nov 1 2026' }) }, statusCode: 200, resume() {} });
        request.destroy = () => { destroyed = true; };
        return request;
    });
    assert.equal(verified.tls, 'verified');
    assert.equal(verified.certificateExpires, 'Nov 1 2026');
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(destroyed, false);
});

test('hostname ownership and certificate/fallback state remain independent; local snapshot is untrusted', () => {
    const snapshot = { observedAt: new Date().toISOString(), hostname: { hostname: HOST, status: 'active', ssl: { status: 'pending_validation' } }, fallback: { status: 'active' }, token: 'must-not-output' };
    const pending = assessStatus(snapshot);
    assert.equal(pending.hostnameStatus, 'active');
    assert.equal(pending.sslStatus, 'pending_validation');
    assert.equal(pending.reportedActive, false);
    snapshot.hostname.ssl.status = 'active';
    assert.equal(assessStatus(snapshot).reportedActive, true);
    assert.equal(assessStatus(snapshot).productionReady, false);
    assert.equal(assessStatus(snapshot).currentRemoteStatus, 'unknown');
    assert.doesNotMatch(JSON.stringify(assessStatus(snapshot)), /must-not-output/);
    assert.throws(() => assessStatus({ ...snapshot, observedAt: '2020-01-01' }), /STALE/);
});

test('candidate is derived from built runtime, exact route only, independent and refuses overwrite', () => {
    mkdirSync(path.join(ROOT, '.wrangler'), { recursive: true });
    const fixture = mkdtempSync(path.join(ROOT, '.wrangler', 'geodns-test-'));
    try {
        const built = { name: 'class1forever', main: 'entry.mjs', assets: { directory: '../client', binding: 'ASSETS' }, kv_namespaces: [{ binding: 'CLASS_MAP_DATA', id: 'demo' }], configPath: 'do-not-preserve' };
        mkdirSync(path.join(fixture, 'dist', 'server'), { recursive: true });
        writeFileSync(path.join(fixture, 'dist', 'server', 'wrangler.json'), JSON.stringify(built));
        const before = JSON.stringify(built);
        const candidate = makeCandidate(built, path.join(fixture, 'dist', 'server'));
        assert.equal(JSON.stringify(built), before);
        assert.deepEqual(candidate.routes, [{ pattern: ROUTE, zone_name: 'calvin-xia.cn' }]);
        assert.deepEqual(candidate.kv_namespaces, built.kv_namespaces);
        assert.equal(candidate.configPath, undefined);
        assert.ok(path.isAbsolute(candidate.main));
        assert.throws(() => makeCandidate({ ...built, routes: ['*/*'] }, fixture), /EXISTING_ROUTES/);
        assert.throws(() => writeCandidate('wrangler.jsonc', fixture), /CANDIDATE_OUTPUT/);
        const output = '.wrangler/candidate.json';
        assert.equal(writeCandidate(output, fixture).deployed, false);
        assert.throws(() => writeCandidate(output, fixture), /EEXIST/);
    } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('CLI rejects template and unsupported action without echoing values or environment', () => {
    const script = path.join(ROOT, 'scripts/geodns-preflight.mjs');
    const result = spawnSync(process.execPath, [script, 'validate'], { encoding: 'utf8', env: { ...process.env, PREFLIGHT_SECRET: 'do-not-print-this' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CF_TARGET_UNFILLED_OR_INVALID/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-print-this/);
    assert.equal(spawnSync(process.execPath, [script, 'deploy'], { encoding: 'utf8' }).status, 1);
});

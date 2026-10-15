/** Credential-free observations and isolated route candidates; never a deployment command. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOST = 'map.calvin-xia.cn';
export const ZONE = 'calvin-xia.cn';
export const ROUTE = `${HOST}/*`;
export const RESOLVERS = Object.freeze({
    google: 'https://dns.google/resolve',
    cloudflare: 'https://cloudflare-dns.com/dns-query'
});
const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, AAAA: 28 };
const EXPECTED_NAMESERVERS = [
    'ns1.huaweicloud-dns.com', 'ns1.huaweicloud-dns.cn',
    'ns1.huaweicloud-dns.net', 'ns1.huaweicloud-dns.org'
].sort().join(',');
const PLACEHOLDER = /(?:placeholder|replace|your[-_]|pending|未|待|<|>|\bexample\b|\.invalid$|\.test$|localhost|cf_saas|eo_makers)/i;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fail(code) { throw new Error(code); }

function hostname(value, code) {
    if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()
        || !value.includes('.') || !value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
        || PLACEHOLDER.test(value) || isIP(value)) fail(code);
    return value;
}

export function validateConfig(config) {
    if (!config || config.host !== HOST || config.childZone !== HOST || config.parentZone !== ZONE
        || config.recordName !== '@' || config.workerName !== 'class1forever' || config.workerRoute !== ROUTE) fail('INVALID_SCOPE_OR_ROUTE');
    if (!Array.isArray(config.nameservers) || config.nameservers.length !== 4
        || [...config.nameservers].sort().join(',') !== EXPECTED_NAMESERVERS) fail('INVALID_DELEGATION_EXPECTATION');
    const cloudflareTarget = hostname(config.cloudflareTarget, 'CF_TARGET_UNFILLED_OR_INVALID');
    const edgeoneTarget = hostname(config.edgeoneTarget, 'EO_TARGET_UNFILLED_OR_INVALID');
    const fallbackOrigin = hostname(config.fallbackOrigin, 'FALLBACK_UNFILLED_OR_INVALID');
    if (cloudflareTarget === edgeoneTarget || [cloudflareTarget, edgeoneTarget].includes(HOST)) fail('TARGETS_NOT_DISTINCT');
    if ([cloudflareTarget, edgeoneTarget].some((value) => value.endsWith('.workers.dev'))) fail('WORKERS_DEV_IS_NOT_SAAS_TARGET');
    if (!fallbackOrigin.endsWith(`.${ZONE}`) || fallbackOrigin === HOST) fail('FALLBACK_OUTSIDE_SAAS_ZONE');
    return { ...config, cloudflareTarget, edgeoneTarget, fallbackOrigin };
}

/** Only public IPv4 is used for transport, excluding Fake-IP, documentation and local ranges. */
export function isPublicIpv4(value) {
    if (isIP(value) !== 4) return false;
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 192 && b === 0 && [0, 2].includes(c)) || (a === 198 && [18, 19].includes(b))
        || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
}

export function addressLabel(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

export function summarizeDns(payload, name, type) {
    if (!Number.isInteger(payload?.Status)) fail('INVALID_DOH_RESPONSE');
    const cleanRecord = (record) => {
        if (!Object.values(TYPES).includes(record.type) || typeof record.data !== 'string') return null;
        let data = record.data;
        if ([TYPES.A, TYPES.AAAA].includes(record.type)) data = addressLabel(data);
        else if (record.type === TYPES.SOA) {
            const [mname, rname, serial, refresh, retry, expire, minimum] = data.split(/\s+/);
            data = { mname, rname, serial, refresh, retry, expire, minimum };
        }
        return { name: record.name, type: record.type, ttl: record.TTL, data };
    };
    return {
        name, type, rcode: payload.Status, dnssecValidated: payload.AD === true,
        authoritative: 'unknown',
        answers: (payload.Answer || []).map(cleanRecord).filter(Boolean),
        negativeAuthority: (payload.Authority || []).map(cleanRecord).filter(Boolean),
        scope: 'recursive resolver observation; not a direct parent/child authoritative query'
    };
}

export async function queryDns(resolver, name, type, fetchImpl = fetch) {
    if (!Object.hasOwn(RESOLVERS, resolver) || !Object.hasOwn(TYPES, type)) fail('INVALID_DOH_QUERY');
    hostname(name, 'INVALID_QUERY_NAME');
    const url = new URL(RESOLVERS[resolver]);
    url.searchParams.set('name', name);
    url.searchParams.set('type', type);
    const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) fail('DOH_HTTP_FAILURE');
    const payload = await response.json();
    summarizeDns(payload, name, type);
    return payload;
}

export async function observeDns(query = queryDns) {
    const queries = [[ZONE, 'NS'], [ZONE, 'SOA'], [HOST, 'NS'], [HOST, 'SOA'], [HOST, 'CNAME'], [HOST, 'A'], [HOST, 'AAAA']];
    const observations = await Promise.all(Object.keys(RESOLVERS).flatMap((resolver) => queries.map(async ([name, type]) => {
        try { return { resolver, ...summarizeDns(await query(resolver, name, type), name, type) }; }
        catch { return { resolver, name, type, error: 'DNS_OBSERVATION_FAILED', authoritative: 'unknown' }; }
    })));
    return {
        observedAt: new Date().toISOString(), parentDelegation: 'unknown', childAuthoritativeAnswer: 'unknown', observations,
        note: 'NXDOMAIN does not prove absent parent delegation or its cause. Compare a separate parent authoritative referral and child authoritative response. Resolver locations/ECS are not client-country routing proof.'
    };
}

export function fixedRequestOptions(host, address) {
    if (host !== HOST || !isPublicIpv4(address)) fail('UNSAFE_PROBE_DESTINATION');
    return {
        hostname: host, servername: host, port: 443, path: '/', method: 'HEAD',
        headers: { Host: host, 'User-Agent': 'classmap-readonly-preflight/1' },
        rejectUnauthorized: true, agent: false,
        lookup: (_name, options, callback) => callback(null, options?.all ? [{ address, family: 4 }] : address, 4)
    };
}

/** No redirects, credentials, cookies, response bodies or arbitrary headers are recorded. */
export function probeTls(address, requestImpl = https.request) {
    const options = fixedRequestOptions(HOST, address);
    return new Promise((resolve) => {
        let finished = false;
        let timer;
        const done = (value) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
        const request = requestImpl(options, (response) => {
            const socket = response.socket;
            const certificate = socket.getPeerCertificate();
            response.resume();
            done({ tls: socket.authorized === true ? 'verified' : 'failed', httpStatus: response.statusCode,
                certificateExpires: certificate.valid_to || null, platform: 'unknown', workerRoute: 'unknown',
                address: addressLabel(address), scope: 'strict TLS for map Host/SNI at pinned public IPv4; HEAD / only' });
        });
        timer = setTimeout(() => request.destroy(Object.assign(new Error(), { code: 'PROBE_TIMEOUT' })), 10000);
        request.on('error', (error) => done({ tls: 'failed', error: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'TLS_OR_NETWORK_FAILURE',
            address: addressLabel(address), platform: 'unknown', workerRoute: 'unknown' }));
        request.end();
    });
}

export async function observeRouting(config, query = queryDns, tlsProbe = probeTls) {
    validateConfig(config);
    const observations = await Promise.all(Object.keys(RESOLVERS).flatMap((resolver) => [
        ['recursive-selection', HOST], ['fixed-cloudflare-target', config.cloudflareTarget], ['fixed-edgeone-target', config.edgeoneTarget]
    ].map(async ([mode, target]) => {
        try {
            const payload = await query(resolver, target, 'A');
            const addresses = [...new Set((payload.Answer || []).filter((record) => record.type === TYPES.A).map((record) => record.data))];
            if (payload.Status !== 0 || !addresses.length) return { resolver, mode, target, tls: 'unknown', error: 'NO_IPV4_ANSWER' };
            if (addresses.length > 16) return { resolver, mode, target, tls: 'unknown', error: 'TOO_MANY_IPV4_ANSWERS' };
            if (addresses.some((address) => !isPublicIpv4(address))) return { resolver, mode, target, tls: 'unknown', error: 'NON_PUBLIC_OR_FAKE_IP_ANSWER' };
            // Probe every observed IPv4, not just one successful member of a mixed target set.
            return { resolver, mode, target, probes: await Promise.all(addresses.map((address) => tlsProbe(address))),
                selectedAddresses: addresses.map(addressLabel) };
        } catch { return { resolver, mode, target, tls: 'unknown', error: 'ROUTING_OBSERVATION_FAILED' }; }
    })));
    return { observedAt: new Date().toISOString(), observations, productionReady: false,
        note: 'Fixed-target success bypasses GeoDNS and does not prove country selection. Shared CDN IPs or matching pages do not establish platform identity or Worker route; correlate controlled platform logs/deployment evidence separately. IPv6 transport is not tested.' };
}

/** Parse a manually exported minimal status snapshot, never connect to an account API. */
export function assessStatus(snapshot, now = Date.now()) {
    if (!snapshot || snapshot.hostname?.hostname !== HOST) fail('STATUS_HOST_MISMATCH');
    const observed = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observed) || observed > now || now - observed > 24 * 60 * 60 * 1000) fail('STATUS_TIME_MISSING_OR_STALE');
    const hostnameStatus = ['active', 'pending', 'pending_migration', 'moved', 'deleted', 'blocked', 'pending_deletion'].includes(snapshot.hostname.status) ? snapshot.hostname.status : 'unknown';
    const sslStatus = ['active', 'initializing', 'pending_validation', 'pending_issuance', 'pending_deployment', 'validation_timed_out', 'issuance_timed_out', 'pending_expiration', 'expired', 'deleted'].includes(snapshot.hostname.ssl?.status) ? snapshot.hostname.ssl.status : 'unknown';
    const fallbackStatus = snapshot.fallback?.status === 'active' ? 'active' : 'unknown';
    return { observedAt: snapshot.observedAt, hostname: HOST, hostnameStatus, sslStatus, fallbackStatus,
        reportedActive: hostnameStatus === 'active' && sslStatus === 'active' && fallbackStatus === 'active',
        authenticity: 'unverified-local-snapshot', currentRemoteStatus: 'unknown', productionReady: false };
}

export function makeCandidate(built, builtDir) {
    if (built.name !== 'class1forever' || !built.main || !built.assets?.directory) fail('INVALID_BUILT_WORKER');
    if (built.routes?.length || built.route || Object.values(built.env || {}).some((env) => env.route || env.routes)) fail('EXISTING_ROUTES_REQUIRE_REVIEW');
    const candidate = structuredClone(built);
    for (const key of ['configPath', 'userConfigPath', 'topLevelName', 'definedEnvironments']) delete candidate[key];
    candidate.main = path.resolve(builtDir, built.main);
    candidate.assets.directory = path.resolve(builtDir, built.assets.directory);
    candidate.routes = [{ pattern: ROUTE, zone_name: ZONE }];
    return candidate;
}

export function writeCandidate(out, root = ROOT) {
    const output = path.resolve(root, out);
    const allowed = path.join(root, '.wrangler');
    const relative = path.relative(allowed, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(output) !== '.json') fail('CANDIDATE_OUTPUT_MUST_BE_WRANGLER_JSON');
    let directory = root;
    for (const segment of path.relative(root, path.dirname(output)).split(path.sep)) {
        directory = path.join(directory, segment);
        try { mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const realRelative = path.relative(realpathSync(root), realpathSync(directory));
        if (!realRelative.startsWith(`.wrangler${path.sep}`) && realRelative !== '.wrangler') fail('CANDIDATE_OUTPUT_SYMLINK_ESCAPE');
    }
    const builtDir = path.join(root, 'dist', 'server');
    const candidate = makeCandidate(readJson(path.join(builtDir, 'wrangler.json')), builtDir);
    writeFileSync(output, `${JSON.stringify(candidate, null, 4)}\n`, { flag: 'wx' });
    return { generated: true, route: ROUTE, source: 'dist/server/wrangler.json', deployed: false,
        note: 'Local candidate only. No SaaS/DNS/route activation. Targets and platform gates remain unverified.' };
}

async function main(args) {
    const [command, ...rest] = args;
    const options = {};
    for (let index = 0; index < rest.length; index += 2) {
        if (!['--config', '--out', '--status-file'].includes(rest[index]) || !rest[index + 1] || rest[index + 1].startsWith('--') || Object.hasOwn(options, rest[index])) fail('INVALID_ARGUMENTS');
        options[rest[index]] = rest[index + 1];
    }
    const allowedOptions = { validate: ['--config'], dns: [], probe: ['--config'], status: ['--status-file'], candidate: ['--out'] };
    if (!Object.hasOwn(allowedOptions, command) || Object.keys(options).some((key) => !allowedOptions[command].includes(key))) fail('USAGE_VALIDATE_DNS_PROBE_STATUS_CANDIDATE');
    if (command === 'dns') return observeDns();
    if (command === 'candidate') { if (!options['--out']) fail('OUTPUT_REQUIRED'); return writeCandidate(options['--out']); }
    if (command === 'status') {
        if (!options['--status-file']) fail('STATUS_FILE_REQUIRED');
        const result = assessStatus(readJson(options['--status-file']));
        if (!result.reportedActive) process.exitCode = 2;
        return result;
    }
    const config = validateConfig(readJson(options['--config'] || path.join(ROOT, 'config/geodns.example.json')));
    if (command === 'probe') return observeRouting(config);
    return { valid: true, scope: 'syntax-only; no resource existence or platform readiness proof', productionReady: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
        // Never echo input values, paths, provider exception messages, credentials or environment.
        console.error(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PREFLIGHT_FAILED' }));
        process.exitCode = 1;
    });
}

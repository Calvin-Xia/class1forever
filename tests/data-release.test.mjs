import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
    activateRelease, assertPrivatePath, createRelease, DEMO_STUDENTS, MAX_VALUE_BYTES,
    readRelease, releaseKeys, stageRelease, verifyReadback, verifyRelease, writeRelease
} from '../scripts/data-release.mjs';

const GENERATED_AT = '2026-10-14T00:00:00.000Z';
const script = path.resolve('scripts/data-release.mjs');
function fixture() {
    return createRelease(DEMO_STUDENTS, { releaseId: 'demo_20261014', generatedAt: GENERATED_AT, sourceTag: 'demo_fixture' });
}

function platforms() {
    return Object.fromEntries(['cloudflare', 'edgeone'].map((platform) => {
        const values = new Map();
        let active = 'previous_demo';
        return [platform, {
            values,
            put: async (key, bytes) => { values.set(key, Buffer.from(bytes)); },
            get: async (key) => values.get(key) ?? null,
            currentRelease: async () => active,
            activate: async (id) => { active = id; },
            probe: async (id) => active === id,
            restore: async (id) => { active = id; }
        }];
    }));
}

test('one normalized source produces immutable bytes and matching regional totals', () => {
    const release = fixture();
    assert.equal(verifyRelease(release), true);
    assert.deepEqual(release.manifest.stats, { total: 3, provinces: 2, cities: 3 });
    assert.equal(JSON.parse(release.payloads.public).version, 'v1');
    assert.equal(JSON.parse(release.payloads.public).generatedAt, GENERATED_AT);
    assert.equal(JSON.parse(release.payloads.raw)[2].province, '北京');
    assert.deepEqual(fixture(), release);
});

test('version keys reject separators, unicode, empty and excessive IDs', () => {
    assert.deepEqual(releaseKeys('V1_demo_1'), { raw: 'students_raw_V1_demo_1', public: 'students_public_V1_demo_1' });
    for (const id of ['', 'a:b', 'a/b', '../raw', '版本', 'a-b', 'a'.repeat(65), null]) {
        assert.throws(() => releaseKeys(id), /INVALID_RELEASE_ID/);
    }
});

test('malformed source, timestamps, prototype region keys and oversized values fail closed', () => {
    assert.throws(() => createRelease([{ name: 'private-marker' }], { releaseId: 'test' }), /INVALID_STUDENT_DATA/);
    assert.throws(() => createRelease([], { releaseId: 'test', generatedAt: 'tomorrow' }), /INVALID_GENERATED_AT/);
    assert.throws(() => createRelease([], { releaseId: 'test', sourceTag: '/private/source.json' }), /INVALID_SOURCE_TAG/);
    assert.throws(() => createRelease([{ ...DEMO_STUDENTS[0], province: '__proto__' }], { releaseId: 'test' }), /UNSAFE_REGION_KEY/);
    assert.throws(() => createRelease([{ ...DEMO_STUDENTS[0], name: '字'.repeat(MAX_VALUE_BYTES / 3) }], { releaseId: 'test' }), /VALUE_TOO_LARGE/);
});

test('byte tampering, stale physical keys and recomputed inconsistent aggregates are rejected', () => {
    const changed = fixture();
    changed.payloads.raw[1] ^= 1;
    assert.throws(() => verifyRelease(changed), /HASH_MISMATCH/);
    const key = fixture();
    key.manifest.values.raw.key = 'students:raw:v1';
    assert.throws(() => verifyRelease(key), /INVALID_MANIFEST/);
    const inconsistent = fixture();
    const publicData = JSON.parse(inconsistent.payloads.public);
    publicData.stats.total = 9;
    inconsistent.payloads.public = Buffer.from(JSON.stringify(publicData));
    inconsistent.manifest.values.public.bytes = inconsistent.payloads.public.length;
    inconsistent.manifest.values.public.sha256 = createHash('sha256').update(inconsistent.payloads.public).digest('hex');
    assert.throws(() => verifyRelease(inconsistent), /AGGREGATE_MISMATCH/);
});

test('private bundle uses exclusive files, round-trips and refuses repository paths', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'class-map-release-test-'));
    try {
        const bundle = path.join(directory, 'bundle');
        writeRelease(bundle, fixture());
        assert.deepEqual(readRelease(bundle), fixture());
        assert.throws(() => writeRelease(bundle, fixture()), /EEXIST/);
        for (const forbidden of [process.cwd(), path.resolve('public/release'), path.resolve('dist/client/release'), path.resolve('.wrangler/release')]) {
            assert.throws(() => assertPrivatePath(forbidden), /PATH_MUST_BE_OUTSIDE_REPOSITORY/);
        }
        const alias = path.join(directory, 'repository-junction');
        symlinkSync(process.cwd(), alias, process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => assertPrivatePath(path.join(alias, 'dist/private')), /PATH_MUST_BE_OUTSIDE_REPOSITORY/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('staging copies identical bytes, verifies both platforms and performs no activation', async () => {
    const adapters = platforms();
    const records = [];
    const state = await stageRelease(fixture(), adapters, { record: async (value) => records.push(value) });
    assert.equal(state.status, 'verified');
    for (const kind of ['raw', 'public']) {
        const key = fixture().manifest.values[kind].key;
        assert.deepEqual(adapters.cloudflare.values.get(key), adapters.edgeone.values.get(key));
    }
    assert.equal(await adapters.cloudflare.currentRelease(), 'previous_demo');
    assert.equal(records[0].platforms.cloudflare.verified, false);
    assert.equal(records.at(-1).platforms.edgeone.verified, true);
});

test('second upload failure is partial and does not activate the first side', async () => {
    const adapters = platforms();
    adapters.edgeone.put = async () => { throw new Error('vendor-error-private-marker-secret'); };
    const state = await stageRelease(fixture(), adapters);
    assert.equal(state.status, 'partial_failure');
    assert.equal(state.platforms.cloudflare.verified, true);
    assert.equal(state.platforms.edgeone.uploaded, false);
    assert.equal(await adapters.cloudflare.currentRelease(), 'previous_demo');
    assert.equal(JSON.stringify(state).includes('private-marker'), false);
    await assert.rejects(activateRelease(fixture(), state, adapters), /BOTH_PLATFORMS_MUST_BE_VERIFIED/);
});

test('missing or stale remote readback cannot pass by upload exit code alone', async () => {
    const adapters = platforms();
    adapters.edgeone.get = async (key) => adapters.edgeone.values.has(key) ? Buffer.from('[]') : null;
    const state = await stageRelease(fixture(), adapters);
    assert.equal(state.status, 'partial_failure');
    assert.equal(state.platforms.edgeone.uploaded, true);
    assert.equal(state.platforms.edgeone.verified, false);
    await assert.rejects(verifyReadback(fixture(), { get: async () => null }), /READBACK_HASH_MISMATCH/);
});

test('release ID collision is caught on both sides before any write; matching bytes permit a retry', async () => {
    const adapters = platforms();
    const key = fixture().manifest.values.raw.key;
    adapters.edgeone.values.set(key, Buffer.from('retained-previous-version'));
    const blocked = await stageRelease(fixture(), adapters);
    assert.equal(blocked.status, 'partial_failure');
    assert.equal(blocked.failure, 'PREFLIGHT_FAILED');
    assert.equal(adapters.cloudflare.values.size, 0);
    assert.equal(adapters.edgeone.values.get(key).toString(), 'retained-previous-version');
    adapters.edgeone.values.clear();
    assert.equal((await stageRelease(fixture(), adapters)).status, 'verified');
    assert.equal((await stageRelease(fixture(), adapters)).status, 'verified');
});

test('activation requires fresh matching bytes and verified runtime probes on both sides', async () => {
    const adapters = platforms();
    const staged = await stageRelease(fixture(), adapters);
    const state = await activateRelease(fixture(), staged, adapters);
    assert.equal(state.status, 'succeeded');
    assert.equal(await adapters.cloudflare.currentRelease(), 'demo_20261014');
    assert.equal(await adapters.edgeone.currentRelease(), 'demo_20261014');
    assert.equal(staged.status, 'verified');
});

test('a stale journal cannot activate after a platform value changes', async () => {
    const adapters = platforms();
    const staged = await stageRelease(fixture(), adapters);
    adapters.edgeone.values.clear();
    await assert.rejects(activateRelease(fixture(), staged, adapters), /READBACK_HASH_MISMATCH/);
    assert.equal(await adapters.cloudflare.currentRelease(), 'previous_demo');
});

test('failure after the second activation changes state rolls both sides back, never reports success', async () => {
    const adapters = platforms();
    const staged = await stageRelease(fixture(), adapters);
    const activate = adapters.edgeone.activate;
    adapters.edgeone.activate = async (id) => {
        await activate(id);
        throw new Error('activation changed deployment then failed');
    };
    const state = await activateRelease(fixture(), staged, adapters);
    assert.equal(state.status, 'partial_failure');
    for (const platform of ['cloudflare', 'edgeone']) {
        assert.equal(state.platforms[platform].rollback, 'verified');
        assert.equal(await adapters[platform].currentRelease(), 'previous_demo');
        assert.equal(adapters[platform].values.size, 2, 'new and previous keys are not deleted on rollback');
    }
});

test('a failed runtime probe also causes rollback; legacy null release can be restored', async () => {
    const adapters = platforms();
    await adapters.cloudflare.restore(null);
    const staged = await stageRelease(fixture(), adapters);
    const probe = adapters.edgeone.probe;
    adapters.edgeone.probe = async (id) => id === 'demo_20261014' ? false : probe(id);
    const state = await activateRelease(fixture(), staged, adapters);
    assert.equal(state.status, 'partial_failure');
    assert.equal(state.platforms.cloudflare.previousReleaseId, null);
    assert.equal(await adapters.cloudflare.currentRelease(), null);
    assert.equal(state.platforms.edgeone.rollback, 'verified');
});

test('failed rollback remains explicit and a write-journal failure stops activation', async () => {
    const adapters = platforms();
    const staged = await stageRelease(fixture(), adapters);
    adapters.edgeone.activate = async () => { throw new Error('failed'); };
    adapters.cloudflare.restore = async () => { throw new Error('failed'); };
    const state = await activateRelease(fixture(), staged, adapters);
    assert.equal(state.status, 'partial_failure');
    assert.equal(state.platforms.cloudflare.rollback, 'failed');
    const untouched = platforms();
    const ready = await stageRelease(fixture(), untouched);
    await assert.rejects(activateRelease(fixture(), ready, untouched, { record: async () => { throw new Error('journal unavailable'); } }));
    assert.equal(await untouched.cloudflare.currentRelease(), 'previous_demo');
});

test('CLI really prepares and verifies offline; logs omit records, hashes and paths', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'class-map-release-cli-'));
    const env = { ...process.env };
    delete env.STUDENTS_DATA;
    try {
        const bundle = path.join(directory, 'bundle');
        const commands = [
            ['prepare', '--demo', '--release-id', 'demo_cli', '--generated-at', GENERATED_AT, '--out', bundle],
            ['verify', '--bundle', bundle],
            ['verify-readback', '--bundle', bundle, '--readback', bundle]
        ];
        for (const args of commands) {
            const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
            assert.equal(result.status, 0, result.stderr);
            assert.equal(JSON.parse(result.stdout).remoteActions, false);
            assert.equal(result.stdout.includes('演示甲'), false);
            assert.equal(result.stdout.includes(directory), false);
            assert.equal(result.stdout.includes('sha256'), false);
        }
        const bytes = readFileSync(path.join(bundle, 'raw.json'));
        bytes[1] ^= 1;
        writeFileSync(path.join(bundle, 'raw.json'), bytes);
        const bad = spawnSync(process.execPath, [script, 'verify', '--bundle', bundle], { encoding: 'utf8', env });
        assert.equal(bad.status, 1);
        assert.equal(JSON.parse(bad.stderr).code, 'HASH_MISMATCH');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('CLI has no publish command and rejects ambiguous or invalid private input without echoing it', () => {
    const env = { ...process.env, STUDENTS_DATA: 'private_marker invalid json' };
    for (const args of [
        ['publish'],
        ['prepare', '--demo', '--release-id', 'test', '--out', path.join(os.tmpdir(), 'unused-release')],
        ['prepare', '--release-id', 'test', '--out', path.join(os.tmpdir(), 'unused-release')]
    ]) {
        const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes('private_marker'), false);
        assert.equal(result.stderr.includes(os.tmpdir()), false);
    }
});

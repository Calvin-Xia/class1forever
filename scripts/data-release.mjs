import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicDataset, normalizeStudents } from '../shared/data-model.mjs';

export const MAX_VALUE_BYTES = 1_000_000;
export const PLATFORMS = Object.freeze(['cloudflare', 'edgeone']);
const FILES = Object.freeze({ raw: 'raw.json', public: 'public.json' });
const REPO = realpathSync(fileURLToPath(new URL('../', import.meta.url)));

export class ReleaseError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function requireCondition(condition, code) {
    if (!condition) throw new ReleaseError(code);
}

export function releaseKeys(releaseId) {
    requireCondition(typeof releaseId === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(releaseId), 'INVALID_RELEASE_ID');
    return { raw: `students_raw_${releaseId}`, public: `students_public_${releaseId}` };
}

function digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function encode(value) {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function parse(bytes) {
    try {
        return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
        throw new ReleaseError('INVALID_DATA_JSON');
    }
}

function normalized(records) {
    try {
        const students = normalizeStudents(records);
        // The shared aggregate builder uses ordinary objects. Do not let prototype keys corrupt counts.
        requireCondition(students.every(({ province, city }) =>
            typeof province === 'string' && typeof city === 'string' &&
            !Object.hasOwn(Object.prototype, province) && !Object.hasOwn(Object.prototype, city)), 'UNSAFE_REGION_KEY');
        return students;
    } catch (error) {
        if (error instanceof ReleaseError) throw error;
        throw new ReleaseError('INVALID_STUDENT_DATA');
    }
}

function aggregate(students, generatedAt) {
    const result = buildPublicDataset(students);
    result.generatedAt = generatedAt;
    return result;
}

export function createRelease(records, { releaseId, generatedAt = new Date().toISOString(), sourceTag = 'protected_source' } = {}) {
    const keys = releaseKeys(releaseId);
    requireCondition(typeof generatedAt === 'string' && !Number.isNaN(Date.parse(generatedAt)) &&
        new Date(generatedAt).toISOString() === generatedAt, 'INVALID_GENERATED_AT');
    // A source tag is an opaque label, never a source path or a credential.
    requireCondition(typeof sourceTag === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(sourceTag), 'INVALID_SOURCE_TAG');
    const students = normalized(records);
    const publicDataset = aggregate(students, generatedAt);
    const payloads = { raw: encode(students), public: encode(publicDataset) };
    const values = {};
    for (const kind of Object.keys(FILES)) {
        const bytes = payloads[kind];
        requireCondition(bytes.length <= MAX_VALUE_BYTES, 'VALUE_TOO_LARGE');
        values[kind] = { key: keys[kind], file: FILES[kind], bytes: bytes.length, sha256: digest(bytes) };
    }
    return {
        payloads,
        manifest: {
            schemaVersion: 1, releaseId, generatedAt, sourceTag,
            dataVersion: publicDataset.version, maxValueBytes: MAX_VALUE_BYTES,
            stats: publicDataset.stats, values
        }
    };
}

export function verifyRelease(release) {
    const manifest = release?.manifest;
    requireCondition(manifest?.schemaVersion === 1, 'INVALID_MANIFEST');
    const keys = releaseKeys(manifest.releaseId);
    for (const kind of Object.keys(FILES)) {
        const entry = manifest.values?.[kind];
        const bytes = release.payloads?.[kind];
        requireCondition(entry?.key === keys[kind] && entry?.file === FILES[kind] && bytes instanceof Uint8Array, 'INVALID_MANIFEST');
        requireCondition(bytes.length <= MAX_VALUE_BYTES && bytes.length === entry.bytes, 'INVALID_VALUE_SIZE');
        requireCondition(digest(bytes) === entry.sha256, 'HASH_MISMATCH');
    }
    const rebuilt = createRelease(parse(release.payloads.raw), manifest);
    requireCondition(Buffer.from(rebuilt.payloads.raw).equals(Buffer.from(release.payloads.raw)), 'RAW_NOT_NORMALIZED');
    requireCondition(Buffer.from(rebuilt.payloads.public).equals(Buffer.from(release.payloads.public)), 'AGGREGATE_MISMATCH');
    requireCondition(JSON.stringify(rebuilt.manifest) === JSON.stringify(manifest), 'INVALID_MANIFEST');
    return true;
}

function resolvedDestination(destination) {
    let ancestor = path.resolve(destination);
    const suffix = [];
    while (!existsSync(ancestor)) {
        suffix.unshift(path.basename(ancestor));
        const parent = path.dirname(ancestor);
        requireCondition(parent !== ancestor, 'INVALID_PRIVATE_PATH');
        ancestor = parent;
    }
    return path.join(realpathSync(ancestor), ...suffix);
}

/**
 * 叶节点本体不能是符号链接（复核裁定 #20）。
 * `lstatSync` 不跟随链接，所以悬空链接也会被识别出来；目标不存在时直接放行，
 * 交给创建（`flag: 'wx'`）/ 读取路径自己报错。判断依据是文件系统事实，不是文本比较。
 */
function rejectSymlinkLeaf(target) {
    let stats;
    try {
        stats = lstatSync(target);
    } catch (_error) {
        return;
    }
    requireCondition(!stats.isSymbolicLink(), 'BUNDLE_SYMLINK_FORBIDDEN');
}

export function assertPrivatePath(destination) {
    const target = path.resolve(destination);
    rejectSymlinkLeaf(target);
    const resolved = resolvedDestination(target);
    const relative = path.relative(REPO, resolved);
    requireCondition(relative !== '' && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'PATH_MUST_BE_OUTSIDE_REPOSITORY');
    return resolved;
}

/** 私有包里的一个文件：本体不能是链接，且真实父目录必须是包目录本身。 */
function bundleFilePath(directory, file) {
    const target = path.join(directory, file);
    rejectSymlinkLeaf(target);
    requireCondition(path.dirname(realpathSync(target)) === realpathSync(directory), 'BUNDLE_SYMLINK_FORBIDDEN');
    return target;
}

export function writeRelease(directory, release) {
    verifyRelease(release);
    const destination = assertPrivatePath(directory);
    // Exclusive directory and file creation avoids overwriting a previous release.
    mkdirSync(destination, { mode: 0o700 });
    for (const kind of Object.keys(FILES)) {
        writeFileSync(path.join(destination, FILES[kind]), release.payloads[kind], { flag: 'wx', mode: 0o600 });
    }
    writeFileSync(path.join(destination, 'manifest.private.json'), JSON.stringify(release.manifest, null, 2), { flag: 'wx', mode: 0o600 });
}

export function readRelease(directory) {
    const destination = assertPrivatePath(directory);
    const files = [...Object.values(FILES), 'manifest.private.json'];
    const paths = Object.fromEntries(files.map((file) => [file, bundleFilePath(destination, file)]));
    const release = {
        manifest: parse(readFileSync(paths['manifest.private.json'])),
        payloads: Object.fromEntries(Object.entries(FILES).map(([kind, file]) => [kind, readFileSync(paths[file])]))
    };
    verifyRelease(release);
    return release;
}

export async function verifyReadback(release, adapter) {
    verifyRelease(release);
    for (const kind of Object.keys(FILES)) {
        const bytes = await adapter.get(release.manifest.values[kind].key);
        requireCondition(bytes instanceof Uint8Array && digest(bytes) === release.manifest.values[kind].sha256, 'READBACK_HASH_MISMATCH');
    }
    return true;
}

function validateAdapters(adapters, activation = false) {
    const methods = activation ? ['get', 'currentRelease', 'activate', 'probe', 'restore'] : ['put', 'get'];
    requireCondition(PLATFORMS.every((platform) => methods.every((method) => typeof adapters?.[platform]?.[method] === 'function')), 'INVALID_ADAPTER_PROTOCOL');
}

async function recordState(state, record) {
    if (record) await record(structuredClone(state));
}

/**
 * 发布状态机必须留下日志（复核裁定 #21）。
 * 生产路径必须显式传入 `record`；确需无日志（例如纯离线自检）时必须显式写
 * `{ allowMissingJournal: true }`，不允许因为「忘了传」而静默丢掉整条激活轨迹。
 */
function requireJournal(record, allowMissingJournal) {
    requireCondition(typeof record === 'function' || allowMissingJournal === true, 'JOURNAL_RECORD_REQUIRED');
}

/** 真实原因优先（复核裁定 #15）：ReleaseError 的 code 是固定字符串，不含任何敏感内容。 */
function failureCode(error, fallback) {
    return error instanceof ReleaseError ? error.code : fallback;
}

// No vendor API is guessed here. Only a caller-supplied, explicitly authorized adapter can write.
export async function stageRelease(release, adapters, { record, allowMissingJournal } = {}) {
    verifyRelease(release);
    validateAdapters(adapters);
    requireJournal(record, allowMissingJournal);
    const state = {
        releaseId: release.manifest.releaseId, status: 'staging',
        platforms: Object.fromEntries(PLATFORMS.map((platform) => [platform, { uploaded: false, verified: false, activated: false, rollback: 'not_needed' }]))
    };
    await recordState(state, record);
    // Reusing an ID with different bytes would destroy the retained rollback version.
    // This is a best-effort collision guard, not an atomic create-if-absent KV operation.
    for (const platform of PLATFORMS) {
        try {
            for (const kind of Object.keys(FILES)) {
                const entry = release.manifest.values[kind];
                const existing = await adapters[platform].get(entry.key);
                requireCondition(existing === null || existing instanceof Uint8Array, 'INVALID_READBACK_TYPE');
                requireCondition(existing === null || digest(existing) === entry.sha256, 'RELEASE_ID_COLLISION');
            }
        } catch (error) {
            state.status = 'partial_failure';
            state.failedPlatform = platform;
            state.failure = failureCode(error, 'PREFLIGHT_FAILED');
            await recordState(state, record);
            return state;
        }
    }
    for (const platform of PLATFORMS) {
        try {
            for (const kind of Object.keys(FILES)) {
                await adapters[platform].put(release.manifest.values[kind].key, Buffer.from(release.payloads[kind]));
            }
            state.platforms[platform].uploaded = true;
            await recordState(state, record);
            await verifyReadback(release, adapters[platform]);
            state.platforms[platform].verified = true;
            await recordState(state, record);
        } catch (error) {
            state.status = 'partial_failure';
            state.failedPlatform = platform;
            state.failure = failureCode(error, 'STAGING_OR_JOURNAL_FAILED');
            await recordState(state, record);
            return state;
        }
    }
    state.status = 'verified';
    await recordState(state, record);
    return state;
}

export async function activateRelease(release, staged, adapters, { record, allowMissingJournal } = {}) {
    verifyRelease(release);
    validateAdapters(adapters, true);
    requireJournal(record, allowMissingJournal);
    requireCondition(staged?.releaseId === release.manifest.releaseId && staged.status === 'verified' &&
        PLATFORMS.every((platform) => staged.platforms?.[platform]?.verified), 'BOTH_PLATFORMS_MUST_BE_VERIFIED');
    const state = structuredClone(staged);
    const attempted = [];
    // Re-read before any activation: a stale or tampered journal cannot bypass data verification.
    for (const platform of PLATFORMS) {
        await verifyReadback(release, adapters[platform]);
        const previous = await adapters[platform].currentRelease();
        if (previous !== null) releaseKeys(previous);
        state.platforms[platform].previousReleaseId = previous;
    }
    state.status = 'activating';
    await recordState(state, record);
    try {
        for (const platform of PLATFORMS) {
            attempted.push(platform); // activate can change a deployment and then throw; restore this side too.
            await adapters[platform].activate(state.releaseId);
            state.platforms[platform].activated = true;
            await recordState(state, record);
            requireCondition(await adapters[platform].probe(state.releaseId) === true, 'RUNTIME_PROBE_FAILED');
        }
        state.status = 'succeeded';
        await recordState(state, record);
    } catch (error) {
        state.status = 'partial_failure';
        state.failure = failureCode(error, 'ACTIVATION_OR_PROBE_OR_JOURNAL_FAILED');
        for (const platform of attempted.reverse()) {
            try {
                await adapters[platform].restore(state.platforms[platform].previousReleaseId);
                requireCondition(await adapters[platform].probe(state.platforms[platform].previousReleaseId) === true, 'ROLLBACK_PROBE_FAILED');
                state.platforms[platform].rollback = 'verified';
                state.platforms[platform].activated = false;
            } catch {
                state.platforms[platform].rollback = 'failed';
            }
        }
        // Even a verified rollback does not turn the failed release into a success.
        await recordState(state, record);
    }
    return state;
}

export const DEMO_STUDENTS = Object.freeze([
    { name: '演示甲', school: '演示学校A', city: '杭州', province: '浙江' },
    { name: '演示乙', school: '演示学校B', city: '宁波', province: '浙江' },
    { name: '演示丙', school: '演示学校C', city: '北京', province: '北京市' }
]);

function options(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (key === '--demo') result.demo = true;
        else if (['--source', '--out', '--bundle', '--readback', '--release-id', '--generated-at', '--source-tag'].includes(key)) {
            requireCondition(argv[index + 1] && !argv[index + 1].startsWith('--'), 'MISSING_ARGUMENT');
            requireCondition(!(key.slice(2) in result), 'DUPLICATE_ARGUMENT');
            result[key.slice(2)] = argv[++index];
        } else throw new ReleaseError('UNKNOWN_ARGUMENT');
    }
    return result;
}

async function main(argv) {
    const [command, ...args] = argv;
    const opts = options(args);
    const allowed = command === 'prepare' ? ['demo', 'source', 'out', 'release-id', 'generated-at', 'source-tag'] :
        command === 'verify' ? ['bundle'] : command === 'verify-readback' ? ['bundle', 'readback'] : [];
    requireCondition(Object.keys(opts).every((key) => allowed.includes(key)), 'ARGUMENT_NOT_SUPPORTED_FOR_COMMAND');
    if (command === 'prepare') {
        requireCondition(opts.out && opts['release-id'], 'MISSING_ARGUMENT');
        requireCondition(Number(Boolean(opts.demo)) + Number(Boolean(opts.source)) + Number(Boolean(process.env.STUDENTS_DATA)) === 1, 'EXACTLY_ONE_SOURCE_REQUIRED');
        const records = opts.demo ? DEMO_STUDENTS : opts.source ? parse(readFileSync(assertPrivatePath(opts.source))) : parse(Buffer.from(process.env.STUDENTS_DATA));
        const release = createRelease(records, {
            releaseId: opts['release-id'], generatedAt: opts['generated-at'], sourceTag: opts['source-tag'] || (opts.demo ? 'demo_fixture' : 'protected_source')
        });
        writeRelease(opts.out, release);
        console.log(JSON.stringify({ releaseId: release.manifest.releaseId, status: 'prepared_private_bundle', remoteActions: false }));
    } else if (command === 'verify' || command === 'verify-readback') {
        requireCondition(opts.bundle, 'MISSING_ARGUMENT');
        const release = readRelease(opts.bundle);
        if (command === 'verify-readback') {
            requireCondition(opts.readback, 'MISSING_ARGUMENT');
            const directory = assertPrivatePath(opts.readback);
            await verifyReadback(release, {
                get: async (key) => {
                    const kind = Object.keys(FILES).find((name) => release.manifest.values[name].key === key);
                    return readFileSync(bundleFilePath(directory, FILES[kind]));
                }
            });
        }
        console.log(JSON.stringify({ releaseId: release.manifest.releaseId, status: command === 'verify' ? 'bundle_verified' : 'offline_readback_verified', remoteActions: false }));
    } else throw new ReleaseError('COMMAND_MUST_BE_PREPARE_VERIFY_OR_VERIFY_READBACK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        // Never print vendor errors, source JSON, file paths, hashes, or credentials.
        console.error(JSON.stringify({ status: 'failed', code: error instanceof ReleaseError ? error.code : 'PRIVATE_RELEASE_OPERATION_FAILED' }));
        process.exitCode = 1;
    });
}

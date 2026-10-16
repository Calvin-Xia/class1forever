import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { buildPublicDataset, DATA_KEYS, normalizeStudents } from '../shared/data-model.mjs';

/** 版本键里的 release id 形状：与 src/lib/data.ts 的 datasetKey 校验完全一致。 */
const RELEASE_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/**
 * 只带固定错误码的脚本错误（复核裁定 #14）。
 * 顶层 catch 只打印 `code`，绝不打印 error.message：Node 的 JSON.parse / vm 报错会把
 * 输入片段带进消息里，而输入就是学生明细。
 */
class UploadError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function parseArgs(argv) {
    const options = {
        binding: 'CLASS_MAP_DATA',
        env: null,
        dryRun: false,
        releaseId: null,
        source: path.join(process.cwd(), 'js', 'data.js')
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--dry-run') {
            options.dryRun = true;
        } else if (token === '--env' && argv[index + 1]) {
            options.env = argv[index + 1];
            index += 1;
        } else if (token.startsWith('--env=')) {
            options.env = token.split('=')[1];
        } else if (token === '--release-id') {
            if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
                throw new UploadError('MISSING_ARGUMENT');
            }
            options.releaseId = argv[index + 1];
            index += 1;
        } else if (token.startsWith('--release-id=')) {
            options.releaseId = token.slice('--release-id='.length);
        } else if (token === '--binding' && argv[index + 1]) {
            options.binding = argv[index + 1];
            index += 1;
        } else if (token.startsWith('--binding=')) {
            options.binding = token.split('=')[1];
        } else if (token === '--source' && argv[index + 1]) {
            options.source = path.resolve(argv[index + 1]);
            index += 1;
        } else if (token.startsWith('--source=')) {
            options.source = path.resolve(token.split('=')[1]);
        } else {
            throw new UploadError('UNKNOWN_ARGUMENT');
        }
    }

    return options;
}

/**
 * 解析本次上传要写的 release id（复核裁定 #2 / #14）。
 * `--release-id` 优先；其次是进程环境里的 `DATA_RELEASE_ID`（线上 Worker 用它选键）。
 * 两者都没有时返回 null —— 调用方会打印醒目警告，说明旧键在已启用版本的线上读不到。
 */
function resolveReleaseId(options) {
    const raw = options.releaseId ?? process.env.DATA_RELEASE_ID;
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }

    if (!RELEASE_ID_PATTERN.test(raw)) {
        throw new UploadError('INVALID_RELEASE_ID');
    }

    return raw;
}

function loadStudentsFromLegacyFile(sourcePath) {
    if (!existsSync(sourcePath)) {
        throw new UploadError('SOURCE_NOT_FOUND');
    }

    const source = readFileSync(sourcePath, 'utf8');
    const context = {};
    try {
        vm.runInNewContext(`${source}\nglobalThis.__students = students;`, context, {
            filename: sourcePath
        });
    } catch (_error) {
        throw new UploadError('INVALID_SOURCE_SCRIPT');
    }

    return context.__students;
}

function loadStudents(options) {
    if (process.env.STUDENTS_DATA) {
        try {
            return JSON.parse(process.env.STUDENTS_DATA);
        } catch (_error) {
            throw new UploadError('INVALID_SOURCE_JSON');
        }
    }

    return loadStudentsFromLegacyFile(options.source);
}

/** 有 release id 时写 `students_<kind>_<id>`（与释放协议的 releaseKeys 一致）；否则旧键。 */
function datasetKeysFor(releaseId) {
    if (!releaseId) {
        return DATA_KEYS;
    }

    return { raw: `students_raw_${releaseId}`, public: `students_public_${releaseId}` };
}

function buildBulkPayload(students, releaseId) {
    const publicDataset = buildPublicDataset(students);
    const keys = datasetKeysFor(releaseId);
    return {
        publicDataset,
        keys,
        bulkPayload: [
            {
                key: keys.raw,
                value: JSON.stringify(students)
            },
            {
                key: keys.public,
                value: JSON.stringify(publicDataset)
            }
        ]
    };
}

function prepareUpload(options) {
    const releaseId = resolveReleaseId(options);
    try {
        const students = normalizeStudents(loadStudents(options));
        return { releaseId, ...buildBulkPayload(students, releaseId) };
    } catch (error) {
        if (error instanceof UploadError) {
            throw error;
        }

        throw new UploadError('INVALID_STUDENT_DATA');
    }
}

function findWranglerCliScript() {
    const candidates = [
        process.env.WRANGLER_CLI_JS ? path.resolve(process.env.WRANGLER_CLI_JS) : null,
        path.join(process.cwd(), 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'),
        process.env.APPDATA
            ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
            : null,
        process.env.npm_config_prefix
            ? path.join(process.env.npm_config_prefix, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
            : null,
        process.env.HOME
            ? path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js')
            : null
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getWranglerInvocation() {
    const cliScript = findWranglerCliScript();
    if (cliScript) {
        return {
            command: process.execPath,
            argsPrefix: [cliScript]
        };
    }

    return {
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        argsPrefix: ['wrangler']
    };
}

function runBulkUpload(options, bulkPayload) {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'class-map-kv-'));
    const tempPath = path.join(tempDirectory, 'bulk-put.json');
    writeFileSync(tempPath, JSON.stringify(bulkPayload, null, 2), 'utf8');

    try {
        const invocation = getWranglerInvocation();
        const args = [
            ...invocation.argsPrefix,
            'kv',
            'bulk',
            'put',
            tempPath,
            `--binding=${options.binding}`,
            '--remote'
        ];

        if (options.env) {
            args.push('--env', options.env);
        }

        console.log(`Uploading to Cloudflare KV via: ${[invocation.command, ...args].join(' ')}`);

        const result = spawnSync(invocation.command, args, {
            cwd: process.cwd(),
            env: process.env,
            stdio: 'inherit'
        });

        if (result.error) {
            throw new UploadError('UPLOAD_FAILED');
        }

        if (result.signal) {
            throw new UploadError('UPLOAD_FAILED');
        }

        if (result.status !== 0) {
            throw new UploadError('UPLOAD_FAILED');
        }
    } finally {
        rmSync(tempDirectory, {
            recursive: true,
            force: true
        });
    }
}

try {
    const options = parseArgs(process.argv.slice(2));
    const { publicDataset, bulkPayload, releaseId } = prepareUpload(options);

    if (!releaseId) {
        // 复核裁定 #2 / #14：不再「静默」写旧键。旧键只有没设 DATA_RELEASE_ID 的部署才读得到。
        console.warn(
            [
                '⚠️  未指定 --release-id，也没有检测到 DATA_RELEASE_ID：本次只写旧键 ' +
                    `${DATA_KEYS.raw} / ${DATA_KEYS.public}。`,
                '    如果线上 Worker 已经设置了 DATA_RELEASE_ID，它只读 students_<kind>_<id>，',
                '    这两条旧键不会被读到 —— 请改用 `--release-id <id>` 重新上传。'
            ].join('\n')
        );
    }

    console.log(
        JSON.stringify(
            {
                binding: options.binding,
                env: options.env || 'production',
                releaseId,
                keys: bulkPayload.map((entry) => entry.key),
                stats: publicDataset.stats
            },
            null,
            2
        )
    );

    if (!options.dryRun) {
        runBulkUpload(options, bulkPayload);
    }
} catch (error) {
    // 复核裁定 #14：只输出固定错误码。绝不打印 error.message / JSON 片段 ——
    // Node 的 JSON.parse、vm 与 fs 报错都可能把学生明细或私有路径带进消息里。
    console.error(
        JSON.stringify({
            status: 'failed',
            code: error instanceof UploadError ? error.code : 'UPLOAD_FAILED'
        })
    );
    process.exit(1);
}

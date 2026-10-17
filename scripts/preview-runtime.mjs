/**
 * @fileoverview PR 预览链路（方案 A）：**专属预览配置** + demo 夹具 + `wrangler versions upload --preview-alias`。
 *
 * 为什么不能直接 `wrangler versions upload --env preview`：
 *   仓库根的 `wrangler.jsonc` 一用 `wrangler` 就被 Astro 适配器**重定向**到 `dist/server/wrangler.json`
 *   （dry-run 会打印 "Using redirected Wrangler configuration"）。那份生成配置里**没有** `env.preview`
 *   块（只有 `definedEnvironments:["preview"]`），于是 `--env preview` 解析出来的是**生产** KV id
 *   `e6c9c4ff…` —— 预览会读写生产数据，直接踩「预览不得指向生产」这条红线。
 *
 * 所以这里照 `scripts/local-runtime.mjs` 的 `writeLocalConfig()` 的做法，从 `dist/` 派生一份
 * **专属预览配置**：独立 worker 名 `class1forever-preview` + `CLASS_MAP_DATA` 绑**预览** KV id
 * `2761c656…`，再用 `--config` 显式指定它（该文件里没有重定向元数据，wrangler 不会再跳走）。
 *
 * 写文件前的三条硬断言（防手滑把生产写进预览链路）：
 *   1. 序列化后的配置**不得包含**生产 KV id；
 *   2. `kv_namespaces` 只能有一项、必须是 `CLASS_MAP_DATA`、id 必须是预览 id；
 *   3. `name` 必须是 `class1forever-preview`，且不得残留重定向元数据 / `env` / `previews` / `dev`。
 *
 * 子命令：
 *   node scripts/preview-runtime.mjs write-config
 *       只派生 `.wrangler/preview/wrangler.json`（给 `wrangler deploy --dry-run` 自检用）。
 *   node scripts/preview-runtime.mjs seed
 *       把 **demo 夹具**写进预览命名空间（`wrangler kv key put … --namespace-id <preview> --remote`）。
 *       夹具来自 `local-runtime.mjs` 的 `FIXTURE_STUDENTS`（合成数据）+ `shared/data-model.mjs`，
 *       与 `upload-kv-data.mjs` 同源；**不读 `js/data.js`**，所以永远不会把真实名单写进预览。
 *   node scripts/preview-runtime.mjs upload --alias pr-<n> [--tag pr-<n>]
 *       上传一个预览版本（只上传版本，不改任何流量），最后单独打印一行 `PREVIEW_URL=<url>`。
 *
 * 凭据：`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（与 deploy.yml 同款）。**推荐用只授权
 * 这一个预览 worker + 预览 KV 的专供 token**（workflow 里优先读 `CLOUDFLARE_PREVIEW_API_TOKEN`）。
 * 注意：`scripts/local-tool-env.cjs` 的 `localToolEnvironment()` 是**白名单**，会把凭据变量丢掉，
 * 所以这里不能用它，另建一份 `previewToolEnvironment()`（只透传路径类变量 + 两个 CF 凭据）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicDataset, DATA_KEYS, normalizeStudents } from '../shared/data-model.mjs';
import { DEMO_HINT, DEMO_PASSPHRASE, DEMO_SESSION_SECRET, FIXTURE_STUDENTS, REPO_ROOT } from './local-runtime.mjs';

/** 预览 worker 名：与生产 `class1forever` 完全分开，预览流量永远不会打到生产 worker 上。 */
export const PREVIEW_WORKER_NAME = 'class1forever-preview';
/** 预览 KV 命名空间 id（`wrangler.jsonc` 的 `preview_id`）。可用 `PREVIEW_KV_ID` 覆盖。 */
export const PREVIEW_KV_ID = '2761c6566ea945c2ac44da3a916cb840';
/** 生产 KV id —— 只用于**负向断言**：它一旦出现在预览链路里就是错误。 */
export const PRODUCTION_KV_ID = 'e6c9c4ff9bc84aa4979184515e713ecb';

export const PREVIEW_DIR = path.join(REPO_ROOT, '.wrangler', 'preview');
export const PREVIEW_CONFIG_PATH = path.join(PREVIEW_DIR, 'wrangler.json');
const PREVIEW_SECRETS_PATH = path.join(PREVIEW_DIR, 'secrets.json');
const PREVIEW_FIXTURE_DIR = path.join(PREVIEW_DIR, 'fixtures');
const PROBE_TMP_DIR = path.join(REPO_ROOT, '.wrangler', 'probe-tmp');
const WRANGLER_LOG_DIR = path.join(REPO_ROOT, '.wrangler', 'logs');
const WRANGLER_BIN = path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const WRANGLER_TIMEOUT_MS = 300000;
/** 生成配置里必须删掉的「重定向元数据」与本地/预览专用块（与 local-runtime 同款，另加 `env`）。 */
const STRIPPED_METADATA_KEYS = [
    'configPath',
    'userConfigPath',
    'topLevelName',
    'definedEnvironments',
    'dev',
    'previews',
    'secrets',
    'env'
];

function log(message) {
    console.log(message);
}

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * 预览配置要用的子进程环境：只透传路径类变量 + 两个 Cloudflare 凭据。
 *
 * 与 `localToolEnvironment()` 的区别是**必须保留** `CLOUDFLARE_API_TOKEN` /
 * `CLOUDFLARE_ACCOUNT_ID`（后者是白名单式过滤，会把凭据丢掉）。其余变量一律不透传。
 */
export function previewToolEnvironment(extra = {}) {
    const allowed = [
        'PATH',
        'Path',
        'SystemRoot',
        'WINDIR',
        'COMSPEC',
        'PATHEXT',
        'APPDATA',
        'LOCALAPPDATA',
        'USERPROFILE',
        'HOME',
        'CI'
    ];
    const env = {};
    for (const name of allowed) {
        if (process.env[name]) {
            env[name] = process.env[name];
        }
    }

    mkdirSync(PROBE_TMP_DIR, { recursive: true });
    mkdirSync(WRANGLER_LOG_DIR, { recursive: true });

    const environment = {
        ...env,
        TEMP: PROBE_TMP_DIR,
        TMP: PROBE_TMP_DIR,
        WRANGLER_LOG_PATH: WRANGLER_LOG_DIR,
        WRANGLER_SEND_METRICS: 'false',
        ASTRO_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        ...extra
    };

    if (process.env.CLOUDFLARE_API_TOKEN) {
        environment.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    }
    if (process.env.CLOUDFLARE_ACCOUNT_ID) {
        environment.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    }

    return environment;
}

/** 本次要用的预览 KV id：`PREVIEW_KV_ID` 可覆盖，但绝不允许等于生产 id。 */
export function resolvePreviewKvId() {
    const kvId = String(process.env.PREVIEW_KV_ID || PREVIEW_KV_ID).trim();

    if (!/^[0-9a-f]{32}$/i.test(kvId)) {
        throw new Error(`预览 KV id 形状不对（应为 32 位十六进制）：${kvId}`);
    }
    if (kvId === PRODUCTION_KV_ID) {
        throw new Error(
            `拒绝执行：预览 KV id 不能是生产命名空间 ${PRODUCTION_KV_ID}。` +
                '预览与生产必须完全分开（wrangler.jsonc 的 preview_id 才是预览 id）。'
        );
    }
    return kvId;
}

function requireBuild() {
    const entryPath = path.join(REPO_ROOT, 'dist', 'server', 'entry.mjs');
    const serverConfigPath = path.join(REPO_ROOT, 'dist', 'server', 'wrangler.json');
    const clientDir = path.join(REPO_ROOT, 'dist', 'client');

    if (!existsSync(entryPath) || !existsSync(serverConfigPath) || !existsSync(clientDir)) {
        throw new Error('没有找到 dist/ 构建产物：请先执行 `npm run build`，再派生预览配置。');
    }
    return { entryPath, serverConfigPath, clientDir };
}

/**
 * 断言派生出来的预览配置是「预览态」而不是「生产态」。
 *
 * 这是整条链路唯一的**机器化防线**：任何一次手滑（比如把 kv id 换回 wrangler.jsonc 里的 `id`）
 * 都会在这里抛错退出，而不是静静地让 PR 预览读写生产 KV。
 */
export function assertPreviewConfig(config, kvId) {
    const serialized = JSON.stringify(config);

    if (serialized.includes(PRODUCTION_KV_ID)) {
        throw new Error(
            `拒绝写预览配置：里面出现了生产 KV id ${PRODUCTION_KV_ID}。` +
                '预览链路不得引用生产命名空间（这正是不能用 `--env preview` 的原因）。'
        );
    }

    const bindings = Array.isArray(config.kv_namespaces) ? config.kv_namespaces : [];
    if (bindings.length !== 1 || bindings[0].binding !== 'CLASS_MAP_DATA') {
        throw new Error(
            `拒绝写预览配置：kv_namespaces 必须只有 CLASS_MAP_DATA 一项，实际 ${JSON.stringify(bindings.map((entry) => entry.binding))}`
        );
    }
    if (bindings[0].id !== kvId) {
        throw new Error(`拒绝写预览配置：CLASS_MAP_DATA 的 id 必须是预览 id ${kvId}，实际 ${bindings[0].id}`);
    }
    if (config.name !== PREVIEW_WORKER_NAME) {
        throw new Error(`拒绝写预览配置：name 必须是 ${PREVIEW_WORKER_NAME}，实际 ${config.name}`);
    }

    for (const key of STRIPPED_METADATA_KEYS) {
        if (key in config) {
            throw new Error(`拒绝写预览配置：仍残留 ${key} 块（重定向元数据/本地/预览专用块都必须删掉）。`);
        }
    }
}

/**
 * 从 `dist/server/wrangler.json` 派生 `.wrangler/preview/wrangler.json`。
 * 返回 `{ configPath, name, kvId, kvBindings }`。
 */
export function writePreviewConfig() {
    const { entryPath, serverConfigPath, clientDir } = requireBuild();
    const kvId = resolvePreviewKvId();
    const config = readJson(serverConfigPath);

    for (const key of STRIPPED_METADATA_KEYS) {
        delete config[key];
    }

    config.name = PREVIEW_WORKER_NAME;
    config.main = entryPath;
    config.assets = { ...(config.assets || {}), binding: 'ASSETS', directory: clientDir };
    config.kv_namespaces = [{ binding: 'CLASS_MAP_DATA', id: kvId }];

    // vars 只保留非密钥的提示语，并换成 demo 文案；真正的口令走 `--secrets-file`。
    const vars = { ...(config.vars || {}) };
    delete vars.DETAILS_PASSPHRASE;
    delete vars.DETAILS_SESSION_SECRET;
    vars.DETAILS_HINT = DEMO_HINT;
    config.vars = vars;

    assertPreviewConfig(config, kvId);

    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(PREVIEW_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');

    // 写盘后再读回来断言一次：避免「写了但内容不是刚校验的那份」。
    assertPreviewConfig(readJson(PREVIEW_CONFIG_PATH), kvId);

    return {
        configPath: PREVIEW_CONFIG_PATH,
        name: config.name,
        kvId,
        kvBindings: config.kv_namespaces.map((entry) => entry.binding)
    };
}

/** demo 口令/会话密钥写进临时 secrets 文件（只含仓库里的 demo 常量，跑完即删）。 */
function writePreviewSecretsFile() {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    const secrets = {
        DETAILS_PASSPHRASE: DEMO_PASSPHRASE,
        DETAILS_SESSION_SECRET: DEMO_SESSION_SECRET,
        DETAILS_HINT: DEMO_HINT
    };
    writeFileSync(PREVIEW_SECRETS_PATH, JSON.stringify(secrets, null, 2) + '\n', 'utf8');
    return PREVIEW_SECRETS_PATH;
}

function removePreviewSecretsFile() {
    rmSync(PREVIEW_SECRETS_PATH, { force: true });
}

function killTree(child) {
    if (!child || child.killed || child.exitCode !== null) {
        return;
    }
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref();
        } catch (_error) {
            child.kill('SIGKILL');
        }
    } else {
        child.kill('SIGTERM');
    }
}

/** 跑一次 wrangler 子命令，收集 stdout+stderr（不抛错，由调用方判定）。 */
function runWrangler(args, options = {}) {
    const timeoutMs = options.timeoutMs || WRANGLER_TIMEOUT_MS;
    return new Promise((resolve) => {
        let settled = false;
        let output = '';
        const child = spawn(process.execPath, [WRANGLER_BIN, ...args], {
            cwd: REPO_ROOT,
            env: previewToolEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve({ ...result, output });
        };

        const timer = setTimeout(() => {
            killTree(child);
            finish({ ok: false, timedOut: true });
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('error', (error) => finish({ ok: false, error: String((error && error.message) || error) }));
        child.on('close', (code) => finish({ ok: code === 0, code }));
    });
}

/** 去掉 ANSI 颜色序列，方便解析 URL。 */
function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

/** 从 `versions upload` 输出里取预览 URL：优先 "Preview URL" 那一行，回退第一个 https URL。 */
export function parsePreviewUrl(output) {
    const text = stripAnsi(output);

    for (const line of text.split(/\r?\n/)) {
        if (!/preview\s*url/i.test(line)) {
            continue;
        }
        const match = line.match(/https:\/\/[^\s"'`]+/);
        if (match) {
            return match[0].replace(/[),.;]+$/, '');
        }
    }

    const fallback = text.match(/https:\/\/[^\s"'`]+/);
    return fallback ? fallback[0].replace(/[),.;]+$/, '') : null;
}

function assertRemoteWritable() {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
        throw new Error(
            '缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID —— 预览的 seed 与 upload 都要写远程，' +
                '请在 CI secrets 或本地环境里提供（推荐只授权预览 worker + 预览 KV 的专供 token）。'
        );
    }
}

/** 把 demo 夹具写进**预览**命名空间（两条固定键，值与 upload-kv-data.mjs 同源）。 */
export async function seedPreviewKv() {
    assertRemoteWritable();
    const kvId = resolvePreviewKvId();
    const students = normalizeStudents(FIXTURE_STUDENTS);
    const datasets = [
        [DATA_KEYS.public, buildPublicDataset(students)],
        [DATA_KEYS.raw, students]
    ];

    mkdirSync(PREVIEW_FIXTURE_DIR, { recursive: true });
    log(`▶ 写入预览 KV 夹具（namespace ${kvId}，--remote）`);

    for (const [key, value] of datasets) {
        const valuePath = path.join(PREVIEW_FIXTURE_DIR, `${key.replace(/[^a-z0-9]+/gi, '_')}.json`);
        writeFileSync(valuePath, JSON.stringify(value), 'utf8');

        const result = await runWrangler([
            'kv',
            'key',
            'put',
            key,
            '--path',
            valuePath,
            '--namespace-id',
            kvId,
            '--remote'
        ]);

        if (!result.ok) {
            throw new Error(
                `预览 KV 写入失败（${key}）：退出码 ${result.code}${result.timedOut ? '（超时）' : ''}\n` +
                    `wrangler 输出（末尾）：\n${result.output.slice(-800)}`
            );
        }
        log(`   ✔ ${key}（${Array.isArray(value) ? value.length : Object.keys(value).length} 条/键）`);
    }

    log(`✅ demo 夹具已写入预览命名空间 ${kvId}（口令 ${DEMO_PASSPHRASE}，与生产 KV 无关）`);
}

const BOOTSTRAP_REQUIRED = /not\s*found|does\s*not\s*exist|script_not_found|10007/i;
const UNKNOWN_FLAG = /unknown\s+(argument|option)|unrecognized\s+(argument|option)/i;

/**
 * 上传一个预览版本（`wrangler versions upload`，**只上传版本、不改流量**），打印 `PREVIEW_URL=`。
 *
 * 首次自举：worker 还不存在时 `versions upload` 会报 not found，这里先 `deploy` 一次建出
 * `class1forever-preview` 再重试一次 upload；仍失败就原样把输出带出来。
 */
export async function uploadPreviewVersion(options = {}) {
    const alias = String(options.alias || '').trim();
    const tag = String(options.tag || alias).trim();

    if (!alias || !/^[A-Za-z0-9._-]+$/.test(alias)) {
        throw new Error(`--alias 必填且只能是 [A-Za-z0-9._-]：${alias || '(空)'}`);
    }
    if (!tag || !/^[A-Za-z0-9._-]+$/.test(tag)) {
        throw new Error(`--tag 只能是 [A-Za-z0-9._-]：${tag}`);
    }
    assertRemoteWritable();

    const { configPath, kvId, name } = writePreviewConfig();
    log(`▶ 预览配置：${path.relative(REPO_ROOT, configPath)}（name=${name}，CLASS_MAP_DATA=${kvId}）`);

    const secretsPath = writePreviewSecretsFile();
    const uploadArgs = [
        'versions',
        'upload',
        '--config',
        configPath,
        '--name',
        name,
        '--tag',
        tag,
        '--preview-alias',
        alias,
        '--secrets-file',
        secretsPath
    ];

    try {
        let result = await runWrangler(uploadArgs);

        if (!result.ok && BOOTSTRAP_REQUIRED.test(result.output)) {
            log('▶ 预览 worker 还不存在：先 deploy 一次建出它，再重试 upload（仅此一次）');
            const deployArgs = ['deploy', '--config', configPath, '--secrets-file', secretsPath];
            let deployed = await runWrangler(deployArgs);

            if (!deployed.ok && UNKNOWN_FLAG.test(deployed.output)) {
                log('▶ 这个 wrangler 不认 `deploy --secrets-file`：改为不带该参数的 deploy（demo 口令仍由 upload 写入）');
                deployed = await runWrangler(['deploy', '--config', configPath]);
            }

            if (!deployed.ok) {
                throw new Error(
                    `首次自举 deploy 失败：退出码 ${deployed.code}${deployed.timedOut ? '（超时）' : ''}\n` +
                        `wrangler 输出（末尾）：\n${deployed.output.slice(-1200)}`
                );
            }

            result = await runWrangler(uploadArgs);
        }

        if (!result.ok) {
            throw new Error(
                `versions upload 失败：退出码 ${result.code}${result.timedOut ? '（超时）' : ''}\n` +
                    `wrangler 输出（末尾）：\n${result.output.slice(-1200)}`
            );
        }

        const previewUrl = parsePreviewUrl(result.output);
        if (!previewUrl) {
            throw new Error(`未能从输出里解析到预览 URL：\n${result.output.slice(-1200)}`);
        }

        log(result.output.trim());
        // CI 抓这一行（workflow 里用 sed 取 PREVIEW_URL= 之后的内容）。
        log(`PREVIEW_URL=${previewUrl}`);
        return { previewUrl, alias, tag, configPath };
    } finally {
        removePreviewSecretsFile();
    }
}

function parseArgs(argv) {
    const options = { alias: '', tag: '', help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--alias' || token === '--tag') {
            const value = argv[index + 1] || '';
            if (token === '--alias') {
                options.alias = value;
            } else {
                options.tag = value;
            }
            index += 1;
        } else if (token.startsWith('--alias=')) {
            options.alias = token.slice('--alias='.length);
        } else if (token.startsWith('--tag=')) {
            options.tag = token.slice('--tag='.length);
        } else if (token === '--help' || token === '-h') {
            options.help = true;
        } else {
            throw new Error(`未知参数：${token}`);
        }
    }
    return options;
}

const USAGE = `用法：
  node scripts/preview-runtime.mjs write-config
  node scripts/preview-runtime.mjs seed
  node scripts/preview-runtime.mjs upload --alias pr-<n> [--tag pr-<n>]

预览 worker：${PREVIEW_WORKER_NAME}（生产是 class1forever，两者完全分开）
预览 KV：    ${PREVIEW_KV_ID}（生产 ${PRODUCTION_KV_ID} 绝不允许出现在预览链路里）`;

async function main(argv) {
    const [command, ...rest] = argv;
    const options = parseArgs(rest);

    if (!command || options.help) {
        log(USAGE);
        return;
    }

    if (command === 'write-config') {
        const { configPath, name, kvId, kvBindings } = writePreviewConfig();
        log(`✅ 预览配置已生成：${path.relative(REPO_ROOT, configPath)}`);
        log(`   name=${name}  kv_namespaces=${JSON.stringify(kvBindings)}  CLASS_MAP_DATA=${kvId}`);
        return;
    }

    if (command === 'seed') {
        await seedPreviewKv();
        return;
    }

    if (command === 'upload') {
        await uploadPreviewVersion({ alias: options.alias, tag: options.tag });
        return;
    }

    throw new Error(`未知子命令：${command}\n\n${USAGE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    });
}

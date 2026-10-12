/**
 * @fileoverview 本地运行通路：没有 Cloudflare 凭据也能起一个带 /api/* 的站点。
 *
 * 与生产形态同构，而不是另写一套假 API：
 *   1. 从 `astro build` 产出的 dist/server/wrangler.json（适配器合并后的真实配置）派生
 *      一份本地配置：main / assets.directory 换成绝对路径，KV 换成测试 namespace id，
 *      去掉 `remote: true`，并用演示口令填 vars —— 因此不会碰到 .dev.vars 里的真实密钥。
 *   2. 用 `wrangler kv key put --local` 把夹具数据写进本地 KV
 *      （students:public:v1 公开聚合 / students:raw:v1 明细）。
 *   3. `wrangler dev` 起 Worker 运行时：本地 KV + 演示口令，无需 `wrangler login`。
 *
 * 用法（CLI）：
 *   node scripts/local-runtime.mjs                  # 起站，默认 http://127.0.0.1:8788
 *   node scripts/local-runtime.mjs --port 9000
 *   node scripts/local-runtime.mjs --seed-only      # 只写 KV 数据，不起站
 *   node scripts/local-runtime.mjs --reset          # 先清空本地 KV 再写
 *   node scripts/local-runtime.mjs --state-dir .wrangler/local/state-x   # 换一套本地 KV（并发时用）
 *   STUDENTS_PUBLIC_FILE=public.json node scripts/local-runtime.mjs   # 用真实聚合数据联调
 *
 * 并发约束（重要）：
 *   - 本地 KV 是 miniflare 的 SQLite 目录，**同一个 state 目录同一时间只允许一个写者**：
 *     写入时抢 .prepare.lock，`wrangler dev` 运行期间持有 server.lock，锁里存 pid（进程没了按陈旧锁处理）。
 *     被占用时会给出明确报错，而不是崩在 libuv 断言上；并发场景请用 `--state-dir` 各用一套目录
 *     （测试默认就用独立的 state-test）。
 *   - KV 写入走异步 spawn + 60s 超时 + 3 次重试：并发构建/起服务时 wrangler 偶发失败不会打死进程。
 *   - 写入是幂等的：fixture 内容哈希没变且没有 --reset 时直接跳过，不重复调 wrangler。
 *
 * 沙箱提示：Windows 沙箱下 workerd 必须能往临时目录写文件，请把 TEMP/TMP 指向工作区内的
 * 目录（见 README「本地开发」），否则 workerd 会报 CreateDirectory #5 拒绝访问。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicDataset, normalizeStudents } from '../shared/data-model.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 演示口令：只在本地通路与测试里使用，与 .dev.vars 的真实密钥无关。 */
export const DEMO_PASSPHRASE = 'demo';
export const DEMO_SESSION_SECRET = 'local-development-only-session-secret';
export const DEMO_HINT = '本地演示口令：demo（仅本地通路与测试使用）';

/** 本地 KV 的 namespace id：只用于本地持久化，不指向任何线上 namespace。 */
const LOCAL_KV_ID = '00000000000000000000000000000001';

export const LOCAL_DIR = path.join(REPO_ROOT, '.wrangler', 'local');
export const LOCAL_CONFIG_PATH = path.join(LOCAL_DIR, 'wrangler.local.json');
export const LOCAL_STATE_DIR = path.join(LOCAL_DIR, 'state');
/** 契约测试专用 state：与 dev:local 的默认目录分开，避免并发时两个写者抢同一个 SQLite。 */
export const LOCAL_TEST_STATE_DIR = path.join(LOCAL_DIR, 'state-test');
/** 「空 KV」state：用来断言数据未配置的失败态，永远不写入夹具。 */
export const LOCAL_EMPTY_STATE_DIR = path.join(LOCAL_DIR, 'state-empty');
const LOCAL_FIXTURE_DIR = path.join(LOCAL_DIR, 'fixtures');
const WRANGLER_BIN = path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const WRANGLER_TIMEOUT_MS = 60000;
const WRANGLER_RETRIES = 3;

/**
 * 夹具学生：全部是合成数据，不来自也不代表任何真实学生。
 * 取值覆盖 3 个省级区域、4 座城市，且同一城市内有多个学校，便于断言排序与筛选。
 */
export const FIXTURE_STUDENTS = Object.freeze([
    { name: '示例甲', school: '示例大学', province: '北京', city: '海淀区' },
    { name: '示例乙', school: '示例学院', province: '北京', city: '海淀区' },
    { name: '示例丙', school: '示例大学', province: '北京', city: '朝阳区' },
    { name: '示例丁', school: '示例理工', province: '浙江', city: '杭州市' },
    { name: '示例戊', school: '示例师范', province: '浙江', city: '杭州市' },
    { name: '示例己', school: '示例医大', province: '四川', city: '成都市' }
]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function alivePid(pid) {
    if (!pid || pid === process.pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (_error) {
        return false;
    }
}

const STATE_LOCK_NAMES = ['.prepare.lock', 'server.lock'];

/** 找该 state 目录上活着的锁持有者（自己不算）。 */
function liveLockHolder(stateDir) {
    for (const name of STATE_LOCK_NAMES) {
        const lockPath = path.join(stateDir, name);
        if (!existsSync(lockPath)) {
            continue;
        }
        let holder = null;
        try {
            holder = readJson(lockPath);
        } catch (_error) {
            holder = null;
        }
        if (holder && holder.pid !== process.pid && alivePid(holder.pid)) {
            return { name, pid: holder.pid };
        }
    }
    return null;
}

/** 同一 state 目录只允许一个写者：占用时给明确报错，而不是崩在 libuv 断言/EPERM 上。 */
function assertStateDirFree(stateDir) {
    const holder = liveLockHolder(stateDir);
    if (holder) {
        throw new Error(
            `本地 KV 目录已被另一个进程占用：${stateDir}（pid ${holder.pid}，${holder.name}）。\n` +
            '同一个 state 目录只允许一个写者（miniflare 的 SQLite 不支持多写者）；\n' +
            '并发跑测试或 dev 时请用 --state-dir 各用一套目录（测试默认用独立的 state-test）。'
        );
    }
}

/**
 * 抢占一个 state 目录的锁（.prepare.lock / server.lock）。
 *
 * 锁文件里存 pid，进程不在了视为陈旧锁可抢占；占着则给明确报错。
 */
function acquireStateLock(stateDir, lockName) {
    assertStateDirFree(stateDir);
    mkdirSync(stateDir, { recursive: true });
    const lockPath = path.join(stateDir, lockName);
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
    return () => rmSync(lockPath, { force: true });
}

/**
 * 准备要写进本地 KV 的两份数据。
 *
 * - 默认：使用合成夹具，公开聚合由 shared/data-model.mjs 现算（与上传脚本同一套口径）。
 * - `publicFile`：用真实导出的 `students:public:v1` 看真实数字（公开数据只有人数，可安全导出）。
 * - `rawFile`：用真实明细喂详情路由；明细含姓名学校，只允许在本地使用。
 */
export function buildDatasets(options = {}) {
    const publicFile = options.publicFile ?? process.env.STUDENTS_PUBLIC_FILE;
    const rawFile = options.rawFile ?? process.env.STUDENTS_RAW_FILE;

    if (publicFile || rawFile) {
        const datasets = {};
        if (publicFile) {
            datasets.public = readJson(publicFile);
        }
        if (rawFile) {
            datasets.raw = normalizeStudents(readJson(rawFile));
        }
        return datasets;
    }

    const students = normalizeStudents(FIXTURE_STUDENTS);
    return {
        public: buildPublicDataset(students),
        raw: students
    };
}

function requireBuild() {
    const entry = path.join(REPO_ROOT, 'dist', 'server', 'entry.mjs');
    const serverConfig = path.join(REPO_ROOT, 'dist', 'server', 'wrangler.json');
    if (!existsSync(entry) || !existsSync(serverConfig)) {
        throw new Error('没有找到 dist/server 构建产物：请先执行 `npm run build`，再启动本地通路。');
    }
    return { entry, serverConfig };
}

/**
 * 由适配器合并后的 dist/server/wrangler.json 派生本地配置。
 * 这里刻意保留 assets / compatibility_date / compatibility_flags / rules 等字段，
 * 让本地运行的 Worker 形态与线上一致，只替换「凭据、远端绑定、本地路径」三类东西。
 */
export function writeLocalConfig() {
    const { entry, serverConfig } = requireBuild();
    const base = readJson(serverConfig);

    // 从适配器输出里剔除「指向构建时的宿主路径 / 供 deploy 重定向使用」的元数据。
    for (const key of ['configPath', 'userConfigPath', 'topLevelName', 'definedEnvironments', 'dev', 'previews']) {
        delete base[key];
    }

    base.main = entry;
    base.assets = { ...(base.assets || {}), binding: 'ASSETS', directory: path.join(REPO_ROOT, 'dist', 'client') };

    base.kv_namespaces = [{ binding: 'CLASS_MAP_DATA', id: LOCAL_KV_ID }];

    base.vars = {
        ...(base.vars || {}),
        DETAILS_HINT: DEMO_HINT,
        DETAILS_PASSPHRASE: DEMO_PASSPHRASE,
        DETAILS_SESSION_SECRET: DEMO_SESSION_SECRET
    };

    mkdirSync(LOCAL_DIR, { recursive: true });
    writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(base, null, 2) + '\n', 'utf8');
    return LOCAL_CONFIG_PATH;
}

/**
 * 异步跑一次 wrangler 子命令（不用 spawnSync：在并发负载下同步 spawn 会撞上
 * Windows libuv 的 UV_HANDLE_CLOSING 断言，把整个进程带走）。
 */
function runWrangler(args, options = {}) {
    const timeoutMs = options.timeoutMs || WRANGLER_TIMEOUT_MS;
    return new Promise((resolve) => {
        let settled = false;
        let output = '';
        const child = spawn(process.execPath, [WRANGLER_BIN, ...args], {
            cwd: REPO_ROOT,
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

        child.stdout.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk) => { output += chunk.toString(); });
        child.on('error', (error) => finish({ ok: false, error: String(error && error.message) }));
        child.on('close', (code) => finish({ ok: code === 0, code }));
    });
}

/** 调 `wrangler kv key put --local` 写一条键：异步 + 超时 + 重试，失败给清晰报错。 */
export async function putLocalKvKey(key, value, options = {}) {
    const configPath = options.configPath || LOCAL_CONFIG_PATH;
    const persistTo = options.persistTo || LOCAL_STATE_DIR;

    mkdirSync(LOCAL_FIXTURE_DIR, { recursive: true });
    const valuePath = path.join(LOCAL_FIXTURE_DIR, `${key.replace(/[^a-z0-9]+/gi, '_')}.json`);
    writeFileSync(valuePath, JSON.stringify(value), 'utf8');

    const args = [
        'kv', 'key', 'put', key,
        '--path', valuePath,
        '--binding', 'CLASS_MAP_DATA',
        '--local',
        '--persist-to', persistTo,
        '--config', configPath
    ];

    let last = null;
    for (let attempt = 1; attempt <= WRANGLER_RETRIES; attempt += 1) {
        last = await runWrangler(args);
        if (last.ok) {
            return valuePath;
        }
        if (attempt < WRANGLER_RETRIES) {
            await sleep(800 * attempt);
        }
    }

    const reason = last && last.timedOut ? `超时 ${WRANGLER_TIMEOUT_MS}ms` : `退出码 ${last && last.code}`;
    throw new Error(
        `本地 KV 写入失败（${key}，重试 ${WRANGLER_RETRIES} 次仍失败：${reason}）。\n` +
        '如果同一 state 目录还有别的 wrangler / dev:local / test:api 在跑，请改用 --state-dir 换一套目录。\n' +
        `wrangler 输出（末尾）：\n${String((last && last.output) || '').slice(-800)}`
    );
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 清空本地 KV 持久化目录（默认是夹具环境；传目录可清空别的本地环境）。
 * 锁文件（*.lock）会保留：它们存的是活着的 pid，清掉反而让并发保护失效。
 * 刚停掉的 workerd 可能还扣着 SQLite 目录（Windows 下表现为 EPERM），所以带少量重试。
 */
export function resetLocalState(stateDir = LOCAL_STATE_DIR) {
    if (!existsSync(stateDir)) {
        return;
    }

    const removeContent = () => {
        for (const entry of readdirSync(stateDir)) {
            if (entry.endsWith('.lock')) {
                continue;
            }
            rmSync(path.join(stateDir, entry), { recursive: true, force: true });
        }
    };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
            removeContent();
            return;
        } catch (error) {
            if (attempt === 5) {
                throw new Error(
                    `清空本地 KV 目录失败：${stateDir}（${error && error.message}）。\n` +
                    '通常是有另一个进程（wrangler dev / 另一个测试）刚停下或还在用这个目录；\n' +
                    '等几秒重试，或换 --state-dir 用一套新目录。'
                );
            }
            sleepSync(400);
        }
    }
}

function fixtureHash(datasets) {
    return createHash('sha256').update(JSON.stringify(datasets)).digest('hex');
}

/**
 * 准备配置 + 数据（幂等）。
 *
 * - `reset: true`：先清空该 state 目录，保证断言从确定状态出发（测试用；限流计数也在这里面）。
 * - 不 reset 时：fixture 哈希与 state 目录里的 .seeded.json 一致就跳过写入，不重复调 wrangler。
 * 返回 { configPath, persistTo, seeded, datasets }。
 */
export async function prepareLocalRuntime(options = {}) {
    const configPath = writeLocalConfig();
    const stateDir = options.stateDir || LOCAL_STATE_DIR;
    assertStateDirFree(stateDir);
    const datasets = buildDatasets(options);
    const markerPath = path.join(stateDir, '.seeded.json');
    const hash = fixtureHash(datasets);

    if (!options.reset && existsSync(markerPath)) {
        try {
            const marker = readJson(markerPath);
            if (marker.hash === hash) {
                return { configPath, persistTo: stateDir, seeded: false, datasets };
            }
        } catch (_error) {
            // marker 坏了就当成没写过，继续重新写。
        }
    }

    const release = acquireStateLock(stateDir, '.prepare.lock');
    try {
        if (options.reset) {
            try {
                resetLocalState(stateDir);
            } catch (error) {
                throw new Error(
                    `清空本地 KV 目录失败：${stateDir}（${error && error.message}）。\n` +
                    '通常是有另一个进程（wrangler dev / 另一个测试）正在用这个目录，请先结束它或换 --state-dir。'
                );
            }
        }
        if (datasets.public) {
            await putLocalKvKey('students:public:v1', datasets.public, { configPath, persistTo: stateDir });
        }
        if (datasets.raw) {
            await putLocalKvKey('students:raw:v1', datasets.raw, { configPath, persistTo: stateDir });
        }
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(markerPath, JSON.stringify({ hash, seededAt: new Date().toISOString() }), 'utf8');
    } finally {
        release();
    }

    return { configPath, persistTo: stateDir, seeded: true, datasets };
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

/**
 * 起 `wrangler dev` 并等到首页可访问。
 * 运行期间持有该 state 目录的 server.lock（同一本地 KV 不允许第二个写者）。
 * 返回 { url, stop(), output() }；启动失败会把 wrangler 输出一起抛出来。
 */
export async function startLocalServer(options = {}) {
    const port = Number(options.port || process.env.PORT || 8788);
    const configPath = options.configPath || LOCAL_CONFIG_PATH;
    const persistTo = options.persistTo || LOCAL_STATE_DIR;
    const url = `http://127.0.0.1:${port}`;

    const releaseLock = acquireStateLock(persistTo, 'server.lock');
    let serverHeld = true;
    const releaseServerLock = () => {
        if (serverHeld) {
            serverHeld = false;
            releaseLock();
        }
    };

    const child = spawn(
        process.execPath,
        [WRANGLER_BIN, 'dev', '--config', configPath, '--persist-to', persistTo, '--port', String(port), '--ip', '127.0.0.1'],
        { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    let exited = false;
    let spawnError = '';
    child.on('exit', () => { exited = true; });
    child.on('error', (error) => {
        spawnError = error && error.message ? error.message : String(error);
        exited = true;
    });

    const deadline = Date.now() + Number(options.timeoutMs || 120000);
    let lastError = '';
    while (Date.now() < deadline) {
        if (exited) {
            break;
        }
        try {
            const response = await fetch(`${url}/`, { redirect: 'manual' });
            if (response.status < 500) {
                return {
                    url,
                    port,
                    stop: () => {
                        killTree(child);
                        releaseServerLock();
                    },
                    output: () => output
                };
            }
            lastError = `首页返回 ${response.status}`;
        } catch (error) {
            lastError = error && error.message ? error.message : String(error);
        }
        await sleep(500);
    }

    killTree(child);
    releaseServerLock();
    throw new Error(
        `本地服务未能在 ${url} 就绪（${spawnError || lastError || '未知原因'}）。wrangler 输出：\n${output}`
    );
}

async function main(argv) {
    const args = new Set(argv);
    const valueOf = (flag) => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };

    const { configPath, persistTo, seeded } = await prepareLocalRuntime({
        reset: args.has('--reset'),
        stateDir: valueOf('--state-dir'),
        publicFile: valueOf('--public-file'),
        rawFile: valueOf('--raw-file')
    });

    if (args.has('--seed-only')) {
        console.log(`✅ 本地 KV 已就绪（${seeded ? '已写入' : '命中已有 fixture，跳过写入'}）：配置 ${configPath}，持久化 ${persistTo}`);
        return;
    }

    const server = await startLocalServer({ port: valueOf('--port'), configPath, persistTo });
    console.log(`✅ 本地站点已就绪：${server.url}（演示口令 ${DEMO_PASSPHRASE}，Ctrl+C 结束）`);

    const shutdown = () => {
        server.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    });
}

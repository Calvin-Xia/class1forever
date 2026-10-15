/** Node HTTP + 内存 KV 演示夹具。验证应用契约，不能代替 Makers 真实运行时。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { FIXTURE_STUDENTS, DEMO_PASSPHRASE } from './local-runtime.mjs';
import { buildPublicDataset } from '../shared/data-model.mjs';

export const DEMO_RELEASE = 'demo_20261014';
let adapter;
async function loadAdapter() {
    if (!adapter) {
        fs.mkdirSync('.edgeone-local', { recursive: true });
        await build({ entryPoints: ['src/platform/edgeone.ts'], outfile: '.edgeone-local/adapter.mjs',
            bundle: true, platform: 'neutral', format: 'esm', target: 'es2022' });
        adapter = await import(pathToFileURL(path.resolve('.edgeone-local/adapter.mjs')).href);
    }
    return adapter;
}

export function demoKV(empty = false) {
    const values = new Map(empty ? [] : [
        [`students_raw_${DEMO_RELEASE}`, JSON.stringify(FIXTURE_STUDENTS)],
        [`students_public_${DEMO_RELEASE}`, JSON.stringify(buildPublicDataset(FIXTURE_STUDENTS))]
    ]);
    return { values,
        async get(key) { return values.get(key) ?? null; },
        async put(key, value) { values.set(key, value); },
        async delete(key) { values.delete(key); }
    };
}

export async function startEdgeoneFixture({ port = 0, empty = false, env = {}, trustedIp = '127.0.0.1' } = {}) {
    await loadAdapter();
    const kv = demoKV(empty);
    const routes = {};
    for (const route of ['map/public', 'map/details', 'auth/details', 'auth/logout']) {
        const bundle = fs.readFileSync(`dist-edgeone/edge-functions/api/${route}.js`, 'utf8');
        // Node 模块作用域模拟 Makers 的每个部署独立全局绑定；运行真正构建后的函数入口。
        const injected = `let CLASS_MAP_DATA; export function bindDemoKV(value) { CLASS_MAP_DATA = value; }\n` +
            bundle + `\n// fixture-instance-${crypto.randomUUID()}`;
        const module = await import('data:text/javascript;base64,' + Buffer.from(injected).toString('base64'));
        module.bindDemoKV(kv);
        routes['/api/' + route] = module.default;
    }
    const vars = { DATA_RELEASE_ID: DEMO_RELEASE, DETAILS_PASSPHRASE: DEMO_PASSPHRASE,
        DETAILS_SESSION_SECRET: 'edgeone-local-demo-session-key-only', ...env };
    kv.values.set('classmap_runtime_config', JSON.stringify(vars));
    const server = http.createServer(async (incoming, outgoing) => {
        try {
            const origin = `http://127.0.0.1:${server.address().port}`;
            const chunks = [];
            for await (const chunk of incoming) chunks.push(chunk);
            const method = incoming.method;
            const request = new Request(origin + incoming.url, { method, headers: incoming.headers,
                ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
            request.eo = trustedIp ? { clientIp: trustedIp } : {};
            let response;
            if (new URL(request.url).pathname.startsWith('/api/')) {
                const handle = routes[new URL(request.url).pathname];
                response = handle ? await handle({ request, env: {} }) : new Response('Not found', { status: 404 });
            } else {
                const pathname = decodeURIComponent(new URL(request.url).pathname);
                const root = path.resolve('dist-edgeone/static');
                const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
                if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
                    response = new Response('Not found', { status: 404 });
                } else {
                    const config = JSON.parse(fs.readFileSync('dist-edgeone/edgeone.json', 'utf8'));
                    const headers = {};
                    for (const rule of config.headers ?? []) {
                        if (rule.source === '/*' || rule.source === pathname ||
                            (['/_astro/*', '/fonts/subsets/*'].includes(rule.source) && pathname.startsWith(rule.source.slice(0, -1)))) {
                            for (const header of rule.headers) headers[header.key] = header.value;
                        }
                    }
                    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                        '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream';
                    response = new Response(fs.readFileSync(target), { headers: { ...headers, 'Content-Type': mime } });
                }
            }
            outgoing.writeHead(response.status, Object.fromEntries(response.headers));
            outgoing.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
        } catch {
            outgoing.writeHead(500); outgoing.end('Fixture failed');
        }
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, kv, stop() { server.closeAllConnections(); server.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/edgeone-local.mjs')) {
    const server = await startEdgeoneFixture({ port: Number(process.env.PORT || 8789) });
    console.log(`EdgeOne 应用演示夹具（非 Makers 运行时）：${server.url}，演示口令 demo`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.stop(); process.exit(0); });
}

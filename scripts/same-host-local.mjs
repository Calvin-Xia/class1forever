/** 只绑定 loopback 的切线夹具：真实本地 CF Worker + 构建后 EO Node 夹具。
 * 不模拟 GeoDNS/TLS/CDN，不访问真实 KV，不作为可发布入口。
 */
import http from 'node:http';
import path from 'node:path';
import { prepareLocalRuntime, startLocalServer } from './local-runtime.mjs';
import { startEdgeoneFixture } from './edgeone-local.mjs';

export async function startSameHostFixture({ port = 0, workerPort = 8892, stateDir = '.wrangler/local/state-same-host', delayFontsMs = 0 } = {}) {
    if (!Number.isInteger(delayFontsMs) || delayFontsMs < 0 || delayFontsMs > 10000) throw new Error('Invalid font fixture delay');
    const local = await prepareLocalRuntime({ stateDir });
    const cf = await startLocalServer({ ...local, port: workerPort });
    let eo, gateway;
    let backend = 'cloudflare';
    const observations = [];
    try {
        eo = await startEdgeoneFixture();
        gateway = http.createServer(async (incoming, outgoing) => {
            const url = new URL(incoming.url, 'http://localhost');
            if (url.pathname === '/__fixture/metrics' && incoming.method === 'GET') {
                outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                outgoing.end(JSON.stringify({ backend, observations }));
                return;
            }
            if (url.pathname === '/__fixture') {
                if (incoming.method === 'POST') {
                    const chunks = [];
                    for await (const chunk of incoming) chunks.push(chunk);
                    const choice = new URLSearchParams(Buffer.concat(chunks).toString()).get('backend');
                    if (!['cloudflare', 'edgeone'].includes(choice)) {
                        outgoing.writeHead(400); outgoing.end('Invalid fixture backend'); return;
                    }
                    backend = choice;
                }
                outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                outgoing.end(`<h1>同 Host 本地切线夹具</h1><p>当前：${backend}</p><p>CF 是真实本地 Worker；EO 是 Node 构建夹具。此页面不验证 DNS/TLS/CDN。</p><form method="post"><button name="backend" value="cloudflare">切到 Cloudflare</button><button name="backend" value="edgeone">切到 EdgeOne</button></form><a href="/">打开地图</a>`);
                return;
            }
            const selected = backend;
            const startedAt = Date.now();
            const target = new URL(incoming.url, selected === 'cloudflare' ? cf.url : eo.url);
            const proxy = http.request(target, { method: incoming.method, headers: incoming.headers }, response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    const body = Buffer.concat(chunks);
                    const send = () => {
                        observations.push({ path: url.pathname, platform: selected, status: response.statusCode, bytes: body.length,
                            startedAt, completedAt: Date.now() });
                        outgoing.writeHead(response.statusCode, { ...response.headers, 'x-fixture-platform': selected });
                        outgoing.end(body);
                    };
                    if (delayFontsMs && url.pathname.endsWith('.woff2')) setTimeout(send, delayFontsMs);
                    else send();
                });
            });
            proxy.on('error', () => { outgoing.writeHead(502); outgoing.end('Local fixture upstream unavailable'); });
            incoming.pipe(proxy);
        });
        await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(port, '127.0.0.1', resolve); });
        return {
            url: `http://localhost:${gateway.address().port}`,
            select(value) {
                if (!['cloudflare', 'edgeone'].includes(value)) throw new Error('Invalid fixture backend');
                backend = value;
            },
            observations,
            stop() { gateway.closeAllConnections(); gateway.close(); eo.stop(); cf.stop(); }
        };
    } catch (error) {
        gateway?.close(); eo?.stop(); cf.stop(); throw error;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/same-host-local.mjs')) {
    const fixture = await startSameHostFixture({ port: 8791 });
    console.log(`同 Host 本地夹具：${fixture.url}；切线面板 ${fixture.url}/__fixture；演示口令 demo`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { fixture.stop(); process.exit(0); });
}

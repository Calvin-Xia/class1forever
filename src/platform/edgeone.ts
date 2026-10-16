import type { DataStore, Env } from '../lib/types';
import { login, logout, publicMap, detailsMap } from '../lib/api-handlers';
import { errorResponse } from '../lib/http';

/** Makers KV 是全局绑定；不假定环境变量也包含 KV，且不使用未确认的 TTL 参数。 */
export interface MakersKV {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
}

export interface EdgeContext {
    request: Request & { eo?: { clientIp?: string } };
    env: Record<string, string | undefined>;
}

export function makersStore(kv: MakersKV, secret: string): DataStore {
    async function physicalKey(key: string): Promise<string> {
        if (!key.startsWith('auth:rate:')) {
            if (!/^[A-Za-z0-9_]{1,512}$/.test(key)) throw new Error('Invalid Makers KV key.');
            return key;
        }
        const encoder = new TextEncoder();
        const signingKey = await crypto.subtle.importKey('raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const digest = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(key));
        return 'auth_rate_' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function get(key: string, type?: 'json'): Promise<any> {
        const value = await kv.get(await physicalKey(key));
        if (value === null) return null;
        if (key.startsWith('auth:rate:')) {
            const record = JSON.parse(value);
            if (typeof record.expiresAt !== 'number' || record.expiresAt <= Date.now()) return null;
            return String(record.value);
        }
        return type === 'json' ? JSON.parse(value) : value;
    }
    /**
     * 上一窗口的逻辑键：`auth:rate:<ip>:<bucket-1>`（复核裁定 #5）。
     * bucket 是最后一个冒号后的数字；IPv6 地址里也带冒号，所以只能从末尾切。
     */
    function previousRateWindowKey(key: string): string | null {
        const separator = key.lastIndexOf(':');
        if (separator === -1) return null;
        const bucket = Number(key.slice(separator + 1));
        if (!Number.isInteger(bucket) || bucket <= 0) return null;
        return `${key.slice(0, separator + 1)}${bucket - 1}`;
    }
    return {
        get,
        async put(key, value, options) {
            if (!key.startsWith('auth:rate:')) {
                return kv.put(await physicalKey(key), value);
            }
            const stored = JSON.stringify({ value, expiresAt: Date.now() + (options?.expirationTtl ?? 900) * 1000 });
            const result = await kv.put(await physicalKey(key), stored);
            // Makers KV 没有 TTL 参数，expiresAt 只是逻辑过期。写入新窗口时顺手删掉上一
            // 窗口的物理键，否则每个 15 分钟窗口都会留下一个永远不会再被读到的键。
            const previous = previousRateWindowKey(key);
            if (previous) await kv.delete(await physicalKey(previous));
            return result;
        },
        async delete(key) { return kv.delete(await physicalKey(key)); }
    };
}

/** 与安装的 Astro 6.4.8 createOriginCheckMiddleware 同一判定顺序。 */
export function originRejection(request: Request): Response | null {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
    const contentType = request.headers.get('content-type');
    const formLike = !request.headers.has('content-type') ||
        ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']
            .some(type => contentType?.toLowerCase().includes(type));
    if (formLike && request.headers.get('origin') !== new URL(request.url).origin) {
        return new Response(`Cross-site ${request.method} form submissions are forbidden`,
            { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return null;
}

export async function edgeoneApi(context: EdgeContext, kv?: MakersKV): Promise<Response> {
    const { request } = context;
    const rejected = originRejection(request);
    if (rejected) return rejected;
    const path = new URL(request.url).pathname;
    const routes = {
        '/api/map/public': { method: 'GET', handle: publicMap },
        '/api/map/details': { method: 'GET', handle: detailsMap },
        '/api/auth/details': { method: 'POST', handle: login },
        '/api/auth/logout': { method: 'POST', handle: logout }
    };
    const route = routes[path as keyof typeof routes];
    if (!route) return errorResponse(404, 'not_found', '接口不存在。');
    const head = request.method === 'HEAD' && route.method === 'GET';
    if (request.method !== route.method && !head) {
        return errorResponse(405, 'method_not_allowed', '请求方法有误。', {},
            { headers: { Allow: route.method === 'GET' ? 'GET, HEAD' : 'POST' } });
    }
    // 退出无需存储或环境配置，保持既有契约。
    if (path === '/api/auth/logout') return logout(request, {} as Env);
    // CLI context.env 是构建时注入；生产密钥只从私有 KV 读取，绝不打进函数包。
    // 本次请求读取一次并冻结配置；激活非原子、传播最终一致，见双平台操作包。
    let configuration: Record<string, string | undefined> = {};
    try {
        const key = context.env.CLASS_MAP_CONFIG_KEY || 'classmap_runtime_config';
        if (!/^[A-Za-z0-9_]{1,512}$/.test(key)) throw new Error('Invalid config key.');
        const value = kv ? await kv.get(key) : null;
        const parsed = value ? JSON.parse(value) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) configuration = parsed;
    } catch {
        configuration = {};
    }
    const release = configuration.DATA_RELEASE_ID;
    if (!kv || typeof release !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(release)) {
        return errorResponse(503, 'platform_not_configured', '服务暂未准备好，请稍后再试。', {},
            { headers: path === '/api/map/public' ? { Vary: 'Cookie' } : {} });
    }
    const ip = request.eo?.clientIp;
    if (path === '/api/auth/details' && !ip) {
        return errorResponse(503, 'trusted_ip_unavailable', '暂时无法查看详情，请稍后再试。');
    }
    const env: Env = {
        CLASS_MAP_DATA: makersStore(kv, typeof configuration.DETAILS_SESSION_SECRET === 'string' ? configuration.DETAILS_SESSION_SECRET : ''),
        DATA_RELEASE_ID: release,
        DETAILS_PASSPHRASE: typeof configuration.DETAILS_PASSPHRASE === 'string' ? configuration.DETAILS_PASSPHRASE : undefined,
        DETAILS_SESSION_SECRET: typeof configuration.DETAILS_SESSION_SECRET === 'string' ? configuration.DETAILS_SESSION_SECRET : undefined,
        DETAILS_HINT: typeof configuration.DETAILS_HINT === 'string' ? configuration.DETAILS_HINT : undefined,
        // 登录路由在 ip 缺失时已 fail closed（见上）；其余路由只用不到 IP 的处理器，
        // 这里按 CF 适配器的同款约定回落 `'unknown'`，保持 Env.trustedClientIp 必填。
        trustedClientIp: ip ?? 'unknown'
    };
    try {
        const response = await route.handle(request, env);
        return head ? new Response(null, { status: response.status, headers: response.headers }) : response;
    } catch {
        return errorResponse(503, 'platform_unavailable', '服务暂不可用，请稍后再试。');
    }
}

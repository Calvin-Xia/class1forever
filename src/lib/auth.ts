/**
 * 会话签名 / Cookie / 口令限流（迁移自 functions/_lib/auth.mjs，逐字段等价）。
 *
 * 契约（docs/migration-parity.md §1.2）：
 * - 令牌 = `base64url(JSON.stringify({ exp })) + "." + base64url(HMAC-SHA256(secret, encodedPayload))`，
 *   全程 WebCrypto（crypto.subtle），不引入 node:crypto。
 * - Cookie `detail_session`：`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`。
 * - 限流窗口 15 分钟、上限 10 次；KV 键 `auth:rate:<clientIp>:<floor(now/15min)>`，
 *   `expirationTtl = 900`；IP 只取平台注入的可信值 `Env.trustedClientIp`
 *   （Cloudflare 是 `CF-Connecting-IP`，Makers 是 `request.eo.clientIp`），
 *   业务层绝不读客户端可伪造的请求头。
 * - 口令与会话密钥只从运行时 env 读，绝不硬编码。
 */
import type { Env } from './types';

const encoder = new TextEncoder();

// 保留 Cloudflare/旧站 Cookie 契约。同 Host 下两端共享此槽位并互相覆盖；
// 每端仍只接受本站密钥，切线重登。客户端不得把 401 自动转成 logout 写 Cookie。
export const COOKIE_NAME = 'detail_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stringToBase64Url(value: string): string {
    return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToString(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return atob(padded);
}

/** 常量时间字符串比较（长度不同也走满 maxLength 次循环）。 */
function safeEqual(left: string, right: string): boolean {
    const maxLength = Math.max(left.length, right.length);
    let mismatch = left.length === right.length ? 0 : 1;

    for (let index = 0; index < maxLength; index += 1) {
        const leftCode = index < left.length ? left.charCodeAt(index) : 0;
        const rightCode = index < right.length ? right.charCodeAt(index) : 0;
        mismatch |= leftCode ^ rightCode;
    }

    return mismatch === 0;
}

async function signValue(secret: string, value: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
    return bytesToBase64Url(new Uint8Array(signature));
}

/** 解析 Cookie 头为 name -> value；同名后者覆盖前者（与旧实现一致）。 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) {
        return cookies;
    }

    for (const segment of cookieHeader.split(/;\s*/)) {
        const separatorIndex = segment.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const name = segment.slice(0, separatorIndex);
        const value = segment.slice(separatorIndex + 1);
        cookies[name] = value;
    }

    return cookies;
}

/** 签发会话令牌（exp = 现在 + 12h）。 */
export async function createSessionToken(secret: string): Promise<string> {
    const payload = {
        exp: Date.now() + SESSION_TTL_MS
    };
    const encodedPayload = stringToBase64Url(JSON.stringify(payload));
    const signature = await signValue(secret, encodedPayload);
    return `${encodedPayload}.${signature}`;
}

/** 校验会话令牌；签名不符 / 载荷坏 / 过期都返回 null。 */
export async function verifySessionToken(
    secret: string,
    token: string | null | undefined
): Promise<{ exp: number } | null> {
    if (!token || !token.includes('.')) {
        return null;
    }

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = await signValue(secret, encodedPayload);
    if (!safeEqual(signature, expectedSignature)) {
        return null;
    }

    let payload: unknown;
    try {
        payload = JSON.parse(base64UrlToString(encodedPayload));
    } catch (_error) {
        return null;
    }

    if (
        !payload ||
        typeof payload !== 'object' ||
        typeof (payload as { exp?: unknown }).exp !== 'number' ||
        (payload as { exp: number }).exp <= Date.now()
    ) {
        return null;
    }

    return payload as { exp: number };
}

/** 请求是否带有效会话 Cookie。 */
export async function hasValidSession(request: Request, secret: string): Promise<boolean> {
    const cookies = parseCookies(request.headers.get('Cookie'));
    return Boolean(await verifySessionToken(secret, cookies[COOKIE_NAME]));
}

export function buildSessionCookie(token: string): string {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearedSessionCookie(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getRateLimitKey(ipAddress: string, bucket: number): string {
    return `auth:rate:${ipAddress}:${bucket}`;
}

function currentRateLimitBucket(): number {
    return Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
}

/**
 * isolate 内滑窗计数（复核裁定 #1）。
 *
 * 为什么必须要有它：KV 的「读 → +1 → 写」不是原子的，同一 isolate 的并发请求会全部
 * 读到同一个旧值再各自写回，于是并发爆破可以绕过上限。这里在判定点先做一次**同步**
 * 占位（中间没有 await，所以同 isolate 的并发请求必然拿到互不相同的序号），KV 只作为
 * 跨 isolate 的近似共享，判定取值见 `reserveAttempt`（max(本 isolate 序号, 观察值 + 1)）。
 *
 * 残留（没有新基础设施时无法消除，已复核接受）：Cloudflare KV 是最终一致的，且每个
 * colo/isolate 各持一份计数器，因此**跨 colo 的并发爆破仍可能超过上限**。彻底解决需要
 * Durable Object / Rate Limiting binding / 原子自增存储，本分支有意不做。
 *
 * bucket 变化时整表重置，所以条目数按窗口有界（每个 IP 一条）。
 */
let localRateWindowBucket = -1;
const localRateCounts = new Map<string, number>();

/**
 * isolate 内计数表的容量上限（每个 IP 一条，逐个窗口重置）。
 *
 * 为什么要有：清空只发生在「窗口切换」时，因此一个窗口内被大量不同源 IP 命中时这张表会
 * 无界增长（每条约百字节，128 MB 的 isolate 在百万级条目上会被拖垮）。达到上限时整表清空：
 * 宁可让就近计数暂时退化回 KV 近似（只会更松，不会更严，也不会误封），也不能让登录端点
 * 变成内存放大器。真实的大规模源 IP 攻击属于平台层（Cloudflare DDoS / Rate Limiting）。
 */
const LOCAL_RATE_MAX_ENTRIES = 10000;

function readLocalRateCount(key: string, bucket: number): number {
    if (localRateWindowBucket !== bucket) {
        localRateWindowBucket = bucket;
        localRateCounts.clear();
    }

    return localRateCounts.get(key) ?? 0;
}

/** 占位写入前先封顶：超限就整表清空（见 LOCAL_RATE_MAX_ENTRIES）。 */
function claimLocalRateSlot(key: string, bucket: number): number {
    if (!localRateCounts.has(key) && localRateCounts.size >= LOCAL_RATE_MAX_ENTRIES) {
        localRateCounts.clear();
    }

    const claimed = readLocalRateCount(key, bucket) + 1;
    localRateCounts.set(key, claimed);
    return claimed;
}

/** 只上调、不上调低：并发请求各自写回时不能把别人的序号抹掉。 */
function publishLocalRateCount(key: string, bucket: number, count: number): void {
    const current = readLocalRateCount(key, bucket);
    localRateCounts.set(key, Math.max(current, count));
}

/** 一次尝试在限流窗口里的状态：`key` 是 KV 键，`count` 含本次尝试。 */
export interface RateLimitState {
    key: string;
    bucket: number;
    count: number;
}

/**
 * 预约一次尝试：先同步占用 isolate 内序号（这里没有 await，所以同 isolate 的并发请求
 * 必然拿到互不相同的序号），再读 KV 观察值，取 max(本 isolate 序号, 观察值 + 1)。
 * `+1` 是本次尝试本身 —— 它还没写进 KV。观察值可能落后（本 isolate 的写还在路上），
 * 也可能领先（别的 isolate 已经记过）；两种都取较大者。乱序完成时观察值甚至可能已经包含
 * 「后占位但先写回」的请求，于是计数比真实序号更严 —— 只会早拦，不会放过。
 *
 * 计数含本次尝试，所以「第 11 次被拒」的判定是 `count > RATE_LIMIT_MAX_ATTEMPTS`。
 * IP 只来自平台注入的 `env.trustedClientIp`，不读客户端可伪造的请求头。
 */
export async function reserveAttempt(env: Env): Promise<RateLimitState> {
    const bucket = currentRateLimitBucket();
    const key = getRateLimitKey(env.trustedClientIp, bucket);
    const claimed = claimLocalRateSlot(key, bucket);

    const observed = Number.parseInt((await env.CLASS_MAP_DATA.get(key)) || '0', 10) || 0;
    const count = Math.max(claimed, observed + 1);
    publishLocalRateCount(key, bucket, count);

    return { key, bucket, count };
}

/** 把已占位的计数写回 KV（TTL 一个窗口）。 */
export async function recordFailedAttempt(env: Env, state: RateLimitState): Promise<void> {
    await env.CLASS_MAP_DATA.put(state.key, String(state.count), {
        expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    });
}

/** 登录成功后清空当前窗口的失败计数（isolate 内与 KV 都清）。 */
export async function clearFailedAttempts(env: Env, state: RateLimitState): Promise<void> {
    readLocalRateCount(state.key, state.bucket);
    localRateCounts.set(state.key, 0);
    await env.CLASS_MAP_DATA.delete(state.key);
}

/** 口令比对（常量时间）。 */
export function constantTimeCompare(left: unknown, right: unknown): boolean {
    return safeEqual(String(left), String(right));
}

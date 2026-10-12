/**
 * 会话签名 / Cookie / 口令限流（迁移自 functions/_lib/auth.mjs，逐字段等价）。
 *
 * 契约（docs/migration-parity.md §1.2）：
 * - 令牌 = `base64url(JSON.stringify({ exp })) + "." + base64url(HMAC-SHA256(secret, encodedPayload))`，
 *   全程 WebCrypto（crypto.subtle），不引入 node:crypto。
 * - Cookie `detail_session`：`Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`。
 * - 限流窗口 15 分钟、上限 10 次；KV 键 `auth:rate:<clientIp>:<floor(now/15min)>`，
 *   `expirationTtl = 900`；IP 取 `CF-Connecting-IP`，缺失记 `'unknown'`。
 * - 口令与会话密钥只从运行时 env 读，绝不硬编码。
 */
import type { Env } from './types';

const encoder = new TextEncoder();

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

export function getClientIp(request: Request): string {
    return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function getRateLimitKey(ipAddress: string): string {
    const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    return `auth:rate:${ipAddress}:${bucket}`;
}

/** 读当前窗口的失败次数（键按 IP + 15 分钟桶）。 */
export async function getRateLimitCount(
    env: Env,
    request: Request
): Promise<{ key: string; count: number }> {
    const key = getRateLimitKey(getClientIp(request));
    const count = await env.CLASS_MAP_DATA.get(key);
    return {
        key,
        count: Number.parseInt(count || '0', 10) || 0
    };
}

/** 记一次失败（+1，TTL 一个窗口）。 */
export async function recordFailedAttempt(env: Env, request: Request): Promise<void> {
    const { key, count } = await getRateLimitCount(env, request);
    await env.CLASS_MAP_DATA.put(key, String(count + 1), {
        expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    });
}

/** 登录成功后清空当前窗口的失败计数。 */
export async function clearFailedAttempts(env: Env, request: Request): Promise<void> {
    const { key } = await getRateLimitCount(env, request);
    await env.CLASS_MAP_DATA.delete(key);
}

/** 口令比对（常量时间）。 */
export function constantTimeCompare(left: unknown, right: unknown): boolean {
    return safeEqual(String(left), String(right));
}

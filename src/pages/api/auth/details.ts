/**
 * POST /api/auth/details —— 口令校验、限流、签发会话 Cookie
 * （迁移自 functions/api/auth/details.js）。
 * 动态路由：不要加 `prerender = true`。
 *
 * 等价要点（docs/migration-parity.md §1.2）：先查限流后比对口令；
 * 失败计数 +1；成功后清空计数；remainingAttempts = max(0, 10 - count - 1)。
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
    RATE_LIMIT_MAX_ATTEMPTS,
    buildSessionCookie,
    clearFailedAttempts,
    constantTimeCompare,
    createSessionToken,
    getRateLimitCount,
    recordFailedAttempt
} from '@/lib/auth';
import { errorResponse, jsonResponse } from '@/lib/http';

/**
 * 取出 body 里的口令；旧实现是 `typeof body?.passphrase === 'string' ? body.passphrase : ''`，
 * 对 body 为 null/数组/标量时都退化为空串（非字符串一律当没传）。
 */
function readPassphrase(body: unknown): string {
    if (typeof body !== 'object' || body === null || !('passphrase' in body)) {
        return '';
    }

    const value = (body as { passphrase?: unknown }).passphrase;
    return typeof value === 'string' ? value : '';
}

export const POST: APIRoute = async ({ request }) => {
    if (!env.DETAILS_PASSPHRASE || !env.DETAILS_SESSION_SECRET) {
        return errorResponse(503, 'detail_auth_not_configured', '暂时无法查看详情，请稍后再试。');
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch (_error) {
        return errorResponse(400, 'invalid_request_body', '请求有误，请重试。');
    }

    const passphrase = readPassphrase(body);
    if (!passphrase) {
        return errorResponse(400, 'passphrase_required', '请输入口令。');
    }

    const rateLimit = await getRateLimitCount(env, request);
    if (rateLimit.count >= RATE_LIMIT_MAX_ATTEMPTS) {
        return errorResponse(429, 'too_many_attempts', '尝试次数太多，请 15 分钟后再试。');
    }

    if (!constantTimeCompare(passphrase, env.DETAILS_PASSPHRASE)) {
        await recordFailedAttempt(env, request);
        return errorResponse(401, 'invalid_passphrase', '口令不对，请重试。', {
            remainingAttempts: Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - rateLimit.count - 1)
        });
    }

    await clearFailedAttempts(env, request);
    const token = await createSessionToken(env.DETAILS_SESSION_SECRET);

    return jsonResponse(
        {
            authenticated: true
        },
        {
            headers: {
                'Set-Cookie': buildSessionCookie(token)
            }
        }
    );
};

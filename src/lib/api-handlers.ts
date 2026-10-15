/** 两平台共享业务处理器；Origin/方法保护由平台路由层负责。 */
import type { Env } from './types';
import { RATE_LIMIT_MAX_ATTEMPTS, buildSessionCookie, buildClearedSessionCookie,
    clearFailedAttempts, constantTimeCompare, createSessionToken, getRateLimitCount,
    recordFailedAttempt, hasValidSession } from './auth';
import { buildDetailsPayload, normalizeRegionQuery, loadPublicDataset } from './data';
import type { NormalizedRegion } from './data';
import { errorResponse, jsonResponse } from './http';

function readPassphrase(body: unknown): string {
    if (typeof body !== 'object' || body === null || !('passphrase' in body)) {
        return '';
    }

    const value = (body as { passphrase?: unknown }).passphrase;
    return typeof value === 'string' ? value : '';
}



export async function login(request: Request, env: Env): Promise<Response> {
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
}

export function logout(_request: Request, _env: Env): Response {
    return jsonResponse(
        {
            authenticated: false
        },
        {
            headers: {
                'Set-Cookie': buildClearedSessionCookie()
            }
        }
    );
}

export async function publicMap(request: Request, env: Env): Promise<Response> {
    try {
        const dataset = await loadPublicDataset(env);
        const detailAccess = env.DETAILS_SESSION_SECRET
            ? await hasValidSession(request, env.DETAILS_SESSION_SECRET)
            : false;

        return jsonResponse(
            {
                ...dataset,
                detailAccess,
                detailModeAvailable: Boolean(env.DETAILS_PASSPHRASE && env.DETAILS_SESSION_SECRET),
                detailsHint: env.DETAILS_HINT || ''
            },
            {
                headers: {
                    Vary: 'Cookie',
                    ...(env.DATA_RELEASE_ID ? { 'X-Data-Release': env.DATA_RELEASE_ID } : {})
                }
            }
        );
    } catch (error) {
        console.error('Public map storage unavailable.');
        return errorResponse(
            503,
            'public_data_unavailable',
            '地图数据还没准备好，请稍后再试。', {}, { headers: { Vary: 'Cookie' } }
        );
    }
}

export async function detailsMap(request: Request, env: Env): Promise<Response> {
    if (!env.DETAILS_SESSION_SECRET) {
        return errorResponse(503, 'detail_auth_not_configured', '暂时无法查看详情，请稍后再试。');
    }

    const detailAccess = await hasValidSession(request, env.DETAILS_SESSION_SECRET);
    if (!detailAccess) {
        return errorResponse(401, 'detail_auth_required', '请先输入口令。');
    }

    const url = new URL(request.url);
    const province = url.searchParams.get('province');
    const city = url.searchParams.get('city');

    if (!province) {
        return errorResponse(400, 'province_required', '缺少地区信息，请重新选择。');
    }

    let region: NormalizedRegion;
    try {
        region = normalizeRegionQuery({ province, city });
    } catch (error) {
        // 校验信息本身就是给用户看的中文提示，可以原样返回。
        return errorResponse(
            400,
            'invalid_region_query',
            error instanceof Error ? error.message : String(error)
        );
    }

    try {
        return jsonResponse(await buildDetailsPayload(env, region), { headers: env.DATA_RELEASE_ID ? { 'X-Data-Release': env.DATA_RELEASE_ID } : {} });
    } catch (error) {
        // 能走到这里说明 KV 读不到或数据没配好，属于服务端问题：
        // 不要把内部错误信息透给前端，也不要冒充 400。
        console.error('Detail map storage unavailable.');
        return errorResponse(503, 'detail_data_unavailable', '这个地区暂时打不开，请稍后再试。');
    }
}

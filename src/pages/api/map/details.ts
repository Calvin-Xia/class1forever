/**
 * GET /api/map/details —— 按地区返回明细，必须有有效会话
 * （迁移自 functions/api/map/details.js）。
 * 动态路由：不要加 `prerender = true`。
 *
 * 等价要点（docs/migration-parity.md §1.3）：鉴权优先级在参数校验之前；
 * 参数问题一律 400 且回显校验消息，KV/数据问题一律 503 且不透内部信息。
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hasValidSession } from '@/lib/auth';
import { buildDetailsPayload, normalizeRegionQuery } from '@/lib/data';
import { errorResponse, jsonResponse } from '@/lib/http';
import type { NormalizedRegion } from '@/lib/data';

export const GET: APIRoute = async ({ request }) => {
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
        return jsonResponse(await buildDetailsPayload(env, region));
    } catch (error) {
        // 能走到这里说明 KV 读不到或数据没配好，属于服务端问题：
        // 不要把内部错误信息透给前端，也不要冒充 400。
        console.error('Failed to load detail map data:', error);
        return errorResponse(503, 'detail_data_unavailable', '这个地区暂时打不开，请稍后再试。');
    }
};

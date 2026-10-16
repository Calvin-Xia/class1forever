import { buildDetailsPayload, normalizeRegionQuery } from '../../_lib/data.mjs';
import { hasValidSession } from '../../_lib/auth.mjs';
import { errorResponse, jsonResponse } from '../../_lib/http.mjs';

export const onRequestGet = async ({ env, request }) => {
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

    let region;
    try {
        region = normalizeRegionQuery({ province, city });
    } catch (error) {
        // 校验信息本身就是给用户看的中文提示，可以原样返回。
        return errorResponse(400, 'invalid_region_query', error.message);
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



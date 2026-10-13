/**
 * GET /api/map/public —— 公开聚合 + 三个开关字段（迁移自 functions/api/map/public.js）。
 * 动态路由：不要加 `prerender = true`（响应随 Cookie 变化）。
 *
 * 等价要点（docs/migration-parity.md §1.1）：KV 读不到时 503 public_data_unavailable；
 * 响应额外带 `Vary: Cookie`，因为 detailAccess 随会话翻转。
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hasValidSession } from '@/lib/auth';
import { loadPublicDataset } from '@/lib/data';
import { errorResponse, jsonResponse } from '@/lib/http';

export const GET: APIRoute = async ({ request }) => {
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
                    Vary: 'Cookie'
                }
            }
        );
    } catch (error) {
        console.error('Failed to load public map dataset:', error);
        return errorResponse(
            503,
            'public_data_unavailable',
            '地图数据还没准备好，请稍后再试。'
        );
    }
};

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicMap } from '../../../lib/api-handlers';
import { errorResponse } from '../../../lib/http';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const GET: APIRoute = ({ request }) => publicMap(request, cloudflareEnvironment(env, request));

// 复核裁定 #6：方法不匹配统一为 405 + Allow，与 EdgeOne 适配器 edgeoneApi 的判定一致。
// Astro 只会在这个路由没有对应方法处理器时调用 ALL（HEAD 仍走 GET）。
export const ALL: APIRoute = () =>
    errorResponse(405, 'method_not_allowed', '请求方法有误。', {}, { headers: { Allow: 'GET, HEAD' } });

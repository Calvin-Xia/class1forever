import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { login } from '../../../lib/api-handlers';
import { errorResponse } from '../../../lib/http';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const POST: APIRoute = ({ request }) => login(request, cloudflareEnvironment(env, request));

// 复核裁定 #6：方法不匹配统一为 405 + Allow，与 EdgeOne 适配器 edgeoneApi 的判定一致。
export const ALL: APIRoute = () =>
    errorResponse(405, 'method_not_allowed', '请求方法有误。', {}, { headers: { Allow: 'POST' } });

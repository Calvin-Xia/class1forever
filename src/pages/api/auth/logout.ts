/**
 * POST /api/auth/logout —— 清除会话 Cookie（迁移自 functions/api/auth/logout.js）。
 * 动态路由：不要加 `prerender = true`。
 *
 * 等价要点（docs/migration-parity.md §1.4）：不读 KV、不读 env、不需要会话，恒 200；
 * 清 Cookie 靠 `Max-Age=0`（会话是无状态签名令牌，服务端不留状态）。
 */
import type { APIRoute } from 'astro';
import { buildClearedSessionCookie } from '@/lib/auth';
import { jsonResponse } from '@/lib/http';

export const POST: APIRoute = () => {
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
};

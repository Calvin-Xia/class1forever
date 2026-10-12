/**
 * 站点级请求中间件：给 Worker 渲染的文档响应补上安全响应头。
 *
 * 背景与等价性论证见 `src/lib/security-headers.ts`：Workers Assets 下 `_headers` 只管
 * 静态资产，`/` 这类由 Astro 渲染的 HTML 会丢掉 CSP / nosniff / referrer /
 * x-frame-options / permissions-policy，旧站 Pages 形态下这些头是覆盖文档响应的。
 *
 * 只管文档（`text/html`）：API 的 JSON 响应沿用 docs/migration-parity.md §1 的头部契约，
 * 静态资产继续由 `public/_headers` 施加同一条头部集合。
 */
import { defineMiddleware } from 'astro:middleware';
import { withDocumentSecurityHeaders } from '@/lib/security-headers';

export const onRequest = defineMiddleware(async (_context, next) => {
    return withDocumentSecurityHeaders(await next());
});

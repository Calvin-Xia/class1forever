/**
 * Worker 渲染的**文档响应**要补的安全响应头（迁移自站点根的 `_headers` / `public/_headers`）。
 *
 * 为什么需要这层：旧站是 Cloudflare Pages，`_headers` 会作用在文档响应（`/` → index.html 是
 * 静态资产）上；迁到 Worker + Workers Assets 后，`_headers` 只作用于 ASSETS 绑定提供的
 * 静态文件，`src/pages/index.astro` 渲染出来的 HTML 拿不到任何安全头 —— 这是相对旧站的
 * 安全回归。这里把同样的头部集合附加到所有 `text/html` 响应上。
 *
 * 契约与验收（节点 DoD）：
 * - 五条头部与 `public/_headers` 逐条等价，CSP 逐字相同；
 * - `curl -I /` 的头部集合必须与 `curl -I /favicon.svg` 的集合一致；
 * - JSON / 静态资产响应不改：旧站 Pages Functions 的 `/api/*` 响应本来就没有这些头
 *   （`_headers` 不覆盖 Functions 响应），加了反而偏离 parity 契约 docs/migration-parity.md §1。
 *
 * 注意：`public/_headers` 与本表是两处声明，改一处必须同步另一处（静态资产走 `_headers`，
 * 文档响应走这里）。
 */

/** 与 `public/_headers` 的 `/*` 段落逐条对应的头部表（顺序也保持一致）。 */
export const DOCUMENT_SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['X-Frame-Options', 'DENY'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
    [
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    ]
];

/** 只有文档响应（HTML）需要补安全头；资产与 JSON API 保持原样。 */
export function isDocumentResponse(response: Response): boolean {
    return (response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('text/html');
}

/**
 * 给文档响应补上安全头；已有同名头部时保留原值（不覆盖上游显式设置）。
 * 返回新的 Response（保留状态码、状态文本与流式主体），非文档响应原样返回。
 */
export function withDocumentSecurityHeaders(response: Response): Response {
    if (!isDocumentResponse(response)) {
        return response;
    }

    const headers = new Headers(response.headers);
    let changed = false;
    if (!headers.has('Cache-Control')) {
        headers.set('Cache-Control', 'no-cache');
        changed = true;
    }
    for (const [name, value] of DOCUMENT_SECURITY_HEADERS) {
        if (!headers.has(name)) {
            headers.set(name, value);
            changed = true;
        }
    }

    if (!changed) {
        return response;
    }

    // 204/304 不允许带主体，重建 Response 会抛错；这两类也没有文档主体，直接跳过。
    if (response.status === 204 || response.status === 304) {
        return response;
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

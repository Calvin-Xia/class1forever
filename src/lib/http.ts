/**
 * JSON 响应助手（迁移自 functions/_lib/http.mjs，逐字段等价）。
 *
 * 契约（docs/migration-parity.md §1「公共响应头」）：
 * - `Content-Type: application/json; charset=utf-8`（调用方未显式覆盖时）
 * - `Cache-Control: no-store`（调用方未显式覆盖时）
 * - 错误体形状 `{ error, message, ...extras }`
 */

/** 构造 JSON 响应；未显式给出的头部按契约补默认值。 */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json; charset=utf-8');
    }
    if (!headers.has('Cache-Control')) {
        headers.set('Cache-Control', 'no-store');
    }

    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers
    });
}

/** 构造错误响应：`{ error, message, ...extras }`。 */
export function errorResponse(
    status: number,
    code: string,
    message: string,
    extras: Record<string, unknown> = {},
    init: ResponseInit = {}
): Response {
    return jsonResponse(
        {
            error: code,
            message,
            ...extras
        },
        {
            status,
            headers: init.headers
        }
    );
}

/**
 * 抽屉/口令流程要用的两个网络动作（从 `js/map.js` 的 `fetchJson` +
 * `fetchRegionDetails` + `normalizeApiErrorMessage` 迁移）。
 *
 * 为什么这里另起一份 `fetchJson` 而不是从 `map-island.ts` 引入：那份是**私有**函数
 * （未导出），而 `map-island.ts` 对本节点只读（派单边界）。两份实现都遵守同一份契约
 * —— `credentials: 'same-origin'`、非 2xx 时抛出带 `status` 与 `payload` 的 Error，
 * 让调用方能按 `error.status === 401` 分流（会话过期 → 重新要口令）。
 */
import type { DetailsPayload, ErrorPayload } from './types';
import type { Region } from './map-model';

export interface ApiError extends Error {
    status?: number;
    payload?: ErrorPayload | null;
}

export function normalizeApiErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
        const payload = (error as { payload?: { message?: unknown } }).payload;
        if (payload && typeof payload.message === 'string' && payload.message) {
            return payload.message;
        }
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message) {
            return message;
        }
    }
    return fallback;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const requestInit: RequestInit = Object.assign({ credentials: 'same-origin' as const }, init || {});
    const response = await fetch(url, requestInit);
    let payload: unknown = null;

    try {
        payload = await response.json();
    } catch (_error) {
        payload = null;
    }

    if (!response.ok) {
        const message =
            payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
                ? String((payload as { message: unknown }).message)
                : `Request failed with status ${response.status}`;
        const error: ApiError = new Error(message);
        error.status = response.status;
        error.payload = payload as ErrorPayload | null;
        throw error;
    }

    return payload as T;
}

/** 详情缓存的键：省级用 `省::*`，城市用 `省::市`（与旧站 `getRegionKey` 一致）。 */
export function regionCacheKey(region: Region): string {
    return region.city ? `${region.province}::${region.city}` : `${region.province}::*`;
}

/** `GET /api/map/details`：按地区取明细。401 由调用方分流成「重新输入口令」。 */
export async function fetchRegionDetails(region: Region): Promise<DetailsPayload> {
    if (!region.province) {
        throw new Error('这个地区暂时打不开，请重新点一次。');
    }

    const params = new URLSearchParams({ province: region.province });
    if (region.city) {
        params.set('city', region.city);
    }

    return fetchJson<DetailsPayload>(`/api/map/details?${params.toString()}`);
}

/** `POST /api/auth/details`：校验口令并建立会话（Cookie 由服务端下发）。 */
export async function postPassphrase(passphrase: string): Promise<void> {
    await fetchJson<{ authenticated: boolean }>('/api/auth/details', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ passphrase: passphrase })
    });
}

/** `POST /api/auth/logout`：清除会话 Cookie（无状态签名令牌，服务端只负责清 Cookie）。 */
export async function postLogout(): Promise<void> {
    await fetchJson<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' });
}

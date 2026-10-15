import type { Env } from '../lib/types';

export function cloudflareEnvironment(bindings: Cloudflare.Env, request: Request): Env {
    const release = (bindings as Cloudflare.Env & { DATA_RELEASE_ID?: string }).DATA_RELEASE_ID;
    return { ...bindings, DATA_RELEASE_ID: release,
        trustedClientIp: request.headers.get('CF-Connecting-IP') || 'unknown' };
}

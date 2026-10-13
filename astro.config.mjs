// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

/**
 * 迁移目标（ADR-0001）：Astro 6 SSR 全站挂 Cloudflare Worker。
 *
 * - output: 'server' —— 全部页面按需渲染；确需静态输出的单条路由用
 *   `export const prerender = true` 单独打开。
 * - 适配器统一入口交给 wrangler.jsonc 的 `main`：
 *   "@astrojs/cloudflare/entrypoints/server"（不再是 dist/_worker.js/index.js）。
 * - 静态资产由 Workers Assets 的 ASSETS 绑定提供，目录为 ./dist。
 *
 * 本地开发两条路径（不要混用）：
 * - `npm run dev` = astro dev：Astro 开发服务器，绑定走本地模拟，KV 是本地数据；
 * - `npm run cf:dev` = wrangler dev：Worker 运行时，wrangler.jsonc 里 KV 的 `remote: true`
 *   生效 → 连远端 KV，需要 Cloudflare 凭据；`npm run preview` 会先 `npm run build` 再起它。
 * 改动 wrangler.jsonc 的绑定后，请重跑 `npm run cf:types`（= `wrangler types`）刷新
 * 仓库根目录的 worker-configuration.d.ts，否则类型会与绑定漂移。
 */
export default defineConfig({
    output: 'server',
    // 构建/本地开发不建立远端绑定连接：CI 与本地都不应要求 Cloudflare 凭据。
    // wrangler.jsonc 里 KV 的 `remote: true` 仍对 `wrangler dev` 生效（与迁移前一致）。
    adapter: cloudflare({ remoteBindings: false }),
    integrations: [react()],
    typescript: {
        // 只做类型检查，不产出声明文件（构建产物由 Astro 负责）。
        checkJs: false
    }
});

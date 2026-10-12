# 0001 — 采用 Astro SSR 全站挂 Cloudflare Worker

新站使用 Astro 6 + @astrojs/cloudflare 适配器（output:'server'），全部请求经 Worker 处理，静态资产由 Workers Assets 的 ASSETS 绑定提供；不采用静态 Astro + 仅 /api/* 挂 Worker 的形态。

**Status：** accepted（2026-10-13 用户 accept）

**Context：** 现站是 Pages Functions + 纯静态页面，动态面只有四个 API 路由；迁移要在等价前提下换技术栈，并决定 Worker 承担多少。

**Considered Options：** 静态 Astro + 独立 Worker 只挂 /api/*（改动面最小、API 逻辑近原样保留、静态资产走边缘缓存，代价是双入口与两套配置语义长期并存）; Astro SSR 全站挂 Worker（单一路径、与官方部署形态一致、未来可加服务端页面，代价是每个请求都过 Worker）

**Why：** 用户拍板选 SSR 全站挂 Worker；单一路径便于后续加服务端能力，官方适配器已把 Worker 与资产绑定收敛为一个入口。

**Consequences：** 所有页面渲染都在 Worker 上，需自行负责缓存策略；本地开发依赖 wrangler 运行时而非纯静态服务器。

> 本文由 `graph export` 从图顶点 adr_0001 生成；改图不改文，重新导出即覆盖。

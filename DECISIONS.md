# DECISIONS

> 决议一行索引（由 `graph export` 从图顶点生成）：passed 的 task 节点 + accepted/superseded 的 ADR。
> 图为真相源，本文件是视图；改图不改文，重新导出即覆盖。

| 决议 | id | 标题 | 结论时间 |
|------|----|------|---------|
| ADR · accepted | adr_0001 | 采用 Astro SSR 全站挂 Cloudflare Worker | 2026-10-12T16:45:34.925Z |
| ADR · accepted | adr_0002 | ECharts 直接作为打包依赖，退役自建 vendor 产物 | 2026-10-12T16:45:35.426Z |
| ADR · accepted | adr_0003 | geo 生成文件零改动，只替换注册与加载层 | 2026-10-12T16:45:35.833Z |
| ADR · accepted | adr_0004 | 岛屿水合走外链脚本 + createRoot，禁用 client:*，不放宽 script-src 'self' | 2026-10-12T16:45:36.251Z |
| task · passed | l1_api | 四个路由与 _lib 迁移到 Worker 运行时 | 2026-10-12T12:31:23.235Z |
| task · passed | l1_scaffold | Astro SSR 工程与 Worker/Assets 配置就位 | 2026-10-12T11:44:58.220Z |
| task · passed | l1_shell | Astro 页面骨架与静态内容迁移 | 2026-10-12T12:18:44.002Z |
| task · passed | l1_spec | 冻结迁移等价性契约 | 2026-10-12T11:17:45.372Z |
| task · passed | l1_test | 本地测试通路与 CI 门禁骨架 | 2026-10-12T12:19:48.711Z |
| task · passed | l2_contract_rev | 等价性契约与项目文档对齐修订 | 2026-10-12T12:31:24.046Z |
| task · passed | l2_dialogs | 交互部件岛屿化与可达性 | 2026-10-12T13:50:16.014Z |
| task · passed | l2_island_contract_fix | 跨岛屿契约收口与详情模式下钻修复 | 2026-10-12T14:04:15.401Z |
| task · passed | l2_map | 地图 React 岛屿 | 2026-10-12T13:17:48.411Z |
| task · passed | l2_motion | 动效层迁移 | 2026-10-12T12:53:51.598Z |
| task · passed | l2_share | 分享图与读屏播报迁移 | 2026-10-12T13:45:04.575Z |
| task · passed | l2_visual | 视觉 token 与组件系统重表达 | 2026-10-12T12:31:24.775Z |
| task · passed | l3_gates | 构建与静态安全门禁收口 | 2026-10-12T14:57:52.361Z |
| task · passed | l3_parity | 等价性验收：旧清单在新站复跑 | 2026-10-12T15:28:54.645Z |
| task · passed | l3_typecheck_fix | 类型检查清零（motion.ts / share-card.ts） | 2026-10-12T14:53:27.888Z |
| task · passed | l3_verify | 三层验收与交叉复核 | 2026-10-12T15:59:17.603Z |

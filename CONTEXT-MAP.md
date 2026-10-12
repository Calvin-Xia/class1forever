# Context Map

> 本仓库有 3 个 bounded context（由 `graph export` 从图生成）。
> 术语表详情见各 context 文件；图为真相源，本文件是视图。

| Context | 边界 | 术语数 | 文档 |
|---------|------|--------|------|
| ctx_delivery（验收与交付面） | 负责等价性契约、构建与安全门禁、三层验收与切换包；不负责实现（发现缺陷回到实现节点修复） | 0 | docs/contexts/ctx_delivery.md |
| ctx_runtime（运行时与 API 面） | 负责 Astro/Workers 运行时、四个 API 路由、KV 绑定与本地测试/CI 通路；不负责浏览器端组件与视觉（经契约边由 ctx_ui 消费） | 0 | docs/contexts/ctx_runtime.md |
| ctx_ui（前端组件与交互面） | 负责页面骨架、视觉 token、动效、地图与交互岛屿；不负责服务端路由与部署配置（经契约边由 ctx_runtime 提供） | 0 | docs/contexts/ctx_ui.md |

# 0002 — ECharts 直接作为打包依赖，退役自建 vendor 产物

ECharts 由 Astro/Vite 打包链直接从 npm 依赖消费，移除自建树摇 bundle 的提交产物与 CI 同步步骤。

**Status：** accepted

**Context：** 现站用自建脚本从 node_modules/echarts 产出提交入库的树摇 bundle，CI 校验产物与生成器同步；Astro 下 ECharts 由 Vite 打包。

**Considered Options：** 继续提交自建 bundle 并保留同步校验（产物可控可审计，代价是双份打包链路）; 交给 Vite 打包 npm 依赖（少一套自建链路与提交产物，代价是产物不可直接 diff）

**Why：** 迁移目的之一是减少自建链路；Vite 打包已覆盖树摇需求，保留自建产物会形成第二条打包真相源。

**Consequences：** 浏览器产物体积需在构建后核对；升级 ECharts 依赖 lockfile 与产物回归。

> 本文由 `graph export` 从图顶点 adr_0002 生成；改图不改文，重新导出即覆盖。

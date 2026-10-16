# legacy/ —— 迁移前的旧站归档

这里收纳迁移前站点的两样东西，都是从仓库根 `git mv` 过来的**对照资产**，不是运行路径：

- `index.html` —— 旧站入口（根 `index.html` 会被 Vite 的静态中间件先命中，见下）；
- `js/{boot,geo,map,palette,motion,data.template}.js`、`css/main.css`、`functions/**`
  —— 旧站的经典脚本、样式与 Pages Functions 四个路由（2026-10-16 的收口迁移移入）。

## 为什么入口要移

`astro dev`（Vite）会先把仓库根当静态根：根目录存在 `index.html` 时，`GET /` 会被 Vite 的
静态中间件直接命中，**永远走不到 Astro 的 `src/pages/index.astro`**。结果是在 `astro dev` 里
"验证首页"其实验的是旧站页面（指纹：`href="css/main.css"`、`href="favicon.svg"`、`js/boot.js`），
很容易得出错误结论 —— 这条在 `l2_motion` 节点被记为 **F-2**，在 `l4_cutover` 节点处置。

归档（而不是删除）是为了让这份入口可查、可回滚：`legacy/index.html` 与 `main:index.html`
**逐字节相同**（sha256 `babad1aa…78feda`），文件内容一个字没动，只是换了路径。

## 为什么退役实现也移进来

`src/**` + `src/styles/**` 是唯一在跑的站点。旧的 `js/*`（几何数据除外）、`css/main.css` 与
`functions/**` 已经**不参与构建、部署和任何门禁** —— `scripts/check-contrast.js` 读的是
`src/styles/main.css` 与 `src/styles/palette.ts`，`build.js` 的必需文件表只列 `js/china.js` 与
`js/province`，CI 的语法扫描也不再要求 `functions/` 存在。继续留在仓库根，只会让后来者
误以为它们仍在生效（对照 `docs/build-gates.md` 的静态断言 A）。

它们被 `git mv` 进 `legacy/`，**内容零改动**（14 个 blob 与 `HEAD` 逐字节相同，`git status`
显示为 `R`），历史可追溯；要对照旧实现，用 `git show main:<旧路径>` 或下面的完整存档。

## 留在仓库根、不在本归档里的

- `js/china.js`、`js/province/**`：全国/省级 GeoJSON，是**跑着的依赖** ——
  `src/lib/geo-loader.ts` 的 `import.meta.glob('../../js/province/*.js')`、`build.js` 的
  省份白名单门禁、`scripts/check-font-subsets.mjs` 的地理字集都读它们，**不能移动**；
- `js/data.js`：gitignored 的本地学生数据，人工不入库，保持原位以免 `.gitignore` 规则失效；
- `shared/data-model.mjs`、`scripts/**`、`public/**`、`DESIGN.md`：都是现役资产。

## archive 不可运行

`legacy/index.html` 里的相对路径（`js/boot.js`、`css/main.css`、`js/vendor/echarts.min.js`）现在
都指向 `legacy/` 下的旧位置，**直接打开是坏的**；`js/vendor/echarts.min.js` 也已按 ADR-0002 退役，
而且 `legacy/js/geo.js` 依赖的几何文件仍在仓库根的 `js/`，相对路径更不可能自洽。
要跑旧站做对照，用下面两种方式之一：

- 完整存档（`l3_parity` 用的就是它）：`git archive main | tar -x -C <dir>`，
  再配合 `.wrangler/parity/old-site-server.mjs` 起本地替身（该脚本不属于交付物）；
- 只想看某一个文件：`git show main:index.html` / `git show main:js/map.js`。

## 回滚

```bash
# 恢复旧入口（会重新遮蔽 astro dev 的 /）
git mv legacy/index.html index.html

# 恢复退役实现（bash；不建议 —— 会让「哪份在跑」重新变得含糊）
mkdir -p js css
git mv legacy/js/*.js js/ && git mv legacy/css/main.css css/ && git mv legacy/functions functions
```

`build.js` 的 Gate A 有一条断言守着入口位置：仓库根**不得**再出现 `index.html`，
否则 `npm run build` 会失败并提示这行命令。旧实现的回滚没有门禁守着，但把
`js/map.js` 之类放回仓库根会让配置、门禁与文档再次指向两份实现，不建议这么做。

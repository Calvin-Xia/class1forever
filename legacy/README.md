# legacy/ —— 迁移前的旧站入口（归档）

这里只放**一件东西**：迁移前静态站点的入口 `index.html`，从仓库根目录移到此处。

## 为什么要移

`astro dev`（Vite）会先把仓库根当静态根：根目录存在 `index.html` 时，`GET /` 会被 Vite 的
静态中间件直接命中，**永远走不到 Astro 的 `src/pages/index.astro`**。结果是在 `astro dev` 里
"验证首页"其实验的是旧站页面（指纹：`href="css/main.css"`、`href="favicon.svg"`、`js/boot.js`），
很容易得出错误结论 —— 这条在 `l2_motion` 节点被记为 **F-2**，在 `l4_cutover` 节点处置。

归档（而不是删除）是为了让这份入口可查、可回滚：`legacy/index.html` 与 `main:index.html`
**逐字节相同**（sha256 `babad1aa…78feda`），文件内容一个字没动，只是换了路径。

## 它不是可运行页面的完整副本

移动后页面里的相对路径（`js/boot.js`、`css/main.css`、`js/vendor/echarts.min.js`）都指向
`legacy/` 下，**直接打开会是坏的**；而且 `js/vendor/echarts.min.js` 已按 ADR-0002 退役。
要跑旧站做对照，用下面两种方式之一，不要指望 `legacy/index.html` 能独立运行：

- 完整存档（l3_parity 用的就是它）：`git archive main | tar -x -C <dir>`，
  再配合 `.wrangler/parity/old-site-server.mjs` 起本地替身（该脚本不属于交付物）；
- 只想看某一个文件：`git show main:index.html` / `git show main:js/map.js`。

## 旧实现其余部分仍在原地

`js/**`、`css/**`、`functions/**` 保留在仓库根，作为**等价性基线**与视觉对照资产，本节点
不删不改（`js/china.js` / `js/province/**` / `js/palette.js` / `js/map.js` / `js/geo.js` /
`js/motion.js` / `css/**` / `DESIGN.md` 与 `main` 零 diff，见 `docs/cutover-runbook.md` §7）。

## 回滚

```bash
git mv legacy/index.html index.html     # 恢复旧入口（会重新遮蔽 astro dev 的 /）
```

`build.js` 的 Gate A 有一条断言守着这个位置：仓库根**不得**再出现 `index.html`，
否则 `npm run build` 会失败并提示这行命令。

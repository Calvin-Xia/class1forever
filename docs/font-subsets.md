# 完整字符覆盖的字体分片

本地实施日期：2026-10-15。两平台继续使用相同的同源字体资源；不使用外部字体 CDN、Makers Blob 或真实学生数据。

## 实现与边界

完整上游 WOFF2 原字节移到非静态目录 `font-sources/`，源 SHA-256 与上轮一致；完整字库和来源清单都保留。固定 Google Fonts 提交及原始 TTF SHA-256 见 `font-sources/manifest.json`。OFL、版权声明继续随 `public/fonts/` 发布。

分片算法只读取完整字体 cmap：U+3000 之前的字符为 core；其余码点按 Unicode 升序，每 256 个一片。每个分片的 `unicode-range` 精确列出它支持的码点。所有片的 cmap 并集等于完整原字库，片间不重叠；不是按页面当前文字裁字。未被上游字体支持的字符仍走原有系统字体链。

| 字体 | 完整源字节 | 分片数 | 全部分片字节 | Unicode 字符 | 字重范围 |
|---|---:|---:|---:|---:|---|
| Noto Sans SC | 7,782,072 | 116 | 10,002,444 | 30,890 | 100–900 |
| Noto Serif SC | 11,032,420 | 117 | 13,455,208 | 30,928 | 200–900 |
| DM Serif Display | 32,024 | 1，保留原字节 | 32,024 | 333 | 400 |
| 合计 | 18,846,516 | 234 | 23,489,676 | 各族独立计数 | 连续可变轴保留 |

全库文件总量增加 24.64%，原因是各片重复携带字体表、字形闭包和可变信息。减少的是具体页面按需下载的字节数；不将全库总量描述为压缩收益。

每个文件带内容 SHA-256 前 12 位。`/fonts/subsets/*` 只放哈希 WOFF2；DM 保持已有哈希文件名。两端可给这些路径配置一年 immutable 缓存；`manifest.json`、README 和 OFL 不混入该目录。

## 加载和分享 PNG

网页沿用 `font-display: swap` 和原有回退字体链。浏览器按实际文本选择分片，不需要为未知地区或姓名重新构建字体。

地图 canvas 在首次绘制国家/省级地名与图例前加载对应 Sans 字重，防止系统字体测得的宽度被 ECharts 缓存。
分享合成的 `loadShareFonts(stats, heatMax)` 从冻结参数生成完整文字集合：标题、范围、数据日期、所有统计标签和值、空状态、图例和页脚，并按实际绘制字重 `400 / 600 / 700` 触发加载，再等待 `document.fonts.ready`。动态列里的 `%`、`—`、新地区名和空状态文字均包含。

`document.fonts.ready` 只等待已触发的字体加载，不能单独用来触发新的 unicode-range 片；`fonts.check()` 也不是逐字形覆盖证明。此处将浏览器加载检查与离线 cmap/轮廓检查分别验收。分享范围、地图快照、图例最大值和文件名仍在首个 await 前同步冻结。

接口资料：[FontTools subset API](https://fonttools.readthedocs.io/en/latest/subset/index.html)、[FontTools WOFF2](https://fonttools.readthedocs.io/en/latest/ttLib/woff2.html)、[FontFaceSet.load](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load)。

## 可复现生成与检查

站点构建和服务不依赖 Python。仅重新生成和深度核验需要 `requirements-fonts.txt` 固定的 `fontTools[woff] 4.62.1`、`Brotli 1.2.0`。

```text
python -m pip install -r requirements-fonts.txt
python -X utf8 scripts/font-subsets.py generate
python -X utf8 scripts/font-subsets.py verify
python -X utf8 scripts/font-subsets.py reproduce
node scripts/check-font-subsets.mjs
node scripts/check-font-subsets.mjs --assets-root dist/client
node scripts/check-font-subsets.mjs --assets-root dist-edgeone/static
node --test tests/font-subsets.test.mjs
```

`generate` 保留源时间戳，不实例化/收窄可变字重；保留所有布局特性和变体序列。WOFF2 完整源每族只解码一次，分片由相同的内存 SFNT 表生成。`reproduce` 在工作区 `.wrangler/font-rebuild-*` 独立重建，再逐字节比较全部 WOFF2、清单和 CSS；完成后只清理此次临时目录。

`verify` 重新读取字体二进制，检查每片 cmap 与 CSS 范围一致、完整并集、不重叠、UVS 序列、每个编码字符的默认分解轮廓、hmtx/vmtx、完整 gvar deltas、HVAR metrics deltas、fvar 和 avar。轴与完整变换数据保真，使核验覆盖连续字重空间，而不只抽取几个静态字重截图。

Node 门禁不假装解析字形轮廓；它对已通过深度核验的产物绑定文件哈希与完整字符范围，同时检查 CSS 族/字重/range、OFL、文件名哈希、单文件平台限额和额外字体。完整源误放回 `public/` 会失败。

## 本轮已取得的证据

- 原始三套字库 SHA-256 与旧清单一致；没有重新下载或覆盖源字体。
- Node 源资源门禁通过：3 族、234 个文件、23,489,676 字节。
- 当前全部地图几何里的 482 个不同地区名，共 456 个不同字符，在两套 Noto 的分片覆盖范围内；几何文件未改。
- 7 项字体正负例通过：正常产物、WOFF2 字节损坏、缺失字符覆盖、完整源误发布、Unicode 片重叠、字重收窄、缺失 OFL。
- 二进制轮廓/可变数据深核验通过，进程退出码 0：Sans 30,890 字符 / 25 UVS；Serif 30,928 字符 / 25 UVS；DM 333 字符 / 0 UVS。全部 234 个文件的逐字形轮廓、metrics、完整 gvar/HVAR 变化、fvar/avar 和 UVS 比较通过。
- 独立全量字节重建通过，进程退出码 0：234 个 WOFF2、`manifest.json` 和 `fonts.css` 全部与正式产物逐字节相同；临时重建目录已清理。

## 浏览器与 PNG 验收

主线程在字体产物生成后执行真实浏览器集成，需记录 CF Worker 与 EO 本地夹具两条路径：

1. 无缓存首次打开，记录所有字体 URL、状态、Content-Length/实际 encodedBodySize、同源性；对比原完整源的 18,846,516 字节基线。记录页面实际下载量，不能用全库大小替代。
2. 确认 hash 路径的 HTTP `Cache-Control`，并确认无完整源字体、Google Fonts 或外部字体请求。
3. 全国、省级、空状态各一次；检查新地名分片加载、字体加载完成、地名无遮挡和窄屏布局。
4. 实际点击分享按钮取得 PNG，检查标题、范围、数据日期、动态统计/空状态、图例和页脚；故意延迟一个所需字体请求时，PNG 下载必须等待，不先画系统字体。
5. 分享生成期间 Esc 切范围，确认 PNG/文件名/图例仍使用已冻结的范围。重复导出确认没有网络字体新请求。

真实 EdgeOne CDN 缓存/字体回源和公网选路仍属于上线后的平台验收；本地浏览器成功不代替这些证据。

2026-10-15 实际集成结果见 [实施记录](local-continuation-20261015.md)：CF 首屏字体响应体 6,079,496B，比完整源少 67.74%；键盘北京下钻和安徽空状态地名加载正常。已实际下载并读取 CF 北京 PNG 与 EO 全国 PNG。EO 独立 origin 的慢字体夹具逐字体延迟至少 6003ms，分享期间字体 loading/按钮 disabled，最后字体到达后才写入 PNG；全国首屏与首次分享合计 6,155,836B。窄屏实际内容宽度 375px 无横向溢出。原始观察及图片位于忽略的 `output/local-continuation-20261015/`。此轮未重做分享期间 Esc 的故障注入，原冻结参数契约与同步拍照顺序保留。

# 自托管字体

两平台使用同一套同源字体，保留 `DESIGN.md` 规定的字体族和字重。浏览器只请求本站 `/fonts/`，不连接外部字体服务。

## 来源与许可证

官方来源：[Google Fonts 仓库](https://github.com/google/fonts/tree/e9678a5385322c63730122ba464765baad83cfd8/ofl)。固定提交 `e9678a5385322c63730122ba464765baad83cfd8`。

| 字体族 | 官方源文件 | 许可证 |
|---|---|---|
| Noto Sans SC | `ofl/notosanssc/NotoSansSC[wght].ttf` | [notosanssc-OFL.txt](./notosanssc-OFL.txt) |
| Noto Serif SC | `ofl/notoserifsc/NotoSerifSC[wght].ttf` | [notoserifsc-OFL.txt](./notoserifsc-OFL.txt) |
| DM Serif Display | `ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf` | [dmserifdisplay-OFL.txt](./dmserifdisplay-OFL.txt) |

三套字体均保留各自官方 SIL Open Font License 1.1 及版权声明。字体不作为独立商品销售；再分发须继续携带对应许可。

## 完整字集，按需分片

`font-sources/` 保留上轮生成的完整 WOFF2 原字节和固定来源/hash 清单，供离线复现，不随静态站点发布。完整输入共 18,846,516 字节。Noto 两族按 Unicode 排序确定性分片：U+3000 之前的字符组成 core，其余每 256 个字符一片。

不是按 DOM 文本、地名或学生名单裁字；所有分片 cmap 的并集严格等于原始 cmap，并保留变体序列与可变字重。Noto Sans SC 保留 `wght 100–900`，Noto Serif SC 保留 `wght 200–900`，DM Serif Display 保留原始 Regular 400。

`manifest.json` 记录每片字符范围、SHA-256、字节数和原字体轴。`src/styles/fonts.css` 使用 `unicode-range`，让浏览器仅加载实际文本涉及的片；每个 WOFF2 文件名带其内容 SHA-256 前 12 位。`subsets/` 内只放带哈希的字体，可配置一年 immutable 缓存；清单与本说明不使用该缓存策略。

所有分片总字节数会因重复字体表和字形闭包而增加；优化目标是具体页面首次字体下载量，不是全库总大小。完整字集指固定上游字体包含的全部字符，不意味着任意 Unicode 字符都有字形。极罕见的上游未支持字符仍按原有系统字体链回退；无需读取私有数据重建字体。

## 重建、核验与 Canvas

可选离线工具依赖见根目录 `requirements-fonts.txt`，站点构建与服务只使用已生成的资源，不需要 Python。

```text
python -m pip install -r requirements-fonts.txt
python -X utf8 scripts/font-subsets.py generate
python -X utf8 scripts/font-subsets.py verify
python -X utf8 scripts/font-subsets.py reproduce
node scripts/check-font-subsets.mjs
node --test tests/font-subsets.test.mjs
```

Python 核验包括每个编码字符的默认轮廓、metrics、完整 gvar variation deltas、轴和 UVS；Node 门禁核验范围并集、不重叠、资源哈希、许可证、CSS 引用，拒绝将完整源字体意外发布。

Canvas 不会因字体后来到达而重画既有 PNG。`document.fonts.ready` 仅等待已触发的字体加载，需先把实际文字传给 `document.fonts.load(font, text)`。分享合成等待标题、动态范围、日期、完整统计标签/值、空状态、图例和页脚涉及的字体分片后再画字。地图 canvas 则在初始化/省级地名首次绘制前加载所需地名，避免初次的系统字体宽度进入 ECharts 文本缓存。

详见 `docs/font-subsets.md`；浏览器验收仍需分别确认 CF Worker 与 EO 本地夹具路径，不能由离线字形校验替代。

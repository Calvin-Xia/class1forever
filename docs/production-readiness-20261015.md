# 2026-10-15 双端正式发布与大陆分流验收

当前结论：中国大陆线路已按用户追加批准启用，CF 全网默认保留。CF 与 EO 激活同一数据版本；切线过程中发现并修复了跨构建脚本缺失，双方已重新发布。ECS 样本 223/114 返回 EO、8 返回 CF；119 样本仍返回 CF，保留为未闭合的选路观察项。本文取代同日早先“项目 ID 未知”“尚未发布真实数据”“大陆线路未启用”等交接状态；演示项目保持隔离。

## 发布对象与授权

用户分别批准了暂停 EO 全网默认记录、双端暂存真实版本并读回，以及发布代码/配置并激活 `prod_20261015_01`。随后单独批准新增中国大陆 CNAME 并验证；修复期间用户完成华为云 MFA 暂停，修复发布后恢复同一条已授权记录。本次没有 commit/push。

| 对象 | 本次实际状态 |
| --- | --- |
| CF Worker | `class1forever` |
| CF 当前版本 | `7c0a0981-3894-44ce-b746-11faad590b77`，100%，补齐跨端脚本 |
| CF 首次正式发布版本 | `026e930b-3ccc-495d-a95d-75aa1efd3a41`，已被修复版本取代 |
| CF 发布前版本 | `f3041f5b-0045-4a80-a3ce-4e0d8644eecd` |
| EO 正式项目 | `classmap-cn` / `makers-tow3ibjic9wk` |
| EO 当前生产部署 | `dppr4ub1ojyl`，成功，2026-10-15 20:09:28 CST，补齐跨端脚本 |
| EO 首次正式发布 | `dpfzskczd3zr`，成功，2026-10-15 19:52:20 CST，已被修复部署取代 |
| EO 原生产部署 | `dpte8n0fxwq0`；当时未配置正式数据，不作为完整业务回滚目标 |
| EO KV | `classmap_production` / `ns-ahMomZLQCRSJ`，全局绑定 `CLASS_MAP_DATA` |
| 激活版本 | `prod_20261015_01`，44 人 / 13 省 / 18 市 |
| EO 自定义域名 | `map.calvin-xia.cn`，目标 `map.calvin-xia.cn.pages.dnsoe4.com` |

[EO 正式部署列表](https://console.cloud.tencent.com/edgeone/makers/project/makers-tow3ibjic9wk/deployments)中可查看新部署。演示项目 `makers-rul7t33rb81x` / `classmap_preview` 没有接入真实名单。

## 数据、配置与既有资源

本地真实来源只按 TypeScript AST 读取对象字面量，没有执行遗留 JS；原始文件哈希前后相同。只在受保护的仓库外目录生成一次 raw/public 和私有 manifest。公开聚合在暂存前与原 CF 线上逐字段比较一致。

双方写入 `students_raw_prod_20261015_01` 与 `students_public_prod_20261015_01`，再逐端读回原始 UTF-8 字节并比对哈希。名单、私有 manifest、内容哈希和秘密不写入本报告、Git 或静态产物。

CF 设置 `DATA_RELEASE_ID`，保留既有两项 Secrets、数据 KV、SESSION KV、整个 zone 的 7 条 Worker 路由（本站两条）。既有口令经真实 CF 登录核实。EO 私有 `classmap_runtime_config` 保存同一已核验口令、正式版本及独立随机会话密钥；保存后重新打开编辑器读回一致，未在对话或记录中输出内容。

首次 CF 发布候选漏写 `workers_dev` / `preview_urls`，Wrangler 随发布将两个既有入口关闭。发现后按原远端配置恢复为 true，并 API 读回确认；候选文件也显式补入两项。以后发布不能直接拿仅含 map route 的示例候选覆盖远端：须保留本站两条路由、既有 SESSION namespace、两项入口标志以及当前 release 配置。`--keep-vars` 保留未在候选中声明的既有 vars，Secrets 未替换。

## 运行验收

首次发布前 `npm run check:dual` 通过：CF API 19、EO API 19、适配/发布/字体 30、GeoDNS 10、同 Host 会话 1，共 79 测试。Astro 62 文件 0 error/warning/hint，静态安全、运行时与产物扫描通过。首次 CLI 上传包为 `dist-edgeone/.edgeone/`，286 静态文件、4 条 exact API 路由。CF dry-run 与 EO 打包扫描通过。后续修复新增 3 项回归测试并重跑双端产物扫描；没有为静态文件补齐重新执行不相关的全部 API/构建测试。最新 EO 包为 330 静态文件、4 API 路由。

正式发布后，2026-10-15 19:54–19:55 CST 使用新鲜公共 DoH 目标地址，保留真实 map Host/SNI，并正常验证 TLS。每个请求独立连接，避免同 Host 连接池误用另一平台的 socket；响应分别标识 `cloudflare` 和 `edgeone makers`，与两端部署记录相互核对。以下两端均通过：

- 公开 API 为 200，版本头 `X-Data-Release: prod_20261015_01`；公开数据与离线版本（包括生成时间、全部地区聚合）完全一致。
- 匿名详情 401；现有口令登录成功；Cookie 为 HttpOnly / Secure / SameSite=Lax 且不设 Domain。
- 登录后公开状态为已认证；抽取一个有数据省份，人数与排序后的全部地区明细和离线版本完全一致。未将明细打印到日志。
- 退出响应清空 Cookie，移除浏览器 Cookie 后详情 401。无状态旧令牌不会因此服务端撤销，仍按既有有效期处理。
- CF Cookie 在 EO 为 401，EO Cookie 在 CF 为 401，证明独立会话密钥实际生效；切线需要重新登录。
- API `Cache-Control: no-store`，公开响应 `Vary: Cookie`；静态 JS 为 immutable 缓存，文档与静态资源安全头一致。
- 首页 200，包含用户提供的渝ICP备2026000319号、渝公网安备50010102001439号及对应官方查询链接。未将此作为独立备案数据库核验。

19:55 CST 最终 CF 控制面读回：hostname active、SSL active、fallback active；7 条路由映射、两项 Secrets 绑定、数据/SESSION namespace 均保留。

用户随后明确报告“预览链接真实设备已测试成功”。该人工验收未在最新一句中给出具体部署 ID 与操作范围，因此记录为预览真实设备通过，不将其扩大成新正式部署全部移动专项已通过。此前明确的演示手机地图/登录/详情验收仍见 [演示记录](eo-preview-verification-20261015.md)。

## DNS 与下一步

用户授权后，在华为云暂停了错误新增的 EO“全网默认”CNAME（19:25:58 CST）；保留原 CF 默认、NS、CF TXT 与 EO `_dnsauth` CNAME。Google 与 Cloudflare 两个公共解析器最终均只返回 `map-fallback.calvin-xia.cn`。

后续用户单独批准下表第二行，20:01:22 CST 创建成功；验收发现跨端脚本问题后，用户完成 MFA，20:06:51 暂停；双端修复发布后 20:12:06 恢复正常。不得恢复 EO“全网默认”记录造成两个默认目标混用。

| 子区主机 | 线路 | 类型 | 目标 | 当前状态 |
| --- | --- | --- | --- | --- |
| `@` | 全网默认 | CNAME | `map-fallback.calvin-xia.cn` | 正常保留 |
| `@` | 中国大陆 | CNAME | `map.calvin-xia.cn.pages.dnsoe4.com` | 正常，TTL 300 |

切线后以 Google DoH ECS 分别查询 map Host 的 CNAME 和 A，然后保留 map Host/SNI、正常验证 TLS，请求返回的每个公网 IPv4 的首页与公开 API。223/114 样本返回 EO，8 样本返回 CF；对应响应的平台标识、正式版本、全部公开聚合、备案页脚、no-store/Vary 都通过。119 样本持续返回 CF，预期选路断言失败但业务可用；原始异常保留，没有删除断言或补定向线路。不能将公共服务网段的模拟 ECS 当作真实用户位置，亦未确定此项是地址分类、缓存还是平台 ECS 行为。相关机制见 [Google ECS 参数](https://developers.google.com/speed/public-dns/docs/doh/json#edns_client_subnet)与 [华为云地域线路说明](https://support.huaweicloud.com/intl/zh-cn/usermanual-dns/dns_usermanual_0021.html)。

真实 Edge 通过普通业务域名载入 44 人全国图；修复后地区一览进入浙江成功，状态为 3 人 / 1 座城市。期间有一次 ERR_CONNECTION_RESET，点击浏览器刷新后恢复；未改变用户代理配置。没有把浏览器成功归属于特定大陆节点。实际大陆/境外终端网络选路、IPv6 和一个完整自动续期周期仍未证明。

### 跨端脚本修复

首次页面缓存了 CF `map-island.MtVJE0cM.js`，切到 EO 后请求 `/_astro/zhejiang.DPCA4wJq.js`，EO 返回 404；EO 自己构建的浙江文件名为 `zhejiang.DcIfFIC1.js`。这是两次 Astro 构建生成不同 chunk URL 导致的实际故障，原先只验证各自入口脚本的检查未覆盖它。

新增 `scripts/sync-dual-assets.mjs` 将两端当前公开 `_astro` 文件合为相同字节集合，只复制公开 chunk；同 URL 不同字节、source map、符号链接会拒绝。`npm run check:dual` 末尾新增 `check:dual:assets`：三项回归测试 → 合并 → 两端原有安全扫描。打包必须在合并后执行，不能再单独重建一端而丢掉合并结果。

修复后双方各有 89 个 chunk。线上逐个请求两端全部 178 个 URL，均为 200、正确 JS/CSS Content-Type、正常 TLS，响应字节与本地完全一致；先前出错的 CF 浙江 URL 在 EO 也正常。双端正式登录/地区明细/退出/独立 Cookie 验收再次通过，数据与私有配置没有修改。

这解决当前两套构建在 GeoDNS 切换时互相缺文件的问题，不等于未来任意版本都自动兼容。后续正式更新需协调两端发布，先暂停大陆线路、构建并合并公开脚本、扫描、发布双方及验证，再恢复；保留仍可能被浏览器使用的上一版本资源。当前各自独立的部署工作流不负责自动暂停 DNS 或原子更新另一平台，不应绕过这个人工发布门禁。

CF for SaaS 官方提示其他 CDN Custom Hostname 的兼容限制；当前两端证书可用不代表后续 DCV/自动续期已经证明。保留双方验证记录，切线后观察 hostname/SSL 状态；自动续期尚未经一个完整周期验证，不将本次成功描述为长期兼容保证。参见 [官方域名验证限制](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/)。

若大陆切线异常，暂停新“中国大陆”记录即可回到当前 CF 默认。CF 代码回滚目标为表中发布前版本，其旧固定数据键保留。EO 当前尚无正式流量，旧部署缺私有配置的历史状态不可当作业务已恢复；回滚必须同时核对代码、配置与数据版本。任何回滚先读回当前状态，仅执行必要步骤。

## 本地证据位置

忽略目录 `.wrangler/eo-production-20261015/` 留有最小 staging、config、deployment、runtime、preservation 记录及脱敏 CLI 日志；`production-runtime.json` 和 `preservation-final.json` 为本次最终读回。`release-staging.json` 保留暂存时快照，另以 `activation-final.json` 记录最终激活状态，避免抹去阶段历史。

截图位于忽略目录 `output/eo-production-20261015/`：`dns-mainland-final.jpg`、`live-zhejiang-after-fix.jpg` 为本轮结果；`dns-eo-default-paused.jpg`、`eo-production-deployed.jpg` 为前一阶段历史。另有 `mainland-dns-change.json`、`mainland-routing-final.json`、`dual-assets-live.json` 与 `cross-cache-before-fix.json` 保留切线、未闭合样本、全部资源读回及故障负例。不保存含真实 KV 值或运行配置的截图。

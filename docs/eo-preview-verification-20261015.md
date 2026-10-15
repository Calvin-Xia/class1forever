# EdgeOne 演示预览部署与真实运行时验收

正式接入最终状态已接续：中国大陆线路启用，CF 全网默认保留；跨端公开脚本缺失已修复并重新发布，当前 EO 部署为 `dppr4ub1ojyl`。见 [正式发布与大陆分流验收](production-readiness-20261015.md)。下列 `dpfzskczd3zr` 是首次正式发布的历史部署，不是当前最新部署。

后续正式发布已完成：`classmap-cn` / `makers-tow3ibjic9wk` 的生产部署为 `dpfzskczd3zr`，真实版本 `prod_20261015_01` 已与 CF 同步激活；业务 DNS 仍只走 CF。见 [正式发布与分流前验收](production-readiness-20261015.md)。用户最新补充“预览链接真实设备已测试成功”，未给出对应部署 ID，保留这一人工结论而不扩大专项验收范围。下文只记录隔离演示项目的历史过程。

后续正式接入交接：2026-10-15 用户报告 `classmap-cn` 已在华为云配置 EO CNAME，所有权认证与证书验证完成；正式项目状态与接续步骤见 [运行手册最新交接](dual-deployment-runbook.md)。本文件下文的项目 ID、KV、演示数据和 API 验收仍仅属于 `classmap-cn-preview`，不得混用。

时间：2026-10-15 16:06–16:22，Asia/Shanghai；后续追加同日用户手机和电脑人工验收。接续用户“继续吧！对着任务一步一步做”，执行独立演示预览阶段。核心 API 真实运行时已通过；用户已确认手机上的地图、演示登录和详情正常，并确认电脑关闭代理后访问成功，电脑访问阻塞已解除。专项 UI 检查和大陆实际落点门禁未闭合。没有发布真实学生数据、更新现有 CF Worker、变更业务 DNS 或接入业务域名。

## 部署对象

| 对象 | 实际值 |
| --- | --- |
| Makers 中国站项目 | `classmap-cn-preview` / `makers-rul7t33rb81x` |
| 隔离 KV | `classmap_preview` / `ns-kKBloH5jZCD4` |
| 项目级全局变量 | `CLASS_MAP_DATA` |
| 初始化部署 | `dpzivktimmb3`，Production，成功，仅一个无数据的初始化 HTML |
| 应用部署 | `dp7d7uoncuvl`，Preview，成功，控制台时间 16:11:25 |
| 应用预览域名 | `classmap-cn-preview-dp7d7uoncuvl.edgeone.cool` |
| 演示数据版本 | `demo_20261015_01`，3 条虚构记录、2 省、3 市 |
| 函数入口 SHA-256 | `2c33ae14c975a103636ba74c7b8e5556d473714c7976dc8871b52d5b7e814327` |

明确 `--env preview` 的第一次上传被 CLI 拒绝：`Please create a production deployment first`。因此先在同一个**独立演示项目**的 Production 槽位部署中性初始化页，再把应用上传到 Preview；Production 槽位没有业务应用、真实名单或业务域名。

实际上传目录是 `dist-edgeone/.edgeone/`，使用本机 CLI 1.6.41，`--name classmap-cn-preview --env preview --skip-ai-gateway-sync --json`。既有登录授权仅在内存中使用，未新建或复制账号凭据。

[部署控制台](https://console.cloud.tencent.com/edgeone/makers/project/makers-rul7t33rb81x/deployments)可选择 `dp7d7uoncuvl` 的“预览”获取限时链接。[官方域名说明](https://pages.edgeone.ai/zh/document/domain-overview)要求中国大陆网络通过带校验信息的预览链接访问，有效期 3 小时；不将裸域名链接作为稳定交付入口。文档和保留日志不存该校验值。

## 构建与数据

1. `npm run check:dual` 在 Windows 沙箱中遭遇 workerd `GetFinalPathNameByHandleW: #5 拒绝访问`；在正常主机权限下重跑退出 0，没有修改应用或放宽断言。Astro 检查 62 文件，CF API 19/19、EO API 19/19、适配/发布/字体 30/30、GeoDNS 9/9、会话 1/1，共 78 测试通过，运行时和构建产物检查通过。
2. `node scripts/build-edgeone.mjs --artifacts-only --package-cli` 退出 0：286 静态文件、4 API bundle，CLI 上传包扫描通过。
3. 仅使用 `scripts/data-release.mjs` 导出的 `DEMO_STUDENTS`，固定生成时间 `2026-10-15T08:30:00.000Z`。此时间是演示数据内的固定字段，不是操作发生时间。
4. 控制台写入两个版本键，重新打开编辑器读取原始值；UTF-8 字节数和 SHA-256 与离线生成值完全一致：

| 键 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `students_raw_demo_20261015_01` | 247 | `0a7621f4cf11d98e71408caf7e3bf9875e90b06d54ed06352e3a397ec8b0f1c8` |
| `students_public_demo_20261015_01` | 213 | `fa4ebaa5251f600bdea9ce19f2b5c992502a3b4783c711c638f67ce99b748702` |

`classmap_runtime_config` 存放演示 release、公开演示口令 `demo`、随机生成的私有演示会话签名值和明确的演示提示。配置只写入隔离 KV，读回相等；签名值不进入源码、构建产物、报告或日志。此命名空间不得直接供未来生产项目使用。

## 真实 HTTPS/API 验收

默认系统解析得到的地址访问时，Node、curl 与当前 Edge 均遇到连接重置。Google DoH 返回同一 Makers CNAME 及另一组公开地址；固定其中一个新查得的地址请求成功。探针保留原域名 Host/SNI，正常校验证书，未关闭 TLS 校验、未修改系统 DNS/hosts/代理。这个结果证明指定传输路径上的真实 Makers 服务可用，**不能代替默认链路或真实大陆落点验收**。

通过 CLI 自身所用的中国站只读 `DescribePagesEncipherToken` 获取预览访问校验，仅在进程内使用；按同源 302 接收平台预览 Cookie，随后测试应用。平台 Cookie、应用 Cookie 和校验值不输出或保存。

最终 16 个真实 HTTP 请求及断言通过：

| 行为 | 结果 |
| --- | --- |
| 页面 | 200，`no-cache`，同源 CSP 等安全头存在 |
| 匿名公开聚合 | 200，3 人/2 省/3 市，`detailAccess=false`，`X-Data-Release=demo_20261015_01` |
| 匿名明细 | 401 `detail_auth_required` |
| 错口令、再带伪造 IP 头错口令 | 均 401，remainingAttempts 9 → 8，没有因伪造头重置计数 |
| 正确演示口令 | 200，真实 HMAC/WebCrypto 签发会话；成功登录调用 KV delete 清理限流记录 |
| 登录后公开聚合 | 200，`detailAccess=true` |
| 浙江明细 | 200，2 条虚构记录，完整字段及中文排序与离线 `normalizeStudents` / `sortPeople` 逐项相等 |
| 退出与使用清空 Cookie 后的明细请求 | 200 清 Cookie，随后 401 |
| 静态 CSS | 200，`public, max-age=31536000, immutable`，同组安全头 |
| 配置路径、`/.dev.vars` | 404 |
| 公开 API HEAD | 200，响应体 0 字节 |
| 错误方法 | 405 |
| 跨站 text/plain 表单 | 403 |

所有 API 响应均为 `no-store`；公开 API 匿名/登录/HEAD 均含 `Vary: Cookie`。应用 Cookie 为 HttpOnly、Secure、SameSite=Lax、Path=/ 且不含 Domain；退出 Max-Age=0。退出清除浏览器 Cookie，不宣称旧无状态令牌被服务端撤销。

以上真实执行了全局 KV get、错误口令 put、成功登录 delete，以及应用适配层的 JSON 解析。未直接验证平台原生 `get(key,{type:'json'})`，应用不依赖该重载。伪造头测试只覆盖此次连接路径，不扩大为所有节点的可信 IP 保证。

## 无重建配置切换

在控制台保留配置中的演示口令和签名值，仅将 release 暂时改为不存在的 `demo_missing_20261015`。16:18:08 的真实请求返回 503 `public_data_unavailable`、`no-store`、`Vary: Cookie`，没有回退旧数据。随后恢复原配置并在控制台逐字节读回相等；第一次边缘请求仍 503，16:19:11 已恢复 200 和原 release。期间没有构建或新部署，证明此次配置从 KV 动态读取并存在传播延迟；该记录不是精确延迟上限或跨节点一致性保证。

会话签名值未轮换，旧会话在密钥轮换后的失效行为仍待专门验收。最终配置和演示数据保持可用。

## 用户手机人工验收补充

用户提供 [Preview 部署详情](https://console.cloud.tencent.com/edgeone/makers/project/makers-rul7t33rb81x/deployment/dp7d7uoncuvl)，随后明确确认：手机端“地图、演示登录和详情也正常”。据此记录为用户人工验收通过，覆盖手机打开预览地图、使用演示口令登录和查看地区详情；不是 Agent 复测，不扩展为未报告的分享、退出、焦点、长按或减弱动态检查。

用户另报告另一个部署显示 `Isolated demo project initialization. No student data.`，这与初始化 Production 部署 `dpzivktimmb3` 的内容一致，属于预期状态。该部署仅满足新项目首次 Preview 的平台前置条件，实际地图应用仍在 Preview `dp7d7uoncuvl`，无需把初始化页当故障修复或覆盖为业务生产应用。

手机访问成功证明已有可用的正常浏览器访问路径。手机网络类型、解析器与实际边缘节点未记录，因此不据此确认大陆落点或跨网络稳定性。

## 用户电脑访问恢复补充

用户随后报告：“电脑应该是我开了代理的问题，关代理之后访问成功！”据此记录电脑关闭代理后正常访问通过，解除本机浏览器访问阻塞；代理影响为用户的排查结论，Agent 未独立进行代理开关对照复测。此前连接重置和固定公共 DNS 地址的探针保留为当时环境的历史证据，不再据此判断当前默认访问仍受阻，也不归因为已确认的平台故障。电脑登录、详情和其他专项交互未获单独报告，不扩大人工验收范围。

## 证据与剩余阶段

忽略目录 `.wrangler/eo-preview-20261015/` 保存检查、打包、脱敏部署日志、可复现线上探针和 `runtime-probe.json`、`config-missing-release.json`、`config-restored.json`；只记录必要状态、公开演示统计与布尔断言，不含真实名单、密钥、Cookie 或预览校验值。`output/eo-preview-20261015/deployments.jpg` 显示两个部署及其环境/成功状态。

- G0 已完成；G2 核心存储、私有配置、应用 JSON 路径真实通过。
- G3 控制台原字节读回和本次配置切换通过；单值容量边界、跨节点传播、TTL/过期限流键清理仍待验收。
- G4/G5 本次路径的伪造头负例、HMAC、编码、中文排序与 Cookie 通过；跨节点可信元数据和密钥轮换未完成。
- G6 实际上传布局和预览函数路由通过；控制面 global/含中国大陆不等于大陆实际落点或稳定访问证明。
- G8 本次传输路径的页面/静态/API 缓存头通过；手机地图/演示登录/详情、电脑关闭代理后访问经用户人工验收通过。多节点缓存、分享/键盘/长按专项/减弱动态等未在线验收。
- 下一步继续剩余专项验收，并准备具体生产资源/数据/独立密钥和同 Host 域名接入审阅。业务部署、真实数据发布、业务 DNS 分流按原分阶段授权处理。

不因为 CLI success 或单一路径 API 通过而宣布大陆生产上线。真实业务继续使用现有 CF 路径。

# 2026-10-15 本地实施记录

基线为 `main / d488775d38e6a7a0708166ebeb111176bbbe2797`，接续上一轮未提交成果。当前修改仍留本地；没有提交、推送、部署、上传真实学生数据、写生产密钥或修改 DNS/账号设置。既有 CF Worker、旧固定 KV 键及独立域名/302 回滚设计保留。

## 同 Host 会话的最小适配

保留 `detail_session` 名称、原 HMAC 载荷、12 小时有效期及 `Path=/; HttpOnly; Secure; SameSite=Lax`，不设 Domain。两个运行时独立配置签名密钥。同一 Host 的浏览器 Cookie 槽位会覆盖，切到另一端后旧签名失败并需要重登；不共享密钥，不引入 SSO。

`dialogs-island.ts` 不再复用内存明细缓存，每次详情请求由当前选中端鉴权；请求采用 `cache: no-store`。公开聚合的 localStorage 缓存强制 `detailAccess: false`，旧缓存中的 true 也不作为授权。登录、退出、隐藏标签、恢复页面和焦点复核会使旧异步请求失效并移除旧明细。`BroadcastChannel` 只传失效信号，降级使用 storage 事件；两者不可用时仍靠焦点/网络复核，不以消息授予权限。

401 只使本页失效，**不自动发送 logout**：迟到的另一线路请求不应删除刚由另一标签建立的 Cookie。明确点击退出才调用原退出 API；同源标签同步隐藏明细。所有 JSON API 保持 no-store，公开 API 保留 Vary: Cookie，其他路由头部不扩大修改，遵循原迁移契约。

这是浏览器显示与会话复核适配。服务器仍是无状态令牌，退出清浏览器 Cookie 不等于服务器撤销已复制的旧令牌；没有网络请求的页面也无法获知一次 DNS 变化。真实 GeoDNS、已有连接、跨节点传播与 Makers 行为仍需单独验收。

## 本地夹具与只读工具

`npm run dev:same-host:fixture` 在 loopback 的 `http://localhost:8791/` 提供地图；`/__fixture` 面板切换真实本地 CF Worker 与构建后的 EO Node 夹具。二者使用演示数据、不同密钥和同一个浏览器地址；`/__fixture/metrics` 只记录路径、平台标签、状态与响应体字节/时间，不记录 Cookie、口令、查询参数或明细内容。该面板属于脚本本地服务，不进入任一平台的静态构建或路由。

`npm run test:session` 对同一入口验证匿名、CF 登录、EO 拒绝 CF Cookie、EO 登录覆盖、切回 CF 拒绝、重登、退出及两端 no-store/public Vary。Cookie 属性由 HTTP 测试逐项断言，浏览器另验实际登录和多标签状态；不把手写 HTTP jar 当真实浏览器 Cookie 执行证明。

[GeoDNS 预检](geodns-preflight.md) 提供配置校验、公共 DoH、严格 Host/SNI 的固定目标 TLS、最小控制面状态快照及独立候选生成。示例实际目标仍为 null，直接 validate 必须失败。根 `wrangler.jsonc` 未加入路由；候选仅 `.wrangler/` 内新建，严格限定 `map.calvin-xia.cn/*`，不接管全区。候选和 dry-run 不验证 SaaS/目标已存在。

## 字体与浏览器证据

[字体说明](font-subsets.md) 记录完整源、234 个哈希文件、Unicode/字重/变体覆盖、7 项负例及逐字节重建。完整源 18,846,516 字节，分片库 23,489,676 字节；后者增大 24.64%，只以页面实际下载量衡量收益。地图在 ECharts 首次测量本视图地名前等待字体；PNG 等待冻结分享参数对应的完整文字字集。两端对哈希字体一年 immutable，清单/OFL 不采用 immutable。

当前连接 Edge 已验证：

- CF 本地 Worker 全国、键盘 Enter 下钻北京，16 个地区、2 座城市/3 人；对应 Sans/Serif 字体 loaded。
- 错口令被拒绝；演示登录后海淀区显示 2 条演示记录；第二标签退出后第一标签旧明细消失。
- 同一地址切到 EO 后重新要求口令，演示登录后北京显示 3 条记录；切回 CF 后 EO Cookie 不互认，页面无旧演示明细。
- CF 首屏 67 个不同字体 URL，响应体合计 **6,079,496 字节**，比完整字库基线减少 **67.74%**；后续北京/分享新增 15 个字体请求、1,423,672 字节。计量来自专用本地网关观察，非公网带宽/压缩传输性能承诺；全部字体响应为 200，路径同源。
- 实际北京 PNG：`蹭饭地图_北京_2026-10-15.png`，1200×1360、329,221 字节，SHA-256 `7ef740fbe61ac4a548959fff1337873b8d049a6ef3d95ae1ec5b8502f0ebea49`。标题、北京范围/地名、日期、图例、3 人/2 城市/50% 和页脚已读取图像核验。下载监听超时后以实际文件为准，没有据超时宣布成功。
- 第二个独立 origin 的 EO 慢字体夹具：所有字体响应至少延迟 6003ms。全国首屏加首次分享共 68 个字体响应、6,155,836 字节；点击分享后实读 `document.fonts.status=loading` 且按钮 disabled，完成后恢复 loaded/可点击。最后字体完成时间戳 `1792030704753`，实际 PNG 写入时间 `1792030705783`，没有先于字体到达生成 PNG。
- EO 实际全国 PNG：1200×1248、339,830 字节，SHA-256 `d79eba99036b3c0e7b8b0c8ef909f894aacdbe469bd17c6b4a99faec79ea2e33`；已读取图像核对全国范围、南海附图、6 人/3 省/4 城市、日期与页脚。EO 这里仍是构建后 Node 夹具，不是线上 Makers/CDN。
- CF 安徽空状态播报正确，新地名（含蚌埠、亳州、滁州、阜阳）字体 loaded。EO 390px 视口覆盖下实际内容宽度 375px（滚动条占宽），scrollWidth=clientWidth=375，无横向溢出；检查后已恢复视口并关闭本次创建的标签。

浏览器原始观察与演示 PNG 保存在忽略的 `output/local-continuation-20261015/`，不含真实名单。真实网络的字体回源/CDN 命中、真触摸、全面焦点循环与 reduce-motion 仍在预览验收中。

## 构建、扫描与 CI

`check:dual` 已包含两套构建、CF 真实本地 Worker 安全门禁、两端四路由契约、EO 适配与数据发布负例、字体负例、GeoDNS 负例及同 Host 会话测试。CI 同步运行新增测试，语法扫描包含 `.cjs`。CF/EO 构建都校验源字体与构建副本的完整范围、哈希、字重和 OFL，并在本地 HTTP 层核对字体缓存头与完整源不可达。

`build.js`、本地 Worker 子进程及 EO 契约子进程采用系统环境白名单，避免继承 Token/DEBUG/真实数据来源。workerd 的 TEMP/TMP/log 在工作区；顶层保留系统 TEMP/TMP，使数据发布演示文件仍在仓库外。首次验证曾因顶层 TEMP 也放进仓库而触发正确的发布路径保护；随后纠正调用范围，保留所有负例和路径保护，数据发布 16/16 通过。

EdgeOne workflow 仍仅手动 main/preview，固定 CLI 1.6.41，`EDGEONE_API_TOKEN` 只在部署步骤注入；未触发远端 workflow，也未实测 Token。Makers 密钥/release 仍从私有 `classmap_runtime_config` 逐请求读取，不使用 CLI 构建时 context.env 烘焙秘密。

最终源码验证全部通过：

| 命令/检查 | 实际结果 |
|---|---|
| `npm run check:dual` | 最终退出 0；78 个测试通过、0 fail/skip，完整日志在 `.wrangler/continuation-20261015/check-dual-final.log` |
| CF 构建/运行时 | Astro 62 文件 0 error/warning/hint；18 组构建门禁、12 组真实本地 Worker 门禁，API 19/19 |
| EO 构建/夹具 | 286 个静态文件、4 个 API bundle；API 19/19、适配 7/7、数据发布 16/16、字体 7/7，HTTP 资产门禁通过 |
| 新策略负例 | GeoDNS 9/9、同 Host HTTP 会话 1/1；不模拟真实 GeoDNS/Makers |
| 字体深检与重建 | Python verify/reproduce 均退出 0；234 WOFF2 + CSS + manifest 全字节一致 |
| 两次 Wrangler dry-run | 原 CF 目标及当前构建的隔离精确路由候选均退出 0；未部署 |
| Makers CLI 1.6.41 | `--artifacts-only --package-cli` 退出 0，最新 `.edgeone/` 上传包及四条 exact API 路由扫描通过；未 deploy |
| 其他检查 | 63 个 JS/MJS/CJS 语法检查通过；`git diff --check` 通过；示例 null 目标 validate 预期拒绝 |
| 保留边界 | 根 `wrangler.jsonc`、国家/全部省级几何、`js/geo.js`、旧地图脚本和调色板相对基线零 diff；Git 仍为原 main/HEAD |

当前候选为 `.wrangler/geodns-preflight/wrangler.verified-20261015.json`，仅用于本地审阅与 dry-run；不得作为已有自动部署工作流的配置。标准构建仍有依赖中的 Rollup 注释和大 chunk 提示，不是类型错误；没有放宽检查。原始 54 个已修改/未追踪文件的进入时快照保存在忽略的 `.wrangler/continuation-20261015/before/`，用于区分本次与已有工作。

本次创建的两个 UI 演示服务已按专属锁文件 PID 停止，用户原有文件和服务未清理。上述日志仅为本地应用证据，不能替代真实 Makers KV、可信 IP、Crypto、TTL、地域、TLS 与 CDN。

## 外部门禁与具体操作包

KV 继续等待既有审核，不要求重提申请。14:12 后续更新：用户单独批准的 CF 前置配置已执行，实际 fallback/CNAME 接入名称为 `map-fallback.calvin-xia.cn`，fallback active、hostname active，ssl.status pending_validation；详见 [CF 远端记录](cf-saas-preflight-20261015.md)。DNSPod 记录、EO 实际目标与 DNS 委派 DCV、同 Host 两端 TLS/续期和账号权益仍未通过。CF 官方另一 CDN Custom Hostname 不兼容限制保持原结论；GeoDNS 不保证 HTTP DCV 签发或续期，两端不能争用 `_acme-challenge` CNAME。

下一阶段操作范围已经列在 [运行手册](dual-deployment-runbook.md)：确定实际项目与演示命名空间后单独确认 preview；确认两端同一已审阅 SHA、release ID、旧部署/配置与回滚后再处理生产代码/数据/独立密钥；最后才确认 DNSPod 子区 @ 两条实际线路。真实目标尚缺时不请求笼统上线批准，不把本地成功当作云端已可用。

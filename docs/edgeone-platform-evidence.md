# EdgeOne 平台兼容证据

核查日期：2026-10-14。本文区分官方接口、本机代码/CLI 行为与线上验证。没有执行 `init/link/create/env/deploy`，没有账号变更、生产密钥写入或数据上传。

## 当前构建与产物

`node scripts/build-edgeone.mjs` 将共用 `src/` 镜像到 `.edgeone-build/src`，排除 `pages/api/**` 和 `middleware.ts`；镜像同一批原始几何文件以保持相对模块路径。`astro.edgeone.config.mjs` 使用 `output: static`、无 Cloudflare adapter，输出独立的 `dist-edgeone/static/`。构建过程不修改 `src/`、`js/` 或现有 Cloudflare `dist/`。

四个 `edge-functions/api/**/*.ts` 分别用 esbuild 编译为独立 ESM JavaScript，输出 `dist-edgeone/edge-functions/api/**/*.js`。构建门禁拒绝 API 引入 ECharts、几何、组件或 Cloudflare 平台模块，并检查 5 MB 函数大小上限。静态产物拒绝明细键/文件、服务端配置名、Cloudflare runtime、Google Fonts、跨源及内联脚本；全产物扫描本地 `.dev.vars` 的实际密钥类取值，诊断不输出取值。

生成的 `dist-edgeone/edgeone.json` 安全头从 `public/_headers` 解析；根配置的同一组头受相等断言保护。首页 `/` 和 `/index.html` 为 `no-cache`，`/_astro/*` 为一年 immutable，`/api/*` 为 `no-store`。API 自行发头，不能据静态配置推断平台已覆盖动态响应。EdgeOne 不发布 Cloudflare 的 `_headers` 文件。

构建时清理仅限脚本固定管理的 `.edgeone-build/` 与 `dist-edgeone/` 两个工作区直属目录。Astro 子进程采用环境变量白名单并关闭遥测、构建 envDir 指向隔离目录；Makers 打包进程也采用白名单，不读取项目的登录态和应用密钥。

## 已核对的接口

| 项目 | 核查结果 | 尚缺证据 |
|---|---|---|
| 函数入口 | 官方示例 `export default function onRequest(context)`；处理器表也列出 named `onRequest`、`onRequestGet`、`onRequestPost` 等 | 平台上传后的实际加载结果 |
| 路由 | 项目根 `edge-functions/api/map/public.js` 对应 `/api/map/public`；路径大小写敏感，静态资产冲突时静态优先 | 实际部署所有四条路由及私有路径负例 |
| context | Edge Functions 表列出 `request`、`params`、`env`、`waitUntil`；不是 Cloud Functions 的上下文 | 真实变量注入、Cookie 和错误响应 |
| KV | 官方示例直接使用绑定全局变量 `my_kv`，没有从 `env.my_kv` 读取；提供 `get(key, {type:'json'})`、`put(key,value)`、`delete(key)` | G0 尚未开通，G2 实际绑定/get/put/delete/json 未通过 |
| KV 合法键与一致性 | key 只允许字母、数字、下划线，最多 512 B；最终一致，其他节点缓存最长 60 秒 | 实际合法键边界、跨节点与控制面读回 |
| TTL | 官方 `put` 签名只有两个参数，没有 `expirationTtl` 文档 | G3 未通过，应用 expiresAt 不能称为平台 TTL 已支持 |
| 可信 IP | Makers 文档让 `context.request.eo` 读取地理信息；本机 CLI 生成代码引用 `request.eo?.clientIp` | G4 真实边缘请求元数据尚未测；不使用用户提交的 X-Forwarded-For |
| Crypto | Makers 官方 Runtime APIs 列出 Web Crypto 与 Encoding | G5 HMAC、编码、中文排序与 host-only Cookie 的真实运行时验证 |
| headers | `edgeone.json` 支持 `headers: [{source, headers:[{key,value}]}]` | G8 匿名/登录/退出的 CDN 实际缓存行为 |
| Node 版本 | edgeone.json 页面仍推荐 22.11.0；更新的 build-guide 已列 22.17.1、22.21.1 与多个 Node 24 版本 | 默认本地 Node 24 受控构建；云端版本仍需项目实际设置确认 |

## CLI 1.6.41 的打包边界

已实际运行 `edgeone.cmd -h`、`makers -h`、`makers deploy -h`、`makers dev -h`、`makers generate-routes -h`、`makers build -h`，没有执行部署。`makers build` 是本机可调用、顶层帮助未展示的本地命令。

本机 CLI 实现检查显示：显式传入 `deploy DIRECTORY` 会跳过自动 build，直接上传；省略目录才调用内部 build，再上传 `.edgeone/`。该 builder 发现项目根 `edge-functions/`，生成 `.edgeone/edge-functions/index.js` 与 `config.json`，静态 assets 位于 `.edgeone/assets/`。所以 `dist-edgeone/` 是可审阅的组装输入，**不能只看该目录存在就宣称直接上传布局已验证**。

仅本地打包命令（需要预先安装的 1.6.41 CLI）：

```powershell
$env:EDGEONE_CLI_ENTRY = 'C:\Users\Calvin-Xia\AppData\Roaming\npm\node_modules\edgeone\edgeone-dist\cli.js'
node scripts/build-edgeone.mjs --package-cli
```

该可选步骤在隔离的组装目录运行 CLI build，补入 `edgeone.json`，再扫描 `dist-edgeone/.edgeone/`；**尚不授权运行 deploy**。G6 仍要求最小演示项目在真实 Makers 上运行并确认最终地区、静态响应头、路由以及直接上传项目类型。`--env` 默认 production，未来演示部署必须明确 `--env preview --skip-ai-gateway-sync`；`--area` 仅 global/overseas，不能据此宣称大陆区域已生效。

2026-10-14 最终实际执行 `npm run check:edgeone` 退出码 0：静态 55 个文件、四个单独 API bundle；19/19 API 契约、构建产物 HTTP 夹具、5/5 适配与 16/16 数据发布测试全部通过。最终独立 root 为 `.edgeone-build/`，真实生成 `.edgeone-build/.astro/types.d.ts`，与 Cloudflare 根 `.astro/` 隔离。

之后执行 `--artifacts-only --package-cli` 退出码 0：CLI 合并入口 107424 字节，`config.json` 为四条 exact API 路由且 middleware=null，静态资产存在，补入配置的包再次扫描通过。Node VM 实际执行这个合并入口，注入纯演示 KV，公开聚合、登录 Cookie、区域详情、退出及缺配置 503 探针通过；静态产物添加明细键的负例被扫描拒绝，删除本次探针后恢复通过。这些验证了 **本地应用契约、构建输出与合并入口**，没有闭合平台上传、真实 V8/Makers KV 或 CDN 门禁。Windows sandbox 的 realpath/系统 TEMP 限制需要正常主机权限；构建已使用工作区 `.edgeone-build/tmp` 作为子进程 TEMP/TMP。

## 发现的环境变量门禁

本机 CLI 1.6.41 合并函数在传给处理器的 `context.env` 中直接嵌入**打包时进程环境的 JSON**。本次只给白名单，没有给应用口令、会话密钥或 release 配置，因此此包不会凭空获得生产配置。官方构建指南也说明，环境变量变更只适用于新部署，不能修改之前的部署。不能声称“控制台写入生产变量后，直接上传当前无密钥预包”已验证可用。

当前打包不获取控制台变量，不允许把真实生产密钥烘焙进本地可发布产物。实现采用 **同一私有 KV 中的 `classmap_runtime_config` 配置键**，逐请求读取 `DATA_RELEASE_ID`、`DETAILS_PASSPHRASE`、`DETAILS_SESSION_SECRET` 和 `DETAILS_HINT`；构建环境仅允许非敏感的 `CLASS_MAP_CONFIG_KEY` 键名覆盖。KV 全局绑定与数据/配置都留在函数运行时，浏览器不接触配置。

G2/G5 新增实际配置门禁：演示 KV 写入配置后确认运行时读取；修改 release 与会话密钥后确认无需重建包就生效、旧令牌失败，缺键/格式坏时返回安全的 503。获批前只是代码和夹具验证，不能称为真实 Makers 已支持。真实口令、密钥、release 的配置 KV 写入同属用户上线确认范围；日志、哈希发布清单和静态 assets 不记录口令及会话密钥。这个平台差异仍是上线阻塞；源码契约测试不能覆盖它。

## 外部门禁

G0：用户当前控制台显示 KV 需填写容量/QPS/场景申请审核，尚未开通。审核前可以完成静态构建、业务测试与演示存储适配，但不能将这些验证写成真实 KV 绑定或大陆生产可用。

G1/G6：大陆项目资格、最终区域、直接上传类型需要控制台及实际部署读数。G7：自定义域名证书/TLS 未验证。G8：平台缓存未验证。入口分流、生产部署、真实数据发布及生产密钥写入保持用户上线确认门禁。

## 官方资料

- [Edge Functions](https://pages.edgeone.ai/zh/document/edge-functions)：入口、路由、上下文、Runtime APIs 与限制。
- [Makers KV](https://pages.edgeone.ai/zh/document/kv-storage) 和 [腾讯云 KV](https://cloud.tencent.com/document/product/1552/127420)：全局绑定示例、方法、合法键、最终一致性与申请步骤。
- [edgeone.json](https://pages.edgeone.ai/zh/document/edgeone-json)：构建输出及响应头语法、Node 版本建议。
- [EdgeOne CLI](https://pages.edgeone.ai/zh/document/edgeone-cli)：目录/ZIP 与直接上传方式。当前具体参数以本机 1.6.41 帮助和实现核对为准。
- [构建指南](https://pages.edgeone.ai/zh/document/build-guide)：可用 Node 版本，以及环境变量对新部署生效的语义。

## 2026-10-15 前序文档策略更新（历史）

优先评估 `map.calvin-xia.cn` 同 Host 的 DNSPod GeoDNS + Cloudflare for SaaS，独立 cn/global 和原 302 保留为备选；本文件原本地构建/CLI/夹具证据仍是历史证据，不代替该策略验收。CF 父区两条 NS 委派已存在、DNSPod 子区设置正常但 0 条记录、公共 DoH 到 DNSPod 后 NXDOMAIN 与本机 Fake-IP 干扰的交接证据，详见 [方案 §4.1](edgeone-cloudflare-dual-deployment-plan.md#41-已核实的-dns-现状2026-10-15)。

新增外部门禁包括 CF 官方另一 CDN Custom Hostname 不兼容风险、fallback active、ownership/status active、ssl.status active、EO DNS 委派 DCV/验证记录冲突、CF HTTP DCV/续期、同 Host Cookie 覆盖/退出与多解析器选路/TTL/负缓存。支付资料用户已确认存在，不等同 SaaS 已启用。KV 审核和原 G0–G8 保留。此前文档轮未改源码或重跑；后续已获授权接续本地实施，最新结果见 [实施记录](local-continuation-20261015.md)、[字体分片](font-subsets.md) 与 [只读预检](geodns-preflight.md)。没有更改 DNS 或云端设置，也未用 Node 夹具解除真实平台门禁。

# 双平台实施与上线操作包

**大陆线路接续：用户已单独批准启用。中国大陆 CNAME 现正常指向 EO、CF 全网默认保留；切线验收发现两端 chunk 哈希不同导致省图 404，已暂停、修复并双端重发后恢复（20:12:06 CST）。** 当前 CF 版本 `7c0a0981-3894-44ce-b746-11faad590b77`，EO 部署 `dppr4ub1ojyl`。两端全部 89 个公开 chunk 共 178 个请求逐字节通过，真实浏览器浙江下钻恢复。ECS 223/114 → EO、8 → CF，119 → CF 仍为未闭合选路项；见 [完整发布/分流记录](production-readiness-20261015.md)。后续发布必须先协调双端公开脚本再恢复分流，不能独立更新一端后假设浏览器缓存自动兼容。

**19:55 正式发布更新：CF Worker 与 EO 正式项目 `classmap-cn` / `makers-tow3ibjic9wk` 已发布并激活 `prod_20261015_01`（44 人 / 13 省 / 18 市），双方真实 API、地区详情、独立会话、缓存、备案页脚与 TLS 验收通过。华为云 EO 全网默认记录已按批准暂停；公共 DNS 保持 CF 单一默认，中国大陆线路未添加。** 本轮 79 项测试通过，没有 commit/push。完整对象、回滚入口、既有资源保留与尚未证明的边界见 [正式发布记录](production-readiness-20261015.md)。用户随后补充预览链接真实设备测试成功，未给出最新部署 ID，按报告范围记录。

以下时间点为历史快照；其中“尚未发布”“ID 未知”“额度 1%”等已被上述最新记录取代。

**最新手动接入交接（2026-10-15）：用户报告正式项目标识为 `classmap-cn`，EO CNAME 已在华为云配置，所有权认证与证书验证均已完成。** `classmap-cn` 按此前创建命令是项目名称；内部 `makers-...` Project ID 尚未记录。以上控制台状态为用户人工确认，尚未由 Agent 读回。EO 业务 CNAME 的实际线路/目标、正式 KV 绑定与数据/私有配置、正式项目四 API 仍待核验；不将演示项目的测试结果直接算作正式项目通过。用户提示额度仅剩 1%，本轮保存交接，不启动构建、部署或数据发布。

接续优先顺序：先核对华为云子区根记录的默认/中国大陆线路（既定默认 CF 目标为 `map-fallback.calvin-xia.cn`），区分业务 CNAME 与 `_dnsauth` 证书记录；再读回正式项目内部 ID、生产部署及独立 `CLASS_MAP_DATA` 绑定；按受控流程发布正式数据/独立密钥并逐端读回，验收同 Host 两端 API/TLS/缓存后再完成分流。不得因证书完成就假定真实名单已发布。

**最新人工验收：用户已明确确认 Preview `dp7d7uoncuvl` 的手机地图、演示登录和详情均正常，并确认电脑关闭代理后访问成功，电脑访问阻塞已解除。** 代理影响为用户排查结论，未做 Agent 独立对照复测。初始化 Production 部署显示 `Isolated demo project initialization. No student data.` 为预期状态。分享/键盘/长按专项/减弱动态、实际大陆落点等仍待验收。详见 [手机人工验收记录](eo-preview-verification-20261015.md#用户手机人工验收补充)与 [电脑访问恢复](eo-preview-verification-20261015.md#用户电脑访问恢复补充)；下文连接重置描述为历史快照。

**16:22 演示更新：独立项目已部署应用 Preview `dp7d7uoncuvl`；为满足平台前置条件，仅在该演示项目的 Production 槽位部署了空白初始化页 `dpzivktimmb3`。** 演示 KV 原字节读回、16 项真实 HTTP 请求断言、无重建 release 切换及恢复通过；默认网络地址连接重置，公共 DNS 地址固定传输可用且 TLS 正常校验，在线浏览器和大陆落点仍未验收。没有真实名单、现有 CF 业务部署或业务 DNS 变更。见 [真实预览验收](eo-preview-verification-20261015.md)；下文 16:02 等均为历史快照。

**16:02 KV 更新：审批已通过，已创建独立空预览项目 `classmap-cn-preview`（`makers-rul7t33rb81x`）、命名空间 `classmap_preview`（`ns-kKBloH5jZCD4`），并完成项目级 `CLASS_MAP_DATA` 绑定，部署数 0。** G0 已解除，G2 的真实运行时读写/配置仍待演示部署验收；见 [KV 绑定记录](eo-kv-binding-20261015.md)。下文审批中描述为此前历史状态。

**15:03 最新 DNS 状态：map 子区由华为云托管，两个证书 TXT 可公开解析，CF hostname/SSL 均 active。用户单独批准的全网默认根 CNAME 已添加至 `map-fallback.calvin-xia.cn`（TTL 300）；权威/公共 DNS、正常域名 HTTPS 页面和公共 API HEAD 200、Edge 地图与公开聚合加载均已核验。大陆线路尚未添加，未部署本地新代码。** 见 [华为云实时验证](huawei-dns-verification-20261015.md)。下文 DNSPod 子区步骤保留为原方案历史，不再作为当前可直接执行的目标；相对主机记录仍为子区 `@` / `_acme-challenge`。

更新日期：2026-10-15，Asia/Shanghai。代码基线 `d488775`；本次接续当前未提交工作区，已实施同 Host 会话失效处理、完整字体分片、预检与候选路由。14:11 用户单独批准的 CF SaaS 四项前置配置已执行，fallback active / hostname active / SSL pending_validation，原 6 条 route 保留；见 [远端结果](cf-saas-preflight-20261015.md)与 [DNS 验证待办](cf-saas-dns-handoff-20261015.md)。没有 commit/push/deploy、真实数据上传、Secrets 或 DNSPod 变更。**大陆生产服务尚未上线**。最新本地实现与逐项验证见 [2026-10-15 实施记录](local-continuation-20261015.md)；下表与旧分享图为 2026-10-14 历史证据，不代表最新构建验收。

## 当前优先评估策略与 DNS 现状

浏览器始终使用 **map.calvin-xia.cn**：根域由 CF 托管，map 子区当前委派华为云四台 NS；子区 **@ / 全网默认** CNAME → **map-fallback.calvin-xia.cn**，未来单独批准的 **@ / 中国大陆** CNAME → **map.calvin-xia.cn.pages.dnsoe4.com**。两端同 Host HTTPS 与正式 API 已实测；大陆线路尚未添加。map-saas 未创建。CF 使用 Worker-as-origin fallback/custom-hostname 及 `map.calvin-xia.cn/*` → 现有 class1forever Worker，既有路由保留。GeoDNS 按递归解析器/可能的 ECS 分线路，不保证每次按用户真实地理位置选路。

**这仍是存在失败风险的评估方案。** CF 官方明确说另一 CDN 的 Custom Hostname 不兼容 CF for SaaS，遮蔽 DNS 会导致 hostname validation 失败。分别验收 ownership/status active 与 ssl.status active、两端同 Host HTTPS 及持续续期；不把案例或一次成功当平台兼容保证。[官方限制](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/)。原 class1forever 入口的国家 302 与独立 cn/global 域名保留为备选/回滚方案，不在本轮启用。

2026-10-15 侧边对话已完成的只读检查交接（本轮未另行访问账号）：

- CF 父区已有两条 DNS-only NS：map.calvin-xia.cn → f1g1ns1.dnspod.net / f1g1ns2.dnspod.net，TTL Auto；无需重加或换根域 NS。
- DNSPod map 子区已存在，设置页“正常”、当前/分配服务器吻合、“域名已正常解析”，但业务记录列表为 0 条。
- Google DoH 查 map NS/SOA 返回 NXDOMAIN，并指明回答来自 36.155.149.35 / 111.206.98.235；这些 IP 已独立查得属于 f1g1ns2.dnspod.net。查询已到 DNSPod，空区是明显因素但不是已证明的唯一原因；不能反推 CF 未发布委派。
- 本机 nslookup 对 gabe.ns.cloudflare.com 给出 198.18.5.157 等代理 Fake-IP，先前直查有干扰。后续优先独立公共 DoH/外部权威查询，分开检查父区 NS 与添加合法记录后的子区 NS/SOA/CNAME、TTL/负缓存。
- 用户已确认 CF 有支付资料；14:12 已读回 SaaS fallback active、hostname active，证书仍 pending_validation，未创建订阅或验证后续账单权益。
- 原 class1forever.calvin-xia.cn 已有 CNAME → calvin-xia.cf.090227.xyz，本轮不改，也不把它假定为本项目 SaaS 目标。

完整配置、证书/DCV 冲突、验收矩阵及原 302 备选细节见 [方案 §3–5](edgeone-cloudflare-dual-deployment-plan.md#3-分流方式的选择)。新增 [只读预检](geodns-preflight.md) 拒绝占位目标、宽泛路由及不安全 TLS；所有目标仍待实测，不因本地实现宣布上线。

## 已完成的本地验证

| 对象 | 命令/证据 | 结果 |
|---|---|---|
| Cloudflare | `npm run check` | 静态 16 组（含 37 项对比度/调色板）、Astro 57 文件 0 error/warning/hint、产物扫描、运行时安全及缓存检查、API 19/19 |
| Worker 部署包 | `npm run worker:dryrun` | 成功，`--dry-run: exiting now`；未上传或部署 |
| EdgeOne | `npm run check:edgeone` | 55 个静态文件、4 个 API bundle、共享 API 19/19、适配 7/7、数据工具 16/16、HTTP 资产夹具通过 |
| Makers CLI 1.6.41 | 构建脚本 `--artifacts-only --package-cli` | 真实生成 `.edgeone/assets/`、函数 `index.js/config.json`；4 条 exact API 路由，补入 edgeone.json；安全扫描通过 |
| 合并函数入口 | Node VM + 演示全局 KV | 公开数据/登录 Cookie/详情/退出、缺私有配置 503 通过；非 Makers 线上证据 |
| 泄漏负例 | 在静态输出添加仅本次创建的私有键探针 | 扫描失败；精确移除探针后恢复通过 |
| 旧上传工具 | 演示 `STUDENTS_DATA` + `--dry-run` | 聚合 6 人/3 省/4 市；没有读真实来源或上传 |
| 语法/依赖 | 55 个脚本 `node --check`、lock 比对、`git diff --check` | 通过；没有新增 npm 依赖 |
| Edge 浏览器 | 大陆构建 Node HTTP 演示站 | 地图/地区一览/Enter 下钻/错口令/演示登录/省内明细/退出/窄屏检查；实际分享 PNG 已下载核对 |
| 字体 | 官方固定提交、cmap/glyphOrder/字重轴/哈希/OFL | 完整 WOFF2；浏览器观察到同源 Sans/Serif，无外部资源 |

Cloudflare 本地 Worker 也在同一 Edge 浏览器验证了地图、北京下钻（2 城市/3 人）、同源字体、演示登录及海淀区明细；与大陆夹具使用同一演示数据口径。

北京分享图：3 人、2 座城市、50%，日期 2026-10-14；下载名 `蹭饭地图_北京_2026-10-14.png`，333128 字节。演示产物位于 gitignored `output/dual-deployment/share-beijing-demo.png`，SHA-256 `ae71cd9eb8f1d1bc43a9af8899e403e9719e93cdf80e3bdc7e6c1d6e27ca4b5b`。这些都是演示数据。两项后补负例确认构建 env 密钥不能绕过私有配置、下次请求激活/缺新明细不退回旧键。

浏览器下载事件捕获超时，但实际文件存在且已读取图像核验，未用超时当成功证据。

2026-10-14 的完整字体首次下载约 18.8MB；该历史实现已由 [完整字符分片](font-subsets.md) 接续，最新浏览器体积与 PNG 证据见实施记录。台湾轻点等价裁定和地图几何保持；本轮没有重新声称真实触摸设备验证通过。全面键盘焦点循环、reduce-motion、真触摸、线上 CDN 缓存列入预览验收。

## 当前外部门禁

2026-10-14 已从当前连接 Edge 只读查看腾讯控制台：KV 显示“您目前还未开通 KV 数据存储服务”，按钮为“审批中”。本次没有提交申请或创建项目。`edgeone whoami` 退出 0 只证明当前登录命令可用。`cf zones list` 当日读到 `calvin-xia.cn / active / Free Website`；不证明 DNS/规则写权限或 Workers 账单套餐。

| 门禁 | 必要证据/动作 |
|---|---|
| G0/G2 | KV 审核通过；演示命名空间隔离绑定为全局 `CLASS_MAP_DATA`，get/put/delete/json 与私有配置读取实际通过 |
| G3 | Makers 控制面导入/原字节导出、1MB 容量、配置传播；逻辑 expiresAt 已实现，平台 TTL 未证明；过期限流物理键需受控清理，不能无限留存 |
| G4/G5 | 真实 `request.eo.clientIp` 可信性及伪造头不影响；真实 HMAC/中文排序/编码/Cookie 行为 |
| G1/G6 | 直接上传项目类型、免费权益、大陆最终区域、函数与资产目录上传、备案及实际备案号页脚 |
| G7/G8 | 同一 map Host 的两端证书/DCV/续期、验证标签冲突；切线重登、同名 Cookie 覆盖/多标签/退出、no-store/Vary 与静态头实测 |
| G9/G10 分流 | SaaS 官方另一 CDN 不兼容门禁、fallback/ownership/ssl active；父区委派与子区回答、多地区/解析器/ECS/落点、TTL/负缓存；仅备选另查 302 规则配额/Location |

Makers 构建时 `context.env` 不适合存生产密钥。本实现通过私有 KV 配置键 `classmap_runtime_config` 每请求读取一次 `{ DATA_RELEASE_ID, DETAILS_PASSPHRASE, DETAILS_SESSION_SECRET, DETAILS_HINT }`；默认键名也可由非敏感 `CLASS_MAP_CONFIG_KEY` 构建配置指定。控制面写入权限仅属于受控发布环境。该配置不得入 bundle、manifest、Git、CI artifact 或日志。Cloudflare 保留原生 Secrets/vars。两端会话密钥独立、Cookie 不设 Domain。两端同一 map Host 的 detail_session 会互相覆盖；切线不互认，退出清理此浏览器 Host 的 Cookie。浏览器已补多标签失效与每次详情重新鉴权；同 Host 本地夹具只演示应用行为，不代替真实 GeoDNS、Makers、TLS 或 CDN。旧无状态令牌仍在原有效期内，不宣称服务端撤销；不会为了切线共用密钥。

## 可复现本地命令

```powershell
# 本地构建/workerd 子进程由 local-tool-env.cjs 白名单隔离，并自行设置工作区 TEMP/TMP/log。
# 顶层 PowerShell 保留系统 TEMP/TMP：数据发布演示测试刻意要求 bundle 在仓库外。
# Windows 文件句柄仍被沙箱拒绝时，仅申请本地运行时权限；不要删断言。
npm run check:dual
npm run worker:dryrun

# 只用演示数据；第二个是 Node 夹具，不是 Makers dev/CDN。
npm run dev:local -- --port 8788 --state-dir .wrangler/local/state-ui-dual
npm run dev:edgeone:fixture

# 本机已有 CLI 的隔离打包，不拉取密钥，不访问生产。
$env:EDGEONE_CLI_ENTRY = 'C:\Users\Calvin-Xia\AppData\Roaming\npm\node_modules\edgeone\edgeone-dist\cli.js'
node scripts/build-edgeone.mjs --artifacts-only --package-cli
```

Cloudflare 输出 `dist/`，EdgeOne 源组装包 `dist-edgeone/`，CLI 上传包 `dist-edgeone/.edgeone/`。两套 `.astro`、cache、产物已隔离。不要把源组装包直接当作 CLI 上传包。`data:publish` 当前只提供离线 prepare/verify/verify-readback，见 [数据发布操作包](data-release-runbook.md)；没有可以假装已经连通的生产 publish 命令。

## 待用户确认的具体上线阶段

这些命令仅是操作包，**本次不执行**。门禁未闭合时不请求一次包揽所有动作的批准；分阶段记录资源 ID、旧版本与确认。

1. **演示预览**：KV 获批后，确认创建/使用直接上传演示项目及命名空间、实际大陆区域；绑定演示 KV/私有演示配置，执行明确的 `preview` 上传。只用演示名单与测试密钥。

   ```powershell
   # PROJECT_NAME 必须替换成核查后的直接上传项目；先复查该CLI版本帮助。
   edgeone.cmd makers deploy ./dist-edgeone/.edgeone --name PROJECT_NAME --env preview --skip-ai-gateway-sync --json
   ```

   不猜 `--area mainland`，本机只有 global/overseas；实际区域取控制台和部署读数。预览项目不能指向生产 KV。上传后四路由、静态头、配置、可信 IP、Crypto、缓存、触摸/键盘/分享全部验收，再进入下一步。

2. **代码与数据生产**：记录两端同一已审阅 Git SHA、上一代码部署 ID；批准更新现有 Worker 和指定 Makers 项目，批准真实两端新版本键上传及独立密钥写入。按唯一来源一次生成、逐端读回哈希、双方 verified 后激活版本。Cloudflare 设置 runtime `DATA_RELEASE_ID`；EdgeOne 完整保留配置密钥并更新私有配置发布 ID。未知/错误 release fail closed，Cloudflare 不设置 ID 时仍读旧固定键用于初期回滚。成功公共/详情响应带 `X-Data-Release`，原 JSON `version` 不改语义。观察延迟，不能声称两云原子事务。

3. **同域名演示与证书评估**：保留已有父区 NS 和旧入口 CNAME；实际创建/验证 CF SaaS fallback 与 Custom Hostname，配置 map.calvin-xia.cn/* → class1forever 的精确路由，逐项确认 ownership/status 与 ssl.status active。map-fallback / map-saas 名称只是候选，不能宣称已建。先验证默认 CF 路径，再在 EO 核对同一 map Host 的接入、DNS 委派 DCV、备案显示与 HTTPS。EO 自动 CNAME 验证要求避免分线路，不能直接照用；CF 非 wildcard HTTP DCV 需 CA 能收到 CF 挑战响应，不保证 GeoDNS 签发/续期长期成功。两端不能争用同名 _acme-challenge CNAME，需按实际标签协调。见方案 §4.3 的官方依据。

4. **分线路上线最后确认**：只有 CDN 不兼容风险、同 Host 两端 TLS、数据与 Cookie/缓存门禁通过后，才申请添加 DNSPod 子区 @ 中国大陆 → 实际 EO 目标；默认 → 实际 CF SaaS 目标。合法记录添加后重新验收 NS/SOA/CNAME 与多网络选路，记录 TTL/负缓存和证书续期监测、失败回退；DNSPod 控制台“正常”或一次网页打开均不足以验收。不要为 map 的业务 API/POST 套原入口 WAF。若方案失败，用户可另确认改用原 class1forever 302 入口和独立 cn/global；先备份已有 CNAME、处理记录冲突，再按原方案备选部分设置两条 302 和仅旧入口 WAF，不直接覆盖现有配置。

CI 现有 Cloudflare deploy 已改成先运行 `check:dual`。新增 `.github/workflows/deploy-edgeone.yml` 仅支持手动预览部署：在 GitHub Actions 选择 **Deploy (EdgeOne preview)** → **Run workflow**，分支选 `main`，填写已经核查的直接上传项目名。该文件和依赖的双平台源码须先进入远端 `main` 才可使用；本地写入 workflow 不会自动运行。

用户已表示配置 GitHub Actions secret；流程使用 `EDGEONE_API_TOKEN`，仅部署步骤注入，测试/打包不接触此值。先运行 `check:dual`，再隔离安装固定 CLI 1.6.41，将组装产物打包并扫描，最终明确上传 `dist-edgeone/.edgeone/` 到 `preview`。不使用云端默认 Node 版本，不同步 AI Gateway，不把源码目录误作上传包。现有 Cloudflare workflow 保留。

KV 审核期间可以上传无配置的预览包用于页面/路由探针，但公开数据与登录预期返回安全 503；不应据预览 URL 或 CLI 成功宣布完整服务可用。工作流不创建/绑定 KV、不上传学生数据、不写应用密钥、不改 DNS，也不提供大陆生产自动部署。获批且真实兼容/区域/TLS/缓存以及新增 SaaS/GeoDNS/同 Host 会话门禁闭合后，再单独开放生产发布。当前仅完成本地文件与打包验证，没有触发远端 workflow；GitHub secret 是否有效要由实际部署读取结果确认。 既有 CI 检查：workflow YAML/手动分支与发布范围/步骤顺序/密钥注入检查通过，7 个 run 步骤经 Bash 语法检查，非法项目名及缺 Token 提前退出负例通过；固定 CLI 本地打包与扫描再次通过。

## 回滚动作

- 主方案大陆故障：用户确认后撤回 DNSPod @ 中国大陆线路，保留已验证 CF SaaS 默认目标及父区 NS；等待 TTL/负缓存与已有连接影响，从多网络验证 DNS/落点/TLS/API。若 SaaS 或其证书未可用，先用已验证 Worker 地址或独立 global，而不是指向未核验的默认目标。
- 只有使用原 302 备选时：禁用 classmap-mainland-entry，保留 global 兜底及旧入口 WAF，确认旧入口 302 到 global；已打开 cn 的页面不会自动迁移。旧入口 CNAME 的改动须另行确认。
- 数据部分失败：停止激活；按受控日志恢复已尝试端上一 `DATA_RELEASE_ID`，EdgeOne 恢复上一私有配置，密钥不得丢失；两端读回、运行探测一致后再恢复服务。不只比人数，不删除旧键。
- 代码故障：两平台分别回上一已验证部署 ID，核对数据键/配置兼容性；原 Worker/KV/workers.dev/Pages 都保留。
- CF SaaS/证书或 GeoDNS 组合失败：停止大陆分流评估、分享已验证的独立直达站点；退回原 302 需另获配置授权。CF 路径不可达时，只能使用已验证 EO 直达或经授权的单线路方案，不承诺自动救援。
- 证书续期失败：按记录的 DCV/CAA/线路观测排查，不覆盖另一端验证 CNAME；在到期前暂停问题线路并验收可用备选。DNS 回退不立即改变缓存和已建立连接。

正式记录按方案 §11.3 模板填入时间、资源/部署 ID、SaaS/hostname/ssl 状态、DNSPod @ 两线路实际目标/TTL/负缓存、两端 DCV/续期、同 Host Cookie、区域/备案、两端 SHA/release、实际解析器/网络和回滚；只有启用备选时填 302/WAF Rule ID。禁止记录姓名学校、Cookie、秘密及完整 IP。

## 2026-10-14 诊断历史

一次 Astro `--verbose` 诊断把继承的 `GITHUB_TOKEN` 写到工具输出；没有创建含该令牌的项目日志。已通知用户建议撤销/轮换；随后停止 verbose，EdgeOne 构建/打包采用环境白名单，扫描本地及进程密钥取值但不打印取值。不要在后续构建中继承 DEBUG 或记录全部环境。

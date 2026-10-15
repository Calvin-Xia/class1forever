# 同 Host GeoDNS 本地预检

2026-10-15 后续实际分流已按用户追加批准启用：中国大陆 → EO，CF 全网默认保留。两端正式服务与跨构建脚本联合发布已实测；119 ECS 样本仍返回 CF，不能将固定目标探测或部分样本通过当作全部地域通过。最新状态、真实浏览器省图修复和回滚步骤见 [正式分流验收](production-readiness-20261015.md)。本工具仍只读，不修改线路。

## 2026-10-15 华为云委派更新

当前 `map.calvin-xia.cn` 子区已由华为云四台 `ns1.huaweicloud-dns.{com,cn,net,org}` 托管。配置模板与校验器已按公开 NS/SOA 更新，旧 DNSPod、缺少成员、混入其他服务商或重复成员均拒绝。下文 DNSPod 叙述是原方案历史；当前业务目标为 CF `map-fallback.calvin-xia.cn` 和 EO `map.calvin-xia.cn.pages.dnsoe4.com`，目标存在不代表分流或正式数据已验收。示例模板的目标仍留空，避免直接拿示例执行。

工具 `scripts/geodns-preflight.mjs` 只生成隔离的本地候选配置、执行公共 DoH 查询和无凭据的 `HEAD /` TLS 探针，或解析人工导出的最小状态快照。不读取 `.dev.vars`，不调用账号 API，不写 DNS、不启用 SaaS、不签发证书、不部署。真实 KV 审核与 SaaS/证书门禁仍在 [运行手册](dual-deployment-runbook.md)。

2026-10-15 14:12 最新状态：经用户单独批准，已创建 `map-fallback.calvin-xia.cn` originless DNS、SaaS fallback（active）、map 精确 route 和 Custom Hostname（hostname active / SSL pending_validation），保留原 6 条路由。本工具只检查本地配置，无法发现远端已有的 `class1forever.calvin-xia.cn/*` 路由；既有仅含 map route 的候选不得直接部署覆盖远端路由集合。完整远端状态、三项 CLI dry-run、执行结果与回滚 ID 见 [CF SaaS 前置检查](cf-saas-preflight-20261015.md)。

## 配置与离线负例

`config/geodns.example.json` 的三个目标故意为 `null`：真实 CF SaaS 接入目标、EO Makers 目标及 fallback origin 尚未核验，不能把 `map-saas` / `map-fallback` 候选名称写成已存在的资源。取得实际值后，将副本保存于忽略的 `.wrangler/geodns/` 或受控仓库外位置，再执行：

```powershell
node scripts/geodns-preflight.mjs validate --config .wrangler/geodns/actual.json
node --test tests/geodns-preflight.test.mjs
```

直接运行 `validate` 默认读取示例并以退出码 1 拒绝未填值，这是预期负例。校验同时拒绝占位域名、同一目标、URL/IP、直接 `workers.dev` 充当 SaaS 目标、非 `@` 的子区根记录，以及任何非 `map.calvin-xia.cn/*` 路由。通过仅证明输入语法和本项目范围正确，不证明资源存在、权属或已上线。测试中的 `fixture-provider.net` 仅作内存夹具，测试不解析或连接这些名称。

## 精确路由候选

先用正常构建生成当前 `dist/server/wrangler.json`，然后：

```powershell
node scripts/geodns-preflight.mjs candidate --out .wrangler/geodns/wrangler.candidate.json
# 以下命令仅本地 dry-run；不得移除 --dry-run 或作为现有部署工作流配置。
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config .wrangler/geodns/wrangler.candidate.json --outdir .wrangler/geodns/dryrun
```

候选从 Astro 已合并的真实 Worker 配置派生，将入口与 assets 转为绝对路径，保留 Worker 名、KV 等绑定，仅增加 `routes: [{ pattern: "map.calvin-xia.cn/*", zone_name: "calvin-xia.cn" }]`；不修改根 `wrangler.jsonc`、构建产物源文件或任何 CI 文件。已有路由需要先审阅，工具直接拒绝，不覆盖。候选只能新建于仓库 `.wrangler/` 内，拒绝路径/链接逃逸和覆盖已有文件。候选可在目标仍待定时生成，它只表达已知的 Worker 路由范围；不宣称 SaaS/DNS 配置已准备好。每次源码重建后，用新的输出文件名重新生成，不复用旧构建候选。

Wrangler dry-run 仍会显示已有非敏感绑定标识。运行时应清除 `DEBUG`、使用环境白名单，并将 `TEMP`、`TMP`、`WRANGLER_LOG_PATH` 放在工作区 `.wrangler/`。不要使用 `--verbose`，不要输出全部环境。正常构建和候选均不携带应用密钥值。

## DNS 观察与 TLS 探针

```powershell
# 不需要实际接入目标，因此当前空区也能观察。
node scripts/geodns-preflight.mjs dns
# 只有实际目标全部填写后才允许固定目标探针。
node scripts/geodns-preflight.mjs probe --config .wrangler/geodns/actual.json
```

`dns` 分别向 Google 和 Cloudflare 的公共 HTTPS JSON DoH 查询父区 NS/SOA、子区 NS/SOA/CNAME/A/AAAA，保留 RCODE、TTL 与可用的负缓存 SOA 字段，不输出原始诊断 Comment 或完整 IP。`parentDelegation` / `childAuthoritativeAnswer` 始终为 `unknown`：这是递归观察，不能证明父区权威 referral；子区 NXDOMAIN 不能反推出父区没有委派，也不能证明空区是唯一原因。需要另附可信的父区权威 referral 与子区权威直接回答，切勿用被代理 Fake-IP 干扰的 `nslookup` 作为证明。

`probe` 将 `recursive-selection` 和 `fixed-cloudflare-target` / `fixed-edgeone-target` 分开记录。每个解析器分别解析 map Host 或指定实际目标的 A 记录，绕过本机目标域名解析，将全部公共 IPv4 固定为连接地址，TLS SNI 与 HTTP Host 始终为 `map.calvin-xia.cn`。使用系统正常证书链及主机名校验，`rejectUnauthorized: true`，不忽略证书错误；无 Cookie、无 Authorization，不读正文、不跟随跳转。拒绝 Fake-IP、私网与保留地址；连接 IP 只输出短 SHA-256 标签以便比较。DoH 本身仍依赖本机对解析器 HTTPS 域名的连接与正常 TLS 信任。

TLS 成功仅证明该指定连接支持 map Host 的证书。即使地址相同、HTTP 200、页面相同或服务器头相同，`platform` / `workerRoute` 仍为 `unknown`，应结合受控平台部署/请求证据验收。固定目标绕过了 GeoDNS，不能证明中国大陆或境外用户实际选路；递归查询也只代表当前解析器出口，未指定 ECS、未验证客户端国家与 IPv6 transport。失败/无 IPv4 回答保留 unknown/failed，不以另一路成功覆盖。`dns` / `probe` 是观测命令，退出码 0 只表示输出已生成，结果中的 unknown/failed 仍须处理，不能作为上线绿灯。

## 控制面状态快照

工具不持有云 API Token。人工通过受控控制台/API 导出以下最小、无秘密字段到私有本地文件（这里是结构示例，时间与状态必须来自实际读数）：

```json
{
    "observedAt": "REPLACE_WITH_ACTUAL_UTC_ISO_TIME",
    "hostname": {
        "hostname": "map.calvin-xia.cn",
        "status": "pending",
        "ssl": { "status": "pending_validation" }
    },
    "fallback": { "status": "pending" }
}
```

```powershell
node scripts/geodns-preflight.mjs status --status-file .wrangler/geodns/status.private.json
```

时间必须有效且不晚于当前、不早于 24 小时；输出只投影允许字段，绝不回显完整输入。hostname `status`（ownership）、`ssl.status`（证书）、fallback active 分别判断；只有三个都 active 才有 `reportedActive: true`，pending/unknown 退出码 2。即使全部 active，仍标记 `authenticity: unverified-local-snapshot`、`currentRemoteStatus: unknown`、`productionReady: false`，不能把本地 JSON 当作当前账号证据，仍需核对实际 resource ID/hostname/fallback origin/时间及 DNS/TLS/路由。

## 已验证与外部门禁

2026-10-15：9 个 Node 测试通过，含占位/宽泛路由/Fake-IP/证书错误/过期状态/候选覆盖等负例；按当前已有构建实际生成 `.wrangler/geodns-preflight/wrangler.candidate.json` 并以 Wrangler 4.149.0 `deploy --dry-run` 成功退出，没有部署。真实公共 DoH 观察（北京时间约 09:28）：两解析器父区 NS/SOA 成功，map 的 NS/SOA/CNAME/A/AAAA 均 NXDOMAIN；未作权威直查，未推翻已交接的父区 NS 记录，也未查明子区 NXDOMAIN 的唯一原因。目标仍为 null，因此没有对虚构目标执行 TLS 探针。

仍须真实平台证明：SaaS 已启用、fallback active、ownership/status 与 ssl.status active、EO 同 Host 接入及 DNS 委派 DCV、两端实际 TLS 与续期、CAA/验证标签冲突、DNSPod 两条实际业务目标/线路、TTL/负缓存、多网络落点，以及 Worker 精确路由和应用/KV/CDN 契约。

[CF Worker-as-origin 官方文档](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/) 允许只处理特定 Custom Host 的路由；配合 [Workers Routes 语法](https://developers.cloudflare.com/workers/configuration/routing/routes/) 使用精确 Host 加路径通配符。全区 `*/*` 会接管其他项目，本工具拒绝该范围。[Hostname validation 官方文档](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/) 明确另一 CDN 不兼容、遮蔽 DNS 会使 ownership 验证失败；本地配置、一次 active 或 TLS 成功都不能消除该限制或保证 GeoDNS 续期。EO 自动 CNAME 证书验证避免分线路，须核实实际 DNS 委派 DCV，不覆盖另一端 `_acme-challenge`。未闭合门禁前不启用大陆分流。

# Cloudflare SaaS 前置检查与待执行操作

预检时间：2026-10-15 13:45–13:56，Asia/Shanghai。CF CLI `1.0.0-beta.17`，使用用户恢复的短期 OAuth 会话；没有复制、保存或输出 Token。预检阶段只读查询及三项 `--dry-run`；随后用户明确回复“允许”，已于 14:11 执行下列四项，14:12 完成最终读回。

## 执行结果（取代下文预检时的“待批准”状态）

| 项目 | 实际结果 | 本次资源 ID |
| --- | --- | --- |
| originless DNS | `map-fallback.calvin-xia.cn AAAA 100::`，proxied，TTL Auto，读回一致 | `d422cb6609c39aa1fddc9926d69bed27` |
| SaaS fallback | `map-fallback.calvin-xia.cn`，**active** | zone 级设置 |
| 精确 route | `map.calvin-xia.cn/* -> class1forever`，其余原 6 条的 ID/pattern/script 全部保持一致 | `b511280c11e44532938fc830148ef926` |
| Custom Hostname | `map.calvin-xia.cn`，hostname **active**，SSL **pending_validation**，DV/TXT，min TLS 1.2 | `34dbbdb7-5fb7-44b2-bd34-cd1f1100eea9` |

证书申请 ID：`7388e51b-f742-4fae-beb1-0c7f8f1c3b64`。这仅代表证书已申请，HTTPS 尚未验收。父区两条 map NS 与旧入口 CNAME 的 ID/目标/代理状态已核对保持原样；没有部署代码、上传数据、修改 Secrets 或写入 DNSPod。

已创建且 active 的 SaaS fallback/CNAME 接入名称为 **`map-fallback.calvin-xia.cn`**，`map-saas` 未创建。该名称是本阶段确认的 CF 目标，DNSPod 业务 CNAME 尚未配置和验收，不能据此宣称 map 站点已上线。

下一步 DNS 验证记录见 [DNSPod 待办](cf-saas-dns-handoff-20261015.md)。有变更前重新查询证书记录，值可能随重新签发而变化。控制面操作明细与前后快照在忽略目录 `.wrangler/cf-saas-preflight-20261015/`，不包含 OAuth Token。

14:17–14:22 后续核查：用户已正确添加 TXT，但 DNSPod 免费子区当前不提供有效权威回答，CF 仍待验证。官方子区委派限制与 [实测阻塞记录](dnspod-authoritative-blocker-20261015.md)已补充；CF 资源保持，不因此购买套餐或改动委派。

## 已核实的远端状态

- SaaS zone：`calvin-xia.cn`，ID `684f036938469887acfeaedfe511a0c3`，active / Free Website。该 zone 套餐不证明 Workers 计费或 SaaS 账单权益。
- 复用 Worker `class1forever`，ID `80249acb73774735832a8e3053e4f9ef`。控制台当前版本前缀 `f3041f5b`，已有 ASSETS、CLASS_MAP_DATA、SESSION、IMAGES 绑定；本次未读取数据或密钥。
- SaaS 管理页面可以访问；全量 `custom-hostnames list` 返回 `[]`。fallback 查询返回 404 / code 1551 Resource not found。尚无可用 fallback 或 Custom Hostname。
- `map-fallback.calvin-xia.cn` 与 `map-saas.calvin-xia.cn` 的精确 DNS 查询均为空；它们仍是候选名称。
- `map.calvin-xia.cn` 父区两条 NS 仍为 `f1g1ns1.dnspod.net` / `f1g1ns2.dnspod.net`。旧 `class1forever.calvin-xia.cn` CNAME 仍指向 `calvin-xia.cf.090227.xyz`。这些记录保留。

预检时控制台 zone Workers Routes 全量 6 条（1–6 of 6），已全部保留：

| pattern | Worker |
| --- | --- |
| `class1forever.calvin-xia.cn/*` | `class1forever` |
| `*ui.calvin-xia.cn/*` | `vibeui-generator` |
| `calvin-xia.cn/*` | `mr-xia-site` |
| `workers.calvin-xia.cn/*` | `mr-xia-site` |
| `bridge.calvin-xia.cn/*` | `wuhan-bridge-map` |
| `file.calvin-xia.cn/*` | `picoshare-ts` |

预检时 `map.calvin-xia.cn/*` 没有现存冲突。执行前已用 API 保存 6 条完整 ID/pattern/script，执行后比较通过。

## 具体待批准范围

仅限 CF 端四步前置配置，按依赖顺序执行；遇套餐购买、合同确认、权限不足或状态冲突即停在该步骤：

1. 新建 proxied AAAA：`map-fallback.calvin-xia.cn -> 100::`，TTL Auto。独立 originless 记录，不覆盖现有名称。
2. 将当前不存在的 zone SaaS fallback 设置为该名称，读取返回状态。设置具有 zone 级作用，执行前再次确认 Custom Hostname 仍为空，fallback 仍不存在。
3. 单条新增 `map.calvin-xia.cn/* -> class1forever`；不重新部署 Worker，不使用全区 `*/*`，不整体替换 routes。现有 CLI 命令目录未提供 zone route CRUD，此步使用官方单条 Route API，执行后全量读回并核对原 6 条及新增 ID。
4. 创建 `map.calvin-xia.cn` Custom Hostname，DV / TXT，最低 TLS 1.2，读取实际 ownership/DCV 记录及 hostname、SSL 状态。**创建本身会发起证书申请**，不承诺停留 pending；本阶段不写 DNSPod 验证或业务记录。

这四步不部署本地未提交代码、不上传学生数据、不改 Secrets、不调整 DNSPod 线路/父区 NS/旧入口 CNAME、不创建付费订阅。当前 Worker 仍是既有生产版本，前置资源完成不等于新代码上线。

如 fallback 创建并 active，可使用该实际 originless 名称作为 SaaS CNAME 接入目标；无需额外创建 `map-saas` 别名。最终目标在读回成功之前保持未核实，不把候选写入 DNSPod。

## 已验证的 CLI 请求

以下全部以真实 zone ID 做 `--dry-run`，exit 0；原始无凭据请求保存在忽略目录 `.wrangler/cf-saas-preflight-20261015/dry-runs.json`。dry-run 只验证 CLI 请求组装，不验证写权限、套餐权益或资源创建结果。CLI dry-run 使用域名时不解析 zone ID，故执行包固定使用实际 ID。

```powershell
cf dns records create --zone 684f036938469887acfeaedfe511a0c3 --body '{"type":"AAAA","name":"map-fallback.calvin-xia.cn","content":"100::","proxied":true,"ttl":1}' --dry-run
cf custom-hostnames fallback-origin update --zone 684f036938469887acfeaedfe511a0c3 --origin map-fallback.calvin-xia.cn --dry-run
cf custom-hostnames create --zone 684f036938469887acfeaedfe511a0c3 --hostname map.calvin-xia.cn --ssl-type dv --ssl-method txt --ssl-settings-min-tls-version 1.2 --dry-run
```

路由新增请求：`POST /zones/684f036938469887acfeaedfe511a0c3/workers/routes`，body：

```json
{"pattern":"map.calvin-xia.cn/*","script":"class1forever"}
```

API 没有本任务已验证的 dry-run；本次未发送该 POST。执行时仅在内存中复用既有 CLI 登录授权，不把凭据写入文件或命令参数。

## 验收、回滚与后续门禁

执行前保存允许字段的 DNS、fallback、Custom Hostnames、routes 快照，重新检查同名冲突。执行后记录本次新建的 DNS record ID、route ID、hostname ID、fallback 状态；Cloudflare API 返回成功仍须读回。

先检查 fallback active，之后分别记录 Custom Hostname `status` 与 `ssl.status`。没有验证记录或 DNSPod 未配置时 pending 属于待办，不能写成上线成功。只有授权写入实际验证记录、ownership/SSL active，并以严格 Host/SNI 做 HTTPS 检查后，才进入默认 CF 线路验收。源代码、数据、密钥及 EO 仍依既有分阶段门禁另行处理。

回滚只针对本次记录的 ID：先移除新增 Custom Hostname，再移除新增 map route，然后撤销本次 fallback（原状态不存在），最后删除本次 originless DNS。每步先读回比对，资源出现其他使用者或变化就停止；保留原 6 条路由和所有原有记录。证书申请可能已进入 CA 流程，删除 hostname 不撤销已公开的 CT 日志。

**已有候选配置不可直接部署**：`.wrangler/geodns-preflight/wrangler.verified-20261015.json` 仅含 map route，而远端 `class1forever` 已有旧入口 route。需要后续部署时另行审阅路由保留策略；本次不改根 `wrangler.jsonc` 或自动发布流程。

CF 官方明确提示另一 CDN 的 Custom Hostname 不兼容 CF for SaaS；同 Host GeoDNS + EO 仍是有失败风险的评估方案。单端资源创建或一次证书 active 不能证明双端签发、续期和实际分线路可持续工作。

依据：[Worker as fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)、[单条 Route API](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/create/)、[Hostname validation 限制](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/)。

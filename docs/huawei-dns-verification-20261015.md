# map 华为云 DNS 与 CF 证书验证

**大陆线路最终接续：用户追加批准后新增 `map.calvin-xia.cn / 中国大陆 / CNAME / map.calvin-xia.cn.pages.dnsoe4.com. / TTL 300`。为修复切线脚本问题曾由用户完成 MFA 暂停，双端修复发布后于 20:12:06 CST 恢复正常；CF 全网默认及验证记录保留，旧 EO 全网默认仍暂停。** Google ECS 223/114 返回 EO、8 返回 CF，119 仍返回 CF；保留异常而不声称所有大陆网络均已通过。见 [正式发布与分流记录](production-readiness-20261015.md)。华为云表单中主机记录留空才表示此子区根域名（逻辑 `@`），未创建字面量 `@.map...`。

**19:55 最新：已按用户批准暂停错误新增的 EO 全网默认 CNAME；CF 默认正常，NS/TXT/DCV 记录保留。Google 与 Cloudflare 公共解析器均只返回 CF fallback。两端正式发布和同 Host 验收已完成，中国大陆线路未添加。** 见 [正式发布记录](production-readiness-20261015.md)。以下 14–15 时为历史快照。

**15:03 最新：用户明确回复“允许添加”后，已在华为云新增 map 子区根 CNAME / 全网默认 / `map-fallback.calvin-xia.cn.` / TTL 300。权威 NS、Google/Cloudflare 公共 DNS 均读回正确；正常域名解析下页面与公共 API HTTPS HEAD 均 200，Edge 浏览器实际地图和公开聚合加载成功。大陆线路未启用，未部署本地代码。**

时间：2026-10-15 14:50–14:58，Asia/Shanghai。用户已自行创建华为云 map 子区并修改父区 NS，本次核查委派，迁移已授权 CF 证书申请的两个 TXT 值；未添加业务 CNAME 或大陆线路。

**14:58 最终结果：CF API hostname active / ssl.status active；固定 CF 入口、真实 map Host/SNI、开启证书校验的 HTTPS HEAD `/` 和 `/api/map/public` 均 200。** 公网业务 CNAME 未添加，普通浏览器业务域名访问和 EO 大陆路径尚未验收。

## 已核实

- Google 公共 DNS 的 `map.calvin-xia.cn NS/SOA` 查询成功，子区 SOA 来自华为云。
- NS 为 `ns1.huaweicloud-dns.com`、`ns1.huaweicloud-dns.cn`、`ns1.huaweicloud-dns.net`、`ns1.huaweicloud-dns.org`。这只记录用户已完成的实际委派，不是本次代理修改。
- 华为云控制台初始只有系统生成的 NS/SOA，无 TXT、业务 CNAME。
- 14:52 从当前 CF 控制台重新核对挑战值，与之前记录一致；hostname 有效，证书待验证（TXT），fallback 有效。CLI 短期会话一度过期，用户恢复登录后 14:53 CLI 查询成功。
- 14:53 在华为云新增 `_acme-challenge.map.calvin-xia.cn` / TXT / 全网默认 / TTL 300 记录集，包含两个独立值。控制台显示正常、创建成功，记录集总数从 2 增至 3，系统 NS/SOA 未修改。
- 直接向 `.com` 与 `.net` 华为云权威 NS 查询 TXT，均返回两个独立且正确的值；14:54 Google 与 Cloudflare DoH 也分别返回正确两值（Status 0）。
- `map.calvin-xia.cn` 和父域 CAA 查询都成功且没有 CAA 限制记录；这不能代替 CA 验证结果。
- 14:50 公共 DNS 中没有 `map.calvin-xia.cn CNAME`；本次没有创建。域名尚未作业务 DNS/HTTPS 上线验收。

两条挑战值仍列在 [原 TXT 清单](cf-saas-dns-handoff-20261015.md)，今后以 CF 当前证书返回为准。最小证据在忽略目录 `.wrangler/cf-saas-preflight-20261015/`：`huawei-readback.json`、`huawei-txt-verification.json`、`huawei-public-validation.json`。

最后已读回的 CF 状态（14:53）：hostname active，SSL pending_validation。两条 TXT 已公开解析，接下来等待并读回证书状态；不因 DNS 成功宣称证书或两端站点可用。默认业务 CNAME、大陆 EO 接入、代码/数据/独立密钥发布及续期仍遵循既有分阶段授权与验收。

14:56 保留配置的单次重试：先 GET 当前 hostname，再用 `cf custom-hostnames edit <id> --body` 原样提交 `ssl.method=txt`、`ssl.type=dv`、`ssl.settings={min_tls_version:1.2}`，以触发验证。发送前 dry-run body 与 GET 投影深度比较一致；API 返回 hostname active / SSL pending_validation，挑战值未变化。未切换 CA、未改成 HTTP、未降低 TLS。依据 [CF 官方 DCV 排障](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/troubleshooting/)及 CLI 命令说明，操作记录为 `huawei-validation-retry.json`。

控制台成功结果截图：`output/huawei-dns-20261015/txt-records.jpg`（忽略目录）。

## 14:58 证书与固定目标 HTTPS

CF CLI `custom-hostnames list` 读回 hostname `34dbbdb7-5fb7-44b2-bd34-cd1f1100eea9` 的 hostname/SSL 均 active，TXT/TLS 1.2 保持不变。证据：`huawei-certificate-status.json`。

从 Google DoH 读取实际 fallback 的 A 地址，连接其中一个 CF IP，SNI 与 Host 均设为 `map.calvin-xia.cn`，使用 Node 原生 CA 校验与主机名校验，未使用 insecure 选项。两个 HEAD 返回 200，页面 Content-Type text/html，公共 API application/json；未读取响应 body、学生数据、Cookie 或详情接口。实际握手证书的 issuer 为 Cloudflare TLS Issuing ECC CA 4，有效期至 2027-01-13，主机名匹配。该握手证据证明当前 CF 边缘可为真实 Host 提供可信 HTTPS，不单独据此推断其一定是上述新 SaaS 订单对应的证书。证据：`huawei-cf-https.json`。

这是现有生产 Worker 的固定入口探针，不是未提交新代码或双平台上线验收。实际响应的 HSTS 缺失，API HEAD 未带 CSP；保留原样，不因该探针擅自部署修复。正常解析的业务 CNAME 和大陆线路未配置，下一阶段需要批准明确的业务记录后再验证浏览器路径。

## 回退边界

证书阶段代理唯一华为云写入为上述 TXT 记录集；随后用户单独批准默认 CNAME，详见下节。需要撤销时先核对名称、类型、值、创建时间，确认无其他使用者后再处置；不操作用户已有 NS/SOA，不删除 DNSPod 原记录，不恢复或替换父区 NS。CF 前置资源与回滚 ID 见 [CF 执行记录](cf-saas-preflight-20261015.md)。

## 15:02–15:03 默认 CF 业务入口启用

用户明确回复“允许添加”，批准子区 `@` / CNAME / 全网默认 / 目标 `map-fallback.calvin-xia.cn` / TTL 300，仅启用当前 CF 线上 Worker 作为默认入口，不启用大陆分流。

执行前华为云表格只有系统 NS/SOA 与本次证书 TXT，共 3 个记录集，没有 CNAME/A/AAAA 冲突。15:02:23 创建子区根 CNAME；华为云根主机记录留空，最终表格显示完整 `map.calvin-xia.cn`，目标规范化为末尾带点的 FQDN，状态正常、全网默认、TTL 300，总数变为 4。现有 NS/SOA/TXT 均保留。

第一次紧邻创建的权威查询仍 ENOTFOUND，未据此重复创建或修改；随后完整独立读回成功：两台华为云 NS 的 CNAME/A 正确、TXT 仍为原两个值，Google 与 Cloudflare DoH 返回 CNAME → fallback → CF A 地址。正常 URL `https://map.calvin-xia.cn/` 与 `/api/map/public` 的 HEAD 均 200，无重定向，TLS 校验开启，未固定 IP。

Edge 浏览器正常打开页面，标题为“金鹰 1 班蹭饭地图”，地图 canvas 已渲染、公开聚合加载完成，没有访问口令或姓名学校详情。该页面是现有线上 Worker 版本；不代表本地未提交的双端改造已发布，亦不证明 GeoDNS/EO、两端会话、证书续期或完整生产门禁通过。

证据：忽略目录 `.wrangler/cf-saas-preflight-20261015/huawei-default-cname.json`，截图 `output/huawei-dns-20261015/default-cname.jpg`、`map-live.jpg`。控制台未展示后端 recordset ID，本次按名称/类型/线路/目标/TTL/创建时间记录；不编造 ID。

回退对象仅为 15:02:23 新增的根 CNAME。若需回退，先确认仍是本次全网默认目标，再申请暂停/移除该业务记录，随后重新检查权威与递归解析及负缓存；保留 TXT、系统 NS/SOA、父区委派与旧入口。没有自动删除记录。

# CF SaaS 证书验证与 DNSPod 待办

**最新：用户已将 map 子区委派至华为云，14:53 两个 TXT 已迁入新子区，14:54 权威 NS 与 Google/Cloudflare 公共 DNS 均读回正确，14:58 CF hostname/SSL 均 active，固定 CF 入口的真实 Host/SNI HTTPS HEAD 页面和公共 API 均 200。DNSPod 不再是当前子区权威，以下 DNSPod 填写说明保留为历史。** 业务 CNAME 尚未添加，详见 [华为云验证记录](huawei-dns-verification-20261015.md)。

状态读回：2026-10-15 14:12，Asia/Shanghai。CF 端四项前置配置已完成，fallback active、hostname active，SSL **pending_validation**。本次没有修改 DNSPod。操作结果与回滚 ID 见 [CF 记录](cf-saas-preflight-20261015.md)。

**14:17–14:22 更新：用户已正确添加下列两条 TXT，但 DNSPod 当前免费子区未提供有效 SOA/TXT 回答，两台已委派服务器及公共递归查询仍 NXDOMAIN，CF 仍 pending_validation。** 官方子区委派文档要求专业版及以上，不能继续按免费子区已可用推进；详见 [阻塞证据与替代方向](dnspod-authoritative-blocker-20261015.md)。不要反复重填或删除当前正确记录。

## 当前证书 TXT 记录

DNSPod 托管的子区为 `map.calvin-xia.cn`。证书 API 返回两条同名 TXT，添加时分别创建，不能合并成一条字符串：

| 类型 | DNSPod 子区内主机记录 | 完整名称 | 值 |
| --- | --- | --- | --- |
| TXT | `_acme-challenge` | `_acme-challenge.map.calvin-xia.cn` | `dQUSnLUkZBlJg0odqcBcy3Kdy9vnAt8EQMqEUvzBULQ` |
| TXT | `_acme-challenge` | `_acme-challenge.map.calvin-xia.cn` | `Z5ybyZPhS4F8ioUcYtaI7vUw4q9ONR7T2peNjjFDRss` |

这些是证书挑战值，不是 CLI Token。实际写入前重新用 `cf custom-hostnames list --zone 684f036938469887acfeaedfe511a0c3 --hostname map.calvin-xia.cn` 读取 `ssl.validation_records`，以当前返回为准；检查 DNSPod 是否已有同名 CNAME，避免与 EO 委派 DCV 冲突。14:12 单个公共解析器 cloudflare-dns.com 对该名称 CNAME/TXT 均返回 NXDOMAIN，这仅是该递归解析器当时结果，不代替 DNSPod 控制面与权威 DNS 核对。

hostname ownership 已 active，当前不需要额外添加初始 `_cf-custom-hostname` TXT。后续若 ownership 变为 pending，再以实时 API 要求处理。

## 分开处理的业务 CNAME

CF 端已创建并 active 的接入目标是 `map-fallback.calvin-xia.cn`。未来经授权配置 DNSPod 默认线路时，子区 `@` CNAME 指向该名称；本阶段未添加。不要用 `workers.dev`、旧入口第三方 CNAME 或未创建的 `map-saas` 替代。

添加验证 TXT 后需等待并读回 **ssl.status active**，再以 `map.calvin-xia.cn` 的严格 Host/SNI 验证证书、页面和 API。当前没有业务 CNAME 或可用证书时，不把 Custom Hostname active 当作可访问站点。

EO 大陆业务线路、同 Host 两端证书/续期及 CDN 兼容性仍需独立验收，未获此轮授权，未执行。CF 官方另一 CDN Custom Hostname 不兼容限制未因前置资源创建而消失。

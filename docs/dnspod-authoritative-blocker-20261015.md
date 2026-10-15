# DNSPod 子区权威解析阻塞

**14:54 后续：用户已将 map 委派至华为云，SOA 与两个 TXT 均可公开解析，本文 DNSPod 阻塞已由更换子区托管解决；不表示 DNSPod 免费托管限制被解除。** 最新证书与 DNS 验证见 [华为云记录](huawei-dns-verification-20261015.md)。

检查时间：2026-10-15 14:17–14:22，Asia/Shanghai。用户已在 DNSPod 添加两条 TXT，本次只读核查，没有修改 DNS、套餐或 CF 配置。

## 当前事实

- DNSPod `map.calvin-xia.cn` 记录页确有两条 `_acme-challenge` / TXT / 默认线路，值与 CF API 的两个 `ssl.validation_records` 一致，TTL 600。不存在用户填错主机记录或值的证据。
- DNSPod 显示免费版。解析设置显示状态“正常”，当前服务器与所属服务器均为 `f1g1ns1.dnspod.net`、`f1g1ns2.dnspod.net`；控制台的正常标签不能证明数据面可解析。
- 直接向上述两台服务器（本次解析到 `1.12.0.4`、`106.39.207.235`）查询 `_acme-challenge.map.calvin-xia.cn TXT` 和 `map.calvin-xia.cn SOA` 均失败，Node 返回 ENOTFOUND。`nslookup -debug` 确认 TXT 响应为 NXDOMAIN、无 authority 记录且没有 AA 标志，不能称其已在提供该子区的有效权威回答。
- Cloudflare DoH 与 Google DoH 的 TXT 查询同样 NXDOMAIN；`map.calvin-xia.cn CNAME` 尚不存在。
- CF API 最后读回 hostname active、SSL pending_validation，CA 为 ssl_com。TXT 未能公开解析，未进入 HTTPS 验收。

原始最小证据在忽略目录 `.wrangler/cf-saas-preflight-20261015/`：`txt-verification.json`、`authoritative-dcv.json`。没有保存 Token 或用户账户秘密。

## 平台限制与判断

腾讯云 [子域名托管解析实践教程](https://cloud.tencent.com/document/practice/302/79793)（更新 2025-12-22）要求专业版及以上套餐，并说明应添加主域名后托管子域名，使用付费套餐 NS；[DNSPod 官方对应文档](https://docs.dnspod.cn/dns/subdomain-resolution/)也明确不支持免费套餐。

因此，“免费版直接添加 map 子区 + f1g1ns 委派”不能继续作为已受支持的方案前提。现有实测与此限制相符；未取得 DNSPod 后台诊断，不能把账户后台失败原因断言成唯一已确认根因。不能让用户反复重填正确的 TXT，也不能用“再等缓存”掩盖服务器当前不提供子区回答的问题。

此前给出 TXT 待办时没有先确认 DNSPod 子区 SOA/TXT 可用，前置验证不完整，本记录更正该判断。CF 已完成的四项资源保留；未购买套餐、删除记录、移动根域 NS 或改动 map 委派。

## 免费替代方向（尚未实施）

可评估仅将 `map` 子区改由华为云 DNS 托管，根域继续留在 CF。华为云官方 [计费 FAQ](https://support.huaweicloud.com/dns_faq/dns_faq_006.html)写明不收费，[子域名管理](https://support.huaweicloud.com/intl/zh-cn/usermanual-dns/dns_usermanual_2503.html)明确支持主域保留第三方、子域 NS 独立委派，[地域解析](https://support.huaweicloud.com/intl/zh-cn/usermanual-dns/dns_usermanual_0021.html)列有中国大陆线路。

这只是文档层面的可行候选，未登录/创建华为云资源，未证明当前用户账号权益和实际响应。在批准切换前，先创建子区及两条 TXT，取得实际分配 NS，直接验证新 NS 的 SOA/TXT 可用，再提交只替换 map 父区 NS 的具体变更和回滚；不能提前把示例 NS 写入生产。业务 CNAME、证书 active、双端 GeoDNS/CDN 兼容性仍需按既有门禁验收。

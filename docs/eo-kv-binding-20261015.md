# EdgeOne Makers KV 创建与绑定

后续更新：16:22 已执行独立演示预览部署、虚构记录/私有演示配置写入、原字节读回和真实 API 验证，详见 [预览验收](eo-preview-verification-20261015.md)。本文资源创建和“部署数 0”均为 16:02 绑定完成时快照。

操作日期：2026-10-15 15:52–16:02，Asia/Shanghai。用户明确告知审批通过，并授权开通 KV 绑定。本次创建空命名空间、空预览项目及项目级绑定；没有部署应用、写入名单/运行时配置/密钥或修改业务 DNS。

## 已创建资源

| 项目 | 实际值 |
| --- | --- |
| Makers 控制面 | 中国站，站点 `default-pages-zone` |
| 预览项目 | `classmap-cn-preview` |
| Project ID | `makers-rul7t33rb81x` |
| 项目状态 | `Pending` / 控制台“待部署” |
| 加速区域 | SDK 返回 `global`，控制台显示“全球可用区（含中国大陆）” |
| 命名空间 | `classmap_preview` |
| Namespace ID | `ns-kKBloH5jZCD4` |
| 绑定变量 | `CLASS_MAP_DATA` |
| 绑定关系 | `CLASS_MAP_DATA → classmap_preview` |
| 部署数 | 0，SDK 列表读回确认 |

控制台绑定页：[项目 KV 管理](https://console.cloud.tencent.com/edgeone/makers/project/makers-rul7t33rb81x/kv)。绑定界面没有环境选择项，属于项目级绑定；以独立项目和命名空间隔离演示存储，不宣称平台提供了独立 preview 环境绑定。未来生产项目不得直接接入此演示命名空间。

## 工具选择与核验

本机 EdgeOne CLI `1.6.41` 的根命令和 `makers --help` 没有 KV 创建/绑定命令。遵循 [官方 KV 集成说明](https://pages.edgeone.ai/zh/document/pages-kv-integration)，由已登录 Edge 浏览器创建 namespace 并保存绑定。Namespace 名只支持字母、数字、下划线；连字符名称未提交成功，实际资源使用 `classmap_preview`。

初始 Makers 项目列表为空。浏览器“直接上传”路径需要上传文件，但 [官方 SDK](https://pages.edgeone.ai/zh/document/sdk-project-operations) 支持独立 `projects.create`，不需要部署：

1. 在忽略目录 `.edgeone-build/management-sdk/` 隔离安装 `@edgeone/makers-sdk@0.1.0`，`--ignore-scripts`，不改根 package.json/lockfile。
2. 在内存中复用已登录 CLI 的中国站授权；未输出或复制 Token，未新建凭据。
3. `projects.list` 确认账号当前项目总数 0，再创建 `classmap-cn-preview`，area global；`projects.get` 读回项目 ID/状态/区域。
4. 浏览器项目 KV 页面选择 `classmap_preview`，变量名 `CLASS_MAP_DATA`，保存后表格出现对应绑定。
5. SDK `deployments.list` 读回 total 0。绑定持久保存通过控制台刷新后读回核验。

最小证据：忽略目录 `.wrangler/eo-kv-setup-20261015/` 的 `project-created.json`、`project-readback.json`、`project-final.json` 与绑定读回记录；截图位于 `output/eo-kv-setup-20261015/`。这些文件不包含 Token、Cookie、名单或运行时密钥。

## 当前验收边界

KV 审批门禁 G0 已解除，命名空间与项目级绑定已实际建立；G2 仅控制面绑定完成。尚未部署函数，也未测试真实 Makers 中 `CLASS_MAP_DATA` 的 get/put/delete/json、私有配置读取、跨节点传播和清理行为。区域读数不代替真实大陆节点探测。

后续可向此独立项目部署演示包、写入演示配置和记录，再验收运行时契约；真实学生数据、生产配置与大陆 DNS 分流仍按既有上线阶段处理。本次不扩大为数据上传或生产发布。

回退时先核对项目 ID、namespace ID、变量名及是否有新使用者，先解绑再处置空资源；不自动删除，不碰 CF Worker/KV 或当前 map 默认入口。

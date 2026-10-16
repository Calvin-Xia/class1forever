# 双平台数据发布操作包

2026-10-15 后续实际执行：经用户分别批准，使用 CF CLI 与 EO 控制台暂存/读回同一真实版本 `prod_20261015_01`，再发布双端代码/配置并激活，正式运行验收通过。见 [发布记录](production-readiness-20261015.md)。这属于受控人工发布路径；下述离线 CLI 仍没有连接生产的 `publish` 命令。

本工具已实现离线准备、文件校验、读回字节哈希比对和通用协调协议。CLI 不访问 Cloudflare 或 EdgeOne，不上传数据、不修改密钥和 `DATA_RELEASE_ID`。生产适配器尚未接入。2026-10-15 已通过审批并建立独立预览项目与 `CLASS_MAP_DATA` 绑定；16:22 已完成纯虚构数据的控制台写入/原字节哈希读回，以及真实 Makers API 和 release 切换恢复验证，见 [真实预览验收](eo-preview-verification-20261015.md)。该人工演示路径不等于生产发布适配器或两端数据发布已经可用。

## 1. 数据与产物边界

唯一输入为受保护的仓库外 JSON 文件（学生数组），或本地进程的 `STUDENTS_DATA`。不执行遗留 JS 文件，也不在两端分别生成数据。复用 `shared/data-model.mjs` 规范化，一次固定 `generatedAt`，生成同一份 raw/public 字节。数据格式 `version: "v1"` 保持原语义。

发布 ID 只允许 1–64 个 ASCII 字母、数字、下划线，物理键为 `students_raw_<releaseId>` 和 `students_public_<releaseId>`。为旧版本回滚保留 `students:raw:v1` / `students:public:v1`——**该回退只适用于 Cloudflare**（未设置 `DATA_RELEASE_ID` 时回落到固定键）；EdgeOne 缺 `DATA_RELEASE_ID` 时是 503，回滚必须按 release 配置恢复到上一版本。每个 UTF-8 值最多 1,000,000 字节；该上限是按文档矛盾采取的保守检查，不能代替真实 Makers 单值限制实测。

输出目录包含 `raw.json`、`public.json`、`manifest.private.json`。manifest 仅含 schema/data/release 版本、UTC 生成时间、非敏感来源标签、聚合统计、物理键、字节数与 SHA-256；不含来源路径或凭据。manifest 和哈希同样只留在受控发布环境，不提供公开 API。

CLI 强制源文件、bundle 和读回目录位于当前仓库外，解析已有路径/符号链接后的真实位置；目录和文件独占创建，不覆盖已有版本。POSIX 下请求目录 0700 / 文件 0600；Windows 权限由父目录 ACL 决定，运行前选择已受保护、未同步、未纳入其他 Git 仓库的私有目录并核查 ACL。路径检查不能证明该目录未被其他软件同步或打包。

禁止把真实文件置于 Git、`public/`、`dist/`、`dist-edgeone/`、CI workspace/artifact 或日志。CLI 只打印发布 ID、阶段和错误代码，不打印名单、内容哈希、文件路径或供应商异常内容。失败后保留私有部分产物供核查，不自动删除用户文件；按受控保留策略清理。

## 2. 本地命令

在已受保护的目录中选一个尚不存在的子目录。下面的路径是占位示例，必须替换；不向对话提供真实名单。

```powershell
# 演示准备；不读取真实来源，不访问任何云。
node scripts/data-release.mjs prepare --demo --release-id demo_20261014 --out 'C:\private\class-map\demo_20261014'
node scripts/data-release.mjs verify --bundle 'C:\private\class-map\demo_20261014'

# 真实离线准备也必须先在受保护本地环境获得数据处理授权。
node scripts/data-release.mjs prepare --source 'C:\private\class-map\students.json' --release-id R20261014_01 --source-tag protected_source --out 'C:\private\class-map\R20261014_01'

# 官方控制面按原始字节导出后，对各端分别读回校验；目录内文件固定为 raw.json/public.json。
node scripts/data-release.mjs verify-readback --bundle 'C:\private\class-map\R20261014_01' --readback 'C:\private\class-map\readback_cloudflare'
node scripts/data-release.mjs verify-readback --bundle 'C:\private\class-map\R20261014_01' --readback 'C:\private\class-map\readback_edgeone'

# 演示测试：内存双平台、CLI 子进程与所有失败控制；不读取 .dev.vars。
node --test tests/data-release.test.mjs
```

`--generated-at` 可固定规范 UTC ISO 时间；正常准备默认使用本次时间。`--demo` / `--source` / `STUDENTS_DATA` 必须且只能提供一个，不默认读取 `js/data.js`。`verify-readback` 比较完整字节的哈希，控制台重新排版 JSON 也会失败；不要为通过核验而放宽成忽略字节差异。离线导出通过只证明导出的文件吻合，仍须记录导出来自哪个真实 namespace、物理键、平台和时间。

测试包含真实目录符号链接/Windows junction 指向仓库的绕过负例。若 Windows 沙箱禁止创建 junction 并返回 EPERM，需要在允许本地临时链接的执行环境重跑完整测试；不删除或跳过该断言。临时演示目录由测试创建并清理，生产文件不参与测试。

## 3. 待接入的适配协议

`scripts/data-release.mjs` 导出以下函数供受控发布入口使用；当前 CLI 不加载外部脚本或适配器，也没有 `publish` 命令。

| 方法 | 契约 |
| --- | --- |
| `createRelease(records, { releaseId, generatedAt?, sourceTag? })` | 生成一次字节与私有 manifest |
| `verifyRelease(release)` | 哈希、长度、规范化明细和地区聚合一致性核验 |
| `stageRelease(release, adapters, { record, allowMissingJournal? })` | 两端顺序写新物理键，逐端读回；不激活。`record` **必填**：缺省会抛 `JOURNAL_RECORD_REQUIRED`，只有显式传 `{ allowMissingJournal: true }` 才允许无日志 |
| `activateRelease(release, staged, adapters, { record, allowMissingJournal? })` | 仅接受两端 verified；重新读回后逐端激活并探测，失败则恢复已尝试的端。`record` 同样**必填**，豁免条件与 `stageRelease` 一致 |
| `verifyReadback(release, adapter)` | 读取两键完整字节，逐一比对 SHA-256 |

`adapters` 必须同时提供 `cloudflare` 和 `edgeone`，以下方法返回 Promise：

```js
{
    put(key, bytes),               // 完成写入；bytes 为 Uint8Array，不得记录内容
    get(key),                      // 返回原始 Uint8Array；缺失返回 null
    currentRelease(),              // 当前 DATA_RELEASE_ID，旧固定键模式用 null
    activate(releaseId),            // 设置/部署配置并等待可探测；必须先有上线授权
    probe(releaseId),               // 仅全部运行验收通过返回 true，不能仅查控制面退出码
    restore(previousReleaseId)     // 恢复本站配置/部署；null 恢复旧固定键模式
}
```

接入生产时必须提供 `record(state)`，以受保护持久日志记录状态快照，使用安全原子文件替换或经过验证的等价机制，并包含同一 Git SHA、平台资源标识、操作时间、操作者和探测记录。函数提供的状态仅含发布 ID、uploaded/verified/activated、上一版本和回滚结果，不含源数据/凭据；部署动作和成功探测后均需落盘。记录失败会阻止后续激活或触发回滚，若最终日志保存也失败，入口必须报失败并按平台当前状态人工复核，不能将未保存的状态视为可靠成功记录。实现现状：`stageRelease` / `activateRelease` 在生产路径已把 `record` 强制为必需参数——缺少 `record` 会直接报错，确需无日志必须显式传 `opts.allowMissingJournal === true`；该强制由 `tests/data-release.test.mjs` 的负例覆盖。

Cloudflare 控制面适配可使用官方 Wrangler 的版本化 KV 上传与原始值读取，但须验证 namespace/绑定、实际命令格式、读回延迟和错误行为。EdgeOne 必须先证明 Makers KV 的控制面写入/读回接口、命名空间和绑定，不能替换为其他腾讯产品的 `EdgeKVPut`。尚无可用自动化接口时，先使用控制台同字节导入并受控导出读回；本工具不声称控制台导入已经完成。

`probe` 必须验证目标站公开响应发布 ID、同源认证与受控详情、API no-store / Vary: Cookie 和关键运行状态；生产认证信息不得记录。二端独立会话密钥，切线路需重登。同一 map Host 的同名 Cookie 会互相覆盖；本地浏览器已实现多标签失效/每次详情重新鉴权，真实两端仍须验收。probe 应确认两端实际落点，不能只请求同一 map URL 就声称两端均已核验。KV 全局传播可能延迟；适配器可作有界重试，但重试不能把缺失或不一致的数据改判为成功。

## 4. 上线确认包与失败恢复

准备和演示检查完成后，向用户提交具体资源、Git SHA、发布 ID、两个物理键、预期 `DATA_RELEASE_ID` 变更、旧配置/旧部署标识与回滚动作。取得生产数据上传和配置激活授权后，才接入生产适配器执行。

1. 一次准备，两端使用原样字节。保存私有 manifest；先核查各端旧版本可读和 rollback 配置存在。
2. 两端先检查目标版本键：若已有相同字节可安全重试，若已有不同字节则中止并使用新发布 ID，不覆盖留存版本。该检查不是原子 KV 操作，必须保证同一发布 ID 只有一个受控发布进程，不能依赖检查应对并发写入。写 Cloudflare 新版本键，读回核验；再写 EdgeOne 同一字节并读回。任意写入/读回失败均返回 `partial_failure`，不进行激活，不删除旧键。保留新键供核查或安全重试。
3. 两端均 verified 后，再次读回并保存各自上一版本；逐端设置/部署 `DATA_RELEASE_ID`，执行完整 `probe`，两个 probe 都通过才标记 `succeeded`。
4. 激活/探测失败会对已经尝试激活的端执行 restore 并 probe 旧版本，包括“配置已改但命令报错”的端。即使恢复成功，该次发布仍是 `partial_failure`。若任意 rollback 为 failed，立即保留现场并人工恢复；不得对外宣称已经回滚。
5. 发布进程被终止时，日志可能停在操作前后之间；依据私有日志和两端当前配置/响应人工复核、恢复上一版本。当前工具不提供断电后自动续跑或两云事务。
6. 成功后保留至少上一版数据与配置用于回滚；清理孤立版本必须单独审批与核查，不由本工具自动执行。Cloudflare 副本仍留境外，不宣称“数据仅存大陆”。

两云之间没有原子事务。激活期间两端可能短暂使用不同 release ID；单次请求必须冻结本站使用的 ID，以免 raw/public 混读。这份操作包不解除大陆 KV、可信 IP、Crypto/TTL、实际部署目录、上传权限和上线确认门禁。

## 5. Makers 配置与激活补充

CLI 1.6.41 的 context.env 为构建时注入。应用改从私有 Makers KV 的 `classmap_runtime_config` 读取本次请求配置，含 DATA_RELEASE_ID、DETAILS_PASSPHRASE、本站独立 DETAILS_SESSION_SECRET、DETAILS_HINT。此配置不得写入数据 bundle/manifest/Git/CI/静态目录或日志。真实写入等待 KV 获批、控制面核查与上线确认。EdgeOne adapter 的 currentRelease/activate/restore 应读取、完整保留并受控更新该配置中的发布 ID；restore 必须恢复旧配置并探测，不等同于回退代码。配置与数据均最终一致，观察到旧值时继续等待并核验，不能将控制面成功等同于立即全网激活。Cloudflare 仍使用原生 runtime vars/Secrets。

## 6. 2026-10-15 域名策略对发布的影响

优先评估同一 `map.calvin-xia.cn` 的 DNSPod GeoDNS + CF SaaS，原 302/独立域名作备选。DNS/证书/ownership/同 Host 会话门禁与数据发布门禁分别验收，GeoDNS 不提供两云原子激活。发布失败时先恢复版本和私有配置；如需暂停问题 DNS 线路，须获授权并等待 TTL/负缓存，不能把改 DNS 当数据回滚完成。官方 CDN 不兼容风险与续期失败处理见 [主方案](edgeone-cloudflare-dual-deployment-plan.md) 和 [运行手册](dual-deployment-runbook.md)。本轮不更改发布工具或上传真实数据。

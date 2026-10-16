# main 自动发布：CF Workers + EdgeOne Makers

`.github/workflows/ci.yml` 检查 push/PR；`.github/workflows/deploy.yml` 在 push main 或 main 上手动触发时重新运行完整门禁，再串行发布现有生产资源。原独立 EO preview workflow 已合并，避免同次提交只更新一端或误发预览项目。两个 workflow 都是 `permissions: contents: read`；CI job 有 30 分钟超时，deploy job 是 60 分钟（六阶段串行、非原子切换，不能被自身超时截断）。三个官方 Action（checkout / setup-node / upload-artifact）钉在 `v4` tag 当时指向的 commit SHA 上，注释里写了取值方式与日期。

固定对象在 `config/production.json`：CF `class1forever`、EO `classmap-cn` / `makers-tow3ibjic9wk`。预检必须读到现有项目及正确 KV/SESSION/路由，CLI 不能隐式创建项目。非 main 不发布；并发组不取消正在执行的生产流程，写云前跳过已被新 main 取代的提交；`production-deploy.mjs deploy` 在拿到凭据后又重做一次同样的判断（`MAIN_SUPERSEDED_BEFORE_DEPLOY`），因为 workflow 的前置判断到真正写云之间可能隔了几分钟门禁。

## 发布顺序

1. `npm ci` → `npm run check:dual`，全程不注入部署 Token、真实名单或应用密钥。检查包含 CF/EO API、会话、字体、GeoDNS 负例、双端公开脚本合并与发布顺序测试。
2. 只读查询 CF 当前配置、两端公开 API、EO 正式项目与当前 EO Production 部署 ID；两端激活版本和公开聚合必须完全一致。读取当前公开 `/deployment-assets.json`，下载并校验上一版所有公开 `_astro` 脚本，和本次两端构建取并集。
3. 重跑两端产物泄漏扫描，再用固定 Makers CLI 1.6.41 打包；执行 CLI 最终合并入口，验证四条 API、演示登录及静态回源。生成新的公开资源清单，只有公开 JS/CSS 文件名和 SHA-256；不包含学生数据、私有版本 manifest 或凭据。
   - CLI 安装可复现：`config/edgeone-cli/package.json` + `package-lock.json` 已入库（edgeone 1.6.41 及全部传递依赖的 resolved/integrity 都在锁里）；安装步骤把这对文件复制到 gitignore 的生成目录 `.edgeone-build/cli`，再 `npm ci --prefix "$install_dir" --ignore-scripts` 严格按它安装（`--ignore-scripts` 已实测不破坏该版本 CLI）。该步骤只访问 npm registry，不接触部署 Token。
   - `tests/edgeone-package.test.mjs` 需要上面 `--package-cli` 的打包产物，因此**只在部署流程执行**（打包后紧跟 `node --test`，即本步骤），不在 `ci.yml` 里跑；CI 侧的同契约覆盖是 `npm run check:edgeone` 里的未打包 fixture（`tests/edgeone-adapter.test.mjs`）。
4. **EO 真实预览验收**：在同一正式项目创建 Preview 部署，使用临时预览 URL 检查首页、正式公开聚合与资源清单。失败时不更新生产。签名 URL 不输出或上传到 artifact。
5. **EO 兼容部署**：发布旧 EO 公开 HTML、本次 API 和全部新旧公开脚本；读回脚本字节，并检查首页与公开 API。目录必须是 `edgeone-compatibility/.edgeone`：CLI 依赖字面 `.edgeone` 目录名识别已编译产物，改名会把合并入口误当成根路径函数。此时 CF 的旧页面和 EO 的旧页面都能继续运行。
6. **CF 正式部署**：从构建产物派生候选，显式保留两条本站路由、既有 SESSION namespace、workers.dev/preview 标志及当前 `DATA_RELEASE_ID`，用 `--keep-vars` 发布。`--keep-vars` 会保留线上既有的两项应用 Secrets —— 本流程只**不覆盖**它们，没有任何读回接口能验证其取值，所以结果字段只声称路由与 KV 绑定未变（`bindingsAndRoutesUnchanged`），不声称 secrets 未变。读回每个脚本字节。
7. **EO 最终正式部署**：更新为本次新 HTML；再次核对公开 API、版本、资源清单和脚本字节。发布前先确认 EO 当前 Production 部署仍是本次兼容阶段刚发布的那个（`EDGEONE_PRODUCTION_DEPLOYMENT_CHANGED`）—— 兼容阶段本身就是一次 Production 发布，所以「与 prepare 基线相同」只适用于 deploy 开头（`EDGEONE_PRODUCTION_CHANGED_SINCE_PREPARE`），不适用于这里。CF 路由集合、KV、入口标志与激活版本必须保持不变。

CLI 一律以非交互方式运行：`production-deploy.mjs` 不再向 `makers deploy` 注入 `y`，需要交互确认时会直接失败而不是被替用户确认；`--token` 仍是 CLI 唯一已知的非交互凭据接口，其取值与 `eo_token=` 查询参数都会在私有日志里脱敏。

这样在 CF 更新前，EO 已能提供 CF 新页面引用的脚本；EO 新页面出现前，CF 也已具备 EO 新脚本。旧脚本继续保留，避免浏览器缓存或打开很久的标签页在切线后失效。本流程不改 DNS，不写真实数据/私有配置，不轮换密钥。API 仍须保持现有前端契约；破坏契约或数据模型变更需另行设计迁移。

首次 CI 使用 `config/production-assets-bootstrap.json`：只记录已上线公开脚本及其哈希，并钉住已验证的 CF/EO 部署 ID。线上没有公开资源清单时，若部署 ID 已变化，拒绝猜测或覆盖。首次成功后均从线上新清单延续。保留集合超过 10,000 个公开脚本时拒绝发布，需要单独评估清理策略，不会自动删旧文件。

## Actions Secret 与权限

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 读取/更新该 Worker，读取 zone Worker routes 并保留本站路由；需对应 Workers Scripts、Worker Routes 权限。使用现有 KV，不上传名单。 |
| `CLOUDFLARE_ACCOUNT_ID` | 若设置，必须与固定生产账号相符；不符则停止。 |
| `EDGEONE_API_TOKEN` | 读取现有 Makers 项目/部署，创建同项目 Preview 验收并执行 production 部署。不能用会过期的本机 CLI 登录状态替代长期 Actions 凭据。 |

两项旧仓库 `DETAILS_*` Secret 不被本流程读取或同步；线上 CF Secrets、EO 私有 KV 配置继续由各平台保管。部署凭据仅注入 prepare/preview/deploy 步骤，构建/测试/打包不继承。供应商输出在工作区私有日志中脱敏；Actions artifact 只保存 `result.json` 的提交 SHA、发布阶段、部署 ID、公开统计等最小证据，不上传供应商日志、旧页面、配置或整个构建目录。

## 失败处理与验收

预检或兼容部署/资源验收失败，不发布 CF。CF 发布后若 EO 最终发布失败，EO 的兼容页面仍可使用，两端新旧脚本均存在；workflow 会失败，不将半完成过程标绿。每阶段结果保存到 `production-deployment-result` artifact。检查当前状态后再修复并重跑，不盲目轮换 Secrets 或退回缺数据的旧 EO 部署。

`result.success: true` 才表示本次生产流程全部完成；完整 CI 成功还需 Actions 两个工作流在同一提交上通过。固定入口与严格 TLS 的运行验收不证明真实大陆终端的选路或跨 CDN 自动续期；这些仍见 [实际分流记录](production-readiness-20261015.md)。

# main 自动发布：CF Workers + EdgeOne Makers

`.github/workflows/ci.yml` 检查 push/PR；`.github/workflows/deploy.yml` 在 push main 或 main 上手动触发时重新运行完整门禁，再串行发布现有生产资源。原独立 EO preview workflow 已合并，避免同次提交只更新一端或误发预览项目。另有 `.github/workflows/preview.yml` 只做 PR 预览（见下文「PR 预览」一节），不在生产发布链路上。`ci.yml` 与 `deploy.yml` 都是 `permissions: contents: read`，`preview.yml` 是 `contents: read` + `pull-requests: write`（只写 PR 评论，不写仓库内容）；CI job 有 30 分钟超时，deploy job 是 60 分钟（六阶段串行、非原子切换，不能被自身超时截断）。三个官方 Action（checkout / setup-node / upload-artifact）钉在 `v4` tag 当时指向的 commit SHA 上，注释里写了取值方式与日期。

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

两项旧仓库 `DETAILS_*` Secret 不被本流程读取或同步；线上 CF Secrets、EO 私有 KV 配置继续由各平台保管。部署凭据仅注入 prepare/preview/deploy 步骤，构建/测试/打包不继承（这里的 `preview` 指 EO 真实预览阶段，不是下节的 PR 预览；PR 预览同样遵守这条纪律）。供应商输出在工作区私有日志中脱敏；Actions artifact 只保存 `result.json` 的提交 SHA、发布阶段、部署 ID、公开统计等最小证据，不上传供应商日志、旧页面、配置或整个构建目录。

## PR 预览（Cloudflare Workers 版本 URL）

`.github/workflows/preview.yml` 给**同仓 PR** 发一个不碰生产的 Cloudflare Workers 预览版本，并把地址贴成该 PR 的粘性评论：触发条件是 `pull_request` 的 `opened` / `synchronize` / `reopened`（`preview.yml:12-14`）；同一 PR 用并发组 `classmap-preview-<n>` 且 `cancel-in-progress: true`，新 push 取消上一轮（`preview.yml:22-24`）；评论按固定 marker `<!-- classmap-preview -->` 定位，已存在就 PATCH、没有才 POST，因此同一 PR 只有一条预览评论（`preview.yml:81-98`）。**预览不是门禁**：它失败或没跑都不阻塞合并；生产发布仍然只由 `deploy.yml` 的 push main / 人工触发决定。

### 与生产零共用：独立 worker + 预览 KV + demo 夹具

- worker：`class1forever-preview`（`scripts/preview-runtime.mjs:43`），与生产 `class1forever` 完全分开，预览流量不会打到生产 worker。
- KV：`CLASS_MAP_DATA` 绑 `wrangler.jsonc:15` 的 `preview_id` = `2761c6566ea945c2ac44da3a916cb840`（`scripts/preview-runtime.mjs:45`）。生产 id `e6c9c4ff…` 被机器化断言拒绝：`assertPreviewConfig()` 在写预览配置前后各校验一次，`kv_namespaces` 必须只有 `CLASS_MAP_DATA` 一项且 id 是预览 id，序列化结果里一旦出现生产 id 就抛错退出（`scripts/preview-runtime.mjs:163-191`、`:218-224`）。
- 数据：`npm run seed:preview` 把 `scripts/local-runtime.mjs` 的 demo 合成夹具 `FIXTURE_STUDENTS`（经 `shared/data-model.mjs` 的 `normalizeStudents` / `buildPublicDataset` 生成，与 `upload-kv-data.mjs` 同源）写成 `students:public:v1` / `students:raw:v1` 两键，写入**预览**命名空间（`scripts/preview-runtime.mjs:336-374`）。脚本**不读 `js/data.js`**，真实名单不可能经这条路进预览；页面口令是仓库常量 `demo`（`scripts/local-runtime.mjs:43`），两个 demo secrets 只在上传期间写临时文件、`finally` 里删除（`scripts/preview-runtime.mjs:235-248`、`:455-457`）。
- 动作：`wrangler versions upload` **只上传一个版本、不改任何流量** —— 不部署生产 worker、不动生产 KV、不改 DNS。

### 为什么不用 `--env preview`

`wrangler deploy` / `versions upload` 一执行就会被 Astro 适配器**重定向**到 `dist/server/wrangler.json`（dry-run 会打印 "Using redirected Wrangler configuration"）。那份生成配置里**没有 `env.preview` 块**（只有 `definedEnvironments:["preview"]`），所以 `--env preview` 解析出来的是**生产** KV id `e6c9c4ff…`（dry-run 实测读数如此）——预览会读写生产数据。在 `wrangler.jsonc` 里写 `env.preview` 也没用：重定向后的配置不带它。

所以预览必须走**显式 `--config`**：`writePreviewConfig()`（`scripts/preview-runtime.mjs:197-232`）照 `scripts/local-runtime.mjs` 的 `writeLocalConfig()` 范式，从 `dist/server/wrangler.json` 派生 `.wrangler/preview/wrangler.json` —— 删掉重定向元数据与 `dev` / `previews` / `secrets` / `env` 块，`name` 换成 `class1forever-preview`，`main` 与 `assets.directory` 换成 dist 内的绝对路径，`kv_namespaces` 重写成唯一的预览绑定，`vars` 换成 demo 提示语。这份文件里没有重定向元数据，wrangler 不会再跳走。`npm run preview:write-config` 只做派生这一步，便于人工 dry-run 自检。

### 凭据边界

部署凭据只挂在真正需要它的两步的 step 级 env：`Seed preview KV with demo fixtures` 与 `Upload preview version`（`preview.yml:55-61`、`:64-79`）。`npm ci` 与 `npm run build` 跑的是 PR 里的代码，这两步**不带任何部署凭据**，与 `deploy.yml:38` 的 "Build/test/package steps never receive deployment credentials" 同一条纪律。

token 优先取专用 `CLOUDFLARE_PREVIEW_API_TOKEN`，未设置时回退通用 `CLOUDFLARE_API_TOKEN`（`preview.yml:59`、`:67`），`CLOUDFLARE_ACCOUNT_ID` 照旧。推荐专用 token 的权限范围只到：预览 worker `class1forever-preview` 的 **Workers Scripts: Edit** + 预览 KV 命名空间 `2761c656…` 的 **Workers KV Storage: Edit**（不需要生产 worker / 生产 KV 的任何权限）。

**仍需知道的风险**：这个 job 会用部署凭据执行 PR 里的代码（`npm ci` / `npm run build` 就跑 PR 内容，同一 runner 上的进程共享环境）。因此它只对**同仓 PR** 触发 —— `preview.yml:29` 的 `if` 比较 `head.repo.full_name` 与 `repository`，fork PR 拿不到 secrets，直接跳过而不是失败。若将来引入外部协作者，应把该 job 放进带 **required reviewers** 的 GitHub Environment，让每次预览执行都经过一次人工批准。

### 首次自举与人工替代

`class1forever-preview` 第一次跑时还不存在，`versions upload` 会报 not found；`uploadPreviewVersion()` 会先 `wrangler deploy --config .wrangler/preview/wrangler.json --secrets-file …` 建出 worker，再重试一次 upload（`scripts/preview-runtime.mjs:416-437`）。人工替代（例如不想让 CI 自己建）：

```bash
npm run build
npm run preview:write-config   # 只派生 .wrangler/preview/wrangler.json
npx wrangler deploy --config .wrangler/preview/wrangler.json --secrets-file <secrets.json>
npm run seed:preview
npm run preview:upload -- --alias pr-<n> --tag pr-<n>
```

人工 `deploy` 必须带 `--secrets-file`（内容为 demo 的 `DETAILS_PASSPHRASE` / `DETAILS_SESSION_SECRET` / `DETAILS_HINT`）：不带的话新 worker 没有 demo 口令，`detailModeAvailable=false`，页面只渲染公开数据、详情面板永远打不开。若本机 wrangler 不认 `deploy --secrets-file`，脚本会退回不带该参数的 deploy，demo 口令仍由随后的 upload 写入（`scripts/preview-runtime.mjs:424-427`）。

预览地址在 PR 的粘性评论里；上传脚本最后单独打印一行 `PREVIEW_URL=<url>`（`scripts/preview-runtime.mjs:453`），workflow 用 `sed` 抓这一行（`preview.yml:74`），抓不到就非零退出。

## 失败处理与验收

预检或兼容部署/资源验收失败，不发布 CF。CF 发布后若 EO 最终发布失败，EO 的兼容页面仍可使用，两端新旧脚本均存在；workflow 会失败，不将半完成过程标绿。每阶段结果保存到 `production-deployment-result` artifact。检查当前状态后再修复并重跑，不盲目轮换 Secrets 或退回缺数据的旧 EO 部署。

**失败必须可分类、可定位**（2026-10-16 的教训：EO 兼容包其实已经发布成功，但随后的控制面读回拿到一个没有 `Deployments` 数组的响应，`TypeError` 被归成一句 `PRODUCTION_DEPLOY_FAILED`，从运行页完全看不出死在哪）：

- 控制面**只读**调用（CF `/client/v4/*`、EO `pages-api`）有 45 s 超时与 3 次有界重试；发布动作（CLI）绝不重试。
- 传输与响应体异常各有独立错误码：`CLOUDFLARE_API_TIMEOUT` / `_UNREACHABLE` / `_INVALID_BODY_<status>`，`EDGEONE_API_TIMEOUT` / `_UNREACHABLE` / `_INVALID_BODY_<status>`；控制面返回的部署列表不是数组时是 `EDGEONE_DEPLOYMENTS_MISSING`，而不是靠 `.some` 抛类型错误。
- 真的走到兜底时，stderr 的 JSON 会带 `phase` 与 `cause`（只有 `error.name`，例如 `TYPEERROR` / `TIMEOUTERROR`，**不打印 message**，避免带出 URL、响应片段或凭据），并把这组 `{code, cause, phase}` 追加写入会上传的 `result.json` 的 `failure` 字段。
- CLI 非零退出且过滤后没有任何可打印行时，会额外打印 `{"phase":…,"status":"cli-failed","exit":…,"signal":…,"spawnError":…}`，用来区分「CLI 失败」与「CLI 成功但读回校验失败」。

`result.success: true` 才表示本次生产流程全部完成；完整 CI 成功还需 `ci.yml` 与 `deploy.yml` 两个工作流在同一提交上通过（PR 预览 `preview.yml` 不是门禁，不计入）。固定入口与严格 TLS 的运行验收不证明真实大陆终端的选路或跨 CDN 自动续期；这些仍见 [实际分流记录](production-readiness-20261015.md)。

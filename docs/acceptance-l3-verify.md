# l3_verify 验收记录：三层验收（状态层 / 结构层 / 成果层）

- 节点：`l3_verify`（图 `astro-migration`，class=standard），执行者 `exec-verify`（叶子，未转派、未使用 subagent）。
- 日期：2026-10-12；分支 `astro-migration`，工作区 HEAD `90c182b`。
- 范围：**只读核验 + 验收记录落盘**。未修改任何实现文件（`src/**`、`js/**`、`css/**`、`build.js`、`scripts/**`、`.github/**`、`package.json`、`.graph/**`）。
  - 新增证据仅落在 `.wrangler/verify/**`（scratch，不属于交付物）与本文件。
  - 唯一一次写实现文件是「注入反例」：`src/components/SiteFooter.astro` 临时注入后按 sha256 **逐字节还原**（见 §3.1）。
- 环境：`TEMP=$PWD/.wrangler/probe-tmp TMP=$PWD/.wrangler/probe-tmp`；跑 `npm run build` 前用 `netstat` 确认 88xx/89xx 无 dev server 占 `dist`（见 §7 进程处置）。

---

## 1. 状态层读数（cp1 前半）

命令：`graph status --graph astro-migration`、`graph next --graph astro-migration --json`
原始输出：`.wrangler/verify/l3v-structure-readings.txt`；逐节点状态：`.wrangler/verify/l3v-node-statuses.txt`

```text
### graph status   （逐字引用 .wrangler/verify/l3v-structure-readings.txt）
节点状态分布 (工作流 17 顶点):
  pending: 1
  running: 1
  passed: 15

✅ 拓扑排序通过 (24 节点)

### graph next --json   （同文件；下面为原样 JSON 中我关心的字段）
  ready: []
  ready_eligible: []
  stale_running: []
  blocked: [ { id: l4_cutover, unmet: [ {id: l3_verify, status: running} ] } ]
  running: [ { id: l3_verify, assigned_to: exec-verify } ]
  summary: { total: 17, pending: 1, ready: 0, running: 1, passed: 15, failed: 0, blocked: 0, cancelled: 0 }
```

> 说明（P5 更正）：`graph status` 的人读输出**只打印 pending/running/passed 三行**，未打印 failed/blocked/cancelled；`failed:0/blocked:0/cancelled:0` 来自 `graph next --json` 的 `summary` 块，已如上分列，不再混排进 `graph status` 段落。

17 个工作流顶点：`l1_spec/l1_scaffold/l1_api/l1_test/l1_shell/l2_visual/l2_motion/l2_map/l2_dialogs/l2_share/l2_contract_rev/l2_island_contract_fix/l3_typecheck_fix/l3_gates/l3_parity` = **passed（15）**；
`l3_verify` = running（本节点自身，验收中的正常态）；`l4_cutover` = pending（**下游人工 gate，pending 属正常**）。
知识顶点（`ctx_runtime/ctx_ui/ctx_delivery` = context，`adr_0001..0004` = proposed）**不计入 task 残留口径**。

**结论：除下游 `l4_cutover` 外，无 failed / blocked / pending / cancelled 残留的 task 节点。** 与 brief 口径一致。

---

## 2. 结构层读数（cp1 后半）

### 2.1 `graph validate`

命令：`graph validate --graph astro-migration`（退出码 0）
原始输出：`.wrangler/verify/l3v-structure-readings.txt`

```
✅  节点: 24 个
✅  边: 34 条
✅  拓扑排序: 24 节点通过
✅  循环检测: 无环路
📊  结果: 0 错误, 0 警告
```

**结论：0 error / 0 warning。**

### 2.2 `check-design`

命令：`node ~/.pi/agent/skills/plumber-execute/scripts/sp.mjs check-design . --graph astro-migration`（退出码 0）
原始输出：`.wrangler/verify/l3v-check-design.txt`

```
📋 设计体检: …（24 节点 / 34 边）
  ⚠️ [W5] edges/e002.deleted.yaml: 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边）
  ⚠️ [W5] edges/e_l2fix_dep_dialogs.deleted.yaml: 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边）
  ⚠️ [W5] edges/e_l2fix_dep_map.deleted.yaml: 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边）
  ⚠️ [W5] edges/e_l3gates_dep_l2fix.deleted.yaml: 磁盘存在但 graph.yaml 未引用（孤儿文件/幽灵边）
⚠️ 4 个 warning（建议修）
```

**结论：0 error；4 条 W5 是软删归档机制的已知假阳性。**
- 事实核验：这 4 个 `.deleted.yaml` 与**同名活边**并存（`edges/e002.yaml` 与 `edges/e002.deleted.yaml`、`e_l2fix_dep_dialogs.yaml` 与 `.deleted.yaml` …），内容是被软删的旧边定义。软删的契约就是「软删除边并保留 `.deleted.yaml`」（`graph_delete_edge`）。
- check-design 的 W5 把「磁盘存在但 `graph.yaml` 未引用的 `edges/*.yaml`」一律当孤儿，未把 `.deleted.yaml` 后缀排除，故为**工具侧假阳性，不是图的错误**。
- **未手删任何 `.graph/**` 文件**（硬纪律：`.graph/` 只经 CLI/MCP）。

---

## 3. 成果层逐条核验（cp2）

图级 `exit.acceptance_criteria` 共 5 条，逐条给可核验事实。**不信报告信 artifact。**

### 3.1 标准 1：`npm run build` 退出码 0（含类型检查 + 四项静态安全断言 + 对比度同值断言），注入违规时构建失败

**（a）自己复跑**（`TEMP/TMP` 指向工作区）：
- 命令：`TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run build`
- **退出码 0**；原始输出 `.wrangler/verify/l3v-npm-build.log`
- 日志关键读数：
  - `▶ astro check` → `Result (48 files): - 0 errors - 0 warnings - 0 hints`
  - `▶ astro build` → `Complete!`；`⚠️ dist/server/.dev.vars 由 wrangler 构建时从仓库根拷入，已就地移除`
  - `✅ 构建与静态安全门禁通过：静态断言 13 组（含对比度/调色板 37 项）、astro check 与 astro build 退出码 0、产物扫描无泄漏。`
- 门禁分层（静态 A–I + astro J/K + 产物 L + 运行时 M）见 `docs/build-gates.md`。
- **P1 修复后复跑（2026-10-12，本节点）**：`npm run build` **退出码 0**，日志改为「静态断言 **15 组**（含对比度/调色板 37 项）…」——新增的 A2 生成类型门禁（`worker-configuration.d.ts` 缺文件 / 被 .gitignore 吞 / `wrangler types --check` 漂移）已在位。证据：`.wrangler/verify/l3v-npm-build-postP1.log`。

**（b）注入反例（自己构造，不引用他人报告）**：
- 注入：在 `src/components/SiteFooter.astro` frontmatter 首行插入 `import data from '../../js/data.js';`（即 exit 标准 1 点名的「页面引用学生明细数据文件」形态）。
- 命令：`npm run build` → **退出码 1**，命中**预期的** Gate B 断言：
  `❌ src/components/SiteFooter.astro 引用了 js/data.js：完整学生名单不能回到静态资源里（只有上传脚本与测试可以读它）。`
- 还原：`sha256` 前后一致 —
  `SHA256_BEFORE = SHA256_AFTER = f0d7cbf50bf3d5d25911d4dc39214f671bc421de71ff2b1663498c72de721b9b`，`RESTORE_OK=1`。
- 证据：`.wrangler/verify/l3v-injection.log`、`.wrangler/verify/l3v-injection-build.log`、原件备份 `.wrangler/verify/SiteFooter.astro.orig`。
- 说明：`docs/build-gates.md` 记了 `l3_gates` 的 **19 条**注入反例（14 静态 + 5 产物）；本节点**只独立复跑 1 条**作为门禁有效性的抽样反证，未逐条重放 19 条。

**结论：通过**（含我自己的 exit 0 复跑 + 1 条注入反例 exit 1 且命中预期断言 + 字节级还原）。

### 3.2 标准 2：四个 API 路由字段/状态码/`Vary: Cookie`/限流阈值与旧站逐条一致，对照记录留档

**（a）自己复跑**：
- 命令：`TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run test:api`
- **退出码 0**；`tests 19 / pass 19 / fail 0`；原始输出 `.wrangler/verify/l3v-test-api.log`
- 覆盖四个路由（`tests/api-contract.test.mjs`，node:test，自起本地 Worker + 本地 KV）：
  - `GET /api/map/public`：字段 `detailAccess/detailModeAvailable/detailsHint`，**断言 `Vary: Cookie`**（`assert.match(vary, /(^|,\s*)Cookie(\s*,|$)/)`）+ `Cache-Control: no-store`；KV 空 → 503 `public_data_unavailable`。
  - `POST /api/auth/details`：200 + `Set-Cookie`（`HttpOnly/Secure/SameSite=Lax/Path=//Max-Age=43200`）；错误口令 401 `invalid_passphrase` + `remainingAttempts` 递减；`400 invalid_request_body` / `400 passphrase_required`；**连续失败 10 次后第 11 次 429 `too_many_attempts`**（限流阈值 = 10 / 15 分钟）。
  - `GET /api/map/details`：带会话按省返回 `{province,city,count,people}`（`people` 按 city→school→name 排序）；省级别名归一 + `city` 筛选；无/伪造会话 401；`province` 缺失 400 / 纯空白 400 `invalid_region_query`。
  - `POST /api/auth/logout`：带同源 `Origin` 匿名 POST → 200 + `Max-Age=0`；无 Origin → 403（Astro `checkOrigin`，有意为之）；GET 不成功。

**（b）对照记录留档**：
- 字段/状态码/头/限流阈值逐条来源见 `docs/migration-parity.md` **§1.1–§1.4**（路由契约）与 **§6.1 路由契约核对（cp1）**（含「读旧实现 `functions/api/*` + `_lib/auth.mjs` 逐条对照」记录，例：`RATE_LIMIT_WINDOW_MS=15*60*1000`、`RATE_LIMIT_MAX_ATTEMPTS=10`、`buildSessionCookie` 六属性）。
- 契约 §1.2 与 §7 修订记录解释「403 只发生在无 Origin 的调用方，是 Astro 6 默认 CSRF 防护，不是缺陷」。

**结论：通过**（19/19 断言，含 exit 标准点名的 `Vary: Cookie` 与限流阈值；对照记录在 `docs/migration-parity.md` §6.1，旧站真实对拍在 `docs/parity-acceptance-l3.md` §6/DoD#4）。

### 3.3 标准 3：14 项人工 smoke 逐条复跑通过且有证据（分享图范围与日期 / 触摸长按下钻 / 弹窗 inert 与焦点归还 / 480px 无横向滚动均在案）

**核验对象**：`docs/parity-acceptance-l3.md`（l3_parity 记录）+ 其真实证据文件。**抽查以下 4 条标准点名项 + 若干证据文件存在性与内容匹配**：

| 标准点名的项 | 记录位置 | 抽查的真实证据 | 匹配核验 |
|---|---|---|---|
| 分享图**范围与日期** | `docs/parity-acceptance-l3.md` §1 表 smoke 7 | `.wrangler/parity/evidence/shots/share-national.png`、`share-zhejiang.png`（PNG 魔数 `89504e47…` 通过；各 ~348KB） | 记录称文件名 `蹭饭地图_浙江_2026-10-12.png`、统计 `[浙江人数 2, 覆盖城市 1, 占全班 33%]`；与 `AGENTS.md` 分享图口径一致 |
| 触摸**长按下钻** | 同上 smoke 13 / A6 | `.wrangler/parity/evidence/shots/smoke13-touch.png`（PNG 魔数通过，1.6MB）、`docs/parity-touch-compare.md`、`.wrangler/parity/evidence/parity-touch-new.txt` / `-old.txt` | 记录称 600ms 手势走 `TapFallback`、`source=touch`、一次手势一次激活；`parity-touch-new.txt` 原始输出与新站读数逐字一致（本次已读） |
| 弹窗 **inert 与焦点归还** | 同上 smoke 9 / A8 | `.wrangler/parity/evidence/parity-smoke-8-14.json` → `groups["smoke9 键盘与焦点"]`：口令弹窗 `{"wrapperInert":true,"focusInside":true,"activeId":"auth-passphrase"}`、`Esc` 后 `focusBack="details-btn"`；底部面板 `{"wrapperInert":true,"focusInsideSheet":true}`、关闭后 `{"activeId":"map","bsCloseHidden":true,…}` | 与 `AGENTS.md` FocusScope 契约一致（**P5 更正**：原误指 `shots/smoke6-details.png`，该图证不了 inert/焦点，已改指 JSON 断言记录） |
| **480px 无横向滚动** | 同上 smoke 8 / A12 | `.wrangler/parity/evidence/shots/a14-bottom-strip-480.png`、`smoke8-480.png`（PNG 魔数通过） | 记录称 375/414/480 三档 `scrollWidth<=clientWidth`；`0 人` 刻度右缘不重叠缩放簇 |

**其他抽查**：`smoke14-npm-build.log` 末行逐字为「✅ 构建与静态安全门禁通过：静态断言 13 组（含对比度/调色板 37 项）…」+`EXIT=0`；`smoke14-data-upload-dryrun.log` 为 `{"binding":"CLASS_MAP_DATA",…,"stats":{"total":44,"provinces":13,"cities":18}}`+`EXIT=0`；`parity-31-provinces.md` 的「31 省下钻逐字段一致」记录 `{"mismatched":0,"diff":[]}`，快照 `.wrangler/parity/evidence/parity-31-provinces-snapshot.json` 真实存在（`new`/`old` 两棵对照树，national+provinces）。

**结论：通过（抽样，边界除外）**。14 项 smoke 记录与证据文件真实存在、内容与记录一致；本次为**抽样**核对（4 条点名项 + 若干文件），未做像素级复核；**未复跑旧站**（旧站对拍归 l3_parity）。

**边界（explicit）**：smoke 13 的「台湾」子项**不能计入「逐条通过」**——新旧站事件序列逐字相同（`docs/parity-touch-compare.md`、`.wrangler/parity/evidence/parity-touch-{new,old}.txt`），据此判为**非迁移回归**；但它与 `AGENTS.md` smoke 13 的文字期望「Tap 台湾: the sheet opens instead」不符，按 reviewer 发现 **P2 标为「待人类裁定」**（见 §5）。

### 3.4 标准 4：wrangler 预览部署成功且首页与四个路由可用；生产未被 agent 修改，KV 两键未被改写

**本节点只标注「待 `l4_cutover`」，不代签。** 理由：预览部署、生产 Pages/域名未改、KV 两键未改写的现场核对属下游人工 gate `l4_cutover`（其 DoD 第 2、3 条：预览部署验证记录、生产未变更）。本节点不做生产面操作、不触碰线上配置与 KV。

### 3.5 标准 5：图中全部 task 节点为 passed，图校验 0 error，交叉复核签署在案

- 「图校验 0 error」：**已给读数**（§2.1 `validate` 0 error/0 warning；§2.2 `check-design` 0 error）。
- 「交叉复核签署在案」：由本节点 **cp3**（verifier=`cross_review`）落（记录写入执行报告）。
- 「图中全部 task 节点为 passed」：**待 `l4_cutover`** —— 当前 `l4_cutover` 仍 pending（本次验收要授权的人工 gate）；本节点 running，尚未 passed。故该分句**不代签**。

---

## 4. 待复核清单（交主控转 reviewer，cp3 独立第二双眼）

复核者请**独立复跑**下列命令/读下列证据，并对「希望被质疑的断言」给出同意或反驳。**不建议照抄我的结论。**

| # | 复核对象 | 证据路径 | 希望被质疑的断言 | 建议复核动作 |
|---|---|---|---|---|
| R1 | 状态层「无残留」口径 | `.wrangler/verify/l3v-structure-readings.txt`、`.wrangler/verify/l3v-node-statuses.txt` | 「除 `l4_cutover`(pending) 外无 failed/blocked/pending/cancelled 的 task 节点」；且 `adr_*`(proposed) 与 `ctx_*`(pending) 依法不计入 | 重跑 `graph status` / `graph next --json`；质疑：adr 全 proposed 是否应视为未完成项？ |
| R2 | 结构层 check-design W5 | `.wrangler/verify/l3v-check-design.txt`、`.graph/astro-migration/edges/*.deleted.yaml` | 「4 条 W5 是软删归档假阳性，不是图错误，故不手删」 | `ls edges/` 确认 `.deleted.yaml` 与同名活边并存；质疑：能否在不手改 `.graph/` 的前提下消除该 W5？ |
| R3 | 标准 1 注入反例 | `.wrangler/verify/l3v-injection.log`、`l3v-injection-build.log`、`l3v-npm-build.log`、`.wrangler/verify/SiteFooter.astro.orig` | 「build exit 0；注入 `js/data.js` 后 exit 1 且命中预期 Gate B 断言；sha256 逐字节还原」 | 重跑 `npm run build`（需先 `netstat` 确认 88xx/89xx 空闲）；核对还原 sha256 `f0d7cb…21b9b`；质疑：只 1 条注入（对照 build-gates.md 的 19 条）够不够支撑标准 1？ |
| R4 | 标准 2 API 契约 | `.wrangler/verify/l3v-test-api.log`、`tests/api-contract.test.mjs`、`docs/migration-parity.md` §1.1–§1.4/§6.1 | 「19/19 通过，含 `Vary: Cookie` 与 429 阈值(10 次/15min)」 | 重跑 `npm run test:api`（独立 state-dir）；质疑：本测试是**同源契约测试**，并非与旧站真实响应逐字段对拍——旧站对拍只在 `docs/parity-acceptance-l3.md`，我未复跑旧站 |
| R5 | 标准 3 smoke 证据 | `.wrangler/parity/evidence/**`（含 `parity-smoke-8-14.json` 的 smoke9/A8 断言）、`docs/parity-acceptance-l3.md`、`docs/parity-touch-compare.md` | 「14 项 smoke 记录与证据文件真实存在且内容匹配（抽样 4 条点名项）」；**smoke 13「台湾」子项按 P2 标待人类裁定，不计入逐条通过** | 抽验更多证据；质疑：我只核了 PNG 魔数/文本，未做像素级判读，且**未复跑旧站** |
| R6 | 标准 4/5 的归属标注 | 本文件 §3.4、§3.5 | 「预览部署与生产未改 = 待 `l4_cutover`；全部 task passed = 待 `l4_cutover`；本节点不代签」 | 质疑：是否存在本节点就该独立核的「生产未改」只读事实（如 `git log`/`wrangler` 只读状态）而被我推给了下游 |
| R7 | 只读纪律 | `git status --porcelain`、本文件 §7 | 「未改任何实现文件；唯一写入是注入反例，已 sha256 还原；新增仅 `.wrangler/verify/**` 与本文件」 | 质疑：`src/components/SiteFooter.astro` 是否真与注入前一致（对照备份 sha256） |
| R8 | 旧站基线既有问题 F-P1 | `docs/parity-acceptance-l3.md` §7、`docs/parity-touch-compare.md`、`.wrangler/parity/evidence/parity-touch-{new,old}.txt` | 「触摸点台湾 open-then-close 与旧站逐字一致，非迁移回归；不构成不通过」 | 复核新旧原始输出；质疑：既然 `AGENTS.md` smoke 13 文字期望与之不符，是否应记为验收缺口 |

---

## 5. 交叉复核签署（cp3）

- 复核者：主控派的**独立 reviewer pane**（第二双眼，非本节点执行者）；只读复核，**未代签**。
- 日期：2026-10-12。
- **结论：建议签署（附 3 条边界 + 前置整改）。** 两条轴逐条通过：**规格轴**（对照图级 exit 5 条 + 节点 DoD）、**惯例轴**（与项目既有约定一致）。

### 5.1 复核者独立复跑的事实（与本节点读数一致）

| 复核项 | 复核者独立复跑结果 |
|---|---|
| 状态层 | 同读数：除 `l4_cutover`(pending) 外无残留 task 节点 |
| 结构层 `graph validate` | 0 error |
| `npm run build` | exit 0 |
| 注入反例 | 注入后 exit 1 且命中预期断言，sha256 逐字节还原 |
| `npm run test:api` | 19/19 pass |
| 31 省下钻对照 | `mismatched` 重算为 0 |
| smoke 抽样 | 证据内容匹配（与记录一致） |

### 5.2 复核者的 P1–P5 发现（对应 R1–R8 表态）

| 发现 | 内容 | 处置 |
|---|---|---|
| **P1** | **新树 / CI 红**：`worker-configuration.d.ts` 未提交（CI 不生成）→ 干净 clone 构建面不绿 | **已修复并复核**：exec-backend 在 `l3_gates` 按建法①修复（`git add` 入索引 + `build.js` 新增 A2 生成类型门禁三道拦截 + `package.json` `cf:types`/`cf:types:check` + CI 走 `npm run build`）。本节点独立复核（§5.5）：`git ls-files --cached` 有输出、`git check-ignore` 不匹配、`npm run build` exit 0（静态断言 15 组） |
| **P2** | smoke 13「台湾」子项：新旧事件序列**逐字相同**＝非迁移回归，但与 `AGENTS.md` smoke 13 文字期望「Tap 台湾: the sheet opens instead」不符 | **待人类裁定**；**不计入 exit 标准 3 的「逐条通过」** |
| **P3** | 主控跟进项 | 由主控跟进；**本记录未展开其内容**（主控口径：P1/P2/P3/P4 由主控跟） |
| **P4** | **整迁移尚未提交** | **前置整改**：须由 `l4_cutover`（含提交动作）处理；之后才能宣称可交付 |
| **P5** | **记录侧瑕疵**：① 本记录 §1 代码块把 `graph status` 人读输出与 `graph next --json` 的 `summary` 混排（3 个 `0` 不在 `graph status` 原始输出里）；② §3.3「弹窗 inert 与焦点归还」行误指 `shots/smoke6-details.png`（该图证不了 inert/焦点） | **已在本记录更正**：§1 改为逐字分列引用；§3.3 改指 `parity-smoke-8-14.json` 的 `groups["smoke9 键盘与焦点"]` 断言记录 |

### 5.3 签署边界（explicit，3 条）

1. cp3 **只签「交叉复核已完成、结论可信」**，**不等于 exit 标准 5 成立**（`l4_cutover` pending、本节点 running，均**不代签**）。
2. exit 标准 3 的 **smoke 13「台湾」子项按 P2 标为「待人类裁定」**，**不是「逐条通过」**。
3. 发现 **P1（新树/CI 红）与 P4（整迁移未提交）必须先由 `l3_gates` / `l4_cutover` 修复**，之后才能对外宣称「全绿 / 可交付」。

### 5.4 cp3 签署记录（已落）

- **cp3 签署：通过**（`graph_update_checkpoint cp3=passed`，2026-10-12）。签署范围严格限于「**交叉复核已完成、结论可信**」。
- 签署前置条件已满足：主控通知「P1 已修」，本节点完成 §5.5 的三项独立复核。
- 本节点**未写 verdict、未流转 `l3_verify` 为 passed**（裁决归主控/裁决方）。
- 与 §5.3 的三条边界合读：本签署**不**代表 exit 标准 5 成立，也**不**代表 smoke 13「台湾」子项已「逐条通过」（P2 待人类裁定），也**不**代表已可对外宣称「全绿/可交付」（P4 整迁移未提交归 `l4_cutover`）。

### 5.5 P1 修复的独立复核（本节点，P1 判据）

| 复核项 | 命令 | 结果 |
|---|---|---|
| 类型文件已入索引 | `git ls-files --cached -- worker-configuration.d.ts` | 有输出：`worker-configuration.d.ts` |
| 未被 .gitignore 匹配 | `git check-ignore -v -- worker-configuration.d.ts` | 退出码 **1**（无输出，即**不**被忽略） |
| 构建全绿 | `TEMP/TMP=$PWD/.wrangler/probe-tmp npm run build` | **退出码 0**；「静态断言 **15 组**」；日志 `.wrangler/verify/l3v-npm-build-postP1.log` |

- 复核前 `netstat` 确认 88xx/89xx 无 dev server 占 `dist`（仅 `8934` 图预览）。
- 复核者（reviewer）未代签；P1 的修复记录归 `l3_gates`（exec-backend）。

---

## 6. 边界与未验事项（如实）

1. 本节点**未复跑旧站**任何对拍（旧站对拍归 l3_parity，证据在 `.wrangler/parity/`）。
2. 本节点**未做预览部署 / 生产面核对 / KV 读写**（归 l4_cutover）。
3. 本节点**未逐条重放** `docs/build-gates.md` 的 19 条注入反例，只独立复跑 1 条。
4. smoke 证据为**抽样**核对，未做像素级判读。
5. 「全部 task passed」当前**不成立**（`l4_cutover` pending、本节点 running），故标准 5 该分句待 `l4_cutover`。
6. ADR `adr_0001..0004` 均为 `proposed`：accept 属人类裁决，**不是本节点的残留项**。
7. **前置整改（复核发现 P1/P4，不由本节点处理）**：`worker-configuration.d.ts` 未提交/CI 不生成（P1，打回 `l3_gates`）、整迁移尚未提交（P4，归 `l4_cutover`）。修好前不得对外宣称「全绿/可交付」。
8. **P2（smoke 13 台湾子项）待人类裁定**：不计入 exit 标准 3 的「逐条通过」。

---

## 7. 环境与进程处置（披露）

- 复跑 `npm run build` 前 `netstat` 发现 l3_parity 遗留的 4 个本地 scratch 服务仍占端口/产物：`8912`/`8914`（`wrangler dev` → `workerd`，持 `dist/`）与 `8913`/`8915`（`.wrangler/parity/old-site-server.mjs`，旧站对拍替身）。
- 处置：`taskkill /T /F` 结束这 4 组进程树（含其 `wrangler` 父进程），仅保留图预览 `8934`（未触碰）。这些是已 passed 的 l3_parity 的临时对拍服务，非交付物、重启无副作用。
- 之后 `npm run build` / `npm run test:api` 均正常（`dist` 无争用）。

---

## 8. 证据索引（真实路径）

| 内容 | 路径 |
|---|---|
| 状态层 + 结构层原始读数 | `.wrangler/verify/l3v-structure-readings.txt` |
| 逐节点状态表 | `.wrangler/verify/l3v-node-statuses.txt` |
| check-design 原始输出 | `.wrangler/verify/l3v-check-design.txt` |
| `npm run build` 复跑日志（exit 0，P1 前，13 组） | `.wrangler/verify/l3v-npm-build.log` |
| `npm run build` 复跑日志（exit 0，P1 后，15 组） | `.wrangler/verify/l3v-npm-build-postP1.log` |
| 注入反例（sha256 + exit 1） | `.wrangler/verify/l3v-injection.log` |
| 注入后 build 失败日志 | `.wrangler/verify/l3v-injection-build.log` |
| 注入前原件备份 | `.wrangler/verify/SiteFooter.astro.orig` |
| `npm run test:api` 复跑日志（19/19） | `.wrangler/verify/l3v-test-api.log` |
| 上游 l3_parity 验收记录 | `docs/parity-acceptance-l3.md` |
| 构建门禁分层文档 | `docs/build-gates.md` |
| 迁移等价性契约 | `docs/migration-parity.md` |
| 触摸新旧对照 | `docs/parity-touch-compare.md` |
| smoke 证据目录（上游） | `.wrangler/parity/evidence/**` |

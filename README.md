# class1forever

班级同学分布地图。公开页面只展示省市聚合统计；姓名和学校信息通过 Cloudflare Pages Functions + KV 在口令验证后按地区读取。

Forked from [lvris/map](https://github.com/lvris/map)

## 访问地址

- Cloudflare Pages: https://class1forever.pages.dev/

## 当前架构

项目已经从“静态打包整份学生数据”的方式切换到 Cloudflare Pages Functions + KV：

- 公开页面只请求 `/api/map/public`，只返回省市聚合统计。
- 完整学生数据只保存在 Cloudflare KV 绑定 `CLASS_MAP_DATA` 中。
- 输入口令后，前端通过 `/api/auth/details` 建立登录状态。
- 建立登录状态后，前端再按地区请求 `/api/map/details`，只拿当前地区的姓名和学校信息。
- `js/data.js` 只作为本地上传脚本的数据来源，不再被网页直接加载。

这样做的目的，是避免把完整学生名单作为静态资源直接发给所有访问者。

## 前端地图

地图用 Apache ECharts 渲染，几何数据、渲染库、页面逻辑三者是分开的：

- `js/geo.js` 只提供 `CMapGeo` 注册表，不依赖任何图表库。
- `js/china.js` 与 `js/province/*.js` 是导出好的 GeoJSON，只调用 `CMapGeo.register(...)`。
- `js/map.js` 把需要的条目交给 ECharts，负责上色、下钻、悬浮卡片、缩放限制与分享图。

渲染库不走 CDN，而是提交在仓库里的按需构建产物 `js/vendor/echarts.min.js`：
同源加载让页面完全离线可用，也让 `_headers` 里的 CSP 能收紧成 `script-src 'self'`。
产物只包含 map / geo / tooltip / visualMap / labelLayout / canvas。
升级 ECharts 时执行 `npm run vendor:build` 重新生成，产物本身要一起提交。

## 仓库结构

- `index.html`: 页面结构、底部面板与弹窗结构。
- `js/boot.js`: 按顺序加载渲染库、几何数据与页面脚本，失败时给出重试入口。
- `js/geo.js`: 地图几何数据注册表，以及可下钻省份白名单。
- `js/china.js`, `js/province/*.js`: 全国与各省 GeoJSON。
- `js/map.js`: 地图渲染、公开数据、详情查看交互、分享图。
- `js/vendor/echarts.min.js`: 按需构建的 ECharts。
- `css/main.css`: 页面样式、地图控件、悬浮卡片、移动端样式。
- `functions/`: Cloudflare Pages Functions 接口。
- `shared/data-model.mjs`: 数据规范化、公开聚合统计生成逻辑。
- `scripts/upload-kv-data.mjs`: 将本地数据写入 Cloudflare KV。
- `scripts/build-vendor.mjs`: 重新生成 ECharts 按需构建产物。
- `tests/dev-server.mjs`: 本地前端调试服务器，用假数据顶替 Pages Functions。
- `wrangler.jsonc`: Cloudflare Pages / KV 绑定配置。
- `.dev.vars.example`: 本地开发需要的 secret 模板。
- `DEPLOYMENT.md`: 更完整的部署与排障说明。

## 常用命令

- `npm install`
  安装依赖。首次接手项目时先执行一次。

- `npx wrangler login`
  登录 Cloudflare 账号。上传 KV、启动本地 Pages 环境前需要先完成。

- `npm run build`
  静态安全检查：确认页面没有重新引入 `js/data.js`、没有跨域脚本和内联脚本、
  没有残留旧地图库的引用，并且 `js/geo.js` 的省份白名单与 `js/province/` 目录一致。

- `npm run dev:mock`
  启动本地调试服务器（默认 http://127.0.0.1:8788），用生成的假数据顶替 Pages Functions，
  不需要 Cloudflare 账号就能验证地图渲染、下钻、口令流程和分享图。口令默认是 `demo`。

- `npm run cf:dev`
  启动本地 Pages Functions 开发环境，读取远端 KV 与 `.dev.vars`。

- `npm run vendor:build`
  重新生成 `js/vendor/echarts.min.js`。只在升级 ECharts 时执行。

- `npm run data:upload -- --dry-run`
  检查当前数据源是否能正确生成 KV 需要的两份数据。

- `npm run data:upload`
  上传生产环境数据到 Cloudflare KV。

- `npm run data:upload:preview`
  上传预览环境数据到 Cloudflare KV。

### 用真实聚合数据调试前端

公开数据只有人数，可以安全导出，用来看真实数字下的渲染效果：

```bash
npx wrangler kv key get students:public:v1 \
  --namespace-id=<wrangler.jsonc 里的 preview_id> --remote --text > public.json
PUBLIC_DATA_FILE=public.json npm run dev:mock
```

`students:raw:v1` 含姓名与学校，不要导出。用这种方式调试时，地图上的聚合人数是真实的，
详情面板里的同学仍然是假数据。


## 首次接手项目

推荐按下面顺序完成初始化：

1. 执行 `npm install`。
2. 执行 `npx wrangler login`，确认 Cloudflare 账号可用。
3. 复制 `.dev.vars.example` 为 `.dev.vars`，填入本地调试所需的 secret。
4. 检查 `wrangler.jsonc` 中的 `CLASS_MAP_DATA` 绑定、`preview_id`、`remote: true` 是否仍然指向正确环境。
5. 执行 `npm run data:upload -- --dry-run` 检查本地数据。
6. 执行 `npm run data:upload:preview`，先把预览环境数据上传到 KV。
7. 执行 `npm run cf:dev` 启动本地调试。

## 本地开发

### 1. 准备本地变量

复制 `.dev.vars.example` 为 `.dev.vars`，填入本地开发所需值：

```bash
DETAILS_PASSPHRASE=你的口令
DETAILS_SESSION_SECRET=一段足够长的随机字符串
DETAILS_HINT=前端显示的提示语，可选
```

`.dev.vars` 已在 `.gitignore` 中忽略，不会提交到仓库。

### 2. 准备数据

上传脚本支持两种数据来源：

- 环境变量 `STUDENTS_DATA`
- 本地未提交的 `js/data.js`

如果本地保留了 `js/data.js`，它只会被上传脚本读取，不会被网页直接访问。

### 3. 上传测试数据

先检查：

```bash
npm run data:upload -- --dry-run
```

再上传到 Cloudflare KV：

```bash
npm run data:upload
```

如果你希望本地开发优先读取预览环境 KV，则执行：

```bash
npm run data:upload:preview
```

### 4. 启动本地开发服务

只想调前端时，用假数据就够了，也不需要 Cloudflare 账号：

```bash
npm run dev:mock
```

需要验证 Pages Functions、远端 KV 与真实口令时，再改用：

```bash
npm run cf:dev
```

当前 `wrangler.jsonc` 已为 `CLASS_MAP_DATA` 配置 `remote: true` 和 `preview_id`。因此本地开发时，Pages Functions 会直接读 Cloudflare 上的远端 KV，而不是读一个空的本地 KV 模拟环境。

如果本地打开后看到“地图公开数据尚未配置”，通常说明预览环境 KV 里还没有 `students:public:v1`，需要先执行一次 `npm run data:upload:preview`。

## 部署方式

### GitHub 自动部署

这个仓库当前主分支是 `main`。如果你的 Cloudflare Pages 项目已经连接到这个仓库，并把 `main` 配置为 production branch，那么：

```bash
git add <需要提交的文件>
git commit -m "Your commit message"
git push origin main
```

推送完成后，Cloudflare Pages 会自动开始新的生产部署。

### 手动部署

如果需要手动发布当前版本，可以在仓库根目录执行：

```bash
npx wrangler pages deploy .
```

## 推送前检查

建议在提交前确认以下几点：

1. `.dev.vars` 没有被加入暂存区。
2. `js/data.js` 没有被加入暂存区。
3. `npm run build` 能正常通过。
4. 本地页面可以正常显示公开地图。
5. 输入正确口令后，可以查看某个地区的同学信息。
6. 浏览器 `Network` 与 `Sources` 中不存在 `js/data.js` 或整包学生名单。

`npm run dev:mock` 起来之后，可以照着下面这份清单手动过一遍：

1. 地图正常渲染，底部色带显示「0 人 ~ 当前最大值」。
2. 鼠标悬停省份时出现卡片，色带上同步标出对应人数。
3. 单击有数据的省份下钻，左上角出现「返回全国」，按 Esc 或点它都能回到全国视图。
4. 台湾、香港、澳门、南海诸岛没有省级地图，点击时直接弹出人数面板，控制台不应出现 404。
5. 滚轮或按钮放大地图后拖动，地图不会被拖出可视区域；缩放不会小于铺满视图。
6. 点击「同学信息」输入错误口令会被拒绝，输入正确口令后可以查看地区明细。
7. 点「退出查看」后回到未登录状态，缓存的明细被清空。
8. 分享按钮能生成 PNG，图片里包含地图、色带图例和统计数字。
9. 用窄屏或手机访问，控件不重叠、页面不出现横向滚动。


## 注意事项

- 本项目数据仅供内部使用，请勿外传。
- 如果历史提交里出现过 `js/data.js` 或其他敏感文件，建议额外清理 Git 历史。
- 更完整的 Cloudflare 配置、部署与排障说明见 `DEPLOYMENT.md`。

## 许可证

MIT License

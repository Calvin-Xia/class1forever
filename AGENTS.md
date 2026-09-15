# Repository Guidelines

## Project Overview
Static classmate-distribution map ("蹭饭地图"). The page shows public province/city aggregate counts; names and schools are returned per-region only after a passphrase-authenticated session provided by Cloudflare Pages Functions + KV. Student data is never shipped as a static asset.

## Project Structure & Module Organization
- `index.html`: single-page entry point, map chrome (toolbar / zoom / legend), bottom-sheet and auth-modal markup.
- `js/boot.js`: loads the vendor bundle, geo data and app script in order; shows the retry panel on failure.
- `js/geo.js`: `CMapGeo` registry for geo data plus the whitelist of provinces that ship a map file.
- `js/china.js`, `js/province/*.js`: national/province GeoJSON as `CMapGeo.register("cn/<slug>", {...})` calls; the data is generated upstream and only the registration call is ours.
- `js/map.js`: ECharts setup, choropleth + hover card, drilldown/drill-up, view clamping, public-data fetch, passphrase/detail flow, share image.
- `js/vendor/echarts.min.js`: tree-shaken ECharts build (map/geo/tooltip/visualMap/labelLayout/canvas). Regenerate with `npm run vendor:build`; the committed artifact is what ships.
- `css/main.css`: layout, theme, map controls, tooltip, bottom-sheet, and auth-modal styles.
- `js/data.js`: local-only input for the upload script; gitignored, never loaded by the page.
- `js/data.template.js`: data shape template (`name/school/city/province`).
- `functions/`: Pages Functions routes — `api/map/public`, `api/map/details`, `api/auth/details`, `api/auth/logout`.
- `shared/data-model.mjs`: normalization, province aliases, aggregate build, region filter/sort (used by Functions and the upload script).
- `scripts/upload-kv-data.mjs`: builds `students:raw:v1` / `students:public:v1` and uploads them to `CLASS_MAP_DATA` KV; sources from `js/data.js` or the `STUDENTS_DATA` env var.
- `scripts/build-vendor.mjs`: rebuilds `js/vendor/echarts.min.js` from `node_modules/echarts`.
- `tests/dev-server.mjs`: local mock of the Pages Functions API plus a static server, used for frontend smoke tests without Cloudflare credentials.
- `build.js`: static safety checks (see Testing Guidelines).
- `wrangler.jsonc`, `README.md`, `DEPLOYMENT.md`: Cloudflare config, usage, and deployment docs.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run build`: static safety checks only; no bundling — files are served as-is from the repo root.
- `npm run dev:mock`: local mock of `/api/*` on http://127.0.0.1:8788 (passphrase `demo`). Preferred for frontend work; pass `PUBLIC_DATA_FILE=<path>` to drive it with a real `students:public:v1` export.
- `npm run cf:dev`: local Cloudflare Pages dev server (serves the real `/api/*` and reads the remote KV). In non-interactive shells it needs `CLOUDFLARE_API_TOKEN` (or `wrangler login` once interactively); the remote KV binding can fail to start in restricted sandboxes, in which case use `npm run dev:mock` for frontend checks.
- `npm run vendor:build`: regenerate the committed ECharts bundle after upgrading `echarts`.
- `npm run data:upload -- --dry-run`: validate the data source can build both KV datasets.
- `npm run data:upload` / `npm run data:upload:preview`: upload to production / preview KV.
- `git log --oneline -n 10`: inspect recent commit style before committing.

## Coding Style & Naming Conventions
- Use UTF-8 for reads/writes; 4-space indentation in HTML/CSS/JS.
- JavaScript uses camelCase; keep functions focused.
- CSS follows existing component/modifier patterns such as `map-frame__corner--tl`.
- Province map filenames stay lowercase pinyin (example: `zhejiang.js`).
- No linter/formatter; keep changes minimal and consistent with nearby code.

## Map Rendering Notes
- The geo files are pre-projected (EPSG:3415, metres), so `series.aspectScale` must stay `1`. ECharts' default `0.75` is meant for lng/lat data and squashes these maps by a third.
- ECharts only fills 80% of its layout box, so `BASE_ZOOM` is `1.25`; it doubles as the minimum zoom. Keep `scaleLimit.min` and the initial `zoom` in sync with it.
- Geometry stays as-is; do not hand-edit `js/china.js` or `js/province/*.js`. If a province map is added or removed, update `AVAILABLE_PROVINCE_FILES` in `js/geo.js` — `npm run build` fails on a mismatch.
- The China GeoJSON also carries `filename` for Taiwan/Hong Kong/Macau/Nanhai, but no province files exist for them; the whitelist is what prevents a doomed drilldown request.

## Security & Data Rules
- Never commit `.dev.vars`, `js/data.js`, or any full student list; never serve them as static assets.
- Passphrase and session secrets come from Cloudflare secrets (`DETAILS_PASSPHRASE`, `DETAILS_SESSION_SECRET`) or local `.dev.vars`; never hardcode them.
- Keep the page same-origin only: no CDN `<script>` tags and no inline `<script>` blocks, so `_headers` can keep `script-src 'self'`. `build.js` enforces both.

## Testing Guidelines
No automated framework; CI (`.github/workflows/ci.yml`) runs `npm run build` plus `node --check` over all app files on push/PR. `build.js` checks required files, that `index.html` does not load `js/data.js`, that no script is cross-origin or inline, that no Highcharts reference remains, that the province whitelist matches `js/province/`, and that `script-src` has no `unsafe-inline`.

Manual smoke tests:
1. `npm run dev:mock`, open the page, verify map render + the colour-band legend (public aggregates only).
2. Hover a province: card appears and the legend marks that value on the band.
3. Click a province with data to drill down; use "返回全国" or Esc to drill up. Province maps are lazy-loaded on drilldown.
4. Click Taiwan/Hong Kong/Macau/Nanhai: the info sheet opens and no province script is requested.
5. Zoom and drag: the map cannot be dragged out of the viewport, and zoom cannot go below the fitted scale.
6. Verify the passphrase flow: wrong passphrase rejected, region details load after login, "退出查看" clears the session and cached details.
7. Share button produces a PNG containing the map, legend band and stats.
8. Check a narrow viewport (<=480px): controls do not overlap and there is no horizontal scroll.
9. `npm run build` passes; `npm run data:upload -- --dry-run` succeeds.

If automated tests are introduced later, place them under `tests/` with `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects (`Add ...`, `Update ...`, `Improve ...`, `Use ...`):
- Keep subject lines concise and action-oriented.
- Scope each commit to one logical change.
- PRs should include a summary, why the change is needed, validation steps, and screenshots for UI updates.
- Link related issues when applicable.
- Never commit sensitive student data; keep `js/data.js` untracked.

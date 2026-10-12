# Repository Guidelines

## Project Overview
Static classmate-distribution map ("蹭饭地图"). The page shows public province/city aggregate counts; names and schools are returned per-region only after a passphrase-authenticated session provided by Cloudflare Pages Functions + KV. Student data is never shipped as a static asset.

## Project Structure & Module Organization
- `index.html`: single-page entry point, map chrome (toolbar / zoom / legend), bottom-sheet and auth-modal markup.
- `js/boot.js`: loads the vendor bundle, geo data and app script in order; shows the retry panel on failure.
- `js/geo.js`: `CMapGeo` registry for geo data plus the whitelist of provinces that ship a map file.
- `js/china.js`, `js/province/*.js`: national/province GeoJSON as `CMapGeo.register("cn/<slug>", {...})` calls; the data is generated upstream and only the registration call is ours.
- `js/map.js`: ECharts setup, choropleth + hover card, drilldown/drill-up, view clamping, public-data fetch, passphrase/detail flow, dialog focus management, share image.
- `js/palette.js`: colours shared by the map and the share image (classic script + global registry, same pattern as `js/geo.js`) — `js/map.js` cannot `import`. `css/main.css` keeps its own `:root` tokens; `scripts/check-contrast.js` asserts the two stay in sync. Canvas fonts live here too, so the share image uses the same faces as the page.
- `js/motion.js`: the L2 motion layer — cursor glow, button magnet, card spotlight. No dependencies, rAF-throttled, and registers no listeners at all under `prefers-reduced-motion: reduce` or a coarse pointer.
- `js/vendor/echarts.min.js`: tree-shaken ECharts build (map/geo/tooltip/visualMap/labelLayout/canvas). Regenerate with `npm run vendor:build`; the committed artifact is what ships.
- `css/main.css`: layout, theme, map controls, tooltip, bottom-sheet, and auth-modal styles.
- `favicon.svg`: the site icon — a paper tile with a seal-shaped square ring and a compass rose whose north point is seal red. Hand-authored, ~700 bytes. It is **deliberately not a map**; see the note in Map Rendering Notes before touching it.
- `js/data.js`: local-only input for the upload script; gitignored, never loaded by the page.
- `js/data.template.js`: data shape template (`name/school/city/province`).
- `functions/`: Pages Functions routes — `api/map/public`, `api/map/details`, `api/auth/details`, `api/auth/logout`.
- `shared/data-model.mjs`: normalization, province aliases, aggregate build, region filter/sort (used by Functions and the upload script).
- `scripts/upload-kv-data.mjs`: builds `students:raw:v1` / `students:public:v1` and uploads them to `CLASS_MAP_DATA` KV; sources from `js/data.js` or the `STUDENTS_DATA` env var.
- `scripts/build-vendor.mjs`: rebuilds `js/vendor/echarts.min.js` from `node_modules/echarts`.
- `scripts/check-contrast.js`: contrast and palette-sync assertions; `build.js` requires it directly, so `npm run build` stays the single entry point.
- `tests/dev-server.mjs`: local mock of the Pages Functions API plus a static server, used for frontend smoke tests without Cloudflare credentials.
- `build.js`: static safety checks (see Testing Guidelines).
- `wrangler.jsonc`, `README.md`, `DEPLOYMENT.md`: Cloudflare config, usage, and deployment docs.
- `DESIGN.md`: the visual spec ("纸本图志" — rice-paper white / ink green / seal red). Read it before touching `css/main.css`, `js/palette.js` or any canvas colour; it lists the 12 required CSS variables and the 11 CSS↔palette same-value pairs.

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
- All page colours must resolve through `:root` custom properties. The only literal values allowed outside that block are the two `.auth-modal__feedback[data-variant=...]` colours — `scripts/check-contrast.js` reads them with a regex and cannot parse `var(...)` — and the `black` stop in the `.atmosphere__grid` mask, which is an alpha channel rather than a design colour.
- `--color-text-muted` must stay readable on **both** `--color-bg-primary` and the darker `--color-bg-secondary`: the map credit and the scale label sit on the inset colour, and at `#5f6a63` they were 4.48:1. Both pairs are asserted in `scripts/check-contrast.js` now, so shortening the token fails the build.
- `:root` declares `color-scheme: light`. Without it a system dark mode repaints native scrollbars and form controls dark and they fight the paper surfaces.
- Interactive elements get `touch-action: manipulation` from the generic `button, a, input` rule. Deliberately not applied to `#map`, which needs native pan and pinch.
- `.spotlight` must never declare `position`. It sits after `.share-btn` in the cascade, so `position: relative` there silently overrides that button's `position: absolute` and drops it into the document flow, pushing the map down by 40px. Elements that need positioning declare it themselves.
- Icons share one 24×24 grid and take size, stroke, caps and colour from the `.icon` / `.icon--xs|sm|md|lg` classes. `stroke-width` is computed per size so the **rendered** stroke is a constant 1.5px (one shared number would render 1.13px at 16px and 1.7px at 24px). Never put `stroke-*` presentation attributes on the paths inside an icon — they outrank that CSS — and never introduce a size outside the four tokens. Icons are always inline SVG: no emoji, no icon font, no text glyph standing in for an icon.
- Province map filenames stay lowercase pinyin (example: `zhejiang.js`).
- No linter/formatter; keep changes minimal and consistent with nearby code.

## Map Rendering Notes
- The geo files are pre-projected (EPSG:3415, metres), so `series.aspectScale` must stay `1`. ECharts' default `0.75` is meant for lng/lat data and squashes these maps by a third.
- ECharts only fills 80% of its layout box, so `BASE_ZOOM` is `1.25`; it doubles as the minimum zoom. Keep `scaleLimit.min` and the initial `zoom` in sync with it.
- Geometry stays as-is; do not hand-edit `js/china.js` or `js/province/*.js`. If a province map is added or removed, update `AVAILABLE_PROVINCE_FILES` in `js/geo.js` — `npm run build` fails on a mismatch.
- The China GeoJSON also carries `filename` for Taiwan/Hong Kong/Macau/Nanhai, but no province files exist for them; the whitelist is what prevents a doomed drilldown request.
- Colours live in two places on purpose (CSS tokens for the page, `js/palette.js` for canvas drawing). Change both or `npm run build` fails. Text on the share image's header gradient is checked at the gradient midpoint. Solid button fills use white on `--color-accent-strong` (8.93:1); `--color-accent-primary` is the focus-ring / stat-number colour, and while white on it technically clears AA (4.62:1) it is not a button fill.
- The `visualMap` legend is sized and placed by `legendLayout()` in `js/map.js`: below 768px the ruler shortens and shifts right so the `0 人` tick clears the 44px zoom cluster in the bottom-left corner. It reads `window.innerWidth` when the option is built, so a live resize re-centres the legend but keeps its length until the next view change.
- Every way of opening a region goes through `activateRegion(point)` in `js/map.js`. The map click handler and the 「地区一览」 table rows both call it, so the two paths can never drift apart; add new entry points there, not by duplicating the drilldown/detail branches.
- 「地区一览」 (`.region-ledger`) is the keyboard and screen-reader substitute for the canvas chart: a native `<table>` inside `<details>` with one button per region and `aria-sort` on the sorted column. Do not give `.region-table thead th` `position: sticky` — a sticky header plus the fixed bottom sheet can cover a focused row button (WCAG 2.2 2.4.11).
- Dialogs (bottom sheet, passphrase modal) go through `FocusScope` in `js/map.js`: background `inert`, focus moved inside, focus restored on close. `#map` and `#bottom-sheet` carry `tabindex="-1"` purely as focus anchors. The sheet is dismissed by sliding it off-screen with `bottom`, so `BottomSheet.updateButtons()` must also set `hidden` on `#bs-close` / `#bs-primary-btn` / `#bs-drilldown-btn` whenever the sheet is not `.active` — otherwise they stay focusable at y≈1660 and Tab lands on invisible controls. The map canvas itself is still not keyboard operable; `#region-table-body` is what makes region selection reachable without a pointer.
- ECharts paints to canvas, so the `prefers-reduced-motion` block in `css/main.css` cannot reach it. `chartAnimationEnabled()` in `js/map.js` reads the media query separately and feeds `animation` / `animationDuration`; keep both halves in sync when touching motion.
- **`favicon.svg` must not be a map drawing, and this is a data-integrity rule, not a taste call.** At 32px there is no room for the South China Sea inset that Chinese maps are expected to carry, and every attempt to simplify `js/china.js` into a silhouette drops those islands — an area threshold removes them as specks, and lowering the threshold just produces unreadable noise. A previous revision did exactly that and shipped an incomplete map as the site icon. The icon therefore uses cartographic vocabulary instead of geography: a seal-shaped square ring (echoing `.plate__seal`) around a compass rose, north point in seal red. If you want a map-like icon, it has to be an abstract cartographic mark — never a partial national outline.

## Security & Data Rules
- Never commit `.dev.vars`, `js/data.js`, or any full student list; never serve them as static assets.
- Passphrase and session secrets come from Cloudflare secrets (`DETAILS_PASSPHRASE`, `DETAILS_SESSION_SECRET`) or local `.dev.vars`; never hardcode them.
- Keep the page same-origin only: no CDN `<script>` tags and no inline `<script>` blocks, so `_headers` can keep `script-src 'self'`. `build.js` enforces both.

## Testing Guidelines
No automated framework; CI (`.github/workflows/ci.yml`) runs `npm run build` plus `node --check` over all app files on push/PR, and re-runs `scripts/build-vendor.mjs` with `git diff --exit-code` to catch the committed bundle drifting from its generator. `build.js` checks required files, that `index.html` does not load `js/data.js`, that no script is cross-origin or inline, that no Highcharts reference remains, that the province whitelist matches `js/province/`, that `script-src` has no `unsafe-inline`, and (via `scripts/check-contrast.js`) that key text/background pairs meet WCAG AA and that the CSS tokens match `js/palette.js`.

Manual smoke tests:
1. `npm run dev:mock`, open the page, verify map render + the colour-band legend (public aggregates only).
2. Hover a province: card appears and the legend marks that value on the band.
3. Click a province with data to drill down; use "返回全国" or Esc to drill up. Province maps are lazy-loaded on drilldown.
4. Click Taiwan/Hong Kong/Macau/Nanhai: the info sheet opens and no province script is requested.
5. Zoom and drag: the map cannot be dragged out of the viewport, and zoom cannot go below the fitted scale.
6. Verify the passphrase flow: wrong passphrase rejected, region details load after login, "退出查看" clears the session and cached details.
7. Share button produces a PNG containing the map, legend band and stats.
8. Check a narrow viewport (<=480px): controls do not overlap and there is no horizontal scroll.
9. Keyboard pass: Tab shows a visible focus ring on every button; with the passphrase modal open, Tab never reaches the background controls and Esc returns focus to "同学信息"; closing the bottom sheet returns focus to the map. Desktop (>=768px) shows the sheet as a centred 560px drawer.
10. Expand 「地区一览」 and Tab to a row's 「查看」 button, then press Enter: the result must match clicking that region on the map. Toggle the sort and check `aria-sort` moves to the other column.
11. With the sheet open, close it, then Tab from the top of the page: the tab order must never stop on a `#bs-*` control (they sit at y≈1660 when the sheet is closed).
12. Enable "reduce motion" in the OS and reload: the choropleth must not animate and the title must not drop in character by character.
13. `npm run build` passes; `npm run data:upload -- --dry-run` succeeds.

If automated tests are introduced later, place them under `tests/` with `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects (`Add ...`, `Update ...`, `Improve ...`, `Use ...`):
- Keep subject lines concise and action-oriented.
- Scope each commit to one logical change.
- PRs should include a summary, why the change is needed, validation steps, and screenshots for UI updates.
- Link related issues when applicable.
- Never commit sensitive student data; keep `js/data.js` untracked.

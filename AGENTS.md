# Repository Guidelines

## Project Overview
Static classmate-distribution map ("蹭饭地图"). The page shows public province/city aggregate counts; names and schools are returned per-region only after a passphrase-authenticated session, served by four `/api/*` routes backed by a `CLASS_MAP_DATA` KV namespace.

This branch (`astro-migration`) moves the site to **Astro 6 SSR on a single Cloudflare Worker + Workers Assets**: `output: 'server'` in `astro.config.mjs`, `wrangler.jsonc` with `main: "@astrojs/cloudflare/entrypoints/server"` and `assets: { binding: "ASSETS", directory: "./dist" }`. The KV binding keeps the same name (`CLASS_MAP_DATA`) and the same `id` / `preview_id`. `main` still serves the pre-migration Pages site; production cutover is a human gate — the deployment commands, the secrets to rebind, the KV checklist, the rollback steps and the manual-step list live in `docs/cutover-runbook.md` (node `l4_cutover`). Student data is never shipped as a static asset.

## Project Structure & Module Organization

Migration status: `src/**` is the new site (Astro routes + React islands); everything listed below as `js/**` / `css/main.css` / `functions/**` is the **pre-migration implementation**, kept as the equivalence baseline and still what `main` serves. On this branch those are reference assets, not the running entry point.

The pre-migration **entry point** `index.html` is archived at `legacy/index.html` (byte-identical to `main:index.html`, see `legacy/README.md`): a root `index.html` is hit by Vite's static middleware before Astro's routes, so `astro dev`'s `GET /` would have served the old site instead of the new one (F-2). `build.js` asserts the root file stays absent — revert with `git mv legacy/index.html index.html`.

- `src/pages/index.astro`, `src/layouts/BaseLayout.astro`, `src/components/*.astro`: the new page shell.
- `src/pages/api/{map/public,map/details,auth/details,auth/logout}.ts`: the four API routes (Astro endpoints), with shared logic in `src/lib/{http,data,auth,types}.ts`.
- `src/styles/main.css`: the migrated stylesheet (the parity contract for it is `docs/migration-parity.md` §3 + `DESIGN.md`).
- `astro.config.mjs`, `tsconfig.json`, `worker-configuration.d.ts`: Astro/adapter/React config, the `astro/tsconfigs/strict` preset, and the wrangler-generated binding types (`npm run cf:types`).
- `scripts/local-runtime.mjs`: the credential-free local path — derives a local Worker config from `dist/`, seeds local KV fixtures, runs `wrangler dev` (`npm run dev:local` / `seed:local`).
- `tests/api-contract.test.mjs`: the four-route contract assertions (`npm run test:api`, node:test, no extra deps).
- `src/pages/index.astro` + `src/components/*`: the running page (map chrome, bottom sheet, auth modal, region ledger).
- `legacy/index.html`: the **archived** pre-migration entry point (map chrome / bottom sheet / auth-modal markup). Not runnable in place — its relative assets and `js/vendor/echarts.min.js` are gone; use `git archive main` for a runnable old-site copy.
- `js/boot.js`: pre-migration loader (vendor bundle → geo data → app script, retry panel on failure). Reference only; the vendor bundle it lists is retired (ADR-0002).
- `js/geo.js`: `CMapGeo` registry for geo data plus the whitelist of provinces that ship a map file.
- `js/china.js`, `js/province/*.js`: national/province GeoJSON as `CMapGeo.register("cn/<slug>", {...})` calls; the data is generated upstream and only the registration call is ours.
- `js/map.js`: ECharts setup, choropleth + hover card, drilldown/drill-up, view clamping, public-data fetch, passphrase/detail flow, dialog focus management, share image.
- `js/palette.js`: colours shared by the map and the share image (classic script + global registry, same pattern as `js/geo.js`) — `js/map.js` cannot `import`. `css/main.css` keeps its own `:root` tokens; `scripts/check-contrast.js` asserts the two stay in sync. Canvas fonts live here too, so the share image uses the same faces as the page.
- `js/motion.js`: the L2 motion layer — cursor glow, button magnet, card spotlight. No dependencies, rAF-throttled, and registers no listeners at all under `prefers-reduced-motion: reduce` or a coarse pointer.
- `js/vendor/echarts.min.js`: **retired and deleted** by ADR-0002 — ECharts now comes from the `echarts` npm dependency and is bundled by Vite (`src/lib/echarts.ts`). `build.js` fails if anything loads the old path again; `scripts/vendor/echarts-entry.mjs` stays as the module-set reference for `src/lib/echarts.ts`.
- `css/main.css`: layout, theme, map controls, tooltip, bottom-sheet, and auth-modal styles.
- `favicon.svg`: the site icon — a paper tile with a seal-shaped square ring and a compass rose whose north point is seal red. Hand-authored, ~700 bytes. It is **deliberately not a map**; see the note in Map Rendering Notes before touching it.
- `js/data.js`: local-only input for the upload script; gitignored, never loaded by the page.
- `js/data.template.js`: data shape template (`name/school/city/province`).
- `functions/`: the pre-migration Pages Functions routes (`api/map/public`, `api/map/details`, `api/auth/details`, `api/auth/logout`) — kept as the equivalence reference; the running routes on this branch are `src/pages/api/**`.
- `shared/data-model.mjs`: normalization, province aliases, aggregate build, region filter/sort (used by Functions and the upload script).
- `scripts/upload-kv-data.mjs`: builds `students:raw:v1` / `students:public:v1` and uploads them to `CLASS_MAP_DATA` KV; sources from `js/data.js` or the `STUDENTS_DATA` env var.
- `scripts/check-contrast.js`: contrast and palette-sync assertions; `build.js` requires it directly, so `npm run build` stays the single entry point.
- `tests/dev-server.mjs`: **retired** — the old fake-`/api/*` server, no longer an npm script or a documented path; kept only for reference.
- `build.js`: the single build gate — static safety assertions + `wrangler types --check` + `astro check` + `astro build` + artifact scan (see Testing Guidelines).
- `wrangler.jsonc`: Cloudflare Worker + Workers Assets / KV bindings; `README.md`, `DEPLOYMENT.md`: usage and deployment docs.
- `DESIGN.md`: the visual spec ("纸本图志" — rice-paper white / ink green / seal red). Read it before touching `css/main.css`, `js/palette.js` or any canvas colour; it lists the 12 required CSS variables and the 11 CSS↔palette same-value pairs.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node >= 22.12 — astro 6's `engines`).
- `npm run build`: the single gate — `node build.js`, which runs the static safety assertions (incl. `wrangler types --check`), then `astro check`, then `astro build`, then the artifact scan; it emits `dist/` (Worker entry + `dist/client` assets). `--static-only` / `--artifacts-only` are the diagnostic switches.
- `npm run astro:check`: Astro + TypeScript type check over `src/**` and the generated types.
- `npm run dev:local`: the full local path with **no Cloudflare credentials**. It derives a local Worker config from `dist/`, seeds `students:public:v1` / `students:raw:v1` into a local KV, then runs `wrangler dev` on http://127.0.0.1:8788 with the demo passphrase `demo`. Requires `npm run build` first. Flags: `--port <n>`, `--reset`, `--state-dir <dir>`, `--public-file <path>`, `--raw-file <path>` (or the `STUDENTS_PUBLIC_FILE` / `STUDENTS_RAW_FILE` env vars).
- `npm run seed:local`: write the local KV fixtures only (pair it with `npm run dev` / `npm run cf:dev`).
- `npm run test:api`: the four-route API contract assertions (`tests/api-contract.test.mjs`, node:test) — starts its own local Worker, reads no `.dev.vars`, needs no credentials. Requires `npm run build` first.
- `npm run dev`: `astro dev` — Astro's dev server, simulated bindings, local KV; secrets come from `.dev.vars`. It renders the new site now that the root `index.html` is archived (`legacy/index.html`); the `/api/*` routes work but its simulated KV is empty, so use `dev:local` when you need data.
- `npm run cf:dev`: `wrangler dev` against the real Worker entry — because `wrangler.jsonc` sets `remote: true` on KV it reads the **remote** KV, so it needs `npx wrangler login` first; it is not the credential-free path.
- `npm run preview`: `npm run build && wrangler dev` — build, then serve the Worker locally.
- `npm run worker:dryrun`: `wrangler deploy --dry-run --outdir .wrangler-dryrun` — validates the Worker/Assets config without deploying.
- `npm run check:runtime`: headless local Worker — asserts the rendered page has no inline scripts, that the document and static-asset responses carry identical security headers, and that `/.dev.vars` / `/js/data.js` / `/js/vendor/echarts.min.js` are not requestable.
- `npm run cf:types` / `npm run cf:types:check`: regenerate / verify `worker-configuration.d.ts` after any `wrangler.jsonc` binding change (`npm run build` already runs the `--check`).
- `npm run data:upload -- --dry-run`: validate the data source can build both KV datasets.
- `npm run data:upload` / `npm run data:upload:preview`: upload to production / preview KV.
- `git log --oneline -n 10`: inspect recent commit style before committing.

Local environment notes:

- **Same-origin POST needs an `Origin` header.** Astro's `security.checkOrigin` (on by default) rejects a non-`GET`/`HEAD`/`OPTIONS` request whose `Content-Type` is absent or form-like unless `Origin === <request origin>`, with `403 Cross-site POST form submissions are forbidden`. Browsers send `Origin` on every POST, same-origin included, so page code needs nothing; `curl` / Node scripts must add `-H "Origin: http://127.0.0.1:8788"`. This is intentional CSRF protection, not a defect — see `docs/migration-parity.md` §1.2 and its §7 revision log.
- **Windows sandbox:** workerd must be able to write to a temp directory. If `npm run build` / `dev:local` / `test:api` report `CreateDirectory #5 拒绝访问` (or workerd fails to start), point `TEMP`/`TMP` at a directory inside the workspace, e.g. `TEMP="$PWD/.wrangler/probe-tmp" TMP="$PWD/.wrangler/probe-tmp" npm run test:api`.
- **One writer per local KV:** the local KV is a miniflare SQLite directory. Concurrent runs need different `--state-dir` values (the API tests already isolate themselves in `.wrangler/local/state-test`).
- **`astro dev` binds IPv6 by default:** it listens on `[::1]`. In sandboxes that refuse IPv6 loopback (`connect EACCES ::1:<port>`) probe it with `npx astro dev --host 127.0.0.1 --port <n>`; `wrangler dev` (dev:local / cf:dev) already binds `127.0.0.1`.

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

The rules below are the **equivalence baseline carried over from the pre-migration site** (`js/map.js` and friends). They stay binding as the map moves into the `src/` islands: where a bullet names an old file path, read it as the behaviour contract, not as the current location.

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
- **Touch taps on the map do not rely on `chart.on('click')` alone.** zrender only synthesises a click when `touchend` lands within 300ms of `touchstart` (`zrender/lib/dom/HandlerProxy.js`, `TOUCH_CLICK_DELAY`), so a deliberate tap on a small province silently does nothing — while the DOM-based 「地区一览」 buttons keep working, which is exactly the "list works, map doesn't" bug. `TapFallback` in `js/map.js` re-implements the gesture with looser thresholds (≤14px movement, ≤900ms), resolves the region by converting the pixel through the public `convertFromPixel` API and ray-casting the current GeoJSON, and de-duplicates against zrender with a 450ms timestamp guard so one tap never fires twice. `TapFallback.init(chart)` takes the instance as an argument and **must be called after `AppState.chart = chart`** — reading `AppState.chart` at that point returns null and the listeners silently never bind.
- Touch devices drill down on tap, same as desktop: there is no `!isTouchDevice` branch left in `activateRegion()`. The old "mobile always opens the aggregate sheet first" rule made a province take two taps to enter and read as an unresponsive map. Province counts stay reachable through 「地区一览」, which lists every region with its public count.
- **`favicon.svg` must not be a map drawing, and this is a data-integrity rule, not a taste call.** At 32px there is no room for the South China Sea inset that Chinese maps are expected to carry, and every attempt to simplify `js/china.js` into a silhouette drops those islands — an area threshold removes them as specks, and lowering the threshold just produces unreadable noise. A previous revision did exactly that and shipped an incomplete map as the site icon. The icon therefore uses cartographic vocabulary instead of geography: a seal-shaped square ring (echoing `.plate__seal`) around a compass rose, north point in seal red. If you want a map-like icon, it has to be an abstract cartographic mark — never a partial national outline.
- Share-image stats follow the current view: the national view prints the national `stats`, a province view prints that province's 人数 / 覆盖城市 / 占全班, and a province with no records prints one empty-state line instead of a row of zeros. Everything printed is read before the first `await`: `createSharePlan()` freezes the scope and date for both the subtitle and the filename, and `captureMapSnapshot()` returns the legend's `heatMax`, so an Esc pressed during the `Image` decode cannot leave the colours, the legend scale and the filename on three different scopes. Dates in the subtitle and filename use the browser's local time zone; `toISOString()` is UTC and writes the previous day for an early-morning export.
- The screen-reader note (`#interaction-note`) takes its numbers from the same `getProvinceSummary()` as the share image: a province view announces 「覆盖 N 座城市，共 M 位同学」 and a province with no records announces the empty state — the national totals must never be appended to a province name. Its details-mode hint follows the scope too, because the sheet's drilldown button does not exist in a province view.

## Security & Data Rules
- On this branch the runtime env is read with `import { env } from 'cloudflare:workers'` (`Astro.locals.runtime` is gone in Astro 6). `DETAILS_PASSPHRASE` / `DETAILS_SESSION_SECRET` come from that env and are never hardcoded; `worker-configuration.d.ts` is generated by `npm run cf:types` and must be regenerated after any `wrangler.jsonc` binding change.
- Never commit `.dev.vars`, `js/data.js`, or any full student list; never serve them as static assets.
- Passphrase and session secrets come from Cloudflare secrets (`DETAILS_PASSPHRASE`, `DETAILS_SESSION_SECRET`) or local `.dev.vars`; never hardcode them.
- Keep the page same-origin only: no CDN `<script>` tags and no inline `<script>` blocks, so `_headers` can keep `script-src 'self'`. `build.js` enforces both.

## Testing Guidelines
Automated coverage lives in `.github/workflows/ci.yml` (Node 24 — astro 6 requires `>= 22.12`). On push/PR it runs, in order: `npm ci` → `npm run build` (the single gate: static assertions + `wrangler types --check` + `astro check` + `astro build` + artifact scan) → `npm run check:runtime` (headless local Worker: no inline scripts, security headers identical between document and static assets, `/.dev.vars` / `js/data.js` / vendor path unreachable) → `npm run test:api` (four-route contract assertions, own local Worker + local KV + demo passphrase, no `.dev.vars`) → a `node --check` loop over `js/`, `shared/`, `scripts/`, `tests/`, `functions/` and `build.js`. The legacy vendor-sync step is **gone** (ADR-0002 retired the artifact); the full gate breakdown is in `docs/build-gates.md`.

`build.js` checks the required files of the **new** tree, that the root `index.html` stays archived (dev shading), that the detail-data key / `js/data.js` / the `DETAILS_*` names never reach the client surface or `dist/client`, that no script is cross-origin or inline (no `<script is:inline>` without `src`), that no Highcharts reference and no vendor-bundle load remain, that the province whitelist matches `js/province/`, that the two `script-src` declarations carry no `unsafe-inline`, that `public/_headers` and `src/lib/security-headers.ts` stay in lockstep, that the Node engines ranges still satisfy `astro` / `wrangler` / `@astrojs/react`, and (via `scripts/check-contrast.js`) that key text/background pairs meet WCAG AA and that the CSS tokens match `js/palette.js`. Its success message (static assertion count, `astro check` + `astro build` exit codes, artifact scan) describes the **Worker + Workers Assets** deployment, not Pages.

Manual smoke tests:
1. `npm run build && npm run dev:local`, open http://127.0.0.1:8788 (demo passphrase `demo`), verify map render + the colour-band legend (public aggregates only). Drive it with a real `students:public:v1` export via `STUDENTS_PUBLIC_FILE=public.json npm run dev:local`. Smoke tests must run on the **Worker** path (`dev:local` / `cf:dev` / preview), not `astro dev`: `astro dev` now renders the new site, but its simulated KV is empty and it is not the deployment runtime.
2. Hover a province: card appears and the legend marks that value on the band.
3. Click a province with data to drill down; use "返回全国" or Esc to drill up. Province maps are lazy-loaded on drilldown.
4. Click Taiwan/Hong Kong/Macau/Nanhai: the info sheet opens and no province script is requested.
5. Zoom and drag: the map cannot be dragged out of the viewport, and zoom cannot go below the fitted scale.
6. Verify the passphrase flow: wrong passphrase rejected, region details load after login, "退出查看" clears the session and cached details.
7. Share button produces a PNG containing the map, legend band and stats; after drilling into a province the numbers on it are that province's, and the downloaded file is named `蹭饭地图_<范围>_<日期>.png`.
8. Check a narrow viewport (<=480px): controls do not overlap and there is no horizontal scroll.
9. Keyboard pass: Tab shows a visible focus ring on every button; with the passphrase modal open, Tab never reaches the background controls and Esc returns focus to "同学信息"; closing the bottom sheet returns focus to the map. Desktop (>=768px) shows the sheet as a centred 560px drawer.
10. Expand 「地区一览」 and Tab to a row's 「查看」 button, then press Enter: the result must match clicking that region on the map. Toggle the sort and check `aria-sort` moves to the other column.
11. With the sheet open, close it, then Tab from the top of the page: the tab order must never stop on a `#bs-*` control (they sit at y≈1660 when the sheet is closed).
12. Enable "reduce motion" in the OS and reload: the choropleth must not animate and the title must not drop in character by character.
13. On a touch device (or `playwright-cli open --device "iPhone 15"`), tap a province: it drills down. Tap 台湾: the info sheet **opens, then closes again** — the click synthesised by that same touch lands on the overlay that has just covered the map. Expect that sequence, not a sheet that stays open: it is **pre-migration behaviour, not a migration regression** (new and old sites produce byte-identical event sequences — `docs/parity-touch-compare.md`, whose user ruling on 2026-10-13 accepted the equivalence override). A tap held longer than 300ms must still work — that is the `TapFallback` path; zrender alone drops it.
14. `npm run build` passes; `npm run data:upload -- --dry-run` succeeds.

If automated tests are introduced later, place them under `tests/` with `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects (`Add ...`, `Update ...`, `Improve ...`, `Use ...`):
- Keep subject lines concise and action-oriented.
- Scope each commit to one logical change.
- PRs should include a summary, why the change is needed, validation steps, and screenshots for UI updates.
- Link related issues when applicable.
- Never commit sensitive student data; keep `js/data.js` untracked.

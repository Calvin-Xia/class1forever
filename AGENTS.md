# Repository Guidelines

## Project Structure & Module Organization
This repository is a static map website deployed from the repo root.
- `index.html`: single-page entry point and script loading order.
- `css/main.css`: all layout, theme, and tooltip styles.
- `js/map.js`: Highcharts map setup, drilldown logic, and tooltip rendering.
- `js/china.js` and `js/province/*.js`: national/province geometry data.
- `js/data.js`: local runtime dataset (ignored by Git); templates are in `js/data.template.js` and `js/default.template.js`.
- `build.js`: converts `STUDENTS_DATA` env JSON into `js/data.js`.
- `README.md` and `DEPLOYMENT.md`: usage and deployment instructions.

## Build, Test, and Development Commands
- `npm run build`: runs `node build.js`; generates `js/data.js` from `STUDENTS_DATA` when provided.
- `python -m http.server 3000`: serves the site locally for manual checks.
- `git log --oneline -n 10`: inspect recent commit style before committing.

There is no bundler or compile step; files are served as-is from the repository root.

## Coding Style & Naming Conventions
- Use UTF-8 for file reads/writes.
- Follow existing formatting: 4-space indentation in HTML/CSS/JS.
- JavaScript naming uses `camelCase` for variables/functions; keep functions focused.
- CSS naming follows existing component/modifier patterns such as `map-frame__corner--tl`.
- Keep province map filenames lowercase pinyin (example: `zhejiang.js`).
- No linter/formatter is configured; keep changes minimal and consistent with nearby code.

## Testing Guidelines
No automated framework is configured. Use manual smoke tests for every change:
1. Start local server and open the page.
2. Verify initial map render and legend.
3. Verify drilldown and drill-up interactions.
4. Verify tooltip behavior on hover/click/mouse leave.
5. Run `npm run build` with valid and invalid `STUDENTS_DATA` to check success/error paths.

If automated tests are introduced later, place them under `tests/` and use `*.test.js` naming.

## Commit & Pull Request Guidelines
Recent commits use short imperative subjects (for example: `Add ...`, `Update ...`, `Improve ...`, `Use ...`).
- Keep subject lines concise and action-oriented.
- Scope each commit to one logical change.
- PRs should include a summary, why the change is needed, validation steps, and screenshots for UI updates.
- Link related issues when applicable.
- Never commit sensitive student data; keep `js/data.js` untracked.

/**
 * 地图岛屿的浏览器入口（React 挂载）。
 *
 * 为什么不用 Astro 的 `client:*` 指令：Astro 的岛屿水合会往 HTML 里塞一段**内联**
 * `<script>`，而 `_headers` 的 CSP 是 `script-src 'self'`（`build.js` 第 6 条也钉死了
 * 不许出现 unsafe-inline），内联脚本在真实浏览器里会被直接拦下 —— 岛屿永远不会水合。
 * 换成 `.astro` 里的 `<script>` 标签后，Astro 会把它编译成 `/_astro/*.js` 外链chunk
 * （`astro/dist/core/build/plugins/plugin-scripts.js`）。这里用**动态** import
 * 触发外链（与 `src/scripts/motion.ts` 同一套做法，避免 Astro 把自包含的小脚本内联）。
 *
 * 因此：岛屿本身仍然是 React 组件（`src/components/MapCanvas.tsx`），只是水合入口
 * 由我们自己持有，而不是交给 Astro 的内联运行时。
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MapCanvas from '../components/MapCanvas';

/** React 只负责挂载与卸载；地图本体是命令式 ECharts（组件渲染 null）。 */
const HOST_ID = 'map-island-host';

function boot(): void {
    let host = document.getElementById(HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.hidden = true;
        document.body.appendChild(host);
    }

    createRoot(host).render(createElement(MapCanvas));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

/**
 * 抽屉 / 口令弹窗 /「地区一览」岛屿的浏览器入口（React 挂载）。
 *
 * 与 `src/scripts/map-island-boot.ts` 同一套理由与做法：Astro 的 `client:*` 水合会往
 * HTML 里塞一段**内联** `<script>`，而 `_headers` 的 CSP 是 `script-src 'self'`
 * （`build.js` 第 6 条也钉死不许出现 unsafe-inline），内联脚本在真实浏览器里会被直接
 * 拦下 —— 岛屿永远不会水合。`.astro` 里的 `<script>` 会被 Astro 编译成 `/_astro/*.js`
 * 外链 chunk，这里再用**动态** import 触发外链（静态 import 会被打包器提升，失去这层
 * 保护）。
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import DialogsCanvas from '../components/DialogsCanvas';

/** React 只负责挂载与卸载；抽屉本体是命令式 DOM（组件渲染 null）。 */
const HOST_ID = 'dialogs-island-host';

function boot(): void {
    let host = document.getElementById(HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.hidden = true;
        document.body.appendChild(host);
    }

    createRoot(host).render(createElement(DialogsCanvas));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

/**
 * 抽屉 / 口令弹窗 /「地区一览」岛屿的 React 挂载点。
 *
 * 组件本身不渲染任何 DOM：抽屉、遮罩、弹窗与表格骨架都是 `BottomSheet.astro` /
 * `AuthModal.astro` / `RegionLedger.astro` 里的静态结构（无 JS 也要能读），
 * 真正的逻辑在 `src/lib/dialogs-island.ts`。这里只负责在浏览器里启动 / 卸载它，
 * 并挂一个只读探针，便于验收脚本读运行时读数（焦点作用域层数、inert 元素、
 * 抽屉模式、排序状态）。
 *
 * 与地图岛屿同一套形态：**不用 `client:*`**（Astro 的岛屿水合会注入内联 `<script>`，
 * 被 `_headers` 的 `script-src 'self'` 拦死），水合入口由 `src/scripts/dialogs-island-boot.ts`
 * 自己持有。
 */
import { useEffect } from 'react';
import { bootDialogsIsland, destroyDialogsIsland, readDialogsProbe } from '../lib/dialogs-island';

declare global {
    interface Window {
        /** 验收 / 调试探针（只读）。 */
        __dialogsProbe?: {
            read: typeof readDialogsProbe;
        };
    }
}

export default function DialogsCanvas() {
    useEffect(() => {
        window.__dialogsProbe = { read: readDialogsProbe };
        bootDialogsIsland();

        return () => {
            destroyDialogsIsland();
            delete window.__dialogsProbe;
        };
    }, []);

    return null;
}

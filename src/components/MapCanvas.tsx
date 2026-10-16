/**
 * 地图岛屿的 React 挂载点（`client:only="react"`）。
 *
 * 组件本身不渲染任何 DOM：地图容器、加载文案、缩放控件都是 `MapSection.astro` 里的
 * 静态结构，ECharts 直接画在 `#map` 上（与旧站 `echarts.init(#map)` 一致）。
 * 真正的逻辑在 `src/lib/map-island.ts`，这里只负责在浏览器里启动 / 卸载它，
 * 并挂一个只读探针，便于验收脚本读运行时读数（aspectScale / BASE_ZOOM / scaleLimit）。
 *
 * 为什么是 `client:only`：ECharts 与几何数据都依赖 DOM 与 canvas，
 * 服务端渲染没有意义，还会把 2MB 级几何拖进 Worker bundle。
 */
import { useEffect } from 'react';
import {
    activateRegion,
    bootMapIsland,
    destroyMapIsland,
    hitTestRegion,
    readBoundsPixels,
    readMapProbe,
    readProvinceWhitelist,
    readViewPoints,
    scanRegionPixels
} from '../lib/map-island';
import { getMapState, MAP_EVENT_NAMES } from '../lib/map-bridge';

declare global {
    interface Window {
        /**
         * 验收 / 调试探针（只读 + 激活入口，不暴露内部状态对象本身）。
         *
         * **这是验收脚本契约**：生产页也暴露 `__mapProbe`，外部（l3_parity /
         * Playwright 证据脚本）按这九个字段读取运行时读数。字段只能加，
         * 不能改名或删除；页面自身不依赖它（AGENTS.md「Security & Data Rules」）。
         */
        __mapProbe?: {
            read: typeof readMapProbe;
            points: typeof readViewPoints;
            activate: typeof activateRegion;
            state: typeof getMapState;
            events: typeof MAP_EVENT_NAMES;
            /** 屏幕坐标 → 地区名（与 TapFallback 同一套射线法）。 */
            hitTest: typeof hitTestRegion;
            /** 网格扫描：可点地区的屏幕坐标（验收脚本据此真点省份）。 */
            regionPixels: typeof scanRegionPixels;
            /** 当前几何包围盒的像素位置（验证拖动夹紧 / 铺满）。 */
            bounds: typeof readBoundsPixels;
            /** 白名单（31 个有省级地图文件的省份）。 */
            whitelist: typeof readProvinceWhitelist;
        };
    }
}

export default function MapCanvas() {
    useEffect(() => {
        window.__mapProbe = {
            read: readMapProbe,
            points: readViewPoints,
            activate: (point, source) => activateRegion(point, source ?? 'probe'),
            state: getMapState,
            events: MAP_EVENT_NAMES,
            hitTest: hitTestRegion,
            regionPixels: scanRegionPixels,
            bounds: readBoundsPixels,
            whitelist: readProvinceWhitelist
        };

        bootMapIsland().catch(() => {
            /* 失败面板已由 map-island 显示；这里只是不让 unhandled rejection 冒到控制台顶层 */
        });

        return () => {
            destroyMapIsland();
            delete window.__mapProbe;
        };
    }, []);

    return null;
}

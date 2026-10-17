/**
 * 地图岛屿控制器（从 `js/map.js` 迁移的「地图核心」，不含分享图 / 抽屉 / 口令 / 动效）。
 *
 * 职责：几何 + 公开数据 → ECharts 实例 → 下钻 / 返回 / 缩放夹紧 / 拖动纠偏 /
 * 悬浮卡片 / 触摸兜底；并把状态变化广播给其它岛屿（见 `src/lib/map-bridge.ts`）。
 *
 * 明确**不在**本模块的三件事（各自节点负责）：
 * - 底部抽屉与口令弹窗（l2_dialogs）：本模块只发 `map:region-activate` 等事件；
 * - 分享图与读屏播报（l2_share）：本模块只维护快照与 `#interaction-note` 的播报触发点；
 * - 光标辉光等动效（l2_motion）。
 *
 * 三个硬约束（AGENTS.md「Map Rendering Notes」）：
 * 1. `aspectScale: 1`（见 chart-options）；2. `BASE_ZOOM` 同时是初始与最小缩放；
 * 3. `initTapFallback(chart, …)` **必须在 chart 实例赋值之后**调用。
 */
import { echarts } from './echarts';
import { readSessionRevision } from './session-sync';
import { loadMapFonts } from './map-fonts';
import { createRegionProbe } from './map-probe';
import { revealMapFatalError } from '../scripts/map-fatal-error';
import type { EChartsType } from './echarts';
import {
    CHINA_MAP_ID,
    PROVINCE_MAP_PREFIX,
    REGION_SERIES_ID,
    BASE_ZOOM,
    ZOOM_MAX,
    ROAM_TOLERANCE_PX,
    buildNationalPoints,
    buildProvinceCatalog,
    buildProvincePoints,
    createRegionIndex,
    getMapBounds,
    normalizeRegionToken,
    resolveRegionPoint
} from './map-model';
import type { ProvinceCatalogEntry, RegionPoint } from './map-model';
import { buildChartOption, buildMapSeries, buildVisualMapOption, chartAnimationEnabled, isTouchDevice } from './chart-options';
import { getGeo, hasProvinceFile, installGeoRegistry, loadChinaGeo, loadProvinceGeo, provinceMapId } from './geo-loader';
import type { GeoJson } from './geo-loader';
import {
    MAP_EVENT_NAMES,
    emitMapEvent,
    getDetailModeState,
    isOverlayOpen,
    setDetailModeState,
    setMapState,
    setMapView
} from './map-bridge';
import type { RegionActivationDetail } from './map-bridge';
import { initTapFallback, noteChartActivation, ownsTouchGesture } from './tap-fallback';
import type { PublicMapPayload } from './types';

/**
 * 兜底面板的显示入口——实现放在 `src/scripts/map-fatal-error.ts`，那里没有任何
 * import，因此可以同时被「一定会执行的入口 chunk」（MapSection.astro 的 `<script>`）
 * 和本模块引用，而不会把 ECharts / 几何数据拖进入口 chunk。这里再导出一次，
 * 让调用方只认 `map-island` 这个入口。
 */
export { revealMapFatalError };

const PUBLIC_CACHE_KEY = 'class1forever:public:v1';

interface MapUi {
    loading: HTMLElement | null;
    map: HTMLElement | null;
    backButton: HTMLButtonElement | null;
    regionBadge: HTMLElement | null;
    zoomIn: HTMLButtonElement | null;
    zoomOut: HTMLButtonElement | null;
    zoomReset: HTMLButtonElement | null;
}

interface IslandState {
    chart: EChartsType | null;
    catalog: Record<string, ProvinceCatalogEntry>;
    activeProvince: string | null;
    activeMapId: string;
    regionIndex: Map<string, RegionPoint>;
    viewPoints: RegionPoint[];
    publicData: PublicMapPayload | null;
    clampingRoam: boolean;
    /** 激活日志（探针用）：谁在什么时机激活了哪个地区、走的是哪条路径。 */
    activationLog: Array<{ name: string; source: string; at: number }>;
    disposers: Array<() => void>;
}

function createState(): IslandState {
    return {
        chart: null,
        catalog: {},
        activeProvince: null,
        activeMapId: CHINA_MAP_ID,
        regionIndex: new Map(),
        viewPoints: [],
        publicData: null,
        clampingRoam: false,
        activationLog: [],
        disposers: []
    };
}

let state = createState();
let islandUi: MapUi | null = null;

function ui(): MapUi {
    if (!islandUi) {
        islandUi = {
            loading: document.getElementById('map-loading'),
            map: document.getElementById('map'),
            backButton: document.getElementById('map-back-btn') as HTMLButtonElement | null,
            regionBadge: document.getElementById('map-region-badge'),
            zoomIn: document.getElementById('map-zoom-in') as HTMLButtonElement | null,
            zoomOut: document.getElementById('map-zoom-out') as HTMLButtonElement | null,
            zoomReset: document.getElementById('map-zoom-reset') as HTMLButtonElement | null
        };
    }
    return islandUi;
}

/* ------------------------------------------------------------------ *
 * 载入 / 忙碌 / 报错
 * ------------------------------------------------------------------ */

function hideMapLoading(): void {
    const dom = ui();
    if (dom.loading) {
        dom.loading.style.display = 'none';
    }
    // 地图容器是 role="img"，里面的加载文案对读屏不可见，忙碌状态挂在容器自身。
    if (dom.map) {
        dom.map.setAttribute('aria-busy', 'false');
    }
}

function showProvinceLoading(provinceName: string): void {
    const dom = ui();
    if (dom.loading) {
        const text = dom.loading.querySelector('.map-loading__text');
        if (text && provinceName) {
            text.textContent = '正在加载 ' + provinceName + ' 地图...';
        }
        dom.loading.style.display = 'flex';
    }
    if (dom.map) {
        dom.map.setAttribute('aria-busy', 'true');
    }
}

function showFatalError(message: string, title?: string): void {
    // 面板显示、隐藏加载指示、把焦点移到「重新加载」都在共享模块里完成。
    // 放在那里是硬要求：岛屿是动态 import 挂载的，chunk 加载失败时本模块根本不会执行，
    // 入口 chunk（MapSection.astro 的 `<script>`）会用同一个函数兜底。
    revealMapFatalError(message, title);
}

function normalizeApiErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
        const payload = (error as { payload?: { message?: unknown } }).payload;
        if (payload && typeof payload.message === 'string' && payload.message) {
            return payload.message;
        }
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message) {
            return message;
        }
    }
    return fallback;
}

interface ApiError extends Error {
    status?: number;
    payload?: unknown;
}

async function fetchJson(url: string, init?: RequestInit): Promise<PublicMapPayload> {
    const requestInit: RequestInit = Object.assign({ credentials: 'same-origin' as const }, init || {});
    const response = await fetch(url, requestInit);
    let payload: unknown = null;

    try {
        payload = await response.json();
    } catch (_error) {
        payload = null;
    }

    if (!response.ok) {
        const message =
            payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
                ? String((payload as { message: unknown }).message)
                : `Request failed with status ${response.status}`;
        const error: ApiError = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload as PublicMapPayload;
}

/* ------------------------------------------------------------------ *
 * 公开数据（含 localStorage 缓存）
 * ------------------------------------------------------------------ */

/**
 * 读本地公开缓存。
 *
 * **为什么强制 `detailAccess: false`**：这份 localStorage 缓存只有公开聚合，却会跨会话、
 * 跨标签页存活 —— 口令会话可能早就没了（点了「退出查看」、Cookie 过期、服务端切线、
 * 另一个标签页登出），缓存里那句 `detailAccess: true` 就成了过期授权。把它当真会让
 * 抽屉在没有会话时直接发详情请求、拿 401、再弹口令框，用户看到的是「刚登录就失效」。
 * 详情访问只能由当次 `/api/map/public` 响应说了算。
 *
 * **可见影响**：冷启动先用缓存渲染聚合并把详情入口显示成「输入口令后查看」，
 * 随后同一个 tick 里 `applyPublicData(fresh)` 按真实会话状态刷新（有会话时按钮立刻变回
 * 「同学信息」）。也就是说缓存只负责「先有图看」，不负责授权状态。
 */
function readPublicCache(): PublicMapPayload | null {
    try {
        const raw = localStorage.getItem(PUBLIC_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const cached: unknown = JSON.parse(raw);
        if (!cached || typeof cached !== 'object' || typeof (cached as { generatedAt?: unknown }).generatedAt !== 'string') {
            return null;
        }
        if (!(cached as { provinces?: unknown }).provinces || !(cached as { stats?: unknown }).stats) {
            return null;
        }
        return { ...cached as PublicMapPayload, detailAccess: false };
    } catch (_error) {
        return null;
    }
}

/**
 * 写本地公开缓存时同样把 `detailAccess` 压成 false：缓存是被下一个会话（甚至另一个
 * 标签页）读的，写入时的会话状态到那时已经不成立了。真实访问状态只走
 * `setDetailModeState()` 那条内存内通路，永不落盘。
 */
function writePublicCache(data: PublicMapPayload): void {
    try {
        localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify({ ...data, detailAccess: false }));
    } catch (_error) {
        // 存储不可用（隐私模式 / 配额）时缓存只是尽力而为。
    }
}

function applyPublicData(data: PublicMapPayload): void {
    state.publicData = data;
    setDetailModeState({
        available: Boolean(data.detailModeAvailable),
        access: Boolean(data.detailAccess)
    });
    setMapState({ publicData: data, detailsHint: typeof data.detailsHint === 'string' ? data.detailsHint : '' });
    emitMapEvent(MAP_EVENT_NAMES.publicData, data);
}

/* ------------------------------------------------------------------ *
 * 视图
 * ------------------------------------------------------------------ */

function getActiveProvinceName(): string | null {
    return normalizeRegionToken(state.activeProvince);
}

function isActiveProvinceView(): boolean {
    return Boolean(getActiveProvinceName());
}

function updateMapChrome(): void {
    const dom = ui();
    const provinceName = getActiveProvinceName();

    if (dom.regionBadge) {
        dom.regionBadge.textContent = provinceName || '中国';
    }
    if (dom.backButton) {
        dom.backButton.hidden = !provinceName;
    }
}

function buildNationalPointsFromPublicData(): RegionPoint[] {
    return buildNationalPoints(state.catalog, state.publicData);
}

function buildCurrentProvincePoints(provinceName: string): RegionPoint[] {
    const entry = state.catalog[provinceName];
    if (!entry || !entry.file) {
        return [];
    }
    return buildProvincePoints(state.catalog, provinceName, getGeo(provinceMapId(entry.file)), state.publicData);
}

function applyMapView(view: { mapId: string; province: string | null; points: RegionPoint[]; showLabels: boolean }): void {
    if (!state.chart) {
        return;
    }

    state.activeProvince = view.province || null;
    state.activeMapId = view.mapId;
    state.viewPoints = view.points;
    state.regionIndex = createRegionIndex(view.points);

    state.chart.setOption({
        series: [buildMapSeries(view.mapId, view.province || '中国', view.points, view.showLabels)],
        visualMap: buildVisualMapOption(view.points, window.innerWidth)
    });

    updateMapChrome();

    const current = getCurrentMapView();
    setMapView({
        province: state.activeProvince,
        mapId: state.activeMapId,
        points: view.points,
        showLabels: view.showLabels,
        zoom: current.zoom
    });
    // 视野换了就广播：徽标、读屏播报、详情按钮状态由对应岛屿自行更新。
    emitMapEvent(MAP_EVENT_NAMES.viewChange, {
        province: state.activeProvince,
        mapId: state.activeMapId,
        points: view.points,
        zoom: current.zoom
    });
}

function refreshCurrentViewData(): void {
    if (!state.chart) {
        return;
    }

    const provinceName = getActiveProvinceName();
    const points = provinceName ? buildCurrentProvincePoints(provinceName) : buildNationalPointsFromPublicData();

    state.viewPoints = points;
    state.regionIndex = createRegionIndex(points);

    state.chart.setOption({
        series: [
            {
                id: REGION_SERIES_ID,
                data: points
            }
        ],
        visualMap: buildVisualMapOption(points, window.innerWidth)
    });

    setMapView({ points: points });
    emitMapEvent(MAP_EVENT_NAMES.viewChange, {
        province: provinceName,
        mapId: state.activeMapId,
        points: points,
        zoom: getCurrentMapView().zoom
    });
}

function renderMapFromData(): void {
    applyMapView({
        mapId: CHINA_MAP_ID,
        province: null,
        points: buildNationalPointsFromPublicData(),
        showLabels: false
    });
    hideMapLoading();
}

/* ------------------------------------------------------------------ *
 * 缩放与拖动夹紧
 * ------------------------------------------------------------------ */

export interface CurrentMapView {
    zoom: number;
    center: number[] | null;
}

function getCurrentMapView(): CurrentMapView {
    const option = state.chart ? state.chart.getOption() : null;
    const series = option && Array.isArray(option.series) ? (option.series[0] as { zoom?: unknown; center?: unknown }) : null;

    return {
        zoom: series && typeof series.zoom === 'number' && series.zoom > 0 ? series.zoom : 1,
        center: series && Array.isArray(series.center) ? (series.center as number[]) : null
    };
}

/**
 * 把地图拉回可视区域：缩放到「刚好铺满」时强制居中，放大后不允许露出背景。
 */
function clampMapRoam(): void {
    const chart = state.chart;
    if (!chart || state.clampingRoam) {
        return;
    }

    const bounds = getMapBounds(state.activeMapId, getGeo(state.activeMapId));
    const width = chart.getWidth();
    const height = chart.getHeight();
    if (!bounds || !width || !height) {
        return;
    }

    const cornerA = chart.convertToPixel({ seriesIndex: 0 }, [bounds.minX, bounds.minY]);
    const cornerB = chart.convertToPixel({ seriesIndex: 0 }, [bounds.maxX, bounds.maxY]);
    if (!cornerA || !cornerB || !Array.isArray(cornerA) || !Array.isArray(cornerB)) {
        return;
    }

    const left = Math.min(cornerA[0], cornerB[0]);
    const right = Math.max(cornerA[0], cornerB[0]);
    const top = Math.min(cornerA[1], cornerB[1]);
    const bottom = Math.max(cornerA[1], cornerB[1]);
    const mapWidth = right - left;
    const mapHeight = bottom - top;

    let offsetX = 0;
    let offsetY = 0;

    if (mapWidth <= width) {
        offsetX = width / 2 - (left + mapWidth / 2);
    } else if (left > 0) {
        offsetX = -left;
    } else if (right < width) {
        offsetX = width - right;
    }

    if (mapHeight <= height) {
        offsetY = height / 2 - (top + mapHeight / 2);
    } else if (top > 0) {
        offsetY = -top;
    } else if (bottom < height) {
        offsetY = height - bottom;
    }

    if (Math.abs(offsetX) < ROAM_TOLERANCE_PX && Math.abs(offsetY) < ROAM_TOLERANCE_PX) {
        return;
    }

    const view = getCurrentMapView();
    const anchor = view.center || [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    const anchorPixel = chart.convertToPixel({ seriesIndex: 0 }, anchor);
    if (!anchorPixel || !Array.isArray(anchorPixel)) {
        return;
    }

    // offsetX/offsetY 是要让地图内容移动的距离，中心的像素位置要朝相反方向移动。
    const shiftedPixel = [anchorPixel[0] - offsetX, anchorPixel[1] - offsetY];
    // 已经是最小比例时交还给 ECharts 的自动居中，避免长期保留一个手算的中心点。
    const nextCenter =
        view.zoom <= BASE_ZOOM + 1e-6 ? null : (chart.convertFromPixel({ seriesIndex: 0 }, shiftedPixel) as number[] | null);

    state.clampingRoam = true;
    try {
        chart.setOption({
            series: [
                {
                    id: REGION_SERIES_ID,
                    zoom: view.zoom,
                    center: nextCenter
                }
            ]
        });
    } finally {
        state.clampingRoam = false;
    }

    emitMapEvent(MAP_EVENT_NAMES.zoomChange, { zoom: view.zoom, clamped: true });
}

function applyMapZoom(multiplier: number): void {
    if (!state.chart) {
        return;
    }

    const current = getCurrentMapView();
    const nextZoom = Math.min(Math.max(current.zoom * multiplier, BASE_ZOOM), ZOOM_MAX);
    if (Math.abs(nextZoom - current.zoom) < 1e-3) {
        return;
    }

    state.chart.setOption({
        series: [
            {
                id: REGION_SERIES_ID,
                zoom: nextZoom,
                center: nextZoom <= BASE_ZOOM + 1e-6 ? null : current.center
            }
        ]
    });

    clampMapRoam();
    setMapView({ zoom: nextZoom });
    emitMapEvent(MAP_EVENT_NAMES.zoomChange, { zoom: nextZoom, clamped: false });
}

function resetMapZoom(): void {
    if (!state.chart) {
        return;
    }

    state.chart.setOption({
        series: [
            {
                id: REGION_SERIES_ID,
                zoom: BASE_ZOOM,
                center: null
            }
        ]
    });

    setMapView({ zoom: BASE_ZOOM });
    emitMapEvent(MAP_EVENT_NAMES.zoomChange, { zoom: BASE_ZOOM, clamped: false });
}

/* ------------------------------------------------------------------ *
 * 下钻 / 返回 / 激活
 * ------------------------------------------------------------------ */

async function drillIntoProvince(point: RegionPoint): Promise<void> {
    const filename = point && point.drilldownFile;
    if (!filename || point.loading) {
        return;
    }

    point.loading = true;

    // 「即将下钻」在**任何 await 之前**同步广播：抽屉侧据此先把自己收起来，
    // 免得 await 期间弹层还盖在图上、下钻完成后又和新视野打架。
    emitMapEvent(MAP_EVENT_NAMES.drillStart, { point });

    showProvinceLoading(point.name);

    try {
        const generation = bootGeneration;
        const geoJson = await loadProvinceGeo(filename);
        await loadMapFonts(geoJson);
        if (generation !== bootGeneration) return;
        const mapId = PROVINCE_MAP_PREFIX + filename;
        echarts.registerMap(mapId, geoJson as unknown as Parameters<typeof echarts.registerMap>[1]);
        hideMapLoading();
        applyMapView({
            mapId: mapId,
            province: point.name,
            points: buildCurrentProvincePoints(point.name),
            showLabels: true
        });
    } catch (error) {
        hideMapLoading();
        console.error('Failed to load province map:', error);
        requestRegionActivation(point, 'public', '省级地图加载失败，请重试。');
    } finally {
        point.loading = false;
    }
}

function drillUpToCountry(): void {
    if (!isActiveProvinceView()) {
        return;
    }

    applyMapView({
        mapId: CHINA_MAP_ID,
        province: null,
        points: buildNationalPointsFromPublicData(),
        showLabels: false
    });
}

function handleRegionClick(params: { componentType?: string; name?: unknown }): void {
    if (!params || params.componentType !== 'series') {
        return;
    }

    const point = resolveRegionPoint(params.name, state.regionIndex, getActiveProvinceName());
    if (!point) {
        return;
    }

    // 触摸补发的 click 一律让位给 TapFallback。证据（不是猜测）：(1) zrender 在**它自己的
    // touchend 处理里**、距 touchstart <300ms 时就同步合成一条 click，而它的监听是
    // `echarts.init()` 挂到 viewportRoot 上的、比 initTapFallback 早（同元素先注册先跑），
    // 所以轻点一定是这条 click 先到；(2) Chromium 在 touchend 之后还会补一套鼠标兼容事件
    // （mousedown/up/click），那是第二条 click。不让位就会把一次轻触记成 'touch-tap' + 'map'
    // 两条激活，换层后那条迟到的 click 还会在省级图上凭空激活一个城市。
    // 这里**必须先返回、不能先 note**：若先 note，排在后面的 TapFallback 会被 450ms 去重吞掉，
    // 轻触就彻底没反应了。
    if (ownsTouchGesture()) {
        return;
    }

    // 记一笔，让触摸兜底知道这次触摸已经被 zrender 处理过了。
    noteChartActivation();
    activateRegion(point, 'map');
}

/**
 * 右键一个地区 = **强制开面板**（不下钻），并压掉浏览器自带的右键菜单。
 */
function handleRegionContextMenu(params: { componentType?: string; name?: unknown; event?: unknown }): void {
    if (!params || params.componentType !== 'series') {
        return;
    }

    // 触摸设备长按也会补一条 contextmenu（长按 = TapFallback 的 'touch-hold'，不是鼠标右键），
    // 所以只要这次事件来自触摸手势，就不走右键分支。
    if (ownsTouchGesture()) {
        return;
    }

    const point = resolveRegionPoint(params.name, state.regionIndex, getActiveProvinceName());
    if (!point) {
        return;
    }

    suppressNativeContextMenu(params.event);
    activateRegion(point, 'right-click', 'panel');
}

/**
 * 压掉原生右键菜单。`params.event` 的形状以 node_modules 实证为准，不臆测：
 * ECharts `_initEvents()`（`echarts/lib/core/echarts.js`）把 zrender 派发的事件包
 * 原样挂到 `params.event` 上，那就是 `makeEventPacket()`
 * （`zrender/lib/Handler.js`）造的对象 —— `packet.event` 才是原生 DOM 事件，
 * 包上还有一个 `stop()`（内部走 `eventTool.stop()`：preventDefault + stopPropagation）。
 * 两层都防御性调用：任一层缺失（ECharts/zrender 升级换形状）也不抛。
 */
function suppressNativeContextMenu(packet: unknown): void {
    if (!packet || typeof packet !== 'object') {
        return;
    }

    const zrPacket = packet as { event?: unknown; stop?: unknown };
    if (typeof zrPacket.stop === 'function') {
        try {
            zrPacket.stop();
        } catch (_error) {
            /* 包结构变了也得让右键激活继续走完 */
        }
    }

    const nativeEvent = zrPacket.event;
    if (nativeEvent && typeof (nativeEvent as { preventDefault?: unknown }).preventDefault === 'function') {
        try {
            (nativeEvent as Event).preventDefault();
        } catch (_error) {
            /* 同上 */
        }
    }
}

/**
 * 广播「有人点了这个地区」给抽屉侧（l2_dialogs）。
 * 没有订阅者时什么也不发生 —— 地图本身不会替抽屉画面板。
 */
function requestRegionActivation(point: RegionPoint, source: string, callout?: string): void {
    const detail: RegionActivationDetail & { callout?: string } = {
        point: point,
        canDrill: Boolean(point.drilldownFile),
        source: source,
        callout: callout
    };
    emitMapEvent(MAP_EVENT_NAMES.regionActivate, detail);
}

/**
 * 区域激活意图（跨岛屿契约的一部分），三条分支互斥且穷尽：
 *
 * - `auto`（默认）：该地区可下钻（有省级地图文件且当前不在省级视野）→ 下钻；
 *   否则把「要看这个地区」的意图交给抽屉侧开面板（旧站 `activateRegion` 的行为）。
 *   地图点击、轻触（TapFallback）、「地区一览」行主按钮走它。
 * - `panel`：**强制开面板**，不下钻 —— 长按、右键、地区一览的「详情」按钮走它。
 * - `drill`：**强制下钻** —— 等价旧站抽屉的
 *   `BottomSheet.handleDrilldownClick()`（`if (currentPoint.drilldownFile && !isActiveProvinceView()) drillIntoProvince(...)`）。
 *   只有抽屉的「进入 X 地图详情」按钮用它；不可下钻时静默返回（与旧站一致），
 *   不会反过来广播一个 `region-activate` 把抽屉又打开一遍。
 *
 * 详情模式（`getDetailModeState().enabled`）**不再**参与这条分流：点地图就下钻，
 * 想看名单走长按 / 右键 / 地区一览，不再需要先开「同学信息」。
 */
export type RegionActivationIntent = 'auto' | 'drill' | 'panel';

/**
 * 打开一个地区的唯一入口（地图点击、轻触/长按、右键、「地区一览」按钮、抽屉按钮都走这里）。
 *
 * 分支都收在本模块里：`drillIntoProvince`（下钻）与 `requestRegionActivation`
 * （把意图交给抽屉侧，旧站这里是 BottomSheet.showPublic / showDetailSheetForPoint）。
 * 外部不得复制第二条下钻分支。
 */
export function activateRegion(point: RegionPoint | null, source = 'external', intent: RegionActivationIntent = 'auto'): void {
    if (!point) {
        return;
    }

    state.activationLog.push({ name: point.name, source: source, at: Date.now() });
    if (state.activationLog.length > 50) {
        state.activationLog.shift();
    }

    const canDrill = Boolean(point.drilldownFile) && !isActiveProvinceView();

    if (intent === 'panel') {
        requestRegionActivation(point, source);
        return;
    }

    if (intent === 'drill') {
        // 旧站 handleDrilldownClick：不可下钻就什么也不做（不关抽屉、不改视野）。
        if (canDrill) {
            drillIntoProvince(point).catch((error: unknown) => {
                console.error('Drilldown failed:', error);
            });
        }
        return;
    }

    if (canDrill) {
        drillIntoProvince(point).catch((error: unknown) => {
            console.error('Drilldown failed:', error);
        });
        return;
    }

    requestRegionActivation(point, source);
}

/* ------------------------------------------------------------------ *
 * 图表装配
 * ------------------------------------------------------------------ */

function initChart(chinaGeo: GeoJson): EChartsType {
    const container = ui().map;
    if (!container) {
        throw new Error('页面缺少地图容器，请刷新页面重试。');
    }

    // StrictMode / HMR 下 effect 可能跑两遍：同一容器已有实例时**不能**只把旧实例
    // 塞回 state 就 return —— 那条早退路径会漏掉 `setMapState({ chart })`、TapFallback
    // 与 `map:ready`（旧实例上的 click/georoam 监听确实还在，但桥接快照里的 chart 是
    // null、触摸兜底根本没挂、分享按钮会在 ready 之前就拿到空 chart）。
    // 这里先把旧实例连同它的 disposer 一起拆掉，再走完整初始化，三条副作用一个都不少。
    const existing = echarts.getInstanceByDom(container);
    if (existing) {
        state.disposers.forEach((dispose) => dispose());
        state.disposers = [];
        state.chart = null;
        existing.dispose();
    }

    echarts.registerMap(CHINA_MAP_ID, chinaGeo as unknown as Parameters<typeof echarts.registerMap>[1]);

    const chart = echarts.init(container, null, { renderer: 'canvas' });

    // tooltip 与动画等全局配置先落到实例上，后续 applyMapView 只合并 series / visualMap。
    chart.setOption(
        buildChartOption({
            isTouch: isTouchDevice(),
            animate: chartAnimationEnabled(),
            viewport: window.innerWidth,
            resolvePoint: (name) => resolveRegionPoint(name, state.regionIndex, getActiveProvinceName()),
            hintState: () => {
                const detail = getDetailModeState();
                return {
                    detailModeAvailable: detail.available,
                    detailAccess: detail.access,
                    detailModeEnabled: detail.enabled
                };
            },
            activeProvince: () => getActiveProvinceName()
        })
    );

    chart.on('click', handleRegionClick as (params: unknown) => void);
    // 右键地区 → 开面板（不下钻）；只在命中地区时压掉浏览器右键菜单。
    chart.on('contextmenu', handleRegionContextMenu as (params: unknown) => void);
    // 拖动/滚轮改变视野后立刻纠偏，避免把地图拖出可视区域。
    chart.on('georoam', () => clampMapRoam());

    state.chart = chart;
    setMapState({ chart: chart, isTouch: isTouchDevice() });

    // 显式把实例传进去：这行必须在 `state.chart = chart` 之后，
    // 否则拿不到实例、监听根本挂不上（触摸兜底会静默失效）。
    state.disposers.push(
        initTapFallback(chart, {
            getMapId: () => state.activeMapId,
            getGeo: (mapId) => getGeo(mapId),
            isOverlayOpen: () => isOverlayOpen(),
            resolvePoint: (name) => resolveRegionPoint(name, state.regionIndex, getActiveProvinceName()),
            activate: (point, source, intent) => activateRegion(point, source, intent)
        })
    );

    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
            chart.resize();
        });
        observer.observe(container);
        state.disposers.push(() => observer.disconnect());
    } else {
        const onResize = (): void => {
            chart.resize();
        };
        window.addEventListener('resize', onResize);
        state.disposers.push(() => window.removeEventListener('resize', onResize));
    }

    emitMapEvent(MAP_EVENT_NAMES.ready, { mapId: CHINA_MAP_ID });
    return chart;
}

function bindStaticUi(): void {
    const dom = ui();

    if (dom.backButton) {
        const onBack = (): void => drillUpToCountry();
        dom.backButton.addEventListener('click', onBack);
        state.disposers.push(() => dom.backButton?.removeEventListener('click', onBack));
    }

    if (dom.zoomIn) {
        const onZoomIn = (): void => applyMapZoom(1.35);
        dom.zoomIn.addEventListener('click', onZoomIn);
        state.disposers.push(() => dom.zoomIn?.removeEventListener('click', onZoomIn));
    }

    if (dom.zoomOut) {
        const onZoomOut = (): void => applyMapZoom(1 / 1.35);
        dom.zoomOut.addEventListener('click', onZoomOut);
        state.disposers.push(() => dom.zoomOut?.removeEventListener('click', onZoomOut));
    }

    if (dom.zoomReset) {
        const onReset = (): void => resetMapZoom();
        dom.zoomReset.addEventListener('click', onReset);
        state.disposers.push(() => dom.zoomReset?.removeEventListener('click', onReset));
    }

    // Esc 的优先级与旧实现一致：先关弹层，再退全国。
    // 弹层（底部抽屉 / 口令弹窗）归 l2_dialogs，这里只广播意图，不代它关。
    const onKeydown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }

        if (isOverlayOpen()) {
            emitMapEvent(MAP_EVENT_NAMES.escape, { target: 'overlay' });
            return;
        }

        drillUpToCountry();
    };
    document.addEventListener('keydown', onKeydown);
    state.disposers.push(() => document.removeEventListener('keydown', onKeydown));
}

async function loadApp(generation: number): Promise<void> {
    const cached = readPublicCache();
    let renderedFromCache = false;

    if (cached) {
        try {
            applyPublicData(cached);
            renderMapFromData();
            renderedFromCache = true;
        } catch (error) {
            console.warn('Failed to render cached map data:', error);
        }
    }

    try {
        const sessionRevision = readSessionRevision();
        const fresh = await fetchJson('/api/map/public');
        if (generation !== bootGeneration) {
            return;
        }
        writePublicCache(fresh);
        const cacheIsStale = !renderedFromCache || !cached || cached.generatedAt !== fresh.generatedAt;

        // 登录/退出发生在公开请求等待期间时，只更新聚合，不以旧响应覆盖新会话状态。
        applyPublicData(sessionRevision === readSessionRevision() ? fresh :
            { ...fresh, detailAccess: getDetailModeState().access });

        if (!renderedFromCache) {
            renderMapFromData();
            return;
        }

        if (cacheIsStale) {
            refreshCurrentViewData();
        }
    } catch (error) {
        if (renderedFromCache) {
            console.warn('Failed to refresh public map data:', error);
            return;
        }
        console.error('Failed to initialize map application:', error);
        showFatalError(normalizeApiErrorMessage(error, '无法加载地图数据，请稍后重试。'));
    }
}

let bootPromise: Promise<void> | null = null;
/** 挂载代次：StrictMode / HMR 下的重复挂载不会让旧一轮的异步尾巴污染新实例。 */
let bootGeneration = 0;

/**
 * 启动地图岛屿（幂等）。返回的 Promise 在图表可交互后 resolve。
 */
export function bootMapIsland(): Promise<void> {
    if (bootPromise) {
        return bootPromise;
    }

    const generation = ++bootGeneration;
    bootPromise = (async () => {
        const chinaGeo = await loadChinaGeo();
        await loadMapFonts(chinaGeo);
        if (generation !== bootGeneration) {
            return;
        }
        state.catalog = buildProvinceCatalog(chinaGeo, hasProvinceFile);
        initChart(chinaGeo);
        updateMapChrome();
        bindStaticUi();
        await loadApp(generation);
    })().catch((error: unknown) => {
        // 这一轮已经被新的挂载取代（`destroyMapIsland()` + 再次 `bootMapIsland()`，例如
        // StrictMode / HMR）：既不能清掉新一轮的 bootPromise，也不能拿旧错误盖住新实例的
        // 界面 —— 旧模块的收尾尾巴对新生命周期没有发言权。
        if (generation !== bootGeneration) {
            throw error;
        }

        bootPromise = null;
        console.error('Failed to initialize map:', error);
        showFatalError(normalizeApiErrorMessage(error, '地图初始化失败，请刷新页面重试。'));
        throw error;
    });

    return bootPromise;
}

/** 卸载（测试 / HMR 用）：移除监听并销毁图表实例。 */
export function destroyMapIsland(): void {
    bootGeneration += 1;
    state.disposers.forEach((dispose) => dispose());
    if (state.chart) {
        state.chart.dispose();
    }
    state = createState();
    islandUi = null;
    bootPromise = null;
}

/** 供探针与测试读取运行时读数（aspectScale / BASE_ZOOM / scaleLimit.min 等）。 */
export interface MapProbeReadings {
    booted: boolean;
    activeMapId: string;
    activeProvince: string | null;
    zoom: number;
    chartWidth: number;
    chartHeight: number;
    series: {
        aspectScale: unknown;
        zoom: unknown;
        scaleLimit: unknown;
    } | null;
    viewPointCount: number;
    whitelistCount: number;
    geoRegistryInstalled: boolean;
    /** 最近的激活记录（含来源：map = zrender 点击 / touch = TapFallback）。 */
    activations: Array<{ name: string; source: string; at: number }>;
}

export function readMapProbe(): MapProbeReadings {
    const option = state.chart ? state.chart.getOption() : null;
    const series = option && Array.isArray(option.series) ? (option.series[0] as Record<string, unknown>) : null;

    installGeoRegistry();
    const registry = (globalThis as { CMapGeo?: { availableProvinceFiles: readonly string[] } }).CMapGeo;

    return {
        booted: Boolean(state.chart),
        activeMapId: state.activeMapId,
        activeProvince: state.activeProvince,
        zoom: getCurrentMapView().zoom,
        chartWidth: state.chart ? state.chart.getWidth() : 0,
        chartHeight: state.chart ? state.chart.getHeight() : 0,
        series: series
            ? {
                  aspectScale: series.aspectScale,
                  zoom: series.zoom,
                  scaleLimit: series.scaleLimit
              }
            : null,
        viewPointCount: state.viewPoints.length,
        whitelistCount: registry ? registry.availableProvinceFiles.length : 0,
        geoRegistryInstalled: Boolean(registry),
        activations: state.activationLog.slice(-20)
    };
}

/** 探针用：当前视野数据点（只读副本）。 */
export function readViewPoints(): RegionPoint[] {
    return state.viewPoints.map((point) => ({ ...point }));
}

/* ------------------------------------------------------------------ *
 * 验收探针（只读；供 l3_parity / Playwright 证据脚本读运行时真实读数）
 *
 * 生产页也暴露 `window.__mapProbe`（见 src/components/MapCanvas.tsx），这是
 * **验收脚本契约**：`read / points / activate / state / events / hitTest /
 * regionPixels / bounds / whitelist` 九个字段只能加，不能改名或删除，
 * 页面自身不依赖探针。
 *
 * 几何判定（hitTestRegion / scanRegionPixels）挪到了 `src/lib/map-probe.ts`，
 * 这里只把模块内部状态封成闭包注进去，射线法仍然只有 map-model 那一份。
 * ------------------------------------------------------------------ */

const regionProbe = createRegionProbe({
    getChart: () => state.chart,
    getContainer: () => ui().map,
    getActiveMapId: () => state.activeMapId,
    getGeo: (mapId) => getGeo(mapId)
});

/** 屏幕坐标 → 地区名（与 TapFallback 同一套判定；实现在 map-probe）。 */
export const hitTestRegion = regionProbe.hitTestRegion;

/** 网格扫描：可点地区的屏幕像素（验收脚本据此真点省份；实现在 map-probe）。 */
export const scanRegionPixels = regionProbe.scanRegionPixels;

export interface BoundsPixels {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
    chartWidth: number;
    chartHeight: number;
}

/** 当前地图几何包围盒在容器里的像素位置（用来验证拖动夹紧与铺满）。 */
export function readBoundsPixels(): BoundsPixels | null {
    const chart = state.chart;
    if (!chart) {
        return null;
    }

    const bounds = getMapBounds(state.activeMapId, getGeo(state.activeMapId));
    if (!bounds) {
        return null;
    }

    const cornerA = chart.convertToPixel({ seriesIndex: 0 }, [bounds.minX, bounds.minY]);
    const cornerB = chart.convertToPixel({ seriesIndex: 0 }, [bounds.maxX, bounds.maxY]);
    if (!Array.isArray(cornerA) || !Array.isArray(cornerB)) {
        return null;
    }

    const left = Math.min(cornerA[0], cornerB[0]);
    const right = Math.max(cornerA[0], cornerB[0]);
    const top = Math.min(cornerA[1], cornerB[1]);
    const bottom = Math.max(cornerA[1], cornerB[1]);

    return {
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        width: right - left,
        height: bottom - top,
        chartWidth: chart.getWidth(),
        chartHeight: chart.getHeight()
    };
}

/** 供探针读白名单（怕 31 个省份的名字漂）。 */
export function readProvinceWhitelist(): readonly string[] {
    installGeoRegistry();
    return (globalThis as { CMapGeo?: { availableProvinceFiles: readonly string[] } }).CMapGeo?.availableProvinceFiles ?? [];
}

export { BASE_ZOOM, ZOOM_MAX };

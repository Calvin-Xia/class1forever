/**
 * 触摸点击兜底（从 `js/map.js` 的 `TapFallback` 忠实迁移）。
 *
 * zrender 只在 `touchend` 距 `touchstart` **小于 300ms** 时才补发一次 click
 * （`zrender/lib/dom/HandlerProxy.js` 的 `TOUCH_CLICK_DELAY`）。手机上对着小省份
 * 小心点按、或者设备本身有输入延迟，很容易超过这个窗口，表现就是「点了没反应」：
 * 面板不开、也不下钻。而「地区一览」是普通 DOM 按钮，没有这个限制，
 * 于是就会出现「列表能进去、地图点不动」。
 *
 * 这里自己判定一次点击：位移（≤14px）与时长（≤900ms）都比 zrender 宽松，
 * 并用时间戳与 zrender 已经派发的点击去重（450ms），避免同一次触摸触发两遍。
 *
 * 调用顺序有硬要求：**必须在 chart 实例就绪之后**再 `initTapFallback(chart, …)`，
 * 否则拿不到 viewportRoot、监听根本挂不上（静默失效）。
 */
import type { EChartsType } from './echarts';
import type { GeoJson } from './geo-loader';
import type { RegionPoint } from './map-model';
import { regionNameAtDataPoint } from './map-model';

const MAX_MOVE_PX = 14;
const MAX_DURATION_MS = 900;
const DEDUPE_MS = 450;

/** ECharts 的 viewportRoot 走的是 zrender 内部结构，公开 API 没有类型，这里收窄到用到的部分。 */
interface ChartViewportAccess {
    getZr(): { painter?: { getViewportRoot?: () => HTMLElement | null } };
}

/** `chart.getZr().painter.getViewportRoot()` —— TapFallback 要挂监听的元素。 */
function viewportRootOf(chart: EChartsType): HTMLElement | null {
    try {
        return (chart as unknown as ChartViewportAccess).getZr()?.painter?.getViewportRoot?.() ?? null;
    } catch (_error) {
        return null;
    }
}

export interface TapFallbackOptions {
    getMapId(): string;
    getGeo(mapId: string): GeoJson | null;
    /** 弹层打开时背景是 inert，这里再挡一道，避免误触。 */
    isOverlayOpen(): boolean;
    resolvePoint(name: string): RegionPoint | null;
    activate(point: RegionPoint): void;
}

let lastActivationAt = 0;

/** zrender 自己派发过点击时记一笔，避免同一次触摸触发两遍。 */
export function noteChartActivation(): void {
    lastActivationAt = Date.now();
}

/**
 * 屏幕坐标 → 地区名：先用 ECharts 公开 API `convertFromPixel` 换成数据坐标，
 * 再对当前地图做射线法命中判定。不碰 zrender/ECharts 私有字段，地图换层都能用。
 */
export function regionNameAt(
    chart: EChartsType | null,
    clientX: number,
    clientY: number,
    mapId: string,
    geoJson: GeoJson | null
): string | null {
    if (!chart || !mapId || !geoJson) {
        return null;
    }

    const viewportRoot = viewportRootOf(chart);
    if (!viewportRoot) {
        return null;
    }

    const rect = viewportRoot.getBoundingClientRect();
    let dataPoint: number[] | number;

    try {
        dataPoint = chart.convertFromPixel({ seriesIndex: 0 }, [clientX - rect.left, clientY - rect.top]);
    } catch (_error) {
        return null;
    }

    if (!Array.isArray(dataPoint) || !isFinite(dataPoint[0]) || !isFinite(dataPoint[1])) {
        return null;
    }

    return regionNameAtDataPoint(geoJson, dataPoint[0], dataPoint[1]);
}

/**
 * 挂上触摸监听，返回卸载函数。`passive: true`：绝不阻塞页面滚动，
 * 判不判成点击由我们自己的阈值决定。
 */
export function initTapFallback(chart: EChartsType, options: TapFallbackOptions): () => void {
    const viewportRoot = viewportRootOf(chart);
    if (!viewportRoot) {
        return () => {};
    }

    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;

    const handleTouchStart = (event: TouchEvent): void => {
        if (!event.touches || event.touches.length !== 1) {
            tracking = false;
            return;
        }

        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startAt = Date.now();
        tracking = true;
    };

    const handleTouchEnd = (event: TouchEvent): void => {
        if (!tracking) {
            return;
        }
        tracking = false;

        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) {
            return;
        }

        if (Date.now() - startAt > MAX_DURATION_MS) {
            return;
        }

        // 拖拽平移和双指缩放都不算点击。
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > MAX_MOVE_PX) {
            return;
        }

        if (Date.now() - lastActivationAt < DEDUPE_MS) {
            return;
        }

        if (options.isOverlayOpen()) {
            return;
        }

        const mapId = options.getMapId();
        const name = regionNameAt(chart, touch.clientX, touch.clientY, mapId, options.getGeo(mapId));
        if (!name) {
            return;
        }

        const point = options.resolvePoint(name);
        if (!point) {
            return;
        }

        lastActivationAt = Date.now();
        options.activate(point);
    };

    const handleTouchCancel = (): void => {
        tracking = false;
    };

    viewportRoot.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewportRoot.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewportRoot.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
        viewportRoot.removeEventListener('touchstart', handleTouchStart);
        viewportRoot.removeEventListener('touchend', handleTouchEnd);
        viewportRoot.removeEventListener('touchcancel', handleTouchCancel);
    };
}

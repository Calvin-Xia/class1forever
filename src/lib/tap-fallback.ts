/**
 * 触摸点击兜底（从 `js/map.js` 的 `TapFallback` 忠实迁移，并按手势分层扩写）。
 *
 * zrender 只在 `touchend` 距 `touchstart` **小于 300ms** 时才补发一次 click
 * （`zrender/lib/dom/HandlerProxy.js` 的 `TOUCH_CLICK_DELAY`），而且它自己的 click
 * 还有 4px 的 down/up 位移门槛（`zrender/lib/Handler.js` 的 `Handler.prototype.click`）。
 * 手机上对着小省份小心点按、手指稍微挪一点、或者设备本身有输入延迟，都会掉出这两个窗口，
 * 表现就是「点了没反应」：面板不开、也不下钻。而「地区一览」是普通 DOM 按钮，没有这些限制，
 * 于是就会出现「列表能进去、地图点不动」。
 *
 * 这里自己判定一次手势，位移阈值比 zrender 宽松（≤14px），并用时间戳与 zrender 已经派发的
 * 点击去重（450ms），避免同一次触摸触发两遍。按按压时长分两层：
 * - `< 300ms`：轻触 → `activate(point, 'touch-tap', 'auto')`（可下钻则下钻）；
 * - `300ms ~ 2000ms`：长按 → `activate(point, 'touch-hold', 'panel')`（强制开面板，不下钻）；
 * - `> 2000ms`：拒绝（按住太久不当作激活）。
 *
 * 长按满 300ms 时还会点亮按压反馈 `#map-press-ring`（元素与样式由页面提供，这里只写
 * `data-visible` 与 left/top）；元素缺失时静默跳过，绝不能因此让手势判定抛错。
 *
 * 调用顺序有硬要求：**必须在 chart 实例就绪之后**再 `initTapFallback(chart, …)`，
 * 否则拿不到 viewportRoot、监听根本挂不上（静默失效）。
 */
import type { EChartsType } from './echarts';
import type { GeoJson } from './geo-loader';
import type { RegionPoint } from './map-model';
import { regionNameAtDataPoint } from './map-model';

const MAX_MOVE_PX = 14;
/** 轻触 / 长按的分界：满 300ms 就算长按。 */
const HOLD_MIN_MS = 300;
/** 超过这个时长不再算激活（也不再点亮按压反馈）。 */
const MAX_DURATION_MS = 2000;
const DEDUPE_MS = 450;
const PRESS_RING_ID = 'map-press-ring';

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
    /** 轻触传 `'touch-tap'` + `'auto'`；长按传 `'touch-hold'` + `'panel'`（强制开面板）。 */
    activate(point: RegionPoint, source: 'touch-tap' | 'touch-hold', intent: 'auto' | 'panel'): void;
}

let lastActivationAt = 0;

/** 单指触摸手势是否正在进行（已 touchstart、还没 touchend/touchcancel）。 */
let touchGestureActive = false;
/** 最近一次单指触摸手势的开始/结束时间戳（见 `ownsTouchGesture()`）。 */
let lastTouchGestureAt = 0;
/**
 * 最近一次**真实鼠标**按下的时间戳（`pointerdown` 且 `pointerType === 'mouse'`）。
 * 0 = 这个内核没给过（或还没给过）鼠标 pointerdown → 让位判别自动退回 450ms 时间窗。
 */
let lastMousePointerDownAt = 0;

/** zrender 自己派发过点击时记一笔，避免同一次触摸触发两遍。 */
export function noteChartActivation(): void {
    lastActivationAt = Date.now();
}

/**
 * 这次图表事件是不是同一次触摸手势带来的 —— 是的话，`chart.on('click'/'contextmenu')`
 * 必须让位给 TapFallback，否则一次轻触会被记成两条激活（`'touch-tap'` 与 `'map'`），
 * 或者地图换层后那条迟到的原生 click 落在新画出来的省级图上、凭空激活一个城市。
 *
 * 为什么必须让位（node_modules + 浏览器行为实证，不是防御性猜测）：
 * 1. **zrender 自己就会补发 click，而且比 TapFallback 先跑**：`touchend` 处理里
 *    距 touchstart < 300ms（`TOUCH_CLICK_DELAY`）就直接调 `localDOMHandlers.click`
 *    同步合成一条 click（`zrender/lib/dom/HandlerProxy.js`，`touchend` 分支末段）；
 *    它的监听是在 `echarts.init()` 里挂到 viewportRoot 上的，而 `initTapFallback(chart, …)`
 *    按硬约束必须等 chart 就绪之后才调用 —— 同一个 viewportRoot 上先注册的先执行，
 *    所以 ≤300ms 的轻点一定是 zrender 那条 click 先到 `handleRegionClick`。
 * 2. **浏览器还会再补一条**：`touchend` 之后 Chromium 继续派发鼠标兼容事件
 *    （`mousedown`/`mouseup`/`click`），`click` 会再次进 `handleRegionClick`。
 * 3. **触摸长按可能补 `contextmenu`**：那是「长按」（TapFallback 的 `'touch-hold'`），
 *    不是鼠标右键，不能记成 `'right-click'`。
 *
 * 判据是**输入设备**，不只是时间（真 Chromium 实测，`pointerdown` 的 `pointerType` 是可靠的）：
 * - 触摸派生出来的那条 click 自己 `pointerType='touch'`，其前**没有** `pointerdown(mouse)`；
 * - 真实鼠标点击一定是 `pointerdown(pointerType='mouse')` → `mousedown` → `mouseup` → `click`。
 * 所以触摸窗口内只要出现过真实鼠标按下（`lastMousePointerDownAt > lastTouchGestureAt`），
 * 就说明这次是用户真的用鼠标点的（典型场景：触摸后 450ms 内又用鼠标点地图）→ 不让位，
 * 记 `'map'` / `'right-click'`。反过来 zrender 在 touchend 里同步合成的那条 click
 * 发生在 TapFallback 处理 touchend **之前**（那时 `touchGestureActive` 仍为 true、其前无
 * pointerdown）→ 照旧让位，轻点仍只记一条 `'touch-tap'`。
 *
 * **安全降级**：不把 `pointerType` 当唯一真相 —— 内核不给 `pointerdown`（或事件上没有
 * `pointerType`）时 `lastMousePointerDownAt` 保持 0，`0 <= lastTouchGestureAt` 恒成立，
 * 于是自动退回「触摸窗口内一律让位」的旧 450ms 行为：宁可吞掉触摸后紧接着的鼠标点击，
 * 也不能把一次触摸记成两条激活。
 */
export function ownsTouchGesture(): boolean {
    const inTouchWindow = touchGestureActive || (lastTouchGestureAt > 0 && Date.now() - lastTouchGestureAt < DEDUPE_MS);
    if (!inTouchWindow) {
        return false;
    }

    // 触摸窗口里已经出现真实鼠标按下 → 这是鼠标事件，不能吞。
    return lastMousePointerDownAt <= lastTouchGestureAt;
}

/**
 * 卸载时把让位窗口归零。StrictMode / HMR 会「先拆旧实例、再建新实例」，
 * 若只清 `touchGestureActive`、留着 `lastTouchGestureAt`，新实例头 450ms 内的
 * 鼠标左键/右键会被旧窗口误吞（`ownsTouchGesture()` 仍返回 true）；
 * 鼠标按下戳同理要清，否则旧实例的鼠标记录会盖过新实例的触摸窗口。
 */
function resetTouchGestureOwnership(): void {
    touchGestureActive = false;
    lastTouchGestureAt = 0;
    lastMousePointerDownAt = 0;
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

/* ------------------------------------------------------------------ *
 * 按压反馈（#map-press-ring）
 * ------------------------------------------------------------------ */

function pressRingOf(): HTMLElement | null {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.getElementById(PRESS_RING_ID);
}

/**
 * 把反馈环放在触点位置。left/top 是相对 ring 的包含块（当前是 `.map-frame`）**padding box**
 * 的 px：`.map-frame` 有 1px 边框而 `#map` 是它唯一的常规流子元素，所以要用
 * `clientLeft/clientTop` 扣掉那 1px。拿不到 offsetParent 时退回 viewportRoot 原点
 * （当前 DOM 下两者只差这 1px）。
 */
function showPressRing(ring: HTMLElement, clientX: number, clientY: number, viewportRoot: HTMLElement): void {
    const containingBlock = ring.offsetParent as HTMLElement | null;
    const rect = (containingBlock || viewportRoot).getBoundingClientRect();
    const borderLeft = containingBlock ? containingBlock.clientLeft : 0;
    const borderTop = containingBlock ? containingBlock.clientTop : 0;

    ring.style.left = clientX - rect.left - borderLeft + 'px';
    ring.style.top = clientY - rect.top - borderTop + 'px';
    ring.setAttribute('data-visible', 'true');
}

function hidePressRing(ring: HTMLElement | null): void {
    if (ring) {
        ring.setAttribute('data-visible', 'false');
    }
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
    let pressTimer = 0;
    let expireTimer = 0;

    const clearPressTimers = (): void => {
        if (pressTimer) {
            window.clearTimeout(pressTimer);
            pressTimer = 0;
        }
        if (expireTimer) {
            window.clearTimeout(expireTimer);
            expireTimer = 0;
        }
    };

    /** 收起按压反馈并取消两个计时器（松开 / 取消 / 超时 / 卸载都走它）。 */
    const hidePress = (): void => {
        clearPressTimers();
        hidePressRing(pressRingOf());
    };

    const handleTouchStart = (event: TouchEvent): void => {
        hidePress();

        if (!event.touches || event.touches.length !== 1) {
            tracking = false;
            // 双指（缩放）不算点击手势，也不接管 zrender 的 click 判定。
            touchGestureActive = false;
            return;
        }

        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startAt = Date.now();
        tracking = true;
        touchGestureActive = true;
        lastTouchGestureAt = startAt;

        // 满 300ms 才算长按：中途松开 / 取消会在计时器触发前清掉它。
        pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            if (!tracking) {
                return;
            }
            const ring = pressRingOf();
            if (ring) {
                showPressRing(ring, startX, startY, viewportRoot);
            }
        }, HOLD_MIN_MS);

        // 按住超过 2000ms 一律不算激活，反馈也同时收起（touchend 时还会再判一次时长）。
        expireTimer = window.setTimeout(() => {
            expireTimer = 0;
            hidePressRing(pressRingOf());
        }, MAX_DURATION_MS);
    };

    const handleTouchEnd = (event: TouchEvent): void => {
        if (!tracking) {
            return;
        }
        tracking = false;
        // 先落手势时间戳再判定：zrender 补发的 click 若排在本监听之后，也要能被挡下。
        touchGestureActive = false;
        lastTouchGestureAt = Date.now();
        hidePress();

        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) {
            return;
        }

        const duration = Date.now() - startAt;

        if (duration > MAX_DURATION_MS) {
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
        if (duration < HOLD_MIN_MS) {
            options.activate(point, 'touch-tap', 'auto');
            return;
        }

        options.activate(point, 'touch-hold', 'panel');
    };

    const handleTouchCancel = (): void => {
        tracking = false;
        touchGestureActive = false;
        lastTouchGestureAt = Date.now();
        hidePress();
    };

    /**
     * 只记「真实鼠标」，用来把触摸窗口里的鼠标点击放行（见 `ownsTouchGesture()`）。
     * 用 capture 阶段并且必须挂在同一个 viewportRoot 上：它要在 zrender / ECharts 的
     * 处理之前先把设备类型记下来，这样 `handleRegionClick` / `handleRegionContextMenu`
     * 在同一个事件序列里查到的就是本次输入设备。触摸自己的 pointerdown 带
     * `pointerType === 'touch'`（以及 pen），这里一律忽略；老内核给不了 pointerdown 时
     * 这个戳保持 0，让位判别自动退回 450ms 时间窗（安全降级）。
     *
     * 还要 `isTrusted`：脚本 `dispatchEvent(new PointerEvent(…))` 造出来的是 untrusted 事件，
     * 真实用户输入才是 trusted —— 这是公开信号里唯一能区分二者的手段，也是收口「页面脚本伪造
     * `pointerdown(pointerType='mouse')` 会让 zrender 合成的那条 click 被误标成 `'map'`」
     * 这条理论限制的钥匙。`isTrusted` 缺失或为 false（合成事件、老内核不给该字段）一律按
     * 「不记戳」处理：判别退回「触摸窗口内一律让位」的安全方向。
     */
    const handlePointerDown = (event: PointerEvent): void => {
        if (event && event.isTrusted && event.pointerType === 'mouse') {
            lastMousePointerDownAt = Date.now();
        }
    };

    viewportRoot.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
    viewportRoot.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewportRoot.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewportRoot.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
        tracking = false;
        // 归零让位窗口（不只是置 false）：旧实例卸载后，新实例的鼠标事件不能被余窗吞掉。
        resetTouchGestureOwnership();
        hidePress();
        viewportRoot.removeEventListener('pointerdown', handlePointerDown, { capture: true });
        viewportRoot.removeEventListener('touchstart', handleTouchStart);
        viewportRoot.removeEventListener('touchend', handleTouchEnd);
        viewportRoot.removeEventListener('touchcancel', handleTouchCancel);
    };
}

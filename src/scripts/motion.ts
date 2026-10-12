/**
 * @fileoverview 纸本图志的 L2 动效层（迁移自 js/motion.js，逐条等价）。
 *
 * 只做三件事，都刻意做得很轻：
 *   1. 光标墨晕 —— 把指针位置写进 --mx/--my，由 .atmosphere__glow 的
 *      radial-gradient 消费。每帧只重绘那一层，不碰纸纹与网格。
 *   2. 按钮磁吸 —— 把位移写进 --magnet-x/--magnet-y，由 .magnet 的 transform 消费。
 *   3. 卡片聚光 —— 把指针位置写进 --sx/--sy，由 .spotlight::after 消费。
 *
 * 为什么不引 GSAP / Lenis：本项目 CSP 是 script-src 'self'，跨域脚本会被
 * build.js 直接拦下；而且这是一个单屏工具页，没有滚动叙事，滚动库只有成本。
 *
 * 降级（这条是硬纪律，不是「注册了但不动画」）：prefers-reduced-motion: reduce
 * 或没有精确指针（(hover: hover) and (pointer: fine) 不成立）时，本模块在
 * `initMotion()` 的最前面就返回 false，**一个监听都不注册**。
 * 所有 pointermove 监听都走 rAF 节流，一帧最多算一次。
 */

const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** 磁吸位移上限 4px，再多就不像纸面该有的手感了。 */
const MAGNET_STRENGTH = 4;

type PointerLikeEvent = { clientX: number; clientY: number };
type PointerHandler = (event: PointerLikeEvent) => void;

type MotionWindow = Window & typeof globalThis;

/**
 * 是否应该启用动效层。
 *
 * 导出出来是为了让探针能在页面里直接复核判据（而不是靠肉眼），
 * 页面本身只用 `initMotion`。
 */
export function motionEnabled(view: MotionWindow): boolean {
    if (!view.matchMedia || !view.requestAnimationFrame) {
        return false;
    }

    if (view.matchMedia(REDUCE_MOTION_QUERY).matches) {
        return false;
    }

    return view.matchMedia(FINE_POINTER_QUERY).matches;
}

/** 把高频事件压到每帧一次。 */
function rafThrottle(view: MotionWindow, handler: PointerHandler): PointerHandler {
    let frame = 0;
    let latest: PointerLikeEvent | null = null;

    return function (event: PointerLikeEvent): void {
        latest = event;
        if (frame) {
            return;
        }

        frame = view.requestAnimationFrame(function () {
            frame = 0;
            handler(latest as PointerLikeEvent);
        });
    };
}

/**
 * 注册三个效果。返回是否真的注册了监听（降级时为 false）。
 *
 * 元素缺失时按旧实现静默跳过：`.atmosphere` / `.magnet` / `.spotlight`
 * 都来自页面结构，缺哪个就少注册哪一组，不影响其它两组。
 */
export function initMotion(doc: Document, view: MotionWindow): boolean {
    if (!motionEnabled(view)) {
        return false;
    }

    const root = doc.documentElement;

    /* 1. 光标墨晕：整页共用一个监听，写在 :root 上 */
    const atmosphere = doc.querySelector('.atmosphere');

    if (atmosphere) {
        const trackGlow = rafThrottle(view, function (event) {
            root.style.setProperty('--mx', event.clientX + 'px');
            root.style.setProperty('--my', event.clientY + 'px');
        });

        view.addEventListener('pointermove', trackGlow, { passive: true });
    }

    /* 2. 按钮磁吸 */
    doc.querySelectorAll<HTMLElement>('.magnet').forEach(function (element) {
        // 元素自己会被 translate 推动，每帧重新测量会形成反馈抖动；
        // 位移只有几像素，进场时量一次就够。
        let rect: DOMRect | null = null;

        const trackMagnet = rafThrottle(view, function (event) {
            if (!rect) {
                rect = element.getBoundingClientRect();
            }

            const offsetX = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2 || 1);
            const offsetY = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2 || 1);

            element.style.setProperty('--magnet-x', (offsetX * MAGNET_STRENGTH).toFixed(2) + 'px');
            element.style.setProperty('--magnet-y', (offsetY * MAGNET_STRENGTH).toFixed(2) + 'px');
        });

        element.addEventListener('pointerenter', function () {
            rect = element.getBoundingClientRect();
        }, { passive: true });

        element.addEventListener('pointermove', trackMagnet, { passive: true });

        element.addEventListener('pointerleave', function () {
            rect = null;
            element.style.setProperty('--magnet-x', '0px');
            element.style.setProperty('--magnet-y', '0px');
        }, { passive: true });
    });

    /* 3. 卡片聚光：把指针打在按钮上的位置换算成百分比，交给 radial-gradient */
    doc.querySelectorAll<HTMLElement>('.spotlight').forEach(function (element) {
        let rect: DOMRect | null = null;

        const trackSpotlight = rafThrottle(view, function (event) {
            if (!rect) {
                rect = element.getBoundingClientRect();
            }

            if (!rect.width || !rect.height) {
                return;
            }

            element.style.setProperty('--sx', ((event.clientX - rect.left) / rect.width * 100).toFixed(2) + '%');
            element.style.setProperty('--sy', ((event.clientY - rect.top) / rect.height * 100).toFixed(2) + '%');
        });

        element.addEventListener('pointerenter', function () {
            rect = element.getBoundingClientRect();
        }, { passive: true });

        element.addEventListener('pointermove', trackSpotlight, { passive: true });

        element.addEventListener('pointerleave', function () {
            rect = null;
        }, { passive: true });
    });

    return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    initMotion(document, window as MotionWindow);
}

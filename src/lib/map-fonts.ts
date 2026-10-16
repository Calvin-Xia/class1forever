/**
 * 地图 / 分享图的字体预加载。
 *
 * 为什么必须等一次：Canvas 在首次测量文字之后就定死了字形，字体后到不会触发重排，
 * 于是「先用回退字体量一遍、几毫秒后正式字体到达」会把省份标注和分享图上的数字
 * 排错位。所以画之前先 `document.fonts.load(...)`。
 *
 * 为什么是**尽力而为**：字体下载走的是同一批静态资源，断网 / 慢网时它可能一直不
 * resolve。首屏与下钻不该被字体拖住 —— 这是个地图，字晚一点到不影响先看到图。
 * 因此这里带超时（默认 2s）并把失败一并吞掉：超时或失败都按「用回退字体先画」
 * 处理，只留一条 warn。
 */
import type { GeoJson } from './geo-loader';

/** 字体等待上限：超过它就先画，不让字体阻塞首屏、下钻与分享图。 */
export const FONT_LOAD_TIMEOUT_MS = 2000;

/**
 * 给一组字体加载 Promise 套一个「超时即放行」的壳。
 *
 * 无论成功、失败还是超时都 resolve —— 调用方永远拿到一个不会 reject 的 Promise。
 * `loads` 传 null 表示当前环境没有 `document.fonts`，直接放行。
 */
export function loadFontsBestEffort(loads: Promise<unknown> | null, timeoutMs = FONT_LOAD_TIMEOUT_MS): Promise<void> {
    if (!loads) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        const settle = (): void => {
            clearTimeout(timer);
            resolve();
        };
        loads.then(settle, settle);
    });
}

/** 在 ECharts 首次测量文字前加载本视图字形；失败 / 超时都不阻断调用方。 */
export async function loadMapFonts(geo: GeoJson): Promise<void> {
    try {
        if (typeof document === 'undefined' || !document.fonts) {
            return;
        }

        const names = (geo.features || []).map(feature => String(feature.properties?.name || '')).join('');
        await loadFontsBestEffort(
            Promise.all([
                document.fonts.load('600 12px "Noto Sans SC"', '0123456789 人'),
                document.fonts.load('700 11px "Noto Sans SC"', names || '中国')
            ])
        );
    } catch (error) {
        console.warn('地图字体预加载失败，改用回退字体继续绘制：', error);
    }
}

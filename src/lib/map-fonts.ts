import type { GeoJson } from './geo-loader';

/** 在 ECharts 首次测量文字前加载本视图字形；Canvas 不会随 CSS 字体到达自动重排。 */
export async function loadMapFonts(geo: GeoJson): Promise<void> {
    const names = (geo.features || []).map(feature => String(feature.properties?.name || '')).join('');
    await Promise.all([
        document.fonts.load('600 12px "Noto Sans SC"', '0123456789 人'),
        document.fonts.load('700 11px "Noto Sans SC"', names || '中国')
    ]);
}

/**
 * ECharts 配置构造（从 `js/map.js` 的 buildVisualMapOption / buildMapSeries /
 * buildChartOption / chartAnimationEnabled / isTouchDevice 迁移），取值与旧实现逐项对齐。
 *
 * 三个最容易踩坑的约束在这里落地：
 * - `series.aspectScale` 必须是 1：geo 是 EPSG:3415 预投影的米制平面坐标，
 *   ECharts 默认的 0.75 是为经纬度准备，会把地图纵向拉高三分之一；
 * - `zoom: BASE_ZOOM` 同时是初始比例与 `scaleLimit.min`（ECharts 只填 80% 布局盒）；
 * - tooltip 在触摸设备上关掉（`show: !isTouchDevice`），触摸走 TapFallback 与抽屉。
 */
import { palette } from '../styles/palette';
import { BASE_ZOOM, REGION_SERIES_ID, computeHeatMax, legendLayout, ZOOM_MAX } from './map-model';
import type { RegionPoint } from './map-model';
import type { EChartsCoreOption } from './echarts';
import { renderPublicCardHtml } from './tooltip-card';
import type { DetailHintState } from './tooltip-card';

const HEAT_COLORS = palette.heat;
const BORDER_COLOR = palette.regionBorder;
const HOVER_AREA_COLOR = palette.hoverArea;
const HOVER_BORDER_COLOR = palette.hoverBorder;

/**
 * 判断是否使用移动端交互方式（与旧实现同一套判据）。
 *
 * 只看 maxTouchPoints 会把带触摸屏的笔记本一起算进来，而那些设备上鼠标悬停是能用的；
 * 一旦误判，悬浮卡片永远不出现。所以优先看主输入设备是否支持悬停。
 */
export function isTouchDevice(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    if (window.matchMedia) {
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            return false;
        }
        if (window.matchMedia('(pointer: coarse)').matches) {
            return true;
        }
    }

    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * ECharts 画在 canvas 上，主样式表里那个 prefers-reduced-motion 块管不到它。
 * 着色与下钻动画得单独读一次媒体查询。
 */
export function chartAnimationEnabled(): boolean {
    return !(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * 底部色带图例：它同时负责上色，`hoverLink` 让鼠标停在某个省时在色带上标出对应人数。
 */
export function buildVisualMapOption(points: readonly RegionPoint[], viewport: number): Record<string, unknown> {
    const max = computeHeatMax(points as readonly RegionPoint[]);
    const layout = legendLayout(viewport);

    return {
        type: 'continuous',
        min: 0,
        max: max,
        precision: 0,
        calculable: false,
        hoverLink: true,
        orient: 'horizontal',
        left: layout.left,
        bottom: layout.bottom,
        itemWidth: 12,
        itemHeight: layout.length,
        text: [`${max} 人`, '0 人'],
        textGap: 10,
        textStyle: {
            color: palette.visualMapText,
            fontFamily: palette.fonts.body,
            fontSize: 12,
            fontWeight: 600,
            // 图例没有底板，压到深色地块上数字会糊；加一圈细纸白边。
            textBorderColor: palette.visualMapHalo,
            textBorderWidth: 2
        },
        indicatorIcon: 'circle',
        indicatorSize: '60%',
        indicatorStyle: {
            borderColor: HOVER_BORDER_COLOR,
            borderWidth: 2,
            shadowBlur: 4,
            shadowColor: palette.indicatorShadow
        },
        inRange: {
            color: [...HEAT_COLORS]
        }
    };
}

export function buildMapSeries(
    mapId: string,
    regionName: string,
    points: readonly RegionPoint[],
    showLabels: boolean
): Record<string, unknown> {
    return {
        id: REGION_SERIES_ID,
        type: 'map',
        map: mapId,
        name: regionName,
        data: points,
        roam: true,
        // 预投影数据（EPSG:3415 米制）：默认 0.75 会把地图纵向拉高 1/3。
        aspectScale: 1,
        zoom: BASE_ZOOM,
        center: null,
        scaleLimit: {
            min: BASE_ZOOM,
            max: ZOOM_MAX
        },
        selectedMode: false,
        labelLayout: {
            hideOverlap: true
        },
        label: {
            show: Boolean(showLabels),
            color: palette.mapLabel,
            fontFamily: palette.fonts.body,
            fontSize: 11,
            fontWeight: 700,
            textBorderColor: palette.mapLabelHalo,
            textBorderWidth: 1
        },
        itemStyle: {
            areaColor: HEAT_COLORS[0],
            borderColor: BORDER_COLOR,
            borderWidth: 1
        },
        emphasis: {
            label: {
                show: true,
                color: palette.mapLabelEmphasis,
                fontWeight: 700,
                textBorderColor: palette.mapLabelEmphasisHalo,
                textBorderWidth: 2
            },
            itemStyle: {
                areaColor: HOVER_AREA_COLOR,
                borderColor: HOVER_BORDER_COLOR,
                borderWidth: 2,
                shadowBlur: 10,
                shadowColor: palette.hoverShadow
            }
        }
    };
}

export interface ChartOptionContext {
    /** 触摸设备上不显示 tooltip（走 TapFallback + 抽屉）。 */
    isTouch: boolean;
    /** reduce motion 时关掉动画。 */
    animate: boolean;
    /** 视口宽度，决定色带图例的长度与位置。 */
    viewport: number;
    /** 由地区名找数据点，喂给 tooltip formatter。 */
    resolvePoint: (name: unknown) => RegionPoint | null;
    /** 悬浮卡片提示语所需的状态。 */
    hintState: () => DetailHintState;
    /** 当前省级视野（tooltip 的 province/city 判定要用）。 */
    activeProvince: () => string | null;
}

export function buildChartOption(context: ChartOptionContext): EChartsCoreOption {
    const animate = context.animate;

    return {
        backgroundColor: 'transparent',
        animation: animate,
        animationDuration: animate ? 320 : 0,
        animationDurationUpdate: animate ? 320 : 0,
        tooltip: {
            show: !context.isTouch,
            trigger: 'item',
            confine: true,
            className: 'map-tooltip',
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
            shadowBlur: 0,
            transitionDuration: 0.15,
            showDelay: 60,
            hideDelay: 60,
            extraCssText: 'box-shadow:none;background:transparent;border:0;padding:0;white-space:normal;',
            formatter: (params: { name?: unknown }) => {
                const point = context.resolvePoint(params && params.name);
                return point ? renderPublicCardHtml(point, { compact: true }, context.activeProvince(), context.hintState()) : '';
            }
        },
        visualMap: buildVisualMapOption([], context.viewport),
        series: [buildMapSeries('cn/china', '中国', [], false)]
    } as EChartsCoreOption;
}

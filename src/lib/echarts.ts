/**
 * ECharts 按需注册（消费 `echarts` npm 依赖，ADR-0002）。
 *
 * 模块集合与旧的自建产物 `js/vendor/echarts.min.js`（`scripts/vendor/echarts-entry.mjs`）
 * 逐一对应：map + geo + tooltip + visualMap(continuous) + labelLayout + canvas。
 * 不要在这里 import `echarts` 主入口 —— 那是全量包，会把没用的图表类型都带进首屏 chunk。
 */
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { GeoComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
    MapChart,
    GeoComponent,
    TooltipComponent,
    VisualMapContinuousComponent,
    // 省内地图区县标注很密，靠 hideOverlap 自动让开重叠的标签。
    LabelLayout,
    CanvasRenderer
]);

export { echarts };
export type { EChartsCoreOption, EChartsType } from 'echarts/core';

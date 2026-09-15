/**
 * ECharts 按需构建入口。
 *
 * 只注册本项目真正用到的模块，产物写入 js/vendor/echarts.min.js。
 * 重新生成：npm run vendor:build
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

export * from 'echarts/core';

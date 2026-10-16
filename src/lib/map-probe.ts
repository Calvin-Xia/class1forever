/**
 * 验收探针里的几何判定（只读）：屏幕坐标 → 地区名、可点地区的屏幕像素扫描。
 *
 * 从 `src/lib/map-island.ts` 抽出来的一段。它只服务验收脚本（`l3_parity` 的
 * Playwright 证据脚本要真点某个省份，就得先知道那个省的像素在哪），和图表生命周期
 * 无关，独立成模块既好读也避免了「探针逻辑和挂载逻辑混在一起」。
 *
 * **形状是契约**：生产页（`src/components/MapCanvas.tsx`）把本模块的
 * `hitTestRegion` / `scanRegionPixels` 挂到 `window.__mapProbe` 上，外部验收脚本按
 * `read / points / activate / state / events / hitTest / regionPixels / bounds /
 * whitelist` 这九个字段读取。字段名或语义一改，脚本会静默拿到 `undefined` 而不是报错。
 *
 * 射线法只有一份：`map-model.ts` 的 `regionNamesAtDataPoint()` / `regionNameAtDataPoint()`
 * （TapFallback 也走它）。这里不再自己实现一遍命中判定 —— 重复实现正是
 * 「地图点中了、探针说没中」的温床。
 *
 * 本模块不持有 ECharts 实例，图表 / 容器 / 当前地图由调用方通过 `MapProbeContext`
 * 注入（`map-island.ts` 把模块内部状态封进闭包），因此可以单独测试。
 */
import type { EChartsType } from './echarts';
import type { GeoJson } from './geo-loader';
import { normalizeRegionToken, regionNameAtDataPoint, regionNamesAtDataPoint } from './map-model';

export interface MapProbeContext {
    getChart(): EChartsType | null;
    getContainer(): HTMLElement | null;
    /** 当前地图 id：全国是 `cn/china`，省级是 `cn/<filename>`。 */
    getActiveMapId(): string;
    getGeo(mapId: string): GeoJson | null;
}

export interface RegionProbe {
    /** 屏幕坐标（clientX/clientY）→ 地区名；落在空白处返回 null。 */
    hitTestRegion(clientX: number, clientY: number): string | null;
    /** 网格扫描：可点地区的屏幕像素候选（按离候选集重心最近排序）。 */
    scanRegionPixels(step?: number, fineStep?: number): Record<string, Array<{ x: number; y: number }>>;
}

interface FeatureBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** 容器内像素坐标 → 数据坐标；越界或换算失败返回 null。 */
function dataPointAt(chart: EChartsType, rect: DOMRect, clientX: number, clientY: number): [number, number] | null {
    let dataPoint: number[] | number;
    try {
        dataPoint = chart.convertFromPixel({ seriesIndex: 0 }, [clientX - rect.left, clientY - rect.top]);
    } catch (_error) {
        return null;
    }
    if (!Array.isArray(dataPoint) || !isFinite(dataPoint[0]) || !isFinite(dataPoint[1])) {
        return null;
    }
    return [dataPoint[0], dataPoint[1]];
}

/**
 * 每个 feature 在数据坐标系里的包围盒，**下标与 `geoJson.features` 一一对应**
 * （没有名字或没有坐标的 feature 为 null，占位不塌缩）——网格扫描要靠这个下标
 * 把包围盒喂给 `regionNamesAtDataPoint` 的可选过滤器。
 */
function collectFeatureBoxes(geoJson: GeoJson | null): Array<FeatureBox | null> {
    if (!geoJson || !Array.isArray(geoJson.features)) {
        return [];
    }

    return geoJson.features.map((feature) => {
        const name = normalizeRegionToken((feature.properties || {}).name);
        if (!name) {
            return null;
        }

        const geometry = feature.geometry || {};
        const polygons: unknown[] =
            geometry.type === 'Polygon'
                ? [geometry.coordinates]
                : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
                  ? geometry.coordinates
                  : [];

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        const visit = (node: unknown): void => {
            if (!Array.isArray(node)) {
                return;
            }
            if (typeof node[0] === 'number' && typeof node[1] === 'number') {
                minX = Math.min(minX, node[0]);
                maxX = Math.max(maxX, node[0]);
                minY = Math.min(minY, node[1]);
                maxY = Math.max(maxY, node[1]);
                return;
            }
            node.forEach(visit);
        };
        polygons.forEach(visit);

        return minX === Infinity ? null : { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    });
}

function boxContains(box: FeatureBox | null, x: number, y: number): boolean {
    return Boolean(box && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
}

export function createRegionProbe(context: MapProbeContext): RegionProbe {
    /** 屏幕坐标 → 地区名（走 ECharts 公开 API + map-model 的射线法，与 TapFallback 同一套判定）。 */
    function hitTestRegion(clientX: number, clientY: number): string | null {
        const chart = context.getChart();
        const container = context.getContainer();
        if (!chart || !container) {
            return null;
        }

        const dataPoint = dataPointAt(chart, container.getBoundingClientRect(), clientX, clientY);
        if (!dataPoint) {
            return null;
        }

        return regionNameAtDataPoint(context.getGeo(context.getActiveMapId()), dataPoint[0], dataPoint[1]);
    }

    /**
     * 找出每个可点地区的一组屏幕像素（验收脚本用它定位省份再真点）。
     *
     * 两轮：先按 `step` 粗扫全图；对粗扫没命中的地区（如澳门这种极小地块），
     * 在它的几何包围盒对应的像素框里用 `fineStep` 补扫。
     * 结果按「离候选集重心最近」排序，验收脚本优先点最靠内的像素 ——
     * 边界像素上 ECharts 自己的命中判定可能与射线法差一个地区。
     */
    function scanRegionPixels(step = 10, fineStep = 2): Record<string, Array<{ x: number; y: number }>> {
        const chart = context.getChart();
        const container = context.getContainer();
        if (!chart || !container) {
            return {};
        }

        const geoJson = context.getGeo(context.getActiveMapId());
        const boxes = collectFeatureBoxes(geoJson);
        const rect = container.getBoundingClientRect();
        const candidates = new Map<string, Array<{ x: number; y: number }>>();

        const push = (name: string, x: number, y: number): void => {
            const list = candidates.get(name);
            if (list) {
                list.push({ x: x, y: y });
            } else {
                candidates.set(name, [{ x: x, y: y }]);
            }
        };

        // 只对包围盒命中的 feature 做射线法：结果与全量判定完全一致（包围盒是几何的上界），
        // 但省掉了绝大多数像素上「遍历所有省份的所有环」的开销。
        //
        // 这里用 `regionNamesAtDataPoint`（全部命中）而不是单个名字：旧实现就是一个像素
        // 可以被多个地区同时收下（重叠的 feature，实测全国数据里「南海诸岛」有两个），
        // 只取第一个会让某些地点的候选像素消失。
        const regionNamesAt = (x: number, y: number): string[] =>
            regionNamesAtDataPoint(geoJson, x, y, (_feature, index) => boxContains(boxes[index], x, y));

        const scanBox = (left: number, top: number, right: number, bottom: number, stepSize: number): void => {
            // 起点对齐到像素中心：step=1 时就是 x.5 网格，才可能命中只有 1px 的地块（澳门）。
            const startX = Math.floor(Math.max(rect.left, left)) + stepSize / 2;
            const startY = Math.floor(Math.max(rect.top, top)) + stepSize / 2;
            const endX = Math.min(rect.right, right);
            const endY = Math.min(rect.bottom, bottom);

            for (let y = startY; y < endY; y += stepSize) {
                for (let x = startX; x < endX; x += stepSize) {
                    // 只收「真正能点到地图」的像素：被工具栏 / 图例 / 缩放控件盖住的像素
                    // elementFromPoint 会返回那层浮层，跳过它，验收脚本就不用再猜坐标了。
                    const topElement = document.elementFromPoint(x, y);
                    if (!topElement || !container.contains(topElement)) {
                        continue;
                    }

                    const dataPoint = dataPointAt(chart, rect, x, y);
                    if (!dataPoint) {
                        continue;
                    }

                    // 与旧实现一致：一个像素可以被多个地区同时收下（重叠几何），不提前 break。
                    regionNamesAt(dataPoint[0], dataPoint[1]).forEach((name) => push(name, x, y));
                }
            }
        };

        scanBox(rect.left, rect.top, rect.right, rect.bottom, step);

        // 第二轮：粗扫没找着的地区，在它自己的像素包围盒里细扫。
        // 小地块（澳门）可能只有 1px，所以这里用 step=1；区块很大时退到 2 控制成本。
        const features = geoJson && Array.isArray(geoJson.features) ? geoJson.features : [];
        const namedBoxes = new Map<string, FeatureBox>();
        features.forEach((feature, index) => {
            const name = normalizeRegionToken((feature.properties || {}).name);
            const box = boxes[index];
            if (!name || !box) {
                return;
            }
            const existing = namedBoxes.get(name);
            if (!existing) {
                namedBoxes.set(name, { ...box });
                return;
            }
            existing.minX = Math.min(existing.minX, box.minX);
            existing.minY = Math.min(existing.minY, box.minY);
            existing.maxX = Math.max(existing.maxX, box.maxX);
            existing.maxY = Math.max(existing.maxY, box.maxY);
        });

        for (const [name, box] of namedBoxes) {
            if (candidates.has(name)) {
                continue;
            }
            let cornerA: number[] | number;
            let cornerB: number[] | number;
            try {
                cornerA = chart.convertToPixel({ seriesIndex: 0 }, [box.minX, box.minY]);
                cornerB = chart.convertToPixel({ seriesIndex: 0 }, [box.maxX, box.maxY]);
            } catch (_error) {
                continue;
            }
            if (!Array.isArray(cornerA) || !Array.isArray(cornerB)) {
                continue;
            }

            const boxWidth = Math.abs(cornerB[0] - cornerA[0]);
            const boxHeight = Math.abs(cornerB[1] - cornerA[1]);
            const fineStepForThisRegion = boxWidth * boxHeight > 40000 ? 2 : 1;

            scanBox(
                rect.left + Math.min(cornerA[0], cornerB[0]) - 2,
                rect.top + Math.min(cornerA[1], cornerB[1]) - 2,
                rect.left + Math.max(cornerA[0], cornerB[0]) + 2,
                rect.top + Math.max(cornerA[1], cornerB[1]) + 2,
                Math.min(fineStep, fineStepForThisRegion)
            );
        }

        const result: Record<string, Array<{ x: number; y: number }>> = {};
        for (const [name, list] of candidates) {
            const centerX = list.reduce((sum, point) => sum + point.x, 0) / list.length;
            const centerY = list.reduce((sum, point) => sum + point.y, 0) / list.length;
            result[name] = list
                .slice()
                .sort(
                    (left, right) =>
                        Math.hypot(left.x - centerX, left.y - centerY) - Math.hypot(right.x - centerX, right.y - centerY)
                )
                .slice(0, 8);
        }

        return result;
    }

    return { hitTestRegion, scanRegionPixels };
}

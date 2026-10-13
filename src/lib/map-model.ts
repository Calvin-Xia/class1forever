/**
 * 地图数据层（从 `js/map.js` 忠实迁移的纯逻辑，无 DOM、无 ECharts 依赖）。
 *
 * 这里只做「GeoJSON + 公开聚合 → 数据点 / 索引 / 包围盒」的换算，方便单测与复用；
 * 图表装配在 `src/lib/chart-options.ts`，ECharts 实例与事件在 `src/lib/map-island.ts`。
 */
import type { PublicMapPayload } from './types';
import type { GeoFeature, GeoJson } from './geo-loader';

export const CHINA_MAP_ID = 'cn/china';
export const PROVINCE_MAP_PREFIX = 'cn/';
export const REGION_SERIES_ID = 'regions';

/** ECharts 自动布局只用掉容器 80%，1.25 倍正好铺满；因此同时是初始比例与最小比例。 */
export const BASE_ZOOM = 1.25;
export const ZOOM_MAX = 8;
/** 判定平移是否越界时的容差（像素）。 */
export const ROAM_TOLERANCE_PX = 0.5;

/** 地图上的一个地区数据点（省 / 城市都走这个形状）。 */
export interface RegionPoint {
    /** 地区名，ECharts 用它匹配 GeoJSON feature 的 name。 */
    name: string;
    /** 公开人数。 */
    value: number;
    province: string;
    /** 省级视野下是城市名；全国视野下为 null。 */
    city: string | null;
    /** 全国视野下的「覆盖城市数」。 */
    cityCount: number;
    /** 有省级地图文件时可下钻；台湾 / 香港 / 澳门 / 南海为 null。 */
    drilldownFile: string | null;
    /** 下钻加载中标记。 */
    loading?: boolean;
}

export interface ProvinceCatalogEntry {
    name: string;
    file: string | null;
    point: RegionPoint | null;
}

export interface Region {
    province: string;
    city: string | null;
}

export interface MapBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * 归一化地区名：空串 / `'null'` / `'undefined'`（前端把 null 拼进查询串的产物）
 * 一律按「没有」处理。
 */
export function normalizeRegionToken(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
        return null;
    }

    return normalized;
}

/** 把数据点还原成 `{ province, city }`，供详情接口与分享图使用。 */
export function getPointRegion(point: RegionPoint | null | undefined, activeProvince: string | null): Region {
    const province =
        normalizeRegionToken(point && point.province) || normalizeRegionToken(activeProvince) || normalizeRegionToken(point && point.name);

    return {
        province: province ?? '',
        city: normalizeRegionToken(point && point.city)
    };
}

export function getRegionKey(region: Region): string {
    return region.city ? `${region.province}::${region.city}` : `${region.province}::*`;
}

export function getPointCount(point: RegionPoint | null | undefined): number {
    return Number(point && point.value ? point.value : 0);
}

/** 公开数据里某个省的聚合：人数 + 有登记的城市数。 */
export function getProvinceSummary(
    publicData: PublicMapPayload | null,
    provinceName: string | null
): { count: number; cities: number } {
    if (!provinceName) {
        return { count: 0, cities: 0 };
    }

    const summaries = (publicData && publicData.provinces) || {};
    const summary = summaries[provinceName] || null;

    return {
        count: summary ? Number(summary.count || 0) : 0,
        cities: Object.keys((summary && summary.cities) || {}).length
    };
}

/**
 * 由全国 GeoJSON 建立地区目录。
 * 只有仓库里确实带省级地图的地区才允许下钻（白名单来自 `src/lib/geo-loader.ts`）。
 */
export function buildProvinceCatalog(geoJson: GeoJson, hasFile: (filename: unknown) => boolean): Record<string, ProvinceCatalogEntry> {
    if (!geoJson || !Array.isArray(geoJson.features)) {
        throw new Error('缺少中国地图数据，请刷新页面重试。');
    }

    const catalog: Record<string, ProvinceCatalogEntry> = {};

    geoJson.features.forEach((feature: GeoFeature) => {
        const properties = feature.properties || {};
        const name = normalizeRegionToken(properties.name);
        if (!name) {
            return;
        }
        if (!catalog[name]) {
            catalog[name] = {
                name: name,
                file: null,
                point: null
            };
        }
        if (hasFile(properties.filename)) {
            catalog[name].file = String(properties.filename);
        }
    });

    return catalog;
}

/** 全国视野的数据点（每个省级区域一个）。 */
export function buildNationalPoints(
    catalog: Record<string, ProvinceCatalogEntry>,
    publicData: PublicMapPayload | null
): RegionPoint[] {
    const summaries = (publicData && publicData.provinces) || {};

    return Object.keys(catalog).map((name) => {
        const entry = catalog[name];
        const summary = summaries[name] || {};
        const point: RegionPoint =
            entry.point ||
            ({
                name: name,
                province: name,
                city: null,
                value: 0,
                cityCount: 0,
                drilldownFile: null
            } satisfies RegionPoint);

        point.value = Number(summary.count || 0);
        point.cityCount = Object.keys(summary.cities || {}).length;
        point.drilldownFile = entry.file;
        entry.point = point;

        return point;
    });
}

/** 省级视野的数据点（该省 GeoJSON 的每个市级 feature 一个）。 */
export function buildProvincePoints(
    catalog: Record<string, ProvinceCatalogEntry>,
    provinceName: string,
    provinceGeoJson: GeoJson | null,
    publicData: PublicMapPayload | null
): RegionPoint[] {
    const entry = catalog[provinceName];
    if (!entry || !entry.file || !provinceGeoJson || !Array.isArray(provinceGeoJson.features)) {
        return [];
    }

    const summaries = (publicData && publicData.provinces) || {};
    const citySummary = (summaries[provinceName] || {}).cities || {};
    const seen = new Set<string>();

    return provinceGeoJson.features.reduce<RegionPoint[]>((points, feature) => {
        const name = normalizeRegionToken((feature.properties || {}).name);
        if (!name || seen.has(name)) {
            return points;
        }
        seen.add(name);

        points.push({
            name: name,
            value: Number(citySummary[name] || 0),
            province: provinceName,
            city: name,
            cityCount: 0,
            drilldownFile: null
        });

        return points;
    }, []);
}

export function createRegionIndex(points: RegionPoint[]): Map<string, RegionPoint> {
    const index = new Map<string, RegionPoint>();
    points.forEach((point) => {
        index.set(point.name, point);
    });
    return index;
}

/** 由地区名找回数据点；找不到时也保证面板能打开（只是没有聚合人数）。 */
export function resolveRegionPoint(
    name: unknown,
    index: Map<string, RegionPoint>,
    activeProvince: string | null
): RegionPoint | null {
    const regionName = normalizeRegionToken(name);
    if (!regionName) {
        return null;
    }

    const known = index.get(regionName);
    if (known) {
        return known;
    }

    return {
        name: regionName,
        value: 0,
        province: activeProvince || regionName,
        city: activeProvince ? regionName : null,
        cityCount: 0,
        drilldownFile: null
    };
}

/** 色带图例的上限（至少 1）。 */
export function computeHeatMax(points: readonly RegionPoint[] | { forEach(cb: (value: RegionPoint) => void): void }): number {
    let max = 0;
    points.forEach((point) => {
        max = Math.max(max, Number(point.value) || 0);
    });

    return Math.max(1, Math.ceil(max));
}

export interface LegendLayout {
    length: number;
    left: number | 'center';
    bottom: number;
}

/**
 * 图例标尺的尺寸与位置（窄屏要同时避开左下 44px 的缩放控件）。
 * 读的是调用时的视口宽度，与原实现一致。
 */
export function legendLayout(viewport: number): LegendLayout {
    if (viewport < 768) {
        return {
            length: Math.max(120, Math.min(200, viewport - 200)),
            left: 56,
            bottom: 12
        };
    }

    return {
        length: Math.max(200, Math.min(340, viewport - 160)),
        left: 'center',
        bottom: 12
    };
}

const boundsCache = new Map<string, MapBounds | null>();

/** 某个地图在数据坐标系里的包围盒（用于限制平移范围），按地图缓存。 */
export function getMapBounds(mapId: string, geoJson: GeoJson | null): MapBounds | null {
    if (boundsCache.has(mapId)) {
        return boundsCache.get(mapId) ?? null;
    }

    let bounds: MapBounds | null = null;

    if (geoJson && Array.isArray(geoJson.features)) {
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
            for (let index = 0; index < node.length; index += 1) {
                visit(node[index]);
            }
        };

        geoJson.features.forEach((feature) => {
            if (feature && feature.geometry) {
                visit(feature.geometry.coordinates);
            }
        });

        if (minX !== Infinity && minY !== Infinity) {
            bounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
        }
    }

    boundsCache.set(mapId, bounds);
    return bounds;
}

/** 射线法：点是否落在环内。 */
export function pointInRing(x: number, y: number, ring: ArrayLike<ArrayLike<number>>): boolean {
    let inside = false;

    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
        const currentX = ring[current][0];
        const currentY = ring[current][1];
        const previousX = ring[previous][0];
        const previousY = ring[previous][1];

        if (
            currentY > y !== previousY > y &&
            x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX
        ) {
            inside = !inside;
        }
    }

    return inside;
}

/** 数据坐标 → 地区名（只判外环；飞地孔洞在点击精度内没有意义）。 */
export function regionNameAtDataPoint(geoJson: GeoJson | null, x: number, y: number): string | null {
    if (!geoJson || !Array.isArray(geoJson.features)) {
        return null;
    }

    for (const feature of geoJson.features) {
        const name = normalizeRegionToken((feature.properties || {}).name);
        if (!name) {
            continue;
        }

        const geometry = feature.geometry || {};
        const polygons: unknown[] =
            geometry.type === 'Polygon'
                ? [geometry.coordinates]
                : geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)
                  ? geometry.coordinates
                  : [];

        for (const polygon of polygons) {
            if (!Array.isArray(polygon) || polygon.length === 0) {
                continue;
            }
            const ring = polygon[0];
            if (Array.isArray(ring) && ring.length > 0 && pointInRing(x, y, ring as ArrayLike<ArrayLike<number>>)) {
                return name;
            }
        }
    }

    return null;
}

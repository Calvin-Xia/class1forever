/**
 * 几何注册与加载层 —— 替代旧的 `js/geo.js`（ADR-0003：几何文件零改动）。
 *
 * 旧站的做法是经典脚本按顺序加载：`js/geo.js` 先挂 `window.CMapGeo`，随后
 * `js/china.js` / `js/province/*.js` 执行 `CMapGeo.register(...)` 登记自己。
 * 这些生成文件的字节不允许改动，所以新站沿用同一套调用约定，只把「注册表」和
 * 「加载方式」换掉：
 *
 * - 注册表仍然挂在 `globalThis.CMapGeo` 上（生成文件里的 `CMapGeo.register(...)`
 *   是一个自由变量，运行时从全局对象上解析）；
 * - `installGeoRegistry()` 必须在任何几何模块**执行之前**调用 —— 这里用动态
 *   `import()` 而不是静态 import，避免依赖 ESM 的求值顺序（静态 import 会被提升，
 *   注册表还没装上几何模块就先跑了）；
 * - 省级地图走 `import.meta.glob` 的懒加载：31 个文件各自成为独立 chunk，
 *   下钻哪个省才拉哪个（旧站是插 `<script src="js/province/x.js">`）；
 * - `AVAILABLE_PROVINCE_FILES` 白名单与 `js/geo.js` 同源同步：台湾 / 香港 / 澳门 /
 *   南海诸岛在中国 GeoJSON 里有 `filename`，但仓库没有对应文件，点击时必须直接看
 *   聚合信息，而不是发一个必然 404 的请求。
 */
export const CHINA_MAP_ID = 'cn/china';
export const PROVINCE_MAP_PREFIX = 'cn/';

/** 仓库里确实存在 `js/province/<name>.js` 的省份（与 `js/geo.js` 同一份名单）。 */
export const AVAILABLE_PROVINCE_FILES: readonly string[] = [
    'anhui',
    'beijing',
    'chongqing',
    'fujian',
    'gansu',
    'guangdong',
    'guangxi',
    'guizhou',
    'hainan',
    'hebei',
    'heilongjiang',
    'henan',
    'hubei',
    'hunan',
    'jiangsu',
    'jiangxi',
    'jilin',
    'liaoning',
    'neimenggu',
    'ningxia',
    'qinghai',
    'shandong',
    'shanghai',
    'shanxi',
    'shanxi2',
    'sichuan',
    'tianjin',
    'xinjiang',
    'xizang',
    'yunnan',
    'zhejiang'
];

export interface GeoFeatureProperties {
    name?: unknown;
    filename?: unknown;
    [key: string]: unknown;
}

export interface GeoFeature {
    properties?: GeoFeatureProperties;
    geometry?: {
        type?: string;
        coordinates?: unknown;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface GeoJson {
    type?: string;
    features?: GeoFeature[];
    [key: string]: unknown;
}

interface GeoRegistry {
    register(id: string, geoJson: GeoJson): void;
    has(id: string): boolean;
    get(id: string): GeoJson | null;
    hasProvinceFile(filename: unknown): boolean;
    availableProvinceFiles: readonly string[];
}

/** 省级文件按需加载：`import.meta.glob` 的默认懒模式，每个文件一个独立 chunk。 */
const provinceModules = import.meta.glob('../../js/province/*.js');
/** 中国地图同理：生成文件不是 ES 模块（没有 import/export），用 glob 拿到惰性 loader。 */
const chinaModules = import.meta.glob('../../js/china.js');
const CHINA_MODULE_PATH = '../../js/china.js';

function provinceModulePath(filename: string): string {
    return `../../js/province/${filename}.js`;
}

function registry(): GeoRegistry | undefined {
    return (globalThis as { CMapGeo?: GeoRegistry }).CMapGeo;
}

/**
 * 装上全局注册表（幂等）。必须早于任何 `js/china.js` / `js/province/*.js` 的执行。
 */
export function installGeoRegistry(): GeoRegistry {
    const existing = registry();
    if (existing) {
        return existing;
    }

    const maps = new Map<string, GeoJson>();
    const provinceFiles = new Set(AVAILABLE_PROVINCE_FILES);

    const api: GeoRegistry = {
        register(id, geoJson) {
            maps.set(id, geoJson);
        },
        has(id) {
            return maps.has(id);
        },
        get(id) {
            return maps.get(id) ?? null;
        },
        hasProvinceFile(filename) {
            return typeof filename === 'string' && provinceFiles.has(filename);
        },
        availableProvinceFiles: AVAILABLE_PROVINCE_FILES
    };

    (globalThis as { CMapGeo?: GeoRegistry }).CMapGeo = api;
    return api;
}

export function getGeo(id: string): GeoJson | null {
    installGeoRegistry();
    return registry()!.get(id);
}

export function hasGeo(id: string): boolean {
    installGeoRegistry();
    return registry()!.has(id);
}

/** 该地区是否有对应的省级地图文件（台湾 / 香港 / 澳门 / 南海诸岛为 false）。 */
export function hasProvinceFile(filename: unknown): boolean {
    installGeoRegistry();
    return registry()!.hasProvinceFile(filename);
}

export function provinceMapId(filename: string): string {
    return PROVINCE_MAP_PREFIX + filename;
}

/**
 * 加载中国地图（首个 chunk）。返回登记后的 GeoJSON 供 ECharts `registerMap` 使用。
 */
export async function loadChinaGeo(): Promise<GeoJson> {
    installGeoRegistry();
    const id = CHINA_MAP_ID;
    const loaded = registry()!.get(id);
    if (loaded) {
        return loaded;
    }

    await chinaModules[CHINA_MODULE_PATH]();

    const geoJson = registry()!.get(id);
    if (!geoJson) {
        throw new Error('缺少中国地图数据，请刷新页面重试。');
    }
    return geoJson;
}

const pendingProvinces = new Map<string, Promise<GeoJson>>();

/**
 * 按需加载省级地图（同一份只请求一次）。
 * 白名单之外的 filename 直接拒绝 —— 不发请求。
 */
export function loadProvinceGeo(filename: string): Promise<GeoJson> {
    installGeoRegistry();

    if (!hasProvinceFile(filename)) {
        return Promise.reject(new Error('没有这个省份的地图文件：' + filename));
    }

    const mapId = provinceMapId(filename);
    const loaded = registry()!.get(mapId);
    if (loaded) {
        return Promise.resolve(loaded);
    }

    const pending = pendingProvinces.get(filename);
    if (pending) {
        return pending;
    }

    const loader = provinceModules[provinceModulePath(filename)];
    if (!loader) {
        return Promise.reject(new Error('省级地图数据缺失：' + filename));
    }

    const promise = loader()
        .then(() => {
            const geoJson = registry()!.get(mapId);
            if (!geoJson) {
                throw new Error('省级地图数据缺失：' + filename);
            }
            return geoJson;
        })
        .catch((error: unknown) => {
            pendingProvinces.delete(filename);
            throw error instanceof Error ? error : new Error('省级地图加载失败：' + filename);
        });

    pendingProvinces.set(filename, promise);
    return promise;
}

/** 供探针 / 测试读取加载状态。 */
export function isProvinceGeoRegistered(filename: string): boolean {
    return hasGeo(provinceMapId(filename));
}

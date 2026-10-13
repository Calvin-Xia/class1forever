/**
 * 跨岛屿协作通道（地图 ↔ 底部抽屉 / 口令弹窗 / 分享图 / 动效）。
 *
 * 为什么需要它：旧站是一个 IIFE 里的全局 `AppState`，谁都能直接读。新站拆成多个
 * 独立 React 岛屿，地图岛屿不该 import 抽屉岛屿，抽屉岛屿也不该 import 地图内部。
 * 这里只放**稳定契约**：
 *
 * 1. **状态快照**：`setMapState` / `getMapState` —— 地图岛屿在视野变化时更新；
 *    分享图（l2_share）拿 `chart` 做快照、抽屉（l2_dialogs）拿 `points` 渲染
 *    「地区一览」、拿 `publicData` 播报人数。
 * 2. **事件**（`document` 上的 CustomEvent，任何岛屿/测试都能监听，不必 import 本模块）：
 *    - `map:ready`          图表实例就绪
 *    - `map:view-change`    视野切换（全国 ⇄ 省）
 *    - `map:public-data`    公开聚合到手（含 detailAccess / detailModeAvailable / detailsHint）
 *    - `map:zoom-change`    缩放被夹紧或改变
 *    - `map:region-activate` 点击了「不能下钻或正在详情模式」的地区 —— 抽屉侧据此开面板
 *    - `map:escape`         弹层打开时按了 Esc（地图不越权关别人的弹层，只广播意图）
 *    - `map:detail-mode-change` 详情模式开关变化
 *    上面 7 个名字以 `MAP_EVENT_NAMES` 为**唯一真相源**：广播方与订阅方都引用常量，
 *    源码里不再散落字面量（新增事件也一律先加在这里）。
 * 3. **两个反向钩子**（由 l2_dialogs 注册，未注册时地图 island 也能独立工作）：
 *    - `setOverlayOpenProbe`：弹层打开时 TapFallback 不认点击（默认走 DOM 兜底判定）；
 *    - `setDetailModeState`：详情模式开关，决定点省份是「下钻」还是「开抽屉」。
 */
import type { PublicMapPayload } from './types';
import type { RegionPoint, Region } from './map-model';
import type { EChartsType } from './echarts';

export const MAP_EVENT_NAMES = {
    ready: 'map:ready',
    viewChange: 'map:view-change',
    publicData: 'map:public-data',
    zoomChange: 'map:zoom-change',
    regionActivate: 'map:region-activate',
    escape: 'map:escape',
    detailModeChange: 'map:detail-mode-change'
} as const;

export type MapEventName = (typeof MAP_EVENT_NAMES)[keyof typeof MAP_EVENT_NAMES];

export interface MapViewState {
    province: string | null;
    mapId: string;
    points: RegionPoint[];
    showLabels: boolean;
    zoom: number;
}

export interface RegionActivationDetail {
    point: RegionPoint;
    /** 这个地区是否有省级地图文件（false = 台湾/香港/澳门/南海这类）。 */
    canDrill: boolean;
    /** 触发来源：地图点击 / 键盘（地区一览）等。 */
    source: string;
}

export interface DetailModeState {
    /** 服务端是否配齐了口令与会话密钥。 */
    available: boolean;
    /** 本次会话是否已通过口令。 */
    access: boolean;
    /** 用户是否打开了「同学信息」详情模式。 */
    enabled: boolean;
}

export interface MapState {
    chart: EChartsType | null;
    isTouch: boolean;
    view: MapViewState;
    publicData: PublicMapPayload | null;
    detailMode: DetailModeState;
    detailsHint: string;
}

const EMPTY_VIEW: MapViewState = {
    province: null,
    mapId: 'cn/china',
    points: [],
    showLabels: false,
    zoom: 1.25
};

const state: MapState = {
    chart: null,
    isTouch: false,
    view: { ...EMPTY_VIEW },
    publicData: null,
    detailMode: { available: false, access: false, enabled: false },
    detailsHint: ''
};

let overlayOpenProbe: (() => boolean) | null = null;

/** 更新快照（地图岛屿调用；其它岛屿只读）。 */
export function setMapState(patch: Partial<MapState>): void {
    Object.assign(state, patch);
}

export function setMapView(view: Partial<MapViewState>): void {
    state.view = { ...state.view, ...view };
}

export function getMapState(): Readonly<MapState> {
    return state;
}

export function getDetailModeState(): DetailModeState {
    return { ...state.detailMode };
}

/**
 * 详情模式由 l2_dialogs 维护；地图侧只消费。
 * 每次变更都会广播 `MAP_EVENT_NAMES.detailModeChange`（供提示语与按钮状态联动）。
 */
export function setDetailModeState(patch: Partial<DetailModeState>): void {
    state.detailMode = { ...state.detailMode, ...patch };
    emitMapEvent(MAP_EVENT_NAMES.detailModeChange, getDetailModeState());
}

/** 弹层打开探测：优先用 l2_dialogs 注册的钩子，没注册时退回 DOM 判定。 */
export function setOverlayOpenProbe(probe: (() => boolean) | null): void {
    overlayOpenProbe = probe;
}

export function isOverlayOpen(): boolean {
    if (overlayOpenProbe) {
        try {
            return Boolean(overlayOpenProbe());
        } catch (_error) {
            /* 钩子坏了就退回 DOM 判定 */
        }
    }

    if (typeof document === 'undefined') {
        return false;
    }

    const sheet = document.getElementById('bottom-sheet');
    if (sheet && sheet.classList.contains('active')) {
        return true;
    }

    const overlay = document.getElementById('auth-overlay');
    return Boolean(overlay && !overlay.hasAttribute('hidden'));
}

export function emitMapEvent(name: string, detail: unknown): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
}

export function onMapEvent<TDetail>(name: string, handler: (detail: TDetail) => void): () => void {
    if (typeof document === 'undefined') {
        return () => {};
    }

    const listener = (event: Event): void => {
        handler((event as CustomEvent<TDetail>).detail);
    };
    document.addEventListener(name, listener);
    return () => document.removeEventListener(name, listener);
}

/** 给探针 / 测试用：当前视野里的地区名（含省级城市的 `省::市` 键）。 */
export function currentRegionKeys(): string[] {
    return state.view.points.map((point) => (point.city ? `${point.province}::${point.city}` : `${point.province}::*`));
}

export function currentRegion(pointName: string): Region | null {
    const point = state.view.points.find((candidate) => candidate.name === pointName);
    if (!point) {
        return null;
    }
    return { province: point.province, city: point.city };
}

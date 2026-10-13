/**
 * 分享图与读屏播报的**纯逻辑**（无 DOM）：范围统计、文件名、本地日期、播报文案。
 *
 * 逐字迁移自 `js/map.js` 的 `ShareManager.formatDate` / `calculateStats` /
 * `createSharePlan` 与 `updateInteractionNote`，只把数据来源从全局 `AppState`
 * 换成显式入参（`publicData` + `province`），方便单测与跨岛屿复用：
 * - canvas 合成在 `src/lib/share-card.ts`；
 * - 浏览器接线（按钮、播报位、地图岛屿事件）在 `src/scripts/share-boot.ts`。
 *
 * 两条硬约束在这里落地：
 * 1. **范围跟随视野**：全国视图用全国 `stats`；省视图用该省 `人数 / 覆盖城市 / 占全班`；
 *    无记录省份给一行空态文案，而不是一行 0。
 * 2. **日期用浏览器本地时区**：`toISOString()` 是 UTC，凌晨导出会写成前一天，故不用。
 */
import type { PublicMapPayload } from './types';
import { getProvinceSummary } from './map-model';

/**
 * 分享图里的单列统计。
 * `value` 允许字符串：省级「占全班」在分母为 0 时是 `'—'`（与旧实现一致）。
 */
export interface ShareColumn {
    value: number | string;
    label: string;
}

/** 分享图/播报共用的范围统计。`columns` 为 null 表示走空态文案。 */
export interface ShareStats {
    /** `'全国'` 或省名。 */
    scope: string;
    /** 公开数据的生成时间（ISO 串；缺失时为空串，图上就不印日期）。 */
    generatedAt: string;
    columns: ShareColumn[] | null;
    emptyText: string;
}

export interface SharePlan {
    stats: ShareStats;
    filename: string;
}

/** 详情模式三态：与 `src/lib/map-bridge.ts` 的 `DetailModeState` 同形（这里只要读）。 */
export interface DetailModeSnapshot {
    available: boolean;
    access: boolean;
    enabled: boolean;
}

export const NATIONAL_SCOPE = '全国';
export const SHARE_FILENAME_PREFIX = '蹭饭地图';

/**
 * 日期一律按浏览器本地时区取。
 * 旧实现在这里踩过坑：`toISOString().slice(0, 10)` 是 UTC 日期，本地凌晨导出会写成前一天。
 */
export function formatLocalDate(isoString: string | null | undefined): string {
    if (!isoString) {
        return '';
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 分享图的人数口径必须和地图一致。
 *
 * 旧实现曾经永远读全国的 `publicData.stats`，于是下钻到某个省之后导出的图是
 * 「省界 + 省级色带 + 全国数字」。这里按当前视野取数，并把范围写进 `scope`，
 * 图脱离页面之后也能自解释。
 */
export function calculateShareStats(publicData: PublicMapPayload | null, provinceName: string | null): ShareStats {
    const national = (publicData && publicData.stats) || ({} as PublicMapPayload['stats']);
    const generatedAt = (publicData && publicData.generatedAt) || '';

    if (!provinceName) {
        return {
            scope: NATIONAL_SCOPE,
            generatedAt: generatedAt,
            columns: [
                { value: Number(national.total || 0), label: '总人数' },
                { value: Number(national.provinces || 0), label: '覆盖省份' },
                { value: Number(national.cities || 0), label: '覆盖城市' }
            ],
            emptyText: ''
        };
    }

    const summary = getProvinceSummary(publicData, provinceName);
    const count = summary.count;
    const total = Number(national.total || 0);

    // 只要有省级地图就能下钻，和人数无关；0 人的地区给一句人话，而不是一行 0。
    // 措辞不能写「这个省」：北京、上海这些直辖市和自治区也走这条分支，
    // 范围交给副标题交代，这里只描述状态。
    if (count === 0) {
        return {
            scope: provinceName,
            generatedAt: generatedAt,
            columns: null,
            emptyText: '这里暂时还没有同学登记'
        };
    }

    return {
        scope: provinceName,
        generatedAt: generatedAt,
        columns: [
            // 用数据里的地区原名，避免「本省」对直辖市和自治区都不合适。
            { value: count, label: provinceName + '人数' },
            // 口径与全国的 stats.cities 一致：只数有登记的城市。
            { value: summary.cities, label: '覆盖城市' },
            { value: total > 0 ? Math.round((count / total) * 100) + '%' : '—', label: '占全班' }
        ],
        emptyText: ''
    };
}

/**
 * 按下分享按钮那一刻就把范围和日期定死，图片和文件名共用这一份。
 *
 * 生成图片要等一次 `Image` 解码，这段时间里按 Esc 切视野完全来得及；文件名如果
 * 等到下载时才重新读状态，就会出现「缩略图是浙江、文件名写着全国」。聊天软件里
 * 缩略图很小，文件名往往是接收方唯一能看到的上下文，两者必须同源。
 */
export function createSharePlan(publicData: PublicMapPayload | null, provinceName: string | null): SharePlan {
    const stats = calculateShareStats(publicData, provinceName);
    const date = formatLocalDate(stats.generatedAt);

    return {
        stats: stats,
        // 没有数据日期就不写日期段：文件名里的日期只有「数据日期」一种含义，
        // 拿导出当天顶上会被读成这份数据是今天更新的（副标题也是同样的取舍）。
        filename: `${SHARE_FILENAME_PREFIX}_${stats.scope}${date ? '_' + date : ''}.png`
    };
}

export interface AnnouncementInput {
    publicData: PublicMapPayload | null;
    /** 当前视野的省名；全国视野传 null。 */
    province: string | null;
    detailMode: DetailModeSnapshot;
}

/**
 * `#interaction-note` 的播报文案（逐字迁移旧 `updateInteractionNote`）。
 *
 * 数字与分享图取自同一个 `getProvinceSummary()`：省视图念「覆盖 N 座城市，共 M 位同学」，
 * 无记录省份念空态，**绝不把全国总数追加到省名后面**（否则听起来就是这个省有那么多同学）。
 */
export function buildAnnouncement({ publicData, province, detailMode }: AnnouncementInput): string {
    if (!publicData) {
        return '地图公开数据加载中...';
    }

    const stats = publicData.stats || ({} as PublicMapPayload['stats']);
    let prefix: string;

    if (province) {
        const summary = getProvinceSummary(publicData, province);
        prefix = summary.count === 0
            ? `当前查看 ${province}。地图上暂时还没有同学登记。`
            : `当前查看 ${province}。覆盖 ${summary.cities} 座城市，共 ${summary.count} 位同学。`;
    } else {
        prefix = `当前查看全国。共覆盖 ${Number(stats.provinces || 0)} 个省级区域、${Number(stats.cities || 0)} 座城市，共 ${Number(stats.total || 0)} 位同学。`;
    }

    if (!detailMode.available) {
        return `${prefix} 现在先看看各地人数。`;
    }

    if (!detailMode.access) {
        return `${prefix} 地图上先看人数，输入口令后可查看各地同学信息。`;
    }

    if (detailMode.enabled) {
        // 省级视野里没有可下钻的地区，面板上的「进入…地图详情」按钮也是隐藏的，
        // 所以这时候只说怎么回全国，不指向一个不存在的按钮。
        return province
            ? `${prefix} 现在可以点地区查看同学信息；用左上角的「返回全国」回到全国视野。`
            : `${prefix} 现在可以点地区查看同学信息；想继续进入省内地图，请用下方按钮。`;
    }

    return `${prefix} 已确认口令，点击“同学信息”即可查看各地区同学信息。`;
}

/**
 * 悬浮卡片（ECharts tooltip 的 HTML）—— 从 `js/map.js` 的 `renderPublicCard` 忠实迁移。
 *
 * 这里只负责「公开概况」这一张卡：ECharts tooltip 与底部抽屉共用同一份标记，
 * 抽屉那边（l2_dialogs）可以直接复用 `renderPublicCardHtml`，避免两处各画一份、
 * 迟早漂移。名册与明细卡（renderRoster / renderDetailCard）属于口令流程，不在本模块。
 */
import type { RegionPoint } from './map-model';
import { getPointCount, getPointRegion } from './map-model';

export interface PublicCardOptions {
    /** 紧凑模式：省略「公开概况」标题（悬浮卡贴在地块上，标题是冗余的）。 */
    compact?: boolean;
    /** 不显示「当前公开数据中暂无记录」这句。 */
    hideEmpty?: boolean;
    /** 不显示提示语。 */
    hideHint?: boolean;
    /** 自定义提示语（如「省级地图加载失败，请重试。」）。 */
    callout?: string;
}

export interface DetailHintState {
    detailModeAvailable: boolean;
    detailAccess: boolean;
    detailModeEnabled: boolean;
}

export function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 卡片底部的提示语（与旧实现同一套分支）。 */
export function getPublicHint(state: DetailHintState): string {
    if (!state.detailModeAvailable) {
        return '仅展示公开人数。';
    }

    if (!state.detailAccess) {
        return '公开页仅显示人数。';
    }

    if (state.detailModeEnabled) {
        return '详情模式已开启。';
    }

    return '已确认，可以查看详情。';
}

export function renderPublicCardHtml(
    point: RegionPoint,
    options: PublicCardOptions,
    activeProvince: string | null,
    hintState: DetailHintState
): string {
    const cardOptions = options || {};
    const count = getPointCount(point);
    const region = getPointRegion(point, activeProvince);
    const metaHtml = region.city
        ? `<div class="tooltip__meta"><strong>${escapeHtml(region.province)}</strong> · 城市公开人数</div>`
        : `<div class="tooltip__meta">覆盖城市 <strong>${Number(point.cityCount || 0)}</strong> 座</div>`;
    const emptyHtml =
        count === 0 && !cardOptions.hideEmpty && !cardOptions.callout
            ? '<div class="tooltip__empty">当前公开数据中暂无记录。</div>'
            : '';
    const hint = cardOptions.compact || cardOptions.hideHint ? '' : getPublicHint(hintState);
    const hintHtml = hint ? `<div class="tooltip__hint">${escapeHtml(hint)}</div>` : '';
    const calloutHtml = cardOptions.callout ? `<div class="tooltip__callout">${escapeHtml(cardOptions.callout)}</div>` : '';
    // 悬浮卡片就贴在省份上，对标的是哪个地区已经一目了然，不用再顶一行标题。
    const titleHtml = cardOptions.compact ? '' : '<div class="series">公开概况</div>';

    return `
        <div class="tooltip">
            ${titleHtml}
            <div class="profile">
                <div class="name">${escapeHtml(point.name)}</div>
                <div class="value">${count}人</div>
            </div>
            ${metaHtml}
            ${emptyHtml}
            ${hintHtml}
            ${calloutHtml}
        </div>
    `;
}

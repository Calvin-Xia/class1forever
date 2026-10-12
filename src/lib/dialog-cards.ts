/**
 * 抽屉里的三张卡片（从 `js/map.js` 的 `renderLoadingCard` / `renderDetailCard` /
 * `renderRoster` 忠实迁移）。
 *
 * 「公开概况」那张卡不在这里：它与悬浮卡片逐字相同，复用
 * `src/lib/tooltip-card.ts` 的 `renderPublicCardHtml`，避免两处各画一份、迟早漂移
 * （这是 l2_map 把该函数留在共享模块里的原因）。
 *
 * 与旧实现一致：标记是字符串，交给 `#bs-content` 的 innerHTML；所有插值都过
 * `escapeHtml`（姓名/学校来自 KV，不能直接拼进 DOM）。
 */
import { escapeHtml } from './tooltip-card';
import type { DetailsPayload, Student } from './types';
import type { RegionPoint } from './map-model';

export function renderLoadingCard(point: RegionPoint): string {
    return `
        <div class="tooltip">
            <div class="series">同学信息</div>
            <div class="profile">
                <div class="name">${escapeHtml(point.name)}</div>
                <div class="value">读取中</div>
            </div>
            <div class="tooltip__callout">正在加载这个地区的同学信息，请稍候。</div>
        </div>
    `;
}

/**
 * 名册按城市分组渲染。
 * `sortPeople` 已经把同城的人排在一起，这里只需要在 city 变化时插一个分组头。
 * 入场延迟封顶在第 12 行，长名单的尾巴才不会等上好几秒。
 */
export function renderRoster(people: Student[]): string {
    let html = '';
    let currentCity: string | null = null;
    let index = 0;

    people.forEach((person) => {
        if (person.city !== currentCity) {
            currentCity = person.city;
            html += `
                <div class="roster__group"><span class="roster__city">${escapeHtml(person.city)}</span></div>
            `;
        }

        index += 1;
        html += `
            <div class="roster__row" style="--i:${Math.min(index, 12)}">
                <span class="roster__index">${String(index).padStart(2, '0')}</span>
                <span class="roster__name">${escapeHtml(person.name)}</span>
                <span class="roster__school">${escapeHtml(person.school)}</span>
            </div>
        `;
    });

    return `<div class="roster">${html}</div>`;
}

export function renderDetailCard(payload: DetailsPayload): string {
    const metaHtml = payload.city
        ? `<div class="tooltip__meta"><strong>${escapeHtml(payload.province)}</strong> · ${escapeHtml(payload.city)}</div>`
        : '<div class="tooltip__meta">省内班内明细</div>';

    const listHtml =
        payload.people.length > 0
            ? renderRoster(payload.people)
            : '<div class="tooltip__empty">该地区暂无已登记的班内明细。</div>';

    return `
        <div class="tooltip">
            <div class="series">同学信息</div>
            <div class="profile">
                <div class="name">${escapeHtml(payload.city || payload.province)}</div>
                <div class="value">${Number(payload.count || 0)}人</div>
            </div>
            ${metaHtml}
            ${listHtml}
        </div>
    `;
}

/**
 * 分享按钮与读屏播报的浏览器接线（迁移自 `js/map.js` 的 `ShareManager.init()` +
 * `updateInteractionNote()` 的触发点）。
 *
 * 为什么不用 Astro 的 `client:*`：岛屿水合会往 HTML 里注入**内联** `<script>`，
 * 被 `_headers` 的 `script-src 'self'` 拦死（l2_map / l2_motion 已实测）。
 * 这里走已被证明可行的路子：`MapSection.astro` 里的 `<script>` 标签 + **动态 import**，
 * Astro 会把它编成 `/_astro/*.js` 外链 chunk（自包含的小脚本会被内联，动态 import 不会）。
 *
 * 数据来源全部是 `src/lib/map-bridge.ts` 的只读快照与事件，不另算一份范围/统计：
 * - 公开聚合与视野：`getMapState()`（由地图岛屿写入）；
 * - 变化通知：`map:public-data` / `map:view-change` / `map:ready` / `map:detail-mode-change`。
 *
 * 对外可见的额外信号（给探针/测试用，与 `map:*` 事件同一套风格）：
 * - `share:plan`：按下分享按钮那一刻冻结的 **范围 + 文件名 + 色带满量程**，
 *   detail 形如 `{ scope, filename, heatMax, columns, emptyText }`。它在同步任务里
 *   就派发出去（早于 `Image` 解码），因此可以拿来核对「Esc 之后三者仍同源」。
 */
import { MAP_EVENT_NAMES, getMapState, onMapEvent } from '../lib/map-bridge';
import { normalizeRegionToken } from '../lib/map-model';
import { buildAnnouncement, createSharePlan } from '../lib/share';
import { captureMapSnapshot, composeShareImage, downloadShareImage } from '../lib/share-card';

const SHARE_BUTTON_ID = 'share-btn';
const NOTE_ID = 'interaction-note';
/** 详情模式事件名取自 `map-bridge` 的 `MAP_EVENT_NAMES`（单一真相源；由 `setDetailModeState` 派发）。 */
const DETAIL_MODE_EVENT = MAP_EVENT_NAMES.detailModeChange;

export const SHARE_PLAN_EVENT = 'share:plan';

function activeProvince(): string | null {
    return normalizeRegionToken(getMapState().view.province);
}

/** 读屏播报：文案与分享图同源（都读 `getMapState()` + `buildAnnouncement`）。 */
function renderNote(): void {
    const note = document.getElementById(NOTE_ID);
    if (!note) {
        return;
    }

    const state = getMapState();
    note.textContent = buildAnnouncement({
        publicData: state.publicData,
        province: activeProvince(),
        detailMode: state.detailMode
    });
}

async function handleShare(): Promise<void> {
    const button = document.getElementById(SHARE_BUTTON_ID);
    if (!button) {
        return;
    }

    button.classList.add('loading');
    (button as HTMLButtonElement).disabled = true;

    try {
        const state = getMapState();

        // ① 范围与日期只在这里取一次，图片和文件名从同一个来源出来。
        const plan = createSharePlan(state.publicData, activeProvince());
        // ② 颜色与图例满量程在同一刻拍下（同步，早于任何 await）。
        const snapshot = captureMapSnapshot(state.chart, state.view.mapId, state.view.points);

        document.dispatchEvent(new CustomEvent(SHARE_PLAN_EVENT, {
            detail: {
                scope: plan.stats.scope,
                filename: plan.filename,
                heatMax: snapshot.heatMax,
                columns: plan.stats.columns,
                emptyText: plan.stats.emptyText,
                generatedAt: plan.stats.generatedAt
            }
        }));

        // ③ 之后就是纯合成 + 下载，Esc 切视野改不动上面这三个值。
        const blob = await composeShareImage(plan.stats, snapshot);
        downloadShareImage(blob, plan.filename);
    } catch (error) {
        console.error('生成分享图片失败:', error);
        alert('生成分享图片失败，请稍后重试');
    } finally {
        button.classList.remove('loading');
        (button as HTMLButtonElement).disabled = false;
    }
}

function boot(): void {
    const button = document.getElementById(SHARE_BUTTON_ID);
    if (button && !button.dataset.shareBound) {
        button.dataset.shareBound = 'true';
        button.addEventListener('click', function () {
            handleShare().catch(function (error) {
                console.error('Share action failed:', error);
            });
        });
    }

    // 先按当前状态渲染一次，再订阅后续变化（岛屿可能已经先跑过，所以不能只靠事件）。
    renderNote();
    [
        MAP_EVENT_NAMES.ready,
        MAP_EVENT_NAMES.viewChange,
        MAP_EVENT_NAMES.publicData,
        DETAIL_MODE_EVENT
    ].forEach(function (name) {
        onMapEvent(name, renderNote);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

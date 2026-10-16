/**
 * 「地区一览」控制器（从 `js/map.js` 的 `renderRegionTable` / `handleRegionTableClick`
 * / `toggleRegionSort` / `regionActionLabel` / `sortedRegionRows` 忠实迁移）。
 *
 * 为什么有这张表：地图画在 canvas 上，地区和城市都无法被聚焦，只靠键盘没有任何办法
 * 选中一个省份。这张表把当前视野里的地区列成原生 `<table>`，每行一个按钮，走的是和
 * 地图点击**完全相同**的 `activateRegion()` —— 两条路径不允许各写一份下钻/详情分支。
 *
 * 结构（`<details>` + `<thead>` + `<caption>`）留在 `RegionLedger.astro` 的静态 HTML 里
 * （无 JS 也能展开阅读），这里只负责填 `<tbody>`、排序与 `aria-sort`。
 *
 * 硬约束：**不要**给 `.region-table thead th` 加 `position: sticky`
 * （WCAG 2.2 2.4.11：粘性表头 + 固定底部抽屉会盖住聚焦行）。
 */
import { escapeHtml } from './tooltip-card';
import type { RegionPoint } from './map-model';
import type { DetailModeState } from './map-bridge';

export type RegionSortKey = 'value' | 'name';

export interface RegionLedgerDeps {
    /** 当前视野的数据点（全国 = 省级区域；省级视野 = 该省城市）。 */
    getPoints(): readonly RegionPoint[];
    /** 当前视野的省名（全国视野为 null）。 */
    getActiveProvince(): string | null;
    /** 公开聚合的 stats（用于「共 N 位同学」）。 */
    getStats(): { total?: number } | null;
    /** 详情模式状态：行内按钮的措辞要跟着它走。 */
    getDetailState(): DetailModeState;
    /** 唯一的地区激活入口（地图岛屿的 activateRegion）。 */
    activate(point: RegionPoint, source: string): void;
}

export interface RegionLedgerController {
    render(): void;
    destroy(): void;
    /** 探针用：当前排序状态与行数。 */
    readState(): { sortKey: RegionSortKey; sortDir: number; rowCount: number };
}

export function initRegionLedger(deps: RegionLedgerDeps): RegionLedgerController {
    const body = document.getElementById('region-table-body');
    const sortButton = document.getElementById('region-sort-btn');
    const note = document.getElementById('region-ledger-note');
    const nameHeader = document.getElementById('region-th-name');
    const countHeader = document.getElementById('region-th-count');

    let sortKey: RegionSortKey = 'value';
    let sortDir = -1;
    /** data-region（地区名）→ 数据点：点击时直接取回同一个对象，不再按名字重新解析。 */
    const rowPoints = new Map<string, RegionPoint>();
    let rowCount = 0;

    /**
     * 当前焦点所在的地区名（只在焦点确实落在表体的行按钮上时返回）。
     *
     * `render()` 是整表 `innerHTML` 重写，被点那行的按钮对象会被换掉，焦点掉回 `<body>`；
     * 读屏与键盘用户于是「按了一下就找不着北」。所以重渲染前先记住 data-region。
     */
    function focusedRowRegion(): string | null {
        if (!body) {
            return null;
        }
        const active = document.activeElement;
        if (!active || !body.contains(active)) {
            return null;
        }
        const button = active.closest('button[data-region]');
        return button ? button.getAttribute('data-region') : null;
    }

    /** 重渲染后把焦点交还给同一地区的新按钮（原来那个已经被 innerHTML 换掉了）。 */
    function restoreRowFocus(region: string | null): void {
        if (!region || !body) {
            return;
        }
        // 焦点已经落在表体里的新元素上（例如别处提前接管了焦点）就不要抢。
        const active = document.activeElement;
        if (active && body.contains(active)) {
            return;
        }

        const buttons = body.querySelectorAll('button[data-region]');
        for (let index = 0; index < buttons.length; index += 1) {
            const button = buttons[index] as HTMLElement;
            if (button.getAttribute('data-region') === region) {
                button.focus();
                return;
            }
        }
        // 地区已经不在当前视野里：不强留焦点，保持浏览器默认行为。
    }

    /** 行内按钮的可访问名要说清「按下去会发生什么」，两条路径的措辞要和实际行为对上。 */
    function regionActionLabel(point: RegionPoint): string {
        const canDrill = Boolean(point.drilldownFile) && !deps.getActiveProvince();
        const detail = deps.getDetailState();

        if (canDrill && !detail.enabled) {
            return `进入 ${point.name} 地图详情`;
        }

        if (detail.enabled && detail.access) {
            return `查看 ${point.name} 的同学信息`;
        }

        return `查看 ${point.name} 的公开人数`;
    }

    function sortedRows(): RegionPoint[] {
        const points = deps.getPoints().slice();
        const direction = sortDir;

        points.sort((left, right) => {
            if (sortKey === 'name') {
                return left.name.localeCompare(right.name, 'zh-CN') * direction;
            }

            const diff = (Number(left.value) || 0) - (Number(right.value) || 0);
            if (diff !== 0) {
                return diff * direction;
            }

            return left.name.localeCompare(right.name, 'zh-CN');
        });

        return points;
    }

    function render(): void {
        if (!body) {
            return;
        }

        const provinceName = deps.getActiveProvince();
        const points = deps.getPoints();
        const stats = deps.getStats() || {};

        if (note) {
            note.textContent = provinceName
                ? `${provinceName}共 ${points.length} 个地区。地图上的地区都在下面列出来了，可以只用键盘操作。`
                : `全国 ${points.length} 个省级区域，共 ${Number(stats.total || 0)} 位同学。地图上的地区都在下面列出来了，可以只用键盘操作。`;
        }

        if (sortButton) {
            const byName = sortKey === 'name';
            sortButton.textContent = byName ? '按地区名' : '按人数';
            sortButton.setAttribute(
                'aria-label',
                byName ? '当前按地区名排序，点击改为按人数排序' : '当前按人数排序，点击改为按地区名排序'
            );
        }

        // aria-sort 只标在当前真正排序的那一列上，其余保持 none。
        const countSort = sortKey === 'value' ? (sortDir < 0 ? 'descending' : 'ascending') : 'none';
        const nameSort = sortKey === 'name' ? (sortDir < 0 ? 'descending' : 'ascending') : 'none';

        if (countHeader) {
            countHeader.setAttribute('aria-sort', countSort);
        }
        if (nameHeader) {
            nameHeader.setAttribute('aria-sort', nameSort);
        }

        const rows = sortedRows();
        const previouslyFocusedRegion = focusedRowRegion();
        rowPoints.clear();
        rowCount = rows.length;

        if (rows.length === 0) {
            body.innerHTML =
                '<tr><td colspan="4" class="region-table__empty">这个视野下暂时没有可列出的地区。</td></tr>';
            return;
        }

        body.innerHTML = rows
            .map((point) => {
                const count = Number(point.value) || 0;
                const cityCount = Number(point.cityCount || 0);
                rowPoints.set(point.name, point);

                return `
            <tr class="region-table__row">
                <th scope="row" class="region-table__name">${escapeHtml(point.name)}</th>
                <td class="region-table__num">${count}</td>
                <td class="region-table__num">${cityCount > 0 ? cityCount : '—'}</td>
                <td class="region-table__action">
                    <button type="button" class="region-table__btn" data-region="${escapeHtml(point.name)}" aria-label="${escapeHtml(regionActionLabel(point))}">查看</button>
                </td>
            </tr>
        `;
            })
            .join('');

        restoreRowFocus(previouslyFocusedRegion);
    }

    // 行按钮是动态生成的，用事件委托，重建表格后不需要重新绑定。
    const onBodyClick = (event: MouseEvent): void => {
        const button = (event.target as Element | null)?.closest('button[data-region]');
        if (!button) {
            return;
        }

        const name = button.getAttribute('data-region');
        const point = name ? rowPoints.get(name) : null;
        if (!point) {
            return;
        }

        // 与地图点击同一个入口：下钻 / 开详情 / 开公开面板都由它分流。
        deps.activate(point, 'ledger');
    };

    const onSortClick = (): void => {
        if (sortKey === 'value') {
            sortKey = 'name';
            sortDir = 1;
        } else {
            sortKey = 'value';
            sortDir = -1;
        }

        render();
    };

    body?.addEventListener('click', onBodyClick);
    sortButton?.addEventListener('click', onSortClick);

    return {
        render,
        destroy(): void {
            body?.removeEventListener('click', onBodyClick);
            sortButton?.removeEventListener('click', onSortClick);
            rowPoints.clear();
        },
        readState(): { sortKey: RegionSortKey; sortDir: number; rowCount: number } {
            return { sortKey, sortDir, rowCount };
        }
    };
}

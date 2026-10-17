/**
 * 底部抽屉 / 口令弹窗 /「地区一览」的控制器（从 `js/map.js` 的 `BottomSheet`、
 * 口令与详情流程、`renderRegionTable` 一族忠实迁移）。
 *
 * 三件事共用一份状态，因为它们本来就是一条链：点地区 → 开抽屉 → 要口令 → 取详情 →
 * 抽屉换成明细卡。`#details-btn`（详情模式开关）只决定面板默认展开公开卡还是「同学信息」，
 * 不再插手「点地区是下钻还是开面板」—— 那条分支现在只由点击意图（`activateRegion` 的
 * `intent`）决定。
 *
 * 边界：
 * - 地图下钻 / 缩放 / 悬浮卡片 / 触摸兜底归 `src/lib/map-island.ts`（只读消费它的
 *   `activateRegion` 与 `map-bridge` 契约，绝不复制下钻或详情分支）；
 * - 分享图与读屏播报（`#interaction-note`）归 l2_share：本模块**不碰** `#interaction-note`，
 *   只通过 `setDetailModeState()` / 地图广播的事件让那边自己更新；
 * - 动效归 l2_motion（`magnet` / `spotlight` 类名由样式表接管）。
 *
 * 可达性硬约束（AGENTS.md「Map Rendering Notes」/ migration-parity A8、A9）：
 * 1. 抽屉与弹窗一律走 `FocusScope`：打开时背景 `inert`、焦点移入，关闭后归还触发元素；
 * 2. 抽屉是用 `bottom` 滑出屏幕关闭的，DOM 一直在，所以非 active 时三个 `#bs-*`
 *    按钮必须置 `hidden`，否则它们停在 y≈1660 仍可聚焦，Tab 会落到看不见的控件上；
 * 3. Esc 先关弹层（弹窗 → 抽屉），再交给地图退全国 —— 地图侧广播
 *    `MAP_EVENT_NAMES.escape`，这里负责关掉最上面那一层。
 */
import { closeFocusScope, focusScopeDepth, openFocusScope } from './focus-scope';
import type { FocusScopeEntry } from './focus-scope';
import { renderDetailCard, renderLoadingCard } from './dialog-cards';
import { fetchJson, fetchRegionDetails, normalizeApiErrorMessage, postLogout, postPassphrase } from './dialog-api';
import { advanceSessionRevision, watchSessionChanges } from './session-sync';
import { renderPublicCardHtml } from './tooltip-card';
import { getPointRegion } from './map-model';
import type { RegionPoint } from './map-model';
import { getMapState, MAP_EVENT_NAMES, onMapEvent, setDetailModeState, setOverlayOpenProbe } from './map-bridge';
import type { DetailModeState, RegionActivationDetail } from './map-bridge';
import { activateRegion } from './map-island';
import type { DetailsPayload, PublicMapPayload } from './types';
import { initRegionLedger } from './region-ledger';
import type { RegionLedgerController } from './region-ledger';

type SheetMode = 'public' | 'loading' | 'detail';
type FeedbackVariant = 'error' | 'success' | null;

interface DialogUi {
    overlay: HTMLElement | null;
    sheet: HTMLElement | null;
    content: HTMLElement | null;
    primaryButton: HTMLButtonElement | null;
    drilldownButton: HTMLButtonElement | null;
    closeButton: HTMLButtonElement | null;
    pageWrapper: HTMLElement | null;
    map: HTMLElement | null;
    detailsButton: HTMLButtonElement | null;
    authOverlay: HTMLElement | null;
    authClose: HTMLButtonElement | null;
    authForm: HTMLFormElement | null;
    authInput: HTMLInputElement | null;
    authFeedback: HTMLElement | null;
    authSubmit: HTMLButtonElement | null;
    authHint: HTMLElement | null;
    authToggle: HTMLButtonElement | null;
}

function lookupUi(): DialogUi {
    return {
        overlay: document.getElementById('bs-overlay'),
        sheet: document.getElementById('bottom-sheet'),
        content: document.getElementById('bs-content'),
        primaryButton: document.getElementById('bs-primary-btn') as HTMLButtonElement | null,
        drilldownButton: document.getElementById('bs-drilldown-btn') as HTMLButtonElement | null,
        closeButton: document.getElementById('bs-close') as HTMLButtonElement | null,
        pageWrapper: document.querySelector('.page-wrapper'),
        map: document.getElementById('map'),
        detailsButton: document.getElementById('details-btn') as HTMLButtonElement | null,
        authOverlay: document.getElementById('auth-overlay'),
        authClose: document.getElementById('auth-close') as HTMLButtonElement | null,
        authForm: document.getElementById('auth-form') as HTMLFormElement | null,
        authInput: document.getElementById('auth-passphrase') as HTMLInputElement | null,
        authFeedback: document.getElementById('auth-feedback'),
        authSubmit: document.getElementById('auth-submit') as HTMLButtonElement | null,
        authHint: document.getElementById('auth-hint'),
        authToggle: document.getElementById('auth-toggle') as HTMLButtonElement | null
    };
}

const state = {
    ui: null as DialogUi | null,
    ledger: null as RegionLedgerController | null,
    currentPoint: null as RegionPoint | null,
    currentMode: 'public' as SheetMode,
    sheetScope: null as FocusScopeEntry | null,
    authScope: null as FocusScopeEntry | null,
    pendingPoint: null as RegionPoint | null,
    detailRequestVersion: 0,
    sessionVersion: 0,
    sessionSync: null as ReturnType<typeof watchSessionChanges> | null,
    /** 上一次视野的省名：只有真正换视野（下钻/返回）才关抽屉，同视野刷新数据不关。 */
    lastProvince: null as string | null,
    disposers: [] as Array<() => void>,
    booted: false
};

function ui(): DialogUi {
    if (!state.ui) {
        state.ui = lookupUi();
    }
    return state.ui;
}

function detailState(): DetailModeState {
    return getMapState().detailMode;
}

function activeProvince(): string | null {
    return getMapState().view.province;
}

function hideChartTip(): void {
    const chart = getMapState().chart;
    if (chart) {
        chart.dispatchAction({ type: 'hideTip' });
    }
}

/* ------------------------------------------------------------------ *
 * 底部抽屉
 * ------------------------------------------------------------------ */

function sheetIsActive(): boolean {
    return Boolean(ui().sheet?.classList.contains('active'));
}

/**
 * 面板收起时，里面的按钮即使 `currentPoint` 还在也必须一起藏起来。
 *
 * 面板是靠 `bottom` 位移收起的，DOM 上一直存在；只把 class 去掉的话，这三个按钮
 * 仍然可聚焦，Tab 会停到屏幕外的隐藏控件上（焦点凭空消失）。
 */
function updateSheetButtons(): void {
    const dom = ui();
    if (!dom.closeButton || !dom.primaryButton || !dom.drilldownButton) {
        return;
    }

    if (!sheetIsActive()) {
        dom.closeButton.hidden = true;
        dom.primaryButton.hidden = true;
        dom.drilldownButton.hidden = true;
        return;
    }

    dom.closeButton.hidden = false;

    const currentPoint = state.currentPoint;
    if (!currentPoint) {
        dom.primaryButton.hidden = true;
        dom.drilldownButton.hidden = true;
        return;
    }

    const detail = detailState();
    if (!detail.available) {
        dom.primaryButton.hidden = true;
    } else {
        dom.primaryButton.hidden = false;
        if (!detail.access) {
            dom.primaryButton.textContent = '输入口令后查看';
        } else if (!detail.enabled) {
            dom.primaryButton.textContent = '查看同学信息';
        } else if (state.currentMode === 'detail') {
            dom.primaryButton.textContent = '重新加载';
        } else {
            dom.primaryButton.textContent = '查看同学信息';
        }
    }

    if (currentPoint.drilldownFile && !activeProvince()) {
        dom.drilldownButton.hidden = false;
        dom.drilldownButton.textContent = `进入 ${currentPoint.name} 地图详情`;
    } else {
        dom.drilldownButton.hidden = true;
    }
}

function openSheet(): void {
    const dom = ui();
    if (!dom.sheet || !dom.overlay) {
        return;
    }

    const wasActive = sheetIsActive();

    dom.sheet.classList.add('active');
    dom.overlay.classList.add('active');

    // 悬浮卡片是鼠标位置的产物，留着会和面板叠成两张深色卡片。
    hideChartTip();

    // showPublic / showLoading / showDetail 都会走到这里，作用域只开一次。
    if (!wasActive) {
        state.sheetScope = openFocusScope({
            inert: [dom.pageWrapper],
            focus: dom.sheet,
            fallback: dom.map
        });
    }
}

function closeSheet(): void {
    const dom = ui();
    if (!dom.sheet || !dom.overlay) {
        return;
    }

    dom.sheet.classList.remove('active');
    dom.overlay.classList.remove('active');
    if (state.currentMode !== 'public' && dom.content) dom.content.textContent = '';
    state.currentMode = 'public';
    state.detailRequestVersion += 1;
    // 收起后立刻把按钮移出焦点序列，不能等到下次打开才处理。
    updateSheetButtons();

    if (state.sheetScope) {
        closeFocusScope(state.sheetScope);
        state.sheetScope = null;
    }
}

function showPublic(point: RegionPoint, options?: Parameters<typeof renderPublicCardHtml>[1]): void {
    const dom = ui();
    if (!dom.content) {
        return;
    }

    state.currentPoint = point;
    state.currentMode = 'public';
    const detail = detailState();
    dom.content.innerHTML = renderPublicCardHtml(
        point,
        options || {},
        activeProvince(),
        {
            detailModeAvailable: detail.available,
            detailAccess: detail.access,
            detailModeEnabled: detail.enabled
        }
    );
    openSheet();
    updateSheetButtons();
}

function showLoading(point: RegionPoint): void {
    const dom = ui();
    if (!dom.content) {
        return;
    }

    state.currentPoint = point;
    state.currentMode = 'loading';
    dom.content.innerHTML = renderLoadingCard(point);
    openSheet();
    updateSheetButtons();
}

function showDetail(point: RegionPoint, payload: DetailsPayload): void {
    const dom = ui();
    if (!dom.content) {
        return;
    }

    state.currentPoint = point;
    state.currentMode = 'detail';
    dom.content.innerHTML = renderDetailCard(payload);
    openSheet();
    updateSheetButtons();
}

/** 退出详情 / 会话过期时把面板里的敏感内容换回公开卡。 */
function hideSensitive(): void {
    if (!sheetIsActive() || !state.currentPoint) {
        return;
    }

    if (state.currentMode === 'detail' || state.currentMode === 'loading') {
        showPublic(state.currentPoint);
    }
}

/* ------------------------------------------------------------------ *
 * 口令弹窗
 * ------------------------------------------------------------------ */

function authIsOpen(): boolean {
    const overlay = ui().authOverlay;
    return Boolean(overlay && !overlay.hasAttribute('hidden'));
}

function setAuthFeedback(message: string, variant: FeedbackVariant): void {
    const dom = ui();
    if (!dom.authFeedback) {
        return;
    }

    dom.authFeedback.textContent = message || '';
    if (variant === 'error' || variant === 'success') {
        dom.authFeedback.setAttribute('data-variant', variant);
    } else {
        dom.authFeedback.removeAttribute('data-variant');
    }

    // 出错时把反馈接进输入框的描述并标 aria-invalid；没出错就不接，
    // 否则 live region 和 aria-describedby 会把同一句话播报两遍。
    if (dom.authInput) {
        if (variant === 'error') {
            dom.authInput.setAttribute('aria-invalid', 'true');
            dom.authInput.setAttribute('aria-describedby', 'auth-hint auth-feedback');
        } else {
            dom.authInput.removeAttribute('aria-invalid');
            dom.authInput.setAttribute('aria-describedby', 'auth-hint');
        }
    }
}

/**
 * 口令显隐。口令是姓名拼音，打错了看不出来，
 * 没有这个开关就只能整段删掉重输。
 */
function setPassphraseVisibility(revealed: boolean): void {
    const dom = ui();
    if (!dom.authInput || !dom.authToggle) {
        return;
    }

    dom.authInput.type = revealed ? 'text' : 'password';
    dom.authToggle.setAttribute('aria-pressed', String(revealed));
    dom.authToggle.setAttribute('aria-label', revealed ? '隐藏口令' : '显示口令');
    dom.authToggle.dataset.revealed = revealed ? 'true' : 'false';

    // 部分浏览器在改 type 时会把焦点丢掉，这里补回来并把光标放到末尾。
    if (document.activeElement === dom.authInput || revealed === false) {
        const end = dom.authInput.value.length;
        dom.authInput.focus();
        try {
            dom.authInput.setSelectionRange(end, end);
        } catch (_error) {
            // 某些输入类型不支持选区，忽略即可。
        }
    }
}

function openAuthModal(message?: string): void {
    const dom = ui();
    if (!dom.authOverlay) {
        return;
    }

    dom.authOverlay.hidden = false;
    if (dom.authHint) {
        const hint = getMapState().detailsHint;
        dom.authHint.textContent = hint ? `口令提示：${hint}` : '如忘记口令，请联系老师或同学。';
    }

    hideChartTip();

    // 先开作用域、再动焦点：FocusScope 记录的「焦点来源」必须还是打开弹窗的那个触发元素。
    // 旧站把 `setPassphraseVisibility()` 里的 `input.focus()` 放在记录**之前**，于是
    // 关闭时归还的目标是一个已经 `hidden` 的输入框，焦点实际丢给 `body`。
    // migration-parity A8 与 AGENTS.md 的键盘清单都要求「Esc 后焦点回触发按钮」，
    // 所以这里把顺序调正（是本节点相对旧站的一处有意修正，已写进执行报告）。
    if (!state.authScope) {
        state.authScope = openFocusScope({
            inert: [dom.pageWrapper, dom.sheet]
        });
    }

    setAuthFeedback(message || '', null);
    setPassphraseVisibility(false);

    window.setTimeout(() => {
        dom.authInput?.focus();
    }, 0);
}

function closeAuthModal(): void {
    const dom = ui();
    if (!dom.authOverlay) {
        return;
    }

    dom.authOverlay.hidden = true;
    dom.authForm?.reset();
    setAuthFeedback('', null);
    state.pendingPoint = null;

    if (state.authScope) {
        closeFocusScope(state.authScope);
        state.authScope = null;
    }
}

async function handleAuthSubmit(event: Event): Promise<void> {
    event.preventDefault();

    const dom = ui();
    if (!dom.authInput) {
        return;
    }

    const passphrase = dom.authInput.value.trim();
    if (!passphrase) {
        setAuthFeedback('请输入口令。', 'error');
        dom.authInput.focus();
        return;
    }

    if (dom.authSubmit) {
        dom.authSubmit.disabled = true;
    }
    setAuthFeedback('正在确认口令...', null);

    invalidateDetailAccess();
    const sessionVersion = state.sessionVersion;
    try {
        await postPassphrase(passphrase);
        state.sessionSync?.notify();
        if (sessionVersion !== state.sessionVersion) return;

        const pendingPoint = state.pendingPoint;
        setDetailModeState({ access: true, enabled: true });
        updateDetailsButton();
        closeAuthModal();

        if (pendingPoint) {
            await showDetailSheetForPoint(pendingPoint);
        }
    } catch (error) {
        if (sessionVersion !== state.sessionVersion) return;
        let message = normalizeApiErrorMessage(error, '暂时无法确认口令，请稍后再试。');
        const apiError = error as { status?: number; payload?: { remainingAttempts?: unknown } };
        if (apiError && apiError.payload && typeof apiError.payload.remainingAttempts === 'number' && apiError.status === 401) {
            message += ` 剩余 ${apiError.payload.remainingAttempts} 次尝试。`;
        }
        setAuthFeedback(message, 'error');
    } finally {
        if (dom.authSubmit) {
            dom.authSubmit.disabled = false;
        }
    }
}

async function clearDetailSession(): Promise<void> {
    try {
        await postLogout();
    } catch (error) {
        console.warn('Failed to clear detail session:', error);
    }
}

function invalidateDetailAccess(): void {
    advanceSessionRevision();
    state.sessionVersion += 1;
    state.detailRequestVersion += 1;
    setDetailModeState({ access: false, enabled: false });
    updateDetailsButton();
    hideSensitive();
}

function revokeDetailAccess(message?: string): void {
    // 401/切线只使本页失效，不发 logout：迟到的 401 不应删除另一标签刚登录的 Cookie。
    invalidateDetailAccess();

    if (message) {
        state.pendingPoint = state.currentPoint;
        openAuthModal(message);
    }
}

/* ------------------------------------------------------------------ *
 * 详情拉取
 * ------------------------------------------------------------------ */

async function showDetailSheetForPoint(point: RegionPoint): Promise<void> {
    state.detailRequestVersion += 1;
    const requestVersion = state.detailRequestVersion;
    showLoading(point);

    try {
        const region = getPointRegion(point, activeProvince());
        // 每次通过当前线路鉴权，不复用另一条线路/旧会话留下的明细缓存。
        const payload = await fetchRegionDetails(region);

        if (requestVersion !== state.detailRequestVersion) {
            return;
        }

        showDetail(point, payload);
    } catch (error) {
        if (requestVersion !== state.detailRequestVersion) {
            return;
        }

        const apiError = error as { status?: number };
        if (apiError && apiError.status === 401) {
            showPublic(point, {
                callout: '已退出查看，请重新输入口令。',
                hideHint: true,
                hideEmpty: true
            });
            state.pendingPoint = point;
            revokeDetailAccess('已退出查看，请重新输入口令。');
            return;
        }

        console.error('Failed to load region details:', error);
        showPublic(point, {
            callout: normalizeApiErrorMessage(error, '这个地区暂时打不开，请稍后再试。'),
            hideHint: true,
            hideEmpty: true
        });
    }
}

/* ------------------------------------------------------------------ *
 * 详情模式（#details-btn）
 * ------------------------------------------------------------------ */

function updateDetailsButton(): void {
    const button = ui().detailsButton;
    const detail = detailState();

    if (button) {
        if (!detail.available) {
            button.hidden = true;
        } else {
            button.hidden = false;
            button.dataset.active = detail.enabled ? 'true' : 'false';
            // 这是一个切换按钮，得把选中状态暴露出去，否则读屏只知道标签变了。
            button.setAttribute('aria-pressed', String(detail.enabled));
            button.textContent = detail.enabled ? '退出查看' : '同学信息';
            button.setAttribute('aria-label', detail.access ? (detail.enabled ? '退出查看' : '开启查看') : '输入口令后开启查看');
        }
    }

    // 地区一览里按钮的动作措辞跟着详情模式走，所以在这条公共路径上一起刷新。
    state.ledger?.render();
}

function toggleDetailMode(): void {
    const detail = detailState();
    if (!detail.available) {
        return;
    }

    if (!detail.access) {
        state.pendingPoint = null;
        openAuthModal('输入口令后即可查看同学信息。');
        return;
    }

    if (detail.enabled) {
        // 退出查看 = 结束口令会话：清除 Cookie 与本地缓存，再次查看需重新输入口令。
        revokeDetailAccess();
        state.sessionSync?.notify();
        clearDetailSession().then(() => state.sessionSync?.notify());
        return;
    }

    setDetailModeState({ enabled: true });
    updateDetailsButton();

    const currentPoint = state.currentPoint;
    if (sheetIsActive() && currentPoint) {
        showDetailSheetForPoint(currentPoint).catch((error: unknown) => {
            console.error('Failed to refresh detail sheet after enabling detail mode:', error);
        });
    }
}

/* ------------------------------------------------------------------ *
 * 事件绑定
 * ------------------------------------------------------------------ */

function bindEvents(): void {
    const dom = ui();

    // 详情模式按钮（「同学信息」/「退出查看」）在 SiteHeader.astro 的眉标行里。
    // 本节点只从岛屿这一侧接管它的行为与状态，不动它的 DOM。
    if (dom.detailsButton) {
        const onDetailsClick = (): void => toggleDetailMode();
        dom.detailsButton.addEventListener('click', onDetailsClick);
        state.disposers.push(() => dom.detailsButton?.removeEventListener('click', onDetailsClick));
    }

    if (dom.overlay) {
        // 关面板只能用 pointerdown，不能用 click。触摸点开面板时，这一下的 pointerdown
        // 早已派发完毕（那会儿这块遮罩还是 pointer-events: none，命中的是地图），
        // 但浏览器随后补发的原生 click 会落在刚刚盖满屏幕的遮罩上，把面板立刻关掉 ——
        // 表现就是「点一下、面板闪一下就没了」。pointerdown 不会迟到；鼠标点遮罩照旧即时关闭。
        const onOverlayPointerDown = (): void => closeSheet();
        dom.overlay.addEventListener('pointerdown', onOverlayPointerDown);
        state.disposers.push(() => dom.overlay?.removeEventListener('pointerdown', onOverlayPointerDown));
    }

    if (dom.closeButton) {
        const onClose = (): void => closeSheet();
        dom.closeButton.addEventListener('click', onClose);
        state.disposers.push(() => dom.closeButton?.removeEventListener('click', onClose));
    }

    if (dom.primaryButton) {
        const onPrimary = (): void => {
            const point = state.currentPoint;
            const detail = detailState();
            if (!point || !detail.available) {
                return;
            }

            if (!detail.access) {
                state.pendingPoint = point;
                openAuthModal('输入口令后可查看这个地区的同学信息。');
                return;
            }

            setDetailModeState({ enabled: true });
            updateDetailsButton();
            showDetailSheetForPoint(point).catch((error: unknown) => {
                console.error('Bottom sheet primary action failed:', error);
            });
        };
        dom.primaryButton.addEventListener('click', onPrimary);
        state.disposers.push(() => dom.primaryButton?.removeEventListener('click', onPrimary));
    }

    if (dom.drilldownButton) {
        const onDrilldown = (): void => {
            const point = state.currentPoint;
            if (!point || !point.drilldownFile || activeProvince()) {
                return;
            }

            // 显式下钻意图：详情模式开着也要下去（旧站这里是一条独立下钻调用，
            // 不受详情模式门禁）。仍然走 activateRegion 这一个入口，不在抽屉侧复制下钻分支。
            activateRegion(point, 'sheet', 'drill');
        };
        dom.drilldownButton.addEventListener('click', onDrilldown);
        state.disposers.push(() => dom.drilldownButton?.removeEventListener('click', onDrilldown));
    }

    if (dom.authForm) {
        const onSubmit = (event: Event): void => {
            handleAuthSubmit(event).catch((error: unknown) => {
                console.error('Auth submit failed:', error);
                setAuthFeedback('暂时无法确认口令，请稍后再试。', 'error');
            });
        };
        dom.authForm.addEventListener('submit', onSubmit);
        state.disposers.push(() => dom.authForm?.removeEventListener('submit', onSubmit));
    }

    if (dom.authClose) {
        const onAuthClose = (): void => closeAuthModal();
        dom.authClose.addEventListener('click', onAuthClose);
        state.disposers.push(() => dom.authClose?.removeEventListener('click', onAuthClose));
    }

    if (dom.authToggle) {
        const onToggle = (): void => {
            const input = ui().authInput;
            setPassphraseVisibility(input ? input.type === 'password' : false);
        };
        dom.authToggle.addEventListener('click', onToggle);
        state.disposers.push(() => dom.authToggle?.removeEventListener('click', onToggle));
    }

    if (dom.authOverlay) {
        const onAuthOverlayClick = (event: MouseEvent): void => {
            if (event.target === dom.authOverlay) {
                closeAuthModal();
            }
        };
        dom.authOverlay.addEventListener('click', onAuthOverlayClick);
        state.disposers.push(() => dom.authOverlay?.removeEventListener('click', onAuthOverlayClick));
    }

    // 地图侧的事件（l2_map 的契约）：

    // 下钻「一开始」就收面板：drillIntoProvince 过完守卫、在任何 await 之前广播
    // `map:drill-start`。旧站是下钻前同步 close（legacy/js/map.js:1538），新站此前要等
    // `map:view-change` 才关，而那条路要等省级地图与字体就位，最长能把面板多留 2s，
    // 读起来像「点了省份，面板还赖在那里」。来源是抽屉自己的下钻按钮时也一样收。
    state.disposers.push(
        onMapEvent<{ point?: RegionPoint }>(MAP_EVENT_NAMES.drillStart, () => {
            if (sheetIsActive()) {
                closeSheet();
            }
        })
    );

    state.disposers.push(
        onMapEvent<RegionActivationDetail & { callout?: string }>(MAP_EVENT_NAMES.regionActivate, (detail) => {
            const point = detail?.point;
            if (!point) {
                return;
            }

            // 省级地图加载失败这类「有话要说」的激活：直接开公开卡并带上说明。
            if (detail.callout) {
                showPublic(point, { callout: detail.callout, hideHint: true, hideEmpty: true });
                return;
            }

            const mode = detailState();
            if (mode.enabled && mode.access) {
                showDetailSheetForPoint(point).catch((error: unknown) => {
                    console.error('Failed to show detail sheet for point:', error);
                });
                return;
            }

            showPublic(point);
        })
    );

    state.disposers.push(
        onMapEvent<{ province: string | null }>(MAP_EVENT_NAMES.viewChange, (detail) => {
            const province = detail?.province ?? null;

            // 下钻已经由 `map:drill-start` 提前收掉了；这里兜住「返回全国」与其他换视野路径。
            // 旧站这两条路径各自先 `BottomSheet.close()`，新站地图不碰抽屉，由这里补上。
            // 同视野的数据刷新（province 不变）不关。
            if (province !== state.lastProvince) {
                state.lastProvince = province;
                closeSheet();
            }

            updateDetailsButton();
        })
    );

    state.disposers.push(
        onMapEvent(MAP_EVENT_NAMES.publicData, () => {
            updateDetailsButton();
        })
    );

    state.disposers.push(
        onMapEvent(MAP_EVENT_NAMES.detailModeChange, () => {
            updateDetailsButton();
        })
    );

    // Esc 的优先级与旧实现一致：口令弹窗 → 底部抽屉。地图侧只在「弹层打开时」
    // 广播这个事件（否则它自己退全国），所以这里不需要再判一遍。
    state.disposers.push(
        onMapEvent(MAP_EVENT_NAMES.escape, () => {
            if (authIsOpen()) {
                closeAuthModal();
                return;
            }

            if (sheetIsActive()) {
                closeSheet();
            }
        })
    );
}

/* ------------------------------------------------------------------ *
 * 启动 / 卸载
 * ------------------------------------------------------------------ */

/** 探针读数（验收脚本用；只读，不改状态）。 */
export interface DialogsProbeReadings {
    booted: boolean;
    sheetActive: boolean;
    sheetMode: SheetMode;
    currentPoint: string | null;
    authOpen: boolean;
    authFeedback: string;
    authFeedbackVariant: string | null;
    focusScopeDepth: number;
    overlayOpen: boolean;
    detailMode: DetailModeState;
    ledger: { sortKey: string; sortDir: number; rowCount: number } | null;
    detailsCacheSize: number;
    pendingPoint: string | null;
    inertElements: string[];
}

export function readDialogsProbe(): DialogsProbeReadings {
    const dom = ui();
    const ledgerState = state.ledger ? state.ledger.readState() : null;

    return {
        booted: state.booted,
        sheetActive: sheetIsActive(),
        sheetMode: state.currentMode,
        currentPoint: state.currentPoint ? state.currentPoint.name : null,
        authOpen: authIsOpen(),
        authFeedback: dom.authFeedback ? dom.authFeedback.textContent || '' : '',
        authFeedbackVariant: dom.authFeedback ? dom.authFeedback.getAttribute('data-variant') : null,
        focusScopeDepth: focusScopeDepth(),
        overlayOpen: authIsOpen() || sheetIsActive(),
        detailMode: detailState(),
        ledger: ledgerState,
        detailsCacheSize: 0,
        pendingPoint: state.pendingPoint ? state.pendingPoint.name : null,
        inertElements: [dom.pageWrapper, dom.sheet]
            .filter((element): element is HTMLElement => Boolean(element && element.inert))
            .map((element) => element.id || element.className)
    };
}

export function bootDialogsIsland(): void {
    if (state.booted) {
        return;
    }
    state.booted = true;

    state.ledger = initRegionLedger({
        getPoints: () => getMapState().view.points,
        getActiveProvince: () => activeProvince(),
        getStats: () => getMapState().publicData?.stats || null,
        getDetailState: () => detailState(),
        // intent 一路上传，不在这一层再判一次：「查看」= 轻点语义，「详情」= 强制开面板。
        activate: (point, source, intent) => activateRegion(point, source, intent)
    });

    // 地图侧用它判断「弹层是否打开」（TapFallback 忽略弹层上的触摸、Esc 先关弹层）。
    setOverlayOpenProbe(() => authIsOpen() || sheetIsActive());

    bindEvents();
    state.sessionSync = watchSessionChanges(invalidateDetailAccess);
    state.disposers.push(() => { state.sessionSync?.dispose(); state.sessionSync = null; });
    const recheckSession = async (): Promise<void> => {
        if (document.visibilityState !== 'visible') return;
        // 返回标签页/BFCache 后先隐藏已有明细，再向当前选中端复核，网络失败保持关闭。
        invalidateDetailAccess();
        const version = state.sessionVersion;
        try {
            const payload = await fetchJson<PublicMapPayload>('/api/map/public');
            if (version !== state.sessionVersion) return;
            setDetailModeState({ available: payload.detailModeAvailable, access: payload.detailAccess });
        } catch { /* 当前线路无法确认时不显示旧明细。 */ }
    };
    const onVisibility = (): void => {
        if (document.visibilityState === 'hidden') invalidateDetailAccess();
        else void recheckSession();
    };
    const onFocus = (): void => { void recheckSession(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    state.disposers.push(() => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('pageshow', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
    });
    updateDetailsButton();

    // 首屏就把状态同步给地图侧：地图与面板共用这一份 detailMode 快照
    // （`available` / `access` 决定面板里的公开卡与详情卡，`enabled` 只决定默认展开哪一张）。
    const publicData = getMapState().publicData;
    if (publicData) {
        setDetailModeState({
            available: Boolean(publicData.detailModeAvailable),
            access: Boolean(publicData.detailAccess)
        });
    }
}

export function destroyDialogsIsland(): void {
    if (!state.booted) {
        return;
    }

    state.disposers.forEach((dispose) => dispose());
    state.disposers = [];
    state.ledger?.destroy();
    state.ledger = null;
    setOverlayOpenProbe(null);

    closeFocusScope(state.sheetScope);
    closeFocusScope(state.authScope);
    state.sheetScope = null;
    state.authScope = null;

    state.booted = false;
    state.ui = null;
    state.currentPoint = null;
    state.currentMode = 'public';
    state.pendingPoint = null;
    state.sessionVersion += 1;
    state.detailRequestVersion = 0;
    state.lastProvince = null;
}

/**
 * @fileoverview 蹭饭地图核心模块
 *
 * 地图用 ECharts 渲染（js/vendor/echarts.min.js，按需构建，只含 map/geo/tooltip/visualMap）。
 * 几何数据来自 js/china.js 和按需懒加载的 js/province/*.js，统一登记在 CMapGeo 里。
 *
 * 公开数据通过 Cloudflare Pages Functions 从 KV 读取：
 * 公开访客只看到省市聚合统计，班内明细需要服务端口令会话后按地区拉取。
 */

/**
 * 判断是否使用移动端交互方式。
 *
 * 只看 maxTouchPoints 会把带触摸屏的笔记本一起算进来，而那些设备上鼠标悬停是能用的；
 * 一旦误判，悬浮卡片永远不出现，点击也被改成打开底部面板。所以优先看主输入设备
 * 是否支持悬停，只有拿不到媒体查询时才退回能力探测。
 */
const isTouchDevice = (function() {
    if (window.matchMedia) {
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            return false;
        }
        if (window.matchMedia('(pointer: coarse)').matches) {
            return true;
        }
    }
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
})();

const CHINA_MAP_ID = 'cn/china';
const PROVINCE_MAP_PREFIX = 'cn/';
const REGION_SERIES_ID = 'regions';
const SNAPSHOT_BACKGROUND = '#f5efe6';

/** 人数越多颜色越深，起点色同时用作无数据地区的底色。 */
const HEAT_COLORS = ['#f5efe6', '#e8c4a8', '#d9a87c', '#c4704b', '#b56540', '#a85a3a'];
const BORDER_COLOR = '#e0d8cc';
const HOVER_AREA_COLOR = '#e8a87c';
const HOVER_BORDER_COLOR = '#c4704b';
/**
 * 默认视图比例。ECharts 自动布局只会用掉容器的 80%，
 * 放大 1.25 倍正好让地图铺满可用区域，因此它同时是初始比例和最小比例。
 */
const BASE_ZOOM = 1.25;
const ZOOM_MAX = 8;
/** 判定平移是否越界时的容差（像素）。 */
const ROAM_TOLERANCE_PX = 0.5;

const AppState = {
    chart: null,
    publicData: null,
    /** 省份名 -> { name, file, point, loading } */
    provinceCatalog: {},
    activeProvince: null,
    activeMapId: CHINA_MAP_ID,
    /** 当前视图里的地区名 -> 数据点，供 tooltip 与点击事件复用 */
    regionIndex: new Map(),
    detailsCache: new Map(),
    detailRequestVersion: 0,
    detailAccess: false,
    detailModeAvailable: false,
    detailModeEnabled: false,
    detailsHint: '',
    pendingPoint: null,
    /** 避免纠偏时自己触发自己 */
    clampingRoam: false
};

const ui = {
    loading: document.getElementById('map-loading'),
    error: document.getElementById('cdn-error'),
    errorTitle: document.getElementById('cdn-error-title'),
    errorMessage: document.getElementById('cdn-error-message'),
    note: document.getElementById('interaction-note'),
    detailsButton: document.getElementById('details-btn'),
    backButton: document.getElementById('map-back-btn'),
    regionBadge: document.getElementById('map-region-badge'),
    zoomIn: document.getElementById('map-zoom-in'),
    zoomOut: document.getElementById('map-zoom-out'),
    zoomReset: document.getElementById('map-zoom-reset'),
    authOverlay: document.getElementById('auth-overlay'),
    authClose: document.getElementById('auth-close'),
    authForm: document.getElementById('auth-form'),
    authInput: document.getElementById('auth-passphrase'),
    authFeedback: document.getElementById('auth-feedback'),
    authSubmit: document.getElementById('auth-submit'),
    authHint: document.getElementById('auth-hint')
};

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hideMapLoading() {
    if (ui.loading) {
        ui.loading.style.display = 'none';
    }
}

function showProvinceLoading(provinceName) {
    if (!ui.loading) {
        return;
    }
    const text = ui.loading.querySelector('.map-loading__text');
    if (text && provinceName) {
        text.textContent = '正在加载 ' + provinceName + ' 地图...';
    }
    ui.loading.style.display = 'flex';
}

function normalizeRegionToken(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
        return null;
    }

    return normalized;
}

function getActiveProvinceName() {
    return normalizeRegionToken(AppState.activeProvince);
}

/**
 * 把地图数据点还原成 { province, city }，供详情接口查询使用。
 * 点里的字段由 buildNationalPoints / buildProvincePoints 写入，不再依赖图表库的对象结构。
 */
function getPointRegion(point) {
    const province = normalizeRegionToken(point && point.province) ||
        getActiveProvinceName() ||
        normalizeRegionToken(point && point.name);

    return {
        province: province,
        city: normalizeRegionToken(point && point.city)
    };
}

function getRegionKey(region) {
    return region.city ? `${region.province}::${region.city}` : `${region.province}::*`;
}

function getPointCount(point) {
    return Number(point && point.value ? point.value : 0);
}

function getPublicHint() {
    if (!AppState.detailModeAvailable) {
        return '仅展示公开人数。';
    }

    if (!AppState.detailAccess) {
        return '公开页仅显示人数。';
    }

    if (AppState.detailModeEnabled) {
        return '详情模式已开启。';
    }

    return '已确认，可以查看详情。';
}

function renderPublicCard(point, options) {
    const cardOptions = options || {};
    const count = getPointCount(point);
    const region = getPointRegion(point);
    const metaHtml = region.city
        ? `<div class="tooltip__meta"><strong>${escapeHtml(region.province)}</strong> · 城市公开人数</div>`
        : `<div class="tooltip__meta">覆盖城市 <strong>${Number(point.cityCount || 0)}</strong> 座</div>`;
    const emptyHtml = count === 0 && !cardOptions.hideEmpty && !cardOptions.callout
        ? '<div class="tooltip__empty">当前公开数据中暂无记录。</div>'
        : '';
    const hint = cardOptions.compact || cardOptions.hideHint ? '' : getPublicHint();
    const hintHtml = hint ? `<div class="tooltip__hint">${escapeHtml(hint)}</div>` : '';
    const calloutHtml = cardOptions.callout
        ? `<div class="tooltip__callout">${escapeHtml(cardOptions.callout)}</div>`
        : '';
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

function renderLoadingCard(point) {
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

function renderDetailCard(payload) {
    const metaHtml = payload.city
        ? `<div class="tooltip__meta"><strong>${escapeHtml(payload.province)}</strong> · ${escapeHtml(payload.city)}</div>`
        : '<div class="tooltip__meta">省内班内明细</div>';

    const listHtml = payload.people.length > 0
        ? `
            <div class="list">
                ${payload.people.map(function(person) {
                    return `
                        <div class="pinfo">
                            <div class="pname">${escapeHtml(person.name)}</div>
                            <div class="city">${escapeHtml(person.city)}</div>
                            <div class="school">${escapeHtml(person.school)}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `
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

const BottomSheet = (function() {
    const elements = {
        overlay: document.getElementById('bs-overlay'),
        sheet: document.getElementById('bottom-sheet'),
        content: document.getElementById('bs-content'),
        primaryButton: document.getElementById('bs-primary-btn'),
        drilldownButton: document.getElementById('bs-drilldown-btn')
    };

    let currentPoint = null;
    let currentMode = 'public';

    function isActive() {
        return Boolean(elements.sheet && elements.sheet.classList.contains('active'));
    }

    function updateButtons() {
        if (!currentPoint) {
            elements.primaryButton.hidden = true;
            elements.drilldownButton.hidden = true;
            return;
        }

        if (!AppState.detailModeAvailable) {
            elements.primaryButton.hidden = true;
        } else {
            elements.primaryButton.hidden = false;
            if (!AppState.detailAccess) {
                elements.primaryButton.textContent = '输入口令后查看';
            } else if (!AppState.detailModeEnabled) {
                elements.primaryButton.textContent = '查看同学信息';
            } else if (currentMode === 'detail') {
                elements.primaryButton.textContent = '重新加载';
            } else {
                elements.primaryButton.textContent = '查看同学信息';
            }
        }

        if (currentPoint.drilldownFile && !isActiveProvinceView()) {
            elements.drilldownButton.hidden = false;
            elements.drilldownButton.textContent = `进入 ${currentPoint.name} 地图详情`;
        } else {
            elements.drilldownButton.hidden = true;
        }
    }

    function open() {
        elements.sheet.classList.add('active');
        elements.overlay.classList.add('active');
    }

    function close() {
        elements.sheet.classList.remove('active');
        elements.overlay.classList.remove('active');
        currentMode = 'public';
    }

    function showPublic(point, options) {
        currentPoint = point;
        currentMode = 'public';
        elements.content.innerHTML = renderPublicCard(point, options);
        updateButtons();
        open();
    }

    function showLoading(point) {
        currentPoint = point;
        currentMode = 'loading';
        elements.content.innerHTML = renderLoadingCard(point);
        updateButtons();
        open();
    }

    function showDetail(point, payload) {
        currentPoint = point;
        currentMode = 'detail';
        elements.content.innerHTML = renderDetailCard(payload);
        updateButtons();
        open();
    }

    function hideSensitive() {
        if (!isActive() || !currentPoint) {
            return;
        }

        if (currentMode === 'detail' || currentMode === 'loading') {
            showPublic(currentPoint);
        }
    }

    async function handlePrimaryClick() {
        if (!currentPoint || !AppState.detailModeAvailable) {
            return;
        }

        if (!AppState.detailAccess) {
            AppState.pendingPoint = currentPoint;
            openAuthModal('输入口令后可查看这个地区的同学信息。');
            return;
        }

        AppState.detailModeEnabled = true;
        updateDetailsButton();
        updateInteractionNote();
        await showDetailSheetForPoint(currentPoint, currentMode === 'detail');
    }

    function handleDrilldownClick() {
        if (currentPoint && currentPoint.drilldownFile && !isActiveProvinceView()) {
            drillIntoProvince(currentPoint).catch(function(error) {
                console.error('Drilldown failed:', error);
            });
        }
    }

    function init() {
        elements.overlay.addEventListener('click', close);
        elements.primaryButton.addEventListener('click', function() {
            handlePrimaryClick().catch(function(error) {
                console.error('Bottom sheet primary action failed:', error);
            });
        });
        elements.drilldownButton.addEventListener('click', handleDrilldownClick);
    }

    return {
        init,
        isActive,
        close,
        showPublic,
        showLoading,
        showDetail,
        hideSensitive,
        getCurrentPoint: function() {
            return currentPoint;
        }
    };
})();

function setAuthFeedback(message, variant) {
    ui.authFeedback.textContent = message || '';
    if (variant === 'error' || variant === 'success') {
        ui.authFeedback.setAttribute('data-variant', variant);
    } else {
        ui.authFeedback.removeAttribute('data-variant');
    }
}

function openAuthModal(message) {
    ui.authOverlay.hidden = false;
    ui.authHint.textContent = AppState.detailsHint
        ? `口令提示：${AppState.detailsHint}`
        : '如忘记口令，请联系老师或同学。';
    setAuthFeedback(message || '', null);
    window.setTimeout(function() {
        ui.authInput.focus();
    }, 0);
}

function closeAuthModal() {
    ui.authOverlay.hidden = true;
    ui.authForm.reset();
    setAuthFeedback('', null);
    AppState.pendingPoint = null;
}

async function handleAuthSubmit(event) {
    event.preventDefault();

    const passphrase = ui.authInput.value.trim();
    if (!passphrase) {
        setAuthFeedback('请输入口令。', 'error');
        ui.authInput.focus();
        return;
    }

    ui.authSubmit.disabled = true;
    setAuthFeedback('正在确认口令...', null);

    try {
        await fetchJson('/api/auth/details', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: JSON.stringify({ passphrase: passphrase })
        });

        const pendingPoint = AppState.pendingPoint;
        AppState.detailAccess = true;
        AppState.detailModeEnabled = true;
        updateDetailsButton();
        updateInteractionNote();
        closeAuthModal();

        if (pendingPoint) {
            await showDetailSheetForPoint(pendingPoint, true);
        }
    } catch (error) {
        let message = normalizeApiErrorMessage(error, '暂时无法确认口令，请稍后再试。');
        if (
            error &&
            error.payload &&
            typeof error.payload.remainingAttempts === 'number' &&
            error.status === 401
        ) {
            message += ` 剩余 ${error.payload.remainingAttempts} 次尝试。`;
        }
        setAuthFeedback(message, 'error');
    } finally {
        ui.authSubmit.disabled = false;
    }
}

async function clearDetailSession() {
    try {
        await fetchJson('/api/auth/logout', {
            method: 'POST'
        });
    } catch (error) {
        console.warn('Failed to clear detail session:', error);
    }
}

function revokeDetailAccess(message) {
    AppState.detailAccess = false;
    AppState.detailModeEnabled = false;
    AppState.detailsCache.clear();
    updateDetailsButton();
    updateInteractionNote();
    BottomSheet.hideSensitive();

    clearDetailSession().catch(function(error) {
        console.warn('Failed to clear detail session:', error);
    });

    if (message) {
        AppState.pendingPoint = BottomSheet.getCurrentPoint();
        openAuthModal(message);
    }
}

async function fetchRegionDetails(point, forceRefresh) {
    const region = getPointRegion(point);
    if (!region.province) {
        throw new Error('这个地区暂时打不开，请重新点一次。');
    }
    const cacheKey = getRegionKey(region);

    if (!forceRefresh && AppState.detailsCache.has(cacheKey)) {
        return AppState.detailsCache.get(cacheKey);
    }

    const params = new URLSearchParams({ province: region.province });
    if (region.city) {
        params.set('city', region.city);
    }

    const payload = await fetchJson(`/api/map/details?${params.toString()}`);
    AppState.detailsCache.set(cacheKey, payload);
    return payload;
}

async function showDetailSheetForPoint(point, forceRefresh) {
    AppState.detailRequestVersion += 1;
    const requestVersion = AppState.detailRequestVersion;
    BottomSheet.showLoading(point);

    try {
        const payload = await fetchRegionDetails(point, forceRefresh);
        if (requestVersion !== AppState.detailRequestVersion) {
            return;
        }
        BottomSheet.showDetail(point, payload);
    } catch (error) {
        if (requestVersion !== AppState.detailRequestVersion) {
            return;
        }
        if (error && error.status === 401) {
            BottomSheet.showPublic(point, {
                callout: '已退出查看，请重新输入口令。',
                hideHint: true,
                hideEmpty: true
            });
            AppState.pendingPoint = point;
            revokeDetailAccess('已退出查看，请重新输入口令。');
            return;
        }

        console.error('Failed to load region details:', error);
        BottomSheet.showPublic(point, {
            callout: normalizeApiErrorMessage(error, '这个地区暂时打不开，请稍后再试。'),
            hideHint: true,
            hideEmpty: true
        });
    }
}

function showFatalError(message, title) {
    if (ui.errorTitle) {
        ui.errorTitle.textContent = title || '地图加载失败';
    }
    if (ui.errorMessage) {
        ui.errorMessage.textContent = message;
    }
    if (ui.error) {
        ui.error.style.display = 'flex';
    }
    hideMapLoading();
}

function normalizeApiErrorMessage(error, fallback) {
    if (error && error.payload && typeof error.payload.message === 'string' && error.payload.message) {
        return error.payload.message;
    }
    if (error && typeof error.message === 'string' && error.message) {
        return error.message;
    }
    return fallback;
}

async function fetchJson(url, init) {
    const requestInit = Object.assign({
        credentials: 'same-origin'
    }, init || {});

    const response = await fetch(url, requestInit);
    let payload = null;

    try {
        payload = await response.json();
    } catch (_error) {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(payload && payload.message ? payload.message : `Request failed with status ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

const PUBLIC_CACHE_KEY = 'class1forever:public:v1';

function readPublicCache() {
    try {
        const raw = localStorage.getItem(PUBLIC_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const cached = JSON.parse(raw);
        if (!cached || typeof cached !== 'object' || typeof cached.generatedAt !== 'string') {
            return null;
        }
        if (!cached.provinces || !cached.stats) {
            return null;
        }
        return cached;
    } catch (_error) {
        return null;
    }
}

function writePublicCache(data) {
    try {
        localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(data));
    } catch (_error) {
        // Storage may be unavailable (private mode / quota); cache is best-effort.
    }
}

function applyPublicData(data) {
    AppState.publicData = data;
    AppState.detailAccess = Boolean(data.detailAccess);
    AppState.detailModeAvailable = Boolean(data.detailModeAvailable);
    AppState.detailsHint = typeof data.detailsHint === 'string' ? data.detailsHint : '';
}

/* ------------------------------------------------------------------ *
 * 地图数据层
 * ------------------------------------------------------------------ */

const ProvinceMapLoader = (function() {
    const pending = {};

    function mapIdOf(filename) {
        return PROVINCE_MAP_PREFIX + filename;
    }

    function isRegistered(filename) {
        return Boolean(filename) && Boolean(CMapGeo.get(mapIdOf(filename)));
    }

    /**
     * 懒加载省级 GeoJSON，并顺带注册给 ECharts。
     * 同一份地图只会请求和注册一次。
     */
    function load(filename) {
        const mapId = mapIdOf(filename);
        const loaded = CMapGeo.get(mapId);
        if (loaded) {
            return Promise.resolve(loaded);
        }
        if (pending[filename]) {
            return pending[filename];
        }

        pending[filename] = new Promise(function(resolve, reject) {
            const script = document.createElement('script');
            script.src = 'js/province/' + filename + '.js';
            script.onload = function() {
                delete pending[filename];
                const geoJson = CMapGeo.get(mapId);
                if (!geoJson) {
                    reject(new Error('省级地图数据缺失：' + filename));
                    return;
                }
                echarts.registerMap(mapId, geoJson);
                resolve(geoJson);
            };
            script.onerror = function() {
                delete pending[filename];
                reject(new Error('省级地图加载失败：' + filename));
            };
            document.head.appendChild(script);
        });

        return pending[filename];
    }

    return {
        isRegistered: isRegistered,
        load: load
    };
})();

function buildProvinceCatalog() {
    const geoJson = CMapGeo.get(CHINA_MAP_ID);
    if (!geoJson || !Array.isArray(geoJson.features)) {
        throw new Error('缺少中国地图数据，请刷新页面重试。');
    }

    const catalog = {};
    geoJson.features.forEach(function(feature) {
        const properties = feature.properties || {};
        const name = normalizeRegionToken(properties.name);
        if (!name) {
            return;
        }
        if (!catalog[name]) {
            catalog[name] = {
                name: name,
                file: null,
                point: null,
                loading: false
            };
        }
        // 只有仓库里确实带省级地图的地区才允许下钻，
        // 台湾 / 香港 / 澳门 / 南海诸岛没有对应文件，点击时直接看聚合信息。
        if (CMapGeo.hasProvinceFile(properties.filename)) {
            catalog[name].file = properties.filename;
        }
    });

    return catalog;
}

function buildNationalPoints() {
    const summaries = (AppState.publicData && AppState.publicData.provinces) || {};

    return Object.keys(AppState.provinceCatalog).map(function(name) {
        const entry = AppState.provinceCatalog[name];
        const summary = summaries[name] || {};
        const point = entry.point || {
            name: name,
            province: name,
            city: null
        };

        point.value = Number(summary.count || 0);
        point.cityCount = Object.keys(summary.cities || {}).length;
        point.drilldownFile = entry.file;
        entry.point = point;

        return point;
    });
}

function buildProvincePoints(provinceName) {
    const entry = AppState.provinceCatalog[provinceName];
    if (!entry || !entry.file) {
        return [];
    }

    const geoJson = CMapGeo.get(PROVINCE_MAP_PREFIX + entry.file);
    if (!geoJson || !Array.isArray(geoJson.features)) {
        return [];
    }

    const summaries = (AppState.publicData && AppState.publicData.provinces) || {};
    const citySummary = (summaries[provinceName] || {}).cities || {};
    const seen = new Set();

    return geoJson.features.reduce(function(points, feature) {
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

function createRegionIndex(points) {
    const index = new Map();
    points.forEach(function(point) {
        index.set(point.name, point);
    });
    return index;
}

function resolveRegionPoint(name) {
    const regionName = normalizeRegionToken(name);
    if (!regionName) {
        return null;
    }

    const known = AppState.regionIndex.get(regionName);
    if (known) {
        return known;
    }

    // 兜底：数据点缺失时也保证面板能打开，只是没有聚合人数。
    const activeProvince = getActiveProvinceName();
    return {
        name: regionName,
        value: 0,
        province: activeProvince || regionName,
        city: activeProvince ? regionName : null,
        cityCount: 0,
        drilldownFile: null
    };
}

/* ------------------------------------------------------------------ *
 * 图表渲染
 * ------------------------------------------------------------------ */

const mapBoundsCache = new Map();

/**
 * 取某个地图在数据坐标系里的包围盒，用于限制平移范围。
 * 结果按地图缓存，避免每次拖动都遍历几何数据。
 */
function getMapBounds(mapId) {
    if (mapBoundsCache.has(mapId)) {
        return mapBoundsCache.get(mapId);
    }

    const geoJson = CMapGeo.get(mapId);
    let bounds = null;

    if (geoJson && Array.isArray(geoJson.features)) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        function visit(node) {
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
        }

        geoJson.features.forEach(function(feature) {
            if (feature && feature.geometry) {
                visit(feature.geometry.coordinates);
            }
        });

        if (minX !== Infinity && minY !== Infinity) {
            bounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
        }
    }

    mapBoundsCache.set(mapId, bounds);
    return bounds;
}

/** 数组与 Map 都有 forEach，这里同时支持两者。 */
function computeHeatMax(points) {
    let max = 0;
    points.forEach(function(point) {
        max = Math.max(max, Number(point.value) || 0);
    });

    return Math.max(1, Math.ceil(max));
}

/**
 * 底部色带图例由 ECharts visualMap 绘制：
 * 它同时负责上色，hoverLink 让鼠标停在某个省时在色带上标出对应人数。
 */
function buildVisualMapOption(points) {
    const max = computeHeatMax(points);

    return {
        type: 'continuous',
        min: 0,
        max: max,
        precision: 0,
        calculable: false,
        hoverLink: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 8,
        itemWidth: 13,
        itemHeight: 150,
        text: [`${max} 人`, '0 人'],
        textGap: 8,
        textStyle: {
            color: '#5c5650',
            fontFamily: "'Nunito', sans-serif",
            fontSize: 12,
            fontWeight: 600
        },
        indicatorIcon: 'circle',
        indicatorSize: '60%',
        indicatorStyle: {
            borderColor: HOVER_BORDER_COLOR,
            borderWidth: 2,
            shadowBlur: 4,
            shadowColor: 'rgba(45, 42, 38, 0.25)'
        },
        inRange: {
            color: HEAT_COLORS
        }
    };
}

function buildMapSeries(mapId, regionName, points, showLabels) {
    return {
        id: REGION_SERIES_ID,
        type: 'map',
        map: mapId,
        name: regionName,
        data: points,
        roam: true,
        // 数据已经是等距投影后的平面坐标（EPSG:3415 米制），
        // ECharts 默认的 0.75（为经纬度数据准备）会把地图纵向拉高 1/3。
        aspectScale: 1,
        // 切换省份时把缩放和中心点复位，回到自动铺满的效果
        zoom: BASE_ZOOM,
        center: null,
        scaleLimit: {
            min: BASE_ZOOM,
            max: ZOOM_MAX
        },
        selectedMode: false,
        // 区县级别标注很密，重叠时优先隐藏，避免文字糊成一团。
        labelLayout: {
            hideOverlap: true
        },
        label: {
            show: Boolean(showLabels),
            color: '#2d2a26',
            fontFamily: "'Nunito', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            // 浅色底不需要描边，深色地块上靠这圈细白边保持可读；
            // 描边再粗会把小字号字形糊掉。
            textBorderColor: 'rgba(255, 255, 255, 0.92)',
            textBorderWidth: 1
        },
        itemStyle: {
            areaColor: HEAT_COLORS[0],
            borderColor: BORDER_COLOR,
            borderWidth: 1
        },
        emphasis: {
            label: {
                show: true,
                color: '#ffffff',
                fontWeight: 700,
                textBorderColor: 'rgba(45, 42, 38, 0.55)',
                textBorderWidth: 2
            },
            itemStyle: {
                areaColor: HOVER_AREA_COLOR,
                borderColor: HOVER_BORDER_COLOR,
                borderWidth: 2,
                shadowBlur: 10,
                shadowColor: 'rgba(196, 112, 75, 0.35)'
            }
        }
    };
}

function buildChartOption() {
    return {
        backgroundColor: 'transparent',
        animationDuration: 320,
        tooltip: {
            show: !isTouchDevice,
            trigger: 'item',
            confine: true,
            className: 'map-tooltip',
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
            shadowBlur: 0,
            transitionDuration: 0.15,
            showDelay: 60,
            hideDelay: 60,
            extraCssText: 'box-shadow:none;background:transparent;border:0;padding:0;white-space:normal;',
            formatter: function(params) {
                const point = resolveRegionPoint(params && params.name);
                return point ? renderPublicCard(point, { compact: true }) : '';
            }
        },
        visualMap: buildVisualMapOption([]),
        series: [buildMapSeries(CHINA_MAP_ID, '中国', [], false)]
    };
}

function isActiveProvinceView() {
    return Boolean(getActiveProvinceName());
}

function updateMapChrome() {
    const provinceName = getActiveProvinceName();

    if (ui.regionBadge) {
        ui.regionBadge.textContent = provinceName || '中国';
    }
    if (ui.backButton) {
        ui.backButton.hidden = !provinceName;
    }
}

function applyMapView(view) {
    AppState.activeProvince = view.province || null;
    AppState.activeMapId = view.mapId;
    AppState.regionIndex = createRegionIndex(view.points);

    AppState.chart.setOption({
        series: [buildMapSeries(view.mapId, view.province || '中国', view.points, view.showLabels)],
        visualMap: buildVisualMapOption(view.points)
    });

    updateMapChrome();
    updateDetailsButton();
}

function refreshCurrentViewData() {
    const provinceName = getActiveProvinceName();
    const points = provinceName ? buildProvincePoints(provinceName) : buildNationalPoints();

    AppState.regionIndex = createRegionIndex(points);

    AppState.chart.setOption({
        series: [{
            id: REGION_SERIES_ID,
            data: points
        }],
        visualMap: buildVisualMapOption(points)
    });
}

function initChart() {
    const container = document.getElementById('map');
    if (!container) {
        throw new Error('页面缺少地图容器，请刷新页面重试。');
    }

    echarts.registerMap(CHINA_MAP_ID, CMapGeo.get(CHINA_MAP_ID));

    const chart = echarts.init(container, null, {
        renderer: 'canvas'
    });

    // tooltip 与动画等全局配置要先落到实例上，
    // 后续 applyMapView 只合并 series / visualMap。
    chart.setOption(buildChartOption());

    chart.on('click', handleRegionClick);
    // 拖动/滚轮改变视野后立刻纠偏，避免把地图拖出可视区域。
    chart.on('georoam', clampMapRoam);
    AppState.chart = chart;

    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(function() {
            chart.resize();
        }).observe(container);
    } else {
        window.addEventListener('resize', function() {
            chart.resize();
        });
    }

    return chart;
}

function getCurrentMapView() {
    const option = AppState.chart ? AppState.chart.getOption() : null;
    const series = option && Array.isArray(option.series) ? option.series[0] : null;

    return {
        zoom: series && typeof series.zoom === 'number' && series.zoom > 0 ? series.zoom : 1,
        center: series && Array.isArray(series.center) ? series.center : null
    };
}

/**
 * 把地图拉回可视区域：缩放到「刚好铺满」时强制居中，放大后不允许露出背景。
 */
function clampMapRoam() {
    const chart = AppState.chart;
    if (!chart || AppState.clampingRoam) {
        return;
    }

    const bounds = getMapBounds(AppState.activeMapId);
    const width = chart.getWidth();
    const height = chart.getHeight();
    if (!bounds || !width || !height) {
        return;
    }

    const cornerA = chart.convertToPixel({ seriesIndex: 0 }, [bounds.minX, bounds.minY]);
    const cornerB = chart.convertToPixel({ seriesIndex: 0 }, [bounds.maxX, bounds.maxY]);
    if (!cornerA || !cornerB) {
        return;
    }

    const left = Math.min(cornerA[0], cornerB[0]);
    const right = Math.max(cornerA[0], cornerB[0]);
    const top = Math.min(cornerA[1], cornerB[1]);
    const bottom = Math.max(cornerA[1], cornerB[1]);
    const mapWidth = right - left;
    const mapHeight = bottom - top;

    let offsetX = 0;
    let offsetY = 0;

    if (mapWidth <= width) {
        offsetX = width / 2 - (left + mapWidth / 2);
    } else if (left > 0) {
        offsetX = -left;
    } else if (right < width) {
        offsetX = width - right;
    }

    if (mapHeight <= height) {
        offsetY = height / 2 - (top + mapHeight / 2);
    } else if (top > 0) {
        offsetY = -top;
    } else if (bottom < height) {
        offsetY = height - bottom;
    }

    if (Math.abs(offsetX) < ROAM_TOLERANCE_PX && Math.abs(offsetY) < ROAM_TOLERANCE_PX) {
        return;
    }

    const view = getCurrentMapView();
    const anchor = view.center || [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    const anchorPixel = chart.convertToPixel({ seriesIndex: 0 }, anchor);
    if (!anchorPixel) {
        return;
    }

    // offsetX/offsetY 是要让地图内容移动的距离，而中心的像素位置要朝相反方向移动。
    const shiftedPixel = [anchorPixel[0] - offsetX, anchorPixel[1] - offsetY];
    // 已经是最小比例时交还给 ECharts 的自动居中，避免长期保留一个手算的中心点。
    const nextCenter = view.zoom <= BASE_ZOOM + 1e-6
        ? null
        : chart.convertFromPixel({ seriesIndex: 0 }, shiftedPixel);

    AppState.clampingRoam = true;
    try {
        chart.setOption({
            series: [{
                id: REGION_SERIES_ID,
                zoom: view.zoom,
                center: nextCenter
            }]
        });
    } finally {
        AppState.clampingRoam = false;
    }
}

function applyMapZoom(multiplier) {
    if (!AppState.chart) {
        return;
    }

    const current = getCurrentMapView();
    const nextZoom = Math.min(Math.max(current.zoom * multiplier, BASE_ZOOM), ZOOM_MAX);
    if (Math.abs(nextZoom - current.zoom) < 1e-3) {
        return;
    }

    AppState.chart.setOption({
        series: [{
            id: REGION_SERIES_ID,
            zoom: nextZoom,
            center: nextZoom <= BASE_ZOOM + 1e-6 ? null : current.center
        }]
    });

    clampMapRoam();
}

function resetMapZoom() {
    if (!AppState.chart) {
        return;
    }

    AppState.chart.setOption({
        series: [{
            id: REGION_SERIES_ID,
            zoom: BASE_ZOOM,
            center: null
        }]
    });
}

async function drillIntoProvince(point) {
    const filename = point && point.drilldownFile;
    if (!filename || point.loading) {
        return;
    }

    point.loading = true;
    AppState.detailRequestVersion += 1;
    BottomSheet.close();
    showProvinceLoading(point.name);

    try {
        await ProvinceMapLoader.load(filename);
        hideMapLoading();
        applyMapView({
            mapId: PROVINCE_MAP_PREFIX + filename,
            province: point.name,
            points: buildProvincePoints(point.name),
            showLabels: true
        });
    } catch (error) {
        hideMapLoading();
        console.error('Failed to load province map:', error);
        BottomSheet.showPublic(point, {
            callout: '省级地图加载失败，请重试。',
            hideHint: true,
            hideEmpty: true
        });
    } finally {
        point.loading = false;
    }
}

function drillUpToCountry() {
    if (!isActiveProvinceView()) {
        return;
    }

    AppState.detailRequestVersion += 1;
    BottomSheet.close();
    applyMapView({
        mapId: CHINA_MAP_ID,
        province: null,
        points: buildNationalPoints(),
        showLabels: false
    });
    updateInteractionNote();
}

function handleRegionClick(params) {
    if (!params || params.componentType !== 'series') {
        return;
    }

    const point = resolveRegionPoint(params.name);
    if (!point) {
        return;
    }

    // 桌面端未开启详情模式时，点击省份可以直接下钻；移动端统一先看聚合面板。
    const canDrill = Boolean(point.drilldownFile) && !isActiveProvinceView();
    if (canDrill && !isTouchDevice && !AppState.detailModeEnabled) {
        drillIntoProvince(point).catch(function(error) {
            console.error('Drilldown failed:', error);
        });
        return;
    }

    if (AppState.detailModeEnabled && AppState.detailAccess) {
        showDetailSheetForPoint(point, false).catch(function(error) {
            console.error('Failed to show detail sheet for point:', error);
        });
        return;
    }

    BottomSheet.showPublic(point);
}

function updateDetailsButton() {
    if (!ui.detailsButton) {
        return;
    }

    if (!AppState.detailModeAvailable) {
        ui.detailsButton.hidden = true;
        return;
    }

    ui.detailsButton.hidden = false;
    ui.detailsButton.dataset.active = AppState.detailModeEnabled ? 'true' : 'false';
    ui.detailsButton.textContent = AppState.detailModeEnabled ? '退出查看' : '同学信息';
    ui.detailsButton.setAttribute(
        'aria-label',
        AppState.detailAccess
            ? (AppState.detailModeEnabled ? '退出查看' : '开启查看')
            : '输入口令后开启查看'
    );
}

function updateInteractionNote() {
    if (!ui.note) {
        return;
    }

    if (!AppState.publicData) {
        ui.note.textContent = '地图公开数据加载中...';
        return;
    }

    const stats = AppState.publicData.stats || {};
    const prefix = `当前共覆盖 ${Number(stats.provinces || 0)} 个省级区域、${Number(stats.cities || 0)} 座城市，共 ${Number(stats.total || 0)} 位同学。`;

    if (!AppState.detailModeAvailable) {
        ui.note.textContent = `${prefix} 现在先看看各地人数。`;
        return;
    }

    if (!AppState.detailAccess) {
        ui.note.textContent = `${prefix} 地图上先看人数，输入口令后可查看各地同学信息。`;
        return;
    }

    if (AppState.detailModeEnabled) {
        ui.note.textContent = `${prefix} 现在可以点地区查看同学信息；想继续进入省内地图，请用下方按钮。`;
        return;
    }

    ui.note.textContent = `${prefix} 已确认口令，点击“同学信息”即可查看各地区的同学信息。`;
}

function toggleDetailMode() {
    if (!AppState.detailModeAvailable) {
        return;
    }

    if (!AppState.detailAccess) {
        AppState.pendingPoint = null;
        openAuthModal('输入口令后即可查看同学信息。');
        return;
    }

    if (AppState.detailModeEnabled) {
        // 退出查看 = 结束口令会话：清除 Cookie 与本地缓存，再次查看需重新输入口令。
        AppState.detailModeEnabled = false;
        AppState.detailAccess = false;
        AppState.detailsCache.clear();
        updateDetailsButton();
        updateInteractionNote();
        BottomSheet.hideSensitive();
        clearDetailSession().catch(function(error) {
            console.warn('Failed to clear detail session:', error);
        });
        return;
    }

    AppState.detailModeEnabled = true;
    updateDetailsButton();
    updateInteractionNote();

    const currentPoint = BottomSheet.getCurrentPoint();
    if (BottomSheet.isActive() && currentPoint) {
        showDetailSheetForPoint(currentPoint, false).catch(function(error) {
            console.error('Failed to refresh detail sheet after enabling detail mode:', error);
        });
    }
}

function renderMapFromData() {
    applyMapView({
        mapId: CHINA_MAP_ID,
        province: null,
        points: buildNationalPoints(),
        showLabels: false
    });
    updateInteractionNote();
    hideMapLoading();
}

async function loadApp() {
    const cached = readPublicCache();
    let renderedFromCache = false;

    if (cached) {
        try {
            applyPublicData(cached);
            renderMapFromData();
            renderedFromCache = true;
        } catch (error) {
            console.warn('Failed to render cached map data:', error);
        }
    }

    try {
        const fresh = await fetchJson('/api/map/public');
        writePublicCache(fresh);
        const cacheIsStale = !renderedFromCache || !cached || cached.generatedAt !== fresh.generatedAt;

        applyPublicData(fresh);

        if (!renderedFromCache) {
            renderMapFromData();
            return;
        }

        if (cacheIsStale) {
            refreshCurrentViewData();
        }

        updateDetailsButton();
        updateInteractionNote();
    } catch (error) {
        if (renderedFromCache) {
            console.warn('Failed to refresh public map data:', error);
            return;
        }
        console.error('Failed to initialize map application:', error);
        showFatalError(normalizeApiErrorMessage(error, '无法加载地图数据，请稍后重试。'));
    }
}

function setupStaticUi() {
    updateDetailsButton();
    updateInteractionNote();

    if (ui.detailsButton) {
        ui.detailsButton.addEventListener('click', toggleDetailMode);
    }

    if (ui.backButton) {
        ui.backButton.addEventListener('click', drillUpToCountry);
    }

    if (ui.zoomIn) {
        ui.zoomIn.addEventListener('click', function() {
            applyMapZoom(1.35);
        });
    }

    if (ui.zoomOut) {
        ui.zoomOut.addEventListener('click', function() {
            applyMapZoom(1 / 1.35);
        });
    }

    if (ui.zoomReset) {
        ui.zoomReset.addEventListener('click', resetMapZoom);
    }

    if (ui.authForm) {
        ui.authForm.addEventListener('submit', function(event) {
            handleAuthSubmit(event).catch(function(error) {
                console.error('Auth submit failed:', error);
                setAuthFeedback('暂时无法确认口令，请稍后再试。', 'error');
            });
        });
    }

    if (ui.authClose) {
        ui.authClose.addEventListener('click', closeAuthModal);
    }

    if (ui.authOverlay) {
        ui.authOverlay.addEventListener('click', function(event) {
            if (event.target === ui.authOverlay) {
                closeAuthModal();
            }
        });
    }

    document.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape') {
            return;
        }

        if (ui.authOverlay && !ui.authOverlay.hidden) {
            closeAuthModal();
            return;
        }

        if (BottomSheet.isActive()) {
            BottomSheet.close();
            return;
        }

        drillUpToCountry();
    });
}

const ShareManager = (function() {
    function calculateStats() {
        const stats = (AppState.publicData && AppState.publicData.stats) || {};
        return {
            total: Number(stats.total || 0),
            provinces: Number(stats.provinces || 0),
            cities: Number(stats.cities || 0)
        };
    }

    /** 取当前地图画面，供分享图复用。 */
    function captureMapSnapshot() {
        const chart = AppState.chart;
        if (!chart) {
            throw new Error('地图尚未加载完成');
        }

        chart.dispatchAction({ type: 'hideTip' });

        return chart.getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: SNAPSHOT_BACKGROUND
        });
    }

    function loadImage(src) {
        return new Promise(function(resolve, reject) {
            const image = new Image();
            image.onload = function() {
                resolve(image);
            };
            image.onerror = function() {
                reject(new Error('地图画面解析失败'));
            };
            image.src = src;
        });
    }

    function roundRect(ctx, x, y, width, height, radius, fill, stroke, corners) {
        const cornerValues = corners || [radius, radius, radius, radius];
        const tl = cornerValues[0];
        const tr = cornerValues[1];
        const br = cornerValues[2];
        const bl = cornerValues[3];

        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + width - tr, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
        ctx.lineTo(x + width, y + height - br);
        ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
        ctx.lineTo(x + bl, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
        ctx.lineTo(x, y + tl);
        ctx.quadraticCurveTo(x, y, x + tl, y);
        ctx.closePath();

        if (fill) {
            ctx.fill();
        }
        if (stroke) {
            ctx.stroke();
        }
    }

    async function generateImage() {
        const stats = calculateStats();
        const mapImage = await loadImage(captureMapSnapshot());

        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 1100;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#faf7f2';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 150);
        gradient.addColorStop(0, '#e8a87c');
        gradient.addColorStop(1, '#c4704b');
        ctx.fillStyle = gradient;
        roundRect(ctx, 0, 0, canvas.width, 150, 24, true, false);

        ctx.fillStyle = '#ffffff';
        ctx.font = '42px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('金鹰1班蹭饭地图', canvas.width / 2, 55);

        ctx.font = '18px Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText('探索各地同学的足迹', canvas.width / 2, 105);

        ctx.drawImage(mapImage, 0, 150, 1200, 800);

        ctx.fillStyle = '#fffaf5';
        ctx.fillRect(0, 950, canvas.width, 100);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(String(stats.total), 200, 990);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('总人数', 200, 1020);

        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(String(stats.provinces), 600, 990);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('覆盖省份', 600, 1020);

        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(String(stats.cities), 1000, 990);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('覆盖城市', 1000, 1020);

        ctx.fillStyle = '#f5efe6';
        roundRect(ctx, 0, 1050, canvas.width, 50, 0, true, false, [0, 0, 24, 24]);

        ctx.fillStyle = '#5c5650';
        ctx.font = '14px Arial, sans-serif';
        ctx.fillText('万州二中 · 金鹰1班', canvas.width / 2, 1075);

        return new Promise(function(resolve, reject) {
            canvas.toBlob(function(blob) {
                if (blob) {
                    resolve(blob);
                    return;
                }
                reject(new Error('生成图片失败'));
            }, 'image/png', 0.95);
        });
    }

    function downloadImage(blob, filename) {
        const finalName = filename || `蹭饭地图_${new Date().toISOString().slice(0, 10)}.png`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = finalName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function shareToSocial(blob) {
        downloadImage(blob);
        return true;
    }

    async function handleShare() {
        const button = document.getElementById('share-btn');
        if (!button) {
            return;
        }

        button.classList.add('loading');
        button.disabled = true;

        try {
            const blob = await generateImage();
            await shareToSocial(blob);
        } catch (error) {
            console.error('生成分享图片失败:', error);
            alert('生成分享图片失败，请稍后重试');
        } finally {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    function init() {
        const button = document.getElementById('share-btn');
        if (button) {
            button.addEventListener('click', function() {
                handleShare().catch(function(error) {
                    console.error('Share action failed:', error);
                });
            });
        }
    }

    return {
        init,
        generateImage,
        downloadImage,
        shareToSocial
    };
})();

function initializeApp() {
    try {
        AppState.provinceCatalog = buildProvinceCatalog();
        initChart();
    } catch (error) {
        console.error('Failed to initialize map:', error);
        showFatalError(normalizeApiErrorMessage(error, '地图初始化失败，请刷新页面重试。'));
        return;
    }

    updateMapChrome();
    setupStaticUi();
    BottomSheet.init();
    ShareManager.init();
    loadApp();
}

initializeApp();

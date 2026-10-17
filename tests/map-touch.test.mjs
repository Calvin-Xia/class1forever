/**
 * @fileoverview 真浏览器手势语义回归：轻点下钻、长按 / 右键 / 轻点台湾开面板且**保持打开**、
 * 「地区一览」键盘等价。
 *
 * 为什么必须是真 Chromium：这类缺陷（触摸结束时浏览器补发的原生 click 落在刚刚盖上的遮罩上，
 * 把面板立刻关掉）只存在于「触摸事件 → 浏览器合成鼠标事件 → click」这条浏览器内部时序里，
 * jsdom / 手工 dispatchEvent 都复现不出来；它已经复发两次（`docs/parity-touch-compare.md`
 * 的 F-P1 与 2026-10-17 的推翻裁定）。
 *
 * 运行形态与 `tests/api-contract.test.mjs` 一致：自己起本地 Worker
 * （`scripts/local-runtime.mjs` 从 `dist/` 派生配置 + 隔离 state 目录 + 演示口令 `demo`），
 * 不读 `.dev.vars`，不需要 Cloudflare 凭据。
 *
 * 触摸事件怎么发（Playwright 只有瞬时 tap，没有长按 API）：
 * - 轻点 = `page.touchscreen.tap`（touchStart/touchEnd 同一 tick，时长 < 300ms）；
 * - 长按 = CDP `Input.dispatchTouchEvent` 原生触摸：touchStart → **真等 600ms** → touchEnd。
 *   用 `setTimeout` 伪造 DOM touch 事件是抓不到浏览器合成 click 的，必须让浏览器真的经历
 *   一次 600ms 的触摸，这条断言才有意义。
 *
 * 端口：8893（本文件专用；其余占用见 `tests/api-contract.test.mjs` 顶部端口表），可用
 * `TOUCH_TEST_PORT` 覆盖。本地 KV 用独立的 `.wrangler/local/state-touch`，与 `test:api`
 * 的 `state-test` 分开（同一个 miniflare SQLite 只允许一个写者）。
 *
 * 前置条件：先 `npm run build`（需要 `dist/`），再 `npx playwright install --with-deps chromium`。
 * 这两步在 `.github/workflows/ci.yml` 的 `test:touch` 前完成。
 * 本机若已有 Chromium，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path>` 指定，避免重复下载。
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    LOCAL_TEST_STATE_DIR,
    prepareLocalRuntime,
    startLocalServer
} from '../scripts/local-runtime.mjs';

const PORT = Number(process.env.TOUCH_TEST_PORT || 8893);
const TOUCH_STATE_DIR = path.join(path.dirname(LOCAL_TEST_STATE_DIR), 'state-touch');

/** 可下钻的候选省：夹具里有数据、`js/province/*.js` 里有地图文件（白名单内）。 */
const DRILLABLE_CANDIDATES = ['北京', '浙江', '四川'];
/** 不可下钻的地区：中国 GeoJSON 里有它，仓库里没有省级地图文件。 */
const NON_DRILLABLE_REGION = '台湾';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
/** 与 `.wrangler/parity/probe-touch-taiwan-tap.mjs` 同一套触摸仿真参数。 */
const TOUCH_VIEWPORT = { width: 390, height: 844 };

/** 长按用例的按压时长：> HOLD_MIN_MS(300)、< MAX_DURATION_MS(2000)。 */
const HOLD_MS = 600;
/** 「面板必须保持打开」的观察窗：跨过浏览器补发 click 的时间，再确认一次。 */
const SHEET_EARLY_WAIT_MS = 250;
const SHEET_SETTLE_WAIT_MS = 1000;

/**
 * `__mapProbe.regionPixels()` 的取样参数与重试上限。
 *
 * 为什么要有界重试：探针的网格扫描是「先取一次容器 rect、再用 `elementFromPoint` 逐点过滤」，
 * 字体换入会把 `.map-frame` 往下推，扫描期间发生布局位移就会把绝大多数像素判成「不在容器里」——
 * 实测首扫经常只剩 2~4 个 key（全量 34）且目标地区直接缺席，250ms 后重扫一律 34/34。
 * 这是**取样**的时序问题，和被测语义无关，所以修在测试侧（不改断言强度）。
 */
const SCAN_STEP = 6;
const SCAN_FINE_STEP = 2;
const SCAN_ATTEMPTS = 5;
const SCAN_INTERVAL_MS = 150;
/** 字体就绪等待的超时兜底：CI 上绝不能因为字体迟迟不 ready 而卡死。 */
const FONTS_READY_TIMEOUT_MS = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser;
let server;
let base;

/**
 * 起 Chromium。浏览器不进 `npm ci`（Playwright 的浏览器是 `playwright install` 单独装的），
 * 所以这里把「缺依赖」翻译成一条能直接照做的报错，而不是 ERR_MODULE_NOT_FOUND。
 */
async function launchBrowser() {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch (error) {
        throw new Error(
            '缺少 playwright：先 `npm install`（devDependency），再 `npx playwright install --with-deps chromium`。' +
                `原始错误：${(error && error.message) || error}`
        );
    }

    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}

before(async () => {
    browser = await launchBrowser();
    const { configPath, persistTo } = await prepareLocalRuntime({ reset: true, stateDir: TOUCH_STATE_DIR });
    server = await startLocalServer({ port: PORT, configPath, persistTo });
    base = server.url;
});

after(async () => {
    if (browser) {
        await browser.close();
    }
    if (server) {
        server.stop();
    }
});

/* ------------------------------------------------------------------ *
 * 页面与探针
 * ------------------------------------------------------------------ */

/** 新开一个上下文 + 页面并等岛屿就绪；`touch: true` 用移动触摸仿真。 */
async function openPage(options = {}) {
    const context = await browser.newContext(
        options.touch
            ? { viewport: TOUCH_VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
            : { viewport: DESKTOP_VIEWPORT }
    );
    const page = await context.newPage();
    const cdp = options.touch ? await context.newCDPSession(page) : null;
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

    await bootSite(page);
    assert.deepEqual(pageErrors, [], `页面在启动期间抛了未捕获异常：${JSON.stringify(pageErrors)}`);
    return { context, page, cdp, pageErrors };
}

async function bootSite(page) {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () =>
            Boolean(
                window.__mapProbe &&
                    window.__dialogsProbe &&
                    window.__mapProbe.read().booted &&
                    window.__mapProbe.read().viewPointCount > 0 &&
                    window.__dialogsProbe.read().booted
            ),
        null,
        { timeout: 30000 }
    );
    await waitForFontsReady(page);
    await settle(page);
}

/**
 * 等网页字体就绪（带超时兜底）。
 *
 * 为什么必须等：字体换入会改变页面高度、把地图框往下推。`__mapProbe.regionPixels()` 先在函数
 * 开头取一次容器 `getBoundingClientRect()`，之后再用**实时**的 `elementFromPoint` 过滤，所以
 * 扫描期间一旦发生位移，绝大多数坐标都会落到容器外 —— 首扫退化成 2~4 个 key（全量 34），
 * 目标地区缺席。实测：注释掉这次等待，台湾/北京的首扫会间歇性找不到；`document.fonts.ready`
 * 之后稳定 34/34（T6 独立复现：6 个新页 5 个退化，250ms 后重试 6/6 全量）。
 *
 * 超时只给兜底（不抛错）：字体加载失败时仍然往下走，真正的保险是下面 `regionPixel()` 的有界重试。
 */
async function waitForFontsReady(page, timeoutMs = FONTS_READY_TIMEOUT_MS) {
    await page
        .waitForFunction(() => !document.fonts || document.fonts.status === 'loaded', null, { timeout: timeoutMs })
        .catch(() => {
            /* 超时兜底：不让 CI 因为字体卡死；重试逻辑会继续补救。 */
        });
    // status 变 loaded 与「用了这些字体的布局落定」之间还差一帧，再显式等一次 ready。
    await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }
    });
}

/** 等图表尺寸 / 缩放 / 视野 / 数据点数稳定（动画与 resize 都停下来）。 */
async function settle(page, stableFor = 250, timeoutMs = 15000) {
    const started = Date.now();
    let last = null;
    let lastChange = Date.now();

    while (Date.now() - started < timeoutMs) {
        const snapshot = await page.evaluate(() => {
            const readings = window.__mapProbe.read();
            return {
                w: readings.chartWidth,
                h: readings.chartHeight,
                z: readings.zoom,
                m: readings.activeMapId,
                n: readings.viewPointCount
            };
        });
        const key = `${snapshot.w}x${snapshot.h}@${snapshot.z}#${snapshot.m}:${snapshot.n}`;
        if (key !== last) {
            last = key;
            lastChange = Date.now();
        } else if (Date.now() - lastChange >= stableFor) {
            return snapshot;
        }
        await sleep(120);
    }

    return last;
}

function readMap(page) {
    return page.evaluate(() => window.__mapProbe.read());
}

function readDialogs(page) {
    return page.evaluate(() => window.__dialogsProbe.read());
}

function readActivations(page) {
    return page.evaluate(() => window.__mapProbe.read().activations);
}

/** 本次手势产生的激活记录（探针只保留最近 20 条，按名字 + 时间窗过滤）。 */
function activationsFor(entries, name, since) {
    return entries.filter((entry) => entry.name === name && entry.at >= since);
}

/**
 * 探针给的可点像素里，挑一个 `hitTest` 复核确实是该地区的。
 *
 * 有界重试（最多 `SCAN_ATTEMPTS` 次、每次间隔 `SCAN_INTERVAL_MS`）：首扫可能在字体/布局
 * 落定之前发生而退化（见 `waitForFontsReady()` 的说明）。重试只影响**取样**，命中即返回，
 * 所有语义断言原样不变；耗尽后抛出的错误会带上实际 keyCount 与命中的地区列表，便于一眼定位。
 */
async function regionPixel(page, name) {
    let lastKeyCount = 0;
    let lastKeys = [];

    for (let attempt = 1; attempt <= SCAN_ATTEMPTS; attempt += 1) {
        const pixels = await page.evaluate(
            (steps) => window.__mapProbe.regionPixels(steps.step, steps.fineStep),
            { step: SCAN_STEP, fineStep: SCAN_FINE_STEP }
        );
        lastKeys = Object.keys(pixels);
        lastKeyCount = lastKeys.length;

        for (const candidate of (pixels[name] || []).slice(0, 4)) {
            const hit = await page.evaluate((point) => window.__mapProbe.hitTest(point.x, point.y), candidate);
            if (hit === name) {
                return candidate;
            }
        }

        if (attempt < SCAN_ATTEMPTS) {
            await sleep(SCAN_INTERVAL_MS);
        }
    }

    throw new Error(
        `探针找不到「${name}」的可点像素：${SCAN_ATTEMPTS} 次扫描（step=${SCAN_STEP}、fineStep=${SCAN_FINE_STEP}，` +
            `每次间隔 ${SCAN_INTERVAL_MS}ms）后仍未命中。最后一次扫描 keyCount=${lastKeyCount}，` +
            `命中的地区=[${lastKeys.join('、')}]`
    );
}

/** 当前视野里一个有省级地图文件的地区 + 它的可点像素。 */
async function drillableTarget(page) {
    const points = await page.evaluate(() => window.__mapProbe.points());
    const reasons = [];

    for (const name of DRILLABLE_CANDIDATES) {
        const point = points.find((item) => item.name === name);
        if (!point || !point.drilldownFile) {
            reasons.push(`${name}: 视野里没有可下钻的数据点`);
            continue;
        }
        try {
            return { name, pixel: await regionPixel(page, name) };
        } catch (error) {
            reasons.push(`${name}: ${error.message}`);
        }
    }

    throw new Error(`找不到可下钻的候选省：${reasons.join('；')}`);
}

/** final state：断言「桌面左键」与「触摸轻点」等价时只比这两个字段。 */
async function finalState(page) {
    const [readings, dialogs] = await Promise.all([readMap(page), readDialogs(page)]);
    return { activeProvince: readings.activeProvince, sheetActive: dialogs.sheetActive };
}

/**
 * 地图上「空白处」的一个像素：`elementFromPoint` 落在 `#map` 里，但射线法判定不属于任何地区。
 *
 * 用途（T13 回归）：在空白处轻点只会**开启触摸窗口**（`handleTouchStart` 就记了
 * `lastTouchGestureAt`），不会下钻、不会开面板，因此紧接着的那次鼠标点击读数不会被别的
 * 激活污染 —— 这正是「窗口内鼠标左键有没有被让位守卫吞掉」的干净实验台。
 */
async function blankMapPixel(page) {
    return page.evaluate(() => {
        const map = document.getElementById('map');
        if (!map) {
            return null;
        }
        const rect = map.getBoundingClientRect();
        const step = 12;
        let probes = 0;

        for (let y = Math.ceil(rect.top / step) * step; y < rect.bottom && probes < 600; y += step) {
            for (let x = Math.ceil(rect.left / step) * step; x < rect.right && probes < 600; x += step) {
                probes += 1;
                const element = document.elementFromPoint(x, y);
                if (!element || !map.contains(element)) {
                    continue;
                }
                if (window.__mapProbe.hitTest(x, y) === null) {
                    return { x, y, probes };
                }
            }
        }
        return null;
    });
}

/** 加载层（T9 之后它挂在 .map-frame 下，`#map` 的兄弟节点）的当前快照。 */
function readLoadingElement(page) {
    return page.evaluate(() => {
        const element = document.getElementById('map-loading');
        const map = document.getElementById('map');
        if (!element) {
            return { exists: false };
        }
        return {
            exists: true,
            ariaHidden: element.getAttribute('aria-hidden'),
            insideMap: Boolean(map && map.contains(element)),
            display: getComputedStyle(element).display,
            text: (element.textContent || '').replace(/\s+/g, ' ').trim()
        };
    });
}

/** 记录加载层的时间线（display / 文案），用来断言「下钻期间确实可见过」。 */
function installLoadingRecorder(page) {
    return page.evaluate(() => {
        const element = document.getElementById('map-loading');
        const snapshot = () => ({
            at: Date.now(),
            display: element ? getComputedStyle(element).display : null,
            text: element ? (element.textContent || '').replace(/\s+/g, ' ').trim() : null
        });

        window.__loadingLog = [snapshot()];
        if (element) {
            new MutationObserver(() => window.__loadingLog.push(snapshot())).observe(element, {
                attributes: true,
                attributeFilter: ['style'],
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    });
}

function readLoadingLog(page) {
    return page.evaluate(() => window.__loadingLog || []);
}

/**
 * 记录 ECharts 自己派发了几次 `click`（只读观察者，和手势轨迹一样）。
 *
 * 用途：分清「鼠标点击被我们的让位守卫吞掉」和「点击根本没到图表」。前者只可能发生在
 * `handleRegionClick` 里（`chart.on('click')` 之后），后者连 `chart.on('click')` 都不会触发 ——
 * 两者对用户的观感一样（没反应），但对「该改谁的代码」是完全不同的结论。
 */
function installChartClickCounter(page) {
    return page.evaluate(() => {
        window.__chartClicks = [];
        const chart = window.__mapProbe.state().chart;
        if (chart) {
            chart.on('click', (params) => {
                window.__chartClicks.push({
                    at: Date.now(),
                    name: params.name || null,
                    componentType: params.componentType || null
                });
            });
        }
    });
}

function readChartClicks(page) {
    return page.evaluate(() => window.__chartClicks || []);
}

/* ------------------------------------------------------------------ *
 * 手势
 * ------------------------------------------------------------------ */

function touchPoint(pixel) {
    return { id: 0, x: pixel.x, y: pixel.y, radiusX: 6, radiusY: 6, force: 1 };
}

/** 瞬时轻触：触摸时长 ≈ 0ms，落进 TapFallback 的 <300ms 轻触分支。 */
async function tapRegion(page, pixel) {
    await page.touchscreen.tap(pixel.x, pixel.y);
}

/**
 * 原生长按：CDP touchStart → 真等 holdMs 毫秒 → touchEnd。
 * `onHold` 在按住 ≥300ms 之后、松手之前执行（用来观察按压反馈），返回值原样返回。
 */
async function holdRegion(cdp, pixel, holdMs, onHold) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(pixel)] });

    const probeAt = Math.max(320, holdMs - 150);
    await sleep(probeAt);
    const mid = onHold ? await onHold() : null;
    await sleep(Math.max(0, holdMs - probeAt));

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return mid;
}

function readPressRing(page) {
    return page.evaluate(() => {
        const ring = document.getElementById('map-press-ring');
        return ring ? { visible: ring.getAttribute('data-visible'), left: ring.style.left, top: ring.style.top } : null;
    });
}

/* ------------------------------------------------------------------ *
 * 手势轨迹（只为「恰好一条激活」失败时取证，纯测试代码）
 *
 * 一旦出现第二条激活，要报的证据是：两次激活的 {at, source}、activeMapId 什么时候换的、
 * 那条迟到 click 落下时 #map-loading 这个吸收层还在不在、以及这次触摸的 startAt/endAt。
 * 页面里的 Date.now() 与 Node 同钟，时间戳可以直接和 activations 的 at 对齐，所以轨迹记在页面侧。
 * ------------------------------------------------------------------ */

function installGestureTrace(page) {
    return page.evaluate(() => {
        const trace = { installedAt: Date.now(), events: [] };
        window.__gestureTrace = trace;
        const push = (kind, detail) => {
            trace.events.push({ at: Date.now(), kind, ...detail });
        };

        const loading = document.getElementById('map-loading');
        // 注意：echarts.init() 会走 zrender Painter 的 `root.innerHTML = ''`
        // （zrender/lib/canvas/Painter.js:114），把静态的 #map-loading 从 #map 里删掉。
        // 所以图表就绪后这个吸收层**不存在**——「迟到 click 被加载层挡住」是不成立的，
        // 真正挡住它的是 tap-fallback 的 ownsTouchGesture() 让位守卫。这里如实记录存在性。
        push('map-loading', {
            exists: Boolean(loading),
            inline: loading ? loading.style.display : null,
            computed: loading ? getComputedStyle(loading).display : null
        });
        if (loading) {
            new MutationObserver(() => {
                push('map-loading', {
                    exists: true,
                    inline: loading.style.display,
                    computed: getComputedStyle(loading).display
                });
            }).observe(loading, { attributes: true, attributeFilter: ['style'] });
        }

        // 浏览器在 touchend 之后补发的 click / contextmenu：它们**确实会派发**，
        // 让位守卫有没有生效就看 activations 里有没有多出来的 'map' / 'right-click'。
        for (const name of ['click', 'contextmenu']) {
            document.addEventListener(
                name,
                (event) => {
                    const target = event.target;
                    push(name, {
                        x: Math.round(event.clientX || 0),
                        y: Math.round(event.clientY || 0),
                        target: (target && (target.id || target.className || target.tagName)) || null,
                        defaultPrevented: event.defaultPrevented
                    });
                },
                { capture: true, passive: true }
            );
        }

        for (const name of ['touchstart', 'touchend', 'touchcancel']) {
            document.addEventListener(
                name,
                (event) => {
                    const touch =
                        (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]);
                    push(name, {
                        x: touch ? Math.round(touch.clientX) : null,
                        y: touch ? Math.round(touch.clientY) : null
                    });
                },
                { capture: true, passive: true }
            );
        }

        for (const [eventName, kind] of [
            ['map:drill-start', 'drill-start'],
            ['map:view-change', 'view-change'],
            ['map:region-activate', 'region-activate']
        ]) {
            document.addEventListener(
                eventName,
                (event) => {
                    const detail = (event && event.detail) || {};
                    push(kind, {
                        region: (detail.point && detail.point.name) || detail.province || null,
                        source: detail.source || null,
                        canDrill: typeof detail.canDrill === 'boolean' ? detail.canDrill : null
                    });
                },
                true
            );
        }

        return trace.installedAt;
    });
}

function readGestureTrace(page) {
    return page.evaluate(() => (window.__gestureTrace ? window.__gestureTrace.events : []));
}

/** 「恰好一条激活」失败时的取证快照（activeMapId 只能给「现在」+ 换层时间点，够定位了）。 */
async function gestureDiagnostics(page, name, since) {
    const [readings, entries, trace] = await Promise.all([
        readMap(page),
        readActivations(page),
        readGestureTrace(page)
    ]);
    const loadingTimeline = trace.filter((entry) => entry.kind === 'map-loading');

    return {
        since,
        activationsForThisGesture: activationsFor(entries, name, since),
        lastActivations: entries.slice(-6),
        // 当前值 + trace 里的 view-change 时间点，足以判断换层发生在哪次激活之前/之后。
        activeMapIdNow: readings.activeMapId,
        activeProvinceNow: readings.activeProvince,
        mapLoading: loadingTimeline.length ? loadingTimeline[loadingTimeline.length - 1] : null,
        trace
    };
}

/**
 * 断言「一次手势恰好一条激活」。这条**不许放宽**（A6 契约）：它正是 TapFallback 与
 * zrender / 浏览器补发 click 双记的探测器。失败时把要报的证据一次打全。
 */
async function assertSingleActivation(page, name, since, label) {
    const entries = activationsFor(await readActivations(page), name, since);
    if (entries.length !== 1) {
        const diagnostics = await gestureDiagnostics(page, name, since);
        assert.fail(
            `${label}：一次手势只应产生一条激活记录（TapFallback 与 zrender / 浏览器补发的 click 不得各记一条），` +
                `实际 ${entries.length} 条。诊断 = ${JSON.stringify(diagnostics)}`
        );
    }
    return entries[0];
}

/**
 * 面板必须**打开且保持打开**：手势结束后先看一眼，跨过浏览器补发 click 的窗口再看一眼。
 * 这是本次变更的核心回归——迟到 click 不得把刚打开的面板关掉。
 */
async function assertSheetStaysOpen(page, label, expectedPoint) {
    await sleep(SHEET_EARLY_WAIT_MS);
    const early = await readDialogs(page);
    assert.equal(
        early.sheetActive,
        true,
        `${label}：手势结束后 ${SHEET_EARLY_WAIT_MS}ms 面板就应处于打开状态（${JSON.stringify(early)}）`
    );
    if (expectedPoint) {
        assert.equal(early.currentPoint, expectedPoint, `${label}：面板应当是关于「${expectedPoint}」的（${JSON.stringify(early)}）`);
    }

    await sleep(SHEET_SETTLE_WAIT_MS);
    const later = await readDialogs(page);
    assert.equal(
        later.sheetActive,
        true,
        `${label}：等 ${SHEET_EARLY_WAIT_MS + SHEET_SETTLE_WAIT_MS}ms 之后面板仍须打开——` +
            `同一次手势里浏览器补发的原生 click 不得把它关掉（${JSON.stringify(later)}）`
    );
    assert.equal(later.overlayOpen, true, `${label}：面板打开时遮罩应在位（${JSON.stringify(later)}）`);
    return { early, later };
}

/** 轨迹压成可读的 `+ms kind 细节` 行（失败诊断与 T6 复跑对照用）。 */
function traceDigest(trace, since, limit = 24) {
    return trace
        .filter((entry) => entry.at >= since)
        .slice(0, limit)
        .map((entry) => {
            const detail = { ...entry };
            delete detail.at;
            delete detail.kind;
            return `+${entry.at - since}ms ${entry.kind} ${JSON.stringify(detail)}`;
        });
}

/* ------------------------------------------------------------------ *
 * 桌面端
 * ------------------------------------------------------------------ */

describe('桌面端（鼠标）', () => {
    test('左键点可下钻省份 → 下钻，activeProvince 正确且不弹面板', async (t) => {
        const { context, page } = await openPage();
        try {
            const target = await drillableTarget(page);
            await page.mouse.click(target.pixel.x, target.pixel.y);
            await page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });

            const readings = await readMap(page);
            assert.equal(readings.activeProvince, target.name, `左键点「${target.name}」应下钻`);
            const dialogs = await readDialogs(page);
            assert.equal(dialogs.sheetActive, false, '左键下钻不应弹面板');
            t.diagnostic(
                `左键点「${target.name}」→ activeProvince=${readings.activeProvince} activeMapId=${readings.activeMapId} ` +
                    `sheetActive=${dialogs.sheetActive} sheetMode=${dialogs.sheetMode}`
            );
        } finally {
            await context.close();
        }
    });

    test('右键点省份 → 面板打开且保持 ≥1s，且不下钻', async (t) => {
        const { context, page } = await openPage();
        try {
            const target = await drillableTarget(page);
            const since = Date.now();
            await page.mouse.click(target.pixel.x, target.pixel.y, { button: 'right' });

            const { early, later } = await assertSheetStaysOpen(page, '右键', target.name);
            assert.equal(later.sheetMode, 'public', `右键应开公开卡（${JSON.stringify(later)}）`);
            const readings = await readMap(page);
            assert.equal(readings.activeProvince, null, '右键只开面板，不得下钻');

            const sources = activationsFor(await readActivations(page), target.name, since).map((entry) => entry.source);
            assert.ok(
                sources.includes('right-click'),
                `右键必须走 source='right-click' 的分支，实际 ${JSON.stringify(sources)}`
            );
            t.diagnostic(
                `右键点「${target.name}」→ +${SHEET_EARLY_WAIT_MS}ms sheetActive=${early.sheetActive} / ` +
                    `+${SHEET_EARLY_WAIT_MS + SHEET_SETTLE_WAIT_MS}ms sheetActive=${later.sheetActive} ` +
                    `currentPoint=${later.currentPoint} sheetMode=${later.sheetMode} overlayOpen=${later.overlayOpen} ` +
                    `activeProvince=${readings.activeProvince} sources=${JSON.stringify(sources)}`
            );
        } finally {
            await context.close();
        }
    });
});

/* ------------------------------------------------------------------ *
 * 触摸端
 * ------------------------------------------------------------------ */

describe('触摸端（Playwright 触摸仿真 + CDP 原生触摸）', () => {
    test('轻点（<300ms）可下钻省份 → 下钻，且本次手势恰好一条激活记录', async (t) => {
        const { context, page } = await openPage({ touch: true });
        try {
            const target = await drillableTarget(page);
            await installGestureTrace(page);
            const since = Date.now();
            await tapRegion(page, target.pixel);
            await page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });

            const readings = await readMap(page);
            assert.equal(readings.activeProvince, target.name, `轻点「${target.name}」应下钻`);

            // 浏览器补发的原生 click 在 touchend 之后一个任务里才派发；等它落定再数激活记录，
            // 否则「恰好一条」会在 click 还没到的时候提前通过。
            await sleep(200);
            const entry = await assertSingleActivation(page, target.name, since, '触摸轻点');
            assert.equal(entry.source, 'touch-tap', `轻点必须走 source='touch-tap'，实际 ${entry.source}`);

            t.diagnostic(
                `触摸轻点「${target.name}」→ activeProvince=${readings.activeProvince} activeMapId=${readings.activeMapId} ` +
                    `activations=${JSON.stringify(activationsFor(await readActivations(page), target.name, since))}`
            );
            t.diagnostic(`手势轨迹：${JSON.stringify(traceDigest(await readGestureTrace(page), since))}`);
        } finally {
            await context.close();
        }
    });

    test('长按 600ms（位移 ≤14px）→ 面板打开且保持（本次核心回归）', async (t) => {
        const { context, page, cdp } = await openPage({ touch: true });
        try {
            const target = await drillableTarget(page);
            await installGestureTrace(page);
            const since = Date.now();

            const mid = await holdRegion(cdp, target.pixel, HOLD_MS, () => readPressRing(page));
            assert.ok(mid, '页面缺少 #map-press-ring（长按按压反馈元素，由 MapSection.astro 提供）');
            assert.equal(
                mid.visible,
                'true',
                `按住 ≥300ms 后 #map-press-ring 应可见（data-visible="true"），实际 ${JSON.stringify(mid)}`
            );

            await sleep(50);
            const ringAfter = await readPressRing(page);
            assert.equal(
                ringAfter?.visible,
                'false',
                `松开后按压反馈必须收起（data-visible="false"），实际 ${JSON.stringify(ringAfter)}`
            );

            const { early, later } = await assertSheetStaysOpen(page, '长按', target.name);
            const readings = await readMap(page);
            assert.equal(readings.activeProvince, null, '长按只开面板，不得下钻');

            const entry = await assertSingleActivation(page, target.name, since, '触摸长按');
            assert.equal(entry.source, 'touch-hold', `长按必须走 source='touch-hold'，实际 ${entry.source}`);

            t.diagnostic(
                `长按 600ms「${target.name}」→ 按住时 press-ring=${JSON.stringify(mid)} / 松开后 press-ring=${JSON.stringify(ringAfter)}；` +
                    `+${SHEET_EARLY_WAIT_MS}ms sheetActive=${early.sheetActive} / ` +
                    `+${SHEET_EARLY_WAIT_MS + SHEET_SETTLE_WAIT_MS}ms sheetActive=${later.sheetActive} ` +
                    `currentPoint=${later.currentPoint} sheetMode=${later.sheetMode} activeProvince=${readings.activeProvince}`
            );
            t.diagnostic(
                `手势轨迹：${JSON.stringify(traceDigest(await readGestureTrace(page), since))}`
            );
        } finally {
            await context.close();
        }
    });

    test('轻点台湾（不可下钻）→ 面板打开且保持（F-P1 的核心回归）', async (t) => {
        const { context, page } = await openPage({ touch: true });
        try {
            const pixel = await regionPixel(page, NON_DRILLABLE_REGION);
            await installGestureTrace(page);
            const since = Date.now();
            await tapRegion(page, pixel);

            const { early, later } = await assertSheetStaysOpen(page, '轻点台湾', NON_DRILLABLE_REGION);
            assert.equal(later.sheetMode, 'public', `台湾应开公开卡（${JSON.stringify(later)}）`);
            const readings = await readMap(page);
            assert.equal(readings.activeProvince, null, '台湾没有省级地图文件，不得下钻');

            const entry = await assertSingleActivation(page, NON_DRILLABLE_REGION, since, '轻点台湾');
            assert.equal(entry.source, 'touch-tap', `轻点必须走 source='touch-tap'，实际 ${entry.source}`);

            t.diagnostic(
                `轻点「${NON_DRILLABLE_REGION}」→ +${SHEET_EARLY_WAIT_MS}ms sheetActive=${early.sheetActive} / ` +
                    `+${SHEET_EARLY_WAIT_MS + SHEET_SETTLE_WAIT_MS}ms sheetActive=${later.sheetActive} ` +
                    `currentPoint=${later.currentPoint} sheetMode=${later.sheetMode} activeProvince=${readings.activeProvince} ` +
                    `activations=${JSON.stringify(activationsFor(await readActivations(page), NON_DRILLABLE_REGION, since))}`
            );
            t.diagnostic(`手势轨迹：${JSON.stringify(traceDigest(await readGestureTrace(page), since))}`);
        } finally {
            await context.close();
        }
    });
});

/* ------------------------------------------------------------------ *
 * 键盘（「地区一览」）
 * ------------------------------------------------------------------ */

describe('键盘（「地区一览」行按钮）', () => {
    async function openLedger(page) {
        await page.evaluate(() => {
            const ledger = document.getElementById('region-ledger');
            if (ledger) {
                ledger.open = true;
            }
        });
        await page.waitForSelector('#region-table-body button[data-action="view"]', { timeout: 15000 });
    }

    function rowButton(name, action) {
        return `#region-table-body button[data-region="${name}"][data-action="${action}"]`;
    }

    test('「查看」按钮 Enter → 与鼠标左键一致（下钻）', async (t) => {
        const { context, page } = await openPage();
        try {
            const target = await drillableTarget(page);
            await openLedger(page);

            await page.locator(rowButton(target.name, 'view')).focus();
            const since = Date.now();
            await page.keyboard.press('Enter');
            await page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });

            const readings = await readMap(page);
            assert.equal(readings.activeProvince, target.name, `「查看」Enter 应下钻到「${target.name}」`);
            const dialogs = await readDialogs(page);
            assert.equal(dialogs.sheetActive, false, '「查看」下钻不应弹面板');

            const sources = activationsFor(await readActivations(page), target.name, since).map((entry) => entry.source);
            assert.ok(sources.includes('ledger'), `「查看」必须走 source='ledger'，实际 ${JSON.stringify(sources)}`);
            t.diagnostic(
                `「查看」Enter「${target.name}」→ activeProvince=${readings.activeProvince} sheetActive=${dialogs.sheetActive} ` +
                    `sources=${JSON.stringify(sources)}`
            );
        } finally {
            await context.close();
        }
    });

    test('「详情」按钮 Enter → 面板打开且保持', async (t) => {
        const { context, page } = await openPage();
        try {
            const target = await drillableTarget(page);
            await openLedger(page);

            await page.locator(rowButton(target.name, 'detail')).focus();
            const since = Date.now();
            await page.keyboard.press('Enter');

            const { early, later } = await assertSheetStaysOpen(page, '「详情」Enter', target.name);
            const readings = await readMap(page);
            assert.equal(readings.activeProvince, null, '「详情」只开面板，不得下钻');

            const sources = activationsFor(await readActivations(page), target.name, since).map((entry) => entry.source);
            assert.ok(
                sources.includes('ledger-detail'),
                `「详情」必须走 source='ledger-detail'，实际 ${JSON.stringify(sources)}`
            );
            t.diagnostic(
                `「详情」Enter「${target.name}」→ +${SHEET_EARLY_WAIT_MS}ms sheetActive=${early.sheetActive} / ` +
                    `+${SHEET_EARLY_WAIT_MS + SHEET_SETTLE_WAIT_MS}ms sheetActive=${later.sheetActive} ` +
                    `currentPoint=${later.currentPoint} sheetMode=${later.sheetMode} activeProvince=${readings.activeProvince} ` +
                    `sources=${JSON.stringify(sources)}`
            );
        } finally {
            await context.close();
        }
    });
});

/* ------------------------------------------------------------------ *
 * 一致性
 * ------------------------------------------------------------------ */

describe('一致性（桌面左键 × 触摸轻点）', () => {
    test('同一个可下钻省份，两种输入方式的 final state 一致', async (t) => {
        const desktop = await openPage();
        const touch = await openPage({ touch: true });
        try {
            const target = await drillableTarget(desktop.page);
            await desktop.page.mouse.click(target.pixel.x, target.pixel.y);
            await desktop.page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });
            const desktopState = await finalState(desktop.page);

            const touchPixel = await regionPixel(touch.page, target.name);
            await tapRegion(touch.page, touchPixel);
            await touch.page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });
            const touchState = await finalState(touch.page);

            assert.deepEqual(
                touchState,
                desktopState,
                `桌面左键与触摸轻点的 final state 必须一致：桌面 ${JSON.stringify(desktopState)}，触摸 ${JSON.stringify(touchState)}`
            );
            t.diagnostic(
                `「${target.name}」桌面左键=${JSON.stringify(desktopState)}；触摸轻点=${JSON.stringify(touchState)}`
            );
        } finally {
            await desktop.context.close();
            await touch.context.close();
        }
    });
});

/* ------------------------------------------------------------------ *
 * T9 / T13 的两条新回归
 *
 * - 加载态可见性（T9）：zrender 的 Painter 构造会 `root.innerHTML = ''`，所以 `#map-loading`
 *   必须挂在 `#map` 之外才会真的显示；这里锁住「在 DOM、aria-hidden、下钻期间可见、结束后隐藏」。
 * - 输入设备判别（T13）：真实鼠标左键在触摸之后必须仍然生效。**实测结论（本用例据此写）**：
 *   zrender 的 `env.pointerEventsSupported` 只对 Edge/IE 为 true（`zrender/lib/core/env.js:70-71`），
 *   Chromium 因此走「touch + mouse」分支，`touchstart`/`touchend` 会把 `scope.touching` 置 true 并
 *   保持 **700ms**（`setTouchTimer`，`HandlerProxy.js:38-48` / `:205-212`），这期间**所有鼠标事件在
 *   zrender 内部被直接跳过** —— `chart.on('click')` 一次都不派发（实测 Δ≈628/668ms 全丢，Δ≈741ms 起
 *   恢复）。所以在 Chromium 上，触摸后 700ms 内的鼠标左键**根本到不了** `ownsTouchGesture()`；
 *   本用例因此断言「不变式 + 条件分支」：一旦 click 到了图表，守卫必须按输入设备放行；
 *   若平台没把 click 送到图表，则必须是 0 条激活且不开面板，并且窗口外（≥900ms）同一动作必须生效。
 * ------------------------------------------------------------------ */

describe('加载态可见性与输入设备判别（T9 / T13 / T17 回归）', () => {
    test('下钻期间 #map-loading 真的可见（display≠none、文案「正在加载 X 地图」），结束后回到 none，且 aria-hidden="true"', async (t) => {
        const { context, page } = await openPage();
        try {
            const initial = await readLoadingElement(page);
            assert.equal(initial.exists, true, '#map-loading 必须存在于 DOM（T9：它挂在 .map-frame 下，不再被 echarts.init 抹掉）');
            assert.equal(
                initial.ariaHidden,
                'true',
                '#map-loading 必须带 aria-hidden="true"（离开 role=img 后不得重复进无障碍树）'
            );
            assert.equal(initial.insideMap, false, '#map-loading 不应再是 #map 的子元素（否则 zrender 会把它删掉）');
            assert.equal(initial.display, 'none', `全国视野就绪后加载层应隐藏，实际 display=${initial.display}`);

            await installLoadingRecorder(page);
            const target = await drillableTarget(page);
            await page.mouse.click(target.pixel.x, target.pixel.y);
            await page.waitForFunction((name) => window.__mapProbe.read().activeProvince === name, target.name, {
                timeout: 15000
            });

            const log = await readLoadingLog(page);
            const visible = log.filter((entry) => entry.display && entry.display !== 'none');
            assert.ok(
                visible.length > 0,
                `下钻期间必须至少采样到一次可见（display≠none）的加载层，实际时间线 ${JSON.stringify(log)}`
            );
            assert.ok(
                visible.some((entry) => entry.text && entry.text.includes(`正在加载 ${target.name} 地图`)),
                `加载层可见时必须写着「正在加载 ${target.name} 地图...」，实际时间线 ${JSON.stringify(log)}`
            );
            assert.equal(
                log[log.length - 1].display,
                'none',
                `下钻完成后加载层必须回到隐藏，实际时间线 ${JSON.stringify(log)}`
            );
            assert.equal(
                (await readLoadingElement(page)).display,
                'none',
                '下钻结束后再次读取加载层仍应是隐藏'
            );

            t.diagnostic(
                `加载态：boot后 exists=${initial.exists} aria-hidden=${initial.ariaHidden} insideMap=${initial.insideMap} display=${initial.display} text="${initial.text}"；` +
                    `下钻「${target.name}」时间线=${JSON.stringify(log)}`
            );
        } finally {
            await context.close();
        }
    });

    test('触摸后的真实鼠标左键：窗口外必须记 source="map"；窗口内若点击到了图表则不得被守卫吞掉', async (t) => {
        const { context, page } = await openPage({ touch: true });
        try {
            const taiwanPixel = await regionPixel(page, NON_DRILLABLE_REGION);
            const blankPixel = await blankMapPixel(page);
            assert.ok(blankPixel, '找不到地图上的空白像素（用来只开触摸窗口、不触发任何激活）');
            await installChartClickCounter(page);

            // ── 窗口内：空白处轻点（只开触摸窗口，不换视野、不开面板、不产生任何激活），
            //    紧跟着用**真实鼠标**点台湾。
            await page.touchscreen.tap(blankPixel.x, blankPixel.y);
            const since = Date.now();
            await page.mouse.click(taiwanPixel.x, taiwanPixel.y);
            const deltaMs = Date.now() - since;
            assert.ok(
                deltaMs <= 300,
                `这次鼠标点击必须落在触摸窗口内（≤300ms；让位窗口本身是 450ms），实际 ${deltaMs}ms —— ` +
                    '超窗就变成在测对照组，结论无效'
            );
            await sleep(250);

            const inWindowClicks = (await readChartClicks(page)).filter((entry) => entry.at >= since);
            const inWindowActivations = (await readActivations(page)).filter((entry) => entry.at >= since);
            const inWindowDialogs = await readDialogs(page);

            // 硬不变式：一次鼠标点击绝不能被记成两条（双击记账是这条用例真正要防的回归）。
            assert.ok(
                inWindowActivations.length <= 1,
                `一次鼠标点击最多只能有一条激活，实际 ${JSON.stringify(inWindowActivations)}`
            );

            if (inWindowClicks.length === 0) {
                // **平台事实（不是我们的守卫）**：zrender 的 `env.pointerEventsSupported` 只对 Edge/IE 为 true
                // （`zrender/lib/core/env.js:70-71`），Chromium 因此走「touch + mouse」分支，触摸处理里
                // `setTouchTimer(scope)` 会把 `scope.touching` 置 true 并保持 **700ms**，这段时间里
                // 所有鼠标事件在 zrender 内部被直接跳过（`HandlerProxy.js:205-212`）。实测：Δ≈628/668ms
                // 时 `chart.on('click')` 一次都不派发，Δ≈741ms 起恢复正常。既然 click 根本没到图表，
                // `ownsTouchGesture()` 就不可能参与，激活必须是 0 条、面板必须不开。
                assert.equal(
                    inWindowActivations.length,
                    0,
                    `ECharts 没有派发 click 时不该有任何激活，实际 ${JSON.stringify(inWindowActivations)}`
                );
                assert.equal(
                    inWindowDialogs.sheetActive,
                    false,
                    `click 没到图表时不该开面板：${JSON.stringify(inWindowDialogs)}`
                );
            } else {
                // 真正的 T13 回归面：click 到了图表，守卫就必须按输入设备放行（不能吞、不能记两条）。
                assert.equal(
                    inWindowActivations.length,
                    1,
                    `click 已到达图表，真实鼠标必须恰好产生一条激活（0 条＝被守卫吞掉），实际 ${JSON.stringify(inWindowActivations)}`
                );
                assert.equal(
                    inWindowActivations[0].source,
                    'map',
                    `真实鼠标必须记 source='map'（触摸轻点才是 'touch-tap'），实际 ${inWindowActivations[0].source}`
                );
                assert.equal(
                    inWindowDialogs.sheetActive,
                    true,
                    `窗口内真实鼠标点台湾应当开面板：${JSON.stringify(inWindowDialogs)}`
                );
                assert.equal(
                    inWindowDialogs.currentPoint,
                    NON_DRILLABLE_REGION,
                    `窗口内鼠标点的应当是台湾：${JSON.stringify(inWindowDialogs)}`
                );
            }

            // ── 对照组：越过 zrender 的 700ms 触摸窗口 + 我们的 450ms 让位窗口之后，
            //    同样的鼠标点击（同一个像素、同一个动作）必须照常生效。
            if (inWindowDialogs.sheetActive) {
                await page.keyboard.press('Escape');
                await page.waitForFunction(() => !window.__dialogsProbe.read().sheetActive, null, { timeout: 5000 });
            }
            await sleep(900);

            const controlSince = Date.now();
            await page.mouse.click(taiwanPixel.x, taiwanPixel.y);
            await sleep(250);
            const controlEntries = activationsFor(await readActivations(page), NON_DRILLABLE_REGION, controlSince);
            assert.equal(
                controlEntries.length,
                1,
                `窗口外鼠标点台湾应恰好一条激活，实际 ${JSON.stringify(controlEntries)}`
            );
            assert.equal(controlEntries[0].source, 'map', `窗口外鼠标必须记 source='map'，实际 ${controlEntries[0].source}`);
            const controlDialogs = await readDialogs(page);
            assert.equal(
                controlDialogs.sheetActive,
                true,
                `窗口外鼠标点台湾应当开面板：${JSON.stringify(controlDialogs)}`
            );

            t.diagnostic(
                `窗口内鼠标点台湾（Δ=${deltaMs}ms，空白处先轻点开窗）：echartsClick=${inWindowClicks.length} ` +
                    `activations=${JSON.stringify(inWindowActivations)} sheetActive=${inWindowDialogs.sheetActive}；` +
                    `窗口外同一动作：activations=${JSON.stringify(controlEntries)} sheetActive=${controlDialogs.sheetActive}`
            );
        } finally {
            await context.close();
        }
    });

    test('页面脚本伪造 pointerdown(pointerType="mouse") 不得把触摸的合成 click 记成 source="map"（T17 收口）', async (t) => {
        const { context, page, cdp } = await openPage({ touch: true });
        try {
            const pixel = await regionPixel(page, NON_DRILLABLE_REGION);
            await installGestureTrace(page);

            // 触摸**进行到一半**时在 viewportRoot 上伪造一次 pointerdown(pointerType='mouse')。
            // 这正是 T15 对抗性复现的序列：收口前它会把 `lastMousePointerDownAt` 顶到
            // `lastTouchGestureAt` 之后，于是 zrender 在 touchend 里**同步合成**的那条 click
            // 被守卫当成「真实鼠标按下」而放行 → 这一次触摸被记成 `source='map'`。
            // 注意按住时长 80ms < HOLD_MIN_MS(300)，走的仍是轻触分支。
            const gestureSince = Date.now();
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(pixel)] });
            await sleep(40);
            const forged = await page.evaluate(() => {
                const root = window.__mapProbe.state().chart.getZr().painter.getViewportRoot();
                const event = new PointerEvent('pointerdown', {
                    pointerType: 'mouse',
                    bubbles: true,
                    cancelable: true
                });
                root.dispatchEvent(event);
                return { isTrusted: event.isTrusted, pointerType: event.pointerType, defaultPrevented: event.defaultPrevented };
            });
            await sleep(40);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

            assert.equal(
                forged.isTrusted,
                false,
                `脚本 dispatchEvent 出来的 PointerEvent 必须是 untrusted，否则这条用例就不是「页面脚本伪造」场景：${JSON.stringify(forged)}`
            );
            assert.equal(
                forged.pointerType,
                'mouse',
                `伪造事件必须自称 pointerType="mouse"（收口前正是靠它骗过守卫）：${JSON.stringify(forged)}`
            );

            await assertSheetStaysOpen(page, '伪造 pointerdown 后轻点台湾', NON_DRILLABLE_REGION);

            const entries = activationsFor(await readActivations(page), NON_DRILLABLE_REGION, gestureSince);
            assert.equal(
                entries.length,
                1,
                `伪造戳不许产生第二条激活：这次手势应恰好一条，实际 ${JSON.stringify(entries)}`
            );
            assert.equal(
                entries[0].source,
                'touch-tap',
                `伪造的 pointerdown 不得改变来源标记：必须是 'touch-tap'（收口前这里是 'map'），实际 ${entries[0].source}`
            );

            const allSince = (await readActivations(page)).filter((entry) => entry.at >= gestureSince);
            assert.ok(
                allSince.length <= 1,
                `全程激活总数必须 ≤1（伪造戳不得带来第二条），实际 ${JSON.stringify(allSince)}`
            );

            t.diagnostic(
                `伪造 pointerdown（isTrusted=${forged.isTrusted}、pointerType=${forged.pointerType}）后轻点台湾：` +
                    `activations=${JSON.stringify(entries)} 全程=${JSON.stringify(allSince)} sheetActive=true`
            );
        } finally {
            await context.close();
        }
    });
});

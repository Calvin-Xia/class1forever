/**
 * 分享图的 canvas 合成（迁移自 `js/map.js` 的 `ShareManager`：`captureMapSnapshot` /
 * `computeMapCrop` / `drawHeatLegend` / `generateImage` / `canvasToPngBlob` / `downloadImage`）。
 *
 * 与旧实现的两点一致性与一点改进：
 * - **一致性**：版式常量、裁剪算法、图例画法、统计区版式、字体与配色全部逐字照搬
 *   （配色/字体来自 `src/styles/palette.ts`，与页面同源）。
 * - **一致性**：快照采样倍率 3×、裁剪前先 `hideTip`、拍摄时先隐藏 ECharts 自带图例
 *   （图例由合成图自己画，窄屏也不会被裁掉）。
 * - **改进（旧实现本来就有，这里保持）**：`captureMapSnapshot()` 与 `createSharePlan()`
 *   都在第一个 `await` 之前同步跑完；之后按 Esc 切视野也改不动已经定下的
 *   颜色、图例刻度与文件名 —— 三者不会分属三个范围。
 *
 * 这个模块只跑在浏览器里（canvas / Image / URL），不参与 SSR。
 */
import { palette } from '../styles/palette';
import { getGeo } from './geo-loader';
import { loadFontsBestEffort } from './map-fonts';
import type { EChartsType } from './echarts';
import { computeHeatMax, getMapBounds, type MapBounds, type RegionPoint } from './map-model';
import { formatLocalDate, type ShareStats } from './share';

/** 快照采样倍率。窄屏下地图本身只有 ~374px 宽，裁完却要放进 1200px 宽的画布里，2 倍会糊。 */
export const SNAPSHOT_PIXEL_RATIO = 3;

/**
 * 分享图版式。
 *
 * 地图快照的宽高比取决于容器和当前缩放，是变化的，所以画布高度必须按快照算出来；
 * 硬画进固定 1200×800 会把桌面端接近 1.83:1 的快照纵向拉伸 22%。
 */
export const SHARE_WIDTH = 1200;
export const SHARE_HEADER_HEIGHT = 150;
export const SHARE_LEGEND_HEIGHT = 60;
export const SHARE_STATS_HEIGHT = 100;
export const SHARE_FOOTER_HEIGHT = 50;
export const SHARE_MAP_MIN_HEIGHT = 460;
export const SHARE_MAP_MAX_HEIGHT = 1000;
/** 裁剪地图快照时四周保留的留白（快照像素）。 */
export const SHARE_MAP_PADDING = 16;

export interface MapSnapshot {
    dataUrl: string;
    /** 裁剪矩形（快照像素）；算不出来时为 null，调用方按整幅画。 */
    crop: { x: number; y: number; width: number; height: number } | null;
    /** 色带满量程：与快照同一刻取出，之后按 Esc 切视野也改不动。 */
    heatMax: number;
}

/**
 * 计算要把快照裁到哪里。
 *
 * 地图在容器里是居中的，两侧会留下大片奶油色空白；只裁到地图外接矩形，分享图里
 * 地图才能占满宽度。图例在容器底部居中，水平方向一定落在地图跨度内，所以按外接
 * 矩形裁剪不会把它切掉。
 *
 * 几何来源只有一处：`getMapBounds(mapId, getGeo(mapId))`（与地图岛屿同一份
 * GeoJSON 与同一个缓存），不另算一份范围。
 */
export function computeMapCrop(chart: EChartsType, mapId: string): MapSnapshot['crop'] {
    const geoJson = getGeo(mapId);
    const bounds: MapBounds | null = getMapBounds(mapId, geoJson);
    const width = chart.getWidth();
    const height = chart.getHeight();
    if (!bounds || !width || !height) {
        return null;
    }

    const cornerA = chart.convertToPixel({ seriesIndex: 0 }, [bounds.minX, bounds.minY]) as number[] | undefined;
    const cornerB = chart.convertToPixel({ seriesIndex: 0 }, [bounds.maxX, bounds.maxY]) as number[] | undefined;
    if (!cornerA || !cornerB) {
        return null;
    }

    const left = Math.max(0, Math.min(cornerA[0], cornerB[0]) - SHARE_MAP_PADDING);
    const right = Math.min(width, Math.max(cornerA[0], cornerB[0]) + SHARE_MAP_PADDING);
    const top = Math.max(0, Math.min(cornerA[1], cornerB[1]) - SHARE_MAP_PADDING);
    const bottom = Math.min(height, Math.max(cornerA[1], cornerB[1]) + SHARE_MAP_PADDING);

    if (right - left < 1 || bottom - top < 1) {
        return null;
    }

    return {
        x: Math.round(left * SNAPSHOT_PIXEL_RATIO),
        y: Math.round(top * SNAPSHOT_PIXEL_RATIO),
        width: Math.round((right - left) * SNAPSHOT_PIXEL_RATIO),
        height: Math.round((bottom - top) * SNAPSHOT_PIXEL_RATIO)
    };
}

/**
 * 取当前地图画面，供分享图复用。
 *
 * 图例由合成图自己画（尺寸可控、窄屏也不会被裁掉），所以拍摄时先把它藏起来；
 * `setOption` 是同步的，整个过程在同一个任务里完成，浏览器不会画出中间状态。
 */
export function captureMapSnapshot(chart: EChartsType | null, mapId: string, points: readonly RegionPoint[]): MapSnapshot {
    if (!chart) {
        throw new Error('地图尚未加载完成');
    }

    chart.dispatchAction({ type: 'hideTip' });

    const crop = computeMapCrop(chart, mapId);

    chart.setOption({ visualMap: { show: false } });
    let dataUrl: string;
    try {
        dataUrl = chart.getDataURL({
            type: 'png',
            pixelRatio: SNAPSHOT_PIXEL_RATIO,
            backgroundColor: palette.snapshotBackground
        });
    } finally {
        chart.setOption({ visualMap: { show: true } });
    }

    // 色带的满量程和快照在同一刻取；这个函数在 await 之前同步跑完，
    // 之后按 Esc 切视野也改不动已经定下的刻度。
    return { dataUrl, crop, heatMax: computeHeatMax(points) };
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: boolean,
    stroke: boolean,
    corners?: [number, number, number, number]
): void {
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

/**
 * 画底部色带图例。
 *
 * 单独占一条带，既不会盖住地图，也不依赖快照里那个被缩小的图例。
 */
export function drawHeatLegend(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    bandTop: number,
    bandHeight: number,
    maxValue: number
): void {
    const lowLabel = '0 人';
    const highLabel = `${maxValue} 人`;
    const barWidth = 260;
    const barHeight = 12;
    const gap = 14;
    const paddingX = 20;
    const pillHeight = 40;

    ctx.font = 'bold 15px ' + palette.fonts.body;
    ctx.textBaseline = 'middle';
    const labelWidth = Math.ceil(Math.max(
        ctx.measureText(lowLabel).width,
        ctx.measureText(highLabel).width
    ));

    const pillWidth = paddingX * 2 + labelWidth * 2 + gap * 2 + barWidth;
    const pillLeft = centerX - pillWidth / 2;
    const pillTop = bandTop + (bandHeight - pillHeight) / 2;
    const centerY = pillTop + pillHeight / 2;

    ctx.fillStyle = palette.share.legendPill;
    ctx.strokeStyle = palette.regionBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, pillLeft, pillTop, pillWidth, pillHeight, pillHeight / 2, true, true);

    ctx.fillStyle = palette.share.legendText;
    ctx.textAlign = 'right';
    ctx.fillText(lowLabel, pillLeft + paddingX + labelWidth, centerY);
    ctx.textAlign = 'left';
    ctx.fillText(highLabel, pillLeft + pillWidth - paddingX - labelWidth, centerY);

    const barLeft = pillLeft + paddingX + labelWidth + gap;
    const gradient = ctx.createLinearGradient(barLeft, 0, barLeft + barWidth, 0);
    palette.heat.forEach(function (color, index) {
        gradient.addColorStop(index / (palette.heat.length - 1), color);
    });

    ctx.fillStyle = gradient;
    roundRect(ctx, barLeft, centerY - barHeight / 2, barWidth, barHeight, barHeight / 2, true, false);
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise(function (resolve, reject) {
        const image = new Image();
        image.onload = function () {
            resolve(image);
        };
        image.onerror = function () {
            reject(new Error('地图画面解析失败'));
        };
        image.src = src;
    });
}

/**
 * 把 canvas 转成 PNG Blob。
 *
 * 实测 `canvas.toBlob` 在部分 Chromium 环境里会被拖到 7 秒（同一张图 `toDataURL` 只要 18ms，
 * 而且空白画布反而比有内容的更慢，明显是调度问题）。分享图导出一次就够，与其等异步回调，
 * 不如同步编码再自己转 Blob，稳定在几百毫秒内。
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise(function (resolve, reject) {
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            const dataUrl = canvas.toDataURL('image/png');
            const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
            bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
        } catch (error) {
            reject(error);
            return;
        }

        resolve(new Blob([bytes], { type: 'image/png' }));
    });
}

/**
 * 按冻结后的实际文字与字重加载分享图所需的全部字体分片。
 *
 * 与地图侧同一套「尽力而为」策略（`loadFontsBestEffort`）：字体等不到就按回退字体
 * 先画，超时/失败都不会让分享图整个失败 —— 用户按下分享按钮时最不想要的就是
 * 一个因为字体下载慢而弹出来的「生成分享图片失败」。
 */
export async function loadShareFonts(stats: ShareStats, heatMax: number): Promise<void> {
    // unicode-range 按实际文本选择分片。ready 只等待已触发的下载，不能替代完整文本的 load。
    // 不读取 DOM/当前地图视野：所有动态文字均来自已经冻结的分享参数。
    try {
        if (typeof document === 'undefined' || !document.fonts) {
            return;
        }

        const bodyText = [
            stats.scope,
            ' · 数据更新于 ',
            formatLocalDate(stats.generatedAt),
            '万州二中 · 金鹰 1 班',
            stats.emptyText,
            ...(stats.columns || []).map((column) => column.label)
        ].join('');
        const boldText = [
            `0 人 ${heatMax} 人`,
            ...(stats.columns || []).map((column) => String(column.value))
        ].join('');
        await loadFontsBestEffort(
            Promise.all([
                document.fonts.load('600 42px "Noto Serif SC"', '金鹰 1 班蹭饭地图'),
                document.fonts.load('400 18px "Noto Sans SC"', bodyText),
                document.fonts.load('700 36px "Noto Sans SC"', boldText)
            ]).then(() => document.fonts.ready)
        );
    } catch (error) {
        console.warn('分享图字体预加载失败，改用回退字体继续合成：', error);
    }
}

/**
 * 把快照与统计合成分享图。
 *
 * 调用方（`src/scripts/share-boot.ts`）必须先在**同一个同步任务**里取好
 * `createSharePlan()` 与 `captureMapSnapshot()`，再把两者传进来 —— 这样图上的颜色、
 * 图例刻度与文件名三者同源，之后（包括 `Image` 解码期间）按 Esc 切视野都影响不了它。
 */
export async function composeShareImage(stats: ShareStats, snapshot: MapSnapshot): Promise<Blob> {
    // stats/snapshot 已由调用方冻结；等待自托管字体后再画字，避免首次导出字体漂移。
    await loadShareFonts(stats, snapshot.heatMax);
    const mapImage = await loadImage(snapshot.dataUrl);

    const source = snapshot.crop || {
        x: 0,
        y: 0,
        width: mapImage.naturalWidth,
        height: mapImage.naturalHeight
    };

    // 地图区域的高度由快照真实宽高比决定，宽度固定，这样地图永远不会被拉变形。
    const mapHeight = Math.round(Math.min(
        SHARE_MAP_MAX_HEIGHT,
        Math.max(SHARE_MAP_MIN_HEIGHT, SHARE_WIDTH / (source.width / source.height))
    ));
    const mapTop = SHARE_HEADER_HEIGHT;
    const legendTop = mapTop + mapHeight;
    const statsTop = legendTop + SHARE_LEGEND_HEIGHT;
    const footerTop = statsTop + SHARE_STATS_HEIGHT;
    const canvasHeight = footerTop + SHARE_FOOTER_HEIGHT;

    const canvas = document.createElement('canvas');
    canvas.width = SHARE_WIDTH;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('无法创建分享图画布');
    }

    ctx.fillStyle = palette.share.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, SHARE_HEADER_HEIGHT);
    gradient.addColorStop(0, palette.share.headerFrom);
    gradient.addColorStop(1, palette.share.headerTo);
    ctx.fillStyle = gradient;
    roundRect(ctx, 0, 0, canvas.width, SHARE_HEADER_HEIGHT, 24, true, false, [24, 24, 0, 0]);

    ctx.fillStyle = palette.share.headerTitle;
    // 分享图上的字体也得跟页面一致，否则导出图和网页是两套字。
    ctx.font = '600 42px ' + palette.fonts.display;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('金鹰 1 班蹭饭地图', canvas.width / 2, 55);

    ctx.font = '18px ' + palette.fonts.body;
    ctx.fillStyle = palette.share.headerSubtitle;
    // 范围要印在图上：省界图配几个数字，脱离页面之后没有别的线索能说明这是哪个省。
    // 数据时间缺失时只印范围，不印半个日期。
    const dataDate = formatLocalDate(stats.generatedAt);
    ctx.fillText(
        dataDate ? `${stats.scope} · 数据更新于 ${dataDate}` : stats.scope,
        canvas.width / 2,
        105
    );

    // 等比缩放并居中；极端比例被上下限裁到时，留白用快照同色填充。
    ctx.fillStyle = palette.snapshotBackground;
    ctx.fillRect(0, mapTop, canvas.width, mapHeight);

    const scale = Math.min(SHARE_WIDTH / source.width, mapHeight / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    ctx.drawImage(
        mapImage,
        source.x,
        source.y,
        source.width,
        source.height,
        (canvas.width - drawWidth) / 2,
        mapTop + (mapHeight - drawHeight) / 2,
        drawWidth,
        drawHeight
    );

    ctx.fillStyle = palette.share.background;
    ctx.fillRect(0, legendTop, canvas.width, SHARE_LEGEND_HEIGHT);
    drawHeatLegend(ctx, canvas.width / 2, legendTop, SHARE_LEGEND_HEIGHT, snapshot.heatMax);

    ctx.fillStyle = palette.share.statsBackground;
    ctx.fillRect(0, statsTop, canvas.width, SHARE_STATS_HEIGHT);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (stats.columns) {
        // 三列等距；全国的列与标签保持原样，只有省级视野换成该省口径。
        const statPositions = [200, 600, 1000];

        stats.columns.forEach(function (column, index) {
            const x = statPositions[index];
            ctx.fillStyle = palette.share.statValue;
            ctx.font = 'bold 36px ' + palette.fonts.body;
            ctx.fillText(String(column.value), x, statsTop + 40);
            ctx.fillStyle = palette.share.statLabel;
            ctx.font = '16px ' + palette.fonts.body;
            ctx.fillText(column.label, x, statsTop + 70);
        });
    } else {
        // 0 人的地区：一行空状态比一行 0 更像话。
        ctx.fillStyle = palette.share.statLabel;
        ctx.font = '18px ' + palette.fonts.body;
        ctx.fillText(stats.emptyText, canvas.width / 2, statsTop + SHARE_STATS_HEIGHT / 2);
    }

    ctx.fillStyle = palette.share.footerBackground;
    roundRect(ctx, 0, footerTop, canvas.width, SHARE_FOOTER_HEIGHT, 0, true, false, [0, 0, 24, 24]);

    ctx.fillStyle = palette.share.footerText;
    ctx.font = '14px ' + palette.fonts.body;
    ctx.fillText('万州二中 · 金鹰 1 班', canvas.width / 2, footerTop + SHARE_FOOTER_HEIGHT / 2);

    return canvasToPngBlob(canvas);
}

/** 触发下载。 */
export function downloadShareImage(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

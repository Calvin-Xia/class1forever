/**
 * @fileoverview 从 js/china.js 生成 favicon.svg。
 *
 * 地图站点的 favicon 与其画一个通用定位针，不如直接用自己那份几何数据。
 *
 * 关键在于「怎么把 34 个省的轮廓变成一条国境线」：
 *   1. 把每个省的外环投影到输出网格并量化；
 *   2. 相邻省份共享的那条边界会出现两次（A→B 与 B→A）—— 把成对出现的边成对删掉；
 *   3. 剩下的边就是国境线，把它们首尾接成闭合回路。
 * 这样不用做多边形并集，也不需要栅格化，天然不会在剪影里留下内部省界。
 *
 * 用法：npm run favicon:build
 * 产物 favicon.svg 提交进仓库，和 js/vendor/echarts.min.js 一样"提交什么就发什么"。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** favicon 实际只看 16–64px，32 单位网格足够。 */
const VIEWBOX = 32;
const PADDING = 2.2;
/** 量化精度（输出单位）。共享边要能对上，又不能把形状磨圆。 */
const QUANTUM = 0.01;
/** 相邻保留点之间的最小屏幕距离，越小越贴形、文件越大。 */
const TOLERANCE = 0.28;
/** 相对最大回路的面积下限：再小的岛在 16px 下只是一粒灰。 */
const MIN_AREA_RATIO = 0.00035;

const COLORS = {
    paper: '#f7f4ec',
    ink: '#1f5245',
    border: '#ddd6c6'
};

function loadChinaGeoJson() {
    const registry = {};
    const context = vm.createContext({
        CMapGeo: {
            register: function(id, geoJson) {
                registry[id] = geoJson;
            }
        }
    });

    vm.runInContext(
        fs.readFileSync(path.join(rootDirectory, 'js/china.js'), 'utf8'),
        context,
        { filename: 'js/china.js' }
    );

    const geoJson = registry['cn/china'];
    if (!geoJson || !Array.isArray(geoJson.features)) {
        throw new Error('js/china.js 没有注册 cn/china 或缺少 features。');
    }

    return geoJson;
}

/** 只取外环：飞地孔洞在 favicon 尺寸下没有意义，留着只会多切几刀。 */
function collectOuterRings(geoJson) {
    const rings = [];

    for (const feature of geoJson.features) {
        const geometry = feature.geometry || {};
        const polygons = geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : (geometry.type === 'MultiPolygon' ? geometry.coordinates : []);

        for (const polygon of polygons) {
            if (polygon.length > 0 && polygon[0].length > 2) {
                rings.push(polygon[0]);
            }
        }
    }

    return rings;
}

function boundsOf(rings) {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const ring of rings) {
        for (const point of ring) {
            if (point[0] < bounds.minX) bounds.minX = point[0];
            if (point[0] > bounds.maxX) bounds.maxX = point[0];
            if (point[1] < bounds.minY) bounds.minY = point[1];
            if (point[1] > bounds.maxY) bounds.maxY = point[1];
        }
    }

    return bounds;
}

/** 等距投影数据已经是平面坐标，直接按包围盒归一化即可。 */
function makeProjector(bounds) {
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const scale = (VIEWBOX - PADDING * 2) / Math.max(spanX, spanY);
    const offsetX = (VIEWBOX - spanX * scale) / 2;
    const offsetY = (VIEWBOX - spanY * scale) / 2;

    return function project(point) {
        // SVG 的 y 轴向下、数据坐标系向上，这里翻一下。
        return [
            offsetX + (point[0] - bounds.minX) * scale,
            VIEWBOX - offsetY - (point[1] - bounds.minY) * scale
        ];
    };
}

function quantize(value) {
    return Math.round(value / QUANTUM) * QUANTUM;
}

function pointKey(point) {
    return point[0].toFixed(2) + ',' + point[1].toFixed(2);
}

/**
 * 成对消掉共享边，只留下国境线。
 * 用无向键计数：出现两次以上的边一定是两个省共用的内部边界。
 */
function keepOuterEdges(directedEdges) {
    const counts = new Map();

    for (const edge of directedEdges) {
        const forward = pointKey(edge.a) + '|' + pointKey(edge.b);
        const backward = pointKey(edge.b) + '|' + pointKey(edge.a);
        const key = forward < backward ? forward : backward;
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    return directedEdges.filter(function(edge) {
        const forward = pointKey(edge.a) + '|' + pointKey(edge.b);
        const backward = pointKey(edge.b) + '|' + pointKey(edge.a);
        const key = forward < backward ? forward : backward;
        return counts.get(key) === 1;
    });
}

/** 把散边接成闭合回路。数据集里各省环绕方向可能不一致，所以允许反向拼接。 */
function chainLoops(edges) {
    const byStart = new Map();

    edges.forEach(function(edge, index) {
        const key = pointKey(edge.a);
        if (!byStart.has(key)) {
            byStart.set(key, []);
        }
        byStart.get(key).push(index);
    });

    const used = new Array(edges.length).fill(false);
    const loops = [];

    for (let start = 0; start < edges.length; start += 1) {
        if (used[start]) {
            continue;
        }

        used[start] = true;
        const loop = [edges[start].a, edges[start].b];
        let current = edges[start].b;
        let guard = 0;

        while (guard < edges.length + 4) {
            guard += 1;

            const candidates = byStart.get(pointKey(current)) || [];
            let nextIndex = candidates.find(function(index) {
                return !used[index];
            });
            let reversed = false;

            if (nextIndex === undefined) {
                nextIndex = edges.findIndex(function(candidate, index) {
                    return !used[index] && pointKey(candidate.b) === pointKey(current);
                });
                reversed = true;
            }

            if (nextIndex === undefined) {
                break;
            }

            used[nextIndex] = true;
            if (reversed) {
                current = edges[nextIndex].a;
            } else {
                current = edges[nextIndex].b;
            }
            loop.push(current);

            if (pointKey(current) === pointKey(loop[0])) {
                break;
            }
        }

        if (loop.length >= 4) {
            loops.push(loop.slice(0, -1));
        }
    }

    return loops;
}

function loopArea(loop) {
    let sum = 0;
    for (let index = 0; index < loop.length; index += 1) {
        const current = loop[index];
        const next = loop[(index + 1) % loop.length];
        sum += current[0] * next[1] - next[0] * current[1];
    }
    return Math.abs(sum / 2);
}

/** 按屏幕距离抽稀：留着拐点，扔掉贴在直线上的密集点。 */
function decimate(points, tolerance) {
    if (points.length <= 4) {
        return points;
    }

    const kept = [points[0]];
    let last = points[0];

    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= tolerance) {
            kept.push(point);
            last = point;
        }
    }

    return kept.length >= 4 ? kept : points;
}

function formatNumber(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function toPath(loops, tolerance) {
    const segments = [];

    for (const loop of loops) {
        const reduced = decimate(loop, tolerance);
        if (reduced.length < 4) {
            continue;
        }

        segments.push(reduced.map(function(point, index) {
            return (index === 0 ? 'M' : 'L') + formatNumber(point[0]) + ' ' + formatNumber(point[1]);
        }).join('') + 'Z');
    }

    return segments.join('');
}

function build() {
    const geoJson = loadChinaGeoJson();
    const rings = collectOuterRings(geoJson);
    const project = makeProjector(boundsOf(rings));

    const directedEdges = [];
    for (const ring of rings) {
        const projected = ring.map(function(point) {
            const out = project(point);
            return [quantize(out[0]), quantize(out[1])];
        });

        for (let index = 0; index < projected.length; index += 1) {
            const a = projected[index];
            const b = projected[(index + 1) % projected.length];
            if (pointKey(a) !== pointKey(b)) {
                directedEdges.push({ a: a, b: b });
            }
        }
    }

    const outerEdges = keepOuterEdges(directedEdges);
    const allLoops = chainLoops(outerEdges);
    const largestArea = allLoops.reduce(function(max, loop) {
        return Math.max(max, loopArea(loop));
    }, 0);

    const keptLoops = allLoops.filter(function(loop) {
        return loopArea(loop) / largestArea >= MIN_AREA_RATIO;
    });

    const pathData = toPath(keptLoops, TOLERANCE);

    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="金鹰 1 班蹭饭地图">',
        '    <rect width="32" height="32" rx="5" fill="' + COLORS.paper + '"/>',
        '    <rect x="0.5" y="0.5" width="31" height="31" rx="4.5" fill="none" stroke="' + COLORS.border + '"/>',
        '    <path d="' + pathData + '" fill="' + COLORS.ink + '"/>',
        '</svg>',
        ''
    ].join('\n');

    fs.writeFileSync(path.join(rootDirectory, 'favicon.svg'), svg, 'utf8');

    const keptPoints = keptLoops.reduce(function(sum, loop) {
        return sum + loop.length;
    }, 0);

    process.stdout.write(
        'favicon.svg：' + directedEdges.length + ' 条边 → 国境线 ' + outerEdges.length + ' 条 → '
        + allLoops.length + ' 个回路（保留 ' + keptLoops.length + ' 个，' + keptPoints + ' 点）'
        + '，' + svg.length + ' 字节\n'
    );
}

build();

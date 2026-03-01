/**
 * @fileoverview 蹭饭地图核心模块
 * 
 * 该模块负责初始化和渲染中国地图，展示同学分布情况。
 * 主要功能包括：
 * - 中国省份地图渲染
 * - 省份下钻到城市级别
 * - 触摸设备检测和适配
 * - Tooltip 信息展示
 * - 移动端底部面板交互
 * 
 * @author Calvin-Xia
 * @version 1.0.0
 * @requires Highcharts/Highmaps
 * @requires Nunjucks
 * @requires students - 全局学生数据变量（由 data.js 提供）
 */

/**
 * 触摸设备检测结果
 * 使用 W3C 标准的 pointer: coarse 媒体查询进行检测
 * 检测优先级：pointer: coarse > any-pointer: coarse > 传统触摸检测
 * @constant {boolean}
 */
const isTouchDevice = (function() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return true;
    }
    if (window.matchMedia && window.matchMedia('(any-pointer: coarse)').matches) {
        return true;
    }
    return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
})();

/**
 * 中国地图 GeoJSON 数据
 * 从 Highcharts.maps 中获取，包含各省份的地理边界信息
 * @type {Array<Object>}
 */
let data = Highcharts.geojson(Highcharts.maps['cn/china']);

/**
 * 省份数据映射表
 * 键为省份名称，值为该省份的地图数据和统计信息
 * @type {Object.<string, Object>}
 * @property {string} name - 省份名称
 * @property {string} drilldown - 下钻标识（用于省份下钻）
 * @property {number} value - 该省人数统计
 * @property {Object.<string, Object>} cities - 城市数据映射
 * @property {Array<Object>} people - 该省学生列表
 */
let provinces = {};
Highcharts.each(data, function (d) {
    provinces[d.name] = d;
    d.drilldown = d.name;
    d.value = 0;
    d.cities = {};
    d.people = [];
});

for (let s of students) {
    provinces[s.province].value++;
    provinces[s.province].people.push(s)
}

for (let p of Object.values(provinces)) {
    let filename = p.properties.filename;
    if (!Highcharts.maps[`cn/${filename}`]) {
        continue;
    }
    let subData = p.subData = Highcharts.geojson(Highcharts.maps[`cn/${filename}`]);
    Highcharts.each(subData, function (city) {
        p.cities[city.name] = city;
        city.value = 0;
        city.people = [];
    });
    for (let s of students) {
        if (p.cities[s.city] !== undefined) {
            p.cities[s.city].value++;
            p.cities[s.city].people.push(s);
        }
    }
}

/**
 * Highmaps 地图实例
 * 主地图对象，负责渲染中国地图和处理用户交互
 * @type {Highcharts.Map}
 */
let map = new Highcharts.Map('map', {
    chart: {
        backgroundColor: 'transparent',
        style: {
            fontFamily: "'Nunito', sans-serif"
        },
        events: {
            /**
             * 省份下钻事件处理
             * 当用户点击省份时，切换到该省份的详细地图视图
             * @param {Object} e - 事件对象
             * @param {Object} e.point - 被点击的地图点
             */
            drilldown: function (e) {
                let name = e.point.name;
                this.setTitle(null, {text: name});
                if (this.mapView) {
                    setTimeout(() => {
                        this.mapView.fitToBounds(undefined, undefined, true);
                    }, 50);
                } else if (this.mapZoom) {
                    setTimeout(() => {
                        this.mapZoom();
                    }, 50);
                }
            },
            /**
             * 返回上级地图事件处理
             * 当用户点击返回按钮时，从省份地图返回中国地图
             */
            drillup: function () {
                data = Highcharts.maps['cn/china'];
                this.setTitle(null, {
                    text: '中国'
                });
                if (this.mapView) {
                    setTimeout(() => {
                        this.mapView.fitToBounds(undefined, undefined, true);
                    }, 50);
                } else if (this.mapZoom) {
                    setTimeout(() => {
                        this.mapZoom();
                    }, 50);
                }
            },
            /**
             * 鼠标移出事件处理
             * 隐藏 tooltip
             */
            mouseOut: function () {
                this.tooltip.hide(0);
            }
        }
    },

    title: {
        text: '蹭饭地图',
        style: {
            "color": "#2d2a26",
            "fontSize": "28px",
            "fontFamily": "'DM Serif Display', Georgia, serif",
            "fontWeight": "400",
            "letterSpacing": "0.05em"
        },
        margin: 20
    },

    plotOptions: {
        series: {
            point: {
                events: {
                    /**
                     * 地图点击事件处理
                     * 在触摸设备上显示底部面板而非直接下钻
                     * @param {Object} e - 点击事件对象
                     */
                    click: function (e) {
                        if (isTouchDevice && !this._isDrillingDown) {
                            e.preventDefault();
                            BottomSheet.show(this);
                        }
                    }
                }
            }
        }
    },

    subtitle: {
        text: '中国',
        floating: true,
        y: 50,
        style: {
            fontSize: '16px',
            color: '#5c5650',
            fontFamily: "'Nunito', sans-serif"
        }
    },

    tooltip: {
        enabled: !isTouchDevice,
        useHTML: true,
        backgroundColor: 'transparent',
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        shadow: false,
        followPointer: false,
        showDelay: 250,
        hideDelay: 250,
        style: {
            'pointerEvents': 'auto'
        },
        formatter: formatter,
        /**
         * Tooltip 位置计算函数
         * 确保 tooltip 不会超出图表边界
         * @param {number} labelWidth - tooltip 宽度
         * @param {number} labelHeight - tooltip 高度
         * @param {Object} point - 触发 tooltip 的点位置
         * @returns {Object} tooltip 的 x, y 坐标
         */
        positioner: function (labelWidth, labelHeight, point) {
            let chart = this.chart;
            let pointX = point.plotX || 0;
            let pointY = point.plotY || 0;
            
            let offsetX = 3;
            let offsetY = 3;
            
            let tooltipX = pointX + chart.plotLeft + offsetX;
            let tooltipY = pointY + chart.plotTop + offsetY;
            
            if (tooltipX + labelWidth > chart.chartWidth - 10) {
                tooltipX = pointX + chart.plotLeft - labelWidth - offsetX;
            }
            
            if (tooltipY + labelHeight > chart.chartHeight - 10) {
                tooltipY = pointY + chart.plotTop - labelHeight - offsetY;
            }
            
            if (tooltipX < 10) tooltipX = 10;
            if (tooltipY < 10) tooltipY = pointY + chart.plotTop + offsetY;
            
            return { x: tooltipX, y: tooltipY };
        }
    },

    colorAxis: {
        min: 0,
        max: 15,
        type: 'linear',
        minColor: '#f5efe6',
        maxColor: '#a85a3a',
        stops: [
            [0, '#f5efe6'],
            [0.167, '#e8c4a8'],
            [0.333, '#d9a87c'],
            [0.5, '#c4704b'],
            [0.75, '#b56540'],
            [1, '#a85a3a']
        ]
    },

    legend: {
        enabled: true,
        layout: 'horizontal',
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: {
            color: '#5c5650',
            fontFamily: "'Nunito', sans-serif",
            fontSize: '12px'
        }
    },

    series: [{
        data: data,
        name: '各省人数',
        joinBy: 'name',
        borderColor: '#e0d8cc',
        borderWidth: 1,
        states: {
            hover: {
                borderColor: '#c4704b',
                borderWidth: 2,
                brightness: 0.1
            }
        },
        tooltip: {
            pointFormat: `{point.name}: {point.value}`
        }
    }],

    drilldown: {
        activeDataLabelStyle: {
            color: '#2d2a26',
            textDecoration: 'none',
            textShadow: 'none',
            fontFamily: "'Nunito', sans-serif",
            fontWeight: '600'
        },
        drillUpButton: {
            relativeTo: 'spacingBox',
            position: {
                x: 0,
                y: 60
            },
            theme: {
                fill: '#faf7f2',
                'stroke-width': 1,
                stroke: '#c4704b',
                r: 6,
                style: {
                    color: '#2d2a26',
                    fontFamily: "'Nunito', sans-serif",
                    fontWeight: '600'
                },
                states: {
                    hover: {
                        fill: '#c4704b',
                        style: {
                            color: '#ffffff'
                        }
                    }
                }
            }
        },
        series: makeSeries()
    },

    mapNavigation: {
        enabled: true,
        buttonOptions: {
            verticalAlign: 'bottom',
            theme: {
                fill: '#faf7f2',
                'stroke-width': 1,
                stroke: '#e0d8cc',
                r: 6,
                style: {
                    color: '#5c5650'
                },
                states: {
                    hover: {
                        fill: '#e8a87c',
                        style: {
                            color: '#2d2a26'
                        }
                    }
                }
            }
        }
    },

    credits: {
        enabled: false
    }
});

/**
 * 生成省份下钻系列数据
 * 遍历所有省份，为每个有地图数据的省份创建下钻系列
 * 
 * @returns {Array<Object>} Highcharts 系列配置数组
 * @example
 * // 返回格式
 * [
 *   {
 *     id: '浙江',
 *     name: '浙江',
 *     data: [...], // 省内城市 GeoJSON 数据
 *     ...
 *   },
 *   ...
 * ]
 */
function makeSeries() {
    let series = [];
    for (let p of Object.values(provinces)) {
        if (p.subData) {
            series.push({
                id: p.name,
                name: p.name,
                data: p.subData,
                borderColor: '#e0d8cc',
                borderWidth: 1,
                states: {
                    hover: {
                        borderColor: '#c4704b',
                        borderWidth: 2,
                        brightness: 0.1
                    }
                },
                dataLabels: {
                    enabled: true,
                    format: '{point.name}',
                    style: {
                        color: '#5c5650',
                        fontFamily: "'Nunito', sans-serif",
                        fontSize: '11px',
                        fontWeight: '600',
                        textOutline: 'none'
                    }
                }
            })
        }
    }
    return series;
}

/**
 * Tooltip HTML 模板
 * 使用 Nunjucks 模板语法渲染学生信息列表
 * @constant {string}
 */
const tooltipTemplate = `
    <div class="tooltip">
        <div class="series">{{series}}</div>
        <div class="profile">
            <div class="name">{{name}}:</div>
            <div class="value">{{value}}人</div>
        </div>
        <div class="list">
            {% for p in people %}
            <div class="pinfo">
                <div class="pname">{{p.name}}</div>
                <div class="city">{{p.city}}</div>
                <div class="school">{{p.school}}</div>
            </div>
            {% endfor %}
        </div>
    </div>
    `;

/**
 * Tooltip 格式化函数
 * 使用 Nunjucks 模板引擎渲染 tooltip 内容
 * 
 * @this {Object} Highcharts tooltip 上下文
 * @returns {string} 渲染后的 HTML 字符串
 */
function formatter() {
    return nunjucks.renderString(tooltipTemplate, {
        name: this.point.name,
        series: this.series.name,
        value: this.point.value,
        people: this.point.people
    });
}

/**
 * 底部面板模块（IIFE 模式封装）
 * 用于移动端触摸设备上的交互，替代桌面端的 hover tooltip
 * 
 * @namespace BottomSheet
 * @property {Function} show - 显示底部面板
 * @property {Function} close - 关闭底部面板
 * @property {Function} init - 初始化事件监听
 */
const BottomSheet = (function() {
    /**
     * 当前选中的地图点
     * @type {Object|null}
     * @private
     */
    let currentSelectedPoint = null;
    
    /**
     * 显示底部面板
     * 渲染选中地区的学生信息，并根据是否有下钻选项显示/隐藏详情按钮
     * 
     * @param {Object} point - Highcharts 地图点对象
     * @param {string} point.name - 地区名称
     * @param {string} point.drilldown - 下钻标识（可选）
     * @param {Object} point.series - 系列对象
     * @param {number} point.value - 人数统计
     * @param {Array} point.people - 学生列表
     */
    function show(point) {
        currentSelectedPoint = point;
        
        let html = nunjucks.renderString(tooltipTemplate, {
            name: point.name,
            series: point.series.name,
            value: point.value,
            people: point.people
        });
        document.getElementById('bs-content').innerHTML = html;
        
        const btn = document.getElementById('bs-drilldown-btn');
        if (point.drilldown) {
            btn.style.display = 'block';
            btn.innerText = '进入 ' + point.name + ' 详情';
        } else {
            btn.style.display = 'none';
        }
        
        document.getElementById('bottom-sheet').classList.add('active');
        document.getElementById('bs-overlay').classList.add('active');
    }
    
    /**
     * 关闭底部面板
     * 移除 active 类以触发 CSS 过渡动画
     */
    function close() {
        document.getElementById('bottom-sheet').classList.remove('active');
        document.getElementById('bs-overlay').classList.remove('active');
    }
    
    /**
     * 执行下钻操作
     * 从当前选中的点进入下一级地图视图
     */
    function drilldown() {
        if (currentSelectedPoint) {
            close();
            if (typeof currentSelectedPoint.doDrilldown === 'function') {
                currentSelectedPoint.doDrilldown();
            } else {
                currentSelectedPoint._isDrillingDown = true;
                currentSelectedPoint.firePointEvent('click');
                currentSelectedPoint._isDrillingDown = false;
            }
        }
    }
    
    /**
     * 初始化底部面板事件监听
     * 绑定遮罩层点击关闭和下钻按钮点击事件
     */
    function init() {
        document.getElementById('bs-overlay').addEventListener('click', close);
        document.getElementById('bs-drilldown-btn').addEventListener('click', drilldown);
    }
    
    return { show, close, init };
})();

BottomSheet.init();

/**
 * 分享模块（IIFE 模式封装）
 * 负责生成分享图片和提供分享功能
 * 使用 Canvas 直接合成图片，避免 html2canvas 的浏览器兼容性问题
 * 
 * @namespace ShareManager
 * @property {Function} generateImage - 生成分享图片
 * @property {Function} downloadImage - 下载图片
 * @property {Function} shareToSocial - 分享到社交平台
 * @property {Function} init - 初始化事件监听
 */
const ShareManager = (function() {
    /**
     * 计算统计数据
     * @returns {Object} 统计数据对象
     */
    function calculateStats() {
        let totalPeople = 0;
        let provinceSet = new Set();
        let citySet = new Set();
        
        for (let s of students) {
            totalPeople++;
            provinceSet.add(s.province);
            citySet.add(s.city);
        }
        
        return {
            total: totalPeople,
            provinces: provinceSet.size,
            cities: citySet.size
        };
    }
    
    /**
     * 将 SVG 字符串转换为 Image 对象
     * @param {string} svgString - SVG 字符串
     * @returns {Promise<HTMLImageElement>} Image 对象
     */
    function svgToImage(svgString) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            img.onload = function() {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = function(e) {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });
    }
    
    /**
     * 生成分享图片（使用 Canvas 直接合成）
     * @param {Object} options - 配置选项
     * @returns {Promise<Blob>} 图片 Blob 对象
     */
    async function generateImage(options = {}) {
        const chart = Highcharts.charts[0];
        if (!chart) {
            throw new Error('地图未加载');
        }
        
        const stats = calculateStats();
        
        const svg = chart.getSVG({
            chart: {
                width: 1200,
                height: 800,
                backgroundColor: '#f5efe6'
            }
        });
        
        const mapImg = await svgToImage(svg);
        
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
        
        ctx.fillStyle = 'white';
        ctx.font = '42px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('金鹰1班蹭饭地图', canvas.width / 2, 55);
        
        ctx.font = '18px Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText('探索各地同学的足迹', canvas.width / 2, 105);
        
        ctx.drawImage(mapImg, 0, 150, 1200, 800);
        
        ctx.fillStyle = '#fffaf5';
        ctx.fillRect(0, 950, canvas.width, 100);
        
        const statY = 990;
        const statLabelY = 1020;
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(stats.total.toString(), 200, statY);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('总人数', 200, statLabelY);
        
        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(stats.provinces.toString(), 600, statY);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('覆盖省份', 600, statLabelY);
        
        ctx.fillStyle = '#c4704b';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText(stats.cities.toString(), 1000, statY);
        ctx.fillStyle = '#5c5650';
        ctx.font = '16px Arial, sans-serif';
        ctx.fillText('覆盖城市', 1000, statLabelY);
        
        ctx.fillStyle = '#f5efe6';
        roundRect(ctx, 0, 1050, canvas.width, 50, 0, true, false, [0, 0, 24, 24]);
        
        ctx.fillStyle = '#5c5650';
        ctx.font = '14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('万州二中 · 金鹰1班', canvas.width / 2, 1075);
        
        return new Promise((resolve, reject) => {
            canvas.toBlob(function(blob) {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('生成图片失败'));
                }
            }, 'image/png', 0.95);
        });
    }
    
    /**
     * 绘制圆角矩形
     * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
     * @param {number} x - 起始 X 坐标
     * @param {number} y - 起始 Y 坐标
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 圆角半径
     * @param {boolean} fill - 是否填充
     * @param {boolean} stroke - 是否描边
     * @param {Array} corners - 四个角的圆角 [tl, tr, br, bl]
     */
    function roundRect(ctx, x, y, width, height, radius, fill, stroke, corners) {
        corners = corners || [radius, radius, radius, radius];
        const [tl, tr, br, bl] = corners;
        
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
     * 下载图片
     * @param {Blob} blob - 图片 Blob
     * @param {string} filename - 文件名
     */
    function downloadImage(blob, filename) {
        filename = filename || '蹭饭地图_' + new Date().toISOString().slice(0, 10) + '.png';
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
    
    /**
     * 下载图片（直接下载，不走 Web Share API）
     * @param {Blob} blob - 图片 Blob
     */
    async function shareToSocial(blob) {
        downloadImage(blob);
        return true;
    }
    
    /**
     * 处理分享按钮点击
     */
    async function handleShare() {
        const btn = document.getElementById('share-btn');
        if (!btn) return;
        
        btn.classList.add('loading');
        btn.disabled = true;
        
        try {
            const blob = await generateImage();
            await shareToSocial(blob);
        } catch (error) {
            console.error('生成分享图片失败:', error);
            alert('生成分享图片失败，请稍后重试');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
    
    /**
     * 初始化分享模块事件监听
     */
    function init() {
        const btn = document.getElementById('share-btn');
        if (btn) {
            btn.addEventListener('click', handleShare);
        }
    }
    
    return { generateImage, downloadImage, shareToSocial, init };
})();

ShareManager.init();

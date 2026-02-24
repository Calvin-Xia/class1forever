const isTouchDevice = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

let data = Highcharts.geojson(Highcharts.maps['cn/china']);

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

let map = new Highcharts.Map('map', {
    chart: {
        backgroundColor: 'transparent',
        style: {
            fontFamily: "'Nunito', sans-serif"
        },
        events: {
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
                    click: function (e) {
                        if (isTouchDevice && !this._isDrillingDown) {
                            e.preventDefault(); // 阻止默认的即时下钻
                            showMobileBottomSheet(this);
                            return false;
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
        positioner: function (labelWidth, labelHeight, point) {
            let chart = this.chart;
            let pointX = point.plotX || 0;
            let pointY = point.plotY || 0;
            
            let offsetX = 1;
            let offsetY = 1;
            
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

function formatter() {
    return nunjucks.renderString(tooltipTemplate, {
        name: this.point.name,
        series: this.series.name,
        value: this.point.value,
        people: this.point.people
    });
}

let currentSelectedPoint = null;

function showMobileBottomSheet(point) {
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

function closeBottomSheet() {
    document.getElementById('bottom-sheet').classList.remove('active');
    document.getElementById('bs-overlay').classList.remove('active');
}

document.getElementById('bs-overlay').addEventListener('click', closeBottomSheet);

document.getElementById('bs-drilldown-btn').addEventListener('click', function() {
    if (currentSelectedPoint) {
        closeBottomSheet();
        if (typeof currentSelectedPoint.doDrilldown === 'function') {
            currentSelectedPoint.doDrilldown();
        } else {
            // Fallback for Highcharts trigger
            currentSelectedPoint._isDrillingDown = true;
            currentSelectedPoint.firePointEvent('click');
            currentSelectedPoint._isDrillingDown = false;
        }
    }
});

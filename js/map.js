const isTouchDevice = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const MAP_VERSION = '1.6.3';
const MAP_BASE = './maps/china/' + MAP_VERSION;

const topoCache = new Map();

function normalizeRegionName(name) {
    if (!name) {
        return '';
    }

    return String(name)
        .trim()
        .replace(/(特别行政区|自治州|自治县|自治旗|地区|盟|市辖区|新区|矿区|林区|县|区|市)$/g, '');
}

async function loadTopo(filename) {
    const key = String(filename).replace(/\.topo\.json$/i, '');

    if (!topoCache.has(key)) {
        topoCache.set(
            key,
            fetch(`${MAP_BASE}/${key}.topo.json`).then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
        );
    }

    return topoCache.get(key);
}

function makeNameIndex(points) {
    const index = {};

    Highcharts.each(points, function (point) {
        const names = [
            point.name,
            point.properties && point.properties.name,
            point.properties && point.properties.fullname
        ];

        names.forEach((name) => {
            if (!name) {
                return;
            }

            index[name] = point;
            index[normalizeRegionName(name)] = point;
        });
    });

    return index;
}

function formatter() {
    return nunjucks.renderString(tooltipTemplate, {
        name: this.point.name,
        series: this.series.name,
        value: this.point.value,
        people: this.point.people
    });
}

function createCityIndex(cities) {
    const index = {};

    Highcharts.each(cities, function (city) {
        const names = [
            city.name,
            city.properties && city.properties.name,
            city.properties && city.properties.fullname
        ];

        names.forEach((name) => {
            if (!name) {
                return;
            }
            index[name] = city;
            index[normalizeRegionName(name)] = city;
        });

        city.value = 0;
        city.people = [];
    });

    return index;
}

function setProvincePeople(provinceByName, studentList) {
    for (const student of studentList) {
        const province = provinceByName[student.province] || provinceByName[normalizeRegionName(student.province)];

        if (!province) {
            console.warn('Unknown province in data:', student.province, student);
            continue;
        }

        province.value += 1;
        province.people.push(student);
    }
}

function applyProvinceCityData(provincePoint, cityPoints) {
    const cityByName = createCityIndex(cityPoints);

    for (const student of provincePoint.people || []) {
        const city = cityByName[student.city] || cityByName[normalizeRegionName(student.city)];

        if (!city) {
            console.warn('Unknown city in data:', student.city, student);
            continue;
        }

        city.value += 1;
        city.people.push(student);
    }
}

function showMobileBottomSheet(point) {
    currentSelectedPoint = point;

    const html = nunjucks.renderString(tooltipTemplate, {
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

let currentSelectedPoint = null;

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

async function initMap() {
    const chinaTopo = await loadTopo('100000');
    const data = Highcharts.geojson(chinaTopo, 'map');
    const provinces = {};

    Highcharts.each(data, function (d) {
        const filename = (d.properties && (d.properties.filename || d.properties.code)) || '';
        const drilldownKey = String(filename).split('/').pop();

        d.drilldown = drilldownKey || null;
        d.value = 0;
        d.cities = {};
        d.people = [];

        provinces[d.name] = d;
    });

    const provinceByName = makeNameIndex(data);
    setProvincePeople(provinceByName, students);

    new Highcharts.Map('map', {
        chart: {
            backgroundColor: 'transparent',
            style: {
                fontFamily: "'Nunito', sans-serif"
            },
            events: {
                drilldown: async function (e) {
                    const name = e.point.name;
                    this.setTitle(null, { text: name });

                    if (!e.seriesOptions && e.point.drilldown) {
                        e.preventDefault();

                        try {
                            const provinceTopo = await loadTopo(e.point.drilldown);
                            const subData = Highcharts.geojson(provinceTopo, 'map');

                            applyProvinceCityData(e.point, subData);

                            this.addSeriesAsDrilldown(e.point, {
                                id: e.point.drilldown,
                                name: e.point.name,
                                data: subData,
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
                            });
                        } catch (error) {
                            console.error('Failed to load drilldown map:', e.point.drilldown, error);
                        }
                    }

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
                color: '#2d2a26',
                fontSize: '28px',
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontWeight: '400',
                letterSpacing: '0.05em'
            },
            margin: 20
        },

        plotOptions: {
            series: {
                point: {
                    events: {
                        click: function (e) {
                            if (isTouchDevice && !this._isDrillingDown) {
                                e.preventDefault();
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
                pointerEvents: 'auto'
            },
            formatter: formatter,
            positioner: function (labelWidth, labelHeight, point) {
                const chart = this.chart;
                const pointX = point.plotX || 0;
                const pointY = point.plotY || 0;

                const offsetX = 3;
                const offsetY = 3;

                let tooltipX = pointX + chart.plotLeft + offsetX;
                let tooltipY = pointY + chart.plotTop + offsetY;

                if (tooltipX + labelWidth > chart.chartWidth - 10) {
                    tooltipX = pointX + chart.plotLeft - labelWidth - offsetX;
                }

                if (tooltipY + labelHeight > chart.chartHeight - 10) {
                    tooltipY = pointY + chart.plotTop - labelHeight - offsetY;
                }

                if (tooltipX < 10) {
                    tooltipX = 10;
                }
                if (tooltipY < 10) {
                    tooltipY = pointY + chart.plotTop + offsetY;
                }

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
                pointFormat: '{point.name}: {point.value}'
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
            series: []
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
}

document.getElementById('bs-overlay').addEventListener('click', closeBottomSheet);

document.getElementById('bs-drilldown-btn').addEventListener('click', function () {
    if (currentSelectedPoint) {
        closeBottomSheet();
        if (typeof currentSelectedPoint.doDrilldown === 'function') {
            currentSelectedPoint.doDrilldown();
        } else {
            currentSelectedPoint._isDrillingDown = true;
            currentSelectedPoint.firePointEvent('click');
            currentSelectedPoint._isDrillingDown = false;
        }
    }
});

initMap().catch((error) => {
    console.error('Failed to initialize map:', error);
});

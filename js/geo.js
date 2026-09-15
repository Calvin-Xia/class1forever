/**
 * @fileoverview 地图几何数据的轻量注册表。
 *
 * js/china.js 与 js/province/*.js 是构建期从上游地图数据包导出的 GeoJSON，
 * 只在这里登记，不依赖任何图表库。js/map.js 再把需要的条目交给 ECharts 渲染。
 * 这样替换渲染库时不需要改动 2MB 级的几何数据文件。
 */

(function (global) {
    /**
     * 仓库里确实存在 js/province/<name>.js 的省份。
     *
     * 中国地图的 GeoJSON 给台湾、香港、澳门、南海诸岛也标了 filename，
     * 但仓库没有对应的省级地图文件。登记这份白名单后，点击这些地区会直接
     * 打开聚合信息面板，而不是先发一个必然 404 的脚本请求。
     * build.js 会校验这份名单和 js/province/ 目录保持一致。
     */
    const AVAILABLE_PROVINCE_FILES = [
        'anhui',
        'beijing',
        'chongqing',
        'fujian',
        'gansu',
        'guangdong',
        'guangxi',
        'guizhou',
        'hainan',
        'hebei',
        'heilongjiang',
        'henan',
        'hubei',
        'hunan',
        'jiangsu',
        'jiangxi',
        'jilin',
        'liaoning',
        'neimenggu',
        'ningxia',
        'qinghai',
        'shandong',
        'shanghai',
        'shanxi',
        'shanxi2',
        'sichuan',
        'tianjin',
        'xinjiang',
        'xizang',
        'yunnan',
        'zhejiang'
    ];

    const maps = Object.create(null);
    const provinceFiles = new Set(AVAILABLE_PROVINCE_FILES);

    function register(id, geoJson) {
        maps[id] = geoJson;
    }

    function has(id) {
        return Object.prototype.hasOwnProperty.call(maps, id);
    }

    function get(id) {
        return has(id) ? maps[id] : null;
    }

    function hasProvinceFile(filename) {
        return typeof filename === 'string' && provinceFiles.has(filename);
    }

    global.CMapGeo = {
        register: register,
        has: has,
        get: get,
        hasProvinceFile: hasProvinceFile,
        availableProvinceFiles: AVAILABLE_PROVINCE_FILES
    };
})(window);

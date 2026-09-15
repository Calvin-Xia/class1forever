/**
 * @fileoverview 页面启动脚本。
 *
 * 按顺序加载地图依赖：先渲染库，再几何数据，最后页面逻辑。
 * 任何一步失败都会显示错误面板，并提供重新加载入口。
 */

(function () {
    'use strict';

    const SCRIPT_ORDER = [
        'js/vendor/echarts.min.js',
        'js/geo.js',
        'js/china.js',
        'js/map.js'
    ];

    const FAILURE_MESSAGES = {
        'js/vendor/echarts.min.js': '地图渲染库加载失败，请刷新页面重试。',
        'js/geo.js': '地图数据加载失败，请刷新页面重试。',
        'js/china.js': '中国地图数据加载失败，请刷新页面重试。',
        'js/map.js': '页面逻辑加载失败，请刷新页面重试。'
    };

    function showFatalError(message) {
        const panel = document.getElementById('cdn-error');
        const title = document.getElementById('cdn-error-title');
        const text = document.getElementById('cdn-error-message');
        const loading = document.getElementById('map-loading');

        if (title) {
            title.textContent = '地图加载失败';
        }
        if (text) {
            text.textContent = message;
        }
        if (panel) {
            panel.style.display = 'flex';
        }
        if (loading) {
            loading.style.display = 'none';
        }
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = src;
            script.onload = function () {
                resolve();
            };
            script.onerror = function () {
                const error = new Error('Failed to load script: ' + src);
                error.src = src;
                reject(error);
            };
            document.head.appendChild(script);
        });
    }

    function loadSequentially(sources) {
        return sources.reduce(function (chain, src) {
            return chain.then(function () {
                return loadScript(src);
            });
        }, Promise.resolve());
    }

    function bindRetryButton() {
        const button = document.getElementById('cdn-error-retry');
        if (button) {
            button.addEventListener('click', function () {
                window.location.reload();
            });
        }
    }

    function start() {
        bindRetryButton();

        loadSequentially(SCRIPT_ORDER).catch(function (error) {
            console.error(error);
            const failedSource = error && error.src;
            showFatalError(
                FAILURE_MESSAGES[failedSource] || '无法加载地图资源，请检查网络连接后刷新页面。'
            );
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

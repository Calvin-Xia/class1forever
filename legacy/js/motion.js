/**
 * @fileoverview 纸本图志的 L2 动效层。
 *
 * 只做三件事，都刻意做得很轻：
 *   1. 光标墨晕 —— 把指针位置写进 --mx/--my，由 .atmosphere__glow 的
 *      radial-gradient 消费。每帧只重绘那一层，不碰纸纹与网格。
 *   2. 按钮磁吸 —— 把位移写进 --magnet-x/--magnet-y，由 .magnet 的 transform 消费。
 *   3. 卡片聚光 —— 把指针位置写进 --sx/--sy，由 .spotlight::after 消费。
 *
 * 为什么不引 GSAP / Lenis：本项目 CSP 是 script-src 'self'，跨域脚本会被
 * build.js 直接拦下；而且这是一个单屏工具页，没有滚动叙事，滚动库只有成本。
 *
 * 降级：prefers-reduced-motion 或没有精确指针的设备上，整个文件不注册任何监听。
 * 所有 pointermove 监听都走 rAF 节流，一帧最多算一次。
 */

(function () {
    'use strict';

    if (!window.matchMedia || !window.requestAnimationFrame) {
        return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    if (reduceMotion || !canHover) {
        return;
    }

    const root = document.documentElement;

    /** 把高频事件压到每帧一次。 */
    function rafThrottle(handler) {
        let frame = 0;
        let latest = null;

        return function (event) {
            latest = event;
            if (frame) {
                return;
            }

            frame = window.requestAnimationFrame(function () {
                frame = 0;
                handler(latest);
            });
        };
    }

    /* 1. 光标墨晕：整页共用一个监听，写在 :root 上 */
    const atmosphere = document.querySelector('.atmosphere');

    if (atmosphere) {
        const trackGlow = rafThrottle(function (event) {
            root.style.setProperty('--mx', event.clientX + 'px');
            root.style.setProperty('--my', event.clientY + 'px');
        });

        window.addEventListener('pointermove', trackGlow, { passive: true });
    }

    /* 2. 按钮磁吸：位移上限 4px，再多就不像纸面该有的手感了 */
    const MAGNET_STRENGTH = 4;

    document.querySelectorAll('.magnet').forEach(function (element) {
        // 元素自己会被 translate 推动，每帧重新测量会形成反馈抖动；
        // 位移只有几像素，进场时量一次就够。
        let rect = null;

        const trackMagnet = rafThrottle(function (event) {
            if (!rect) {
                rect = element.getBoundingClientRect();
            }

            const offsetX = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2 || 1);
            const offsetY = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2 || 1);

            element.style.setProperty('--magnet-x', (offsetX * MAGNET_STRENGTH).toFixed(2) + 'px');
            element.style.setProperty('--magnet-y', (offsetY * MAGNET_STRENGTH).toFixed(2) + 'px');
        });

        element.addEventListener('pointerenter', function () {
            rect = element.getBoundingClientRect();
        }, { passive: true });

        element.addEventListener('pointermove', trackMagnet, { passive: true });

        element.addEventListener('pointerleave', function () {
            rect = null;
            element.style.setProperty('--magnet-x', '0px');
            element.style.setProperty('--magnet-y', '0px');
        }, { passive: true });
    });

    /* 3. 卡片聚光：把指针打在按钮上的位置换算成百分比，交给 radial-gradient */
    document.querySelectorAll('.spotlight').forEach(function (element) {
        let rect = null;

        const trackSpotlight = rafThrottle(function (event) {
            if (!rect) {
                rect = element.getBoundingClientRect();
            }

            if (!rect.width || !rect.height) {
                return;
            }

            element.style.setProperty('--sx', ((event.clientX - rect.left) / rect.width * 100).toFixed(2) + '%');
            element.style.setProperty('--sy', ((event.clientY - rect.top) / rect.height * 100).toFixed(2) + '%');
        });

        element.addEventListener('pointerenter', function () {
            rect = element.getBoundingClientRect();
        }, { passive: true });

        element.addEventListener('pointermove', trackSpotlight, { passive: true });

        element.addEventListener('pointerleave', function () {
            rect = null;
        }, { passive: true });
    });
})();

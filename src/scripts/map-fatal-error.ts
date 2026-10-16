/**
 * 资源加载失败兜底面板（`#cdn-error`）的显示入口。
 *
 * 单独放一个小模块、**不带任何 import**，是 #11 的硬要求倒逼出来的：
 * 「重新加载」按钮的绑定与面板显示必须落在**一定会执行的入口 chunk** 里。
 * 岛屿是 `.astro` 里的 `<script>` 用动态 `import()` 挂载的（见 MapSection.astro），
 * 一旦那个 chunk 加载失败（断网 / 部署换版后旧 chunk 404），写在岛屿模块里的兜底
 * 代码根本不会被执行 —— 面板永远不显示，按钮也永远是死链。入口 chunk 只静态引用
 * 本模块，既不把 ECharts / 几何数据拉进首屏，也不会随岛屿 chunk 一起失效。
 *
 * 行为与旧实现（`js/boot.js` 的 `showFatalError`）一致：面板是全屏接管，显示后
 * 焦点必须跟着移进「重新加载」。差异只有一处：这里用 `preventScroll`，
 * 面板本身是 `position: fixed`，浏览器默认还会顺手滚动页面，把焦点带到一个
 * 用户没有预期的滚动位置。
 */
export function revealMapFatalError(message: string, title?: string): void {
    if (typeof document === 'undefined') {
        return;
    }

    const panel = document.getElementById('cdn-error');
    if (!panel) {
        return;
    }

    const titleElement = document.getElementById('cdn-error-title');
    const messageElement = document.getElementById('cdn-error-message');
    const retry = document.getElementById('cdn-error-retry') as HTMLButtonElement | null;
    const loading = document.getElementById('map-loading');
    const map = document.getElementById('map');

    if (titleElement) {
        titleElement.textContent = title || '地图加载失败';
    }
    if (messageElement) {
        messageElement.textContent = message;
    }

    panel.style.display = 'flex';

    // 面板盖住了地图，加载指示继续转只会让人以为还有救。
    if (loading) {
        loading.style.display = 'none';
    }
    if (map) {
        map.setAttribute('aria-busy', 'false');
    }

    retry?.focus({ preventScroll: true });
}

'use strict';
const path = require('node:path');
const fs = require('node:fs');

/**
 * 白名单式环境变量构造：只把系统路径类变量透传给本地构建/夹具子进程，其余变量
 * （Token、DEBUG、生产来源、应用秘密等）一律丢弃，并显式指向仓库内的 TEMP/TMP。
 *
 * 注意这是**环境变量白名单**，不是登录态隔离：子进程仍以当前用户、当前工作区身份运行，
 * 磁盘上的凭据（例如 wrangler 在用户目录里的登录态）不在本函数的约束范围内。
 */
function localToolEnvironment(extra = {}) {
    const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'CI'];
    const root = path.resolve(__dirname, '..');
    const temp = path.join(root, '.wrangler/probe-tmp');
    const logs = path.join(root, '.wrangler/logs');
    fs.mkdirSync(temp, { recursive: true });
    fs.mkdirSync(logs, { recursive: true });
    return {
        ...Object.fromEntries(allowed.filter(name => process.env[name]).map(name => [name, process.env[name]])),
        TEMP: temp, TMP: temp, WRANGLER_LOG_PATH: logs,
        WRANGLER_SEND_METRICS: 'false', ASTRO_TELEMETRY_DISABLED: '1', ...extra
    };
}
module.exports = { localToolEnvironment };

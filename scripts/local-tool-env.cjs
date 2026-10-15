'use strict';
const path = require('node:path');
const fs = require('node:fs');

/** 本地构建/夹具子进程仅继承系统路径；不继承 Token、DEBUG、生产来源或应用秘密。 */
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

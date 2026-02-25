const fs = require('fs');
const path = require('path');

const MAP_VERSION = '1.6.3';
const API_BASE = MAP_VERSION
    ? `https://geojson.cn/api/china/${MAP_VERSION}`
    : 'https://geojson.cn/api/china';
const OUTPUT_DIR = path.join(__dirname, '..', 'maps', 'china', MAP_VERSION || 'latest');

function getNodeChildren(node) {
    if (!node || !Array.isArray(node.children)) {
        return [];
    }
    return node.children;
}

function collectProvinceFilenames(metaFiles) {
    const countryNode = Array.isArray(metaFiles) ? metaFiles.find((item) => item && item.filename === '100000') : null;
    const provinceNodes = countryNode ? getNodeChildren(countryNode) : [];

    const filenames = provinceNodes
        .map((province) => String(province.filename || '').trim())
        .filter((filename) => /^\d{6}$/.test(filename));

    return Array.from(new Set(filenames));
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} - ${url}`);
    }
    return response.json();
}

async function downloadTopo(filename) {
    const url = `${API_BASE}/${filename}.topo.json`;
    const outputFile = path.join(OUTPUT_DIR, `${filename}.topo.json`);

    try {
        const response = await fetch(url);

        if ([401, 403].includes(response.status)) {
            console.error(`⚠️  无权限下载 ${filename}: HTTP ${response.status}`);
            return false;
        }

        if (!response.ok) {
            console.error(`⚠️  下载失败 ${filename}: HTTP ${response.status} ${response.statusText}`);
            return false;
        }

        const text = await response.text();
        fs.writeFileSync(outputFile, text, 'utf8');
        console.log(`✅ 已下载 ${filename}.topo.json`);
        return true;
    } catch (error) {
        console.error(`⚠️  下载异常 ${filename}: ${error.message}`);
        return false;
    }
}

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const metaUrl = `${API_BASE}/_meta.json`;
    console.log(`ℹ️  拉取元数据: ${metaUrl}`);
    const meta = await fetchJson(metaUrl);

    const provinceFilenames = collectProvinceFilenames(meta.files);
    console.log(`ℹ️  发现省级文件 ${provinceFilenames.length} 个`);

    await downloadTopo('100000');

    for (const filename of provinceFilenames) {
        await downloadTopo(filename);
    }

    console.log(`✅ 同步完成，输出目录: ${OUTPUT_DIR}`);
}

main().catch((error) => {
    console.error(`❌ 同步失败: ${error.message}`);
    process.exit(1);
});

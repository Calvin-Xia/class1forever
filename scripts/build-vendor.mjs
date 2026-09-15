/**
 * 生成 js/vendor/echarts.min.js。
 *
 * 页面直接使用仓库里已提交的产物，这个脚本只在升级 ECharts 时手动执行。
 */
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = path.join(rootDirectory, 'scripts', 'vendor', 'echarts-entry.mjs');
const outputFile = path.join(rootDirectory, 'js', 'vendor', 'echarts.min.js');

mkdirSync(path.dirname(outputFile), { recursive: true });

const result = await build({
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'echarts',
    target: ['es2019'],
    legalComments: 'none',
    charset: 'utf8',
    banner: {
        js: '/*! ECharts (Apache-2.0) - 按需构建，仅含 map / geo / tooltip / visualMap / canvas。源码与许可证见 https://github.com/apache/echarts */'
    },
    metafile: true
});

const sizeInKb = (statSync(outputFile).size / 1024).toFixed(1);
const inputs = Object.keys(result.metafile.inputs).length;

console.log(`✅ 已生成 ${path.relative(rootDirectory, outputFile)} (${sizeInKb} KB, ${inputs} 个模块)`);

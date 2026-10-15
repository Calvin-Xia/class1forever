import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { checkFontSubsets } from './check-font-subsets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = path.join(root, '.edgeone-build');
const output = path.join(root, 'dist-edgeone');
const assets = path.join(output, 'static');
const routes = ['api/map/public', 'api/map/details', 'api/auth/details', 'api/auth/logout'];
const artifactsOnly = process.argv.includes('--artifacts-only');
const packageCli = process.argv.includes('--package-cli');
checkFontSubsets();
for (const argument of process.argv.slice(2)) {
    if (!['--artifacts-only', '--package-cli'].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
}

function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Symbolic links are not accepted in the build surface.');
        return entry.isDirectory() ? walk(file) : [file];
    });
}

function removeGenerated(directory) {
    const resolved = path.resolve(directory);
    if (![stage, output].includes(resolved) || path.dirname(resolved) !== path.resolve(root)) {
        throw new Error('Refusing to remove a directory outside the two generated build roots.');
    }
    fs.rmSync(resolved, { force: true, recursive: true });
}

function runNode(script, argumentsList, cwd = root, environment = process.env) {
    const result = spawnSync(process.execPath, [script, ...argumentsList], { cwd, env: environment, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Build subprocess failed (${result.status ?? result.signal}).`);
}

function buildEnvironment() {
    const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'];
    return { ...Object.fromEntries(allowed.filter((name) => process.env[name]).map((name) => [name, process.env[name]])), TEMP: path.join(stage, 'tmp'), TMP: path.join(stage, 'tmp'), CI: 'true', ASTRO_TELEMETRY_DISABLED: '1' };
}

function readSecurityHeaders() {
    const lines = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
    if (lines.shift() !== '/*') throw new Error('Expected one global public/_headers block.');
    const global = lines.slice(0, lines.findIndex(line => line.trim() === '') < 0 ? lines.length : lines.findIndex(line => line.trim() === ''));
    return global.map((line) => {
        const match = line.match(/^\s+([^:]+):\s*(.+)$/);
        if (!match) throw new Error('Unexpected public/_headers syntax.');
        return { key: match[1], value: match[2] };
    });
}

function edgeoneConfiguration() {
    return {
        installCommand: 'node -e "process.exit(0)"',
        buildCommand: 'node -e "process.exit(0)"',
        outputDirectory: './static',
        headers: [
            { source: '/*', headers: readSecurityHeaders() },
            { source: '/', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
            { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
            { source: '/deployment-assets.json', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
            { source: '/_astro/*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
            { source: '/fonts/subsets/*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
            { source: '/fonts/dm-serif-display.7e6679d41e35.woff2', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
            { source: '/api/*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }
        ]
    };
}

if (!artifactsOnly) {
    removeGenerated(stage);
    removeGenerated(output);
    fs.mkdirSync(stage, { recursive: true });
    fs.mkdirSync(path.join(stage, 'tmp'), { recursive: true });
    const src = path.join(root, 'src');
    fs.cpSync(src, path.join(stage, 'src'), {
        recursive: true,
        filter: (file) => {
            const relative = path.relative(src, file).replaceAll('\\', '/');
            return relative !== 'middleware.ts' && relative !== 'pages/api' && !relative.startsWith('pages/api/');
        }
    });
    // The unchanged geo loader resolves ../../js; copy only its generated geometry inputs.
    fs.mkdirSync(path.join(stage, 'js'), { recursive: true });
    fs.copyFileSync(path.join(root, 'js/china.js'), path.join(stage, 'js/china.js'));
    fs.cpSync(path.join(root, 'js/province'), path.join(stage, 'js/province'), { recursive: true });
    runNode(path.join(root, 'node_modules/astro/bin/astro.mjs'), ['build', '--config', 'astro.edgeone.config.mjs'], root, buildEnvironment());
    // EdgeOne consumes edgeone.json; the Cloudflare-only _headers file is not published there.
    fs.rmSync(path.join(assets, '_headers'), { force: true });
    for (const route of routes) {
        await build({
            entryPoints: [path.join(root, 'edge-functions', `${route}.ts`)],
            outfile: path.join(output, 'edge-functions', `${route}.js`),
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            sourcemap: false,
            metafile: true,
            legalComments: 'none'
        }).then((result) => {
            for (const input of Object.keys(result.metafile.inputs)) {
                if (/echarts|js[\\/]province|js[\\/]china|src[\\/]components|src[\\/]platform[\\/]cloudflare/.test(input)) {
                    throw new Error(`Unexpected module in EdgeOne API bundle: ${input}`);
                }
            }
        });
    }
    fs.writeFileSync(path.join(output, 'package.json'), '{"private":true,"type":"module"}\n');
    fs.writeFileSync(path.join(output, 'edgeone.json'), `${JSON.stringify(edgeoneConfiguration(), null, 4)}\n`);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const secretValues = fs.existsSync(path.join(root, '.dev.vars'))
    ? fs.readFileSync(path.join(root, '.dev.vars'), 'utf8').split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
        if (!match || !/(PASSPHRASE|SECRET|TOKEN|_KEY)$/i.test(match[1])) return [];
        const value = match[2].replace(/^["']|["']$/g, '');
        return value.length >= 6 ? [value] : [];
    }) : [];
for (const [name, value] of Object.entries(process.env)) {
    if (/(PASSPHRASE|SECRET|TOKEN|_KEY)$/i.test(name) && value && value.length >= 6) secretValues.push(value);
}

function scan(directory, staticSurface = false) {
    for (const file of walk(directory)) {
        const relative = path.relative(directory, file).replaceAll('\\', '/');
        assert(!/\.dev\.vars|(?:^|\/)\.env(?:\.|$)|(?:^|\/)data\.js$|\.map$/.test(relative), `Forbidden build filename: ${relative}`);
        const buffer = fs.readFileSync(file);
        if (buffer.subarray(0, 8000).includes(0)) continue;
        const content = buffer.toString('utf8');
        for (const secret of secretValues) assert(!content.includes(secret), `Local secret value present in build file: ${relative}`);
        assert(!content.includes('cloudflare:workers'), `Cloudflare runtime reference in EdgeOne artifact: ${relative}`);
        assert(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(content), `Google Fonts dependency in EdgeOne artifact: ${relative}`);
        assert(!/DETAILS_(?:PASSPHRASE|SESSION_SECRET)\s*[:=]\s*['"`]([^'"`]{6,})['"`]/.test(content), `Hardcoded credential in artifact: ${relative}`);
        if (staticSurface) {
            for (const token of ['students:raw:v1', 'students_raw_', 'classmap_runtime_config', 'DETAILS_PASSPHRASE', 'DETAILS_SESSION_SECRET', 'js/data.js']) {
                assert(!content.includes(token), `Server-only token in static artifact: ${relative}`);
            }
        }
        if (relative.endsWith('.html')) {
            for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                const source = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
                assert(source && /^\/(?!\/)/.test(source[1]) && match[2].trim() === '', `Inline or cross-origin script in ${relative}`);
            }
        }
    }
}

assert(fs.existsSync(path.join(assets, 'index.html')), 'EdgeOne static homepage is missing.');
assert(!fs.existsSync(path.join(assets, 'api')), 'Static assets must not shadow API routes.');
assert(!fs.existsSync(path.join(root, 'index.html')), 'The archived root index.html must stay absent.');
for (const route of routes) {
    const file = path.join(output, 'edge-functions', `${route}.js`);
    assert(fs.existsSync(file), `Missing compiled API route: ${route}`);
    assert(fs.statSync(file).size < 5 * 1024 * 1024, `API bundle exceeds 5 MB: ${route}`);
}
assert(JSON.stringify(JSON.parse(fs.readFileSync(path.join(output, 'edgeone.json'), 'utf8'))) === JSON.stringify(edgeoneConfiguration()), 'Generated EdgeOne headers/configuration drifted from source.');
assert(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'edgeone.json'), 'utf8')).headers) === JSON.stringify(edgeoneConfiguration().headers), 'Repository EdgeOne headers/configuration drifted from public/_headers.');
scan(output);
scan(assets, true);
checkFontSubsets(assets);

if (packageCli) {
    const cli = process.env.EDGEONE_CLI_ENTRY;
    assert(cli && fs.existsSync(cli), 'Set EDGEONE_CLI_ENTRY to the installed edgeone/edgeone-dist/cli.js for local packaging.');
    // Never let CLI read .env, .dev.vars, login state, or inherit application secrets.
    const environment = buildEnvironment();
    runNode(cli, ['makers', 'build'], output, environment);
    fs.writeFileSync(path.join(output, '.edgeone/edgeone.json'), `${JSON.stringify({ ...edgeoneConfiguration(), outputDirectory: './assets' }, null, 4)}\n`);
    scan(path.join(output, '.edgeone'));
    scan(path.join(output, '.edgeone/assets'), true);
    assert(fs.existsSync(path.join(output, '.edgeone/assets/index.html')), 'CLI package is missing homepage assets.');
    assert(fs.existsSync(path.join(output, '.edgeone/edge-functions/index.js')), 'CLI package is missing the edge function entrypoint.');
    const packagedRoutes = JSON.parse(fs.readFileSync(path.join(output, '.edgeone/edge-functions/config.json'), 'utf8'));
    assert(packagedRoutes.middleware === null &&
        JSON.stringify(packagedRoutes.routes.map((route) => route.src).sort()) === JSON.stringify(routes.map((route) => `^/${route}$`).sort()),
    'CLI package routes drifted from the four API endpoints.');
    console.log('EdgeOne CLI package scanned: dist-edgeone/.edgeone (deployment remains gated).');
}
console.log(`EdgeOne static/API artifact checks passed (${walk(assets).length} static files, ${routes.length} bundled API routes).`);

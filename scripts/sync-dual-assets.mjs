import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same-host GeoDNS may change platforms between loading a page and importing a
// lazy chunk. Both deployments must serve the complete set of public chunks.
export function syncDualAssets(cloudflare, edgeone) {
    function inventory(directory) {
        if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('DUAL_ASSET_SYMLINK');
        const files = new Map();
        function visit(current) {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const file = path.join(current, entry.name);
                if (entry.isSymbolicLink()) throw new Error('DUAL_ASSET_SYMLINK');
                if (entry.isDirectory()) visit(file);
                else if (entry.isFile()) {
                    if (/\.map$|\.env|\.dev\.vars/i.test(entry.name)) throw new Error('DUAL_ASSET_PRIVATE_FILE');
                    files.set(path.relative(directory, file), fs.readFileSync(file));
                } else throw new Error('DUAL_ASSET_UNSUPPORTED_FILE');
            }
        }
        visit(directory);
        if (!files.size) throw new Error('DUAL_ASSET_EMPTY');
        return files;
    }
    const cf = inventory(cloudflare);
    const eo = inventory(edgeone);
    // Validate the entire union before writing either side. A shared URL must
    // never serve different bytes depending on DNS or the browser cache.
    for (const [name, bytes] of cf) {
        if (eo.has(name) && !eo.get(name).equals(bytes)) throw new Error('DUAL_ASSET_URL_COLLISION');
    }
    let copiedToCloudflare = 0;
    let copiedToEdgeone = 0;
    for (const [source, destination, directory] of [[cf, eo, edgeone], [eo, cf, cloudflare]]) {
        for (const [name, bytes] of source) {
            if (destination.has(name)) continue;
            const file = path.join(directory, name);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, bytes, { flag: 'wx' });
            if (directory === edgeone) copiedToEdgeone += 1;
            else copiedToCloudflare += 1;
        }
    }
    return { files: new Set([...cf.keys(), ...eo.keys()]).size, copiedToCloudflare, copiedToEdgeone };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    if (process.argv.length !== 2) throw new Error('DUAL_ASSET_NO_ARGUMENTS');
    const result = syncDualAssets(path.join(root, 'dist/client/_astro'), path.join(root, 'dist-edgeone/static/_astro'));
    console.log(`Public chunk union synchronized: ${JSON.stringify(result)}. Run both artifact scans before packaging/deployment.`);
}

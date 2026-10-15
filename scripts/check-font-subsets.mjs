import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (data) => createHash('sha256').update(data).digest('hex');

function points(value) {
    const result = new Set();
    for (const range of value.split(',')) {
        assert.match(range, /^U\+[0-9A-F]+(?:-[0-9A-F]+)?$/);
        const [start, end = start] = range.slice(2).split('-').map((part) => Number.parseInt(part, 16));
        assert(start <= end && end <= 0x10FFFF, 'Invalid Unicode range');
        for (let point = start; point <= end; point += 1) {
            assert(!result.has(point), 'Repeated character within a Unicode range');
            result.add(point);
        }
    }
    return result;
}

function woffFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        assert(!entry.isSymbolicLink(), 'Font assets cannot be symlinks');
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? woffFiles(file) : /\.(?:woff2?|ttf|otf)$/i.test(entry.name) ? [file] : [];
    });
}

function geographicCharacters() {
    const files = [path.join(root, 'js/china.js'), ...fs.readdirSync(path.join(root, 'js/province'))
        .filter((name) => name.endsWith('.js')).map((name) => path.join(root, 'js/province', name))];
    const names = new Set();
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf(')')));
        for (const feature of data.features) {
            if (typeof feature.properties?.name === 'string') names.add(feature.properties.name);
        }
    }
    return { names: names.size, characters: new Set([...names].join('')) };
}

export function checkFontSubsets(assetsRoot = path.join(root, 'public')) {
    const directory = path.join(assetsRoot, 'fonts');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    const sources = JSON.parse(fs.readFileSync(path.join(root, 'font-sources/manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.commit, sources.commit);
    const css = fs.readFileSync(path.join(root, 'src/styles/fonts.css'), 'utf8');
    const faces = css.match(/@font-face\s*\{[^}]+\}/g) || [];
    assert.equal(manifest.families.length, 3);
    const listed = new Set();
    let bytes = 0;
    const geographic = geographicCharacters();
    for (const [index, family] of manifest.families.entries()) {
        assert.equal(family.family, ['Noto Sans SC', 'Noto Serif SC', 'DM Serif Display'][index]);
        const source = sources.fonts[index];
        assert.equal(family.sourceSha256, source.sha256);
        assert.equal(family.sourceFile, source.file);
        assert.equal(family.unicodeCharacters, source.unicodeCharacters);
        assert.deepEqual(family.axes, source.axes);
        assert.equal(digest(fs.readFileSync(path.join(root, 'font-sources', source.file))), source.sha256);
        const union = new Set();
        for (const shard of family.shards) {
            assert.match(shard.file, /^(?:subsets\/noto-(?:sans|serif)-sc-\d{3}|dm-serif-display)\.[a-f0-9]{12}\.woff2$/);
            assert(shard.file.includes(shard.sha256.slice(0, 12)), 'Font URL must include content hash');
            assert(!listed.has(shard.file), 'Duplicate font file');
            listed.add(shard.file);
            const data = fs.readFileSync(path.join(directory, shard.file));
            assert.equal(digest(data), shard.sha256, `Font SHA mismatch: ${shard.file}`);
            assert.equal(data.length, shard.bytes);
            assert.equal(data.subarray(0, 4).toString(), 'wOF2');
            assert(data.length < 25 * 1024 * 1024, 'Font exceeds static-file platform limit');
            const characters = points(shard.unicodeRange);
            assert.equal(characters.size, shard.unicodeCharacters);
            for (const point of characters) {
                assert(!union.has(point), 'Overlapping font shards');
                union.add(point);
            }
            const matching = faces.filter((face) => face.includes(`url('/fonts/${shard.file}')`));
            assert.equal(matching.length, 1, 'Font missing/duplicated in source CSS');
            const face = matching[0];
            const weight = family.axes.length ? `${family.axes[0].minimum} ${family.axes[0].maximum}` : '400';
            assert(face.includes(`font-family: '${family.family}';`), 'Font family changed in CSS');
            assert(face.includes(`font-weight: ${weight};`), 'Font weight range changed in CSS');
            assert(face.includes(`unicode-range: ${shard.unicodeRange};`), 'Unicode range missing from CSS');
            bytes += data.length;
        }
        assert.equal(union.size, source.unicodeCharacters, 'Incomplete source character count');
        assert.deepEqual([...union].sort((a, b) => a - b), [...points(source.unicodeRange)].sort((a, b) => a - b),
            'Published Unicode ranges differ from the complete upstream cmap');
        if (family.family.startsWith('Noto ')) {
            for (const character of geographic.characters) {
                assert(union.has(character.codePointAt(0)), `Geographic character missing: ${character}`);
            }
        }
    }
    const actual = woffFiles(directory).map((file) => path.relative(directory, file).replaceAll('\\', '/'));
    assert.equal(faces.length, listed.size, 'Unexpected font-face declaration');
    assert.deepEqual(actual.sort(), [...listed].sort(), 'Unexpected/obsolete/full-source published fonts');
    for (const license of ['notosanssc-OFL.txt', 'notoserifsc-OFL.txt', 'dmserifdisplay-OFL.txt']) {
        const data = fs.readFileSync(path.join(directory, license), 'utf8');
        assert.match(data, /SIL OPEN FONT LICENSE/);
        assert.match(data, /Version 1\.1/);
        assert.match(data, /Copyright/i);
    }
    return { families: manifest.families.length, shards: listed.size, publishedBytes: bytes,
        completeSourceBytes: sources.fonts.reduce((sum, font) => sum + font.bytes, 0),
        geographicNames: geographic.names, geographicCharacters: geographic.characters.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    assert(args.length === 0 || (args.length === 2 && args[0] === '--assets-root'), 'Use --assets-root <directory>');
    console.log('Font shards verified:', checkFontSubsets(args[1] ? path.resolve(args[1]) : undefined));
}

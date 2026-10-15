import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { checkFontSubsets } from '../scripts/check-font-subsets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = path.join(root, '.wrangler', `font-subsets-test-${process.pid}`);
fs.mkdirSync(temporary, { recursive: true });
after(() => {
    const resolved = path.resolve(temporary);
    assert(path.dirname(resolved) === path.join(root, '.wrangler') && path.basename(resolved).startsWith('font-subsets-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
});

function fixture(name) {
    const directory = path.join(temporary, name);
    fs.cpSync(path.join(root, 'public/fonts'), path.join(directory, 'fonts'), { recursive: true });
    return directory;
}

test('complete committed font shards pass the source/coverage/hash gate', () => {
    const result = checkFontSubsets();
    assert.equal(result.families, 3);
    assert(result.shards > 3);
});

test('changed WOFF2 bytes are rejected', () => {
    const directory = fixture('corrupted');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'fonts/manifest.json'), 'utf8'));
    const file = path.join(directory, 'fonts', manifest.families[0].shards[0].file);
    const data = fs.readFileSync(file);
    data[data.length - 1] ^= 1;
    fs.writeFileSync(file, data);
    assert.throws(() => checkFontSubsets(directory), /SHA mismatch/);
});

test('missing coverage is rejected even when remaining shard hashes match', () => {
    const directory = fixture('missing');
    const file = path.join(directory, 'fonts/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.families[0].shards.pop();
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => checkFontSubsets(directory), /Incomplete source character count/);
});

test('publishing a complete source font alongside subsets is rejected', () => {
    const directory = fixture('unexpected');
    fs.copyFileSync(path.join(root, 'font-sources/noto-sans-sc.aef8c34277af.woff2'),
        path.join(directory, 'fonts/noto-sans-sc.aef8c34277af.woff2'));
    assert.throws(() => checkFontSubsets(directory), /Unexpected\/obsolete\/full-source/);
});

test('overlapping Unicode shards are rejected', () => {
    const directory = fixture('overlapping');
    const file = path.join(directory, 'fonts/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const [first, second] = manifest.families[0].shards;
    second.unicodeRange = first.unicodeRange;
    second.unicodeCharacters = first.unicodeCharacters;
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => checkFontSubsets(directory), /Overlapping font shards/);
});

test('narrowed variable-weight metadata is rejected', () => {
    const directory = fixture('weight');
    const file = path.join(directory, 'fonts/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.families[0].axes[0].maximum = 700;
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => checkFontSubsets(directory));
});

test('missing OFL is rejected', () => {
    const directory = fixture('license');
    fs.rmSync(path.join(directory, 'fonts/notosanssc-OFL.txt'));
    assert.throws(() => checkFontSubsets(directory), /ENOENT/);
});

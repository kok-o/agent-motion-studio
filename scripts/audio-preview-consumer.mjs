import assert from 'node:assert/strict';
import { mkdir, cp, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Retain only owned local fixtures and their already verified media/PCM. This
// copies evidence after the checks; it never rerenders or edits consumer bytes.
export async function retainAudioPreviewEvidence({ music, offline, source }, out) {
    const selections = {
        music: { root: music, paths: ['source-with-220hz.mp4', 'project', 'file-full.s16le', 'file-interval.s16le', 'file-aac.s16le', 'file-preview/output.mp4', 'verification.json'] },
        offline: { root: join(offline, 'file'), paths: ['project.json', 'draft.json', 'voice.wav', 'music.wav', 'interval.s16le', 'full.s16le', 'aac.s16le', 'preview/output.mp4', 'caption-frame.png'] },
        source: { root: join(source, 'delayed30-offset5'), paths: ['source.mp4', 'pulse.wav', 'project', 'interval.s16le', 'full.s16le', 'aac.s16le', 'preview/output.mp4', 'picture.rgb'] },
    };
    const files = [];
    async function copy(path, target) {
        const info = await lstat(path);
        assert.ok(!info.isSymbolicLink());
        if (info.isDirectory()) {
            for (const item of await readdir(path)) {
                assert.ok(!['.cache', '.studio'].includes(item), 'Do not retain cache/jobs');
                await copy(join(path, item), join(target, item));
            }
        }
        else {
            await mkdir(dirname(target), { recursive: true });
            await cp(path, target, { errorOnExist: true, force: false });
            const original = await readFile(path), retained = await readFile(target);
            assert.ok(original.equals(retained));
            files.push({ path: relative(out, target).split(String.fromCharCode(92)).join('/'), bytes: retained.length, sha256: sha(retained) });
        }
    }
    for (const [name, selection] of Object.entries(selections))
        for (const path of selection.paths)
            await copy(join(selection.root, path), join(out, name, path));
    const report = { status: 'PASS', pcm: 'signed16 little-endian, 48kHz stereo, interleaved; 4bytes per sample frame', bounds: { music: [37 * 1600, 104 * 1600], offline: [37 * 1600, 90 * 1600], source: [37 * 1600, 97 * 1600] }, copiedWithoutMediaRerun: true, files };
    await writeFile(join(out, 'RAW_MANIFEST.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
}

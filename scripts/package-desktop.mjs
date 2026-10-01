import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, symlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const app = resolve(root, 'desktop/src-tauri/target/release/bundle/macos/BenchReview Lite.app');
const out = resolve(root, 'desktop/src-tauri/target/release/bundle/distribution');
const staging = await mkdtemp('/private/tmp/benchreview-package-');
const stagedApp = join(staging, 'BenchReview Lite.app');
await mkdir(out, { recursive: true });
await run('ditto', ['--norsrc', '--noextattr', app, stagedApp]);
await run('codesign', ['--verify', '--deep', '--strict', stagedApp]);
await symlink('/Applications', join(staging, 'Applications'));
await copyFile(resolve(root, 'desktop/INSTALL-RU.txt'), join(staging, 'Установка.txt'));
const dmg = join(out, 'BenchReview-Lite-Apple-Silicon.dmg');
await run('hdiutil', ['create', '-ov', '-volname', 'BenchReview Lite', '-srcfolder', staging, '-format', 'UDZO', dmg]);
await run('hdiutil', ['verify', dmg]);
const mounted = await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-plist', dmg]);
// Mount output remains available for troubleshooting. Verify using the
// explicit volume path returned by hdiutil, then detach even on failure.
const mountPoint = mounted.stdout.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
if (!mountPoint) throw new Error('Cannot locate mounted distribution image');
try {
  await run('codesign', ['--verify', '--deep', '--strict', join(mountPoint, 'BenchReview Lite.app')]);
} finally {
  await run('hdiutil', ['detach', mountPoint]);
}
console.log(`Verified DMG: ${dmg}`);

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, '..');
const appPath = resolve(projectRoot, 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'macos', 'BenchReview Lite.app');

await access(appPath);
// Tauri's unsigned bundle may retain a linker-only signature. Re-signing the
// whole bundle ad hoc seals its nested resources and prevents macOS from
// reporting that the app is damaged after a ZIP transfer.
await run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
console.log(`Desktop app signature verified: ${appPath}`);

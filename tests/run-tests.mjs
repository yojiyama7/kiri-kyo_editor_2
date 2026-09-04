import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function selectTestFiles(files, mode = 'fast') {
  if (!['fast', 'all', 'slow'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
  return files.filter((file) => {
    const path = file.replaceAll('\\', '/');
    if (!path.endsWith('.test.mjs')) return false;
    const slow = /(^|\/)slow\//.test(path) || path.endsWith('.slow.test.mjs');
    return mode === 'all' || (mode === 'slow' ? slow : !slow);
  }).sort();
}

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : [path];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = 'fast', ...args] = process.argv.slice(2);
  const files = selectTestFiles(discover(dirname(fileURLToPath(import.meta.url))), mode);
  if (args.includes('--list')) {
    console.log(files.join('\n') || `No ${mode} tests.`);
  } else if (!files.length) {
    console.log(`No ${mode} tests.`);
  } else {
    const result = spawnSync(process.execPath, ['--test', ...args, ...files], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}

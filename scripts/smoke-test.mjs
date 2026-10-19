// Launches a built ToolBox executable in self-check mode and reports the result.
// Usage: node scripts/smoke-test.mjs <path-to-ToolBox.exe-or-electron-binary> [extra args...]
// Used by CI on windows-latest against dist/win-unpacked/ToolBox.exe.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [executable, ...extraArgs] = process.argv.slice(2);
if (!executable) {
  console.error('Usage: node scripts/smoke-test.mjs <executable> [args...]');
  process.exit(2);
}

const workDir = mkdtempSync(path.join(tmpdir(), 'toolbox-smoke-'));
const resultFile = path.join(workDir, 'result.json');
// Isolated profile so the check never touches the user's real data.
const userDataDir = path.join(workDir, 'user-data');

const child = spawn(executable, [...extraArgs, `--smoke-test=${resultFile}`], {
  stdio: 'inherit',
  env: { ...process.env, TOOLBOX_USER_DATA_DIR: userDataDir },
});

const timeout = setTimeout(() => {
  console.error('Smoke test timed out after 120 s');
  child.kill();
  process.exit(1);
}, 120_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  if (!existsSync(resultFile)) {
    console.error(`No result file written (exit code ${code})`);
    process.exit(1);
  }
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  for (const [name, check] of Object.entries(result.checks)) {
    console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  console.log(result.ok ? 'Smoke test passed' : 'Smoke test FAILED');
  process.exit(result.ok && code === 0 ? 0 : 1);
});

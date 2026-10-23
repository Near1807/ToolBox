// Stands in for Piper in the tests: one line of text in, one WAV path out.
import process from 'node:process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--output_dir') + 1];
const scale = args[args.indexOf('--length_scale') + 1];
let n = 0;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const file = path.join(dir, `${Date.now()}-${n++}.wav`);
  writeFileSync(file, `RIFF ${scale} ${line}`);
  process.stdout.write(`${file}\n`);
});

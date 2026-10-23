// Verifies that native dependencies load inside Electron's own Node runtime
// (ELECTRON_RUN_AS_NODE), not only in the system Node used by Vitest.
// better-sqlite3 >= 13 ships N-API prebuilds, so one binary serves both
// (see docs/decisions/0003-sqlite-better-sqlite3.md); so does @napi-rs/canvas
// (docs/decisions/0017-rendu-image-par-image.md) and uiohook-napi (global
// push-to-talk key, docs/decisions/0028). onnxruntime-web (WebAssembly, the
// model of the voice commands, docs/decisions/0030) is checked too: it must
// find its .wasm file. This guards against regressions.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const probe = `
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const { v } = db.prepare('select sqlite_version() as v').get();
  console.log('better-sqlite3 OK in Electron ' + process.versions.electron + ' (Node ' + process.versions.node + ', SQLite ' + v + ')');
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(4, 4);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(200, 100, 50)';
  ctx.fillRect(0, 0, 4, 4);
  const pixel = Array.from(canvas.data().subarray(0, 3)).join(',');
  if (pixel !== '200,100,50') throw new Error('@napi-rs/canvas draws wrong pixels: ' + pixel);
  console.log('@napi-rs/canvas OK in Electron (Skia, N-API)');
  const { UiohookKey } = require('uiohook-napi');
  if (UiohookKey.F23 !== 106) throw new Error('uiohook-napi: unexpected key codes');
  console.log('uiohook-napi OK in Electron (global keys, N-API)');
  // A tiny ONNX model (Identity), enough to prove the WebAssembly runtime loads.
  const ort = require('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const model = Buffer.from('CAg6RgoQCgF4EgF5IghJZGVudGl0eRIIaWRlbnRpdHlaEwoBeBIOCgwIARIICgIIAQoCCAJiEwoBeRIOCgwIARIICgIIAQoCCAJCBAoAEA0=', 'base64');
  ort.InferenceSession.create(model)
    .then((session) => session.run({ x: new ort.Tensor('float32', Float32Array.from([1, 2]), [1, 2]) }))
    .then((out) => {
      if (Array.from(out.y.data).join(',') !== '1,2') throw new Error('onnxruntime-web: wrong output');
      console.log('onnxruntime-web OK in Electron (WebAssembly)');
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
`;

const result = spawnSync(electronPath, ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0) {
  console.error('Native module check failed under Electron.');
  process.exit(1);
}

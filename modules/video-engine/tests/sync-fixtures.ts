// Test sounds for the track sync: a non-repeating track and a « phone capture ».
const RATE = 8000;

/** Deterministic pseudo-random generator. */
export function random(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A non-repeating test track: kicks, hats and notes at irregular times. */
export function testTrack(seconds: number, seed = 7, rate = RATE): Float32Array {
  const rnd = random(seed);
  const x = new Float32Array(seconds * rate);
  const add = (at: number, length: number, f: (t: number) => number) => {
    const s = Math.floor(at * rate);
    for (let i = 0; i < length * rate && s + i < x.length; i++) x[s + i]! += f(i / rate);
  };
  for (let t = 0.2; t < seconds; t += 0.32 + rnd() * 0.4) {
    add(
      t,
      0.25,
      (u) => 0.8 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-u * 30)) * u) * Math.exp(-u * 9),
    );
  }
  for (let t = 0.1; t < seconds; t += 0.1 + rnd() * 0.25) {
    const noise = random(Math.floor(t * 1000) + 1);
    add(t, 0.04, (u) => 0.2 * (noise() * 2 - 1) * Math.exp(-u * 80));
  }
  for (let t = 0; t < seconds; t += 0.25 + rnd() * 0.5) {
    const f = 220 * 2 ** (Math.floor(rnd() * 12) / 12);
    add(t, 0.4, (u) => 0.12 * Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 5));
  }
  return x;
}

/** A phone filming a speaker: no bass, no air, echo, background noise, quieter, compressed. */
export function degrade(input: Float32Array, seed = 3): Float32Array {
  const rnd = random(seed);
  const out = new Float32Array(input.length);
  let low = 0;
  let high = 0;
  let previous = 0;
  for (let i = 0; i < input.length; i++) {
    // High-pass ~200 Hz, low-pass ~3 kHz (one-pole filters).
    high = 0.86 * (high + input[i]! - previous);
    previous = input[i]!;
    low += 0.9 * (high - low);
    const echo = i >= 320 ? out[i - 320]! * 0.35 : 0; // 40 ms room echo
    const noise = (rnd() * 2 - 1) * 0.03;
    out[i] = Math.tanh(3 * (0.1 * low + noise)) / 3 + echo; // −20 dB, then compressed
  }
  return out;
}

/** Writes mono 16-bit WAV (0.7 × full scale at most). */
export function wavBuffer(samples: Float32Array, rate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) =>
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 0.7 * 32767))), 44 + i * 2),
  );
  return buffer;
}

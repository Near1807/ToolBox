// Microphone capture for the assistant: 16 kHz mono 16-bit WAV (what
// whisper.cpp expects), recorded with the Web Audio API in the main window.

const TARGET_RATE = 16_000;

function downsample(input: Float32Array, rate: number): Float32Array {
  if (rate === TARGET_RATE) return input;
  const ratio = rate / TARGET_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    // Average of the samples covered (a simple low-pass before decimation).
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

export class Recorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private starting: Promise<void> | null = null;

  get active(): boolean {
    return this.starting !== null;
  }

  start(): Promise<void> {
    this.chunks = [];
    this.starting = (async () => {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.context = new AudioContext();
      const source = this.context.createMediaStreamSource(this.stream);
      // ScriptProcessor: simple and enough for a few seconds of speech.
      this.node = this.context.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (event) =>
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(this.node);
      this.node.connect(this.context.destination);
    })();
    return this.starting;
  }

  private async release(): Promise<number> {
    await this.starting?.catch(() => {});
    const rate = this.context?.sampleRate ?? TARGET_RATE;
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.context = null;
    this.starting = null;
    return rate;
  }

  /** Stops and returns the WAV (base64). */
  async stop(): Promise<{ audio: string; seconds: number }> {
    const rate = await this.release();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    const samples = downsample(all, rate);
    return { audio: toBase64(encodeWav(samples)), seconds: samples.length / TARGET_RATE };
  }

  async cancel(): Promise<void> {
    await this.release();
    this.chunks = [];
  }
}

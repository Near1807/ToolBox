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
  /**
   * Kept between recordings (created once, suspended in between): creating it
   * at each press made the start of the sentence lost. It never touches the
   * microphone by itself: only start() opens it, stop() closes it.
   */
  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private starting: Promise<void> | null = null;

  get active(): boolean {
    return this.starting !== null;
  }

  /** Prepares the audio engine (no microphone): the first press is then faster. */
  warm(): void {
    if (!this.context) this.context = new AudioContext({ latencyHint: 'interactive' });
  }

  /** `onReady`: the first sound arrived, the microphone really listens (« Parle »). */
  start(onReady?: () => void): Promise<void> {
    this.chunks = [];
    this.starting = (async () => {
      this.warm();
      const context = this.context!;
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        context.resume(),
      ]);
      this.stream = stream;
      this.source = context.createMediaStreamSource(stream);
      // ScriptProcessor: simple and enough for a few seconds of speech; 2048
      // samples (~45 ms) so « ready » comes fast.
      this.node = context.createScriptProcessor(2048, 1, 1);
      let first = true;
      this.node.onaudioprocess = (event) => {
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        if (first) {
          first = false;
          onReady?.();
        }
      };
      this.source.connect(this.node);
      this.node.connect(context.destination);
    })();
    return this.starting;
  }

  /** A short tone (« le micro est prêt »), through the same audio engine. */
  beep(): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.09);
  }

  private async release(): Promise<number> {
    await this.starting?.catch(() => {});
    const rate = this.context?.sampleRate ?? TARGET_RATE;
    this.node?.disconnect();
    this.source?.disconnect();
    // The microphone is closed at once (no permanent listening).
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.suspend().catch(() => {});
    this.node = null;
    this.source = null;
    this.stream = null;
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

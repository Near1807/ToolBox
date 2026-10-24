// Sounds of the transitions, synthesised (no audio file): a soft bell or
// three short beeps, at the volume of the settings.
let context: AudioContext | null = null;

function tone(ctx: AudioContext, frequency: number, start: number, length: number, gain: number) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  amp.gain.setValueAtTime(0, start);
  amp.gain.linearRampToValueAtTime(gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Plays `sound` (« bell », « beep » or « none ») at `volume` (0…100). */
export function playSound(sound: string, volume: number): void {
  if (sound === 'none' || volume <= 0) return;
  try {
    context ??= new AudioContext();
    void context.resume();
    const ctx = context;
    const level = Math.min(1, volume / 100) * 0.4;
    const t = ctx.currentTime + 0.02;
    if (sound === 'beep') {
      for (let i = 0; i < 3; i++) tone(ctx, 1000, t + i * 0.22, 0.14, level);
    } else {
      tone(ctx, 880, t, 1.8, level);
      tone(ctx, 1320, t, 1.2, level * 0.4);
      tone(ctx, 660, t + 0.35, 1.6, level * 0.6);
    }
  } catch {
    // No audio output: the notification still says it.
  }
}

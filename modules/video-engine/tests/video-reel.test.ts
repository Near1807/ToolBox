import { describe, expect, it } from 'vitest';
import { bassEnergyPerFrame, breathEnvelope, breathSync } from '../backend/audio-analysis';
import { buildFramesEncodeArgs } from '../backend/commands';
import { EFFECTS, INTENSITY_FACTOR } from '../backend/effects';
import { CINE_BAR } from '../backend/effects/cine';
import { RHYTHM_ZOOM } from '../backend/effects/rhythm';
import { parseVideoProbe } from '../backend/media-tools';
import {
  applyCamera,
  applyMotion,
  buildVideoDecodeArgs,
  highEnergyPerFrame,
  trailOnRelease,
  planTimeline,
} from '../backend/video-reel';

const RATE = 22050;
const FPS = 30;

describe('timeline of the user videos', () => {
  it('chains the passages with hard cuts and cuts the last one at the excerpt end', () => {
    const plan = planTimeline(
      [
        { source: 'a.mp4', start: 2, end: 12 },
        { source: 'b.mp4', start: 0, end: 20 },
      ],
      28,
    );
    expect(plan.pieces).toEqual([
      { source: 'a.mp4', start: 2, duration: 10 },
      { source: 'b.mp4', start: 0, duration: 18 },
    ]);
    expect(plan.looped).toBe(false);
  });

  it('loops a video shorter than the excerpt (and says so)', () => {
    const plan = planTimeline([{ source: 'a.mp4', start: 1, end: 9 }], 20);
    expect(plan.pieces.map((p) => p.duration)).toEqual([8, 8, 4]);
    expect(plan).toMatchObject({ videoSeconds: 8, looped: true });
  });

  it('refuses an empty selection', () => {
    expect(() => planTimeline([{ source: 'a.mp4', start: 3, end: 3.1 }], 20)).toThrow(/passage/);
  });
});

describe('9:16 framing without automatic crop', () => {
  const base = {
    pieces: [{ source: 'clip.mp4', start: 1.5, duration: 6 }],
    width: 1080,
    height: 1920,
    focus: { x: 0.25, y: 0.5 },
    grade: null,
    frames: 180,
    k: 1,
  };

  it('« vidéo entière »: the whole video, never cropped, over a blurred background of itself', () => {
    const args = buildVideoDecodeArgs({ ...base, framing: 'fit' });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=decrease[ff0]');
    expect(graph).toMatch(/boxblur=\d+:2/);
    expect(graph).toContain('overlay=x=(W-w)/2:y=(H-h)/2');
    // The video's own sound is never read.
    expect(args).not.toContain('0:a');
    expect(args.slice(-4)).toEqual(['-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'].slice(-4));
  });

  it('« remplir »: cropped around the focus point, ratio kept', () => {
    const graph = buildVideoDecodeArgs({ ...base, framing: 'fill' }).find((a) =>
      a.includes('concat'),
    )!;
    expect(graph).toContain('force_original_aspect_ratio=increase');
    expect(graph).toContain("crop=1080:1920:x='(iw-ow)*0.25':y='(ih-oh)*0.5'");
    expect(graph).not.toMatch(/scale=1080:1920(?!:force)/);
  });

  it('applies the effect grade after the chained passages', () => {
    const graph = buildVideoDecodeArgs({
      ...base,
      framing: 'fit',
      grade: EFFECTS.cine.grade,
    }).find((a) => a.includes('concat'))!;
    expect(graph).toMatch(/concat=n=1:v=1:a=0,eq=contrast=1.06.*format=rgb24\[out\]$/);
  });
});

describe('effects bank', () => {
  it('has the five documented effects, sober by default', () => {
    expect(Object.keys(EFFECTS)).toEqual(['raw', 'calm', 'rhythm', 'cine', 'camera']);
    expect(EFFECTS.raw.frame({ frame: 10, frames: 100, envelope: 1 })).toEqual({
      zoom: 1,
      flash: 0,
    });
    expect(EFFECTS.raw).toMatchObject({ grade: null, grain: 0 });
  });

  it('Calme: a very slow zoom over the whole Reel, independent of the bass', () => {
    const at = (frame: number, envelope: number) =>
      EFFECTS.calm.frame({ frame, frames: 841, envelope }).zoom;
    expect(at(0, 1)).toBe(1);
    expect(at(840, 0)).toBeCloseTo(1.04, 6);
    expect(at(420, 1)).toBe(at(420, 0));
  });

  it('Rythme: zoom and flash follow the bass envelope directly', () => {
    const top = EFFECTS.rhythm.frame({ frame: 0, frames: 10, envelope: 1 });
    expect(top.zoom).toBeCloseTo(1 + RHYTHM_ZOOM);
    expect(top.flash).toBeGreaterThan(0);
    expect(EFFECTS.rhythm.frame({ frame: 0, frames: 10, envelope: 0 })).toEqual({
      zoom: 1,
      flash: 0,
    });
    // More marked than the cover Reels (1.8 %).
    expect(RHYTHM_ZOOM).toBeGreaterThan(0.018);
  });

  it('Rythme: the zoom peaks on the frame of each bass attack (≤ 1 frame), measured', () => {
    // Kicks at known, irregular times.
    const kicks = [0.4, 1.13, 1.71, 2.6, 3.05, 3.9, 4.42, 5.37];
    const samples = new Float32Array(6 * RATE);
    for (const kick of kicks) {
      let phase = 0;
      for (let i = 0; i < 0.3 * RATE; i++) {
        const t = i / RATE;
        phase += (2 * Math.PI * (55 + 55 * Math.exp(-t / 0.02))) / RATE;
        samples[Math.round(kick * RATE) + i]! += 0.7 * Math.exp(-t / 0.09) * Math.sin(phase);
      }
    }
    const frames = 6 * FPS;
    const envelope = breathEnvelope(bassEnergyPerFrame(samples, RATE, FPS, frames), FPS, {
      releaseSec: EFFECTS.rhythm.releaseSec,
    });
    const zoom = envelope.map(
      (e, frame) => (EFFECTS.rhythm.frame({ frame, frames, envelope: e }).zoom - 1) / RHYTHM_ZOOM,
    );
    for (const { attack, peak } of breathSync(kicks, zoom, FPS)) {
      expect(peak, `kick at ${attack} s`).not.toBeNull();
      expect(Math.abs(peak!), `kick at ${attack} s`).toBeLessThanOrEqual(1 / FPS + 1e-4);
    }
  });

  /** Kicks at known, irregular times, with a hat on each (highs). */
  const kicksSound = (kicks: number[]) => {
    const samples = new Float32Array(6 * RATE);
    for (const kick of kicks) {
      let phase = 0;
      for (let i = 0; i < 0.3 * RATE; i++) {
        const t = i / RATE;
        phase += (2 * Math.PI * (55 + 55 * Math.exp(-t / 0.02))) / RATE;
        samples[Math.round(kick * RATE) + i]! += 0.7 * Math.exp(-t / 0.09) * Math.sin(phase);
        if (i < 0.03 * RATE) samples[Math.round(kick * RATE) + i]! += 0.2 * Math.sin(i * 2.7);
      }
    }
    return samples;
  };

  it('Rythme and Caméra embarquée: the motion peaks on the frame of each attack, at each intensity', () => {
    const kicks = [0.4, 1.13, 1.71, 2.6, 3.05, 3.9, 4.42, 5.37];
    const samples = kicksSound(kicks);
    const frames = 6 * FPS;
    for (const id of ['rhythm', 'camera'] as const) {
      const effect = EFFECTS[id];
      const envelope = breathEnvelope(bassEnergyPerFrame(samples, RATE, FPS, frames), FPS, {
        releaseSec: effect.releaseSec,
      });
      const high = breathEnvelope(highEnergyPerFrame(samples, RATE, frames), FPS, {
        releaseSec: 0.08,
        reference: 1e-9,
      });
      for (const [name, intensity] of Object.entries(INTENSITY_FACTOR)) {
        const zoom = envelope.map((e, frame) => {
          const motion = effect.frame({ frame, frames, envelope: e, high: high[frame], intensity });
          return motion.zoom;
        });
        const top = Math.max(...zoom);
        const base = Math.min(...zoom);
        const normalised = zoom.map((z) => (z - base) / (top - base));
        for (const { attack, peak } of breathSync(kicks, normalised, FPS)) {
          expect(peak, `${id} ${name}, kick at ${attack} s`).not.toBeNull();
          expect(Math.abs(peak!), `${id} ${name}, kick at ${attack} s`).toBeLessThanOrEqual(
            1 / FPS + 1e-4,
          );
        }
      }
    }
  });

  it('Intensité: Léger < Moyen < À fond, for Rythme and Caméra embarquée', () => {
    for (const id of ['rhythm', 'camera'] as const) {
      const zoomAt = (intensity: number) =>
        EFFECTS[id].frame({ frame: 5, frames: 10, envelope: 1, high: 1, intensity }).zoom;
      expect(zoomAt(INTENSITY_FACTOR.light)).toBeLessThan(zoomAt(INTENSITY_FACTOR.medium));
      expect(zoomAt(INTENSITY_FACTOR.medium)).toBeLessThan(zoomAt(INTENSITY_FACTOR.max));
    }
  });

  it('Caméra embarquée: no motion blur on an attack (it would delay the peak), only on the release', () => {
    const at = (envelope: number) =>
      EFFECTS.camera.frame({ frame: 3, frames: 10, envelope, high: 0.5, intensity: 1 });
    expect(trailOnRelease(at(1), at(0.2).zoom).camera!.blur).toBe(0); // rising: sharp
    expect(trailOnRelease(at(0.6), at(1).zoom).camera!.blur).toBeGreaterThan(0); // release
  });

  it('Caméra embarquée: the frame is always filled, even at full intensity (no black edge)', () => {
    const width = 108;
    const height = 192;
    const white = new Uint8Array(width * height * 3).fill(255);
    const out = new Uint8Array(white.length);
    for (let frame = 0; frame < 40; frame++) {
      for (const side of [1, -1]) {
        const motion = EFFECTS.camera.frame({
          frame,
          frames: 40,
          envelope: (frame % 5) / 4,
          high: ((frame * 7) % 5) / 4,
          side,
          intensity: INTENSITY_FACTOR.max,
        });
        applyCamera(white, out, null, width, height, { ...motion, flash: 0 });
        expect(Math.min(...out), `frame ${frame}, side ${side}`).toBe(255);
      }
    }
  });

  it('Ciné: thin bars that frame without hiding (≤ 5 % of the height each)', () => {
    expect(CINE_BAR / 1920).toBeLessThanOrEqual(0.05);
    expect(EFFECTS.cine.overlay).toBeTypeOf('function');
  });
});

describe('motion of a frame (zoom + flash)', () => {
  const width = 8;
  const height = 4;
  const src = new Uint8Array(width * height * 3).map((_, i) => (i * 7) % 256);

  it('passes the frame through untouched without motion', () => {
    expect(applyMotion(src, new Uint8Array(src.length), width, height, 1, 0)).toBe(src);
  });

  it('flashes in screen mode: brighter, never above white', () => {
    const out = applyMotion(src, new Uint8Array(src.length), width, height, 1, 0.5);
    for (let i = 0; i < src.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(src[i]!);
      expect(out[i]).toBe(Math.floor(src[i]! + (255 - src[i]!) * 0.5));
    }
  });

  it('zooms around the centre: the centre stays, the edges come from inside', () => {
    const flat = new Uint8Array(100 * 100 * 3);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) flat.fill(x * 2, (y * 100 + x) * 3, (y * 100 + x) * 3 + 3);
    const out = applyMotion(flat, new Uint8Array(flat.length), 100, 100, 1.1, 0);
    const at = (x: number, y: number) => out[(y * 100 + x) * 3]!;
    expect(Math.abs(at(50, 50) - 100)).toBeLessThanOrEqual(1);
    expect(at(0, 50)).toBeGreaterThan(0); // left edge pulled from inside
    expect(at(99, 50)).toBeLessThan(198);
  });
});

describe('encoder of the video Reels', () => {
  it('lays the still layer over the frames, then grain and fades; cover Reels unchanged', () => {
    const args = buildFramesEncodeArgs({
      width: 1080,
      height: 1920,
      duration: 28,
      fade: 0.5,
      grain: 9,
      pixelFormat: 'rgb24',
      overlay: 'layer.png',
      encoding: null,
      audio: 'soundtrack.m4a',
      output: 'out.mp4',
    });
    expect(args).toContain('rgb24');
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    expect(graph).toMatch(
      /^\[0:v\]\[2:v\]overlay=shortest=1:format=auto,noise=alls=9:allf=t,fade=t=in/,
    );
    expect(graph).toContain('setsar=1');
    // Same arguments as before for the cover Reels.
    const cover = buildFramesEncodeArgs({
      width: 1080,
      height: 1920,
      duration: 28,
      fade: 0.5,
      encoding: null,
      audio: 'soundtrack.m4a',
      output: 'out.mp4',
    });
    expect(cover[cover.indexOf('-vf') + 1]).toBe(
      'noise=alls=4:allf=t,fade=t=in:st=0:d=0.5,fade=t=out:st=27.5:d=0.5,format=yuv420p,setsar=1',
    );
  });
});

describe('video probe', () => {
  it('reads duration and displayed size, phone rotation included', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio' },
      ],
      format: { duration: '12.5' },
    });
    expect(parseVideoProbe(json)).toEqual({
      durationSec: 12.5,
      width: 1080,
      height: 1920,
      hasAudio: true,
    });
    expect(() => parseVideoProbe(JSON.stringify({ streams: [], format: {} }))).toThrow(
      /Pas d’image/,
    );
  });
});

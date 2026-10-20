import { describe, expect, it } from 'vitest';
import {
  buildAssScript,
  buildAudioArgs,
  buildBackgroundArgs,
  dbToLinear,
  parseTruePeak,
  POST_SPEC,
  buildFontsConfig,
  buildRenderArgs,
  buildFramesEncodeArgs,
  escapeAssText,
  fitFontSize,
  FORMATS,
  parseProgressLine,
  scaleFormat,
} from '../backend/commands';

const files = {
  background: 'background.png',
  card: 'card.png',
  ass: 'text.ass',
  fontsDir: 'fonts',
  audio: 'soundtrack.m4a',
  output: 'out.mp4.part',
};

describe('FFmpeg command builders', () => {
  it('keeps full-quality dimensions and scales previews to even sizes', () => {
    expect(scaleFormat(FORMATS.youtube, 1)).toMatchObject({ width: 1920, height: 1080 });
    const preview = scaleFormat(FORMATS.youtube, 1 / 3);
    expect(preview).toMatchObject({ width: 640, height: 360 });
    for (const [format, scale] of [
      [FORMATS.youtube, 1],
      [FORMATS.youtube, 1 / 3],
    ] as const) {
      const { bars } = scaleFormat(format, scale).layout;
      // showcqt needs an even number of bars.
      expect((bars.width / bars.barWidth) % 2).toBe(0);
    }
    // Reels are drawn frame by frame (reel-frames.ts), not by an FFmpeg graph.
    expect(() => scaleFormat(FORMATS.instagram, 1)).toThrow();
  });

  it('builds a YouTube render: H.264 + AAC, yuv420p, 30 fps, recommended bitrates', () => {
    const { width, height, layout } = scaleFormat(FORMATS.youtube, 1);
    const args = buildRenderArgs({
      width,
      height,
      layout,
      start: 12.5,
      duration: 180,
      fadeIn: 1.5,
      fadeOut: 2,
      encoding: FORMATS.youtube.encoding,
      files,
      source:
        'C:\\Users\\Thomas\\AppData\\Roaming\\ToolBox\\modules\\music-library\\tracks\\1\\audio.wav',
    });
    const at = (flag: string, occurrence = 0) => {
      let index = -1;
      for (let i = 0; i <= occurrence; i++) index = args.indexOf(flag, index + 1);
      return args[index + 1];
    };
    expect(args).toContain(
      'C:\\Users\\Thomas\\AppData\\Roaming\\ToolBox\\modules\\music-library\\tracks\\1\\audio.wav',
    );
    expect(at('-ss')).toBe('12.5');
    expect(at('-c:v')).toBe('libx264');
    expect(at('-pix_fmt')).toBe('yuv420p');
    expect(at('-r')).toBe('30');
    expect(at('-b:v')).toBe('8M');
    // The soundtrack (encoded and checked separately) is copied, not re-encoded.
    expect(at('-c:a')).toBe('copy');
    expect(at('-map', 1)).toBe('3:a');
    expect(at('-movflags')).toBe('+faststart');
    expect(args.at(-1)).toBe('out.mp4.part');

    const graph = at('-filter_complex')!;
    expect(graph).toContain('showcqt=s=70x210');
    expect(graph).toContain('firequalizer=');
    // True-peak limiter before AAC encoding.
    expect(graph).toContain('subtitles=text.ass:fontsdir=fonts');
    expect(graph).toContain("scale=w='iw*(1+0.05*t/180)':h=-1:eval=frame");
    expect(graph).toContain('format=yuv420p,setsar=1[vout]');
    expect(graph).toContain('fade=t=out:st=178:d=2');
    // No absolute path inside the filter graph (Windows escaping issues).
    expect(graph).not.toMatch(/[A-Z]:\\/);
  });

  it('builds a fast preview without fades', () => {
    const { width, height, layout } = scaleFormat(FORMATS.youtube, 1 / 3);
    const args = buildRenderArgs({
      width,
      height,
      layout,
      start: 0,
      duration: 6,
      fadeIn: 0,
      fadeOut: 0,
      encoding: null,
      files,
      source: 'a.wav',
    });
    expect(args).toContain('ultrafast');
    expect(args.join(' ')).not.toContain('fade=');
  });

  it('makes titles safe for ASS and fits them on one line', () => {
    expect(escapeAssText('Mix {v2}\\final\nedit')).toBe('Mix (v2)/final edit');
    expect(fitFontSize('Court', 58, 1500, 30)).toBe(58);
    expect(
      fitFontSize('Un titre vraiment très très long pour une seule ligne de texte', 58, 1500, 30),
    ).toBeLessThan(58);
    expect(fitFontSize('x'.repeat(500), 58, 1500, 30)).toBe(30);

    const { width, height, layout } = scaleFormat(FORMATS.youtube, 1);
    const ass = buildAssScript({ width, height, title: 'Night {Drive}', artist: 'Thomas', layout });
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('{\\pos(960,700)}Night (Drive)');
    expect(ass).toContain('{\\pos(960,784)}THOMAS');
  });

  it('builds the soundtrack with fades and an oversampled peak limiter', () => {
    const args = buildAudioArgs({
      source: 'C:\\Music\\song.wav',
      start: 10,
      duration: 30,
      fadeIn: 1.5,
      fadeOut: 2,
      ceilingDb: -1.5,
      bitrate: '384k',
      output: 'soundtrack.m4a',
    });
    const filters = args[args.indexOf('-af') + 1];
    expect(filters).toBe(
      'afade=t=in:st=0:d=1.5,afade=t=out:st=28:d=2,aresample=192000,' +
        'alimiter=limit=0.8414:attack=1:release=50:level=0,aresample=48000',
    );
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'soundtrack.m4a']);
    expect(args.join(' ')).toContain('-c:a aac -aac_coder fast');
    expect(dbToLinear(-1)).toBe(0.8913);
  });

  it('reads the true peak from the ebur128 report', () => {
    const report =
      'Summary:\n  Integrated loudness:\n    I: -9.1 LUFS\n\n  True peak:\n    Peak:  -1.2 dBFS\n';
    expect(parseTruePeak(report)).toBe(-1.2);
    expect(parseTruePeak('True peak:\n    Peak:  0.4 dBFS')).toBe(0.4);
    expect(parseTruePeak('True peak:\n    Peak:  -inf dBFS')).toBe(-Infinity);
    expect(parseTruePeak('nothing')).toBeNull();
  });

  it('writes only the title and the artist on the post (no other text)', () => {
    const ass = buildAssScript({
      width: 1080,
      height: 1350,
      title: 'Titre',
      artist: 'Thomas',
      layout: POST_SPEC.text,
    });
    expect(ass.match(/^Dialogue:/gm)).toHaveLength(2);
    expect(ass).toContain('}Titre');
    expect(ass).toContain('}THOMAS');
  });

  it('builds the background from the cover only: filled, blurred, square pixels', () => {
    const args = buildBackgroundArgs('cover.png', 'bg.png', 1920, 1080, 60);
    const filter = args[args.indexOf('-vf') + 1]!;
    expect(filter).toMatch(
      /^setsar=1,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,/,
    );
    expect(filter).toContain('scale=120:68:flags=area,gblur=sigma=11');
    expect(filter).toMatch(/setsar=1$/);
    // No colour of its own: only brightness/saturation/contrast of the cover's pixels.
    expect(filter).not.toMatch(/color=|drawbox/);
  });

  it('encodes drawn frames: raw RGBA from stdin, square pixels, copied soundtrack', () => {
    const args = buildFramesEncodeArgs({
      width: 1080,
      height: 1920,
      duration: 28,
      fade: 0.5,
      encoding: FORMATS.instagram.encoding,
      audio: 'audio.m4a',
      output: 'out.mp4.part',
    });
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(at('-f')).toBe('rawvideo');
    expect(at('-s')).toBe('1080x1920');
    expect(args).toContain('pipe:0');
    expect(at('-vf')).toBe(
      'noise=alls=4:allf=t,fade=t=in:st=0:d=0.5,fade=t=out:st=27.5:d=0.5,format=yuv420p,setsar=1',
    );
    expect(at('-c:a')).toBe('copy');
    expect(at('-b:v')).toBe('6M');
    expect(args.at(-1)).toBe('out.mp4.part');
    const preview = buildFramesEncodeArgs({
      width: 360,
      height: 640,
      duration: 6,
      fade: 0,
      encoding: null,
      audio: 'a.m4a',
      output: 'p.mp4',
    });
    expect(preview).toContain('ultrafast');
    expect(preview.join(' ')).not.toContain('fade=');
  });

  it('escapes XML in the fontconfig file', () => {
    expect(buildFontsConfig('C:\\Users\\A&B\\fonts', '/tmp/c')).toContain(
      '<dir>C:/Users/A&amp;B/fonts</dir>',
    );
  });

  it('parses FFmpeg progress output', () => {
    expect(parseProgressLine('out_time_us=12500000')).toBe(12.5);
    expect(parseProgressLine('out_time_ms=1000000')).toBe(1);
    expect(parseProgressLine('progress=continue')).toBeNull();
  });
});

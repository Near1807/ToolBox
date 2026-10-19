// Pure builders of FFmpeg arguments (parameters → argv). No I/O here: every
// function is unit-tested. FFmpeg runs with the work folder as cwd, so the
// filter graphs only reference relative file names (no Windows path escaping).
// Must stay compatible with FFmpeg 6.1 (Windows build).
import type { VideoFormat } from '../contract';

export const FPS = 30;
/** 4× oversampling of 48 kHz, so that sample peaks approximate true peaks. */
export const TRUE_PEAK_RATE = 192000;
/** Required maximum true peak of the soundtrack (dBTP). */
export const TRUE_PEAK_TARGET = -1;
/** First limiter ceiling (dBFS): a margin for the overshoot added by AAC encoding. */
export const INITIAL_CEILING_DB = -1.5;

export interface Layout {
  cover: { size: number; centerY: number; radius: number; shadowPad: number; shadowOffset: number };
  /** Relative growth of the cover over the whole clip (slow zoom). */
  zoom: number;
  title: { top: number; fontSize: number; minFontSize: number; maxWidth: number };
  artist: { top: number; fontSize: number };
  bars: {
    width: number;
    height: number;
    top: number;
    barWidth: number;
    gap: number;
    opacity: number;
  };
  /** Strength of the film grain (FFmpeg noise filter). */
  grain: number;
  blur: number;
}

export interface FormatSpec {
  label: string;
  width: number;
  height: number;
  /** Bitrates follow YouTube / Instagram upload recommendations. */
  encoding: {
    videoBitrate: string;
    maxrate: string;
    bufsize: string;
    gop: number;
    audioBitrate: string;
  };
  layout: Layout;
}

export const FORMATS: Record<VideoFormat, FormatSpec> = {
  // YouTube: 1080p30 SDR ≈ 8 Mbit/s, closed GOP of half the frame rate, AAC-LC 48 kHz 384 kbit/s.
  youtube: {
    label: 'YouTube 16:9 (1920×1080)',
    width: 1920,
    height: 1080,
    encoding: { videoBitrate: '8M', maxrate: '10M', bufsize: '16M', gop: 15, audioBitrate: '384k' },
    layout: {
      cover: { size: 560, centerY: 380, radius: 28, shadowPad: 60, shadowOffset: 14 },
      zoom: 0.05,
      title: { top: 700, fontSize: 58, minFontSize: 30, maxWidth: 1500 },
      artist: { top: 784, fontSize: 42 },
      bars: { width: 1400, height: 210, top: 852, barWidth: 20, gap: 5, opacity: 0.7 },
      grain: 6,
      blur: 90,
    },
  },
  // Instagram Reels / YouTube Shorts: 1080×1920, 30 fps, H.264 + AAC 48 kHz.
  // Text and bars stay out of the zones covered by the Instagram interface.
  instagram: {
    label: 'Instagram Reel / Short 9:16 (1080×1920)',
    width: 1080,
    height: 1920,
    encoding: { videoBitrate: '6M', maxrate: '8M', bufsize: '12M', gop: 60, audioBitrate: '256k' },
    layout: {
      cover: { size: 760, centerY: 880, radius: 32, shadowPad: 70, shadowOffset: 16 },
      zoom: 0.05,
      title: { top: 250, fontSize: 64, minFontSize: 34, maxWidth: 940 },
      artist: { top: 342, fontSize: 46 },
      bars: { width: 900, height: 270, top: 1370, barWidth: 20, gap: 5, opacity: 0.7 },
      grain: 6,
      blur: 90,
    },
  },
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const px = (n: number, scale: number) => Math.max(1, Math.round(n * scale));

/** Frame size and layout for a given output scale (1 = full quality, 1/3 = preview). */
export function scaleFormat(
  format: FormatSpec,
  scale: number,
): { width: number; height: number; layout: Layout } {
  const l = format.layout;
  const barWidth = Math.max(4, px(l.bars.barWidth, scale));
  return {
    width: even(format.width * scale),
    height: even(format.height * scale),
    layout: {
      cover: {
        size: px(l.cover.size, scale),
        centerY: px(l.cover.centerY, scale),
        radius: px(l.cover.radius, scale),
        shadowPad: px(l.cover.shadowPad, scale),
        shadowOffset: px(l.cover.shadowOffset, scale),
      },
      zoom: l.zoom,
      title: {
        top: px(l.title.top, scale),
        fontSize: px(l.title.fontSize, scale),
        minFontSize: px(l.title.minFontSize, scale),
        maxWidth: px(l.title.maxWidth, scale),
      },
      artist: { top: px(l.artist.top, scale), fontSize: px(l.artist.fontSize, scale) },
      bars: {
        // An even number of whole bars: showcqt needs an even width, and the
        // grid of gaps must line up with the bars.
        width: Math.floor(px(l.bars.width, scale) / (2 * barWidth)) * 2 * barWidth,
        height: even(l.bars.height * scale),
        top: px(l.bars.top, scale),
        barWidth,
        gap: Math.max(1, px(l.bars.gap, scale)),
        opacity: l.bars.opacity,
      },
      grain: l.grain,
      blur: Math.max(4, px(l.blur, scale)),
    },
  };
}

/**
 * Background: a soft colour wash of the cover. The whole cover is reduced to a
 * coarse grid of average colours (no crop, no big zoom: no visible blotches),
 * enlarged smoothly and blurred, then darkened towards the edges and, more
 * strongly, towards the bottom so the spectrum bars always stay readable.
 */
export function buildBackgroundArgs(
  cover: string,
  output: string,
  width: number,
  height: number,
  blur: number,
): string[] {
  const grid = width >= height ? '8:5' : '5:8';
  // Bottom gradient (from 55 % of the height, up to -60 %) × soft radial vignette.
  const shade =
    '(1-0.6*clip((Y/H-0.55)/0.45\\,0\\,1))' +
    '*(1-0.35*(pow((X/W-0.5)*2\\,2)+pow((Y/H-0.5)*2\\,2))/2)';
  return [
    '-v',
    'error',
    '-y',
    '-i',
    cover,
    '-vf',
    `scale=${grid}:flags=area,scale=${width}:${height}:flags=bicubic,gblur=sigma=${blur},` +
      `eq=brightness=-0.16:saturation=1.05:contrast=0.85,format=rgb24,` +
      `geq=r='r(X,Y)*${shade}':g='g(X,Y)*${shade}':b='b(X,Y)*${shade}'`,
    '-frames:v',
    '1',
    output,
  ];
}

/** Sharp cover with rounded corners and a soft drop shadow, as a transparent PNG. */
export function buildCardArgs(cover: string, output: string, layout: Layout['cover']): string[] {
  const { size: s, radius: r, shadowPad: p, shadowOffset: o } = layout;
  const rounded =
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
    `a='if(gt(abs(W/2-X),W/2-${r})*gt(abs(H/2-Y),H/2-${r}),` +
    `if(lte(hypot(${r}-(W/2-abs(W/2-X)),${r}-(H/2-abs(H/2-Y))),${r}),255,0),255)'`;
  return [
    '-v',
    'error',
    '-y',
    '-i',
    cover,
    '-filter_complex',
    `[0:v]scale=${s}:${s}:force_original_aspect_ratio=increase,crop=${s}:${s},format=rgba,${rounded}[c];` +
      `[c]split[c1][c2];` +
      `[c2]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.6,` +
      `pad=${s + 2 * p}:${s + 2 * p}:${p}:${p + o}:color=black@0,gblur=sigma=${Math.max(2, Math.round(p / 3))}[sh];` +
      `[sh][c1]overlay=${p}:${p}:format=auto`,
    '-frames:v',
    '1',
    output,
  ];
}

/** Characters with a meaning in ASS subtitles are replaced; the text stays on one line. */
export function escapeAssText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

/** Font size so that the text fits on one line (Montserrat SemiBold ≈ 0.55 em per character). */
export function fitFontSize(text: string, base: number, maxWidth: number, min: number): number {
  const estimated = Math.floor(maxWidth / (0.55 * Math.max(1, [...text].length)));
  return Math.max(min, Math.min(base, estimated));
}

/** Title and artist as an ASS script, rendered by libass (works with every FFmpeg build). */
export interface TextLayout {
  title: Layout['title'];
  artist: Layout['artist'];
  /** Optional small mention (post image). */
  badge?: { top: number; fontSize: number };
}

export function buildAssScript(params: {
  width: number;
  height: number;
  title: string;
  artist: string;
  layout: TextLayout;
  badge?: string;
}): string {
  const { width, height, layout } = params;
  const title = escapeAssText(params.title);
  const artist = escapeAssText(params.artist).toUpperCase();
  const titleSize = fitFontSize(
    title,
    layout.title.fontSize,
    layout.title.maxWidth,
    layout.title.minFontSize,
  );
  const artistSize = fitFontSize(
    artist,
    layout.artist.fontSize,
    layout.title.maxWidth,
    layout.title.minFontSize / 2,
  );
  const shadow = Math.max(1, Math.round(titleSize / 20));
  const cx = Math.round(width / 2);
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Title,Montserrat SemiBold,${titleSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,0.5,0,1,0,${shadow},8,0,0,0,1`,
    `Style: Artist,Montserrat SemiBold,${artistSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H60000000,0,0,0,0,100,100,${Math.max(1, Math.round(artistSize / 14))},0,1,0,${shadow},8,0,0,0,1`,
    `Style: Badge,Montserrat SemiBold,${layout.badge?.fontSize ?? 24},&H40FFFFFF,&H40FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,${Math.max(2, Math.round((layout.badge?.fontSize ?? 24) / 5))},0,1,0,1,8,0,0,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (title)
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,Title,,0,0,0,,{\\pos(${cx},${layout.title.top})}${title}`,
    );
  if (artist)
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,Artist,,0,0,0,,{\\pos(${cx},${layout.artist.top})}${artist}`,
    );
  const badge = escapeAssText(params.badge ?? '').toUpperCase();
  if (badge && layout.badge) {
    lines.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,Badge,,0,0,0,,{\\pos(${cx},${layout.badge.top})}${badge}`,
    );
  }
  return lines.join('\n') + '\n';
}

/** fontconfig configuration limited to the embedded font: fast and identical everywhere. */
export function buildFontsConfig(fontsDir: string, cacheDir: string): string {
  const xml = (value: string) =>
    value.replace(/\\/g, '/').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n' +
    `<fontconfig><dir>${xml(fontsDir)}</dir><cachedir>${xml(cacheDir)}</cachedir></fontconfig>\n`
  );
}

export interface RenderPlan {
  width: number;
  height: number;
  layout: Layout;
  /** Seconds. */
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** null = preview quality (fast, CRF). */
  encoding: FormatSpec['encoding'] | null;
  /**
   * Inputs, relative to the work folder (cwd). `audio` is the final soundtrack
   * (AAC, already faded and limited: see buildAudioArgs), copied as is.
   */
  files: {
    background: string;
    card: string;
    ass: string;
    fontsDir: string;
    audio: string;
    output: string;
  };
  /** Absolute path of the source audio file, read for the spectrum only. */
  source: string;
}

const round = (n: number) => Number(n.toFixed(3));

/** -1.5 dBFS → 0.841 */
export function dbToLinear(db: number): number {
  return Number((10 ** (db / 20)).toFixed(4));
}

/**
 * Soundtrack of the video: excerpt + fades + peak limiter, encoded to AAC.
 * The limiter works on a 4× oversampled signal so that sample peaks
 * approximate true peaks (level=0: no make-up gain, the loudness is kept).
 * The encoded result is then measured (buildTruePeakArgs), because AAC can add
 * overshoot: the engine lowers the ceiling and encodes again if needed.
 */
export function buildAudioArgs(params: {
  source: string;
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  ceilingDb: number;
  bitrate: string;
  output: string;
}): string[] {
  const d = params.duration;
  const fadeOutStart = round(Math.max(0, d - params.fadeOut));
  const filters = [
    params.fadeIn > 0 ? `afade=t=in:st=0:d=${round(params.fadeIn)}` : null,
    params.fadeOut > 0 ? `afade=t=out:st=${fadeOutStart}:d=${round(params.fadeOut)}` : null,
    `aresample=${TRUE_PEAK_RATE}`,
    `alimiter=limit=${dbToLinear(params.ceilingDb)}:attack=1:release=50:level=0`,
    'aresample=48000',
  ].filter(Boolean);
  return [
    '-v',
    'error',
    '-y',
    '-ss',
    String(round(params.start)),
    '-t',
    String(round(d)),
    '-i',
    params.source,
    '-vn',
    '-af',
    filters.join(','),
    '-c:a',
    'aac',
    '-b:a',
    params.bitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'mp4',
    params.output,
  ];
}

/** Measures the true peak of a file (EBU R128 meter; summary written on stderr). */
export function buildTruePeakArgs(file: string): string[] {
  return ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'];
}

/** Reads "True peak: … Peak: -1.3 dBFS" from the ebur128 summary. */
export function parseTruePeak(stderr: string): number | null {
  const match = /True peak:\s+Peak:\s+(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS/.exec(stderr);
  if (!match) return null;
  return match[1] === '-inf' ? -Infinity : Number(match[1]);
}

/** The main render: background + zooming cover + spectrum bars + text + grain + fades. */
export function buildRenderArgs(plan: RenderPlan): string[] {
  const { layout: l, duration: d } = plan;
  const bars = l.bars;
  const barCount = bars.width / bars.barWidth;
  const fadeOutStart = round(Math.max(0, d - plan.fadeOut));

  // Frequencies on a logarithmic (musical) scale. Music carries far more energy
  // in the bass than in the treble, so the visualisation branch only (not the
  // soundtrack) gets a treble tilt of +4 dB/octave above 120 Hz (max +15 dB)
  // and a compressed amplitude, to spread the movement over the whole width.
  const spectrum =
    `firequalizer=gain='min(15\\,max(0\\,4*log(f/120)/log(2)))',` +
    `showcqt=s=${barCount}x${bars.height}:fps=${FPS}:sono_h=0:axis_h=0:bar_g=2:bar_v=11:` +
    `cscheme=1|1|1|1|1|1:basefreq=45:endfreq=8000:count=2,` +
    `scale=${bars.width}:${bars.height}:flags=neighbor,` +
    `drawgrid=w=${bars.barWidth}:h=${bars.height}:t=${bars.gap}:c=black,` +
    `colorkey=black:0.08:0.05,colorchannelmixer=aa=${bars.opacity},format=rgba`;

  const videoFades = [
    plan.fadeIn > 0 ? `fade=t=in:st=0:d=${round(plan.fadeIn)}` : null,
    plan.fadeOut > 0 ? `fade=t=out:st=${fadeOutStart}:d=${round(plan.fadeOut)}` : null,
  ].filter(Boolean);

  const graph = [
    `[2:a]${spectrum}[bars]`,
    `[0:v]format=yuv420p[bg]`,
    `[1:v]scale=w='${l.cover.size + 2 * l.cover.shadowPad}*(1+${l.zoom}*t/${round(d)})':h=-1:eval=frame[card]`,
    `[bg][card]overlay=x=(W-w)/2:y=${l.cover.centerY}-h/2:format=yuv420[v1]`,
    `[v1][bars]overlay=x=(W-w)/2:y=${bars.top}:format=yuv420[v2]`,
    `[v2]` +
      [
        `subtitles=${plan.files.ass}:fontsdir=${plan.files.fontsDir}`,
        `noise=alls=${l.grain}:allf=t`,
        ...videoFades,
        'format=yuv420p',
      ].join(',') +
      `[vout]`,
  ].join(';');

  const quality = plan.encoding
    ? [
        '-preset',
        'veryfast',
        '-profile:v',
        'high',
        '-b:v',
        plan.encoding.videoBitrate,
        '-maxrate',
        plan.encoding.maxrate,
        '-bufsize',
        plan.encoding.bufsize,
        '-g',
        String(plan.encoding.gop),
        '-bf',
        '2',
      ]
    : ['-preset', 'ultrafast', '-crf', '28'];

  return [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-i',
    plan.files.background,
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-i',
    plan.files.card,
    '-ss',
    String(round(plan.start)),
    '-t',
    String(round(d)),
    '-i',
    plan.source,
    '-i',
    plan.files.audio,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    '-map',
    '3:a',
    '-t',
    String(round(d)),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    ...quality,
    // The soundtrack is already encoded and checked: copied, never re-encoded.
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp4',
    plan.files.output,
  ];
}

/** Still image 4:5 for an Instagram post, in the same style as the videos. */
export const POST_SPEC = {
  width: 1080,
  height: 1350,
  blur: 90,
  cover: { size: 700, centerY: 590, radius: 32, shadowPad: 70, shadowOffset: 16 },
  text: {
    title: { top: 1030, fontSize: 60, minFontSize: 32, maxWidth: 940 },
    artist: { top: 1112, fontSize: 40 },
    badge: { top: 118, fontSize: 28 },
  } satisfies TextLayout,
};

/** Composes the post image (background + card + text) into a high-quality JPEG. */
export function buildPostArgs(files: {
  background: string;
  card: string;
  ass: string;
  fontsDir: string;
  output: string;
}): string[] {
  const { cover } = POST_SPEC;
  return [
    '-v',
    'error',
    '-y',
    '-i',
    files.background,
    '-i',
    files.card,
    '-filter_complex',
    `[0:v][1:v]overlay=x=(W-w)/2:y=${cover.centerY}-h/2,` +
      `subtitles=${files.ass}:fontsdir=${files.fontsDir},format=yuvj444p`,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-f',
    'image2',
    files.output,
  ];
}

/** Reads the encoded position (seconds) from a `-progress` line, or null. */
export function parseProgressLine(line: string): number | null {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return match ? Number(match[1]) / 1_000_000 : null;
}

// Pure builders of FFmpeg arguments (parameters → argv). No I/O here: every
// function is unit-tested. FFmpeg runs with the work folder as cwd, so the
// filter graphs only reference relative file names (no Windows path escaping).
// Must stay compatible with FFmpeg 6.1 (Windows build).
import type { VideoFormat } from '../contract';

export const FPS = 30;

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
      artist: { top: 782, fontSize: 34 },
      bars: { width: 1400, height: 170, top: 868, barWidth: 20, gap: 5, opacity: 0.65 },
      grain: 6,
      blur: 60,
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
      artist: { top: 340, fontSize: 38 },
      bars: { width: 900, height: 220, top: 1380, barWidth: 20, gap: 5, opacity: 0.65 },
      grain: 6,
      blur: 60,
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

/** Background: the cover enlarged to fill the frame, blurred, darkened, vignetted. */
export function buildBackgroundArgs(
  cover: string,
  output: string,
  width: number,
  height: number,
  blur: number,
): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-i',
    cover,
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `gblur=sigma=${blur},eq=brightness=-0.22:saturation=1.15,vignette=angle=PI/4.5`,
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
export function buildAssScript(params: {
  width: number;
  height: number;
  title: string;
  artist: string;
  layout: Layout;
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
    `Style: Artist,Montserrat SemiBold,${artistSize},&H30FFFFFF,&H30FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,${Math.max(1, Math.round(artistSize / 16))},0,1,0,${Math.max(1, shadow - 1)},8,0,0,0,1`,
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
  /** Inputs, relative to the work folder (cwd). */
  files: { background: string; card: string; ass: string; fontsDir: string; output: string };
  /** Absolute path of the audio file (passed with -i, no escaping needed). */
  audio: string;
}

const round = (n: number) => Number(n.toFixed(3));

/** The main render: background + zooming cover + spectrum bars + text + grain + fades. */
export function buildRenderArgs(plan: RenderPlan): string[] {
  const { layout: l, duration: d } = plan;
  const bars = l.bars;
  const barCount = bars.width / bars.barWidth;
  const fadeOutStart = round(Math.max(0, d - plan.fadeOut));

  const spectrum =
    `showcqt=s=${barCount}x${bars.height}:fps=${FPS}:sono_h=0:axis_h=0:bar_g=1.4:bar_v=14:` +
    `cscheme=1|1|1|1|1|1:basefreq=35:endfreq=10000:count=2,` +
    `scale=${bars.width}:${bars.height}:flags=neighbor,` +
    `drawgrid=w=${bars.barWidth}:h=${bars.height}:t=${bars.gap}:c=black,` +
    `colorkey=black:0.08:0.05,colorchannelmixer=aa=${bars.opacity},format=rgba`;

  const videoFades = [
    plan.fadeIn > 0 ? `fade=t=in:st=0:d=${round(plan.fadeIn)}` : null,
    plan.fadeOut > 0 ? `fade=t=out:st=${fadeOutStart}:d=${round(plan.fadeOut)}` : null,
  ].filter(Boolean);
  const audioFades = [
    plan.fadeIn > 0 ? `afade=t=in:st=0:d=${round(plan.fadeIn)}` : null,
    plan.fadeOut > 0 ? `afade=t=out:st=${fadeOutStart}:d=${round(plan.fadeOut)}` : null,
  ].filter(Boolean);

  const graph = [
    `[2:a]asplit=2[aout0][aviz]`,
    `[aviz]${spectrum}[bars]`,
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
    `[aout0]${audioFades.length ? audioFades.join(',') : 'anull'}[aout]`,
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
        '-c:a',
        'aac',
        '-b:a',
        plan.encoding.audioBitrate,
      ]
    : ['-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k'];

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
    plan.audio,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    String(round(d)),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    ...quality,
    '-ar',
    '48000',
    '-ac',
    '2',
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

/** Reads the encoded position (seconds) from a `-progress` line, or null. */
export function parseProgressLine(line: string): number | null {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return match ? Number(match[1]) / 1_000_000 : null;
}

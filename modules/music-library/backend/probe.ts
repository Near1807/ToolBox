import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError } from '@hub/sdk/backend';

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  formatName: string | null;
  durationSec: number | null;
  bitRate: number | null;
  audio: { codec: string; sampleRate: number | null; channels: number | null } | null;
  /** First video stream: for images (covers) and embedded artwork. */
  image: { codec: string; width: number; height: number } | null;
  tags: { title?: string; artist?: string };
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
}

interface RawProbe {
  streams?: RawStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

const toNumber = (value: string | number | undefined): number | null => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : null;
};

/** Pure parser of `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbe(json: string): ProbeResult {
  const raw = JSON.parse(json) as RawProbe;
  const streams = raw.streams ?? [];
  const audio = streams.find((s) => s.codec_type === 'audio');
  const image = streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  // Tag names vary in case between formats (TITLE in FLAC, title in MP3).
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.format?.tags ?? {}))
    tags[key.toLowerCase()] = value;

  return {
    formatName: raw.format?.format_name ?? null,
    durationSec: toNumber(raw.format?.duration),
    bitRate: toNumber(raw.format?.bit_rate),
    audio: audio
      ? {
          codec: audio.codec_name ?? 'inconnu',
          sampleRate: toNumber(audio.sample_rate),
          channels: audio.channels ?? null,
        }
      : null,
    image: image
      ? { codec: image.codec_name ?? 'inconnu', width: image.width!, height: image.height! }
      : null,
    tags: {
      ...(tags.title?.trim() ? { title: tags.title.trim() } : {}),
      ...(tags.artist?.trim() ? { artist: tags.artist.trim() } : {}),
    },
  };
}

export async function probeFile(ffprobe: string, file: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return parseProbe(stdout);
  } catch {
    throw new HttpError(
      400,
      `Fichier illisible : format non reconnu ou fichier endommagé (${path.basename(file)})`,
    );
  }
}

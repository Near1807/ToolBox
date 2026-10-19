import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, type ModuleContext } from '@hub/sdk/backend';
import type { Track, TrackOutput } from '../contract';
import { probeFile, type ProbeResult } from './probe';

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png'];

interface TrackRow {
  id: number;
  title: string;
  artist: string | null;
  release_date: string | null;
  notes: string;
  tags: string;
  audio_file: string;
  audio_original_name: string;
  audio_format: string | null;
  duration_sec: number | null;
  sample_rate: number | null;
  channels: number | null;
  bit_rate: number | null;
  cover_file: string | null;
  cover_width: number | null;
  cover_height: number | null;
  created_at: string;
  updated_at: string;
}

interface OutputRow {
  id: number;
  track_id: number;
  module_id: string;
  kind: string;
  label: string;
  file_path: string;
  created_at: string;
}

export interface TrackUpdate {
  title?: unknown;
  artist?: unknown;
  releaseDate?: unknown;
  notes?: unknown;
  tags?: unknown;
}

function extensionOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

/** "01_my-new_track (master).wav" → "my new track (master)" */
export function titleFromFileName(file: string): string {
  const base = path.basename(file, path.extname(file));
  const cleaned = base
    .replace(/[_]+/g, ' ')
    // Leading track number: "03 - x", "3. x", "01 x"
    .replace(/^(\d{1,2}\s*[-.)]|0\d\s)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || base;
}

/** Validates and normalizes the editable fields of a track. */
export function validateTrackUpdate(update: TrackUpdate): Partial<{
  title: string;
  artist: string | null;
  release_date: string | null;
  notes: string;
  tags: string;
}> {
  const result: ReturnType<typeof validateTrackUpdate> = {};
  if (update.title !== undefined) {
    if (typeof update.title !== 'string' || update.title.trim() === '') {
      throw new HttpError(400, 'Le titre est obligatoire');
    }
    if (update.title.length > 200)
      throw new HttpError(400, 'Titre trop long (200 caractères max.)');
    result.title = update.title.trim();
  }
  if (update.artist !== undefined) {
    if (update.artist !== null && typeof update.artist !== 'string') {
      throw new HttpError(400, 'Artiste invalide');
    }
    const artist = typeof update.artist === 'string' ? update.artist.trim() : '';
    if (artist.length > 200) throw new HttpError(400, 'Nom d’artiste trop long');
    result.artist = artist === '' ? null : artist;
  }
  if (update.releaseDate !== undefined) {
    const date = update.releaseDate;
    if (
      date !== null &&
      date !== '' &&
      (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    ) {
      throw new HttpError(400, 'Date de sortie invalide (AAAA-MM-JJ)');
    }
    result.release_date = date ? (date as string) : null;
  }
  if (update.notes !== undefined) {
    if (typeof update.notes !== 'string') throw new HttpError(400, 'Notes invalides');
    if (update.notes.length > 10_000) throw new HttpError(400, 'Notes trop longues');
    result.notes = update.notes;
  }
  if (update.tags !== undefined) {
    if (!Array.isArray(update.tags) || update.tags.some((t) => typeof t !== 'string')) {
      throw new HttpError(400, 'Tags invalides');
    }
    const tags = [
      ...new Set(
        (update.tags as string[])
          .map((t) => t.trim().replace(/^#+/, '').slice(0, 40))
          .filter((t) => t !== ''),
      ),
    ].slice(0, 30);
    result.tags = JSON.stringify(tags);
  }
  return result;
}

/** All data access and file handling of the library (used by routes and the service). */
export class Library {
  private readonly tracks: string;
  private readonly outputs: string;

  constructor(private readonly ctx: ModuleContext) {
    this.tracks = ctx.db.table('tracks');
    this.outputs = ctx.db.table('outputs');
  }

  private defaultArtist(): string {
    return (this.ctx.settings.get<string>('defaultArtist') ?? '').trim();
  }

  private toTrack(row: TrackRow): Track {
    return {
      id: row.id,
      title: row.title,
      artist: row.artist ?? this.defaultArtist(),
      artistOverride: row.artist,
      releaseDate: row.release_date,
      notes: row.notes,
      tags: JSON.parse(row.tags) as string[],
      durationSec: row.duration_sec,
      audioFormat: row.audio_format,
      sampleRate: row.sample_rate,
      channels: row.channels,
      bitRate: row.bit_rate,
      audioPath: this.ctx.files.dataPath(row.audio_file),
      originalAudioName: row.audio_original_name,
      coverPath: row.cover_file ? this.ctx.files.dataPath(row.cover_file) : null,
      coverWidth: row.cover_width,
      coverHeight: row.cover_height,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): Track[] {
    const rows = this.ctx.db
      .prepare(`SELECT * FROM ${this.tracks} ORDER BY created_at DESC, id DESC`)
      .all() as TrackRow[];
    return rows.map((row) => this.toTrack(row));
  }

  get(id: number): Track | null {
    const row = this.ctx.db.prepare(`SELECT * FROM ${this.tracks} WHERE id = ?`).get(id) as
      TrackRow | undefined;
    return row ? this.toTrack(row) : null;
  }

  require(id: number): Track {
    const track = this.get(id);
    if (!track) throw new HttpError(404, 'Morceau introuvable');
    return track;
  }

  private async probeAudio(file: string): Promise<ProbeResult> {
    if (!AUDIO_EXTENSIONS.includes(extensionOf(file))) {
      throw new HttpError(
        400,
        `Format audio non pris en charge : ${path.basename(file)} (WAV, MP3 ou FLAC)`,
      );
    }
    const probe = await probeFile(this.ctx.binaries.ffprobe, file);
    if (!probe.audio || !probe.durationSec) {
      throw new HttpError(400, `« ${path.basename(file)} » ne contient pas de son lisible`);
    }
    return probe;
  }

  private async probeCover(
    file: string,
  ): Promise<ProbeResult & { image: NonNullable<ProbeResult['image']> }> {
    if (!IMAGE_EXTENSIONS.includes(extensionOf(file))) {
      throw new HttpError(
        400,
        `Format d’image non pris en charge : ${path.basename(file)} (JPG ou PNG)`,
      );
    }
    const probe = await probeFile(this.ctx.binaries.ffprobe, file);
    if (!probe.image)
      throw new HttpError(400, `« ${path.basename(file)} » n’est pas une image lisible`);
    return probe as ProbeResult & { image: NonNullable<ProbeResult['image']> };
  }

  /** Copies the files into the library (never links to their original location). */
  async add(audioPath: string, coverPath: string | null): Promise<Track> {
    const audio = await this.probeAudio(audioPath);
    const cover = coverPath ? await this.probeCover(coverPath) : null;
    const now = new Date().toISOString();

    const result = this.ctx.db
      .prepare(
        `INSERT INTO ${this.tracks} (title, artist, audio_file, audio_original_name, audio_format,
           duration_sec, sample_rate, channels, bit_rate, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        audio.tags.title ?? titleFromFileName(audioPath),
        audio.tags.artist ?? null,
        path.basename(audioPath),
        audio.audio!.codec,
        audio.durationSec,
        audio.audio!.sampleRate,
        audio.audio!.channels,
        audio.bitRate,
        now,
        now,
      );
    const id = Number(result.lastInsertRowid);
    const folder = `tracks/${id}`;

    try {
      await mkdir(this.ctx.files.dataPath(folder), { recursive: true });
      const audioFile = `${folder}/audio.${extensionOf(audioPath)}`;
      await copyFile(audioPath, this.ctx.files.dataPath(audioFile));
      this.ctx.db
        .prepare(`UPDATE ${this.tracks} SET audio_file = ? WHERE id = ?`)
        .run(audioFile, id);
      if (coverPath && cover) await this.storeCover(id, coverPath, cover.image);
    } catch (error) {
      this.ctx.db.prepare(`DELETE FROM ${this.tracks} WHERE id = ?`).run(id);
      await rm(this.ctx.files.dataPath(folder), { recursive: true, force: true });
      throw error;
    }

    this.ctx.logger.info(`Morceau ajouté : ${path.basename(audioPath)} (#${id})`);
    this.ctx.events.emit('track.created', { id });
    return this.require(id);
  }

  private async storeCover(
    id: number,
    coverPath: string,
    image: { width: number; height: number },
  ) {
    const folder = `tracks/${id}`;
    const previous = this.require(id).coverPath;
    const coverFile = `${folder}/cover-${Date.now()}.${extensionOf(coverPath)}`;
    await copyFile(coverPath, this.ctx.files.dataPath(coverFile));
    this.ctx.db
      .prepare(
        `UPDATE ${this.tracks} SET cover_file = ?, cover_width = ?, cover_height = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(coverFile, image.width, image.height, new Date().toISOString(), id);
    if (previous) await rm(previous, { force: true });
  }

  async setCover(id: number, coverPath: string): Promise<Track> {
    this.require(id);
    const cover = await this.probeCover(coverPath);
    await this.storeCover(id, coverPath, cover.image);
    this.ctx.events.emit('track.updated', { id });
    return this.require(id);
  }

  update(id: number, update: TrackUpdate): Track {
    this.require(id);
    const fields = validateTrackUpdate(update);
    const entries = Object.entries(fields);
    if (entries.length > 0) {
      const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
      this.ctx.db
        .prepare(`UPDATE ${this.tracks} SET ${assignments}, updated_at = ? WHERE id = ?`)
        .run(...entries.map(([, value]) => value), new Date().toISOString(), id);
      this.ctx.events.emit('track.updated', { id });
    }
    return this.require(id);
  }

  /** Removes the track and the library's copies of its files (generated videos are kept). */
  async remove(id: number): Promise<void> {
    this.require(id);
    this.ctx.db.prepare(`DELETE FROM ${this.tracks} WHERE id = ?`).run(id);
    await rm(this.ctx.files.dataPath(`tracks/${id}`), { recursive: true, force: true });
    this.ctx.logger.info(`Morceau #${id} supprimé`);
    this.ctx.events.emit('track.deleted', { id });
  }

  private toOutput(row: OutputRow): TrackOutput {
    return {
      id: row.id,
      trackId: row.track_id,
      moduleId: row.module_id,
      kind: row.kind,
      label: row.label,
      filePath: row.file_path,
      createdAt: row.created_at,
    };
  }

  recordOutput(
    trackId: number,
    output: { moduleId: string; kind: string; label: string; filePath: string },
  ): TrackOutput {
    if (!this.get(trackId)) throw new Error(`Morceau #${trackId} introuvable`);
    const result = this.ctx.db
      .prepare(
        `INSERT INTO ${this.outputs} (track_id, module_id, kind, label, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trackId,
        output.moduleId,
        output.kind,
        output.label,
        output.filePath,
        new Date().toISOString(),
      );
    return this.getOutput(Number(result.lastInsertRowid))!;
  }

  getOutput(id: number): TrackOutput | null {
    const row = this.ctx.db.prepare(`SELECT * FROM ${this.outputs} WHERE id = ?`).get(id) as
      OutputRow | undefined;
    return row ? this.toOutput(row) : null;
  }

  listOutputs(trackId: number): TrackOutput[] {
    const rows = this.ctx.db
      .prepare(`SELECT * FROM ${this.outputs} WHERE track_id = ? ORDER BY created_at DESC, id DESC`)
      .all(trackId) as OutputRow[];
    return rows.map((row) => this.toOutput(row));
  }
}

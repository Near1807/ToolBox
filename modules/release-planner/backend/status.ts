// Statuses of a planned element. Stored states change only through allowed
// transitions; what the user sees (late, published on Instagram…) is derived.
import type { ItemKind } from './plan';
import { PLATFORM } from './plan';

/**
 * planned: in the calendar, nothing sent · queued: waiting for its upload
 * (quota, retry) · uploading · scheduled: on YouTube, private until publishAt ·
 * to-schedule: on YouTube but private without a date (to schedule by hand in
 * YouTube Studio) · published · failed.
 */
export type ItemState =
  'planned' | 'queued' | 'uploading' | 'scheduled' | 'to-schedule' | 'published' | 'failed';

const TRANSITIONS: Record<ItemState, ItemState[]> = {
  planned: ['queued', 'published'],
  queued: ['uploading', 'planned', 'failed'],
  uploading: ['scheduled', 'to-schedule', 'published', 'failed', 'queued', 'planned'],
  scheduled: ['scheduled', 'to-schedule', 'published', 'failed'],
  'to-schedule': ['scheduled', 'published', 'failed', 'to-schedule'],
  published: ['planned', 'failed', 'scheduled'],
  failed: ['queued', 'planned', 'scheduled', 'to-schedule', 'published'],
};

export function canTransition(from: ItemState, to: ItemState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {}

export function assertTransition(from: ItemState, to: ItemState): void {
  if (!canTransition(from, to)) {
    throw new TransitionError(`Changement d’état impossible : ${from} → ${to}`);
  }
}

/** True once the element exists on YouTube (it then has a YouTube id). */
export function isOnline(state: ItemState): boolean {
  return state === 'scheduled' || state === 'to-schedule' || state === 'published';
}

/** Instagram elements and YouTube ones still to send can be moved freely. */
export function displayStatus(input: {
  kind: ItemKind;
  state: ItemState;
  scheduledAt: string;
  /** Instagram: the « Publié » box of the pack. */
  instaPublishedAt?: string | null;
  now: Date;
}): { status: ItemState; late: boolean } {
  const status: ItemState =
    PLATFORM[input.kind] === 'instagram'
      ? input.instaPublishedAt
        ? 'published'
        : 'planned'
      : input.state;
  const due = Date.parse(input.scheduledAt) <= input.now.getTime();
  // A scheduled video goes out by itself: only what needs the user is late.
  const late = due && status !== 'published' && status !== 'scheduled';
  return { status, late };
}

/** Status read from YouTube (videos.list) → state of the element. */
export function stateFromYouTube(video: {
  privacyStatus?: string;
  publishAt?: string | null;
  uploadStatus?: string;
}): { state: ItemState; error?: string } {
  if (video.uploadStatus === 'rejected' || video.uploadStatus === 'failed') {
    return { state: 'failed', error: `YouTube a refusé la vidéo (${video.uploadStatus})` };
  }
  if (video.privacyStatus === 'public') return { state: 'published' };
  if (video.privacyStatus === 'private' && video.publishAt) return { state: 'scheduled' };
  if (video.privacyStatus === 'unlisted') return { state: 'published' };
  return { state: 'to-schedule' };
}

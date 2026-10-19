// Direct upload to YouTube — prepared, not implemented in V1 (see docs/ROADMAP.md).
//
// How to add it later, without changing the rest of the module:
// 1. Declare "permissions": { "accounts": ["google"] } in module.json and request the
//    "youtube.upload" scope through ctx.accounts (phase 5 adds Google accounts).
// 2. Implement YouTubeUploader with the YouTube Data API v3 resumable upload
//    (videos.insert, uploadType=resumable), reporting progress to the job.
// 3. Add an "upload" job type in index.ts that calls it and fills the
//    youtube_video__videos.youtube_video_id / uploaded_at columns (already there).

export interface UploadMetadata {
  title: string;
  description: string;
  tags: string[];
  /** "private" first, so Thomas can check before publishing. */
  privacyStatus: 'private' | 'unlisted' | 'public';
}

export interface YouTubeUploader {
  upload(
    filePath: string,
    metadata: UploadMetadata,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void },
  ): Promise<{ youtubeVideoId: string }>;
}

export const UPLOAD_AVAILABLE = false;

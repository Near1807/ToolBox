// Video and sound: the browser's own players (nothing sent anywhere).
import { Icon } from '@hub/sdk/frontend';
import { registerReader, type ReaderProps } from './registry';
import { useSourceUrl } from './useSource';

function VideoReader({ source, mode }: ReaderProps) {
  const url = useSourceUrl(source);
  if (!url) return null;
  if (mode === 'thumb')
    // The first image (no sound, no controls): preload only what it needs.
    return (
      <video
        className="coffre-reader-thumb-img"
        src={`${url}#t=0.5`}
        preload="metadata"
        muted
        playsInline
      />
    );
  return <video className="coffre-reader-video" src={url} controls preload="metadata" />;
}

function AudioReader({ source, mode }: ReaderProps) {
  const url = useSourceUrl(source);
  if (mode === 'thumb')
    return (
      <span className="coffre-reader-icon">
        <Icon name="waveform" />
      </span>
    );
  if (!url) return null;
  return (
    <div className="coffre-reader-audio">
      <Icon name="waveform" />
      <audio src={url} controls preload="metadata" />
    </div>
  );
}

registerReader({
  id: 'video',
  label: 'Vidéo',
  extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'],
  component: VideoReader,
});
registerReader({
  id: 'audio',
  label: 'Son',
  extensions: ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus'],
  component: AudioReader,
});

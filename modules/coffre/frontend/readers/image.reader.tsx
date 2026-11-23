// Images the browser shows itself.
import { registerReader, type ReaderProps } from './registry';
import { useSourceUrl } from './useSource';

function ImageReader({ source, mode }: ReaderProps) {
  const url = useSourceUrl(source);
  if (!url) return null;
  return (
    <img
      className={mode === 'thumb' ? 'coffre-reader-thumb-img' : 'coffre-reader-image'}
      src={url}
      alt={source.name}
      loading="lazy"
      draggable={false}
    />
  );
}

registerReader({
  id: 'image',
  label: 'Image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'],
  maxBytes: 80_000_000,
  thumbMaxBytes: 25_000_000,
  component: ImageReader,
});

import { Icon } from '@hub/sdk/frontend';
/** Cover image, or a placeholder when the track has no cover yet. */
export function CoverImage(props: { url: string | null; title: string; small?: boolean }) {
  const className = `ml-cover${props.small ? ' ml-cover--small' : ''}`;
  if (!props.url) {
    return (
      <div className={`${className} ml-cover--empty`} aria-label="Pas de cover">
        <Icon name="music" />
      </div>
    );
  }
  return (
    <img className={className} src={props.url} alt={`Cover de ${props.title}`} draggable={false} />
  );
}

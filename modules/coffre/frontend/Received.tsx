// v0.47.0 (Expérimental): « /m/coffre/ranger/<lot> » — files sent by Windows
// (« Ranger dans ToolBox », « Envoyer vers », ADR 0059): the Coffre's home,
// the rangement window open with ALL of them (several files sent together:
// one window). Nothing is put away before Thomas's « Ranger ».
import { useEffect, useRef, type ComponentType } from 'react';
import { useParams } from 'react-router';
import { ErrorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { useCoffre } from './frame';

interface Batch {
  id: string;
  paths: string[];
  folders: number;
  missing: number;
}

export function ReceivedPage(props: { home: ComponentType }) {
  const { batch = '' } = useParams();
  const module = useModule();
  const coffre = useCoffre();
  const got = useApi<Batch>(batch ? module.url(`/received/${batch}`) : null);
  const done = useRef<string | null>(null);
  useEffect(() => {
    // The answer for THIS batch (the previous one's may still be shown a moment).
    if (!got.data || got.data.id !== batch || done.current === batch) return;
    done.current = batch;
    if (got.data.missing)
      coffre.notify(
        `${got.data.missing} fichier${got.data.missing > 1 ? 's' : ''} introuvable${got.data.missing > 1 ? 's' : ''} (déplacé${got.data.missing > 1 ? 's' : ''} entre-temps).`,
      );
    coffre.range(got.data.paths);
  }, [got.data, batch, coffre]);
  const Home = props.home;
  return (
    <>
      {got.error && <ErrorMessage>{got.error}</ErrorMessage>}
      <Home />
    </>
  );
}

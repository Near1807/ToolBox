// v0.51.0 F (Expérimental, ADR 0068): a project « suivi en place » in its
// folder's header — its real folder, « introuvable » when it is not there
// (« Le retrouver… », checked by its files), and the conversions both ways:
// « Le suivre en place… » (an empty folder the Coffre copies it to, or a folder
// that already holds it, compared first) / « Le copier dans le Coffre » (the
// original stays where it is, no longer followed — said).
import { Button, formatBytes, pickFolder, runJob, useModule } from '@hub/sdk/frontend';
import type { FolderDto, TrackCompareDto } from '../shared/types';
import { useCoffre } from './frame';

/** « 12 identiques, 1 modifié (src/main.cpp), 1 en plus (notes.md) ». */
export function compareText(c: TrackCompareDto): string {
  const list = (names: string[]) =>
    names.length ? ` (${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''})` : '';
  return [
    `${c.same} identique${c.same > 1 ? 's' : ''} sur ${c.known} connus`,
    c.changed.length ? `${c.changed.length} différent(s)${list(c.changed)}` : '',
    c.added.length ? `${c.added.length} en plus${list(c.added)}` : '',
    c.missing.length ? `${c.missing.length} absent(s)${list(c.missing)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

export function TrackedBar(props: { folder: FolderDto; size: number }) {
  const module = useModule();
  const coffre = useCoffre();
  const f = props.folder;
  if (!f.project) return null;
  const done = (message: string, undoId?: string) => {
    coffre.notify(message, undoId ?? null);
    coffre.refresh();
  };
  const relocate = async () => {
    try {
      const dir = await pickFolder({ title: `Le retrouver : le dossier de « ${f.name} »` });
      if (!dir) return;
      const seen = await runJob<{ compared: TrackCompareDto }>(
        module.api.post(`/folders/${f.id}/relocate`, { path: dir }),
      );
      if (!seen.compared.looksLike) {
        coffre.notify(
          `Ce dossier ne ressemble pas au projet : ${compareText(seen.compared)}. Rien n’a changé.`,
        );
        return;
      }
      if (!window.confirm(`Suivre « ${f.name} » dans\n${dir} ?\n\n${compareText(seen.compared)}.`))
        return;
      const r = await runJob<{ undoId: string }>(
        module.api.post(`/folders/${f.id}/relocate`, { path: dir, confirm: true }),
      );
      done(`« ${f.name} » est de nouveau suivi.`, r.undoId);
    } catch (e) {
      coffre.fail(e);
    }
  };
  const track = async (mode: 'copy' | 'existing') => {
    try {
      const dir = await pickFolder({
        title:
          mode === 'copy'
            ? `Un dossier VIDE où « ${f.name} » vivra`
            : `Le dossier qui contient déjà « ${f.name} »`,
      });
      if (!dir) return;
      if (mode === 'existing') {
        const seen = await runJob<{ compared: TrackCompareDto }>(
          module.api.post(`/folders/${f.id}/track`, { path: dir, mode }),
        );
        if (
          !window.confirm(
            `Suivre ce dossier à la place de la copie du Coffre ?\n${dir}\n\n${compareText(seen.compared)}.\n\nC’est ce dossier qui comptera ; la copie du Coffre part dans sa corbeille (dossier « _Corbeille »). Tu pourras annuler.`,
          )
        )
          return;
      } else if (
        !window.confirm(
          `Copier « ${f.name} » (${formatBytes(props.size)}) dans\n${dir}\net le suivre là ?\n\nAprès la copie, celle du Coffre part dans sa corbeille (dossier « _Corbeille »). Tu pourras annuler.`,
        )
      )
        return;
      const r = await runJob<{ undoId: string }>(
        module.api.post(`/folders/${f.id}/track`, { path: dir, mode, confirm: true }),
      );
      done(`« ${f.name} » est suivi en place dans ${dir}.`, r.undoId);
    } catch (e) {
      coffre.fail(e);
    }
  };
  const untrack = async () => {
    if (
      !window.confirm(
        `Copier « ${f.name} » dans le Coffre ?\n\nLe dossier d’origine (${f.tracked?.path}) reste où il est, intact, mais il ne sera plus suivi : ce seront deux dossiers indépendants.`,
      )
    )
      return;
    try {
      const r = await runJob<{ undoId: string }>(module.api.post(`/folders/${f.id}/untrack`, {}));
      done(
        `« ${f.name} » est copié dans le Coffre. L’original reste en place, plus suivi.`,
        r.undoId,
      );
    } catch (e) {
      coffre.fail(e);
    }
  };
  return (
    <div className="coffre-tracked" data-coffre-tracked={f.tracked ? 'yes' : 'no'}>
      {f.tracked ? (
        <>
          <span className="coffre-kind coffre-kind--tracked">Suivi en place</span>
          <span className="small coffre-tracked__path" title={f.tracked.path}>
            {f.tracked.path}
          </span>
          {f.tracked.missing && (
            <>
              <span className="coffre-chip coffre-chip--warn" data-coffre-missing>
                introuvable
              </span>
              <Button small onClick={() => void relocate()}>
                Le retrouver…
              </Button>
            </>
          )}
          <Button variant="secondary" small onClick={() => void untrack()}>
            Le copier dans le Coffre
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" small onClick={() => void track('copy')}>
            Le suivre en place…
          </Button>
          <Button variant="secondary" small onClick={() => void track('existing')}>
            Le suivre dans un dossier qui le contient déjà…
          </Button>
        </>
      )}
      <span className="badge badge--warning">Expérimental</span>
    </div>
  );
}

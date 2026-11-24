// v0.46.0 H: « Santé du coffre » — the PC's gauge (the Coffre / the rest /
// free), the disk's gauge (current versions / history / Recycle Bin / free),
// the last update, « pas encore sur le disque », the verification, and the
// archiving suggestions (never applied alone).
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button, Counter, formatBytes, Gauge, useApi, useModule } from '@hub/sdk/frontend';
import type { DiskStatusDto, HomeDto, IndexStatusDto } from '../../shared/types';
import { useCoffre } from '../frame';
import { ago, plural } from './useDisk';

interface VerifyReport {
  at: string;
  checked: number;
  problems: unknown[];
  stopped: string | null;
}

const pct = (n: number) => `${Math.round(n * 100)} %`;

export function Health(props: { home: HomeDto; disk: DiskStatusDto | null; onVerify: () => void }) {
  const module = useModule();
  const coffre = useCoffre();
  const h = props.home.health;
  const s = props.disk;
  const verify = useApi<VerifyReport | null>(s?.disk ? module.url('/disk/verify') : null);
  const suggest = useApi<{ count: number; bytes: number }>(
    s?.disk ? module.url('/suggestions/archive') : null,
  );

  // The PC: the Coffre, the rest of the disk used, free.
  const pcTotal = h.diskTotal ?? 0;
  const pcFree = h.diskFree ?? 0;
  const pcCoffre = pcTotal ? h.bytes / pcTotal : 0;
  const pcOther = pcTotal ? Math.max(0, (pcTotal - pcFree - h.bytes) / pcTotal) : 0;
  // The disk: current versions, history, Recycle Bin, the rest used, free.
  const dTotal = s?.total ?? 0;
  const dFree = s?.free ?? 0;
  const part = (n: number) => (dTotal ? n / dTotal : 0);
  const dOther = s
    ? Math.max(0, part(dTotal - dFree - s.bytes.current - s.bytes.history - s.bytes.trash))
    : 0;

  return (
    <section className="coffre-panel coffre-health" aria-label="Santé du coffre">
      <h2 className="coffre-h2">Santé du coffre</h2>
      <div className="coffre-health__gauges">
        <figure className="coffre-health__gauge">
          <Gauge
            value={pcCoffre + pcOther}
            segments={[
              {
                value: pcCoffre,
                color: 'var(--accent)',
                label: `Coffre : ${formatBytes(h.bytes)}`,
              },
              { value: pcOther, color: 'var(--border-strong)', label: 'Autres fichiers' },
            ]}
            label={pcTotal ? pct(pcCoffre + pcOther) : '—'}
            sub={h.diskFree !== null ? `${formatBytes(h.diskFree)} libres` : 'inconnu'}
            title="Disque du PC : le Coffre, le reste, la place libre"
          />
          <figcaption>
            <strong>PC</strong>
            <span>
              <i className="coffre-dot coffre-dot--accent" /> Coffre {formatBytes(h.bytes)}
            </span>
          </figcaption>
        </figure>
        {s?.disk && (
          <figure
            className={`coffre-health__gauge${s.connected ? '' : ' coffre-health__gauge--off'}`}
          >
            <Gauge
              value={s.connected ? 1 - part(dFree) : 0}
              segments={
                s.connected
                  ? [
                      { value: part(s.bytes.current), color: 'var(--series-1)', label: 'Actuels' },
                      {
                        value: part(s.bytes.history),
                        color: 'var(--series-2)',
                        label: 'Historique',
                      },
                      { value: part(s.bytes.trash), color: 'var(--series-3)', label: 'Corbeille' },
                      { value: dOther, color: 'var(--border-strong)', label: 'Autres fichiers' },
                    ]
                  : []
              }
              label={s.connected ? pct(1 - part(dFree)) : 'absent'}
              sub={s.connected ? `${formatBytes(dFree)} libres` : s.disk.name}
              title={`Disque « ${s.disk.name} » : actuels, historique, corbeille, place libre`}
            />
            <figcaption>
              <strong>{s.disk.name}</strong>
              <span>
                <i className="coffre-dot coffre-dot--1" /> actuels {formatBytes(s.bytes.current)}
              </span>
              <span>
                <i className="coffre-dot coffre-dot--2" /> historique {formatBytes(s.bytes.history)}{' '}
                / {formatBytes(s.quota)}
              </span>
              <span>
                <i className="coffre-dot coffre-dot--3" /> corbeille {formatBytes(s.bytes.trash)}
              </span>
            </figcaption>
          </figure>
        )}
        <div className="coffre-health__counters">
          <Counter value={h.items} label="éléments" />
          <Link to={coffre.path('etat/pending')} className="coffre-health__trash">
            <Counter
              value={h.pending}
              label="pas encore sur le disque"
              tone={h.pending ? 'accent' : 'plain'}
            />
          </Link>
          {h.archived > 0 && (
            <Link to={coffre.path('etat/archived')} className="coffre-health__trash">
              <Counter value={h.archived} label="archivés" />
            </Link>
          )}
          <Link to={coffre.path('corbeille')} className="coffre-health__trash">
            <Counter value={h.trashCount} label="dans la corbeille" />
          </Link>
        </div>
      </div>
      <div className="coffre-health__foot">
        {s?.disk ? (
          <>
            <span>Dernière mise à jour du disque : {ago(s.lastUpdateAt)}</span>
            {verify.data && (
              <span className={verify.data.problems.length ? 'coffre-health__bad' : undefined}>
                · Vérifié {ago(verify.data.at)} :{' '}
                {verify.data.problems.length
                  ? plural(verify.data.problems.length, 'problème')
                  : 'aucun problème'}
              </span>
            )}
            <Button
              variant="secondary"
              small
              disabled={!s.connected || s.busy !== null}
              onClick={props.onVerify}
            >
              Vérifier le disque
            </Button>
          </>
        ) : (
          <span className="coffre-health__bad">
            Aucune sauvegarde : choisis un disque dans{' '}
            <a href={`#/settings?s=${encodeURIComponent(module.id)}`}>Réglages › Coffre</a>.
          </span>
        )}
      </div>
      <IndexLine />
      {suggest.data && suggest.data.count > 0 && (
        <p className="coffre-health__suggest">
          {plural(suggest.data.count, 'élément')} pas ouvert{suggest.data.count > 1 ? 's' : ''}{' '}
          depuis 6 mois ({formatBytes(suggest.data.bytes)}) : les archiver libérerait cette place
          sur le PC. <Link to={coffre.path('etat/suggest')}>Voir</Link>
        </p>
      )}
    </section>
  );
}

/**
 * v0.47.0: the reading of the texts (search in the content), in the
 * background: its progress while it runs, the scanned PDF without text.
 */
function IndexLine() {
  const module = useModule();
  const status = useApi<IndexStatusDto & { reading: string | null }>(module.url('/search/status'));
  const s = status.data;
  const { reload } = status;
  const running = Boolean(s && (s.pending > 0 || s.running));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [running, reload]);
  if (!s || !s.total) return null;
  return (
    <p className="coffre-health__index small" data-coffre-index>
      <span className="badge badge--warning">Expérimental</span>{' '}
      {running ? (
        <>
          Lecture des textes pour la recherche : {s.done} / {s.total}
          {s.reading ? ` (${s.reading})` : ''}. En arrière-plan, priorité basse.
        </>
      ) : (
        <>
          Recherche dans le contenu : {plural(s.withText, 'élément')} lu
          {s.withText > 1 ? 's' : ''}
          {s.noText > 0 &&
            ` · ${s.noText} PDF sans texte (scanné${s.noText > 1 ? 's' : ''} : pas d’OCR)`}
          {s.errors > 0 && ` · ${plural(s.errors, 'fichier')} illisible${s.errors > 1 ? 's' : ''}`}.
        </>
      )}
    </p>
  );
}

// Main page of the release planner: today, the calendar (month / week), the
// planned releases, and the Google account tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  Page,
  useApi,
  useJobs,
  useModule,
} from '@hub/sdk/frontend';
import { Calendar, calendarRange, type CalendarView } from './Calendar';
import { AddCustomReelDialog } from './AddCustomReelDialog';
import { addDays, addMonths, longDate, monthTitle, startOfWeek } from './dates';
import { GoogleAccount } from './GoogleAccount';
import { ItemPanel } from './ItemPanel';
import { PlatformIcon, trackColor } from './ItemParts';
import { PlanDialog } from './PlanDialog';
import { TodayView } from './TodayView';
import type { PlannerItem, Release, Summary } from './types';

function ReleaseRow(props: {
  release: Release;
  /** « Ajouter un Reel perso »: only when « Reels depuis mes vidéos » is present. */
  onAddCustomReel: (() => void) | null;
  onChanged: (message?: string) => void;
}) {
  const module = useModule();
  const { release } = props;
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const youtube = release.items.filter((i) => i.platform === 'youtube');
  const toSend = youtube.filter((i) => i.state === 'planned' || i.state === 'failed');
  const online = youtube.filter(
    (i) => i.youtube && ['scheduled', 'to-schedule', 'published'].includes(i.state),
  );
  const done = release.items.filter((i) => i.status === 'published').length;

  const run = async (
    action: () => Promise<unknown>,
    message?: (result: unknown) => string | undefined,
  ) => {
    setError(null);
    try {
      const result = await action();
      props.onChanged(message?.(result));
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const remove = (mode?: 'keep' | 'delete') => {
    if (
      !mode &&
      !window.confirm(
        `Retirer « ${release.trackTitle} » du planning ? Les fichiers générés ne sont pas touchés.`,
      )
    )
      return;
    if (
      mode === 'delete' &&
      !window.confirm(`Supprimer définitivement ${online.length} vidéo(s) de YouTube ?`)
    )
      return;
    void run(
      () => module.api.delete(`/releases/${release.id}${mode ? `?online=${mode}` : ''}`),
      () => 'Morceau retiré du planning.',
    );
  };

  return (
    <li
      className="list__item list__item--top rp-release"
      style={{ borderLeftColor: trackColor(release.colorIndex) }}
    >
      <div>
        <strong>{release.trackTitle}</strong> <span className="muted">— {release.artist}</span>
        <div className="muted small">
          Sortie le {longDate(release.date, true)} à {release.time} · {done}/{release.items.length}{' '}
          publiés · {youtube.filter((i) => i.state === 'scheduled').length}/{youtube.length}{' '}
          programmés sur YouTube
        </div>
        <div className="rp-release__icons">
          {release.items.map((item) => (
            <span
              key={item.id}
              title={`${item.label} : ${item.date}`}
              className={`rp-release__icon rp-dot--${item.status}`}
            >
              <PlatformIcon kind={item.kind} size={13} />
            </span>
          ))}
        </div>
        {toSend.length > 0 && (
          <p className="rp-send-help small muted">
            Envoie maintenant les {toSend.length} vidéos en privé ; YouTube les publiera seul à leur
            date, même PC éteint. Rien ne part sans ce clic (sauf envoi automatique activé). Garde
            ToolBox ouvert pendant l’envoi.
          </p>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {removing && (
          <div className="rp-note rp-note--warning">
            {online.length} vidéo(s) déjà sur YouTube.
            <div className="inline-form">
              <Button small variant="secondary" onClick={() => remove('keep')}>
                Retirer du planning seulement
              </Button>
              <Button small variant="danger" onClick={() => remove('delete')}>
                Supprimer aussi sur YouTube
              </Button>
              <Button small variant="secondary" onClick={() => setRemoving(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
      <span className="inline-form">
        {toSend.length > 0 && (
          <Button
            small
            onClick={() =>
              void run(
                () => module.api.post(`/releases/${release.id}/upload`),
                (result) => {
                  const r = result as {
                    queued: number;
                    skipped: string[];
                    quotaMessage: string | null;
                  };
                  return [`${r.queued} envoi(s) lancé(s).`, ...r.skipped, r.quotaMessage]
                    .filter(Boolean)
                    .join(' ');
                },
              )
            }
          >
            Envoyer sur YouTube ({toSend.length})
          </Button>
        )}
        {props.onAddCustomReel && (
          <Button small variant="secondary" onClick={props.onAddCustomReel}>
            Ajouter un Reel perso
          </Button>
        )}
        <Button
          small
          variant="danger"
          onClick={() => (online.length > 0 ? setRemoving(true) : remove())}
        >
          Retirer
        </Button>
      </span>
    </li>
  );
}

/** Authorization expired or revoked: uploads wait; one click to reconnect. */
function ReconnectBanner(props: { queue: number; onDone: (message?: string) => void }) {
  const module = useModule();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await module.api.post('/account/connect');
      props.onDone('Compte Google reconnecté : les envois en attente repartent.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rp-note rp-note--error rp-reconnect" role="alert">
      <div>
        <strong>Compte Google à reconnecter.</strong> L’autorisation YouTube a expiré ou a été
        retirée (en mode « Test », Google la coupe au bout de 7 jours).{' '}
        {props.queue > 0
          ? `${props.queue} envoi(s) en attente : ils partiront tout seuls après la reconnexion.`
          : 'Les prochains envois attendront la reconnexion.'}
        {error && <div className="small">{error}</div>}
      </div>
      <Button disabled={busy} onClick={() => void reconnect()}>
        {busy ? 'Autorise ToolBox dans le navigateur…' : 'Reconnecter'}
      </Button>
    </div>
  );
}

export function PlannerPage() {
  const module = useModule();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'compte' ? 'compte' : 'calendrier';
  const summary = useApi<Summary>(module.url('/summary'));
  const today = summary.data?.today ?? null;
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState<string | null>(null);
  const shown = anchor ?? today;
  const range = shown ? calendarRange(view, shown) : null;
  const calendar = useApi<{ items: PlannerItem[] }>(
    range ? module.url(`/calendar?from=${range.from}&to=${range.to}`) : null,
  );
  const todayList = useApi<{ date: string; today: PlannerItem[]; late: PlannerItem[] }>(
    module.url('/today'),
  );
  const releases = useApi<Release[]>(module.url('/releases'));
  const { jobs } = useJobs(module.id);
  const [planning, setPlanning] = useState(false);
  const [addingTo, setAddingTo] = useState<Release | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedId = Number(params.get('item')) || null;

  const reloadAll = useCallback(() => {
    summary.reload();
    calendar.reload();
    todayList.reload();
    releases.reload();
  }, [summary, calendar, todayList, releases]);

  // Uploads progress and finish in the background: refresh when a job changes.
  const jobState = jobs.map((job) => `${job.id}:${job.status}`).join(',');
  const lastJobState = useRef(jobState);
  useEffect(() => {
    if (jobState === lastJobState.current) return;
    lastJobState.current = jobState;
    reloadAll();
  }, [jobState, reloadAll]);

  const all = useMemo(() => {
    const byId = new Map<number, PlannerItem>();
    for (const item of [
      ...(calendar.data?.items ?? []),
      ...(todayList.data?.today ?? []),
      ...(todayList.data?.late ?? []),
      ...(releases.data?.flatMap((r) => r.items) ?? []),
    ]) {
      byId.set(item.id, item);
    }
    return byId;
  }, [calendar.data, todayList.data, releases.data]);
  const selected = selectedId ? (all.get(selectedId) ?? null) : null;

  const open = (item: PlannerItem | null) => {
    const next = new URLSearchParams(params);
    if (item) next.set('item', String(item.id));
    else next.delete('item');
    setParams(next, { replace: true });
  };
  const setTab = (value: 'calendrier' | 'compte') => {
    const next = new URLSearchParams(params);
    if (value === 'compte') next.set('tab', 'compte');
    else next.delete('tab');
    setParams(next, { replace: true });
  };

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await module.api.post<{ checked: number }>('/check-now');
      changed(
        result.checked > 0
          ? `${result.checked} vidéo(s) vérifiée(s) sur YouTube : états à jour.`
          : 'Rien à vérifier sur YouTube pour l’instant.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const changed = (text?: string) => {
    setMessage(text ?? null);
    setError(null);
    reloadAll();
  };

  const move = async (itemId: number, date: string) => {
    const item = all.get(itemId);
    if (!item || item.date === date) return;
    // Contrôle et sécurité: moving something already on YouTube changes it online: ask first.
    if (
      item.youtube &&
      !window.confirm(
        `${item.label} — ${item.trackTitle} est déjà sur YouTube. Déplacer sa publication au ${longDate(date)} (changé tout de suite sur YouTube) ?`,
      )
    ) {
      return;
    }
    try {
      const result = await module.api.patch<{ warnings: string[] }>(`/items/${itemId}`, { date });
      changed(
        `${item.label} — ${item.trackTitle} déplacé au ${longDate(date)}${item.youtube ? ' (date mise à jour sur YouTube)' : ''}. ${result.warnings.join(' ')}`,
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const tracksInView = new Map<number, { title: string; color: number }>();
  for (const item of calendar.data?.items ?? [])
    tracksInView.set(item.trackId, { title: item.trackTitle, color: item.colorIndex });
  const account = summary.data?.account;

  return (
    <Page
      title="Planning de sortie"
      subtitle="YouTube et Shorts programmés directement sur YouTube ; Instagram publié à la main, avec rappels."
      actions={
        <>
          <Button
            variant={tab === 'compte' ? 'primary' : 'secondary'}
            onClick={() => setTab(tab === 'compte' ? 'calendrier' : 'compte')}
          >
            {tab === 'compte' ? 'Retour au calendrier' : 'Compte Google'}
          </Button>
          {tab === 'calendrier' && account?.connected && (
            <Button
              variant="secondary"
              disabled={checking}
              title="Relit tout de suite l’état de chaque vidéo sur YouTube (sinon toutes les 30 min)"
              onClick={() => void checkNow()}
            >
              {checking ? 'Vérification…' : 'Vérifier sur YouTube maintenant'}
            </Button>
          )}
          {tab === 'calendrier' && (
            <Button onClick={() => setPlanning(true)}>Planifier un morceau</Button>
          )}
        </>
      }
    >
      {summary.error && <ErrorMessage>{summary.error}</ErrorMessage>}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {message && <p className="rp-note rp-note--info">{message}</p>}
      {tab === 'compte' ? (
        <GoogleAccount onChanged={reloadAll} />
      ) : (
        <>
          {account?.connected && account.needsReconnect && (
            <ReconnectBanner queue={summary.data?.queue ?? 0} onDone={changed} />
          )}
          {account && !account.connected && (
            <p className="rp-note rp-note--warning">
              Compte Google pas encore connecté : la publication YouTube est en pause (Instagram
              fonctionne).{' '}
              <button type="button" className="rp-link" onClick={() => setTab('compte')}>
                Mettre en place
              </button>
            </p>
          )}
          {summary.data?.alerts.map((alert) => (
            <p key={alert.releaseId} className="rp-note rp-note--warning" role="alert">
              <strong>{alert.level}</strong> : « {alert.trackTitle} » — {alert.count} élément(s)
              YouTube pas encore envoyé(s), le premier le {longDate(alert.firstDate)}.{' '}
              {summary.data?.autoUpload.enabled
                ? 'L’envoi automatique est activé : il partira tout seul si ToolBox est ouvert.'
                : 'Clique « Envoyer sur YouTube » dans la liste des sorties ci-dessous.'}
            </p>
          ))}
          {summary.data?.quotaMessage && <p className="rp-note">{summary.data.quotaMessage}</p>}
          {summary.data?.templateErrors.map((text) => (
            <p key={text} className="rp-note rp-note--warning">
              Modèle de plan (Réglages) : {text}
            </p>
          ))}

          {todayList.data && (
            <TodayView
              date={todayList.data.date}
              today={todayList.data.today}
              late={todayList.data.late}
              onOpen={open}
              onChanged={() => changed()}
            />
          )}

          <Card
            title={
              shown
                ? view === 'month'
                  ? monthTitle(shown)
                  : `Semaine du ${longDate(startOfWeek(shown))}`
                : 'Calendrier'
            }
            actions={
              <div className="inline-form rp-toolbar">
                <Button
                  small
                  variant="secondary"
                  aria-label="Précédent"
                  onClick={() =>
                    shown && setAnchor(view === 'month' ? addMonths(shown, -1) : addDays(shown, -7))
                  }
                >
                  ‹
                </Button>
                <Button small variant="secondary" onClick={() => setAnchor(null)}>
                  Aujourd’hui
                </Button>
                <Button
                  small
                  variant="secondary"
                  aria-label="Suivant"
                  onClick={() =>
                    shown && setAnchor(view === 'month' ? addMonths(shown, 1) : addDays(shown, 7))
                  }
                >
                  ›
                </Button>
                <span className="rp-segmented">
                  <button
                    type="button"
                    className={view === 'month' ? 'active' : ''}
                    onClick={() => setView('month')}
                  >
                    Mois
                  </button>
                  <button
                    type="button"
                    className={view === 'week' ? 'active' : ''}
                    onClick={() => setView('week')}
                  >
                    Semaine
                  </button>
                </span>
              </div>
            }
          >
            {calendar.error && <ErrorMessage>{calendar.error}</ErrorMessage>}
            {shown && today && (
              <Calendar
                view={view}
                anchor={shown}
                today={today}
                items={calendar.data?.items ?? []}
                onOpen={open}
                onMove={(id, date) => void move(id, date)}
              />
            )}
            <div className="rp-legend">
              <span>
                <PlatformIcon kind="youtube" /> Vidéo YouTube
              </span>
              <span>
                <PlatformIcon kind="short" /> Short
              </span>
              <span>
                <PlatformIcon kind="insta-post" /> Post Insta
              </span>
              <span>
                <PlatformIcon kind="insta-reel" /> Reel Insta
              </span>
              {[...tracksInView.entries()].map(([id, track]) => (
                <span key={id}>
                  <span className="rp-swatch" style={{ background: trackColor(track.color) }} />{' '}
                  {track.title}
                </span>
              ))}
              <span className="muted">Glisse un élément sur un autre jour pour le déplacer.</span>
            </div>
          </Card>

          <Card title="Sorties planifiées">
            {releases.data?.length === 0 && (
              <p className="muted">
                Aucun morceau planifié. « Planifier un morceau » pour commencer.
              </p>
            )}
            <ul className="list">
              {releases.data?.map((release) => (
                <ReleaseRow
                  key={release.id}
                  release={release}
                  onAddCustomReel={
                    summary.data?.features.customReels ? () => setAddingTo(release) : null
                  }
                  onChanged={changed}
                />
              ))}
            </ul>
          </Card>
        </>
      )}

      {addingTo && (
        <AddCustomReelDialog
          release={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={(message) => {
            setAddingTo(null);
            changed(message);
          }}
        />
      )}
      {planning && today && (
        <PlanDialog
          today={today}
          defaultTime={summary.data?.defaultTime ?? '18:00'}
          onClose={() => setPlanning(false)}
          onCreated={(release, text) => {
            setPlanning(false);
            setAnchor(release.date);
            changed(text);
          }}
        />
      )}
      {selected && (
        <ItemPanel
          key={`${selected.id}|${selected.scheduledAt}|${selected.state}|${selected.title}|${selected.description}`}
          item={selected}
          job={jobs.find((job) => job.id === selected.job?.id) ?? null}
          onClose={() => open(null)}
          onChanged={changed}
        />
      )}
    </Page>
  );
}

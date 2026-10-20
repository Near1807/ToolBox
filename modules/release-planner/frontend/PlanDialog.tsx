// « Planifier un morceau »: choose the track, the day J and the time; the app
// proposes the plan of the template (moved where a day is full), each date can
// be changed, then « Valider le plan ».
import { useEffect, useState } from 'react';
import { Button, ErrorMessage, errorMessage, useApi, useModule } from '@hub/sdk/frontend';
import { addDays, longDate } from './dates';
import { PlatformIcon } from './ItemParts';
import type { PlanProposal, Release, TrackChoice } from './types';

export function PlanDialog(props: {
  today: string;
  defaultTime: string;
  trackId?: number;
  onClose: () => void;
  onCreated: (release: Release, message: string) => void;
}) {
  const module = useModule();
  const tracks = useApi<TrackChoice[]>(module.url('/tracks'));
  const [chosenTrack, setTrackId] = useState<number | null>(props.trackId ?? null);
  const [date, setDate] = useState(addDays(props.today, 7));
  const [time, setTime] = useState(props.defaultTime);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanProposal | null>(null);
  const [dates, setDates] = useState<Record<string, { date: string; time: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = tracks.data?.filter((track) => !track.releaseId) ?? [];
  const trackId = chosenTrack ?? available[0]?.id ?? null;

  // The proposal follows the inputs.
  useEffect(() => {
    if (!trackId || !date || !time) return;
    let cancelled = false;
    module.api
      .post<PlanProposal>('/plan', { trackId, date, time, videoId })
      .then((proposal) => {
        if (cancelled) return;
        setError(null);
        setPlan(proposal);
        setDates(
          Object.fromEntries(
            proposal.items.map((item) => [
              `${item.kind}:${item.position}`,
              { date: item.date, time: item.time },
            ]),
          ),
        );
      })
      .catch((err: unknown) => !cancelled && (setPlan(null), setError(errorMessage(err))));
    return () => {
      cancelled = true;
    };
  }, [module.api, trackId, date, time, videoId]);

  const create = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await module.api.post<{ release: Release; shifts: PlanProposal['shifts'] }>(
        '/releases',
        {
          trackId,
          date,
          time,
          videoId: plan.videoId,
          items: plan.items.map((item) => ({
            kind: item.kind,
            position: item.position,
            ...dates[`${item.kind}:${item.position}`],
          })),
        },
      );
      props.onCreated(
        result.release,
        result.shifts.length > 0
          ? `Plan créé. Décalés pour éviter l’embouteillage : ${result.shifts.map((s) => `${s.label} (${s.from.split('-').reverse().join('/')} → ${s.to.split('-').reverse().join('/')})`).join(', ')}.`
          : 'Plan créé. Vérifie les titres et descriptions YouTube, puis « Envoyer sur YouTube ».',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rp-dialog" role="dialog" aria-modal="true" aria-label="Planifier un morceau">
      <div className="rp-dialog__box">
        <header className="rp-dialog__header">
          <h2>Planifier un morceau</h2>
          <button
            type="button"
            className="rp-panel__close"
            aria-label="Fermer"
            onClick={props.onClose}
          >
            ×
          </button>
        </header>
        {tracks.data && available.length === 0 && (
          <p className="muted">
            Tous les morceaux sont déjà planifiés (ou la Bibliothèque est vide).
          </p>
        )}
        <div className="rp-dialog__form">
          <label className="rp-field">
            <span>Morceau</span>
            <select
              className="input"
              value={trackId ?? ''}
              onChange={(e) => {
                setTrackId(Number(e.target.value));
                setVideoId(null);
              }}
            >
              {available.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.artist ? `${track.artist} — ${track.title}` : track.title}
                  {track.videos === 0 ? ' (pas de vidéo YouTube)' : ''}
                  {!track.pack ? ' (pas de pack Insta)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="rp-field">
            <span>Jour de sortie (J)</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="rp-field">
            <span>Heure</span>
            <input
              className="input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          {plan && plan.videos.length > 1 && (
            <label className="rp-field">
              <span>Vidéo YouTube</span>
              <select
                className="input"
                value={plan.videoId ?? ''}
                onChange={(e) => setVideoId(Number(e.target.value))}
              >
                {plan.videos.map((video) => (
                  <option key={video.id} value={video.id} disabled={!video.exists}>
                    {video.fileName} — {new Date(video.createdAt).toLocaleDateString('fr-FR')}
                    {video.exists ? '' : ' (introuvable)'}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
        {plan && (
          <>
            {plan.shifts.length > 0 && (
              <p className="rp-note rp-note--warning">
                Embouteillage évité :{' '}
                {plan.shifts
                  .map(
                    (s) =>
                      `${s.label} décalé du ${s.from.split('-').reverse().join('/')} au ${s.to.split('-').reverse().join('/')}`,
                  )
                  .join(' · ')}
                .
              </p>
            )}
            {plan.warnings.map((warning) => (
              <p key={warning} className="rp-note">
                {warning}
              </p>
            ))}
            <table className="rp-plan">
              <thead>
                <tr>
                  <th>Élément</th>
                  <th>Jour</th>
                  <th>Date</th>
                  <th>Heure</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((item) => {
                  const key = `${item.kind}:${item.position}`;
                  const value = dates[key] ?? { date: item.date, time: item.time };
                  return (
                    <tr key={key}>
                      <td>
                        <PlatformIcon kind={item.kind} /> {item.label}
                        {item.shifted && <span className="badge badge--warning">décalé</span>}
                      </td>
                      <td className="muted small">{longDate(value.date)}</td>
                      <td>
                        <input
                          className="input input--short"
                          type="date"
                          value={value.date}
                          onChange={(e) =>
                            setDates({ ...dates, [key]: { ...value, date: e.target.value } })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input input--short"
                          type="time"
                          value={value.time}
                          onChange={(e) =>
                            setDates({ ...dates, [key]: { ...value, time: e.target.value } })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Modèle et anti-embouteillage : Réglages › Planning de sortie. Les titres et
              descriptions YouTube se modifient ensuite élément par élément, avant l’envoi.
            </p>
          </>
        )}
        <footer className="rp-panel__actions">
          <Button disabled={!plan || plan.items.length === 0 || busy} onClick={() => void create()}>
            Valider le plan
          </Button>
          <Button variant="secondary" onClick={props.onClose}>
            Annuler
          </Button>
        </footer>
      </div>
    </div>
  );
}

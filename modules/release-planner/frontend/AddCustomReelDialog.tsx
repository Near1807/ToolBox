// « Ajouter un Reel perso » on a release already planned: the Reel (made with
// the user's videos), Reel Instagram and/or Short YouTube, and the date, only
// on an allowed day (Réglages › Jours de publication autorisés).
import { useState } from 'react';
import { Button, ErrorMessage, errorMessage, useApi, useModule, Icon } from '@hub/sdk/frontend';
import { longDate, weekdayIndex } from './dates';
import { PlatformIcon } from './ItemParts';
import type { CustomReelOptions, Release } from './types';

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function AddCustomReelDialog(props: {
  release: Release;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const module = useModule();
  const { data, error: loadError } = useApi<CustomReelOptions>(
    module.url(`/releases/${props.release.id}/custom-reels`),
  );
  const [reelId, setReelId] = useState<number | null>(null);
  const option = data?.options.find((o) => o.customReelId === reelId) ?? data?.options[0] ?? null;

  return (
    <div className="rp-dialog" role="dialog" aria-modal="true" aria-label="Ajouter un Reel perso">
      <div className="rp-dialog__box">
        <header className="rp-dialog__header">
          <h2>Ajouter un Reel perso — {props.release.trackTitle}</h2>
          <button
            type="button"
            className="rp-panel__close"
            aria-label="Fermer"
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {loadError && <ErrorMessage>{loadError}</ErrorMessage>}
        {data && data.options.length === 0 && (
          <>
            <p className="muted">
              Aucun Reel perso à ajouter : crée-en dans « Reels depuis mes vidéos »
              {data.excluded > 0
                ? `, ou coche « Inclure dans la sortie » sur la page du morceau (${data.excluded} exclu(s))`
                : ''}
              . Ceux déjà planifiés en Reel et en Short ne sont plus proposés.
            </p>
            <footer className="rp-panel__actions">
              <Button variant="secondary" onClick={props.onClose}>
                Fermer
              </Button>
            </footer>
          </>
        )}
        {data && option && (
          // Keyed by the Reel: a new choice starts from its suggested date and free kinds.
          <ReelForm
            key={option.customReelId}
            release={props.release}
            data={data}
            option={option}
            onChoose={setReelId}
            onClose={props.onClose}
            onAdded={props.onAdded}
          />
        )}
      </div>
    </div>
  );
}

function ReelForm(props: {
  release: Release;
  data: CustomReelOptions;
  option: CustomReelOptions['options'][number];
  onChoose: (id: number) => void;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const module = useModule();
  const { option, data } = props;
  const [reel, setReel] = useState(!option.planned['insta-reel']);
  const [short, setShort] = useState(!option.planned.short);
  const [date, setDate] = useState(option.date);
  const [time, setTime] = useState(data.time);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allowed = data.allowedDays;
  const dayOk = date !== '' && allowed.includes(weekdayIndex(date));
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await module.api.post<{ release: Release; warnings: string[] }>(
        `/releases/${props.release.id}/items`,
        {
          customReelId: option.customReelId,
          kinds: [reel ? 'insta-reel' : null, short ? 'short' : null].filter(Boolean),
          date,
          time,
        },
      );
      props.onAdded([`${option.label} ajouté le ${longDate(date)}.`, ...result.warnings].join(' '));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rp-dialog__form">
        <label className="rp-field">
          <span>Reel perso</span>
          <select
            className="input"
            value={option.customReelId}
            onChange={(e) => props.onChoose(Number(e.target.value))}
          >
            {data.options.map((o) => (
              <option key={o.customReelId} value={o.customReelId}>
                {o.label}
                {o.rendered ? '' : ' (pas encore généré)'}
              </option>
            ))}
          </select>
        </label>
        <div className="rp-field">
          <span>Publier comme</span>
          <label className="rp-check">
            <input
              type="checkbox"
              checked={reel}
              disabled={option.planned['insta-reel']}
              onChange={(e) => setReel(e.target.checked)}
            />
            <PlatformIcon kind="insta-reel" /> Reel Insta
            {option.planned['insta-reel'] && <span className="muted small"> (déjà planifié)</span>}
          </label>
          <label className="rp-check">
            <input
              type="checkbox"
              checked={short}
              disabled={option.planned.short}
              onChange={(e) => setShort(e.target.checked)}
            />
            <PlatformIcon kind="short" /> Short YouTube
            {option.planned.short && <span className="muted small"> (déjà planifié)</span>}
          </label>
        </div>
        <label className="rp-field">
          <span>Date</span>
          <input
            className="input input--short"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="rp-field">
          <span>Heure</span>
          <input
            className="input input--short"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <p
          className={`rp-dialog__hint small ${date && !dayOk ? 'rp-note rp-note--warning' : 'muted'}`}
        >
          {date && !dayOk
            ? `Le ${longDate(date)} n’est pas un jour autorisé. `
            : date === option.date
              ? `Proposé : ${longDate(date)}, le jour autorisé suivant la fin du plan. `
              : ''}
          Jours autorisés : {allowed.map((d) => DAY_NAMES[d]).join(', ')} (Réglages › Planning de
          sortie).
        </p>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <footer className="rp-panel__actions">
        <Button disabled={!dayOk || (!reel && !short) || busy} onClick={() => void add()}>
          Ajouter au planning
        </Button>
        <Button variant="secondary" onClick={props.onClose}>
          Annuler
        </Button>
      </footer>
    </>
  );
}

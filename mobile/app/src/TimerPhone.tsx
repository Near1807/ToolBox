// What the Timer needs on the phone only, shown above its page (ADR 0044):
// the notification permission (Android 13+), asked with a clear sentence at
// the first timer started; the exact alarms, checked at each opening (if
// they are off, the screen says so and where to turn them back on); and the
// Samsung guide, at the first use (then in Réglages).
import { useEffect, useState } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Button, Card, openEventStream } from '@hub/sdk/frontend';
import type { LiveDto } from '../../../modules/timer/shared/types';

const GUIDE_SEEN = 'toolbox.timer.samsungGuideSeen';

const seen = () => {
  try {
    return localStorage.getItem(GUIDE_SEEN) === '1';
  } catch {
    return false;
  }
};

/** Samsung: what keeps the Timer on time when the phone is locked. */
export function SamsungGuide() {
  return (
    <>
      <p>Sur un Samsung, pour que la fin d’une phase sonne à l’heure même téléphone verrouillé :</p>
      <ol className="m-steps">
        <li>
          <strong>Paramètres › Batterie › Limites d’utilisation en arrière-plan</strong> : ajoute
          ToolBox aux <strong>« Applis jamais en veille »</strong>.
        </li>
        <li>
          <strong>Paramètres › Applis › ToolBox › Batterie</strong> : choisis{' '}
          <strong>« Non restreinte »</strong>.
        </li>
      </ol>
      <p className="small muted">
        Les noms peuvent varier un peu selon la version d’Android. Ces réglages restent à toi :
        ToolBox ne les change jamais.
      </p>
    </>
  );
}

type Permission = 'granted' | 'denied' | 'prompt' | 'unknown';

export function TimerPhoneNotes() {
  const [permission, setPermission] = useState<Permission>('unknown');
  const [exact, setExact] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [running, setRunning] = useState(false);
  const [guide, setGuide] = useState(!seen());
  const [dismissed, setDismissed] = useState(false);

  const check = () => {
    LocalNotifications.checkPermissions().then(
      (p) =>
        setPermission(
          p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt',
        ),
      () => setPermission('unknown'),
    );
    LocalNotifications.checkExactNotificationSetting().then(
      (s) => setExact(s.exact_alarm === 'granted' ? 'granted' : 'denied'),
      () => setExact('unknown'),
    );
  };
  // At each opening of the Timer, and when coming back from Android's settings.
  useEffect(() => {
    check();
    const again = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);
  // A timer started: the moment to ask for the notifications.
  useEffect(
    () =>
      openEventStream('/api/modules/timer/events', {
        session: (data) => setRunning((data as LiveDto).session?.status === 'running'),
      }),
    [],
  );

  return (
    <div className="m-timer-notes">
      {permission === 'prompt' && (running || !dismissed) && (
        <Card title="Notifications du Timer">
          <p>
            Pour que la fin de chaque phase sonne même quand le téléphone est verrouillé, ToolBox a
            besoin d’afficher des notifications. Elles ne servent qu’au Timer.
          </p>
          <div className="m-actions">
            <Button
              onClick={() =>
                void LocalNotifications.requestPermissions().then(() => {
                  check();
                })
              }
            >
              Autoriser les notifications
            </Button>
            {!running && (
              <Button variant="secondary" onClick={() => setDismissed(true)}>
                Plus tard
              </Button>
            )}
          </div>
        </Card>
      )}
      {permission === 'denied' && (
        <div className="card m-warning">
          <p>
            <strong>Notifications refusées</strong> : la fin des phases ne sonnera pas quand ToolBox
            est fermée ou le téléphone verrouillé. Pour les autoriser :{' '}
            <strong>Paramètres › Applis › ToolBox › Notifications</strong>.
          </p>
        </div>
      )}
      {permission === 'granted' && exact === 'denied' && (
        <div className="card m-warning">
          <p>
            <strong>Alarmes exactes désactivées</strong> : téléphone verrouillé, la fin d’une phase
            peut sonner avec plusieurs minutes de retard. Pour les réactiver :{' '}
            <strong>
              Paramètres › Applis › ToolBox › Alarmes et rappels › « Autoriser la définition
              d’alarmes et de rappels »
            </strong>
            .
          </p>
          <div className="m-actions">
            <Button
              variant="secondary"
              onClick={() => void LocalNotifications.changeExactNotificationSetting().then(check)}
            >
              Ouvrir ce réglage
            </Button>
          </div>
        </div>
      )}
      {guide && (
        <Card title="Avant ton premier timer (Samsung)">
          <SamsungGuide />
          <div className="m-actions">
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  localStorage.setItem(GUIDE_SEEN, '1');
                } catch {
                  // Shown again next time: harmless.
                }
                setGuide(false);
              }}
            >
              J’ai compris (le guide reste dans Réglages)
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

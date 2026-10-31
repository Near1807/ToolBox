// « Compte Google »: step-by-step help to create the Google Cloud project, the
// OAuth client (entered here, stored by the hub, the secret encrypted), and the
// connection of the YouTube channel.
import { useState } from 'react';
import {
  api,
  Button,
  Card,
  ErrorMessage,
  errorMessage,
  useApi,
  useModule,
  Icon,
} from '@hub/sdk/frontend';
import type { AccountStatus } from './types';

const LINKS = {
  newProject: 'https://console.cloud.google.com/projectcreate',
  library: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
  audience: 'https://console.cloud.google.com/auth/audience',
  branding: 'https://console.cloud.google.com/auth/branding',
  clients: 'https://console.cloud.google.com/auth/clients',
  quotas: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas',
  audit: 'https://support.google.com/youtube/contact/yt_api_form',
  verify: 'https://www.youtube.com/verify',
  permissions: 'https://myaccount.google.com/permissions',
  dataAccess: 'https://console.cloud.google.com/auth/scopes',
  home: 'https://near1807.github.io/ToolBox/',
  privacy: 'https://near1807.github.io/ToolBox/privacy.html',
};

function A(props: { href: string; children: string }) {
  return (
    <a href={props.href} target="_blank" rel="noreferrer">
      {props.children} <Icon name="external-link" size="0.95em" />
    </a>
  );
}

export function GoogleAccount(props: { onChanged: () => void }) {
  const module = useModule();
  const account = useApi<{ status: AccountStatus; channel: { title: string } | null }>(
    module.url('/account'),
  );
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'connect' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = account.data?.status;

  const run = async (
    kind: 'save' | 'connect' | 'disconnect',
    action: () => Promise<unknown>,
    done: string,
  ) => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      account.reload();
      props.onChanged();
    }
  };

  return (
    <>
      <Card title="Compte Google / YouTube">
        {account.error && <ErrorMessage>{account.error}</ErrorMessage>}
        {status && (
          <p>
            {status.connected ? (
              status.needsReconnect ? (
                <span className="badge badge--failed">À reconnecter</span>
              ) : (
                <span className="badge badge--loaded">Connecté</span>
              )
            ) : (
              <span className="badge">{status.configured ? 'Non connecté' : 'Non configuré'}</span>
            )}{' '}
            {account.data?.channel && (
              <>
                Chaîne : <strong>{account.data.channel.title}</strong>
              </>
            )}
            {status.error && <span className="error small"> {status.error}</span>}
          </p>
        )}
        {message && <p className="success">{message}</p>}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="inline-form">
          <Button
            disabled={busy !== null || !status?.configured}
            onClick={() =>
              void run(
                'connect',
                () => module.api.post('/account/connect'),
                'Compte Google connecté.',
              )
            }
          >
            {busy === 'connect'
              ? 'Autorise ToolBox dans le navigateur…'
              : status?.connected
                ? 'Reconnecter'
                : 'Connecter mon compte Google'}
          </Button>
          {status?.connected && (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                window.confirm(
                  'Déconnecter le compte Google ? Les envois en attente ne partiront plus.',
                ) &&
                void run(
                  'disconnect',
                  () => api.delete('/api/core/accounts/google'),
                  'Compte déconnecté.',
                )
              }
            >
              Déconnecter
            </Button>
          )}
        </div>
        {busy === 'connect' && (
          <p className="muted small">
            Une page Google s’est ouverte dans ton navigateur : choisis le compte de ta chaîne et
            autorise ToolBox (5 minutes au plus).
          </p>
        )}
      </Card>

      <Card title="Mise en place (une seule fois, ~10 minutes)">
        <p className="muted">
          ToolBox publie avec ton propre projet Google Cloud : aucun identifiant n’est livré avec
          l’app. Tout se fait dans la console Google, connecté avec le compte Google de ta chaîne.
        </p>
        <ol className="rp-steps">
          <li>
            <strong>Créer un projet</strong> :{' '}
            <A href={LINKS.newProject}>console Google Cloud › Nouveau projet</A>, nom « ToolBox ».
          </li>
          <li>
            <strong>Activer l’API</strong> : <A href={LINKS.library}>YouTube Data API v3</A> › «
            Activer ».
          </li>
          <li>
            <strong>Écran de consentement — Branding</strong> :{' '}
            <A href={LINKS.branding}>Google Auth Platform › Branding</A>.
            <ul>
              <li>Nom de l’application : « ToolBox » ; e-mail d’assistance : ton adresse.</li>
              <li>Logo : aucun (un logo oblige Google à valider l’app).</li>
              <li>
                Page d’accueil : <code>{LINKS.home}</code>
              </li>
              <li>
                Règles de confidentialité : <code>{LINKS.privacy}</code>
              </li>
              <li>Conditions d’utilisation : laisser vide (facultatif).</li>
              <li>
                Domaines autorisés : <code>near1807.github.io</code> ; coordonnées du développeur :
                ton e-mail. « Enregistrer ».
              </li>
            </ul>
          </li>
          <li>
            <strong>Écran de consentement — Audience</strong> :{' '}
            <A href={LINKS.audience}>Audience</A> — type d’utilisateur « Externe », puis{' '}
            <strong>« Publier l’application »</strong> › « Confirmer » : statut{' '}
            <strong>« En production »</strong>. Dans{' '}
            <A href={LINKS.dataAccess}>Accès aux données</A>, n’ajoute aucun champ d’application :
            ToolBox demande lui-même son autorisation à la connexion.
            <p className="rp-note rp-note--warning">
              <strong>Ne soumets pas l’app à la validation</strong> de Google (« Préparer la
              validation », « Valider l’application ») : inutile pour un usage personnel. Sans
              validation, l’app reste limitée à 100 utilisateurs et affiche un avertissement à la
              connexion — c’est tout.
              <br />
              <strong>Pourquoi « Production »</strong> : en mode « Test », Google fait expirer
              l’autorisation au bout de <strong>7 jours</strong>. Si cela arrive quand même, ToolBox
              l’affiche (« Compte Google à reconnecter »), envoie une notification et garde les
              envois en attente jusqu’à la reconnexion.
            </p>
          </li>
          <li>
            <strong>Créer l’identifiant</strong> :{' '}
            <A href={LINKS.clients}>Clients › Créer un client</A>, type{' '}
            <strong>« Application de bureau »</strong>. Copie l’ID client et le code secret
            ci-dessous.
          </li>
          <li>
            <strong>Connecter</strong> : enregistre, puis « Connecter mon compte Google » ci-dessus.
            Dans le navigateur : choisis le compte de ta chaîne ; à l’écran{' '}
            <strong>« Google n’a pas validé cette application »</strong>, clique « Paramètres
            avancés » puis « Accéder à ToolBox (non sécurisé) » — normal, c’est ton propre projet ;
            coche l’autorisation YouTube si elle est proposée en case à cocher, puis « Continuer ».
            ToolBox demande une seule autorisation, « Gérer ton compte YouTube » : c’est la plus
            petite qui permet d’envoyer, de programmer, de déplacer une date et d’ajouter à une
            playlist.
          </li>
        </ol>
        <div className="rp-dialog__form">
          <label className="rp-field">
            <span>ID client OAuth</span>
            <input
              className="input"
              value={clientId}
              placeholder={
                status?.configured
                  ? 'Déjà enregistré — saisir pour remplacer'
                  : '…apps.googleusercontent.com'
              }
              onChange={(e) => setClientId(e.target.value)}
            />
          </label>
          <label className="rp-field">
            <span>Code secret du client</span>
            <input
              className="input"
              type="password"
              value={secret}
              placeholder={status?.configured ? 'Enregistré (chiffré)' : 'GOCSPX-…'}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        </div>
        <Button
          variant="secondary"
          disabled={busy !== null || (clientId.trim() === '' && secret === '')}
          onClick={() =>
            void run(
              'save',
              async () => {
                await api.put('/api/core/settings/accounts', {
                  ...(clientId.trim() ? { googleClientId: clientId.trim() } : {}),
                  ...(secret ? { googleClientSecret: secret } : {}),
                });
                setClientId('');
                setSecret('');
              },
              'Identifiants enregistrés (le code secret est chiffré). Tu peux connecter ton compte.',
            )
          }
        >
          Enregistrer les identifiants
        </Button>
        <p className="muted small">Aussi modifiables dans Réglages › Comptes connectés.</p>
      </Card>

      <Card title="Bon à savoir">
        <h3>Vidéos bloquées en privé ?</h3>
        <p>
          Depuis juillet 2020, Google bloquait en privé les vidéos envoyées par un projet « non
          audité ». La documentation de l’API (révision d’octobre 2026) indique que ce n’est plus le
          cas, mais certaines pages d’aide disent encore l’inverse. ToolBox vérifie donc chaque
          envoi : si YouTube garde la vidéo privée sans date de publication, l’élément passe en{' '}
          <strong>« À programmer dans Studio »</strong>, avec un lien direct vers la vidéo dans
          YouTube Studio et un rappel le jour J. Si cela arrive, tu peux demander l’audit gratuit :{' '}
          <A href={LINKS.audit}>formulaire YouTube API Services</A>.
        </p>
        <h3>Quota</h3>
        <p>
          Chaque projet a un quota quotidien, remis à zéro à minuit heure de Californie (9 h à
          Bruxelles, 8 h quelques jours par an). YouTube compte désormais les envois à part ; par
          prudence ToolBox en fait au plus 6 par jour (réglable) et étale automatiquement le reste
          sur les jours suivants, en te le disant. Ton quota réel :{' '}
          <A href={LINKS.quotas}>Google Cloud › Quotas</A>.
        </p>
        <h3>Miniatures</h3>
        <p>
          La miniature personnalisée de la vidéo longue (faite depuis la cover) demande une chaîne
          validée par téléphone : <A href={LINKS.verify}>youtube.com/verify</A>. Sinon la vidéo
          garde une miniature automatique et ToolBox te prévient, sans bloquer.
        </p>
        <h3>Retirer l’accès</h3>
        <p>
          « Déconnecter » révoque l’autorisation. Tu peux aussi la retirer depuis{' '}
          <A href={LINKS.permissions}>ton compte Google</A>.
        </p>
      </Card>
    </>
  );
}

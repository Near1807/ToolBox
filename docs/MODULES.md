# Contrat de module

> Document de référence. Le code qui l'implémente : `packages/sdk/` (ce que voient les modules) et `backend/core/` (le socle). **Toute modification du contrat met à jour ce document dans le même commit.**

## 1. Principes

1. **Le socle est générique.** Il ne connaît aucun module en particulier (ni la musique, ni YouTube). Les modules s'adaptent au socle, jamais l'inverse.
2. **Un module = un dossier** `modules/<id>/`. **Ajouter un module = ajouter un dossier, puis rebuild** (`npm run dev` à relancer, `npm run build`, `npm run dist:win` ou un tag `v*`). Les modules sont découverts automatiquement **au build** et compilés dans l'application : on n'installe pas un module dans une app déjà installée ([ADR 0005](decisions/0005-modules-compiles-dans-l-app.md)).
3. **Isolation.** Un module n'importe que `@hub/sdk/*`, des paquets npm et les modules Node. Jamais le code du socle, jamais `electron`, jamais un autre module. Une règle ESLint (`toolbox/module-boundaries`) fait échouer le lint sinon.
4. **Propriété des données.** Un module ne touche qu'à ses propres tables (préfixées par son id) et à ses propres dossiers.
5. **Dépendances déclarées.** Ce dont un module a besoin est déclaré dans son manifest ; le socle refuse de charger un module dont une dépendance manque, avec un message clair.
6. **Retrait sans casse.** Supprimer le dossier d'un module (puis rebuild) ne casse ni le socle ni les modules qui n'en dépendent pas. Ceux qui en dépendent sont automatiquement marqués « dépendance manquante ».
7. **Un module qui plante ne fait pas planter le hub** (voir §9).

## 1 bis. Contrôle et sécurité (prioritaire sur toute autre règle)

- **La solidité et le contrôle de Thomas passent AVANT l'autonomie et le côté spectaculaire.** En cas de doute : demander, ou ne pas faire.
- **Jamais sans confirmation explicite de Thomas** :
  - supprimer des données ou des fichiers ;
  - publier ou envoyer quoi que ce soit en ligne ;
  - modifier quelque chose déjà en ligne ou programmé ;
  - écraser une donnée existante ;
  - lancer une mise à jour de l'app ou d'un modèle.
- **Toute action qui modifie quelque chose est visible** (confirmation à l'écran ou à voix haute) et, quand c'est possible, **annulable**.
- **Droits ajoutés un par un.** L'assistant vocal et toute automatisation future (envoi automatique, tâches planifiées…) n'obtiennent de nouveaux droits qu'un par un, sur décision explicite de Thomas, après une période de test. Par défaut, toute nouvelle capacité est **désactivée ou en lecture seule**.
- **Livré désactivé.** Toute nouvelle fonctionnalité qui agit seule est d'abord livrée **désactivée par défaut**, avec un réglage clair pour l'activer.
- **Vue d'ensemble dans chaque rapport.** Chaque rapport de fin de session a une section qui liste toute action pouvant modifier, supprimer ou publier sans clic de Thomas (même avec confirmation vocale).

Pour un module, concrètement :

- Toute suppression, publication, modification d'un élément en ligne ou programmé, ou tout écrasement d'une donnée passe par une **confirmation dans l'interface** (`confirmDelete` ou équivalent). Aucune route ne le fait seule.
- Toute modification est visible et, si possible, annulable (`UndoToast`, `undo` des actions de l'assistant).
- Tout ce qui agit sans clic (tâche planifiée qui envoie, publie, supprime ou modifie ; envoi automatique ; synchronisation qui écrase) est **désactivé par défaut**, derrière un réglage clair qui dit ce qu'il fait. Une tâche planifiée qui ne fait que lire, ou que préparer sans rien publier, est permise ; son README dit ce qu'elle fait.
- Actions de l'assistant (§5.15) : un nouveau module déclare des actions de **lecture**. Une action qui modifie (`change`, `destructive`) n'est ajoutée que sur décision explicite de Thomas, une à la fois. Une action `sensitive` n'est jamais exécutable.
- Téléchargements et mises à jour (app, modèles, moteurs) : seulement sur un clic de Thomas.

## 2. Structure d'un module

```
modules/<id>/
├─ module.json            manifest (obligatoire)
├─ backend/index.ts       export default defineBackendModule({ migrations, register })   (optionnel)
├─ frontend/index.tsx     export default defineFrontendModule({ pages, nav, HomeWidget }) (optionnel)
├─ contract.ts            types publics des services fournis (optionnel, types uniquement)
├─ README.md              ce que fait le module, ses données, ses dépendances (obligatoire)
└─ tests/*.test.ts        tests Vitest (obligatoire)
```

- `id` : kebab-case (`music-library`), **identique au nom du dossier**. Ids réservés : `core`, `hub`, `api`, `settings`, `jobs`, `logs`, `accounts`, `notifications`.
- **Dossiers commençant par `_`** (ex. `_template`) : modules d'exemple, d'id `template`. Ils ne sont chargés que par le smoke test de la CI ou avec `TOOLBOX_LOAD_EXAMPLES=1`.
- Un module sans frontend est un module de service (ex. `video-engine`) ; sans backend, un module purement visuel.

## 3. Le manifest `module.json`

```json
{
  "id": "youtube-video",
  "name": "Vidéo YouTube",
  "description": "Génère une vidéo 16:9 à partir d'un morceau.",
  "version": "1.0.0",
  "section": "Musique",
  "icon": "play",
  "order": 20,
  "dependsOn": { "modules": ["video-engine"], "services": ["musicLibrary"] },
  "provides": { "services": [] },
  "permissions": { "accounts": [] },
  "settings": [{ "key": "links", "type": "text", "label": "Liens à ajouter à la description" }]
}
```

| Champ                        | Obligatoire | Rôle                                                                                                                                                                                                                                                                 |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | oui         | Identifiant, préfixe d'API (`/api/modules/<id>/`), de tables (`<id_avec_underscores>__`) et d'événements (`<id>:`)                                                                                                                                                   |
| `name`, `description`        | oui         | Affichés sur l'accueil, la navigation, les réglages (en français)                                                                                                                                                                                                    |
| `version`                    | oui         | Version sémantique du module                                                                                                                                                                                                                                         |
| `section`                    | oui         | Catégorie **par défaut** dans la navigation et sur l'accueil (ex. « Musique ») ; l'utilisateur peut ensuite déplacer l'outil                                                                                                                                         |
| `icon`                       | oui         | Le **nom** d'une icône du jeu de l'interface (`packages/sdk/icons.tsx`, lucide : `music`, `timer`, `shopping-cart`…). Jamais un emoji : `npm run lint` refuse un nom inconnu (`scripts/check-ui-emoji.mjs`). Une icône qui manque s'ajoute au jeu du SDK (pour tous) |
| `order`                      | non         | Ordre dans la section (défaut 100) ; l'ordre des sections suit leur premier module                                                                                                                                                                                   |
| `dependsOn.modules`          | non         | Modules qui doivent être présents **et chargés**                                                                                                                                                                                                                     |
| `dependsOn.services`         | non         | Services consommés via `ctx.services.get()` (fournis par n'importe quel module)                                                                                                                                                                                      |
| `dependsOn.optionalServices` | non         | Services utilisés **s'ils sont là**, via `ctx.services.optional()` ; le module fonctionne sans (§5.8)                                                                                                                                                                |
| `provides.services`          | non         | Services que le module **doit** fournir via `ctx.services.provide()`                                                                                                                                                                                                 |
| `permissions.accounts`       | non         | Comptes externes utilisés via `ctx.accounts` : `"google"` (seul fournisseur aujourd'hui)                                                                                                                                                                             |
| `permissions.assistant`      | non         | `true` : le module **lit et exécute les actions des autres modules** (`ctx.assistant.actions/run/undo`, §5.15)                                                                                                                                                       |
| `permissions.globalKeys`     | non         | `true` : le module écoute une touche **dans tout Windows**, même sans le focus (`ctx.hotkeys`, §5.16)                                                                                                                                                                |
| `backup.exclude`             | non         | Dossiers du dossier de données du module (`ctx.files.dataDir`) **laissés hors de « Exporter une sauvegarde »** : uniquement ce qui se retélécharge ou se recalcule (moteurs, modèles, caches), jamais les données de l'utilisateur. Ex. `["models", "engines"]`      |
| `settings`                   | non         | Réglages du module, affichés automatiquement dans la page Réglages (§5.3)                                                                                                                                                                                            |

Le manifest est validé au démarrage (`backend/core/modules/manifest.ts`) : un champ inconnu ou invalide rend le module « en erreur » avec un message précis, sans empêcher les autres de démarrer.

## 4. Backend : `backend/index.ts`

```ts
import { defineBackendModule, HttpError } from '@hub/sdk/backend';

export default defineBackendModule({
  migrations: [
    { version: 1, description: 'tracks table', up: `CREATE TABLE music_library__tracks (...);` },
  ],
  register(ctx) {
    const tracks = ctx.db.table('tracks'); // "music_library__tracks"
    ctx.routes.get('/tracks', () => ctx.db.prepare(`SELECT * FROM ${tracks}`).all());
    ctx.services.provide('musicLibrary', { getTrack: (id: number) => /* … */ null });
  },
});
```

### Cycle de vie au démarrage

1. **Découverte** des dossiers `modules/*/module.json` (au build) et **validation** des manifests.
2. **Plan de chargement** : les modules désactivés, invalides ou dont une dépendance manque sont écartés (en cascade) ; les autres sont ordonnés fournisseurs d'abord. Une dépendance circulaire est refusée.
3. **Migrations** de tous les modules retenus (§6), **avant** tout `register()`.
4. **`register(ctx)`** de chaque module, dans l'ordre. Le module y déclare tout ce qu'il fait. Ce qu'il déclare n'est activé que si `register()` réussit ; en cas d'exception, tout est annulé (routes, tâches, écouteurs, services) et le module est « en erreur ».
5. Montage des routes, démarrage du planificateur (rattrapage des tâches manquées).

`register()` peut être `async`. Les requêtes SQL peuvent y être préparées : les tables existent déjà.

## 5. Le contexte `ctx`

`ctx.id` et `ctx.manifest` : identifiant et manifest validé du module.

### 5.1 `ctx.db` — base SQLite

| Membre            | Rôle                                                                                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`          | Préfixe des tables du module, ex. `music_library__`                                                                                                                                                                                                                                                              |
| `table(name)`     | Nom complet d'une table : `table('tracks')` → `music_library__tracks`                                                                                                                                                                                                                                            |
| `prepare(sql)`    | Requête préparée (API better-sqlite3 : `run`, `get`, `all`). **Refuse `CREATE`/`ALTER`/`DROP`** : le schéma ne change que par migration                                                                                                                                                                          |
| `transaction(fn)` | Exécute `fn` dans une transaction (tout ou rien)                                                                                                                                                                                                                                                                 |
| `backup(reason)`  | Sauvegarde automatique de toute la base (`<userData>/backups/`, **rotation à part** : 10 dernières, sans jamais pousser dehors celles d'avant migration) ; renvoie le nom du fichier. **À faire avant toute suppression de données demandée par l'utilisateur** (ex. « Supprimer cet import » des Stats YouTube) |

Une seule base `hub.db`, partagée. Tables, index, vues et triggers d'un module **doivent** commencer par son préfixe (vérifié à chaque migration). Lire les tables d'un autre module est interdit : on passe par son service.

### 5.2 `ctx.files` — fichiers

| Membre                                          | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dataDir`                                       | Dossier privé `<userData>/modules/<id>/` (créé au chargement). Inclus dans « Exporter une sauvegarde »                                                                                                                                                                                                                                                                                                                                                                                           |
| `dataPath(...segments)`                         | Chemin dans `dataDir` ; lève une erreur s'il en sort (`..`)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `outputDir()`                                   | Dossier de sortie `<dossier de sortie>/<id>/` (réglage « Dossier de sortie » du socle, par défaut `Vidéos\ToolBox`)                                                                                                                                                                                                                                                                                                                                                                              |
| `open(path)` / `reveal(path)`                   | Ouvre un fichier/dossier avec Windows, ou le montre dans l'Explorateur                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `mediaUrl(path)`                                | URL signée pour `<img>`, `<audio>`, `<video>` (qui ne peuvent pas envoyer le jeton). Valable pour la session, uniquement pour les fichiers des dossiers du hub (données, sortie, assets). Gère la lecture par morceaux (Range)                                                                                                                                                                                                                                                                   |
| `mediaUrlIfExists(path)`                        | Comme `mediaUrl`, mais `null` si le chemin est vide, si le fichier n'existe plus ou s'il est sorti des dossiers autorisés : pour les DTO, l'interface affiche alors « Fichier introuvable »                                                                                                                                                                                                                                                                                                      |
| `saveAs({ title, defaultName, filters, data })` | **Export demandé par l'utilisateur** : ouvre « Enregistrer sous » (dossier de sortie proposé), écrit `data` (texte ou octets) à l'endroit choisi et renvoie le chemin, `null` si l'utilisateur annule (ou hors de l'app de bureau). Le système demande avant de remplacer un fichier existant. Ce fichier appartient à l'utilisateur : il **n'est pas** enregistré dans `ctx.outputs` (exception à §5.13 : ni projet ni Corbeille). Toujours montrer le chemin renvoyé (ou « annulé ») à l'écran |
| `trash(path)`                                   | Envoie à la **Corbeille** un fichier du dossier de données du module (refus de tout chemin hors de ce dossier, et du dossier lui-même ; rien si le fichier n'existe plus). Pour des **données de l'utilisateur** remplacées ou retirées (ex. l'image d'une recette des Courses), jamais pour un fichier généré (`ctx.outputs.delete`)                                                                                                                                                            |
| `assetsDir` / `assetPath(...)`                  | Fichiers en lecture seule livrés avec le module : `modules/<id>/assets/` (polices, images…). Copiés au build et extraits de l'archive asar, donc lisibles par FFmpeg                                                                                                                                                                                                                                                                                                                             |

Les fichiers importés par l'utilisateur sont **copiés** dans `dataDir` (jamais de lien vers leur emplacement d'origine).

### 5.3 `ctx.settings` — réglages

Les réglages sont déclarés dans `module.json > settings` ; la page Réglages génère le formulaire et valide les valeurs côté serveur.

| Type              | Valeur                                                                | Options                         |
| ----------------- | --------------------------------------------------------------------- | ------------------------------- |
| `string` / `text` | texte (une ligne / plusieurs)                                         | `placeholder`, `default`        |
| `number`          | nombre                                                                | `min`, `max`, `step`, `default` |
| `boolean`         | oui/non                                                               | `default`                       |
| `select`          | une des `options` (`{ value, label }`)                                | `default`                       |
| `folder`          | chemin absolu choisi avec le sélecteur de dossier                     | `default`                       |
| `weekdays`        | jours de la semaine, cases Lun…Dim ; valeur `"1,2,3,4,5"` (1 = lundi) | `default`                       |
| `secret`          | texte **chiffré** (safeStorage), jamais renvoyé à l'interface         | —                               |

Tous acceptent `label` (obligatoire), `description` et `hidden` (`true` : absent de la page Réglages, le module le modifie depuis sa propre page, ex. la touche de l'assistant capturée au clavier). API : `get(key)` (valeur ou défaut, secrets déchiffrés), `set(key, value)`, `onChange(handler)`.

### 5.4 `ctx.routes` — API HTTP

`get | post | put | patch | delete (path, handler, options?)`, montées sous `/api/modules/<id>/`. Le handler reçoit `(request, reply)` de Fastify et renvoie l'objet à sérialiser en JSON.

- Erreur prévue : `throw new HttpError(404, 'Morceau introuvable')` → réponse `{ "error": "Morceau introuvable" }`.
- Aides du SDK pour les routes : `idParam(request.params)` (le `:id`, entier positif, sinon 400 « Identifiant invalide ») et `requestBody(request)` (le corps JSON, `{}` s'il n'y en a pas ; les champs restent à vérifier).
- Toute autre exception → 500 avec un message clair, consignée dans les journaux du module. Le hub continue.
- Options : `streamTicket: true` pour une route SSE lue par `EventSource` (voir `openEventStream()` dans `@hub/sdk/backend` et [ARCHITECTURE.md](ARCHITECTURE.md#flux-sse-et-tickets-à-usage-unique)), `bodyLimit` (octets, défaut 1 Mo).
- La sécurité (jeton de session, Host, Origin) est appliquée par le socle à toutes les routes.

### 5.5 `ctx.jobs` — tâches longues

```ts
ctx.jobs.define<{ trackId: number }, { file: string }>(
  'render',
  async (job) => {
    job.progress(0.42, 'Encodage…'); // 0..1 (ou null), message en français
    if (job.signal.aborted) throw new Error('Annulée');
    return { file }; // stocké comme résultat (JSON)
  },
  { concurrency: 1 },
);

const info = ctx.jobs.enqueue('render', { trackId: 3 }, { title: 'Vidéo YouTube — Mon morceau' });
```

- File d'attente par type de tâche, `concurrency` 1 par défaut. Annulation via `job.signal` (bouton « Annuler » dans la page Tâches). Les tâches sont visibles dans la page **Tâches** et via `useJobs()` côté interface (temps réel, SSE).
- Historique dans `core__jobs` (200 dernières). Une tâche en cours quand l'app se ferme est marquée **« interrompue »** au démarrage suivant : pas de reprise automatique.
- `get`, `list`, `cancel` ne voient que les tâches du module. Pour qu'un autre module lance une tâche, on expose un service qui appelle `enqueue`.

### 5.6 `ctx.scheduler` — tâches périodiques

```ts
ctx.scheduler.schedule('daily-snapshot', { daily: '08:00' }, async (task) => {
  /* task.lastSuccessAt, task.signal */
});
ctx.scheduler.schedule('refresh', { everyMinutes: 60 }, async () => {
  /* … */
});
```

- `daily` = heure **locale** `HH:MM` ; `everyMinutes` = intervalle.
- **Rattrapage** : une tâche jamais exécutée, ou dont l'heure prévue est passée pendant que l'app était fermée, s'exécute **une fois** au démarrage. Une exécution en échec est retentée 15 minutes plus tard. Vérification chaque minute.
- Les tâches ne tournent que lorsque l'app est ouverte. `task.lastSuccessAt` permet de rattraper des données sur plusieurs jours.

### 5.7 `ctx.events` — bus d'événements

- `emit(name, payload)` publie `<id>:<name>` (le préfixe est ajouté, un module ne peut émettre que dans son espace).
- `on('<autre-id>:<name>', handler)` écoute ; renvoie une fonction de désabonnement. Les erreurs d'un écouteur sont consignées, jamais propagées.
- Pour des notifications **faibles** (« un morceau a été ajouté »). Si un module a besoin d'une réponse, il utilise un service.
- Événements émis par le socle : `core:settings.changed` `{ scope, key }`, `core:job.updated` (JobInfo).

### 5.8 `ctx.services` — services entre modules

- Fournisseur : déclarer le nom dans `provides.services`, puis `ctx.services.provide('musicLibrary', implementation)` dans `register()`. Un service déclaré mais non fourni rend le module « en erreur ».
- Consommateur : déclarer le nom dans `dependsOn.services`, puis `ctx.services.get<MusicLibrary>('musicLibrary')`. Appeler un service non déclaré lève une erreur.
- Service facultatif : le déclarer dans `dependsOn.optionalServices`, puis `ctx.services.optional<T>('nom')`, qui renvoie `undefined` si aucun module chargé ne le fournit (absent, désactivé ou en erreur). Le module se charge quand même ; ses fournisseurs présents sont chargés avant lui. Il cache alors ce qui en dépend (bouton, option, élément du plan) et le dit clairement.
- **Deux modules qui utilisent chacun le service de l'autre en facultatif** (ex. Bibliothèque et Analyse du master, To-do et Timer) : l'ordre de chargement n'est alors pas garanti ; chacun appelle `ctx.services.optional()` **au moment de l'utiliser** (dans une route, une tâche), jamais une seule fois dans `register()`.
- Vérification rapide du master avant une génération : `precheckTrack(ctx, track)` (`@hub/sdk/backend`, service facultatif `masterAnalysis` à déclarer) répond « rien à signaler » sans le module, en cas d'erreur ou quand le réglage est désactivé ; l'interface utilise `usePrecheck` (§7.1). Un générateur dont le son ne vient pas toujours du morceau ne vérifie que ce qui sera entendu et le dit dans `note` (ex. Reels perso en « Son de la vidéo »).
- **Règle des dépendances** : un module ne déclare en dépendance obligatoire que ce sans quoi il n'a aucun sens ; tout le reste est facultatif. Exemple : le Planning de sortie n'exige que la Bibliothèque (une sortie est celle d'un morceau) ; Vidéo YouTube, Pack Instagram, Reels perso et moteur vidéo sont facultatifs, et le plan ne propose que ce que les modules présents fournissent. Un générateur (Vidéo YouTube, Pack Instagram, Reels perso) exige en revanche la Bibliothèque (le morceau) et le moteur vidéo (le rendu) : sans eux, il n'a rien à faire. ADR 0024.
- **Types** : le fournisseur décrit l'interface de ses services dans `modules/<id>/contract.ts` (types uniquement, aucun code exécutable). Le consommateur peut faire `import type { MusicLibrary } from '../../music-library/contract'` : c'est la **seule** importation entre modules autorisée. Elle est effacée à la compilation, donc le build fonctionne même si le fournisseur est retiré (seul `npm run typecheck` signalera alors les consommateurs à retirer ou adapter).
- Un service doit rester compatible : on ajoute des méthodes, on n'en change pas la signature sans adapter les consommateurs dans le même commit.

### 5.9 `ctx.accounts` — comptes connectés

Comptes OAuth de l'utilisateur, gérés par le socle (ADR 0018). Le module déclare le fournisseur dans `permissions.accounts` (`"google"`) ; sinon tout appel lève une erreur.

```ts
const SCOPES = ['https://www.googleapis.com/auth/youtube'];
ctx.routes.post('/account/connect', () => ctx.accounts.connect('google', SCOPES)); // ouvre le navigateur
const response = await ctx.accounts.fetch('google', '/youtube/v3/channels?part=snippet&mine=true');
```

| Membre                        | Rôle                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status(provider)`            | `{ configured, connected, needsReconnect, scopes, connectedAt, error, connecting }`                                                                        |
| `connect(provider, scopes)`   | Ouvre la page de consentement dans le navigateur, attend la réponse (5 min) ; les autorisations déjà accordées sont gardées (cumul)                        |
| `accessToken(provider)`       | Jeton d'accès valide (rafraîchi si besoin)                                                                                                                 |
| `fetch(provider, url, init?)` | `fetch` avec le jeton ; `/chemin` → API du fournisseur (`https://www.googleapis.com`) ; un 401 rafraîchit et renvoie une fois (corps en texte ou `Buffer`) |
| `disconnect(provider)`        | Révoque l'autorisation et oublie les jetons                                                                                                                |

- Les erreurs sont des `AccountError` (`code` : `not-configured`, `not-connected`, `reauth-required`, `denied`, `cancelled`, `network`, `encryption`) au message français. Levées dans une route, elles deviennent une réponse **409** `{ error, account: code }` : l'interface peut proposer « Connecter » ou « Reconnecter ».
- L'ID client OAuth et son secret appartiennent à l'utilisateur (son projet Google Cloud) : **Réglages › Comptes connectés**, jamais dans le code. Les jetons sont chiffrés (safeStorage) et ne sortent jamais du backend.
- Demander les autorisations les plus petites qui suffisent, et le dire à l'utilisateur.

### 5.10 `ctx.logger` — journaux

`debug | info | warn | error (message, data?)`. Messages en français, consultables dans la page **Journaux** (filtre par module et niveau). Stockés en fichiers JSON lines dans `<userData>/logs/` (14 jours).

### 5.11 `ctx.binaries` — outils embarqués

`ctx.binaries.ffmpeg` et `ctx.binaries.ffprobe` : chemins des exécutables embarqués, à lancer avec `child_process.execFile`/`spawn` (jamais via un shell). FFmpeg est en version **6.1 sous Windows** : n'utiliser que des filtres disponibles dans cette version (le filtre `drawtext` n'existe pas sous Linux : pour du texte, utiliser `subtitles`/libass comme `video-engine`).

### 5.12 `ctx.onShutdown(handler)`

Appelé à la fermeture de l'app : arrêter un process FFmpeg, fermer un watcher… Les tâches en cours reçoivent aussi `job.signal` (abort).

### 5.13 `ctx.outputs` — fichiers générés (obligatoire)

> **Règle : tout ce qu'un module génère doit passer par `ctx.outputs`, être rattaché à un projet (`subject`, obligatoire) et être supprimable depuis l'interface.**

Le socle tient un registre unique (`core__outputs`) des fichiers produits par les modules (vidéos, images, exports…). Grâce à lui, chaque fichier est listé, vérifié sur le disque à chaque affichage, supprimable (vers la Corbeille) et retirable de la liste s'il a disparu. La page **« Fichiers générés »** du shell liste ceux de tous les modules.

```ts
// Après chaque rendu (même chemin = mise à jour, pas de doublon).
ctx.outputs.register({
  path: file, // dans ctx.files.outputDir()
  ref: `video:${row.id}`, // l'élément, dans les termes du module
  parent: `pack:${pack.id}`, // facultatif : groupe (supprimer le groupe = tous ses fichiers)
  subject: `music-library:track:${trackId}`, // OBLIGATOIRE : le projet (Musique : le morceau source)
  label: 'Vidéo YouTube', // affiché dans les listes
});

// Le module nettoie SES données quand des fichiers sont supprimés ou retirés
// (depuis sa page, la page « Fichiers générés » ou « Nettoyer les éléments introuvables »).
ctx.outputs.onRemoved((records, reason) => {
  for (const r of records) deleteMyRow(r.ref); // reason : 'deleted' (Corbeille) | 'forgotten' (liste seulement)
});

// « Sans projet » > Rattacher : le module déplace SES lignes vers le nouveau projet
// (même transaction que le registre ; synchrone ; lever HttpError(409) pour refuser).
ctx.outputs.onReattach((records, subject) => {
  const trackId = library.trackIdOf(subject); // Musique : null si ce n'est pas un morceau
  if (trackId === null) throw new HttpError(409, 'Se rattache à un morceau');
  for (const r of records) {
    moveMyRow(r.ref, trackId);
    ctx.outputs.register({ ...sameFile, parent: `track:${trackId}`, subject }); // si parent change
  }
});
```

| Méthode                                                               | Rôle                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `register({ path, ref, label, subject, parent?, kind?, createdAt? })` | Enregistre ou met à jour (même chemin) un fichier généré ; sans `subject`, refusé                       |
| `list({ ref?, refs?, parent?, ids?, missing? })`                      | Fichiers du module, avec `exists` vérifié **sur le disque** et une `url` signée                         |
| `delete(filtre)`                                                      | Envoie les fichiers à la **Corbeille** (`shell.trashItem`), oublie les entrées, appelle `onRemoved`     |
| `forget(filtre)`                                                      | « Retirer de la liste » : oublie les entrées sans toucher aux fichiers, appelle `onRemoved`             |
| `bySubject(sujet)` · `deleteBySubject(sujet)`                         | Fichiers de **tous** les modules sur un sujet (ex. tous ceux faits à partir d'un morceau)               |
| `orphans(estConnu)` · `attach(ids, sujet)`                            | Éléments sans projet (pas de sujet, ou sujet inconnu) · rattachement choisi par l'utilisateur, conservé |
| `onReattach((records, sujet) => …)`                                   | **Obligatoire** pour tout module qui enregistre des fichiers : suit un rattachement (voir ci-dessous)   |

- **Tout est lié à un projet** : `subject` désigne le projet de l'élément. Dans la section Musique, c'est **le morceau d'origine** (`music-library:track:<id>`) ; la page du morceau dans la Bibliothèque est la vue projet (tout ce qui a été généré, groupé par type, avec son état et la case « Inclure dans la sortie »). Un module hors musique utilise son propre objet (le modèle : `_template:note:<id>`). Un module qui sait où en est un élément (planifié, programmé, publié) le déclare avec `musicLibrary.registerProjectStatus`. Voir ADR 0022.
- **Rattachement complet** (ADR 0025) : `attach` met à jour le registre **et** appelle le `onReattach` de chaque module propriétaire, dans une seule transaction. Le module y déplace ses propres lignes (ex. `track_id` d'une vidéo, pack d'un post, place d'un Reel) et ré-enregistre le fichier si son `parent` change. S'il refuse (place déjà prise…), ou si un module propriétaire n'a pas de `onReattach` (absent, désactivé, trop ancien), **rien ne change**, et le message est affiché tel quel. Un module qui ne garde aucun lien vers le projet déclare quand même un `onReattach` vide (comme le modèle).
- **`kind: 'source'`** : fichier **importé** par l'utilisateur et copié par le module (matière première, ex. les vidéos de « Reels depuis mes vidéos »), pas un livrable. Il est enregistré comme les autres (donc listé, rattaché au projet et supprimable vers la Corbeille), mais la vue projet le range à part (« Vidéos importées ») et ne propose jamais de l'inclure dans la sortie.
- Un filtre vide est refusé (jamais de « tout supprimer » par accident).
- Fichiers déjà produits avant l'arrivée du registre : le module les enregistre au démarrage (`register` est idempotent), sans rien supprimer.
- Interface : chaque élément généré a un bouton **« Supprimer »** avec confirmation (`confirmDelete`), les listes ont la **sélection multiple** (`useSelection` + `SelectionBar`), un fichier introuvable s'affiche **« Fichier introuvable »** avec « Retirer de la liste » et, si possible, « Régénérer » (`MissingFile`), et un bouton **« Nettoyer les éléments introuvables »**. `OutputList` fait tout cela d'un coup pour une liste simple. Routes du socle : `/api/core/outputs` (voir `ARCHITECTURE.md`).

### 5.14 `ctx.notifications` — notifications Windows

`ctx.notifications.notify({ title, body, path })` : notification Windows (si l'app tourne). Un clic ouvre la page `path` du module (`''` = page principale, `'?item=3'`, `'tracks/3'`…). Elle est aussi écrite dans les journaux du module. Pour les rappels, l'utilisateur peut faire tourner l'app en arrière-plan : réglage du socle « Lancer ToolBox au démarrage de Windows » (zone de notification).

### 5.15 `ctx.assistant` — actions pour l'assistant vocal (règle du contrat)

**Chaque module expose ce que l'assistant peut faire avec lui.** L'assistant (module `assistant`) découvre les actions automatiquement ; il n'a pas de code propre aux autres modules. ADR 0028. Par défaut, un module n'expose que des actions de **lecture** ; une action qui modifie n'arrive que sur décision explicite de Thomas (§1 bis).

```ts
ctx.assistant.define({
  name: 'add-task', // kebab-case ; id complet « todo.add-task »
  description: 'Ajoute une tâche à la To-do.', // en français, pour le modèle
  parameters: {
    title: { type: 'string', description: 'Titre, ex. « finir le mix »' },
    tags: { type: 'string[]', description: 'Tags, ex. ["mix"]' },
    due: { type: 'string', description: 'Échéance en langage naturel : « demain », « vendredi »' },
  },
  required: ['title'],
  // Commande standardisée (reconnue sans IA générative) :
  examples: ['ajoute une tâche finir le mix pour vendredi', 'rappelle-moi de payer le mastering'],
  extract: (utterance) => extractAdd(utterance), // paramètres tirés de la phrase, par du code
  risk: 'change',
  right: { id: 'edit-tasks', label: 'L’assistant peut ajouter et cocher des tâches' },
  run: (params) => ({
    message: 'J’ai ajouté « finir le mix » pour vendredi.', // ce qui a été fait, rien de plus
    data: { id: 12 }, // faits pour le modèle (petit, JSON)
    undo: () => removeTask(12), // « Annuler »
  }),
});
```

| `risk`        | Sens                                                                              | Ce que fait le socle                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`        | lecture seule (lister, résumer, ouvrir une page)                                  | exécutée directement                                                                                                                                                |
| `change`      | modification sans conséquence (ajouter, cocher)                                   | refusée tant que son droit `right` est désactivé ; sinon exécutée directement ; `undo` (si fourni) devient « Annuler »                                              |
| `destructive` | modification qui fait perdre quelque chose (supprimer une tâche)                  | refusée tant que son droit est désactivé ; sinon **jamais sans confirmation** : renvoie la question de `confirmation(params)` ; exécutée seulement avec `confirmed` |
| `sensitive`   | publier, envoyer sur YouTube, supprimer des fichiers, changer une date programmée | **jamais exécutée** (pas de `run`) : refus, avec la page `page` du module à ouvrir                                                                                  |

- Paramètres : types `string`, `number`, `integer`, `boolean`, `string[]`, `enum` possible. Le socle les vérifie (paramètre inconnu, manquant, mauvais type → refus expliqué) et corrige ce que les modèles envoient souvent (`"3"` → 3, `"a, b"` → `["a", "b"]`, `""` → absent).
- `run` lève une `HttpError` avec un message français pour un refus attendu (« Tâche introuvable ») ; l'assistant le répète tel quel.
- `message` dit exactement ce qui a été fait : l'assistant ne doit jamais affirmer plus que le résultat de l'action.
- `open` (facultatif) : une route de l'interface à ouvrir (« ouvre la fiche du morceau »).
- Les dates en langage naturel, les noms approximatifs (« boumboum ») se résolvent **dans le module** (code testé), pas par le modèle.
- **Noms** : `matchByName(éléments, ce qui a été dit, (e) => [titre, ...surnoms])` compare l'écriture **et le son** (clé phonétique française, `phoneticKey` / `soundScore` : « obsidienne » → Obsidian, « gros caillou » → GrosKaillou), signale l'ambiguïté, et renvoie `{ kind: 'none', suggestions }` quand rien ne correspond. Les morceaux ont des **surnoms** (`Track.nicknames`, réglés sur leur fiche) : les passer avec le titre.
- **Valeur introuvable** : lever `NotFoundError(param, quoi, valeur, suggestions)` (ex. `new NotFoundError('track', 'le morceau', 'obsidienne', ['Obsidian'])`). Le message est « Je ne trouve pas le morceau « obsidienne ». » ; l'assistant propose « Tu voulais dire « Obsidian » ? » et, sur « oui », relance la **même** action avec cette valeur (mêmes droits, mêmes confirmations).
- `label` (facultatif) : libellé court en français de l'action, montré et dit (« Tu voulais dire : … ou … ? », page Commandes). À défaut, la description.
- `ctx.assistant.setToolNicknames({ todo: ['mes tâches'] })` (permission `assistant`) : surnoms des outils et des pages pour « ouvre … » (utilisé par l'assistant vocal, qui les rend modifiables).
- Consommer le catalogue : `permissions.assistant: true`, puis `ctx.assistant.actions()`, `run(id, params, { confirmed })`, `undo(undoId)`. Les annulations vivent en mémoire (1 h, fin à la fermeture de l'app).
- Le socle fournit ses propres actions (`core.list-jobs`, `core.list-modules`, `core.open`).

**Droits : l'assistant est en lecture seule par défaut (règle du contrat).** Toute action `change` ou `destructive` déclare **son propre droit** `right: { id, label }` (id en kebab-case, complet `<module>.<id>` ; libellé en français, « L’assistant peut… »). Le socle refuse de charger le module sinon. Chaque droit est un interrupteur de la section de réglages « Droits de l’assistant vocal », **désactivé par défaut** ; Thomas l'active lui-même, un par un, après essai (§1 bis). Plusieurs actions d'un même module peuvent partager un droit quand elles vont ensemble (ajouter et cocher une tâche) ; une action qui fait perdre quelque chose a le sien (supprimer). Droit désactivé → `run` renvoie `{ status: 'forbidden', right }` sans rien exécuter, même avec `confirmed` ; l'assistant le dit en une phrase et propose d'ouvrir les droits. Droit activé → les règles ci-dessus s'appliquent toujours (la confirmation d'une action `destructive` reste obligatoire). Lecture et écriture : `ctx.assistant.rights()`, `setRight(id, granted)` (permission `assistant`).

**Commandes standardisées (sans IA générative).** Chaque action peut déclarer :

- `examples` : des phrases d'exemple en français, telles qu'on les dit (« ajoute une tâche finir le mix pour vendredi », « qu’est-ce que j’ai à faire aujourd’hui »). L'assistant reconnaît une demande par le sens (petit modèle d'embeddings local) et par les correspondances exactes ; Thomas peut ajouter ses propres phrases et masquer celles du module (page « Commandes » de l'assistant), jamais changer l'action, ses paramètres ni son niveau de risque.
- `extract(utterance)` : une fonction **en code** qui tire les paramètres de la phrase (titre, tags, date, morceau, nombre). Elle renvoie les paramètres trouvés, ou `null` si un paramètre **obligatoire** manque (la commande n'est alors pas exécutée). Un paramètre facultatif absent reste absent : il n'est jamais demandé. Une action sans paramètre déclare `extract: () => ({})`. Le résultat passe par la même vérification que les paramètres du modèle.
- Aides du SDK (`@hub/sdk/backend`) : `cleanUtterance` (retire « euh », « tu peux », « s’il te plaît »…), `stripCommand(texte, préfixes)`, `extractTags`, `extractTrailing(texte, parse)` (une valeur en fin de phrase, ex. une date), `extractAfter(texte, marqueur)` (« sur le morceau Aube »), `extractName(texte, préfixes)` (un nom après la commande, à résoudre ensuite avec `matchByName`), `extractNumber`, `normaliseUtterance`. Les dates se lisent avec le parseur du module (la To-do a le sien), les morceaux avec `matchByName` dans `run`.
- Une action sans `examples` ni `extract` reste disponible pour l'IA seulement (interrupteur « IA » de l'assistant).
- Tester l'extracteur sur des phrases réalistes, hésitations comprises (`modules/todo/tests/commands.test.ts`).

### 5.16 `ctx.hotkeys` et `ctx.ui` — touche globale, fenêtre, fenêtre flottante

- `ctx.hotkeys` (avec `permissions.globalKeys`) : `hold(key, { onPress, onRelease }, name?)` écoute une touche **maintenue** dans tout Windows (crochet clavier `uiohook-napi`, ADR 0028) ; un module peut avoir plusieurs touches (`name` : « mic », « bar »). Une **combinaison** (`key.modifiers` : `ctrl`, `alt`, `shift`, `meta`) ne se déclenche qu'avec exactement ces modificateurs ; une touche seule se déclenche quels que soient les modificateurs tenus. `capture()` attend « la touche voulue » : une touche avec les modificateurs tenus à ce moment, ou un modificateur seul pressé puis relâché. `status()` dit si c'est possible. Le crochet ne tourne que pendant qu'un module écoute ; seul le code de la touche choisie est regardé, rien n'est enregistré. Absent hors de l'app de bureau (le module propose alors un bouton).
- `ctx.ui.open(route)` : montre la fenêtre (même réduite ou dans la zone de notification) sur une page (`/m/todo`, `/jobs`).
- `ctx.ui.setOverlay(visible)` : demande ou libère la **fenêtre flottante** du socle, qui affiche le composant `Overlay` du module (§7). Le socle compte les demandes : la fenêtre est là tant qu'un module au moins la demande. ADR 0036.

**La fenêtre flottante (une seule, partagée).** Toujours au premier plan, par-dessus l'application en cours (même ToolBox réduite), fond transparent, en bas au centre de l'écran principal. Règles :

- Chaque élément est un **`FloatingPanel`** du SDK (`label`, `interactive`, `focus`) ; les panneaux de tous les modules sont **empilés en colonne** (jamais superposés) et la fenêtre prend la taille du contenu (bord bas fixe ; 560 × 640 au plus).
- Sans option, un panneau laisse passer les clics et ne prend jamais le clavier (indicateur, mini-timer, message bref). `interactive` : il a des boutons ; la fenêtre prend la souris sans s'activer. `focus` : il a un champ de texte (barre écrite) ; la fenêtre prend le clavier jusqu'à la disparition du panneau, puis le rend à l'application en dessous. Réserver `focus` à un geste explicite de l'utilisateur (raccourci).
- Petit, couleurs et arrondis du thème, composants partagés (`Button`…).
- **Chaque panneau a sa durée de vie** : une confirmation, une transition ou un message s'efface seul après quelques secondes (`lifetimeMs`, relancé quand `contentKey` change), sauf une question qui attend sa réponse ; ce qui doit rester (mini-timer) n'en a pas. La disparition d'un panneau réduit la fenêtre.
- **Position** : choisie par Thomas (Réglages > Fenêtre flottante : 4 coins, bas centre, haut centre) ou par glisser sa poignée ⠿ (déplacement natif du système, ADR 0036) ; retenue (`<userData>/overlay-position.json`), ramenée dans l'écran si la résolution change, « Verrouiller la position » cache la poignée. Un module ne choisit jamais la position.
- La fenêtre **propose, n'agit pas seule** : un bouton y appelle les mêmes routes que la page, avec les mêmes règles (« Contrôle et sécurité »). Ce qui modifie s'y confirme à l'écran (message bref). Chaque élément a son réglage pour ne pas s'afficher.

### 5.17 `ctx.calendar` — « Prêt pour le calendrier » (règle du contrat)

Tout module qui a des **éléments datés** déclare une source pour le futur calendrier général : `ctx.calendar.provide({ events(from, to) })`. Pour une période (dates locales `AAAA-MM-JJ`, incluses), elle renvoie ses événements (`CalendarEvent`) :

| Champ         | Contenu                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `id`          | identifiant stable dans le module (UUID pour un module « Prêt pour la synchro ») |
| `title`       | titre affiché                                                                    |
| `start`       | date et heure de début locales `AAAA-MM-JJTHH:mm` (ou une date pour la journée)  |
| `durationMin` | durée en minutes (0 pour un instant)                                             |
| `open`        | route qui ouvre l'élément (« /m/sport?week=2026-10-26 »)                         |
| `status`      | facultatif : détail court (« fait », « 2 portions »)                             |

Le socle ajoute `moduleId` et réunit toutes les sources : `GET /api/core/calendar?from=&to=` (lecture seule ; une source en erreur est journalisée, les autres répondent). Une source ne modifie **jamais** rien quand on l'interroge. Appliqué à : Sport, Courses. À brancher plus tard : Planning, To-do, Timer.

## 6. Migrations et sécurité des données

```ts
migrations: [
  {
    version: 1,
    description: 'tracks table',
    up: `CREATE TABLE music_library__tracks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);`,
  },
  {
    version: 2,
    description: 'add tags',
    up: `ALTER TABLE music_library__tracks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    version: 3,
    description: 'normalize titles',
    up: (db) => {
      db.prepare(`UPDATE ${db.table('tracks')} SET title = trim(title)`).run();
    },
  },
];
```

**Règles (non négociables) :**

1. Versions `1, 2, 3…` contiguës. Une migration publiée n'est **jamais modifiée ni supprimée** : on en ajoute une nouvelle.
2. Une migration ne crée, modifie ou supprime que des objets portant le préfixe du module. Sinon elle est refusée et annulée.
3. **Un module ne supprime jamais de données existantes sans migration explicite.** Aucune suppression de table, de colonne ou de lignes « de nettoyage » en dehors d'une migration dédiée, décrite comme telle (`description`) et mentionnée dans le `CHANGELOG.md`. Le code courant (`ctx.db.prepare`) ne peut pas modifier le schéma. Seule exception : ce que **l'utilisateur demande explicitement** de supprimer depuis l'interface, après confirmation (un élément, ses fichiers via `ctx.outputs`, ses lignes liées).
4. Préférer les migrations additives (nouvelle colonne avec valeur par défaut, nouvelle table). Pour transformer des données, copier vers la nouvelle structure dans la même migration avant de retirer l'ancienne.
5. Une migration doit fonctionner sur une base qui contient déjà des données réelles : la tester ainsi (voir `tests/backend/modules.test.ts`).

**Ce que fait le socle automatiquement :**

| Étape                                                                           | Comportement                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Avant toute migration en attente (socle ou module)                              | Copie de sauvegarde horodatée de `hub.db` dans `<userData>/backups/hub-<date>-avant-<id>-v<version>.db`. Les **10 dernières** sont conservées (rotation séparée de celle de `ctx.db.backup`). Pas de copie quand la base vient d'être créée (rien à protéger).                                                                                   |
| Chaque migration                                                                | Exécutée dans une transaction, enregistrée dans `core__migrations`                                                                                                                                                                                                                                                                               |
| Une migration échoue                                                            | La sauvegarde est **restaurée** (annule aussi les migrations du même lot déjà passées), le module est **désactivé** avec le message d'erreur, les modules qui en dépendent ne démarrent pas, le reste du hub démarre normalement. Le module reste désactivé jusqu'à ce que l'utilisateur le réactive dans Réglages > Modules (après correction). |
| La base est plus récente que le module (retour à une ancienne version de l'app) | Module désactivé pour protéger les données, sans rien modifier                                                                                                                                                                                                                                                                                   |
| Une migration du socle échoue                                                   | Restauration de la sauvegarde, puis l'app refuse de démarrer avec un message clair                                                                                                                                                                                                                                                               |

L'utilisateur peut aussi, à tout moment, **exporter une sauvegarde complète** (Réglages > Sauvegardes) : un `.zip` contenant une copie cohérente de `hub.db` et tous les dossiers `modules/*` de `userData`.

## 6 bis. « Prêt pour la synchro » (règle du contrat, tout NOUVEAU module)

Une future version Android se synchronisera avec le PC sur le réseau local. Tout **nouveau** module stocke donc ses données ainsi (les modules existants seront adaptés dans une session dédiée) :

- **identifiants uniques globaux** : UUID (`newId()`), jamais d'auto-incrément ;
- chaque élément a `created_at` et `updated_at` (ISO) ;
- **suppression logique** : `deleted_at` (« tombstone »), jamais d'effacement silencieux ; les listes ignorent les lignes supprimées, « Annuler » efface le `deleted_at` ;
- **journal des modifications** : table `<module>__changes` (`id`, `at`, `entity`, `entity_id`, `op` = create / update / delete / restore, `data` JSON des champs écrits).

Le SDK le fait pour toi (`@hub/sdk/backend`) : `SYNC_COLUMNS` en tête de chaque `CREATE TABLE`, `changesTableSql('<module>__changes')` dans la première migration, et `SyncStore` (`create`, `update`, `remove`, `restore`, `get`, `changesSince`) qui écrit la ligne et son journal dans la même transaction. Les tables de liaison (ex. ingrédients d'un repas) suivent la même règle.

## 7. Frontend : `frontend/index.tsx`

```tsx
import { defineFrontendModule, Page, useApi, useModule } from '@hub/sdk/frontend';

function TracksPage() {
  const module = useModule(); // id, manifest, api, url()
  const tracks = useApi<Track[]>(module.url('/tracks')); // GET /api/modules/<id>/tracks
  return <Page title={module.manifest.name}>{/* … */}</Page>;
}

export default defineFrontendModule({
  pages: [
    { path: '', component: TracksPage }, // /m/<id>  (lien de la navigation)
    { path: 'tracks/:trackId', component: TrackDetail }, // /m/<id>/tracks/3
  ],
  nav: { label: 'Bibliothèque' }, // défaut : manifest.name ; hidden: true pour masquer
  HomeWidget, // facultatif : contenu de la carte d'accueil
  Background, // facultatif : composant invisible monté toute la session (micro, lecture audio)
  Overlay, // facultatif : panneaux de la fenêtre flottante (ctx.ui.setOverlay, §5.16)
});
```

- `Background` est monté une seule fois dans la fenêtre principale, même page du module fermée, fenêtre réduite ou dans la zone de notification (la fenêtre ne ralentit pas en arrière-plan). Il ne rend rien ; une erreur n'affiche rien et ne touche pas le reste.
- `Overlay` est rendu dans la fenêtre flottante (route `#/overlay`, fond transparent) : un ou plusieurs `FloatingPanel` (§5.16), `null` quand il n'y a rien à montrer.
- Le micro : seule permission matérielle accordée à l'interface (`getUserMedia({ audio: true })`) ; caméra et écran sont refusés.

- Le shell n'affiche un module que si le backend l'a chargé (`GET /api/core/modules` fait foi). Un module en erreur apparaît sur l'accueil avec son état et renvoie vers Réglages.
- Chaque page et chaque widget est rendu dans une **ErrorBoundary** : une erreur d'affichage n'affecte que ce module.
- Le frontend d'un module ne parle **qu'à son propre backend** (`module.api.get('/x')` → `/api/modules/<id>/x`) et aux routes génériques du socle (`useJobs()`). S'il a besoin de données d'un autre module, son backend les obtient via un service.
- Fichiers locaux : `getFilePath(file)` donne le vrai chemin d'un fichier glissé-déposé (dans l'app uniquement ; `null` dans un navigateur) ; `pickFiles()` / `pickFolder()` ouvrent les sélecteurs natifs. Le frontend envoie le **chemin** à son backend, qui copie le fichier dans `ctx.files.dataDir` (pas d'upload HTTP).
- Glisser un fichier **hors de l'app** (vers Instagram dans le navigateur, l'Explorateur…) : dans `onDragStart`, appeler `startFileDrag(mediaUrl)` avec l'URL signée du fichier (`ctx.files.mediaUrl`) et `event.preventDefault()` s'il renvoie `true` (`false` dans un navigateur). Le process principal vérifie la signature avant de lancer le glisser (`webContents.startDrag`).
- Navigation interne : `useModule().path('tracks/3')` donne l'adresse d'une page du module (pour `<Link to>` / `navigate()`).
- CSS propre à un module : un fichier importé depuis `frontend/`, classes préfixées par les initiales du module (ex. `ml-` pour music-library).
- Fichiers générés : `outputs` (client des routes `/api/core/outputs`), `confirmDelete`, `useSelection`, et les composants `SelectionBar`, `MissingFile`, `OutputList` (voir §5.13).
- Outils du SDK : `useModule`, `useApi`, `useJobs`, `api`, `apiFetch`, `openEventStream`, `getFilePath`, `startFileDrag`, `pickFiles`, `pickFolder`, `copyText`, `formatDuration`, `formatBytes`, `errorMessage`, `ApiError`, `dateInputValue` (composants), les fonctions de textes (`fillTemplate`, `toTemplate`, `parseTags`, `formatTags`, aussi dans `@hub/sdk/texts`), et les composants `Page`, `Card`, `Button`, `EmptyState`, `ErrorMessage`, `ProgressBar`, `ErrorBoundary`.

### 7.1 Composants partagés (obligatoires)

**Cohérence : un même type d'élément s'affiche et se manipule de la même façon dans tous les modules.** Les éléments générés et leurs textes passent par les composants partagés de `@hub/sdk/frontend` (fichier `packages/sdk/components.tsx`), jamais par une version maison :

| Composant                        | Rôle                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OutputCard`                     | carte d'un élément généré (vidéo, Reel, post) : miniature, titre + état, détails, progression, erreur, « Fichier introuvable », case « Publié », actions. Grille : `<div className="ui-cards">`                                                                                                                          |
| `MediaThumb`                     | miniature (16:9, 9:16, 4:5, carrée) qu'on peut glisser hors de l'app, case de sélection                                                                                                                                                                                                                                  |
| `StateBadge`                     | pastille d'état (Généré, Planifié, Programmé, Publié, Erreur…)                                                                                                                                                                                                                                                           |
| `PublishedCheck`                 | case « Publié » + date de publication modifiable                                                                                                                                                                                                                                                                         |
| `FileActions`                    | boutons, toujours dans cet ordre : Lire/Voir, Dossier, Régénérer, (spécifiques), Supprimer                                                                                                                                                                                                                               |
| `CopyButton`                     | « Copier » avec confirmation                                                                                                                                                                                                                                                                                             |
| `ExcerptWaveform`, `ExcerptChip` | choix d'extraits (1 à 4, couleurs `--series-1..4`) sur la forme d'onde d'un morceau                                                                                                                                                                                                                                      |
| `FilmstripWindow`                | passage d'une vidéo : fenêtre de largeur fixe (la durée) glissée sur la pellicule ou placée par un clic, zoom, tête de lecture                                                                                                                                                                                           |
| `TrackList`                      | page organisée autour des morceaux : liste à gauche (recherche, cover ou icône, titre, ligne de détail du module), panneau du morceau choisi à droite                                                                                                                                                                    |
| `TextFields`                     | titre, description, légende, tags d'un élément, **modifiables sous l'élément** (§7.3)                                                                                                                                                                                                                                    |
| `usePrecheck`                    | vérification rapide du master avant une génération (avec `precheckTrack` côté backend) : rien à signaler → génère tout de suite (avec la `note` éventuelle affichée en petit) ; sinon les faits et « Générer quand même » / « Voir l'analyse » / « Annuler ». Jamais bloquant, rien sans le module « Analyse du master » |

Un besoin non couvert : enrichir le composant du SDK (pour tous), pas en écrire un autre dans le module.

**Icônes : pas d'emoji dans l'interface.** Toutes les icônes (barre latérale, accueil, cartes, titres, réglages, badges, boutons, fenêtre flottante…) viennent du jeu unique du SDK : `<Icon name="…" />` (`@hub/sdk/frontend`, lucide-react, même trait, taille du texte, couleur du thème ; `label` quand l'icône porte un sens sans texte à côté). Le manifest nomme son icône de la même façon (§2). `npm run lint` échoue sur un emoji dans un frontend (`scripts/check-ui-emoji.mjs`). Ce qui sort de l'app n'est pas l'interface : une légende Instagram, un export Markdown peuvent en contenir.

### 7.2 Couleurs et thèmes

L'interface a plusieurs thèmes (Réglages › Apparence, `docs/THEMES.md`). **Aucune couleur écrite en dur dans le frontend d'un module** (ni `#hex`, ni `rgb()`, ni `hsl()`, en CSS comme en TSX) : uniquement les variables du thème (`var(--accent)`, `var(--series-3)`…) et les classes du shell (`card`, `button`, `badge`, `input`, `list`, `ui-*`). `npm run lint` échoue sinon (`scripts/check-ui-colors.mjs`). Les visuels **générés** ne sont pas concernés : ils suivent `docs/DIRECTION-ARTISTIQUE.md`.

### 7.3 Textes des éléments (titre, description, légende, tags)

- Les textes d'un élément généré se modifient **sur place, sous l'élément**, avec `TextFields` (enregistrement en quittant le champ, « Enregistrer » ou Ctrl+Entrée ; compteur ; « Copier »).
- Les **modèles des réglages ne font que pré-remplir**. Un texte modifié est « Personnalisé » et ne bouge plus ; « Rétablir le modèle » y revient ; « **Enregistrer comme modèle par défaut** » transforme le texte en modèle avec `toTemplate` (les valeurs du morceau redeviennent des repères `{titre}`, `{artiste}`…).
- Repères et remplissage : `fillTemplate`, `toTemplate`, `parseTags`, `formatTags` de `@hub/sdk/texts` (backend et frontend), une seule implémentation pour tous les modules.
- Un texte a **un seul propriétaire** (le module qui publie l'élément ou le génère) ; un autre module le modifie via son service, jamais par une copie.

- Textes de l'interface en français.

### 7.4 Guide intégré (module complexe)

**Un module complexe fournit un guide intégré, mis à jour à chaque changement d'interface.** Complexe = plusieurs vues, des graphes ou des mesures qui demandent une explication (premier exemple : `master-analysis`).

- **Page séparée** du module (`pages: [{ path: 'guide', … }]`), ouverte **seulement à la demande** : un bouton « Guide » sur la page principale, et un petit « ? » discret à côté de chaque graphe et de chaque mesure, qui ouvre la bonne section (`guide?s=<id>`). Les « ? » se masquent avec un réglage du module (booléen, affiché par défaut) ; le bouton « Guide » reste toujours là.
- **Contenu en français**, en données (pas en JSX éparpillé) : prise en main en 5 minutes ; chaque vue avec ses éléments et ses gestes ; chaque mesure et chaque graphe (ce que c'est, unité, comment le lire) ; flux de travail ; réglages et leur effet ; limites et pièges. **Recherche** dans le guide (accents et casse ignorés).
- **Captures annotées de l'interface réelle**, produites par un script qui pilote l'app (Playwright) et mesure la position des repères numérotés (modèle : `scripts/guide-captures.mjs`). Images légères (JPEG), dans le dossier du module.
- **Mise à jour dans le même commit** que tout changement d'une vue, d'un graphe, d'une mesure ou d'un réglage : texte, et captures relancées si l'élément montré a changé. Un test vérifie que chaque « ? », chaque lien interne et chaque repère mène à une section ou une capture existante (modèle : `modules/master-analysis/tests/guide.test.ts`).
- Le guide **explique et ne décide rien** : il ne change ni le comportement du module ni ses données.

## 8. Tests

Chaque module a ses tests dans `modules/<id>/tests/`. `@hub/sdk/testing` démarre un **vrai socle** (base, migrations, routes) dans un dossier temporaire :

```ts
import { createTestHub, loadModuleFolder } from '@hub/sdk/testing';
const hub = await createTestHub({
  modules: [await loadModuleFolder(path.resolve(__dirname, '..'))],
});
const { status, body } = await hub.request('GET', '/api/modules/<id>/tracks');
await hub.close();
```

Pour un module qui consomme un service, fournir un faux module fournisseur dans `modules: [...]`.

Deux niveaux : `npm test` (rapide, par défaut, pendant le travail) et `npm run test:full` (tout, dont les rendus complets ; toujours exécuté par la CI Windows). Un test qui fait un rendu complet (vidéo, pack, Reel en taille réelle), et ceux qui utilisent ses fichiers, ne tournent que dans la suite complète : `describe.runIf(fullRenderTests)` / `it.runIf(fullRenderTests)` (`fullRenderTests` de `@hub/sdk/testing`). Les aperçus et petits rendus restent dans les tests rapides.

## 9. Gestion des erreurs : ce qui ne fait pas tomber le hub

| Problème                                                   | Conséquence                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `module.json` invalide, id en double                       | Module « en erreur », message précis, les autres démarrent   |
| Dépendance absente, désactivée ou en erreur                | Module « dépendance manquante » (en cascade)                 |
| Migration en échec                                         | Base restaurée, module désactivé (§6)                        |
| Exception dans `register()`                                | Tout ce qu'il avait déclaré est annulé, module « en erreur » |
| Exception dans une route                                   | Réponse 500 claire, entrée dans les journaux                 |
| Exception dans une tâche, une tâche planifiée, un écouteur | Tâche « échec » / nouvel essai / entrée dans les journaux    |
| Erreur d'affichage React                                   | Encadré d'erreur limité au module, bouton « Réessayer »      |
| Exception non gérée ailleurs                               | Consignée dans les journaux, l'app continue                  |

L'état de chaque module est visible dans **Réglages > Modules** (avec bouton Désactiver / Réactiver, appliqué au redémarrage) et sur l'accueil.

## 10. Checklist d'un module conforme

- [ ] `id` = nom du dossier, manifest complet et valide
- [ ] N'importe que `@hub/sdk/*` (et npm/Node) — `npm run lint` passe
- [ ] Tables préfixées, schéma uniquement par migrations, aucune suppression de données hors migration explicite
- [ ] Nouveau module : « Prêt pour la synchro » (§6 bis : UUID, dates, tombstones, journal)
- [ ] Éléments datés : source `ctx.calendar` (« Prêt pour le calendrier », §5.17)
- [ ] Nouveauté non validée par Thomas marquée « Expérimental » (manifest `experimental: true` ou badge dans la page)
- [ ] Fichiers uniquement dans `ctx.files.dataDir` / `outputDir()`
- [ ] Chaque fichier généré enregistré dans `ctx.outputs` (avec `onRemoved` pour nettoyer ses données et `onReattach` pour suivre un rattachement) ; dans l'interface : « Supprimer » avec confirmation, sélection multiple, « Fichier introuvable », « Nettoyer les éléments introuvables »
- [ ] Dépendances et services déclarés dans le manifest ; types publics dans `contract.ts`
- [ ] Comptes externes déclarés dans `permissions.accounts`, autorisations minimales
- [ ] Actions pour l'assistant déclarées (`ctx.assistant.define`, §5.15) : lecture de l'essentiel ; une action qui modifie seulement sur décision de Thomas, annulable, et confirmée si elle supprime ; rien de sensible exécutable
- [ ] Chaque action qui modifie (`change`, `destructive`) a **son propre droit** `right`, désactivé par défaut
- [ ] Commandes standardisées : `examples` (phrases en français) et `extract` (paramètres tirés par du code, `null` si un obligatoire manque), testés sur des phrases réalistes
- [ ] Contrôle et sécurité (§1 bis) : rien n'est supprimé, publié, modifié en ligne ou écrasé sans confirmation ; tout ce qui agit seul est désactivé par défaut avec un réglage clair
- [ ] Éléments générés affichés avec les composants partagés du SDK (§7.1), icônes du SDK et pas d'emoji (§7.1), aucune couleur en dur (§7.2)
- [ ] Textes en français, code en anglais
- [ ] `README.md` du module à jour (rôle, données, réglages, événements, services, API)
- [ ] Module complexe : guide intégré à jour (§7.4), captures relancées si l'interface montrée a changé
- [ ] Tests dans `tests/`, `npm test` passe
- [ ] `CHANGELOG.md` et `docs/ROADMAP.md` mis à jour

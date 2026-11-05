# Étude — Version téléphone, étape 1 (05/11/2026)

Étude seulement : **aucun code de l'application n'est modifié**. Livrables : ce rapport et l'ADR 0044 « Version mobile et synchro LAN » (statut **proposé**).

## Résumé en une page

**Recommandations**

1. **Faire tourner le code serveur actuel des 5 modules dans le téléphone, tel quel**, plutôt que de le réécrire.
   - Il tourne dans un _Web Worker_ de l'application Capacitor, avec un « hôte téléphone » qui fournit le même `ctx` que le socle du PC : base, routes, réglages, calendrier, services, notifications.
   - Les écrans ne changent pas : le client d'API unique (`apiFetch` / `useApi` du SDK) choisit son transport, HTTP sur le PC ou messages vers le Worker sur le téléphone, avec les mêmes chemins (`/api/modules/todo/tasks`…).
   - La séparation service / transport de ta proposition devient donc inutile au départ : le contrat existant (`ctx.routes`, `ModuleDatabase`) sert d'interface commune. Elle reste possible plus tard, module par module.
2. **Base du téléphone : option b, SQLite compilé en WebAssembly** (`@sqlite.org/sqlite-wasm`, stockage OPFS « sahpool ») dans le Worker. L'accès reste **synchrone**, comme better-sqlite3.
   - Le code des 5 modules (7 150 lignes côté serveur, ~190 écritures par `SyncStore`, 20 transactions) n'a pas besoin de passer en asynchrone.
   - Le comportement du PC reste intact : better-sqlite3 n'est pas touché.
   - Le plugin `@capacitor-community/sqlite` (asynchrone) n'est **pas recommandé**.
   - Point à **prouver dès l'étape 3** sur le S21 : persistance OPFS dans le WebView (petit essai, voir §3).
3. **Retirer de ces 5 modules toute dépendance directe à Node** (étape 2, sur le PC, sans changement de comportement). Concrètement :
   - `node:fs` et `@napi-rs/canvas` (images des recettes) passent par un adaptateur du socle ;
   - `randomUUID` passe par `crypto.randomUUID` ;
   - le SDK serveur est séparé en une partie portable et une partie propre au PC.
4. **Synchro** : le journal `<module>__changes` existe et toutes les écritures y passent déjà. Il manque :
   - identifiant d'appareil ;
   - horloge hybride (HLC) à la place de l'heure seule ;
   - curseurs par appareil ;
   - version de base ;
   - table des conflits ;
   - écouteur réseau HTTPS sur le PC (il n'écoute aujourd'hui que `127.0.0.1`).
5. **Android** :
   - Capacitor 8 exige Android 7.0 minimum (API 24), largement couvert par le S21 ;
   - APK signé par GitHub Actions, faisable (clé en secret) ;
   - notifications du Timer : notifications programmées à l'avance (exactes), et exemption de batterie Samsung à guider.

**Risques principaux**

- **Persistance OPFS dans le WebView Android** : non vérifiée sur appareil réel. Repli prévu : SQLite en mémoire et sauvegarde du fichier par le plugin Filesystem après chaque écriture.
- **Repérage du PC sur le Wi-Fi du kot** : l'isolement des clients et le blocage du multicast sont fréquents. D'où le **test Wi-Fi à faire avant l'étape 2** (§8).
- **Conflits sur les noms uniques** (ingrédient, préparation, moment, tag) créés des deux côtés : il faut une règle de fusion (question ouverte).
- **Timer** quand l'appli est en arrière-plan : le Worker est suspendu, donc les fins de phase doivent être des notifications programmées à l'avance. Il faut aussi l'exemption de batterie Samsung.

**Questions ouvertes** (détail §9)

1. Les réglages (objectifs, modèle de créneaux, moments de cuisine…) se synchronisent-ils ?
2. Les images des recettes vont-elles sur le téléphone ?
3. Règle pour deux ingrédients du même nom créés hors ligne de part et d'autre.
4. Un timer lancé sur les deux appareils à la fois.
5. Fusion d'un import JSON fait sur le téléphone.
6. Comment générer la clé de signature de l'APK.
7. Emplacement des ADR : ta demande dit `docs/adr/`, le dépôt utilise `docs/decisions/`. J'ai suivi le dépôt.

---

## 1. Inventaire par module

Légende : **P** = portable tel quel · **A** = à passer par un adaptateur · **X** = propre au PC, exclu du téléphone.

### Courses (backend 3 245 lignes, frontend 4 277, shared 2 007)

| Dépendance                                                                                                   | Où                  | Classe                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------- |
| `shared/*` (quantités, nutrition, recette, batch, échange JSON, dates)                                       | shared              | **P** (aucun import Node)                                               |
| `ctx.db` : `prepare` ×8, `transaction` ×14, `SyncStore` ×92, `live()` ×47, 6 migrations (dont 1 en fonction) | backend             | **A** (interface `ModuleDatabase` ; adaptateur sqlite-wasm)             |
| `node:fs` (images : écrire, effacer), `ctx.files.dataPath`, `ctx.files.trash`, `mediaUrlIfExists`            | `backend/index.ts`  | **A** (adaptateur fichiers : Filesystem sur le téléphone)               |
| `@napi-rs/canvas`, `node:crypto` (réduction des images en JPEG, sha256)                                      | `backend/images.ts` | **A** (canvas du navigateur et `crypto.subtle` sur le téléphone)        |
| `ctx.files.saveAs` (export JSON, liste Markdown)                                                             | backend             | **A** (partage Android : Filesystem + Share)                            |
| `ctx.db.backup` (avant un import)                                                                            | backend             | **A** (copie du fichier de base)                                        |
| `ctx.settings` get/set (objectifs, réglages du batch)                                                        | backend             | **A** (table de réglages locale)                                        |
| `ctx.calendar.provide`                                                                                       | backend             | **P** (pur ; pas de calendrier général sur le téléphone au début)       |
| `ctx.assistant.define` ×6                                                                                    | backend             | **X** (hôte téléphone : sans effet)                                     |
| `ctx.logger`                                                                                                 | backend             | **A** (console)                                                         |
| `getFilePath` (chemin d'un fichier déposé)                                                                   | frontend            | **X** (le téléphone envoie l'image en données, déjà prévu : `{ data }`) |
| `window.confirm` ×7, `localStorage` ×2, `copyText`                                                           | frontend            | **P** (fonctionnent dans le WebView)                                    |
| Glisser-déposer d'une image                                                                                  | frontend            | **X** (le bouton « Choisir une image » reste)                           |

### Sport (backend 1 090, frontend 1 557, shared 357)

| Dépendance                                                                | Classe          |
| ------------------------------------------------------------------------- | --------------- |
| `shared/*`                                                                | **P**           |
| `ctx.db` : `prepare` ×12, `transaction` ×5, `SyncStore` ×22, 3 migrations | **A**           |
| `ctx.files.saveAs` (export)                                               | **A** (partage) |
| `ctx.calendar.provide`                                                    | **P**           |
| `ctx.assistant.define` ×7                                                 | **X**           |
| `window.confirm`                                                          | **P**           |

### To-do (backend 819, frontend 787, dates/shared/contract 411)

| Dépendance                                                                          | Classe                                |
| ----------------------------------------------------------------------------------- | ------------------------------------- |
| `dates.ts` (échéances en langage naturel), `shared.ts`                              | **P**                                 |
| `ctx.db` : `prepare` ×8, `SyncStore` ×7, 2 migrations (1 en fonction, reprise UUID) | **A**                                 |
| `ctx.services.provide('todo')` (utilisé par Timer et Idées)                         | **P** (registre en mémoire de l'hôte) |
| `ctx.calendar.provide`, `ctx.onShutdown`                                            | **P**                                 |
| `ctx.assistant.define` ×5                                                           | **X**                                 |

### Timer (backend 1 245, frontend 1 296, shared 345)

| Dépendance                                                            | Classe                                                                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/plan.ts` (phases tirées de l'heure réelle)                    | **P**                                                                                                                                                                                           |
| `ctx.db` : `prepare` ×13, `SyncStore` ×6, 2 migrations                | **A**                                                                                                                                                                                           |
| `setTimeout` (passage de phase, message)                              | **A** : sur le téléphone, le Worker dort en arrière-plan. Les fins de phase sont **programmées à l'avance** en notifications locales, et le temps est recalculé à la réouverture (déjà le cas). |
| `ctx.notifications.notify`                                            | **A** (Local Notifications ; nouvelle opération « programmer à une heure »)                                                                                                                     |
| `/events` (flux SSE `openEventStream`) + `openEventStream` côté écran | **A** (canal de messages du Worker)                                                                                                                                                             |
| `ctx.ui.setOverlay`, `FloatingPanel`, `Floating.tsx`                  | **X** (pas de fenêtre flottante)                                                                                                                                                                |
| `ctx.settings.get/onChange`, `ctx.services.optional('todo')`          | **A** / **P**                                                                                                                                                                                   |
| `sound.ts` (son de fin)                                               | **P** dans l'appli ouverte ; en arrière-plan, le son vient de la notification                                                                                                                   |
| `window.prompt`                                                       | **P** (à remplacer par un champ pour le confort, pas obligatoire)                                                                                                                               |
| `ctx.assistant.define` ×7                                             | **X**                                                                                                                                                                                           |

### Boîte à idées (backend 699, frontend 923, shared 132)

| Dépendance                                                               | Classe          |
| ------------------------------------------------------------------------ | --------------- |
| `shared.ts` (recherche sans accents)                                     | **P**           |
| `ctx.db` : `prepare` ×9, `transaction` ×1, `SyncStore` ×13, 2 migrations | **A**           |
| `ctx.files.saveAs` (export)                                              | **A** (partage) |
| `ctx.services.optional('todo')` (« Transformer en tâche »)               | **P**           |
| `ctx.assistant.define` ×3                                                | **X**           |

**Écrans** : 81 appels `module.api.*` et 16 `useApi` passent tous par **un seul point du SDK** (`apiFetch`). Aucun écran n'appelle `fetch` directement. Aucun écran n'importe Node ou Electron. Seuls `getFilePath` / glisser-déposer (Courses) et `FloatingPanel` / `openEventStream` (Timer) touchent au PC.

## 2. Socle utilisé par ces modules

| Élément                                                                                                                                   | Classe                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Registre des modules (`backend/core/hub.ts`, découverte par `scripts/build`)                                                              | **A** : l'hôte téléphone charge une liste fixe de 5 modules, construite par un second point d'entrée de build.                             |
| Migrations (`backend/core/migrations.ts`, SQL ou fonction, dans une transaction, sauvegarde avant)                                        | **A** : même exécuteur, base sqlite-wasm ; sauvegarde = copie du fichier OPFS.                                                             |
| `SyncStore` (`packages/sdk/sync.ts`, 153 lignes)                                                                                          | **P** sauf `randomUUID` de `node:crypto` → `crypto.randomUUID`. `syncStamp` (heure + 1 ms) devra devenir une **HLC** pour la synchro (§5). |
| Réglages (`core__settings`, `ctx.settings`)                                                                                               | **A** (même table dans la base du téléphone)                                                                                               |
| Sauvegardes (`backups.ts`, `copyFileSync`)                                                                                                | **X** sur le téléphone, remplacé par une copie OPFS / Filesystem                                                                           |
| `HttpError`, `requestBody`, `ctx.routes`                                                                                                  | **P** si l'hôte téléphone fournit un mini routeur compatible (méthode + chemin + `params` / `query` / `body`)                              |
| SDK interface (`frontend.tsx` : `Page`, `Card`, `Button`, `useApi`, `UndoToast`…) et composants                                           | **P** (React pur) ; `apiFetch` / `openEventStream` deviennent **A** (2 transports)                                                         |
| Thèmes (variables CSS)                                                                                                                    | **P** ; ajouter une mise en page mobile (barre d'onglets en bas, une colonne)                                                              |
| Routeur `react-router` (HashRouter)                                                                                                       | **P**                                                                                                                                      |
| Jeton `x-toolbox-token`, tickets SSE, Fastify, `HostAdapter` Electron, `jobs`, `scheduler`, `hotkeys`, `outputs`, `accounts`, `assistant` | **X** (non utilisés par les 5 modules sur le téléphone)                                                                                    |

## 3. Accès à la base (point critique)

**Ampleur.** Les 5 modules font tout leur accès en **synchrone**, sur ~7 150 lignes serveur :

- 50 `prepare` directs, 20 `transaction` (dont certaines imbriquées par `SyncStore`) ;
- ~140 lectures `live()` / `store.get`, ~190 écritures `SyncStore` ;
- 15 migrations, dont 5 en fonction.

Les calculs (liste de courses, résumé, batch exact) lisent la base au milieu de code pur.

**Option a — interface asynchrone partout, deux adaptateurs.**

- Il faudrait passer **chaque** fonction qui touche la base en `async` :
  - fonctions internes (`meals()`, `listDto()`, `summaryDto()`, `compute()`…) ;
  - routes ;
  - `SyncStore` ;
  - migrations en fonction ;
  - et les tests.
- better-sqlite3 n'accepte pas de fonction asynchrone dans une transaction. Il faudrait écrire un gestionnaire de transaction maison (verrou, `BEGIN` / `COMMIT`), et le plugin Capacitor fait passer chaque requête par le pont natif.
- Risque pour le PC : **élevé**. Des milliers de lignes réécrites, un ordre d'exécution qui change, des transactions entrelacées possibles. C'est exactement la régression que la règle de la v0.27 cherche à éviter.
- Le plugin `@capacitor-community/sqlite` gère les transactions (`beginTransaction` / `commitTransaction`), les migrations (`addUpgradeStatement`) et le chiffrement SQLCipher. Mais sa page ne documente que Capacitor 5 et recommande `minSdkVersion = 23` ; **la version compatible Capacitor 8 n'est pas confirmée** par ses pages. Le plugin SQLite de Capawesome annonce Capacitor 8 (série 0.5.x).

**Option b — SQLite en WebAssembly dans le téléphone (recommandée).**

- `@sqlite.org/sqlite-wasm` (version officielle du projet SQLite), API « oo1 » **synchrone**. L'adaptateur `ModuleDatabase` fait `prepare` / `get` / `all` / `run` / `transaction` comme better-sqlite3.
- La persistance OPFS synchrone n'existe **que dans un Worker** (accès « SyncAccessHandle », Chromium ≥ 108). La VFS `opfs-sahpool` est livrée depuis SQLite 3.43.
- D'où l'architecture : **le code serveur des modules tourne dans le Worker**, l'interface lui parle par messages. C'est naturellement asynchrone côté écrans, comme HTTP aujourd'hui.
- Transactions et migrations : celles de SQLite, identiques au PC (même SQL, même exécuteur).
- Performances : les bases sont petites (quelques Mo) et les requêtes locales sans pont natif.
- Risque pour le PC : **faible**. better-sqlite3 et le code des modules restent tels quels ; seul un second adaptateur est ajouté.
- Inconnues à lever (petit essai au début de l'étape 3, sur le S21) :
  - `createSyncAccessHandle` est bien disponible dans le WebView de Capacitor 8 (Chromium, mis à jour par le Play Store : très probable, **non vérifié**) ;
  - les données OPFS survivent aux mises à jour de l'appli et au nettoyage du cache.
  - **Repli** : `sql.js` en mémoire, avec écriture du fichier de base par le plugin Filesystem après chaque transaction (simple, adapté à de petites bases).

**Recommandation : option b**, l'option a en dernier recours seulement. Raisons :

- zéro réécriture du code métier ;
- comportement du PC inchangé par construction ;
- même SQL et mêmes migrations des deux côtés ;
- une seule inconnue technique, testable en une heure sur le téléphone.

## 4. Contrat d'API

| Module  | Routes                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| To-do   | 6 : `GET /tasks`, `/today` ; `POST /tasks`, `/tasks/:id/restore` ; `PATCH` / `DELETE /tasks/:id`                                                                                  |
| Idées   | 10 : `/ideas` (GET/POST), `/ideas/:id` (PATCH/DELETE), `/restore`, `/random`, `/to-task`, `/tags/:name`, `/export`, `/home`                                                       |
| Sport   | 15 : `/week`, `/month`, `/template`, `/sessions…`, `/exercises…`, `/home`, `/export`                                                                                              |
| Timer   | 13 : `/state`, `/start`, `/pause`, `/resume`, `/stop`, `/skip`, `/extend`, `/answer`, `/answer/undo`, `/dismiss`, `/presets…`, **`/events` (flux)**                               |
| Courses | 49 : état, ingrédients, repas, préparations (extraire, remplacer), image, moments, planning, liste, extras, historique, résumé, objectifs, import / export JSON, batch (8 routes) |

- **Faisabilité** : bonne.
  - Écrans : `apiFetch` / `useApi` reçoivent un « transport » (HTTP sur le PC, `postMessage` vers le Worker sur le téléphone). Aucun écran n'est modifié.
  - Flux du Timer : `openEventStream` reçoit le même traitement.
  - Worker : un mini routeur reprend `ctx.routes.get/post/…`, les mêmes chemins et les mêmes erreurs `HttpError`.
- **Client typé** : utile mais pas nécessaire au départ. Il peut venir ensuite, en générant les types depuis les `*Dto` de `shared/types.ts`.
- **À changer dans les écrans** (mise en page seulement) :
  - navigation en bas ;
  - tableaux larges en cartes (planning de Courses, grille du batch, semaine de Sport) ;
  - Courses : bouton « Choisir une image » au lieu du glisser-déposer ;
  - Timer : sans `FloatingPanel`.

## 5. Prêt pour la synchro : état réel

| Module  | Tables                                                                                                                                                                                                                             | UUID, `created_at` / `updated_at`, `deleted_at` | Écritures par le journal                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Courses | 19 : `ingredients`, `ingredient_nutrients`, `ingredient_prices`, `meals`, `meal_items`, `meal_images`, `meal_preps`, `preps`, `prep_items`, `moments`, `plan`, `extras`, `lists`, `list_extras`, `list_checks`, 4 tables `batch_*` | oui (toutes)                                    | oui (aucune écriture SQL directe hors migrations) |
| Sport   | 6 : `templates`, `template_exercises`, `weeks`, `sessions`, `session_exercises`, `exercises`                                                                                                                                       | oui                                             | oui                                               |
| To-do   | `tasks` (+ `tasks_v1`, `legacy_ids`)                                                                                                                                                                                               | oui (`tasks`)                                   | oui                                               |
| Timer   | `sessions`, `presets` (+ `_v1`, `legacy_ids`)                                                                                                                                                                                      | oui                                             | oui                                               |
| Idées   | `ideas`, `tags` (+ `_v1`, `legacy_ids`)                                                                                                                                                                                            | oui                                             | oui                                               |

**Non conformes** :

- les tables d'archives `*_v1` et `legacy_ids` : propres au PC, **à ne jamais synchroniser** ;
- les **réglages** (`core__settings`), hors journal ;
- les **fichiers d'image** des recettes (seule la ligne `meal_images` est synchronisée).

**Ce qui manque pour la synchro décrite** (tout en ajouts) :

- **Identifiant d'appareil** : un UUID par installation, dans une table du socle.
- **Horloge** : `syncStamp` est l'heure de la machine. Deux appareils mal réglés donnent un mauvais « plus récent ». Il faut une **horloge hybride (HLC)** : heure, compteur et appareil, avec avance sur la plus grande valeur reçue. Elle s'ajoute au journal (nouvelle colonne) ; « version la plus récente champ par champ » compare des HLC.
- **Champ par champ** : le journal garde les champs modifiés à chaque mise à jour (`data`), ce qui suffit. Il faut en plus l'HLC du dernier changement **par champ** et par ligne (colonne JSON ajoutée, ou table annexe) pour ne pas relire tout le journal.
- **Curseurs** : `changesSince(date)` lit par date, ce qui n'est pas fiable entre appareils. Il faut un numéro d'ordre local (`seq`) dans chaque journal et, par appareil appairé, le dernier `seq` reçu et envoyé.
- **Version de base** : la liste des migrations appliquées par module (`core__migrations`) donne une empreinte. Le téléphone compare la sienne à celle du PC et s'arrête si elles diffèrent (décision prise).
- **Conflits** : une table `core__sync_conflicts` (ligne, champ, valeur gardée, valeur écartée, appareils, HLC), plus un écran « Conflits ».
- **Unicités par nom** (ingrédient, préparation, tag, moment) : deux créations hors ligne donnent deux lignes de même nom. Il faut une règle (question ouverte 3).

## 6. Android et CI

- **Version minimale** :
  - Capacitor 8 : **API 24 (Android 7.0)**, compile et cible l'API 36, JDK 21 (sources secondaires : notes de mise à jour d'Ionic et de PowerSync, à confirmer dans le `variables.gradle` généré) ;
  - plugin SQLite communautaire : `minSdk 23` d'après sa page ;
  - option b recommandée : aucun plugin SQLite, seulement le WebView.
  - **Galaxy S21** : sorti sous Android 11 et mis à jour par Samsung bien au-delà (à vérifier sur le téléphone, Paramètres › À propos › Informations sur le logiciel). Compatible.
- **APK signé par GitHub Actions**, sur Ubuntu :
  1. `actions/setup-java` (JDK 21) ;
  2. `android-actions/setup-android` ;
  3. `npm ci`, construction de l'interface, `npx cap sync android` ;
  4. décodage de la clé (secret `ANDROID_KEYSTORE_BASE64`, mots de passe et alias en secrets) ;
  5. `./gradlew assembleRelease` ;
  6. publication de l'APK en artefact.

  Rien à installer chez toi. La clé doit rester **la même pour toujours** (sinon une mise à jour exige de désinstaller et perd les données) ; voir la question ouverte 6.

- **Installation** : télécharger l'APK depuis la page de la CI, l'ouvrir sur le téléphone, autoriser « Installer des applis inconnues » pour le navigateur ou les Fichiers, une seule fois. Pour une mise à jour : même signature et numéro de version supérieur.
- **Notifications du Timer** :
  - Android 13+ : autorisation de notification à demander ;
  - Android 12+ : alarmes exactes (`SCHEDULE_EXACT_ALARM`, ou `USE_EXACT_ALARM` sur Android 14 quand l'exactitude est le cœur de l'appli) ;
  - en veille profonde : `allowWhileIdle` ;
  - l'utilisateur peut couper les alarmes exactes : l'appli le vérifie à chaque ouverture (`checkExactNotificationSetting`) et le dit.
- **Particularités Samsung** : One UI met les applis en veille et peut retarder ou supprimer leurs alarmes. Le guide intégré dira, sur le S21 :
  - Paramètres › Batterie › Limites d'utilisation en arrière-plan : ajouter ToolBox aux « Applis jamais en veille » ;
  - Paramètres › Applis › ToolBox › Batterie : « Non restreinte ».

  (Le site de référence dontkillmyapp.com n'était pas joignable depuis cette session : à relire avant l'étape 4.)

## 7. Plan des étapes 2 à 5

| Étape                              | Ce qui est fait                                                                                                                                                                                                                                                                                                                                                                                  | Fichiers touchés                                                                                                                                                               | Risques                                                                                 | Preuve de non-régression du PC                                                                                                                                                                         | Taille                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **2. Cœur partagé (PC seulement)** | Références écrites **avant** toute modification pour Sport, To-do, Timer, Idées (comme `courses/tests/regression.test.ts`). Puis : retrait des imports Node des 5 modules (images via un adaptateur du socle) ; `randomUUID` portable ; SDK serveur séparé en partie portable et partie PC ; `apiFetch` / `openEventStream` à transport choisi ; règle ESLint « pas de Node dans ces 5 modules » | `packages/sdk/{backend,sync,frontend}.tsx`, `backend/core/files.ts`, `modules/courses/backend/{index,images}.ts`, les 5 `backend/index.ts` (imports seulement), nouveaux tests | Casser un import ; une image ré-encodée différemment                                    | Les références des 5 modules sont identiques ; suite complète ; CI Windows ; images : même empreinte sha256 qu'avant sur un jeu fixe                                                                   | grosse (ou 2 moyennes : références, puis portage) |
| **3. Coquille Android + To-do**    | Essai OPFS sur le S21 (premier jour) ; projet Capacitor 8 (`mobile/`) ; Worker hôte (mini routeur, `ctx` téléphone) ; adaptateur sqlite-wasm ; migrations ; mise en page mobile minimale ; To-do seul ; workflow APK signé                                                                                                                                                                       | nouveaux : `mobile/`, `packages/sdk/host-mobile.ts`, `.github/workflows/android.yml` ; PC : rien                                                                               | OPFS indisponible (repli `sql.js` + Filesystem) ; taille de l'APK                       | PC non modifié (diff limité à de nouveaux fichiers) ; mêmes tests To-do lancés contre l'adaptateur sqlite-wasm (sous Node, `@sqlite.org/sqlite-wasm` tourne aussi) : mêmes réponses que better-sqlite3 | grosse                                            |
| **4. Autres modules**              | Idées, Sport, Courses (images par le bouton, export par partage), Timer (notifications programmées, pas de fenêtre flottante) ; écrans en cartes ; guide Samsung                                                                                                                                                                                                                                 | `mobile/`, CSS mobiles des modules (fichiers ajoutés), adaptateurs                                                                                                             | Timer en arrière-plan ; tableaux larges de Courses                                      | Les références des 5 modules jouées contre les deux adaptateurs ; CI                                                                                                                                   | 2 sessions moyennes                               |
| **5. Synchro LAN**                 | Migrations du socle (appareil, HLC, `seq`, curseurs, conflits, empreinte de version) ; écouteur HTTPS LAN (désactivé par défaut) ; appairage QR ; repérage mDNS + adresse retenue ; WebSocket (poussée < 1 s) ; aperçu de la première synchro et sauvegardes ; écran Conflits ; « Oublier cet appareil »                                                                                         | `backend/core/` (nouveaux fichiers `sync*.ts`), `packages/sdk/sync.ts` (HLC), migrations du socle, `mobile/`                                                                   | Isolement du Wi-Fi ; horloges ; conflits de noms ; sécurité (jeton, certificat épinglé) | Les journaux existants ne changent pas (colonnes ajoutées) ; sans appairage, aucun écouteur LAN et un comportement identique (références) ; tests de synchro à deux bases simulées, horloges décalées  | 2 grosses sessions                                |

## 8. Test Wi-Fi pour Thomas (avant l'étape 2)

But : savoir si le téléphone **joint** le PC sur le Wi-Fi du kot. Rien à installer : on utilise PowerShell, déjà dans Windows.

1. **PC et téléphone sur le même Wi-Fi.** Même nom de réseau. Si le réseau existe en « 2,4 GHz » et en « 5 GHz », choisis le même des deux côtés.
2. **Adresse du PC** : touche Windows, tape `cmd`, Entrée, puis tape `ipconfig`. Dans la section de la carte Wi-Fi, note « Adresse IPv4 » (par exemple `192.168.1.23`).
3. **Petit serveur de test** : touche Windows, tape `PowerShell`, ouvre-le, puis colle ce bloc et appuie sur Entrée :

   ```powershell
   $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, 8765); $l.Start()
   "En attente sur le port 8765 (Ctrl+C pour arrêter)"
   while ($true) { $c = $l.AcceptTcpClient(); $s = $c.GetStream(); $r = [System.IO.StreamReader]::new($s); $null = $r.ReadLine()
     $b = [Text.Encoding]::UTF8.GetBytes("<h1>Le PC voit ton telephone</h1>")
     $h = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n`r`n")
     $s.Write($h, 0, $h.Length); $s.Write($b, 0, $b.Length); $c.Close(); "Visite reçue" }
   ```

   Si Windows demande d'autoriser l'accès réseau, coche **les deux** types de réseau (privé et public) et accepte.

4. **Sur le PC d'abord** : ouvre `http://localhost:8765` dans un navigateur. Résultat attendu : « Le PC voit ton telephone ». Sinon, le serveur n'est pas lancé.
5. **Sur le téléphone** (Wi-Fi activé, données mobiles **coupées** pour éviter un faux résultat) : ouvre Chrome ou Samsung Internet à `http://192.168.1.23:8765` (ton adresse). Résultat attendu : la même page, et « Visite reçue » dans PowerShell.
6. **Arrêter** : Ctrl+C dans PowerShell, puis ferme-le. Si tu avais autorisé le réseau public, tu peux retirer la règle : Pare-feu Windows › Autoriser une application › « Windows PowerShell » › décocher Public.

**Si l'étape 5 échoue** (la page ne charge pas) :

- **Pare-feu** : si le réseau du kot est marqué « Public », Windows bloque. Essaie en mettant ce réseau en « Privé » : Paramètres › Réseau et Internet › Wi-Fi › le réseau › Type de profil réseau › Privé. Puis refais l'étape 5.
- **Isolement des clients** (fréquent dans les kots : les appareils ne se voient pas entre eux). Deux contournements :
  - **Partage de connexion du téléphone** : active le point d'accès du téléphone, connecte le PC dessus, refais les étapes 2 à 5 avec la nouvelle adresse du PC (souvent `192.168.x.x` ou `10.x.x.x`). Le PC utilise alors les données du téléphone pour Internet ; pour la synchro seule, c'est quelques Ko.
  - **Petit routeur de voyage** (environ 25 à 35 €, par exemple un routeur « travel » branché au câble ou au Wi-Fi du kot) : PC et téléphone se connectent à son Wi-Fi à lui, qui n'isole pas les appareils.
- **Note** : ce test vérifie la connexion directe (TCP). Le **repérage automatique** du PC (multicast mDNS) peut être bloqué même si ce test réussit. Dans ce cas, l'appli gardera l'adresse du QR code et la redemandera si elle change.

**Dis-moi le résultat** (réussi tel quel, réussi en réseau privé, réussi seulement en partage de connexion, ou échec) : il décide du mode de repérage à construire à l'étape 5.

## 9. Questions ouvertes

1. **Réglages** (objectifs, modèle de créneaux, moments de cuisine, éléments du dernier plan, réglages du Timer) : synchronisés ou propres à chaque appareil ? Proposition : objectifs et réglages « métier » synchronisés, réglages d'affichage locaux.
2. **Images des recettes** : sur le téléphone ou non ? Proposition : oui, transférées une fois par empreinte (`sha256` déjà stocké), réduites (≤ 1 200 px), après les données.
3. **Noms uniques créés des deux côtés** (deux « Oignon ») : fusion automatique (la plus ancienne gagne, les lignes sont réattribuées) ou affichage dans « Conflits » pour fusion manuelle ?
4. **Timer lancé sur les deux appareils** : un seul timer actif à la fois (le plus récent gagne, l'autre est arrêté et mis en conflit) ?
5. **Import JSON sur le téléphone** : autorisé (même aperçu), ou réservé au PC ?
6. **Clé de signature de l'APK** : la créer une fois par un workflow manuel, puis la mettre en secret et effacer l'artefact ? Ou la créer sur le PC avec `keytool` (exige un JDK) ?
7. **Emplacement des ADR** : la demande dit `docs/adr/`, le dépôt utilise `docs/decisions/` (ADR 0001 à 0043). L'ADR proposée est rangée dans `docs/decisions/0044-…` ; à déplacer si tu préfères.
8. **Architecture** : tu as proposé de séparer service et transport dans chaque module. L'étude recommande d'abord l'« hôte téléphone » qui réutilise `ctx.routes` tel quel (moins de changements sur le PC). D'accord pour garder la séparation explicite comme option ultérieure ?

## 10. Actions sans clic de Thomas

**Aucune** : rien n'est modifié dans l'application.

## 11. Données et migrations

Aucune.

## 12. Commits

Un commit, documentation seulement : ce rapport et l'ADR 0044 (plus une ligne dans l'index des ADR). Version de l'app inchangée (0.29.0).

## 13. Prochaines étapes suggérées

1. **Faire le test Wi-Fi** (§8) et me donner le résultat.
2. **Répondre aux questions ouvertes** 1, 3, 6 et 8 : elles conditionnent l'étape 2 et l'étape 5.
3. **Lancer l'étape 2** : d'abord les références de non-régression des 4 autres modules, puis le portage.

## Sources consultées

- Capacitor 8, version minimale d'Android : [notes de mise à jour Ionic](https://ionic.io/docs/auth-connect/upgrading), [PowerSync](https://github.com/powersync-ja/powersync-docs/issues/467), [Capgo](https://capgo.app/zh/blog/troubleshooting-capacitor-android-build-errors/).
- Plugin SQLite : [capacitor-community/sqlite](https://github.com/capacitor-community/sqlite), [Capawesome SQLite](https://capawesome.io/docs/sdks/capacitor/sqlite/).
- SQLite WebAssembly et OPFS : [PowerSync, persistance SQLite sur le web](https://www.powersync.com/blog/sqlite-persistence-on-the-web), [forum SQLite](https://sqlite.org/forum/forumpost/449ae66eb1?t=c), [OpenReplay](https://blog.openreplay.com/sqlite-browser-opfs/).
- Notifications locales : [Capacitor Local Notifications](https://capacitorjs.com/docs/apis/local-notifications).

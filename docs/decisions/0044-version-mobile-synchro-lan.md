# 0044 — Version mobile et synchro LAN

- Statut : **accepté** (05/11/2026, réponses de Thomas aux questions ouvertes et test Wi-Fi)
- Date : 2026-11-05
- Étude : `docs/rapports/2026-11-05-etude-mobile.md`

## Contexte

Thomas veut une version Android de ToolBox pour les modules hors musique : Courses, Sport, To-do, Timer, Boîte à idées. Il n'y aura ni musique, ni assistant, ni fenêtre flottante, ni raccourcis. Le téléphone de référence est un Samsung Galaxy S21, qui démarre vide.

## Décisions déjà prises par Thomas

- **Fonctionnement autonome** : le téléphone marche seul, hors ligne. Il se synchronise avec le PC en **Wi-Fi local, sans cloud**.
- **Synchro automatique** sur le même Wi-Fi :
  - repérage automatique du PC ;
  - connexion ouverte ;
  - changements poussés dans la seconde tant que l'appli est ouverte ;
  - rattrapage à la réouverture.

  Elle est activée à l'appairage ; désactivée par défaut pour qui ne la choisit pas.

- **Appairage** : QR code affiché sur le PC (adresse, jeton secret, empreinte du certificat), HTTPS, et bouton « Oublier cet appareil ».
- **Échange** : par le journal de changements existant (`SyncStore`). Les suppressions sont toujours logiques.
- **Conflits** : la version la plus récente gagne, **champ par champ** ; l'autre est conservée dans une liste « Conflits ».
- **Le PC est le maître des versions** : si la version de base du téléphone diffère de celle du PC, le téléphone arrête toute synchro et demande une mise à jour. Ses changements locaux attendent, intacts.
- **Première synchro** : aperçu, puis confirmation ; sauvegarde des deux bases avant.

## Décision proposée (recommandations de l'étude)

1. **Coquille** :
   - Capacitor 8 (Android 7.0 / API 24 minimum, S21 compatible) ;
   - interface React existante avec une mise en page mobile ;
   - APK signé construit par GitHub Actions, installé à la main.
2. **Hôte téléphone** :
   - le code serveur actuel des 5 modules tourne **tel quel** dans un Web Worker ;
   - un hôte y fournit le même `ctx` que le socle (base, mini routeur `ctx.routes`, réglages, calendrier, services, notifications, fichiers) ;
   - `ctx.assistant` est sans effet ; `ctx.ui` et les raccourcis sont absents.
3. **Client d'API unique** : `apiFetch`, `useApi` et `openEventStream` du SDK choisissent leur transport, HTTP sur le PC ou messages vers le Worker sur le téléphone, **mêmes chemins, même contrat**. Les écrans ne changent pas (mise en page à part).
4. **Base de données** :
   - même interface `ModuleDatabase`, **synchrone**, avec deux adaptateurs : better-sqlite3 sur le PC (inchangé) et `@sqlite.org/sqlite-wasm` avec stockage OPFS (`opfs-sahpool`) dans le Worker ;
   - repli : `sql.js` en mémoire, fichier sauvegardé par le plugin Filesystem ;
   - le plugin asynchrone `@capacitor-community/sqlite` n'est **pas** retenu : il obligerait à réécrire en asynchrone tout le code métier, au détriment de la non-régression du PC.
5. **Portabilité** (avant tout code mobile, sur le PC, sans changement de comportement) :
   - aucun import Node dans les 5 modules ;
   - images des recettes et fichiers par un adaptateur ;
   - `crypto.randomUUID` ;
   - SDK serveur en deux parties : portable et PC ;
   - une règle ESLint le garantit.
6. **Timer** : fins de phase programmées à l'avance en notifications locales (alarmes exactes, `allowWhileIdle`). L'exemption de batterie Samsung est guidée dans l'appli.
7. **Synchro** (ajouts seulement, par migrations du socle) :
   - identifiant d'appareil ;
   - **horloge hybride (HLC)** dans le journal, à la place de l'heure seule ;
   - HLC par champ pour le « plus récent champ par champ » ;
   - numéro d'ordre local (`seq`) et curseurs par appareil ;
   - empreinte de version (migrations appliquées) ;
   - table `core__sync_conflicts` ;
   - écouteur HTTPS sur le réseau local, **désactivé tant qu'aucun appareil n'est appairé** ;
   - WebSocket pour la poussée ;
   - repérage mDNS avec repli sur l'adresse du QR.

   Ne se synchronisent jamais : les tables d'archives `*_v1` et `legacy_ids`.

8. **Étapes** :
   - 2 : cœur partagé sur le PC, références de non-régression écrites avant ;
   - 3 : coquille Android + To-do, essai OPFS sur le S21 le premier jour ;
   - 4 : autres modules ;
   - 5 : synchro LAN.

   Test Wi-Fi fait le 05/11 (voir plus haut).

## Décisions validées par Thomas (05/11/2026)

- **Code serveur** : celui des 5 modules (Courses, Sport, To-do, Timer, Idées) tourne **tel quel** sur le téléphone, dans un Worker.
  - Un « hôte téléphone » le sert et fournit le même `ctx`.
  - Aucune réécriture en asynchrone. Le découpage service / transport reste une option pour plus tard.
- **Base du téléphone** : `@sqlite.org/sqlite-wasm` (OPFS) dans le Worker.
- **Réglages** :
  - les réglages métier sont synchronisés (objectifs, créneaux, moments de cuisine, préréglages du Timer) ;
  - les réglages d'affichage restent locaux.
- **Images des recettes** : envoyées au téléphone par empreinte, réduites.
- **Même nom créé des deux côtés** :
  - **jamais de fusion automatique** ;
  - il va dans « Conflits », avec un bouton « Fusionner » (la fusion d'ingrédients existante).
- **Timer lancé sur les deux appareils** : le plus récent gagne, l'autre s'arrête avec un message.
- **Import JSON** : réservé au PC.
- **Clé de signature de l'APK** :
  - créée une seule fois par un workflow manuel ;
  - gardée en secret GitHub ;
  - **et** copiée par Thomas hors de GitHub.
- **ADR** : elles restent dans `docs/decisions/`.
- **Test Wi-Fi (05/11)** : le téléphone joint directement le PC. Le mDNS n'a pas été vérifié ; le repli est l'adresse du QR code.

## Étape 2 faite (v0.29.1)

Cœur partagé sur le PC, sans changement de comportement : `@hub/sdk/core` (portable) et `@hub/sdk/backend` (PC), `ctx.images` et les fichiers par `ctx.files`, `crypto.randomUUID`, client d'API à transport injectable, règle ESLint. Détail : `docs/rapports/2026-11-05-v0.29.1.md`.

## Étape 3a faite (v0.29.2)

- **Appli d'essai** `mobile/probe/` (`be.toolbox.probe`, distincte de la future appli) : SQLite WebAssembly + VFS opfs-sahpool dans un Worker, sous Capacitor 8, sans aucun repli. Elle compte ses lancements et mesure 1 000 écritures / lectures. Le protocole d'essai sur le S21 est dans `docs/rapports/2026-11-05-v0.29.2.md`. **L'étape 3b n'est lancée que si l'essai réussit.**
- **APK d'essai** : `.github/workflows/android-probe.yml`. Les versionCode 1 et 2 sont construits dans le même run (même clé de debug), pour que la mise à jour s'installe par-dessus.
- **Clé de signature** : `.github/workflows/android-keystore.yml`, lancé une seule fois par Thomas. Le dépôt étant public, la clé sort dans une archive 7-Zip chiffrée (phrase dans le secret `KEYSTORE_EXPORT_PASSPHRASE`), gardée 1 jour ; elle n'est jamais écrite dans le journal.
- **Modules portables par défaut** : tout module hors musique et assistant suit la règle ESLint (imports et globaux de Node).

## Résultat de l'essai OPFS sur le S21 (05/11/2026) : réussi

- **Contexte** : Android 15, WebView Chrome 156, sqlite-wasm 3.54.1, VFS opfs-sahpool persistante, `createSyncAccessHandle` utilisable.
- **Résultat** : données intactes après fermetures, arrêt forcé, cache vidé et mise à jour de l'APK (v1 → v2) ; 3 000 lignes, et le compteur de lancements n'est jamais revenu à zéro.
- **Réserve** : `storage.persist()` = non. Android ne garantit pas la conservation si le téléphone manque de place, d'où le **filet de sauvegarde obligatoire** de l'étape 3b.

## Étape 3b faite (v0.30.0)

- **Appli** `mobile/app/`, identifiant **`be.toolbox.app`**, nom affiché « ToolBox ».
  - **Cet identifiant ne changera plus jamais** : Android reconnaît les mises à jour à l'identifiant et à la clé de signature.
  - Coquille mobile (Accueil, To-do, Réglages), écrans des modules du PC avec une mise en page mobile en fichiers CSS ajoutés.
- **Hôte téléphone** `packages/phone/` :
  - même `ctx` que le socle ; ce qui n'est pas encore fourni lève « non disponible sur le téléphone » ; assistant sans effet ;
  - mini routeur aux réponses de Fastify ;
  - base sqlite-wasm à l'interface de better-sqlite3 ;
  - transport Worker pour le client d'API.
- **Code du socle rendu portable, sans changement pour le PC** : exécuteur de migrations, validation des réglages, format des identifiants hérités. Une installation neuve convertit les 2 préréglages livrés du Timer avec `legacyId` : le téléphone a donc un sha256 synchrone en JavaScript, égal à celui de Node.
- **Preuve** : la référence de la To-do, rejouée sur sqlite-wasm et l'hôte téléphone, donne les mêmes réponses et les mêmes lignes que sur le PC.
- **Filet de sauvegarde** :
  - une copie par jour, à l'ouverture, dans `Directory.Data` ;
  - 7 copies gardées, jamais celle d'une base vide ;
  - restauration proposée, jamais automatique.
- **Sauvegarde Android vers le cloud désactivée** (`allowBackup="false"`) : rien ne part en ligne sans Thomas.
- **APK release signé** : `.github/workflows/android.yml`.
  - `versionCode = majeure × 1 000 000 + mineure × 100 + correctif`.
  - Le workflow s'arrête si un secret manque.

## Étape 4 faite (v0.31.0)

- **Les cinq modules sur le téléphone** : To-do, Boîte à idées, Sport, Timer, Courses. Chaque référence de non-régression est rejouée sur sqlite-wasm et l'hôte téléphone avec un scénario partagé avec le PC (`modules/<id>/tests/scenario.ts`) : mêmes réponses, mêmes lignes. Seule la lecture par l'assistant est exclue (sans effet sur le téléphone).
- **Copie « avant-migration »** : le Worker ne migre pas une base non vide tant que la page n'a pas fait cette copie (comptée dans les 7).
- **Canal inverse Worker → page** (`HostCall`) pour ce que seuls les greffons Android savent faire : `ctx.files.saveAs` = feuille de partage.
- **Flux d'événements** servis par le Worker : la page du Timer suit les phases comme sur le PC.
- **Notifications du Timer programmées à l'avance** par la page (le Worker dort en arrière-plan) au démarrage, à la reprise et à « +5 min », annulées à la pause et à l'arrêt ; mêmes textes que le serveur (`modules/timer/shared/notices.ts`). `ctx.notifications.notify` et `ctx.ui.setOverlay` sont sans effet sur le téléphone.
- **Fichiers** : dossier de données des modules dans OPFS, en mémoire et écrit au fil de l'eau ; pas de Corbeille (`trash` supprime). **Images** : `OffscreenCanvas`, mêmes règles que le PC, octets JPEG différents.
- **Import JSON des Courses réservé au PC** (il fait une sauvegarde `ctx.db.backup` que le téléphone n'a pas).
- **Réglages des modules** sur le téléphone : mêmes routes et même formulaire que le PC, sans ce qui n'y a pas de sens (fenêtre flottante du Timer).

## Étape 5a faite (v0.32.0) : moteur de synchro, appairage, synchro à la main

- **Socle** (migrations, ajouts seulement) : appareils appairés, curseurs par appareil et par module, conflits, journal des réglages synchronisés (`core__changes`). Chaque module synchronisé reçoit une migration `syncJournalSql` : horloge hybride (HLC), origine et numéro d'ordre dans son journal, horloge par champ (`<module>__field_clock`).
- **Moteur portable** (`backend/core/sync/`) : lots depuis un curseur, application champ par champ (la HLC la plus récente gagne), idempotente, tout ou rien ; conflits gardés dans `core__sync_conflicts` ; suppression d'un côté et modification de l'autre : la ligne reste supprimée avec les modifications, listée ; noms en double jamais fusionnés seuls (« Fusionner » par la fusion du module quand elle existe : ingrédients, exercices) ; clé unique en double (une semaine du Sport, le nom d'un tag) : celle du PC reste, l'autre prend son id et ses valeurs, listée.
- **Règle de Thomas (06/11/2026)** : semaine du Sport remplie sur les deux appareils → celle du PC est gardée ; les séances générées par l'autre appareil et jamais touchées passent en suppression logique ; celles qu'il a modifiées restent et sont listées.
- **Réglages** : `sync: true` dans le manifest pour les réglages de données (les 7 réglages des Courses : objectifs, batch). Les réglages d'affichage restent locaux (thème, guide vu, son et volume du Timer, carte d'accueil des Idées…).
- **Réseau** : écouteur HTTPS du PC désactivé par défaut ; certificat épinglé par le QR code ; jeton par appareil ; versions comparées à chaque échange.
- **Première synchro** : aperçu par module, puis « Partir des données du PC » (les 5 modules du téléphone remplacés) ou « Fusionner » ; copie « avant-synchro » du téléphone et sauvegarde du PC avant.
- **Pas dans 5a** (étape 5b) : repérage mDNS, WebSocket et synchro automatique, photos des recettes, Timer lancé sur les deux appareils.

## Étape 5b faite (v0.33.0)

- **Le PC retrouvé sur n'importe quel réseau** (problème rencontré par Thomas : appairé à la maison, plus de synchro au kot) : le certificat et le jeton restent valables, seule l'adresse change.
  - Adresses connues : le téléphone garde toutes celles où il a joint le PC et celles que le PC lui envoie à chaque échange (`core__sync_addresses`, migration du socle v7) ; il les essaie toutes ensemble, délai court.
  - Repérage mDNS : le PC s'annonce (`_toolbox-sync._tcp`, son identifiant) **seulement pendant l'écoute** ; le téléphone le cherche (greffon `PcFinder`, NSD d'Android). Une adresse trouvée n'est utilisée que si le certificat est l'épinglé.
  - Secours : « QR de l'adresse » (`TBXA-…`, adresse + port + empreinte, sans jeton) → « Nouvelle adresse du PC » : ni réappairage, ni nouvelle première synchro ; refusé si l'empreinte diffère.
- **Photos des recettes** : déclarées par le module (`sync.files`), elles voyagent après les données, dans les deux sens, une fois par empreinte, par morceaux de 512 Kio ; une photo manquante ne bloque jamais les données.
- **Timer sur deux appareils** (décision de Thomas, 05/11) : un seul timer à la fois, le plus récemment lancé gagne ; l'autre est arrêté, listé dans « Conflits », et l'appareil concerné le dit. Décidé par le PC (`syncClock.onReceived`, `tools.master`).
- **Synchro automatique** : réglage du téléphone, **désactivé par défaut**. À l'ouverture et au retour sur l'appli, 3 s après les modifications, et en direct depuis le PC (WebSocket `wss://…/sync/live` sur l'écouteur existant, même épinglage, même jeton ; greffon `LiveChannel`, OkHttp). Jamais en arrière-plan, jamais la première synchro. Écart avec la décision du 05/11 (« activée à l'appairage ») : Thomas a demandé qu'elle soit désactivée par défaut et qu'il l'active lui-même.
- **Notification permanente du Timer** : greffon `TimerOngoing` (NotificationCompat, compte à rebours natif, canal silencieux, AlarmManager pour passer d'une phase à l'autre, reconstruite après redémarrage). Boutons : ils ouvrent l'appli, qui fait l'action par le serveur du Timer (seule vérité ; le Worker ne tourne pas en arrière-plan).
- **« Expérimental »** retiré de l'appairage, de la première synchro, de la synchro à la main et des Conflits (validés par Thomas) ; gardé sur la synchro automatique, le repérage réseau et la notification permanente.

## Agenda (v0.34.0)

Sixième module du téléphone, synchronisé dès sa création (`sync: {}`, migration 2 `syncJournalSql`) : événements, semaine type et exceptions d'occurrence voyagent ; les calques restent propres à chaque appareil. Sur le téléphone, une vue jour par jour (`onPhone()`), mise en page dans `agenda.mobile.css`. Contrat du calendrier élargi en même temps : ADR 0045.

## Conséquences

- Le PC ne change pas de comportement. Chaque étape le prouve par des références écrites avant modification, la suite complète et la CI Windows.
- Le même SQL et les mêmes migrations servent sur les deux appareils, ce qui facilite la synchro et la vérification de version.
- **Inconnue encore à lever** : repérage mDNS du PC sur le Wi-Fi du kot (non vérifié ; les adresses connues et « QR de l'adresse » suffisent sans lui).

  Voir la section « Questions ouvertes » de l'étude.

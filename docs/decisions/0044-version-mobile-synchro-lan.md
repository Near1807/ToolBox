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

## Conséquences

- Le PC ne change pas de comportement. Chaque étape le prouve par des références écrites avant modification, la suite complète et la CI Windows.
- Le même SQL et les mêmes migrations servent sur les deux appareils, ce qui facilite la synchro et la vérification de version.
- **Inconnue encore à lever** : repérage mDNS du PC (non vérifié ; repli : l'adresse du QR code).

  Voir la section « Questions ouvertes » de l'étude.

# Assistant vocal (`assistant`)

Parler à ToolBox en maintenant une touche, comme un talkie-walkie : « ajoute finir le mix de boumboum pour vendredi », « qu'est-ce que je publie cette semaine ? », « résume ma chaîne YouTube », « ouvre le Planning ». Section **Outils**. **100 % gratuit et local** : rien ne part sur Internet, sauf le téléchargement initial des moteurs et des modèles (ADR 0029).

## La chaîne

| Maillon   | Outil (local, gratuit)                                                                                                                                           | Ce qui tourne                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Oreilles  | **whisper.cpp** v1.9.2 (`whisper-server`, version OpenBLAS pour Windows x64), en français                                                                        | gardé lancé (le modèle reste chargé), requête HTTP locale sur 127.0.0.1                             |
| Commandes | **Commandes standardisées** (phrases d'exemple + extracteurs en code des modules) ; petit modèle d'embeddings multilingue (onnxruntime-web, ~120 Mo, facultatif) | dans l'app, quelques millisecondes ; aucun modèle de langage                                        |
| Cerveau   | **Ollama** (installé à part, gratuit) avec appel d'outils — **seulement si l'interrupteur « IA » est activé**                                                    | le modèle choisi, gardé en mémoire 30 min ; réponse en flux                                         |
| Voix      | **Piper** 2023.11.14-2 (binaire autonome) et une voix française                                                                                                  | gardé lancé (une phrase par ligne → un WAV par phrase) : la lecture commence dès la première phrase |

Le micro est enregistré dans la fenêtre de ToolBox (16 kHz mono), même réduite ou dans la zone de notification. Rien n'est enregistré sur le disque à part les phrases synthétisées (effacées après 10 minutes).

## Ce qu'il fait (V1)

- **To-do** : ajouter (titre, tags, échéance en langage naturel, morceau), lister (à faire, aujourd'hui, en retard, semaine, faites, par tag), cocher, supprimer (avec confirmation).
- **Lire les autres outils** : Planning (à publier aujourd'hui, cette semaine, en retard, sortie d'un morceau), Stats YouTube (résumé, morceau, faits marquants), Bibliothèque (morceaux, état d'un projet), Pack Insta et Reels perso (état), Tâches (rendus en cours) ; **ouvrir** un outil ou la fiche d'un morceau.
- **Culture générale** avec les connaissances du modèle (pas d'Internet en V1) ; s'il n'est pas sûr, il le dit.
- Il répond **toujours à voix haute** (réglable) : la réponse, ou la confirmation de l'action faite.

Les actions viennent des modules eux-mêmes (`ctx.assistant`, MODULES.md §5.15) : un nouveau module qui déclare ses actions est utilisable à la voix sans toucher à l'assistant.

## Commandes standardisées et interrupteur « IA »

Une demande est d'abord comparée aux **commandes** (les actions des modules qui déclarent des phrases d'exemple et un extracteur, MODULES.md §5.15). ADR 0030.

- **Reconnue** (score ≥ seuil, nettement devant la 2e commande, paramètres obligatoires trouvés) : exécutée **sans IA**, avec les règles de sécurité habituelles, et la réponse est le message court de l'action. Les paramètres facultatifs absents restent vides, jamais demandés.
- **Pas reconnue, IA activée** : le modèle choisi prend le relais (comme avant).
- **Pas reconnue, IA désactivée** (par défaut) : « Je n'ai pas compris ta demande. », avec « Tu voulais dire : … ? » si une commande était proche (jamais exécutée). Ollama n'est ni appelé ni nécessaire.
- **Reconnaissance** : par le sens (modèle d'embeddings, à télécharger d'un clic) et par les mots partagés ; sans le modèle, par les mots seuls (plus strict). Seuil (0,7) et écart (0,08) réglables (avancé). Dans le doute : rien.
- **Page « Commandes »** (`/m/assistant/commands`, ou « quelles sont les commandes ? ») : commandes par module, phrases, paramètres, risque, état (disponible ou droit à activer) ; ajouter, modifier, supprimer ses phrases ; masquer une phrase du module (jamais perdue) ; « Rétablir les phrases d'origine » (par commande ou toutes) ; « Tester une phrase » (commande, score, écart, paramètres ; rien n'est exécuté) ; export / import du dictionnaire.
- **Conflit** : une phrase trop proche d'une autre commande affiche un avertissement qui nomme les deux ; enregistrée seulement après confirmation.
- **« C'était… »** dans l'historique, sur une demande non comprise : choisir la commande voulue ajoute la phrase (avec la vérification des conflits).

## IA simplifiée (quand elle est activée)

- **La sécurité est appliquée par le code, jamais par le modèle** : confirmation d'une suppression, droits, refus des actions sensibles, message exact de l'action.
- **Instructions courtes et stables** (lues une fois, gardées en cache par Ollama) : le modèle appelle l'outil directement, ne demande jamais de confirmation (l'app s'en charge), ne demande jamais un paramètre facultatif, pose au plus une question (paramètre obligatoire manquant), répond en une phrase courte (deux au plus), sans formule de politesse ni reformulation. Réponse coupée au-delà de 120 jetons.
- **Moins d'outils envoyés** : ceux des modules que les commandes ont trouvés proches (et ceux du socle) ; la liste complète en cas de doute.
- **Modèle préchargé** au démarrage (IA activée) et gardé en mémoire : réglage « Garder le modèle en mémoire » (10 min, 30 min, 2 h, toujours).
- **Réponses directes** (résultat des outils lu tel quel, sans 2e passage du modèle) : « Automatique » par défaut = activées sur un PC sans carte graphique dédiée.
- **Trop long** (plus de 2 minutes) : « Le modèle met trop de temps à répondre : essaie un modèle plus petit, ou une commande standardisée. »
- **Instructions modifiables** (réglages avancés de la page) : zone de texte, « Rétablir l'original », longueur affichée (impact sur la vitesse), appliquées tout de suite. Les parties ajoutées par l'app (date et heure, liste des actions envoyées) sont affichées en lecture seule. Incluses dans « Exporter une sauvegarde » (réglage `systemPrompt`).

## Droits de l'assistant

L'assistant est **en lecture seule par défaut**. Chaque modification a son propre interrupteur, désactivé par défaut (page de l'assistant, ou Réglages › Droits de l'assistant vocal) :

- « L'assistant peut ajouter et cocher des tâches » ;
- « L'assistant peut supprimer des tâches » (le « oui » reste obligatoire) ;
- « L'assistant peut lancer la synchronisation des stats YouTube ».

Droit désactivé : l'assistant le dit en une phrase et propose d'ouvrir les droits.

## Sécurité et honnêteté

Appliqué par le socle et par le code de l'assistant, pas laissé au modèle :

- **Lecture** : faite directement.
- **Modification sans conséquence** (ajouter, cocher) : faite directement, confirmée à voix haute avec le message exact de l'action, bouton **« Annuler »** dans l'historique.
- **Modification destructrice** (supprimer une tâche) : question d'abord (« Je supprime la tâche « … » ? »), exécutée seulement après un « oui » reconnu par le code (« oui », « vas-y », « d'accord »… ; « non », « annule »…) ou un clic.
- **Sensible** (envoyer sur YouTube, publier, changer une date programmée, supprimer des fichiers) : jamais faite. L'assistant le dit et propose d'ouvrir la page ; « oui » l'ouvre.
- Après une modification, ce qui est dit est le **message de l'action** (ce qui s'est vraiment passé), jamais une reformulation du modèle.
- Une phrase du modèle qui prétend avoir fait quelque chose sans qu'un outil l'ait confirmé n'est **jamais dite** (« Je n'ai rien fait : je n'ai pas trouvé l'outil pour ça. »).
- Demande ambiguë (date, tag, morceau, tâche) : les actions refusent de deviner (« Plusieurs morceaux correspondent : … Lequel ? », « Je n'ai pas compris l'échéance… ») et l'assistant pose la question.
- Contexte gardé pendant la session (questions de suivi), **oublié à la fermeture** de l'app ; « Nouvelle conversation » l'oublie tout de suite.

## Touche « parler »

- Par défaut la **touche Copilot**. Windows lui fait envoyer Win+Maj+F23, et ToolBox l'entend même sans le focus (crochet clavier `uiohook-napi`, socle `ctx.hotkeys`, ADR 0028). « Changer la touche » : appuyer sur la touche voulue dans les 10 secondes.
- **Maintenir** pour parler, relâcher pour envoyer ; ou **appuyer une fois**, parler, **appuyer à nouveau** (automatique si la touche est relâchée en moins de 0,35 s). Enregistrement limité à 30 s. Reparler coupe la réponse en cours.
- Limites de la touche Copilot (impossibles à contourner proprement pour une app hors Microsoft Store) :
  - Windows ouvre aussi Copilot (ou la Recherche). Le réglage « Personnaliser la touche Copilot » de Windows ne propose que des apps MSIX du Store.
  - Sur certains PC, la touche envoie son relâchement tout de suite : le mode « appuyer / appuyer » prend le relais.
  - Solution conseillée : PowerToys › Gestionnaire de clavier › « Remapper un raccourci » Win+Maj+F23 → F24, puis « Changer la touche » et appuyer sur la touche Copilot. Ou une autre touche (Ctrl droit, F13…).
- Aussi : bouton micro sur la page, et une zone de texte pour écrire au lieu de parler.

## Indicateur flottant

Petite pastille toujours au premier plan, même ToolBox réduit (socle `ctx.ui.setOverlay`, composant `Overlay`) : « J'écoute… » (point rouge), « Je réfléchis… » (avec ce qui a été compris), « Je réponds » (avec la réponse). Couleurs du thème. Elle disparaît 2,5 s après la fin.

## Modèles (choix et recommandation)

L'app détecte la mémoire, les fils de calcul et la carte NVIDIA (`nvidia-smi`), et recommande :

| PC                                 | Cerveau (Ollama)           | Oreilles                 |
| ---------------------------------- | -------------------------- | ------------------------ |
| NVIDIA ≥ 12 Go et 16 Go de mémoire | `ministral-3:14b` (9,1 Go) | Small                    |
| NVIDIA ≥ 8 Go                      | `ministral-3:8b` (6 Go)    | Small                    |
| Sinon (processeur seul)            | `ministral-3:3b` (3 Go)    | Small (≥ 6 fils) ou Base |

- **Ministral 3** (Mistral AI, décembre 2025) : appel d'outils natif, très bon en français. Alternatives proposées : Qwen 3.5 (4B, 9B, très fiable pour les outils), Mistral Small 3.2 (24B). Tout autre modèle d'ollama.com/library peut être saisi.
- Après le téléchargement, l'app vérifie qu'Ollama déclare la capacité **« tools »**. Sans elle, le modèle répond aux questions mais ne peut pas agir (l'assistant le dit).
- Les modèles qui « réfléchissent » (capacité « thinking », ex. Qwen) sont appelés avec `think: false` : réponse directe, plus rapide.
- Reconnaissance : Tiny, Base, Small, Medium, Large v3 Turbo q5 (whisper.cpp, Hugging Face `ggerganov/whisper.cpp`). Voix : Siwis (femme, recommandée), Tom (homme), UPMC Jessica / Pierre, Gilles (Hugging Face `rhasspy/piper-voices` v1.0.0). Vitesse 0,7 à 1,5.
- **Réponses directes** (option) : le résultat d'une action de lecture est lu tel quel au lieu d'être reformulé par le modèle (une passe en moins, plus rapide).

## Latences

Chaque échange affiche : « commande standardisée » ou « IA » (ou « pas compris »), la commande reconnue et son score, le nombre de questions posées, et le temps de chaque maillon : transcription, reconnaissance des commandes, modèle (IA seulement), réflexion (jusqu'à la première phrase prête, et jusqu'à la fin), voix (synthèse de la première phrase), et « 1er son » (du relâchement de la touche au premier son).

## Données

| Élément     | Détail                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables      | `assistant__phrases` (phrases de Thomas : action, texte), `assistant__hidden_phrases` (phrases des modules masquées) — migration 1. Historique et contexte en mémoire seulement                                                                                                                                                                                                                          |
| Fichiers    | `<userData>/modules/assistant/` : `engines/whisper`, `engines/piper` (moteurs), `models/ggml-*.bin`, `voices/*.onnx(.json)`, `embeddings/<modèle>/` (modèle des commandes), `downloads/` (archives), `speech/` (phrases synthétisées, effacées après 10 min)                                                                                                                                             |
| Réglages    | `ai` (non), `commandThreshold` (0,7), `commandMargin` (0,08), `speakReplies` (oui), `speed` (1), `directReplies` (automatique), `keepAlive` (30 min), `ollamaUrl` (`http://127.0.0.1:11434`) ; ancien `directReads` (caché, encore lu par « Automatique ») ; `systemPrompt` (caché, vide = instructions d'origine) ; cachés, modifiés depuis la page : `model`, `whisperModel`, `voice`, `pushToTalkKey` |
| Tâche       | `install` (moteur, modèle de reconnaissance, voix, modèle Ollama, modèle des commandes) avec progression et reprise des téléchargements                                                                                                                                                                                                                                                                  |
| Permissions | `assistant` (catalogue des actions), `globalKeys` (touche globale)                                                                                                                                                                                                                                                                                                                                       |
| Service     | aucun                                                                                                                                                                                                                                                                                                                                                                                                    |

## API

| Méthode      | Route                                                        | Rôle                                                                                                                                   |
| ------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET          | `/status`                                                    | Matériel, recommandation, Ollama (version, modèles installés, capacités), moteurs et modèles, touche, réglages, installations en cours |
| GET          | `/events` (SSE, ticket)                                      | `state`, `turn`, `record` (start / stop / cancel), `speech`, `speech-end`, `speech-stop`                                               |
| GET          | `/turns`                                                     | Historique de la session                                                                                                               |
| POST         | `/listen/start` · `/listen/stop` · `/listen/cancel`          | Micro de la page                                                                                                                       |
| POST         | `/turn/audio` `{ audio }` · `/turn/text` `{ text }`          | Une demande (WAV 16 kHz en base64, ou texte)                                                                                           |
| POST         | `/turns/:id/answer` `{ yes }` · `/turns/:id/actions/:i/undo` | Oui / Non · Annuler                                                                                                                    |
| POST         | `/speech/done` · `/reset` · `/voice/test`                    | Fin de lecture · nouvelle conversation · écouter la voix                                                                               |
| POST         | `/install` `{ target, id? }` · `/install-all`                | Installations                                                                                                                          |
| PUT          | `/choices`                                                   | Modèle, reconnaissance, voix, vitesse, voix haute, réponses directes                                                                   |
| POST         | `/hotkey/capture` · `/ollama/start`                          | Changer la touche · démarrer Ollama installé                                                                                           |
| GET          | `/commands`                                                  | Commandes, phrases (module / Thomas, masquées), droits, réglages de reconnaissance                                                     |
| POST         | `/commands/test` `{ text }`                                  | Tester une phrase : commande, score, écart, paramètres, classement (rien n'est exécuté)                                                |
| POST         | `/commands/:action/phrases` `{ text, force? }`               | Ajouter une phrase (conflits renvoyés, enregistrée seulement avec `force`)                                                             |
| PUT · DELETE | `/commands/phrases/:id`                                      | Modifier (`{ text, force? }`) · supprimer une phrase de Thomas                                                                         |
| PUT          | `/commands/:action/hidden` `{ text, hidden }`                | Masquer / réafficher une phrase du module                                                                                              |
| POST         | `/commands/:action/restore` · `/commands/restore`            | Rétablir les phrases d'origine (une commande · toutes)                                                                                 |
| GET · POST   | `/commands/export` · `/commands/import` `{ file }`           | Exporter · importer le dictionnaire (ajoute, ne retire rien)                                                                           |
| PUT          | `/rights/:id` `{ granted }`                                  | Activer / désactiver un droit de l'assistant                                                                                           |
| GET · PUT    | `/prompt` · `{ text }`                                       | Instructions du modèle (d'origine, personnalisées, parties ajoutées par l'app, longueur) · les modifier (`''` = rétablir)              |

Pour les tests : `TOOLBOX_WHISPER_SERVER`, `TOOLBOX_PIPER` (chemins des moteurs), `setAssistantTestHooks` (faux modèle et faux moteurs).

## Tests

- `tests/commands.test.ts` : batterie de phrases réalistes (hésitations comprises) contre les vraies actions des modules ; phrases libres, ambiguës ou incomplètes jamais reconnues. Avec `TOOLBOX_EMBEDDINGS_DIR=<dossier du modèle>`, la même batterie tourne aussi avec les embeddings.
- `tests/assistant.test.ts` : commandes sans modèle (tâche créée sans question, IA désactivée → « pas compris » + suggestion jamais exécutée, IA activée → modèle appelé, rien sous le seuil, droits et confirmation), dictionnaire (ajout, modification, suppression, effet immédiat, conflits, masquer, rétablir, « C'était… », export / import, droits) ; puis, IA activée, avec un faux modèle et la vraie To-do :
  - ajout et annulation, réponse lue telle quelle ;
  - lecture en deux passes ou directe ;
  - suppression seulement après « oui » ;
  - refus sensible puis ouverture de la page ;
  - navigation ;
  - garde d'honnêteté, culture générale en flux ;
  - touche maintenue ou appuyée deux fois ;
  - audio trop court ou silencieux ;
  - recommandation ;
  - Ollama absent, moteurs absents.
- `tests/engines.test.ts` :
  - faux `whisper-server` et faux Piper qui parlent le même protocole ;
  - faux serveur Ollama (flux NDJSON, outils, téléchargement) ;
  - téléchargement avec reprise et empreinte, extraction ;
  - découpage en phrases, oui / non, recommandation.

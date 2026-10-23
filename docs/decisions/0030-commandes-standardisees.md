# 0030 — Commandes standardisées de l'assistant, interrupteur « IA », droits un par un

- Statut : acceptée
- Date : 2026-10-23

## Contexte

Sur le PC de Thomas (HP OmniBook 5, Core i5, pas de carte graphique), une demande passait toujours par le modèle de langage (Ollama). Résultat : environ 1 min 30 par demande, des réponses longues ou vides, et un modèle qui redemandait plusieurs fois confirmation avant de créer une simple tâche. L'assistant doit faire gagner du temps par rapport à la saisie. En parallèle, la règle « Contrôle et sécurité » (CLAUDE.md) demande que l'assistant n'obtienne ses droits de modification qu'un par un, sur décision de Thomas.

## Décision

- **Commandes standardisées, sans IA générative.** Chaque action d'un module peut déclarer des phrases d'exemple (`examples`) et un extracteur en code (`extract`) qui tire les paramètres de la phrase (titre, tags, date par le parseur de la To-do, morceau, nombre). Aides partagées dans le SDK (`packages/sdk/commands.ts`). MODULES.md §5.15.
- **Reconnaissance stricte** (`modules/assistant/backend/matcher.ts`) :
  - les valeurs des paramètres sont d'abord masquées avec l'extracteur de chaque commande (« ajoute une tâche appeler Paul » est comparée comme « ajoute une tâche … ») ;
  - score = 0,6 × sens (embeddings) + 0,4 × mots partagés (pondérés : un mot rare compte plus) ; une phrase identique vaut 1 ; un mot isolé ne suffit jamais ;
  - sans le modèle d'embeddings : les mots seuls (mode le plus strict) ;
  - exécutée seulement si score ≥ seuil (0,7 par défaut), avance ≥ écart (0,08) sur la deuxième commande, et paramètres obligatoires trouvés. Sinon : rien. Seuil et écart réglables (avancé).
- **Modèle d'embeddings** : `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (ONNX quantifié, ~120 Mo, multilingue dont le français), téléchargé sur un clic avec progression.
- **Moteur** : **onnxruntime-web** (WebAssembly) dans le processus principal, et `@huggingface/tokenizers` (JavaScript pur, bundlé). Aucun module natif : rien à recompiler pour Electron, 14 Mo dans l'installateur (seuls le build Node et son `.wasm` sont gardés). Écartés : onnxruntime-node (binaire natif ~300 Mo, script postinstall), transformers.js (dépend de `sharp`, natif). Vérifié par `npm run check:native` et le smoke test (petit modèle Identity).
- **Interrupteur « IA », désactivé par défaut.**
  - Commande reconnue → exécutée sans IA, que l'IA soit activée ou non.
  - Pas reconnue, IA activée → le modèle choisi prend le relais (fonctionnement d'avant inchangé).
  - Pas reconnue, IA désactivée → « Je n'ai pas compris ta demande. », avec « Tu voulais dire : … ? » si une commande était proche. La suggestion n'est jamais exécutée.
  - IA désactivée : Ollama n'est ni appelé ni nécessaire (pas de préchargement, pas de question à Ollama dans l'état de la page).
- **Dictionnaire modifiable** (migration 1 du module `assistant`) : les phrases de Thomas (`assistant__phrases`) et les phrases des modules masquées (`assistant__hidden_phrases`, jamais supprimées). Seules les phrases changent, jamais l'action, ses paramètres ou son risque. Conflit avec une autre commande : avertissement, enregistrement seulement après confirmation. Export / import en fichier (l'import ajoute, ne retire rien). Inclus dans « Exporter une sauvegarde » (dans `hub.db`).
- **Droits** : toute action `change` ou `destructive` déclare son propre droit, un interrupteur désactivé par défaut (section « Droits de l'assistant vocal »). Sans le droit, rien n'est exécuté, même confirmé ; l'assistant le dit en une phrase et propose d'ouvrir les droits.

- **IA simplifiée** (quand elle est activée) : instructions courtes et stables (la date à la fin, pour que le début reste en cache), le modèle ne demande jamais de confirmation ni de paramètre facultatif, au plus une question, réponse coupée à 120 jetons ; outils présélectionnés par les commandes proches (liste complète en cas de doute) ; modèle préchargé et gardé en mémoire (`keep_alive` réglable) ; « Réponses directes » automatiques sans carte graphique dédiée. Instructions modifiables par Thomas ; la sécurité ne dépend jamais d'elles.

## Conséquences

- Créer une tâche par une commande : zéro question, quelques millisecondes de reconnaissance, pas de modèle.
- Les seuils sont calibrés sur une batterie de phrases réalistes en mode « mots seuls » (`modules/assistant/tests/commands.test.ts`). Le modèle multilingue n'a pas pu être téléchargé dans l'environnement de développement (Hugging Face inaccessible) : son comportement réel et le réglage du seuil sont **à valider sur le PC de Thomas** (la page « Commandes » a « Tester une phrase » pour ça).
- Une demande formulée très différemment des exemples n'est pas reconnue : Thomas ajoute sa phrase (« C'était… » dans l'historique) ou active l'IA.

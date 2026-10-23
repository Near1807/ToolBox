# 0029 — Assistant vocal local : whisper.cpp, Ollama, Piper

- Statut : acceptée
- Date : 2026-10-23

## Contexte

Thomas veut un assistant vocal (V1) qui pilote ToolBox, avec une contrainte absolue : **100 % gratuit et local**, aucune API payante ni service cloud. Seul le téléchargement initial des modèles peut utiliser Internet. Son PC est sous Windows ; sa puissance (carte graphique ou non) n'est pas connue à l'avance.

## Décision

- **Oreilles : whisper.cpp** (`whisper-server` de la version v1.9.2, build OpenBLAS pour Windows x64), gardé lancé pour que le modèle reste chargé ; requête HTTP locale. Modèles ggml (Tiny → Large v3 Turbo q5), « Small » recommandé dès 6 fils de calcul, sinon « Base ». Alternative écartée : faster-whisper (Python à installer).
- **Cerveau : Ollama**, installé à part (gratuit, open source, démarre avec Windows, gère CPU et GPU). L'app ne l'embarque pas : installateur officiel, mises à jour faites par Ollama ; l'app guide l'installation et télécharge le modèle avec progression (`/api/pull`). Appel d'outils natif (`/api/chat` avec `tools`), réponse en flux.
- **Modèle recommandé : Ministral 3** (Mistral AI, décembre 2025 : appel d'outils natif, très bon en français), 3B sans carte graphique, 8B dès 8 Go de VRAM NVIDIA, 14B dès 12 Go. Alternatives : Qwen 3.5, Mistral Small 3.2, ou tout modèle saisi. Les étiquettes n'ont pas pu être vérifiées sur ollama.com (inaccessible depuis l'environnement de développement) : l'app vérifie après le téléchargement qu'Ollama déclare la capacité « tools ». Un modèle sans outils répond quand même (sans agir) et le dit.
- **Voix : Piper** (binaire autonome 2023.11.14-2 de rhasspy/piper, archivé en octobre 2025 ; la suite OHF-Voice/piper1-gpl n'existe qu'en Python). Voix françaises de rhasspy/piper-voices (même format). Un processus gardé lancé : une phrase par ligne → un WAV par phrase, lu dès qu'il est prêt (la lecture commence à la première phrase).
- **Honnêteté imposée par le code** :
  - après une modification, la phrase dite est le message de l'action ;
  - une suppression attend un « oui » reconnu par le code ;
  - une phrase qui prétend une action sans résultat d'outil n'est jamais dite ;
  - les dates et les noms approximatifs sont résolus par les modules, pas par le modèle.
- **Performances** :
  - le prompt système ne change qu'une fois par heure (l'heure arrondie), pour que le cache d'Ollama reste valable ;
  - les instructions et les outils sont lus une fois au démarrage (« warmup ») ;
  - une réponse est limitée à 400 jetons et un échange à 2 minutes ;
  - option « Réponses directes » pour sauter la seconde passe du modèle après une lecture.
- **Sécurité** : les téléchargements passent par les URL officielles (GitHub, Hugging Face), avec reprise, et SHA-1 vérifié quand le projet le publie. Les archives sont extraites sans jamais écrire hors du dossier. Le micro est la seule permission matérielle de l'interface.
- **Mémoire** : historique et contexte de la conversation en mémoire seulement, oubliés à la fermeture ; aucune table.

## Conséquences

- Testé ici :
  - avec de faux moteurs (même protocole) et un faux modèle ;
  - avec les vrais binaires `whisper-server` 1.9.2 et Ollama 0.32.15 de conda-forge (Linux), et un petit modèle de test sans outils.
- Les modèles de la recommandation (Ministral 3, Whisper Small, voix Siwis) n'ont **pas** pu être téléchargés ici : non testés en réel.
- Sans carte graphique, la liste des outils (21 actions, ~2 400 jetons) peut coûter plusieurs dizaines de secondes si le modèle la relit à chaque échange (selon où son modèle de prompt place les outils) : à mesurer chez Thomas, latences affichées.
- V2 envisagée : mot de réveil, recherche Internet, briefing du matin, cerveau interchangeable (ROADMAP).

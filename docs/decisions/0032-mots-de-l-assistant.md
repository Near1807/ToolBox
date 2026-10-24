# 0032 — Mots de l'assistant : mots attendus, corrections, surnoms, noms au son

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Tests réels de Thomas (v0.17) : la transcription est forcée en français, donc les mots anglais et les noms propres sont mal écrits (« ouvre la to-do » → « ouvre la tout doux », « Obsidian » → « obsidienne »). Le carnet de phrases ne peut pas corriger ça : « to-do » est la **cible** de la commande, pas une phrase. Une commande reconnue dont le paramètre ne correspond à rien donnait « Je n'ai pas compris ta demande », sans dire ce qui manquait.

## Décision

- **Mots attendus** : à chaque enregistrement, l'assistant envoie à whisper.cpp un « prompt initial » (champ `prompt` de `/inference`, vérifié dans le code du serveur whisper.cpp 1.9). Il contient, dans cet ordre et coupé à environ 700 caractères (whisper en lit au plus ~220 jetons) :
  - « ToolBox » ;
  - la liste de mots anglais et du métier, **modifiable** (préremplie : to-do, mix, master, drop, Reel, Short, sidechain, preset…) ;
  - les noms des outils et leurs surnoms ;
  - le nom d'artiste ;
  - les titres et surnoms des morceaux ;
  - les tags.

  Il est recalculé à chaque fois, donc à jour quand la Bibliothèque change. La langue reste le français.

- **Corrections** (« quand l'oreille écrit X, comprendre Y ») : appliquées juste après la transcription, avant la reconnaissance, sur des **mots entiers**, sans tenir compte de la casse ni des accents. Les transcriptions brute et corrigée sont toutes deux visibles dans l'historique ; le bouton « Corriger » y crée une correction. La saisie au clavier n'est jamais corrigée.
- **Surnoms** :
  - des outils et des pages : données de l'assistant, transmises au socle par `ctx.assistant.setToolNicknames` pour « ouvre … » ;
  - des morceaux : `Track.nicknames` dans la Bibliothèque (migration 3), modifiables sur la fiche du morceau.
- **Noms comparés aussi au son** (`phoneticKey`, SDK) : une clé phonétique française simple (ph→f, qu→k, c/g doux, eau/au→o, nasales, lettres finales muettes…). Le même son compte presque comme la même écriture (0,95) ; l'ambiguïté est toujours signalée.
- **Valeur introuvable** : `NotFoundError` dans le SDK, transmise par le registre (`notFound` dans le résultat). L'assistant demande « Tu voulais dire « X » ? », et « oui » relance la même action.
- **Deux commandes trop proches** : « Tu voulais dire : A ou B ? » (voix ou boutons). La réponse exécute celle choisie, puis l'assistant propose « Je retiens « phrase » pour B ? » ; la phrase est ajoutée seulement sur « oui », avec la vérification des conflits.
- **Données** : migration 2 du module `assistant` (`assistant__corrections`, `assistant__words`, `assistant__nicknames`, préremplies), incluses dans l'export du dictionnaire (format version 2) et dans « Exporter une sauvegarde ».

## Conséquences

- L'effet réel des mots attendus sur la transcription n'a pas pu être mesuré dans l'environnement de développement (aucun modèle whisper téléchargeable) : **à vérifier sur le PC de Thomas**. Une correction reste toujours possible.
- La clé phonétique est volontairement grossière : elle sert à comparer deux noms, jamais à écrire.

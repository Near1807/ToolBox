# 0037 — Barre de commande écrite de l'assistant : même chemin que la voix, touche partagée possible

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Thomas veut pouvoir écrire une commande à l'assistant sans quitter FL Studio et sans afficher ToolBox : une barre flottante, ouverte par une touche (ou une combinaison) de son choix, en appui simple ou en double appui, éventuellement la même touche que le micro.

## Décision

- **La barre est un panneau `focus` de la fenêtre flottante partagée** (ADR 0036) : elle seule fait prendre le clavier à cette fenêtre, et seulement sur le geste de Thomas ; Échap ou la fin d'une réponse rendent le clavier.
- **Même chemin que la voix sans la transcription** : le texte passe par les corrections du dictionnaire (« Mots »), puis la même fonction que la voix (commandes standardisées, IA si activée, droits, confirmations, annulation). Seule différence : la réponse s'affiche et n'est lue à voix haute qu'avec le réglage « Lire aussi la réponse à voix haute », désactivé par défaut. La zone de texte de la page reste, elle, sans corrections (inchangé).
- **Désactivée par défaut** : aucune touche choisie tant que Thomas n'en capture pas une.
- **Le socle gère les combinaisons et plusieurs touches par module** (`ctx.hotkeys`, `modifiers`, `name`). Les codes des modificateurs sont ceux de libuiohook (les deux côtés).
- **Gestes séparés dans l'assistant** (`backend/gestures.ts`, fonction pure testée avec une fausse horloge) : en « Double appui » sur la touche du micro, le micro démarre au premier appui (pour ne rien perdre en parlant tout de suite) et l'enregistrement est jeté si un second appui arrive dans le délai. En « Appui simple » sur la même touche, un appui court ouvre la barre et le micro n'est plus qu'en maintien : ce n'est pas fiable avec une touche qui envoie son relâchement tout de suite, donc les réglages l'affichent comme avertissement et recommandent « Double appui ».

## Conséquences

- Aucune action nouvelle, aucun droit nouveau : la barre ne fait que ce que la voix fait déjà, sous les mêmes règles.
- Pendant le délai du double appui, un appui court seul sur une touche partagée laisse le micro ouvert (mode « appuyer pour finir ») : rien n'est envoyé avant le second appui ou la fin de l'enregistrement.
- Le retour du clavier à l'application d'en dessous sous Windows reste à confirmer sur le PC de Thomas (non vérifiable dans le conteneur).

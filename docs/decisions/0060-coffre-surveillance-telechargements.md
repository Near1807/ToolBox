# 0060 — Coffre : proposer de ranger les nouveaux téléchargements (désactivé par défaut)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/coffre/CAHIER-DES-CHARGES.md` (règle 9), CLAUDE.md « Livré désactivé »

## Contexte

Ce que Thomas télécharge (cours, énoncés, factures) finit dans Téléchargements et y reste. Il veut que le Coffre le lui **propose**, sans jamais rien faire seul.

## Décision

- Réglage « Proposer de ranger mes nouveaux téléchargements », **désactivé par défaut** (Réglages › Coffre) ; dossier modifiable (vide : `Téléchargements` du compte) ; notification Windows à part, désactivée par défaut.
- **Lecture seule** du premier niveau du dossier, toutes les 3 s pendant que c'est activé. Jamais d'écriture, de déplacement ni de suppression dans ce dossier.
- **Seulement après l'activation** : à l'activation (ou au changement de dossier), un instantané marque ce qui est là (« d'avant ») ; ce n'est jamais proposé, sauf à la demande (« Proposer aussi les fichiers déjà présents » : une fois, une liste à cocher, puis la fenêtre de rangement).
- **Téléchargement en cours** : `.crdownload`, `.part`, `.partial`, `.tmp`, `.download`, `.opdownload` ignorés ; un nouveau fichier n'est proposé qu'une fois sa taille et sa date inchangées pendant 3 s (et lisible : sinon au tour suivant).
- **Déjà dans le Coffre** (même empreinte SHA-256) : écarté.
- **Aucun dépôt automatique** : un compteur (« 3 nouveaux téléchargements ») sur l'accueil du Coffre et dans la barre latérale ; « Ranger » ouvre la fenêtre de rangement (les règles du dépôt : copie, original intact, doublons) ; « Ignorer » ne le propose plus. Rangé : plus proposé.
- État par fichier dans `coffre__downloads` (migration 4, ajout seulement) : état **de ce PC**, ni synchronisé ni journalisé. Un fichier qui disparaît du dossier est oublié.

## Conséquences

- Actions sans clic de Thomas : la lecture du dossier et l'écriture de cet état (activées seulement par Thomas). Listées dans le rapport.
- Les sous-dossiers de Téléchargements ne sont pas regardés.

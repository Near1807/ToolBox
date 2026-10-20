# Pack Instagram (`instagram-video`)

Pour chaque morceau de la Bibliothèque, un **pack Insta** prêt à publier à la main, étalé dans le temps :

- **4 Reels** verticaux 9:16 (1080×1920) de 25–30 s (28 s par défaut), sur 4 extraits **différents**, chacun dans **un style différent** ;
- **1 image de post** 4:5 (1080×1350, JPEG haute qualité) ;
- **une légende** modifiable (et, en option, une légende par Reel).

Les Reels servent aussi de YouTube Shorts.

## Ce qu'il fait

1. **« Générer le pack Insta »** : l'app choisit 4 extraits sans chevauchement, en privilégiant les passages les plus énergiques (RMS) et en évitant l'intro et l'outro (8 % du morceau, entre 5 et 15 s). Le Reel 1 est le passage le plus fort. Rien n'est encore rendu.
   - Morceau trop court pour 4 : avertissement, avec le choix entre **moins de Reels** ou **un léger chevauchement** (30 % au plus).
2. **Avant le rendu**, les extraits sont affichés en couleur sur la forme d'onde :
   - on **glisse** un extrait, ou on clique pour y placer l'extrait choisi, ou −1 s / +1 s ;
   - **« Écouter »** joue l'extrait, **« Aperçu vidéo »** rend 6 s en basse résolution ;
   - « Proposer d'autres extraits » relance le choix automatique (les Reels déjà publiés restent fixes) ;
   - la durée d'un Reel se change pour tout le pack.
3. **« Lancer le rendu du pack »** : une tâche par fichier (progression, annulation dans Tâches).
   - Reels : un style par Reel, sans visualisation audio (elle reste la signature de YouTube) : Reel 1 **« Révélation »** (gros plan sur un détail de la cover, dézoom lent jusqu'à l'image entière), Reel 2 **« Coupes sur le rythme »** (4 à 6 cadrages de la cover, changement de plan sur les temps forts), Reel 3 **« Phrase d'accroche »** (grand texte court dès la 1re seconde, qui disparaît en fondu), Reel 4 **« Ambiance »** (cover plein écran, poussières, grain, fine barre de progression). Chaque style se change par un **menu déroulant** sur la vignette du Reel, puis « Régénérer » ce Reel seul. La phrase d'accroche est préremplie depuis une liste des réglages et modifiable par Reel.
   - Communs : titre + artiste discrets, zones de sécurité Instagram respectées (350 px en bas, 150 px à droite), accroche dès la 1re image, fondu de sortie 0,5 s, son limité à -1 dBTP (détails : README du moteur vidéo).
   - Post : même fond, cover centrée aux coins arrondis avec ombre, titre + artiste, mention discrète réglable (« Nouveau son » par défaut).
4. **Fichiers du pack** : chaque vignette se **glisse vers une autre fenêtre** (Instagram dans le navigateur, l'Explorateur…). Boutons Lire/Voir, Dossier, **« Régénérer »** (ce fichier seul) et « Ouvrir le dossier » du pack. Un Reel dont on a changé l'extrait, le style ou la phrase après le rendu est marqué **« À régénérer »**.
5. **Supprimer** : bouton « Supprimer » sur chaque fichier, sélection multiple (case sur la vignette) puis « Supprimer la sélection », et **« Supprimer le pack »** (tous ses fichiers et le pack lui-même). Toujours avec confirmation ; les fichiers partent dans la **Corbeille**. Un fichier supprimé redevient « À générer » (extrait, style et phrase conservés). Un fichier effacé ou déplacé dans l'Explorateur s'affiche **« Fichier introuvable »** avec « Retirer de la liste » ou « Régénérer », et « Nettoyer les éléments introuvables ». Les anciens Reels (v0.5) se suppriment aussi.
6. **Légende** : préremplie depuis le modèle des réglages, librement modifiable, enregistrée, bouton « Copier ». Option « Une légende différente par Reel » (préremplies avec la principale). « Repartir du modèle » la recalcule.
7. **Suivi de publication** : case **« Publié »** sur chaque élément (post + Reels 1 à 4). La date est notée automatiquement, modifiable, et la case peut être décochée. La page **« À publier »** liste tout ce qui est généré et pas encore publié, tous morceaux confondus, avec la vignette, la légende à copier et le glisser-déposer. L'état du pack (« 2/5 publiés ») s'affiche dans la liste des morceaux et sur la fiche du morceau de la Bibliothèque.

Fichiers écrits dans `<dossier de sortie>/instagram-video/<Artiste - Titre>/` : « `<titre> - Reel 1.mp4` » … « `<titre> - Reel 4.mp4` » et « `<titre> - Post.jpg` ». Régénérer remplace le fichier sous le même nom ; l'état « Publié » est conservé (supprimer le fichier l'efface). **Le suivi est dans la base, jamais dans les fichiers.** Chaque fichier est enregistré dans `ctx.outputs` (ref `item:<id>`, parent `pack:<id>`, sujet `music-library:track:<id>`) : il apparaît aussi sur la fiche du morceau et dans « Fichiers générés ».

## Données

| Élément           | Détail                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables            | `instagram_video__packs` (un par morceau : durée des Reels, légende, option légende par Reel, dossier) et `instagram_video__pack_items` (post = position 0, Reels 1–4 : extrait, légende propre, fichier, miniature, dernier rendu, erreur, date de publication) — migration 2 ; style, phrase d'accroche et style/phrase du dernier rendu — migration 3 |
| Table historique  | `instagram_video__reels` (migration 1) : Reels faits avant les packs (v0.5), conservés et listés sous « Anciens Reels »                                                                                                                                                                                                                                  |
| Fichiers          | Packs dans `<dossier de sortie>/instagram-video/` · miniatures `<userData>/modules/instagram-video/thumbnails/` · cache d'analyse `analysis/<id>.json` (recalculé si le son change)                                                                                                                                                                      |
| Réglages          | `clipDuration` (15–60, 28 par défaut), `captionTemplate` (repères `{titre}`, `{artiste}`, `{hashtags}`), `hashtags`, `hookPhrases` (phrases d'accroche, une par ligne), `badge` (mention du post)                                                                                                                                                        |
| Tâche             | `render-item` `{ itemId }` (un fichier du pack)                                                                                                                                                                                                                                                                                                          |
| Événements émis   | `instagram-video:video.created` et `instagram-video:post.created` `{ trackId, file }`                                                                                                                                                                                                                                                                    |
| Info bibliothèque | « Pack Instagram : x/5 publiés » via `musicLibrary.registerTrackInfo`                                                                                                                                                                                                                                                                                    |

L'analyse décode le son en mono 8 kHz avec FFmpeg (pics et RMS par fenêtre de 0,1 s). Le choix des extraits (`pickExcerpts`) et la légende sont des fonctions pures et testées (`backend/analysis.ts`, `backend/caption.ts`).

## Dépendances

Modules `music-library` et `video-engine` ; services `musicLibrary` (morceaux, fichiers générés, ligne d'info) et `videoEngine` (`render` avec `fadeSeconds`, `renderPost`, `preview`).

## API

| Méthode | Route                                   | Rôle                                                                              |
| ------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| GET     | `/tracks`                               | Morceaux, avec l'état de leur pack                                                |
| GET     | `/tracks/:id`                           | Morceau, URL du son, pack complet (ou `null`), anciens Reels                      |
| GET     | `/tracks/:id/waveform?clip=28`          | Forme d'onde (400 barres) et nombre d'extraits possibles (distincts / chevauchés) |
| POST    | `/tracks/:id/pack`                      | Crée le pack : `{ clipDuration?, count?, allowOverlap? }`                         |
| PATCH   | `/packs/:id`                            | `{ caption?, clipDuration?, perReelCaptions? }`                                   |
| POST    | `/packs/:id/caption/reset`              | Légende recalculée depuis le modèle                                               |
| POST    | `/packs/:id/suggest`                    | Nouveaux extraits automatiques (Reels non publiés)                                |
| POST    | `/packs/:id/render`                     | Rend tout ce qui est à faire (nouveau, à régénérer, en échec, introuvable)        |
| POST    | `/packs/:id/open-folder`                | Ouvre le dossier du pack                                                          |
| DELETE  | `/packs/:id`                            | Supprime le pack et ses fichiers (Corbeille)                                      |
| PATCH   | `/items/:id`                            | `{ startSec?, caption?, style?, hookText?, published?, publishedAt? }`            |
| POST    | `/items/:id/preview`                    | Aperçu de 6 s d'un Reel                                                           |
| POST    | `/items/:id/render`                     | « Régénérer » ce fichier seul                                                     |
| POST    | `/items/:id/open` · `/items/:id/reveal` | Ouvre le fichier / le montre dans l'Explorateur                                   |
| GET     | `/to-publish`                           | Éléments générés et non publiés, tous morceaux                                    |
| POST    | `/reels/:id/open` · `/reels/:id/reveal` | Anciens Reels (v0.5)                                                              |

## Plus tard

Stories ; publication directe via l'API Instagram (voir `docs/ROADMAP.md`).

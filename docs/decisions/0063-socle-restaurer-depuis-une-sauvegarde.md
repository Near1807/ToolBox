# 0063 — Socle : restaurer ToolBox depuis une sauvegarde (au redémarrage, avec retour automatique)

- Statut : acceptée (v0.47.0, marqué « Expérimental »)
- Date : 23/11/2026
- Référence : `docs/WINDOWS.md` (Sauvegardes et restauration), ADR 0044 (synchro), ADR 0055 (disque du coffre)

## Contexte

Jusqu'ici, restaurer `hub.db` se faisait à la main, app fermée (WINDOWS.md). Le disque du coffre garde une copie de la base (`ToolBox-Coffre/_ToolBox/Base/hub.db`) et les sauvegardes automatiques sont dans `backups/`. Thomas veut le faire depuis l'app, sans risque.

## Décision

- **Réglages › Sauvegardes › Restaurer ToolBox depuis une sauvegarde** : une sauvegarde automatique, ou un fichier choisi.
- **Aperçu en lecture seule** (base ouverte en lecture seule, `quick_check`) : date du fichier, version de ToolBox qui l'a ouverte en dernier (`core__meta.app_version`, écrite à chaque démarrage à partir de v0.47.0 ; « inconnue » avant), modules (dernière migration) et nombre d'éléments par module (lignes non supprimées, journaux et tables dérivées exclus).
- **Plus récente : refusée** — une migration que ce ToolBox ne connaît pas, ou une version de l'app plus haute ; le message dit de mettre ToolBox à jour. **Plus ancienne** : acceptée ; les migrations normales la mettent à jour au démarrage (avec leur sauvegarde, comme toujours).
- **Confirmé** : la base actuelle est sauvegardée (`backups/hub-…-avant-restauration.db`) ; une copie cohérente de la sauvegarde est mise de côté (`restore/pending.db`, `VACUUM INTO`) ; **rien n'est remplacé pendant que ToolBox tourne**. « Annuler la restauration » possible jusqu'au redémarrage ; « Redémarrer maintenant » proposé.
- **Au démarrage, avant d'ouvrir la base** (`Hub.create`) : la base actuelle va dans `restore/before.db`, la copie prend sa place. Si l'ouverture, les migrations du socle ou **une migration d'un module** échouent : la base d'avant revient (`before.db`), ToolBox redémarre sur elle, le résultat (raison comprise) est affiché dans les Réglages. Réussite : `before.db` est retiré (la sauvegarde automatique reste).
- **Synchro avec le téléphone** : après une restauration, le PC et le téléphone ne sont plus d'accord sur ce que chacun a vu (numéros des journaux, curseurs). Un échange ordinaire perdrait des changements (vérifié par un test : ceux du téléphone après la copie et ceux du PC que seul le téléphone avait encore). Le PC remet donc chaque téléphone en « **première synchro à faire** » (`first_sync_at` à vide, curseurs à zéro) : le téléphone s'arrête et propose sa première synchro avec aperçu ; en « Fusionner », les instantanés des deux appareils sont réunis par leurs horloges : les changements plus récents du téléphone reviennent, sans doublon (mêmes UUID) ni perte (test `tests/sync/restore-sync.test.ts`). Le PC reste maître des règles. En plus, chaque journal du PC reprend sa numérotation au-dessus de la plus haute d'avant (une ligne repère sans horloge, jamais envoyée).
- Un téléphone appairé après la copie n'est pas connu de la base restaurée : il faudra l'appairer à nouveau.
- **Le Coffre** : si la base restaurée a des éléments dont le fichier n'est pas sur ce PC et qu'un disque est enregistré, l'accueil du Coffre propose d'enchaîner « Restaurer le Coffre depuis le disque » (ADR 0055).

## Conséquences

- Aucune donnée supprimée sans confirmation : la base remplacée reste dans les sauvegardes automatiques.
- Les fichiers des modules (`modules/`, `coffre/`) ne sont pas restaurés par cette action (seulement la base) : le Coffre les reprend depuis son disque.

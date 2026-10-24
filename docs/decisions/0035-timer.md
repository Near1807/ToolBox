# 0035 — Timer : temps tiré de l'heure réelle, une seule session, To-do facultative

- Statut : acceptée
- Date : 2026-10-24

## Contexte

Thomas veut un timer (section Outils) pour briser la barrière du démarrage : un timer simple, des sessions avec pauses (pomodoro) et surtout un pomodoro **incrémental** (périodes de travail très courtes au début, puis plus longues, pauses constantes). Le timer doit continuer quand il change de page, reprendre correctement après une fermeture de l'app, rester visible app réduite, et se lier à une tâche de la To-do sans en dépendre. Inspiration : le timer de son app GameLife (un clic pour lancer, anneau, question « Oui / Non » à la fin, temps mesuré par le serveur).

## Décision

- **Nouveau module `timer`**, sans dépendance obligatoire. Il fournit le service `timer` (temps passé par tâche) ; la To-do fournit désormais le service `todo` (lister, retrouver, cocher). Les deux s'utilisent l'un l'autre **en facultatif**, demandé au moment de l'utiliser (MODULES.md §5.8).
- **Le programme est une liste de phases** calculée par une fonction pure (`shared/plan.ts`, testée) : simple, pomodoro (cycles ou durée totale, pause longue facultative tous les N cycles), incrémental (départ, +X min ou +X % par cycle, plafond, pause constante). Avec une durée totale, la dernière période est raccourcie pour finir à l'heure si au moins 5 min restent ; une session ne finit jamais sur une pause.
- **Le temps vient d'horodatages, jamais d'un compteur** : la base garde l'heure de la dernière reprise et le temps actif déjà compté. L'état (phase, temps restant) se calcule à tout instant depuis l'heure réelle, des deux côtés (backend et interface). Après une fermeture, la session est donc juste au relancement ; les changements de phase manqués pendant la fermeture ne sont pas notifiés après coup (plus d'une minute de retard).
- **Le backend mène la session** : un minuteur se réarme sur la fin de la phase en cours (au plus une minute d'attente). À chaque transition, il envoie une notification Windows (réglable) et un événement aux pages ouvertes (flux SSE). Le son est **synthétisé** dans le composant `Background` de la fenêtre principale (une seule fois, aucun fichier audio). Une **seule session** active à la fois.
- **Mini-timer** : l'indicateur flottant du socle (`ctx.ui.setOverlay`, partagé avec l'assistant), affiché pendant une session (réglage « Mini-timer flottant »). La zone de notification n'est pas utilisée (pas d'API générique du socle pour son texte).
- **« Tâche terminée ? »** : la session finie attend la réponse (même après un redémarrage). « Oui » coche la tâche par le service `todo` : c'est le clic de Thomas. « Non » propose de relancer (même programme ou autre durée) ou « Plus tard ».
- **Assistant** : « combien de temps il reste » en lecture ; lancer, lancer un préréglage, pause, reprendre, arrêter, passer la pause derrière **un seul droit propre au Timer**, désactivé par défaut (« L'assistant peut piloter le timer »). Le Timer n'a aucune action qui coche une tâche : cela reste sous le droit de la To-do. Un préréglage n'est reconnu que par le nom d'un préréglage qui existe (sinon « lance la synchronisation des stats » serait pris pour un préréglage).

## Conséquences

- Aucune dérive : un timer laissé en pause ou une app fermée pendant des heures reprend juste, et les secondes affichées sont recalculées depuis l'heure, pas accumulées.
- Le temps passé par tâche est la somme des périodes de travail réellement écoulées (session finie ou arrêtée), visible dans le Timer et sur la tâche dans la To-do.
- La To-do expose maintenant un service ; `completeTask` ne doit être appelé que sur un clic de l'utilisateur dans le module appelant (écrit dans son contrat).

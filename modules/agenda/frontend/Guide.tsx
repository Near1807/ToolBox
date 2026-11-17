// The Agenda's built-in guide (short): the two kinds of items, the bar and
// its examples, planning a task (drag, stretch), the load, the category
// switches.
import { Link } from 'react-router';
import { Card, Icon, Page } from '@hub/sdk/frontend';

const EXAMPLES: [string, string][] = [
  ['dentiste jeudi 14h 1h', 'un rendez-vous jeudi de 14:00 à 15:00'],
  ['réunion staff mardi 20h', 'mardi 20:00–21:00 (1 h si rien n’est dit)'],
  ['cours de solfège de 18h à 19h30 lundi', 'de 18:00 à 19:30'],
  ['week-end scout 13-15 février', 'sur trois jours, toute la journée'],
  ['examen math 18 janvier #examens', 'toute la journée, catégorie « Examens »'],
  ['badminton tous les jeudis 19h 2h', 'dans la semaine type, chaque jeudi'],
  ['préparer la réunion ~1h avant vendredi', 'une tâche de la To-do, à caser'],
  ['réviser stats ~2h mercredi 14h', 'une tâche de la To-do prévue mercredi 14:00, ~2 h'],
];

export function GuidePage() {
  return (
    <Page title="Agenda : le guide" subtitle={<Link to="/m/agenda">← Retour à l’agenda</Link>}>
      <Card title="Deux sortes de choses, chacune à sa place">
        <p>
          <strong>Les événements</strong> ont une heure (le dentiste jeudi à 14 h) ou durent toute
          la journée, parfois plusieurs jours (un camp, les examens) : ils vivent dans l’Agenda.
        </p>
        <p>
          <strong>Les choses à faire sans heure</strong> sont les tâches de la To-do. L’Agenda les
          montre dans « À caser » avec leur échéance et leur durée estimée, sans en faire une
          deuxième liste. Une chose à caser écrite dans la barre devient une tâche de la To-do.
        </p>
        <p>
          La <strong>semaine type</strong> garde ce qui revient chaque semaine (cours,
          entraînements). Une seule fois peut être annulée ou déplacée : clique sur elle dans la
          semaine.
        </p>
      </Card>
      <Card title="La barre">
        <p>Écris comme tu parles, puis Entrée. L’aperçu montre ce qui sera ajouté avant.</p>
        <table className="ag-guide">
          <tbody>
            {EXAMPLES.map(([text, what]) => (
              <tr key={text}>
                <td>
                  <code>{text}</code>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Règles : « ~ » devant une durée en fait une tâche de la To-do : une heure à la fin est
          alors son heure prévue, « avant … » ou un jour seul son échéance. Sans « ~ », une heure
          fait un événement à cette heure, une date seule un événement sur la journée, rien de daté
          une tâche à caser. La date et les heures viennent après le titre. « #cours » donne la
          catégorie.
        </p>
      </Card>
      <Card title="Prévoir une tâche, déplacer, étirer">
        <p>
          <strong>Glisse</strong> une tâche de « À caser » sur la semaine : elle est prévue ce
          jour-là à cette heure (au quart d’heure près), pour sa durée estimée (30 min si elle n’en
          a pas). Tu peux aussi écrire l’heure dans la To-do (« Prévu le … à … ») ou dans la barre.
        </p>
        <p>
          <strong>Glisse un bloc</strong> pour changer son heure ou son jour ;{' '}
          <strong>tire son bas</strong> pour changer sa durée (15 min au moins ; pour une tâche,
          c’est sa durée estimée qui change). Pendant le glisser, l’heure de début et de fin
          s’affiche ; <strong>Échap</strong> annule. Rien n’est enregistré avant de lâcher, et «
          Annuler » remet comme avant pendant quelques secondes.
        </p>
        <p>
          Une occurrence de la semaine type ne bouge que <strong>cette fois-ci</strong> ; toutes les
          semaines se changent dans « Semaine type ». Les séances de sport, les repas, le Timer et
          la musique ne se déplacent pas ici : un clic les ouvre dans leur outil.
        </p>
        <p>
          Clic sur une tâche prévue : son jour, son heure, sa durée, et{' '}
          <strong>« Retirer de l’agenda »</strong> (elle revient dans « À caser »). C’est la même
          tâche que dans la To-do : la changer d’un côté la change de l’autre, sur le PC et le
          téléphone. Cochée, elle reste visible, barrée. Prévue après son échéance (et pas encore
          faite), elle est signalée. Sur le téléphone, on change l’heure et la durée par ce détail.
        </p>
      </Card>
      <Card title="Agir sur place">
        <p>
          <strong>Clic sur une tâche</strong> (prévue ou à caser) : sa fiche complète, celle de la
          To-do — titre, tags, échéance, durée, heure prévue, morceau ; « Faite », « Retirer de
          l’agenda », « Supprimer ». Chaque changement se voit tout de suite dans la To-do, avec «
          Annuler ».
        </p>
        <p>
          <strong>Cocher</strong> : clic sur le bloc, puis la case <strong>« Faite »</strong> en
          haut de la fiche (« À refaire » pour revenir en arrière), « Annuler » juste après. Les
          blocs n’ont plus de case : une tâche faite est barrée et atténuée.
        </p>
        <p>
          <strong>Clic sur un créneau vide</strong> (ou glisser sur une plage vide) : écris un
          titre, puis <strong>Tâche</strong> (Entrée : une tâche de la To-do prévue là) ou{' '}
          <strong>Rendez-vous</strong>. Échap annule ; rien n’est créé avant. Sur le téléphone,
          touche un créneau « Libre » dans la vue jour.
        </p>
        <p>
          Un rendez-vous se modifie directement dans son panneau (tous les champs), « Annuler »
          après l’enregistrement.
        </p>
      </Card>
      <Card title="Lancer un timer">
        <p>
          Dans la fiche d’une tâche ou le panneau d’un rendez-vous :{' '}
          <strong>Lancer un timer</strong>, puis la durée du bloc, un pomodoro ou un de tes
          préréglages. Sur une tâche, le timer lui est lié : « Tâche terminée ? » la coche à la fin.
        </p>
        <p>
          Coche « Associer ce choix » : ensuite, un clic sur « Lancer : … » suffit. Si un timer
          tourne déjà, il est nommé et n’est arrêté qu’après ta confirmation. Le bloc dont le timer
          tourne porte une petite icône.
        </p>
      </Card>
      <Card title="La charge et le temps libre">
        <p>
          Sous chaque jour, une barre découpée par catégorie : les heures de tes événements dans la
          journée (7 h – 23 h par défaut, réglable dans Réglages › Agenda), les tâches prévues et
          les durées estimées des tâches à rendre ce jour-là (une tâche en retard compte
          aujourd’hui), pour les catégories allumées seulement. <strong>Léger</strong> sous la
          moitié de la journée, <strong>chargé</strong> jusqu’à 85 %, <strong>saturé</strong>{' '}
          au-delà.
        </p>
        <p>
          En haut : les heures <strong>libres</strong> de la semaine et les heures{' '}
          <strong>à caser</strong> (tâches à rendre cette semaine), plus les tâches sans durée. Deux
          blocs en même temps sont signalés.
        </p>
      </Card>
      <Card title="Les catégories : allumées ou éteintes">
        <p>
          Chaque catégorie (Rendez-vous, Cours, Tâches, Sport, Repas…) a sa couleur et son
          interrupteur en haut de la semaine. <strong>Allumée</strong> : elle est affichée{' '}
          <strong>et comptée</strong> dans la charge, le temps libre et les chevauchements.{' '}
          <strong>Éteinte</strong> : ni affichée, ni comptée.
        </p>
        <p>
          Au départ, les choses de tous les jours sont <strong>éteintes</strong> : Sport, Repas (les
          repas prêts, qu’on n’organise pas) et Timer. L’Agenda, les Tâches, la{' '}
          <strong>Cuisine</strong> (les séances de batch cooking des Courses, à caser dans la
          journée) et la Musique sont allumés. Le bilan de la semaine dit ce qui n’est pas compté («
          hors Sport, Repas, Timer »). Tes choix restent sur cet appareil ; la liste de départ se
          change dans Réglages › Agenda.
        </p>
        <p>
          Un élément d’un autre outil (une séance de sport, un repas) s’ouvre dans cet outil ; un
          événement de l’Agenda ou une tâche prévue montre son détail.
        </p>
      </Card>
      <Card title="Facultatif">
        <p>
          Un cours ou un rendez-vous où tu n’iras pas, ou qui n’est pas important : ouvre-le et
          coche <strong>« Facultatif »</strong>. Il reste affiché à sa place, atténué et hachuré,
          mais il ne compte plus : ni <Icon name="warning" /> ni contour orange quand il en
          chevauche un autre, et il ne pèse ni dans la charge ni dans le temps libre. Deux éléments
          qui comptent et se chevauchent restent signalés : ce sont les vrais conflits.
        </p>
        <p>
          C’est un choix par élément (une seule séance d’un cours répété), sur le PC et le
          téléphone, avec « Annuler ». Un nouvel import de l’horaire ne le change jamais. Pas pour
          les tâches (on les déplace) ni pour ce qui vient des autres outils.
        </p>
      </Card>
      <Card title="Importer un horaire">
        <p>
          <Link to="/m/agenda/import">Agenda › Importer</Link> (sur le PC) lit un calendrier{' '}
          <strong>.ics</strong> (l’export d’un horaire d’école, d’Outlook, de Google Agenda) ou un
          tableau <strong>.csv</strong> / <strong>.xlsx</strong> (le tableau est encore{' '}
          <span className="badge badge--warning">Expérimental</span>). Rien ne part en ligne et rien
          n’est écrit avant l’aperçu.
        </p>
        <p>
          Chaque valeur de catégorie du fichier va dans une catégorie de l’Agenda : par exemple « H
          » → Cours et « X » → Examens. L’interrupteur « Cours » cache alors les cours, sans les
          compter. Les cours répétés sont dépliés en séances ordinaires.
        </p>
        <p>
          L’aperçu dit ce qui sera <strong>ajouté</strong>, ce qui est <strong>identique</strong>,
          ce qui a <strong>changé</strong> (avec les différences), ce qui a <strong>disparu</strong>{' '}
          du fichier, ce qui est <strong>ignoré</strong> (le passé) et les <strong>erreurs</strong>.
          Un événement que tu as modifié depuis le dernier import est marqué « modifié par toi » et
          décoché ; un disparu n’est supprimé (restaurable) que si tu le coches. Réimporter le même
          fichier ne crée aucun doublon.
        </p>
        <p>
          Les sources se gèrent dans Réglages › Agenda : renommer, changer les catégories,
          réimporter, supprimer (restaurable). Le téléphone reçoit les événements importés par la
          synchro.
        </p>
      </Card>
      <Card title="Nom · lieu, aperçu, fiche à droite (Expérimental)">
        <p>
          Un bloc montre <strong>« Titre · Lieu »</strong> (« Computer Network Lab · 2F51 ») : le
          lieu est coupé par « … » avant le titre quand la place manque, et seules les deux
          premières salles d’un import sont écrites (« 2F51, 2E51… »). Rien n’est écrit : c’est
          l’affichage.
        </p>
        <p>
          Sur le PC, <strong>pose la souris</strong> un instant sur un bloc (ou une tâche « À caser
          ») : une petite carte dit tout — titre complet, jour et heures, lieu complet, catégorie,
          note, facultatif, code et source d’un import, état d’une tâche, outil d’un élément
          d’ailleurs. Elle part quand la souris sort, au clic, au glisser, au défilement ou avec
          Échap. Au clavier, un bloc qui reçoit le focus la montre aussi.
        </p>
        <p>
          <strong>Clic sur un bloc</strong> : sa fiche s’ouvre à droite de la fenêtre, sans remonter
          la page ; la semaine reste visible. Le bouton Fermer, Échap ou un clic sur la page la
          ferme. Dans une fenêtre étroite (moins de 900 px), la fiche s’ouvre dans la page, qui
          défile jusqu’à elle puis revient au bloc.
        </p>
      </Card>
      <Card title="Recalculer les titres d’un horaire (Expérimental)">
        <p>
          Un horaire importé avant la v0.38 garde ses codes (« RE4L-L2-4MIN ») comme titres. Le
          texte d’origine est gardé :{' '}
          <strong>Réglages › Agenda › Sources › « Recalculer les titres »</strong> refait les titres
          sans le fichier (« Computer Network Lab », « Thermo · Écrit ») et ouvre le même aperçu que
          l’import. Seul le titre change ; un titre que tu as changé toi-même est décoché. Rien
          n’est écrit avant « Appliquer » (sauvegarde avant, « Annuler » après). Un bandeau discret
          le propose quand c’est utile ; fermé, il ne revient pas tant que rien ne change.
        </p>
      </Card>
    </Page>
  );
}

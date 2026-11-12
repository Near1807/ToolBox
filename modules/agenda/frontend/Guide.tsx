// The Agenda's built-in guide (short): the two kinds of items, the bar and
// its examples, the load, the layers.
import { Link } from 'react-router';
import { Card, Page } from '@hub/sdk/frontend';

const EXAMPLES: [string, string][] = [
  ['dentiste jeudi 14h 1h', 'un rendez-vous jeudi de 14:00 à 15:00'],
  ['réunion staff mardi 20h', 'mardi 20:00–21:00 (1 h si rien n’est dit)'],
  ['cours de solfège de 18h à 19h30 lundi', 'de 18:00 à 19:30'],
  ['week-end scout 13-15 février', 'sur trois jours, toute la journée'],
  ['examen math 18 janvier #examens', 'toute la journée, catégorie « Examens »'],
  ['badminton tous les jeudis 19h 2h', 'dans la semaine type, chaque jeudi'],
  ['préparer la réunion ~1h avant vendredi', 'une tâche de la To-do, à caser'],
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
          Règles : « ~ » devant une durée en fait une tâche à caser ; sinon une heure fait un
          événement à cette heure, une date seule un événement sur la journée, rien de daté une
          tâche. La date et les heures viennent après le titre. « #cours » donne la catégorie.
        </p>
      </Card>
      <Card title="La charge et le temps libre">
        <p>
          Sous chaque jour, une barre découpée par catégorie : les heures de tes événements dans la
          journée (7 h – 23 h par défaut, réglable dans Réglages › Agenda) et les durées estimées
          des tâches à rendre ce jour-là (une tâche en retard compte aujourd’hui).{' '}
          <strong>Léger</strong> sous la moitié de la journée, <strong>chargé</strong> jusqu’à 85 %,{' '}
          <strong>saturé</strong> au-delà.
        </p>
        <p>
          En haut : les heures <strong>libres</strong> de la semaine et les heures{' '}
          <strong>à caser</strong> (tâches à rendre cette semaine), plus les tâches sans durée. Deux
          blocs en même temps sont signalés.
        </p>
      </Card>
      <Card title="Les calques">
        <p>
          Chaque catégorie (Rendez-vous, Cours, Sport, Repas…) a sa couleur. Touche une catégorie
          dans « Calques » pour la masquer ou l’afficher : c’est un réglage de cet appareil
          seulement. La charge compte toujours tout.
        </p>
        <p>
          Un élément d’un autre outil (une séance de sport, un repas) s’ouvre dans cet outil ; un
          événement de l’Agenda montre son détail.
        </p>
      </Card>
    </Page>
  );
}

// The small « ? » next to a graph or a measure: opens the guide at its section
// (separate page, read only). Hidden when « Afficher les « ? » d'aide » is off.
import { createContext, useContext } from 'react';
import { useNavigate } from 'react-router';
import { useModule } from '@hub/sdk/frontend';
import { sectionById } from './content';

/** Whether the « ? » are shown (setting `guideHints`), provided by the page. */
export const HelpHints = createContext(true);

/** Router path of the guide, at a section when `topic` is given. */
export function useGuidePath() {
  const module = useModule();
  return (topic?: string) => module.path(topic ? `guide?s=${topic}` : 'guide');
}

export function Help(props: { topic: string }) {
  const shown = useContext(HelpHints);
  const navigate = useNavigate();
  const guidePath = useGuidePath();
  const section = sectionById(props.topic);
  if (!shown || !section) return null;
  return (
    <button
      type="button"
      className="ma-help"
      title={`Guide : ${section.title}`}
      aria-label={`Guide : ${section.title}`}
      onClick={(event) => {
        event.stopPropagation();
        navigate(guidePath(props.topic));
      }}
    >
      ?
    </button>
  );
}

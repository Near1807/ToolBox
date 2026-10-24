// Frontend of the assistant: its page, the always-mounted Background (mic and
// playback) and the floating indicator.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { AssistantPage } from './AssistantPage';
import { Background } from './Background';
import { CommandsPage } from './CommandsPage';
import { Overlay } from './Overlay';
import { WordsPage } from './WordsPage';
import './assistant.css';

export default defineFrontendModule({
  pages: [
    { path: '', component: AssistantPage },
    { path: 'commands', component: CommandsPage },
    { path: 'mots', component: WordsPage },
  ],
  Background,
  Overlay,
});

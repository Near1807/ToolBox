import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
// Fonts of some themes (OFL, embedded: a font file is only read when a theme uses it).
import '@fontsource-variable/nunito';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/oswald';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import './styles.css';
import { syncThemeFromCore } from './shell/ui-prefs';
import { applyTheme, cachedTheme, installThemes } from './themes';

installThemes();
applyTheme(cachedTheme());
void syncThemeFromCore();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

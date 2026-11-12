// Start of the phone app (ADR 0044): the PC's themes and styles, the Worker
// (base + module code), the SDK's API client switched to the Worker, then the
// mobile shell. The module screens are the PC's, with a mobile layout added.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { setApiTransport } from '@hub/sdk/frontend';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '../../../frontend/src/styles.css';
import { applyTheme, cachedTheme, installThemes } from '../../../frontend/src/themes';
import { WorkerClient, workerTransport } from '../../../packages/phone/transport';
import { App } from './App';
import { autoSync } from './auto';
import { pageHost } from './page-host';
import './mobile.css';

installThemes();
applyTheme(cachedTheme());

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const client = new WorkerClient(worker);
client.serveHost(pageHost);
// A change made here (an API call that writes) is synchronised shortly after,
// when the automatic synchronisation is on (grouped, packages/phone/auto-sync.ts).
const transport = workerTransport(client);
setApiTransport({
  ...transport,
  request: async (path, init) => {
    const response = await transport.request(path, init);
    const method = (init.method ?? 'GET').toUpperCase();
    if (
      method !== 'GET' &&
      response.status < 400 &&
      (path.startsWith('/api/modules/') || path.startsWith('/api/core/settings'))
    )
      autoSync(client).localChange();
    return response;
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App client={client} />
    </HashRouter>
  </StrictMode>,
);

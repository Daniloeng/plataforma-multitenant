import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isDemoMode } from './utils/demo';
import './index.css';

/** No modo demo, liga o MSW no navegador antes de renderizar (a API passa a ser simulada). */
async function enableMocking(): Promise<void> {
  if (!isDemoMode()) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
  });
}

void enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

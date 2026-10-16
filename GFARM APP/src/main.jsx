import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // Forcar a checagem da versao nova quando o PWA e aberto.
        // Nao recarregar formularios em uso nem comprometer o modo offline.
        registration.update().catch(() => {});
      })
      .catch((error) => {
        console.warn(
          'Service Worker nÃ£o pÃ´de ser registrado:',
          error
        );
      });
  });
}


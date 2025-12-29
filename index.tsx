
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

/**
 * Ponto de entrada da aplicação ST Check-in.
 * Utiliza o sistema de renderização concorrente do React 19.
 */
const mountApp = () => {
  const container = document.getElementById('root');
  if (!container) return;

  try {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ST Check-in: Interface montada com sucesso.");
  } catch (err: any) {
    console.error("ST Check-in: Erro crítico na montagem:", err);
  }
};

// Executa a montagem imediatamente se o DOM já estiver pronto, 
// ou aguarda o evento DOMContentLoaded para maior segurança.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  mountApp();
} else {
  document.addEventListener('DOMContentLoaded', mountApp);
}

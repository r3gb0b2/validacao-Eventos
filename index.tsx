
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/**
 * Inicialização da Aplicação ST Check-in
 */
const mount = () => {
  const container = document.getElementById('root');
  if (!container) {
    console.error("ST Check-in: Elemento #root não encontrado.");
    return;
  }

  try {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ST Check-in: Interface montada com sucesso.");
  } catch (err) {
    console.error("ST Check-in: Erro crítico na renderização:", err);
  }
};

// Executa a montagem quando o documento estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

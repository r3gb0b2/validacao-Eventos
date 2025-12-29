
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

console.log("ST Check-in: Módulo index.tsx carregado.");

const startApp = () => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    console.error("ST Check-in: Elemento #root não encontrado.");
    return;
  }

  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ST Check-in: Renderização iniciada.");
  } catch (error: any) {
    console.error("ST Check-in: Erro fatal no ReactDOM:", error);
    throw error; // Repassa para o onunhandledrejection no index.html
  }
};

// Aguarda o DOM estar pronto para garantir que o ImportMap foi processado
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

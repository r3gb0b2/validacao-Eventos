
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const startApp = () => {
  const container = document.getElementById('root');

  if (container) {
    try {
      const root = ReactDOM.createRoot(container);
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
      console.log("ST Check-in: Interface renderizada com sucesso.");
    } catch (err) {
      console.error("ST Check-in: Erro fatal no React DOM:", err);
    }
  } else {
    console.error("ST Check-in: #root não encontrado.");
  }
};

// Garante que o script rode apenas quando o DOM estiver totalmente pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

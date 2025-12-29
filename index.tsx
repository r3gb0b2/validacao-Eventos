import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');

if (container) {
  try {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ST Check-in: Inicializado com sucesso.");
  } catch (err) {
    console.error("ST Check-in: Erro na montagem:", err);
  }
} else {
  console.error("ST Check-in: Elemento #root não encontrado no DOM.");
}
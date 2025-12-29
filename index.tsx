
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Garante que o container existe antes de tentar renderizar
const container = document.getElementById('root');

if (container) {
  try {
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ST Check-in: Renderização iniciada com sucesso.");
  } catch (err) {
    console.error("ST Check-in: Falha na renderização:", err);
  }
} else {
  console.error("ST Check-in: Elemento #root não encontrado no DOM.");
}

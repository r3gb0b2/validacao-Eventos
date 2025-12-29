
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

console.log("ST Check-in: Iniciando montagem do DOM...");

const rootElement = document.getElementById('root');

if (!rootElement) {
  const msg = "Erro crítico: Elemento #root não encontrado no HTML.";
  console.error(msg);
  throw new Error(msg);
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log("ST Check-in: React montado com sucesso.");
} catch (error: any) {
  console.error("ST Check-in: Falha ao renderizar App:", error);
  // Força exibição do erro na tela se o montador falhar
  const errorOverlay = document.createElement('div');
  errorOverlay.className = "fixed inset-0 bg-red-900 text-white p-10 z-[10000] overflow-auto";
  errorOverlay.innerHTML = `
    <h1 class="text-2xl font-bold mb-4">Falha na Renderização</h1>
    <pre class="bg-black/30 p-4 rounded text-xs">${error?.stack || error?.message || error}</pre>
    <button onclick="window.location.reload()" class="mt-4 bg-white text-red-900 px-4 py-2 rounded font-bold">Tentar Novamente</button>
  `;
  document.body.appendChild(errorOverlay);
}

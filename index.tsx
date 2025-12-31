
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

try {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error("Elemento root não encontrado");
    }

    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} catch (err) {
    console.error("Crash no Render:", err);
    alert("Erro ao carregar interface: " + (err instanceof Error ? err.message : String(err)));
}

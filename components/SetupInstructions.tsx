

import React from 'react';
import { AlertTriangleIcon } from './Icons';

const rules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permite leitura e escrita na coleção de eventos
    match /events/{eventId} {
      allow read, write: if true;
    }

    // Permite leitura e escrita nas sub-coleções de cada evento
    match /events/{eventId}/{collection}/{docId} {
      allow read, write: if true;
    }
  }
}
`.trim();

const SetupInstructions: React.FC = () => {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(rules)
      .then(() => alert('Regras de segurança copiadas para a área de transferência!'))
      .catch(err => console.error('Falha ao copiar texto: ', err));
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-3xl bg-gray-800 border border-orange-500/50 rounded-lg shadow-2xl p-8 space-y-6">
        <div className="text-center">
          <AlertTriangleIcon className="w-16 h-16 mx-auto text-orange-400" />
          <h1 className="text-3xl font-bold mt-4 text-orange-400">Conexão com o Banco de Dados Falhou</h1>
          <p className="text-gray-300 mt-2">
            Isso geralmente é um problema de configuração no seu projeto Firebase. Siga os passos abaixo para resolver.
          </p>
        </div>

        <div className="space-y-4">
          {/* Step 1 */}
          <div className="p-4 bg-gray-700/50 rounded-md">
            <h2 className="text-lg font-semibold text-white">1. Verifique suas Credenciais</h2>
            <p className="text-sm text-gray-400 mt-1">
              Abra o arquivo <code className="bg-gray-900 px-1 py-0.5 rounded text-orange-300">firebaseConfig.ts</code> e certifique-se de que você substituiu os valores de exemplo pelas credenciais reais do seu projeto, que você encontra no Console do Firebase.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-4 bg-gray-700/50 rounded-md">
            <h2 className="text-lg font-semibold text-white">2. Crie o Banco de Dados (Causa mais comum)</h2>
            <p className="text-sm text-gray-400 mt-1">
              No <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-orange-400 underline hover:text-orange-300">Console do Firebase</a>, vá para <strong>Firestore Database</strong> e clique em <strong>"Criar banco de dados"</strong>. Se este botão não for clicado, o aplicativo não tem para onde se conectar.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-4 bg-gray-700/50 rounded-md">
            <h2 className="text-lg font-semibold text-white">3. Configure as Regras de Segurança</h2>
            <p className="text-sm text-gray-400 mt-1">
              Ainda no Firestore, vá para a aba <strong>Regras</strong> (Rules), apague todo o conteúdo e cole o código abaixo:
            </p>
            <div className="relative mt-2">
                <pre className="bg-gray-900 p-3 rounded-md text-xs text-gray-200 overflow-x-auto">
                    <code>{rules}</code>
                </pre>
                <button onClick={copyToClipboard} className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded">Copiar</button>
            </div>
             <p className="text-sm text-gray-400 mt-2">Após colar, clique em <strong>Publicar</strong>.</p>
          </div>

           {/* Step 4 */}
           <div className="p-4 bg-orange-800/50 border border-orange-500 rounded-md">
            <h2 className="text-lg font-semibold text-orange-300">4. Crie um Índice para o Histórico (Passo Final e Essencial)</h2>
            <p className="text-sm text-gray-300 mt-1">
              Após o app conectar, o histórico de validações pode não aparecer e um erro aparecerá no console do navegador. Isso é esperado.
            </p>
            <ol className="list-decimal list-inside text-sm text-gray-300 mt-2 space-y-1">
                <li>Abra as <strong>Ferramentas de Desenvolvedor</strong> (clique com o botão direito na página → Inspecionar → aba Console).</li>
                <li>Você verá uma mensagem de erro do Firestore em vermelho contendo um <strong>link longo</strong>.</li>
                <li className="font-bold">Clique neste link. Ele te levará para a página de criação de índice no Firebase, com tudo já preenchido.</li>
                <li>Apenas clique em <strong>"Criar"</strong>. A criação pode levar alguns minutos.</li>
                <li>Após a conclusão, atualize a página do aplicativo. O histórico funcionará.</li>
            </ol>
          </div>
        </div>

        <div className="text-center mt-6">
          <p className="text-gray-300">Após completar todos os passos, atualize a página.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md transition-colors"
          >
            Atualizar Página
          </button>
        </div>
      </div>
    </div>
  );
};

export default SetupInstructions;
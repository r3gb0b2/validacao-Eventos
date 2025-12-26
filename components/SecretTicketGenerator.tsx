
import React, { useState } from 'react';
import { generateSingleTicketPdf } from '../utils/ticketPdfGenerator';
import { TicketIcon, CloudDownloadIcon } from './Icons';
import { Firestore, doc, setDoc } from 'firebase/firestore';

interface SecretTicketGeneratorProps {
    db: Firestore;
    selectedEventId: string | null;
}

const SecretTicketGenerator: React.FC<SecretTicketGeneratorProps> = ({ db, selectedEventId }) => {
    const [eventName, setEventName] = useState('DE SOL AO SAMBA');
    const [isGenerating, setIsGenerating] = useState(false);
    const [lastGenerated, setLastGenerated] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!eventName.trim()) return alert("Digite o nome do evento.");
        setIsGenerating(true);
        try {
            const { ticketCode } = await generateSingleTicketPdf(eventName);
            
            // Opcional: Se houver um evento selecionado, já salva no banco de dados para ser válido no scanner
            if (db && selectedEventId) {
                await setDoc(doc(db, 'events', selectedEventId, 'tickets', ticketCode), {
                    sector: 'Setor Único',
                    status: 'AVAILABLE',
                    details: {
                        ownerName: 'VENDA ONLINE',
                        eventName: eventName
                    }
                });
            }

            setLastGenerated(ticketCode);
            alert("Ingresso gerado com sucesso!");
        } catch (e) {
            console.error(e);
            alert("Erro ao gerar PDF.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            <div className="w-full max-w-md bg-gray-800 rounded-xl shadow-2xl border border-orange-500/30 p-8">
                <div className="flex items-center justify-center mb-6">
                    <div className="bg-orange-500/20 p-4 rounded-full">
                        <TicketIcon className="w-12 h-12 text-orange-500" />
                    </div>
                </div>
                
                <h1 className="text-2xl font-bold text-center text-white mb-2">Gerador de Ingressos</h1>
                <p className="text-gray-400 text-center text-sm mb-8">Esta é uma ferramenta oculta para emissão manual.</p>

                <div className="space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Nome do Evento no PDF</label>
                        <input 
                            type="text" 
                            value={eventName}
                            onChange={(e) => setEventName(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-4 text-white focus:border-orange-500 outline-none text-lg"
                            placeholder="Ex: DE SOL AO SAMBA"
                        />
                    </div>

                    <button 
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center transition-all transform active:scale-95 disabled:opacity-50"
                    >
                        {isGenerating ? (
                            <span className="flex items-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Gerando PDF...
                            </span>
                        ) : (
                            <>
                                <CloudDownloadIcon className="w-6 h-6 mr-2" />
                                Gerar QR Code e PDF
                            </>
                        )}
                    </button>

                    {lastGenerated && (
                        <div className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-center">
                            <p className="text-green-500 text-xs font-bold uppercase mb-1">Último Código Gerado</p>
                            <p className="text-white font-mono text-xl">{lastGenerated}</p>
                            {selectedEventId && <p className="text-gray-500 text-[10px] mt-1">Sincronizado com o scanner deste evento.</p>}
                        </div>
                    )}

                    <div className="pt-4 text-center">
                        <button 
                            onClick={() => window.location.href = window.location.pathname}
                            className="text-gray-500 hover:text-white text-xs underline"
                        >
                            Sair do Gerador
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecretTicketGenerator;

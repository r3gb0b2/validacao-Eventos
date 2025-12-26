
import React, { useState, useEffect } from 'react';
import { generateSingleTicketPdf, TicketPdfDetails } from '../utils/ticketPdfGenerator';
import { TicketIcon, CloudDownloadIcon, CheckCircleIcon } from './Icons';
import { Firestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { Event } from '../types';

interface SecretTicketGeneratorProps {
    db: Firestore;
}

const SecretTicketGenerator: React.FC<SecretTicketGeneratorProps> = ({ db }) => {
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEventId, setSelectedEventId] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [lastGenerated, setLastGenerated] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<TicketPdfDetails>({
        eventName: 'DE SOL AO SAMBA',
        openingTime: '27/12/2025 16:00',
        venue: 'Iate Club',
        address: 'Avenida Vicente de Castro, 4813 - Cais do Porto, Fortaleza, CE - 60180-410',
        producer: 'D&E MUSIC',
        contact: '+5585987737330',
        sector: 'Setor Único [Meia] 3º Lote',
        ownerName: 'VENDA ONLINE'
    });

    useEffect(() => {
        const loadEvents = async () => {
            try {
                const snap = await getDocs(collection(db, 'events'));
                const list = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
                setEvents(list);
                if (list.length > 0) setSelectedEventId(list[0].id);
            } catch (e) {
                console.error("Erro ao carregar eventos", e);
            }
        };
        loadEvents();
    }, [db]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGenerate = async () => {
        if (!selectedEventId) return alert("Selecione um evento de destino primeiro.");
        if (!formData.eventName.trim()) return alert("Preencha o nome do evento.");
        
        setIsGenerating(true);
        try {
            const { ticketCode } = await generateSingleTicketPdf(formData);
            
            // Salva no Firestore do evento selecionado para ser válido no scanner
            await setDoc(doc(db, 'events', selectedEventId, 'tickets', ticketCode), {
                sector: formData.sector.split('[')[0].trim(), // Pega o nome base do setor
                status: 'AVAILABLE',
                details: {
                    ownerName: formData.ownerName,
                    eventName: formData.eventName
                }
            });

            setLastGenerated(ticketCode);
            alert("Ingresso gerado e adicionado ao banco de dados!");
        } catch (e) {
            console.error(e);
            alert("Erro ao gerar PDF.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8 flex flex-col items-center">
            <div className="w-full max-w-4xl bg-gray-800 rounded-2xl shadow-2xl border border-orange-500/20 overflow-hidden">
                <div className="bg-orange-600 p-6 flex items-center space-x-4">
                    <TicketIcon className="w-10 h-10 text-white" />
                    <div>
                        <h1 className="text-2xl font-bold">Emissor Manual de Ingressos</h1>
                        <p className="text-orange-100 text-sm">Preencha os campos abaixo para gerar o PDF e validar no sistema.</p>
                    </div>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Coluna 1: Configuração do Sistema */}
                    <div className="space-y-6">
                        <div className="bg-gray-700/30 p-4 rounded-xl border border-gray-600">
                            <h2 className="text-sm font-bold text-orange-400 uppercase mb-4 flex items-center">
                                <CheckCircleIcon className="w-4 h-4 mr-2" />
                                1. Destino no Sistema
                            </h2>
                            <label className="block text-xs text-gray-400 mb-1">Evento de Destino (Para o Scanner)</label>
                            <select 
                                value={selectedEventId}
                                onChange={(e) => setSelectedEventId(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                            >
                                <option value="">Selecione o evento...</option>
                                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                            </select>
                            <p className="text-[10px] text-gray-500 mt-2 italic">O ingresso gerado será válido apenas no scanner do evento selecionado acima.</p>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-sm font-bold text-orange-400 uppercase mb-2 flex items-center">
                                <TicketIcon className="w-4 h-4 mr-2" />
                                2. Dados do Ingresso
                            </h2>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Setor (Exibido no PDF)</label>
                                <input name="sector" value={formData.sector} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Participante (Exibido no PDF)</label>
                                <input name="ownerName" value={formData.ownerName} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                        </div>
                    </div>

                    {/* Coluna 2: Detalhes do Layout do PDF */}
                    <div className="space-y-4">
                        <h2 className="text-sm font-bold text-orange-400 uppercase mb-2 flex items-center">
                            <CloudDownloadIcon className="w-4 h-4 mr-2" />
                            3. Informações do Evento (PDF)
                        </h2>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Nome do Evento</label>
                            <input name="eventName" value={formData.eventName} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Abertura</label>
                                <input name="openingTime" value={formData.openingTime} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Local</label>
                                <input name="venue" value={formData.venue} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Endereço Completo</label>
                            <textarea name="address" value={formData.address} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm h-20" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Produzido por</label>
                                <input name="producer" value={formData.producer} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Contato</label>
                                <input name="contact" value={formData.contact} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-700/50 p-6 flex flex-col items-center border-t border-gray-600">
                    <button 
                        onClick={handleGenerate}
                        disabled={isGenerating || !selectedEventId}
                        className="w-full max-w-md bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl shadow-xl flex items-center justify-center transition-all transform active:scale-95 disabled:opacity-50 disabled:grayscale"
                    >
                        {isGenerating ? "Gerando Arquivos..." : "Gerar QR Code e Baixar PDF"}
                    </button>
                    
                    {lastGenerated && (
                        <div className="mt-4 text-green-400 text-sm font-bold flex items-center animate-bounce">
                            <CheckCircleIcon className="w-5 h-5 mr-2" />
                            Sucesso! Código: {lastGenerated}
                        </div>
                    )}

                    <button onClick={() => window.location.href = window.location.pathname} className="mt-6 text-gray-500 hover:text-white text-xs underline">
                        Voltar ao Início
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SecretTicketGenerator;

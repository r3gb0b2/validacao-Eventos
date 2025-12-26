
import React, { useState, useEffect, useRef } from 'react';
import { generateSingleTicketBlob, TicketPdfDetails } from '../utils/ticketPdfGenerator';
import { TicketIcon, CloudDownloadIcon, CheckCircleIcon, CloudUploadIcon, TableCellsIcon } from './Icons';
import { Firestore, collection, getDocs, doc, setDoc, writeBatch } from 'firebase/firestore';
import { Event } from '../types';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';

// Configurar o worker do PDF.js compatível com a versão 3.11.174
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;

interface SecretTicketGeneratorProps {
    db: Firestore;
}

const SecretTicketGenerator: React.FC<SecretTicketGeneratorProps> = ({ db }) => {
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEventId, setSelectedEventId] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [lastZipUrl, setLastZipUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((item: any) => item.str).join(' ');

            // Lógica de Extração baseada no layout ST
            const extracted: Partial<TicketPdfDetails> = {};
            
            // Tentar encontrar o nome do evento (Geralmente após "CARTÃO DE ACESSO")
            const eventMatch = text.match(/CARTÃO DE ACESSO\s+(.*?)\s+Abertura/i);
            if (eventMatch) extracted.eventName = eventMatch[1].trim();

            const openingMatch = text.match(/Abertura:\s+([\d\/:\s]+)/i);
            if (openingMatch) extracted.openingTime = openingMatch[1].trim();

            const venueMatch = text.match(/Local:\s+(.*?)\s+Endereço/i);
            if (venueMatch) extracted.venue = venueMatch[1].trim();

            const addressMatch = text.match(/Endereço:\s+(.*?)\s+Produzido/i);
            if (addressMatch) extracted.address = addressMatch[1].trim();

            const producerMatch = text.match(/Produzido:\s+(.*?)\s+Contato/i);
            if (producerMatch) extracted.producer = producerMatch[1].trim();

            const contactMatch = text.match(/Contato:\s+([\+\d\s]+)/i);
            if (contactMatch) extracted.contact = contactMatch[1].trim();

            const sectorMatch = text.match(/Ingresso\s+(.*?)\s+Participante/i);
            if (sectorMatch) extracted.sector = sectorMatch[1].trim();

            setFormData(prev => ({ ...prev, ...extracted }));
            alert("Dados extraídos do PDF com sucesso!");
        } catch (error) {
            console.error(error);
            alert("Erro ao ler o PDF. Certifique-se que é um ingresso original ST.");
        } finally {
            setIsParsing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGenerateBatch = async () => {
        if (!selectedEventId) return alert("Selecione um evento de destino.");
        if (quantity < 1) return alert("Quantidade inválida.");

        setIsGenerating(true);
        const zip = new JSZip();
        const batch = writeBatch(db);
        const eventFolder = zip.folder(formData.eventName.replace(/\s+/g, '_'));

        try {
            for (let i = 0; i < quantity; i++) {
                const { blob, ticketCode } = await generateSingleTicketBlob(formData);
                
                // Adicionar ao ZIP
                if (eventFolder) {
                    eventFolder.file(`ingresso_${i + 1}_${ticketCode}.pdf`, blob);
                }

                // Registrar no banco de dados
                const ticketRef = doc(db, 'events', selectedEventId, 'tickets', ticketCode);
                batch.set(ticketRef, {
                    sector: formData.sector.split('[')[0].trim(),
                    status: 'AVAILABLE',
                    details: {
                        ownerName: formData.ownerName,
                        eventName: formData.eventName
                    }
                });

                // Pausa curta para não travar o browser se for muitos
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 50));
            }

            await batch.commit();
            
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            setLastZipUrl(url);

            // Download automático
            const link = document.createElement('a');
            link.href = url;
            link.download = `ingressos_${formData.eventName.replace(/\s+/g, '_')}.zip`;
            link.click();

            alert(`${quantity} ingressos gerados e adicionados ao banco!`);
        } catch (e) {
            console.error(e);
            alert("Erro ao gerar lote.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8 flex flex-col items-center">
            <div className="w-full max-w-5xl bg-gray-800 rounded-2xl shadow-2xl border border-orange-500/20 overflow-hidden">
                <div className="bg-orange-600 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center space-x-4">
                        <TicketIcon className="w-10 h-10 text-white" />
                        <div>
                            <h1 className="text-2xl font-bold">Gerador em Lote Inteligente</h1>
                            <p className="text-orange-100 text-sm">Upload de PDF para preenchimento e exportação em ZIP.</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={handleFileUpload} 
                            accept=".pdf" 
                            className="hidden" 
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isParsing}
                            className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg flex items-center text-sm font-bold border border-white/20"
                        >
                            {isParsing ? "Lendo PDF..." : <><CloudUploadIcon className="w-4 h-4 mr-2" /> Ler Dados de PDF</>}
                        </button>
                    </div>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Configuração do Lote */}
                    <div className="space-y-6">
                        <div className="bg-gray-700/30 p-5 rounded-xl border border-gray-600">
                            <h2 className="text-sm font-bold text-orange-400 uppercase mb-4 flex items-center">
                                <TableCellsIcon className="w-4 h-4 mr-2" />
                                1. Configuração do Lote
                            </h2>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Evento de Destino (Scanner)</label>
                                    <select 
                                        value={selectedEventId}
                                        onChange={(e) => setSelectedEventId(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white outline-none"
                                    >
                                        <option value="">Selecione o evento...</option>
                                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                                    </select>
                                </div>
                                
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Quantidade de Ingressos</label>
                                    <input 
                                        type="number" 
                                        min="1" 
                                        max="500"
                                        value={quantity} 
                                        onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                                        className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white text-xl font-bold text-center"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-sm font-bold text-orange-400 uppercase mb-2 flex items-center">
                                <TicketIcon className="w-4 h-4 mr-2" />
                                2. Dados do Ingresso
                            </h2>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Setor</label>
                                <input name="sector" value={formData.sector} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Participante</label>
                                <input name="ownerName" value={formData.ownerName} onChange={handleInputChange} className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            </div>
                        </div>
                    </div>

                    {/* Detalhes do Evento */}
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

                <div className="bg-gray-700/50 p-8 flex flex-col items-center border-t border-gray-600">
                    <button 
                        onClick={handleGenerateBatch}
                        disabled={isGenerating || !selectedEventId}
                        className="w-full max-w-lg bg-orange-600 hover:bg-orange-700 text-white font-bold py-5 rounded-2xl shadow-2xl flex items-center justify-center transition-all transform active:scale-95 disabled:opacity-50 text-lg"
                    >
                        {isGenerating ? (
                            <span className="flex items-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Gerando {quantity} Ingressos...
                            </span>
                        ) : (
                            <>
                                <CloudDownloadIcon className="w-6 h-6 mr-3" />
                                Gerar Lote e Baixar ZIP
                            </>
                        )}
                    </button>
                    
                    {lastZipUrl && (
                        <a href={lastZipUrl} download={`ingressos_${formData.eventName.replace(/\s+/g, '_')}.zip`} className="mt-4 text-green-400 text-sm font-bold flex items-center underline">
                            <CheckCircleIcon className="w-5 h-5 mr-2" />
                            Download pronto! Clique aqui se não baixou automaticamente.
                        </a>
                    )}

                    <button onClick={() => window.location.href = window.location.pathname} className="mt-8 text-gray-500 hover:text-white text-xs underline">
                        Voltar ao Painel Principal
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SecretTicketGenerator;

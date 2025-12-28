
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { generateSingleTicketBlob, TicketPdfDetails } from '../utils/ticketPdfGenerator';
import { TicketIcon, CloudDownloadIcon, CheckCircleIcon, CloudUploadIcon, TableCellsIcon, TrashIcon, SearchIcon, ClockIcon, XCircleIcon } from './Icons';
import { Firestore, collection, getDocs, doc, setDoc, writeBatch, onSnapshot, deleteDoc, query, where } from 'firebase/firestore';
import { Event, Ticket } from '../types';
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
    const [isDeletingBatch, setIsDeletingBatch] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [lastZipUrl, setLastZipUrl] = useState<string | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

    // Carregar Eventos
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

    // Escutar APENAS ingressos gerados por este gerador
    useEffect(() => {
        if (!selectedEventId) {
            setTickets([]);
            return;
        }

        const q = query(
            collection(db, 'events', selectedEventId, 'tickets'), 
            where('source', '==', 'secret_generator')
        );

        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({
                id: d.id,
                ...d.data()
            } as Ticket));
            setTickets(list);
        }, (err) => {
            console.error("Erro no snapshot:", err);
        });

        return () => unsub();
    }, [db, selectedEventId]);

    const filteredTickets = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        if (!term) return tickets;
        return tickets.filter(t => 
            t.id.toLowerCase().includes(term) || 
            t.details?.ownerName?.toLowerCase().includes(term)
        );
    }, [tickets, searchTerm]);

    // Limpar seleção quando os ingressos mudam ou filtro é aplicado
    useEffect(() => {
        setSelectedIds(prev => {
            const next = new Set<string>();
            filteredTickets.forEach(t => {
                if (prev.has(t.id)) next.add(t.id);
            });
            return next;
        });
    }, [filteredTickets]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedIds(new Set(filteredTickets.map(t => t.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

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

            const extracted: Partial<TicketPdfDetails> = {};
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
            alert("Erro ao ler o PDF.");
        } finally {
            setIsParsing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleDownloadIndividual = async (ticket: Ticket) => {
        if (downloadingId) return;
        setDownloadingId(ticket.id);
        
        try {
            // Reconstituir o PDF a partir dos dados salvos no 'details'
            // Se não houver config salva (tickets antigos), usamos o formData atual como fallback
            const pdfConfig: TicketPdfDetails = (ticket.details as any)?.pdfConfig || {
                ...formData,
                ownerName: ticket.details?.ownerName || formData.ownerName,
                sector: ticket.sector
            };

            const { blob } = await generateSingleTicketBlob(pdfConfig, ticket.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ingresso_${ticket.id}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Erro ao reconstruir PDF:", e);
            alert("Erro ao gerar arquivo para download.");
        } finally {
            setDownloadingId(null);
        }
    };

    const handleDeleteTicket = async (ticketId: string) => {
        if (!selectedEventId) return;
        if (!confirm(`Deseja remover o código ${ticketId} permanentemente?`)) return;
        
        try {
            await deleteDoc(doc(db, 'events', selectedEventId, 'tickets', ticketId));
        } catch (e) {
            alert("Erro ao deletar.");
        }
    };

    const handleDeleteSelected = async () => {
        if (!selectedEventId || selectedIds.size === 0) return;
        if (!confirm(`Deseja remover permanentemente ${selectedIds.size} ingressos selecionados?`)) return;

        setIsDeletingBatch(true);
        try {
            const idsArray = Array.from(selectedIds);
            const BATCH_SIZE = 450; 

            for (let i = 0; i < idsArray.length; i += BATCH_SIZE) {
                const chunk = idsArray.slice(i, i + BATCH_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(id => {
                    batch.delete(doc(db, 'events', selectedEventId, 'tickets', id));
                });
                await batch.commit();
            }

            setSelectedIds(new Set());
            alert(`${idsArray.length} ingressos removidos com sucesso.`);
        } catch (e) {
            console.error("Erro ao deletar lote:", e);
            alert("Erro ao processar exclusão em massa.");
        } finally {
            setIsDeletingBatch(false);
        }
    };

    const handleGenerateBatch = async () => {
        if (!selectedEventId) return alert("Selecione um evento de destino.");
        if (quantity < 1) return alert("Quantidade inválida.");

        setIsGenerating(true);
        const zip = new JSZip();
        let currentBatch = writeBatch(db);
        let batchCounter = 0;
        const eventFolder = zip.folder(formData.eventName.replace(/\s+/g, '_'));

        try {
            for (let i = 0; i < quantity; i++) {
                const { blob, ticketCode } = await generateSingleTicketBlob(formData);
                if (eventFolder) eventFolder.file(`ingresso_${i + 1}_${ticketCode}.pdf`, blob);

                const ticketRef = doc(db, 'events', selectedEventId, 'tickets', ticketCode);
                currentBatch.set(ticketRef, {
                    sector: formData.sector.split('[')[0].trim(),
                    status: 'AVAILABLE',
                    source: 'secret_generator',
                    details: {
                        ownerName: formData.ownerName,
                        eventName: formData.eventName,
                        // SALVAMOS A CONFIG COMPLETA PARA RE-DOWNLOAD INDIVIDUAL POSTERIOR
                        pdfConfig: { ...formData }
                    }
                });

                batchCounter++;

                if (batchCounter >= 100) {
                    await currentBatch.commit();
                    currentBatch = writeBatch(db);
                    batchCounter = 0;
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            if (batchCounter > 0) {
                await currentBatch.commit();
            }

            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            setLastZipUrl(url);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = `ingressos_${formData.eventName.replace(/\s+/g, '_')}.zip`;
            link.click();
            
            alert("Lote gerado com sucesso!");
        } catch (e) {
            console.error("Erro na geração:", e);
            alert("Erro ao gerar lote. Verifique o console.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8 flex flex-col items-center space-y-8 pb-20">
            {/* CARD GERADOR */}
            <div className="w-full max-w-5xl bg-gray-800 rounded-2xl shadow-2xl border border-orange-500/20 overflow-hidden">
                <div className="bg-orange-600 p-6 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center space-x-4">
                        <TicketIcon className="w-10 h-10 text-white" />
                        <div>
                            <h1 className="text-2xl font-bold">Gerador SecretTicket</h1>
                            <p className="text-orange-100 text-sm">Lista restrita apenas aos ingressos gerados aqui.</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-3">
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf" className="hidden" />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isParsing}
                            className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg flex items-center text-sm font-bold border border-white/20"
                        >
                            {isParsing ? "Lendo..." : <><CloudUploadIcon className="w-4 h-4 mr-2" /> Ler PDF ST</>}
                        </button>
                    </div>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
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
                                        <option value="">Selecione...</option>
                                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Quantidade de Cópias</label>
                                    <input 
                                        type="number" min="1" max="500"
                                        value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
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

                    <div className="space-y-4">
                        <h2 className="text-sm font-bold text-orange-400 uppercase mb-2 flex items-center">
                            <CloudDownloadIcon className="w-4 h-4 mr-2" />
                            3. Informações do Evento (PDF)
                        </h2>
                        <input name="eventName" value={formData.eventName} onChange={handleInputChange} placeholder="Nome do Evento" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        <div className="grid grid-cols-2 gap-4">
                            <input name="openingTime" value={formData.openingTime} onChange={handleInputChange} placeholder="Abertura" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            <input name="venue" value={formData.venue} onChange={handleInputChange} placeholder="Local" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        </div>
                        <textarea name="address" value={formData.address} onChange={handleInputChange} placeholder="Endereço" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm h-20" />
                        <div className="grid grid-cols-2 gap-4">
                            <input name="producer" value={formData.producer} onChange={handleInputChange} placeholder="Produzido" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            <input name="contact" value={formData.contact} onChange={handleInputChange} placeholder="Contato" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-700/50 p-6 flex flex-col items-center border-t border-gray-600">
                    <button 
                        onClick={handleGenerateBatch}
                        disabled={isGenerating || !selectedEventId}
                        className="w-full max-w-lg bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-2xl shadow-xl transition-all transform active:scale-95 disabled:opacity-50 text-lg flex items-center justify-center"
                    >
                        {isGenerating ? "Gerando..." : "Gerar Lote ZIP"}
                    </button>
                    {lastZipUrl && (
                        <a href={lastZipUrl} download={`ingressos_${formData.eventName}.zip`} className="mt-4 text-green-400 text-sm font-bold flex items-center underline">
                            <CheckCircleIcon className="w-5 h-5 mr-2" /> Download Disponível
                        </a>
                    )}
                </div>
            </div>

            {/* LISTA DE REGISTROS GERADOS (FILTRADA) */}
            <div className="w-full max-w-5xl bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
                <div className="p-6 border-b border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center space-x-3">
                        <TableCellsIcon className="w-6 h-6 text-orange-500" />
                        <h2 className="text-xl font-bold">Ingressos Gerados Aqui</h2>
                        <span className="bg-gray-700 px-3 py-1 rounded-full text-xs font-mono">{filteredTickets.length} registros</span>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                        {selectedIds.size > 0 && (
                            <button 
                                onClick={handleDeleteSelected}
                                disabled={isDeletingBatch}
                                className="bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white px-4 py-2 rounded-lg text-sm font-bold border border-red-500/30 transition-all flex items-center"
                            >
                                <TrashIcon className="w-4 h-4 mr-2" />
                                {isDeletingBatch ? "Apagando..." : `Apagar Selecionados (${selectedIds.size})`}
                            </button>
                        )}
                        
                        <div className="relative w-full md:w-64">
                            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar nesta lista..."
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-orange-500 outline-none"
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-gray-800 shadow-sm z-10">
                            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                                <th className="px-6 py-4 w-10">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 rounded bg-gray-900 border-gray-600 text-orange-600 focus:ring-0 cursor-pointer"
                                        checked={filteredTickets.length > 0 && selectedIds.size === filteredTickets.length}
                                        onChange={handleSelectAll}
                                    />
                                </th>
                                <th className="px-6 py-4">Código / QR</th>
                                <th className="px-6 py-4">Participante</th>
                                <th className="px-6 py-4">Setor</th>
                                <th className="px-6 py-4 text-center">Uso</th>
                                <th className="px-6 py-4 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {filteredTickets.map(ticket => (
                                <tr key={ticket.id} className={`transition-colors ${selectedIds.has(ticket.id) ? 'bg-orange-600/10' : 'hover:bg-gray-700/30'}`}>
                                    <td className="px-6 py-4">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 rounded bg-gray-900 border-gray-600 text-orange-600 focus:ring-0 cursor-pointer"
                                            checked={selectedIds.has(ticket.id)}
                                            onChange={() => toggleSelect(ticket.id)}
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-mono text-sm text-orange-400 font-bold">{ticket.id}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm font-medium">{ticket.details?.ownerName || '---'}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
                                            {ticket.sector}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex justify-center">
                                            {ticket.status === 'USED' ? (
                                                <div className="flex items-center text-red-400 text-[10px] font-black uppercase">
                                                    <CheckCircleIcon className="w-4 h-4 mr-1" />
                                                    Utilizado
                                                </div>
                                            ) : (
                                                <div className="flex items-center text-green-400 text-[10px] font-black uppercase">
                                                    <ClockIcon className="w-4 h-4 mr-1" />
                                                    Livre
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => handleDownloadIndividual(ticket)}
                                                disabled={!!downloadingId}
                                                className={`p-2 rounded-lg transition-all ${downloadingId === ticket.id ? 'bg-orange-600 text-white animate-pulse' : 'text-gray-400 hover:text-orange-500 hover:bg-orange-500/10'}`}
                                                title="Baixar PDF Individual"
                                            >
                                                <CloudDownloadIcon className="w-5 h-5" />
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteTicket(ticket.id)}
                                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                title="Excluir Registro"
                                            >
                                                <TrashIcon className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredTickets.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 italic">
                                        Nenhum ingresso gerado pelo SecretTicket para este evento.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <button onClick={() => window.location.href = window.location.pathname} className="text-gray-500 hover:text-white text-xs underline">
                Voltar ao Painel Principal
            </button>
        </div>
    );
};

export default SecretTicketGenerator;

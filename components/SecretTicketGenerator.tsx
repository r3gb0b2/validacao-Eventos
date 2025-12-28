
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { generateSingleTicketBlob, TicketPdfDetails } from '../utils/ticketPdfGenerator';
import { TicketIcon, CloudDownloadIcon, CheckCircleIcon, CloudUploadIcon, TableCellsIcon, TrashIcon, SearchIcon, ClockIcon, XCircleIcon, LinkIcon, PlusCircleIcon } from './Icons';
import { Firestore, collection, getDocs, doc, setDoc, writeBatch, onSnapshot, deleteDoc, query, where, getDoc } from 'firebase/firestore';
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
    const [isSavingLogo, setIsSavingLogo] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [lastZipUrl, setLastZipUrl] = useState<string | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState<TicketPdfDetails>({
        eventName: 'NOME DO EVENTO',
        openingTime: '01/01/2026 16:00',
        venue: 'Local do Evento',
        address: 'Endereço completo aqui',
        producer: 'Produtora',
        contact: '+5500000000000',
        sector: 'Setor Único',
        ownerName: 'PARTICIPANTE',
        logoUrl: 'https://i.ibb.co/LzNf9F5/logo-st-ingressos-white.png'
    });

    // 1. Carregar lista de Eventos
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

    // 2. Carregar configurações salvas (incluindo a LOGO) quando mudar o evento
    useEffect(() => {
        if (!selectedEventId || !db) return;

        const loadSavedSettings = async () => {
            try {
                const docRef = doc(db, 'events', selectedEventId, 'settings', 'main');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.logoUrl) {
                        setFormData(prev => ({ ...prev, logoUrl: data.logoUrl }));
                    }
                }
            } catch (e) {
                console.error("Erro ao carregar logo salva", e);
            }
        };
        loadSavedSettings();
    }, [db, selectedEventId]);

    // 3. Escutar ingressos gerados para o evento
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
        } catch (error) {
            console.error(error);
            alert("Erro ao ler o PDF.");
        } finally {
            setIsParsing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64String = event.target?.result as string;
            setFormData(prev => ({ ...prev, logoUrl: base64String }));
        };
        reader.readAsDataURL(file);
    };

    // FUNÇÃO PARA SALVAR A LOGO PERMANENTEMENTE NO BANCO
    const saveLogoToFirestore = async () => {
        if (!selectedEventId || !formData.logoUrl) return;
        setIsSavingLogo(true);
        try {
            const docRef = doc(db, 'events', selectedEventId, 'settings', 'main');
            await setDoc(docRef, { logoUrl: formData.logoUrl }, { merge: true });
            alert("Logo salva permanentemente para este evento!");
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar no banco.");
        } finally {
            setIsSavingLogo(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleGenerateBatch = async () => {
        if (!selectedEventId) return alert("Selecione um evento.");
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
                        pdfConfig: { ...formData }
                    }
                });
                batchCounter++;
                if (batchCounter >= 100) {
                    await currentBatch.commit();
                    currentBatch = writeBatch(db);
                    batchCounter = 0;
                }
            }
            if (batchCounter > 0) await currentBatch.commit();
            const zipBlob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(zipBlob);
            setLastZipUrl(url);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ingressos_${formData.eventName}.zip`;
            link.click();
        } catch (e) {
            console.error(e);
            alert("Erro ao gerar lote.");
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
                            <p className="text-orange-100 text-sm">Personalize e gere lotes de ingressos PDF.</p>
                        </div>
                    </div>
                    
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg flex items-center text-sm font-bold border border-white/20"
                    >
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf" className="hidden" />
                        <CloudUploadIcon className="w-4 h-4 mr-2" /> {isParsing ? "Lendo..." : "Ler PDF Base"}
                    </button>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* COLUNA 1: CONFIGS */}
                    <div className="space-y-6">
                        <div className="bg-gray-700/30 p-5 rounded-xl border border-gray-600">
                            <h2 className="text-sm font-bold text-orange-400 uppercase mb-4 flex items-center">
                                <TableCellsIcon className="w-4 h-4 mr-2" /> 1. Configuração do Lote
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] text-gray-500 uppercase font-bold mb-1">Evento de Destino (Scanner)</label>
                                    <select 
                                        value={selectedEventId}
                                        onChange={(e) => setSelectedEventId(e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white outline-none focus:border-orange-500"
                                    >
                                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] text-gray-500 uppercase font-bold mb-1">Quantidade</label>
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
                                <TicketIcon className="w-4 h-4 mr-2" /> 2. Dados do Ingresso
                            </h2>
                            <input name="sector" value={formData.sector} onChange={handleInputChange} placeholder="Setor" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            <input name="ownerName" value={formData.ownerName} onChange={handleInputChange} placeholder="Nome do Participante" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        </div>
                    </div>

                    {/* COLUNA 2: DADOS PDF E LOGO */}
                    <div className="space-y-4">
                        <h2 className="text-sm font-bold text-orange-400 uppercase mb-2 flex items-center">
                            <CloudDownloadIcon className="w-4 h-4 mr-2" /> 3. Layout do PDF
                        </h2>
                        <input name="eventName" value={formData.eventName} onChange={handleInputChange} placeholder="Nome do Evento" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        <div className="grid grid-cols-2 gap-4">
                            <input name="openingTime" value={formData.openingTime} onChange={handleInputChange} placeholder="Abertura" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                            <input name="venue" value={formData.venue} onChange={handleInputChange} placeholder="Local" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm" />
                        </div>
                        <textarea name="address" value={formData.address} onChange={handleInputChange} placeholder="Endereço" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm h-20" />
                        
                        {/* SEÇÃO DA LOGO PERSISTENTE */}
                        <div className="bg-gray-700/50 p-4 rounded-xl border border-gray-600">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center">
                                    <LinkIcon className="w-3 h-3 mr-1" /> Imagem da Logo
                                </span>
                                {formData.logoUrl && formData.logoUrl.startsWith('data:') && (
                                    <button 
                                        onClick={saveLogoToFirestore}
                                        disabled={isSavingLogo}
                                        className="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded font-bold uppercase transition-all flex items-center"
                                    >
                                        {isSavingLogo ? "Salvando..." : "Salvar Logo no Banco"}
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 bg-gray-900 rounded-lg border border-gray-600 flex items-center justify-center overflow-hidden shrink-0">
                                    {formData.logoUrl ? <img src={formData.logoUrl} className="w-full h-full object-contain" /> : <TableCellsIcon className="w-6 h-6 text-gray-700" />}
                                </div>
                                <div className="flex-1 space-y-2">
                                    <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                                    <button 
                                        onClick={() => logoInputRef.current?.click()}
                                        className="w-full bg-gray-700 hover:bg-gray-600 text-xs font-bold py-2 rounded-lg border border-gray-500 transition-all flex items-center justify-center"
                                    >
                                        <CloudUploadIcon className="w-3 h-3 mr-2" /> Upload de Logo
                                    </button>
                                    <input 
                                        name="logoUrl" 
                                        value={formData.logoUrl} 
                                        onChange={handleInputChange} 
                                        placeholder="Ou cole a URL..." 
                                        className="w-full bg-gray-900 border border-gray-600 rounded p-1.5 text-[10px] font-mono text-orange-300" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-700/50 p-6 flex flex-col items-center border-t border-gray-600">
                    <button 
                        onClick={handleGenerateBatch}
                        disabled={isGenerating || !selectedEventId}
                        className="w-full max-w-lg bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-2xl shadow-xl transition-all transform active:scale-95 disabled:opacity-50 text-lg flex items-center justify-center"
                    >
                        {isGenerating ? "Gerando Ingressos..." : "Gerar Lote ZIP"}
                    </button>
                </div>
            </div>

            {/* LISTA DE REGISTROS (Apenas para este evento) */}
            <div className="w-full max-w-5xl bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="font-bold flex items-center text-orange-500"><TableCellsIcon className="w-5 h-5 mr-2"/> Histórico de Gerados ({tickets.length})</h2>
                    <div className="relative w-48">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Filtrar..." className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:border-orange-500" />
                    </div>
                </div>
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-gray-800 text-gray-500 uppercase font-bold border-b border-gray-700">
                            <tr>
                                <th className="p-4">Código</th>
                                <th className="p-4">Participante</th>
                                <th className="p-4">Setor</th>
                                <th className="p-4 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {filteredTickets.map(t => (
                                <tr key={t.id} className="hover:bg-gray-700/30">
                                    <td className="p-4 font-mono text-orange-400">{t.id}</td>
                                    <td className="p-4">{t.details?.ownerName}</td>
                                    <td className="p-4">{t.sector}</td>
                                    <td className="p-4 text-right">
                                        <button onClick={() => deleteDoc(doc(db, 'events', selectedEventId, 'tickets', t.id))} className="text-gray-500 hover:text-red-500 p-2"><TrashIcon className="w-4 h-4"/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SecretTicketGenerator;

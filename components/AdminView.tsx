
import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { CloudDownloadIcon } from './Icons';

interface AdminViewProps {
  db: Firestore;
  events: Event[];
  selectedEvent: Event | null;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  onUpdateSectorNames: (newNames: string[]) => Promise<void>;
  isOnline: boolean;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

type ImportType = 'tickets' | 'participants' | 'buyers' | 'checkins' | 'custom';

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, onUpdateSectorNames, isOnline }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // Event Management State
    const [newEventName, setNewEventName] = useState('');
    const [renameEventName, setRenameEventName] = useState(selectedEvent?.name ?? '');

    // API Import State
    const [importType, setImportType] = useState<ImportType>('tickets');
    const [apiUrl, setApiUrl] = useState('https://public-api.stingressos.com.br/tickets');
    const [apiToken, setApiToken] = useState('');
    const [apiEventId, setApiEventId] = useState('');

    useEffect(() => {
        setEditableSectorNames(sectorNames);
    }, [sectorNames]);

    useEffect(() => {
        setRenameEventName(selectedEvent?.name ?? '');
    }, [selectedEvent]);
    
    useEffect(() => {
        if (!selectedEvent) {
            setActiveTab('events');
        }
    }, [selectedEvent]);

    const handleImportTypeChange = (type: ImportType) => {
        setImportType(type);
        switch (type) {
            case 'tickets':
                setApiUrl('https://public-api.stingressos.com.br/tickets');
                break;
            case 'participants':
                setApiUrl('https://public-api.stingressos.com.br/participants');
                break;
            case 'buyers':
                setApiUrl('https://public-api.stingressos.com.br/buyers');
                break;
            case 'checkins':
                setApiUrl('https://public-api.stingressos.com.br/checkins');
                break;
            default:
                setApiUrl('');
        }
    };

    const analyticsData: AnalyticsData = useMemo(() => {
        const validScans = scanHistory.filter(s => s.status === 'VALID');
        if (validScans.length === 0) {
            return {
                timeBuckets: [],
                firstAccess: null,
                lastAccess: null,
                peak: { time: '-', count: 0 },
            };
        }

        validScans.sort((a, b) => a.timestamp - b.timestamp);

        const firstAccess = validScans[0].timestamp;
        const lastAccess = validScans[validScans.length - 1].timestamp;

        const buckets = new Map<string, { [sector: string]: number }>();
        const TEN_MINUTES_MS = 10 * 60 * 1000;

        for (const scan of validScans) {
            const bucketStart = Math.floor(scan.timestamp / TEN_MINUTES_MS) * TEN_MINUTES_MS;
            const date = new Date(bucketStart);
            const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            
            if (!buckets.has(key)) {
                const initialCounts = sectorNames.reduce((acc, name) => ({ ...acc, [name]: 0 }), {});
                buckets.set(key, initialCounts);
            }
            const currentBucket = buckets.get(key)!;
            currentBucket[scan.ticketSector] = (currentBucket[scan.ticketSector] || 0) + 1;
        }

        let peak = { time: '-', count: 0 };

        const timeBuckets = Array.from(buckets.entries())
            .map(([time, counts]) => {
                const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                if (total > peak.count) {
                    peak = { time, count: total };
                }
                return { time, counts, total };
            })
            .sort((a, b) => a.time.localeCompare(b.time)); // Sort buckets chronologically

        return { timeBuckets, firstAccess, lastAccess, peak };
    }, [scanHistory, sectorNames]);

     const pieChartData = useMemo(() => {
        const usedTickets = allTickets.filter(t => t.status === 'USED');
        if (usedTickets.length === 0) return [];
        
        const counts = sectorNames.reduce((acc, sector) => {
            acc[sector] = usedTickets.filter(t => t.sector === sector).length;
            return acc;
        }, {} as Record<string, number>);

        return sectorNames.map((name, index) => ({
            name: name,
            value: counts[name],
            color: PIE_CHART_COLORS[index % PIE_CHART_COLORS.length],
        })).filter(item => item.value > 0);
    }, [allTickets, sectorNames]);

    const handleSaveSectorNames = async () => {
        if (editableSectorNames.some(name => name.trim() === '')) {
            alert('O nome de um setor não pode estar em branco.');
            return;
        }
        setIsSavingSectors(true);
        try {
            await onUpdateSectorNames(editableSectorNames);
            alert('Nomes dos setores salvos com sucesso!');
        } catch (error) {
            console.error("Failed to save sector names:", error);
            let message = 'Falha ao salvar nomes dos setores. Verifique sua conexão e tente novamente.';
            if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as { code: string };
                if (firebaseError.code === 'permission-denied') {
                    message = 'Erro: Permissão negada. Verifique se as regras de segurança do Firestore foram publicadas corretamente no console do Firebase.';
                } else {
                    message = `Falha ao salvar. Código do erro: ${firebaseError.code}. Verifique o console para mais detalhes.`;
                }
            }
            alert(message);
        } finally {
            setIsSavingSectors(false);
        }
    };
    
    const handleSectorNameChange = (index: number, newName: string) => {
        const updatedNames = [...editableSectorNames];
        updatedNames[index] = newName;
        setEditableSectorNames(updatedNames);
    };

    const handleAddSector = () => {
        setEditableSectorNames([...editableSectorNames, `Novo Setor ${editableSectorNames.length + 1}`]);
    };

    const handleRemoveSector = (indexToRemove: number) => {
        if (editableSectorNames.length <= 1) {
            alert('É necessário ter pelo menos um setor.');
            return;
        }
        const sectorNameToRemove = editableSectorNames[indexToRemove];
        if (allTickets.some(t => t.sector === sectorNameToRemove)) {
            if (!window.confirm(`Existem ingressos associados ao setor "${sectorNameToRemove}". Tem certeza que deseja removê-lo?`)) {
                return;
            }
        }
        setEditableSectorNames(editableSectorNames.filter((_, index) => index !== indexToRemove));
    };
    
    const handleTicketCodeChange = (sector: string, codes: string) => {
        setTicketCodes(prev => ({ ...prev, [sector]: codes }));
    };

    const handleImportFromApi = async () => {
        if (!selectedEvent) return;
        if (!apiUrl.trim()) {
            alert('A URL da API é obrigatória.');
            return;
        }

        setIsLoading(true);
        setLoadingMessage('Iniciando conexão...');
        
        try {
            // SETUP INITIAL URL
            const urlObj = new URL(apiUrl);
            
            // Add ID if provided
            if (apiEventId && !urlObj.searchParams.has('event_id')) {
                urlObj.searchParams.set('event_id', apiEventId);
            }
            
            // Request large batches.
            urlObj.searchParams.set('per_page', '500');
            urlObj.searchParams.set('limit', '500');
            
            // Ensure we start at page 1
            if (!urlObj.searchParams.has('page')) {
                urlObj.searchParams.set('page', '1');
            }

            const headers: HeadersInit = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            if (apiToken.trim()) {
                headers['Authorization'] = `Bearer ${apiToken.trim()}`;
            }

            const allItems: any[] = [];
            const seenIds = new Set<string>();
            
            let nextUrl: string | null = urlObj.toString();
            let pageCount = 0;
            const MAX_PAGES = 5000;

            // --- PAGINATION LOOP ---
            while (nextUrl && pageCount < MAX_PAGES) {
                pageCount++;
                const msg = `Baixando página ${pageCount} (Total importado: ${allItems.length})...`;
                setLoadingMessage(msg);
                
                // Force HTTPS
                if (nextUrl.startsWith('http://') && !nextUrl.startsWith('http://localhost')) {
                     nextUrl = nextUrl.replace('http://', 'https://');
                }

                // Small delay to prevent UI freeze and rate limiting
                await new Promise(resolve => setTimeout(resolve, 50));

                const response = await fetch(nextUrl, { headers });
                
                if (!response.ok) {
                    if (response.status === 404 && pageCount > 1) {
                         // End of list reached for some APIs
                         break;
                    }
                    throw new Error(`Erro na requisição (Página ${pageCount}): ${response.status} ${response.statusText}`);
                }

                const jsonResponse = await response.json();
                
                // Determine structure
                let pageItems: any[] = [];
                let metaRoot: any = jsonResponse; 

                if (Array.isArray(jsonResponse)) {
                    pageItems = jsonResponse;
                } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
                    // Standard Laravel Resource
                    pageItems = jsonResponse.data;
                    if (jsonResponse.meta) metaRoot = jsonResponse.meta;
                    if (jsonResponse.links) metaRoot = { ...metaRoot, ...jsonResponse.links }; // merge links for search
                } else if (jsonResponse.tickets && Array.isArray(jsonResponse.tickets)) {
                    pageItems = jsonResponse.tickets;
                } else if (jsonResponse.data && typeof jsonResponse.data === 'object' && jsonResponse.data.data && Array.isArray(jsonResponse.data.data)) {
                    // Nested
                    metaRoot = jsonResponse.data;
                    pageItems = jsonResponse.data.data;
                }

                if (pageItems.length === 0) {
                    break;
                }

                // --- DUPLICATE CHECK ---
                let newItemsCount = 0;
                pageItems.forEach((item: any) => {
                    const id = item.id || item.code || item.qr_code || item.ticket_code || item.uuid || JSON.stringify(item);
                    if (!seenIds.has(String(id))) {
                        seenIds.add(String(id));
                        newItemsCount++;
                    }
                });

                if (newItemsCount === 0 && allItems.length > 0) {
                     console.log("Stopping pagination: All items on this page are duplicates (Loop detection).");
                     break;
                }

                allItems.push(...pageItems);
                
                // --- NEXT PAGE DETERMINATION ---
                // Priority: Explicit "next_page_url" from API -> Manual Page Increment
                
                let foundNextLink: string | null = null;
                
                // Look for standard Laravel/JSON:API links
                if (metaRoot) {
                     if (metaRoot.next_page_url) foundNextLink = metaRoot.next_page_url;
                     else if (metaRoot.next) foundNextLink = metaRoot.next;
                }
                // Root level fallback
                if (!foundNextLink && jsonResponse.next_page_url) foundNextLink = jsonResponse.next_page_url;

                if (foundNextLink) {
                    nextUrl = foundNextLink;
                    
                    // RE-INJECT PARAMS: Ensure critical params persist if API drops them
                    try {
                        const urlCheck = new URL(nextUrl);
                        let changed = false;
                        if (apiEventId && !urlCheck.searchParams.has('event_id')) {
                            urlCheck.searchParams.set('event_id', apiEventId);
                            changed = true;
                        }
                        if (!urlCheck.searchParams.has('per_page') && !urlCheck.searchParams.has('limit')) {
                             urlCheck.searchParams.set('per_page', '500');
                             changed = true;
                        }
                        if (changed) nextUrl = urlCheck.toString();
                    } catch (e) {
                        console.warn('Could not parse nextUrl params', e);
                    }

                } else {
                    // Fallback: Manual pagination
                    // Only continue if we received a full page (or at least some items)
                    const currentUrlObj = new URL(nextUrl);
                    const currentPageNum = parseInt(currentUrlObj.searchParams.get('page') || String(pageCount));
                    
                    // If we suspect there are more pages (e.g., we got exactly the limit we asked for, or just 'some' items and no meta info says stop)
                    if (pageItems.length > 0) {
                        currentUrlObj.searchParams.set('page', String(currentPageNum + 1));
                        nextUrl = currentUrlObj.toString();
                    } else {
                        nextUrl = null;
                    }
                }
            }

            if (allItems.length === 0) {
                alert('Nenhum registro encontrado na resposta da API.');
                setIsLoading(false);
                setLoadingMessage('');
                return;
            }

            setLoadingMessage(`Processando ${allItems.length} registros...`);

            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            const ticketsToUpdateStatus: { id: string, usedAt: number }[] = [];

            // --- PROCESSING LOGIC ---
            
            if (importType === 'checkins' || apiUrl.includes('checkins')) {
                allItems.forEach((item: any) => {
                    const code = item.ticket_code || item.ticket_id || item.code || item.qr_code;
                    const timestampStr = item.created_at || item.checked_in_at || item.timestamp;
                    
                    if (code) {
                        const usedAt = timestampStr ? new Date(timestampStr).getTime() : Date.now();
                        ticketsToUpdateStatus.push({ id: String(code), usedAt });
                    }
                });

            } else {
                const processItem = (item: any) => {
                    const code = item.code || item.qr_code || item.ticket_code || item.barcode || item.id;
                    
                    let sector = item.sector || item.sector_name || item.section || item.setor || item.category || item.ticket_name || item.product_name || 'Geral';
                    if (typeof sector === 'object' && sector.name) sector = sector.name;

                    const ownerName = item.owner_name || item.name || item.participant_name || item.client_name || item.buyer_name || '';

                    if (item.tickets && Array.isArray(item.tickets)) {
                        item.tickets.forEach((subTicket: any) => {
                             if (!subTicket.owner_name && ownerName) subTicket.owner_name = ownerName;
                             processItem(subTicket);
                        });
                        return;
                    }

                    if (code) {
                        newSectors.add(String(sector));
                        ticketsToSave.push({
                            id: String(code),
                            sector: String(sector),
                            status: 'AVAILABLE',
                            details: {
                                ownerName: String(ownerName)
                            }
                        });
                    }
                };

                allItems.forEach(processItem);
            }

            // --- BATCH OPERATIONS ---

            // 1. Update Sector Names
            if (ticketsToSave.length > 0) {
                const currentSectorsSet = new Set(sectorNames);
                let sectorsUpdated = false;
                newSectors.forEach(s => {
                    if (!currentSectorsSet.has(s)) {
                        currentSectorsSet.add(s);
                        sectorsUpdated = true;
                    }
                });

                if (sectorsUpdated) {
                    const updatedSectorList = Array.from(currentSectorsSet);
                    await onUpdateSectorNames(updatedSectorList);
                    setEditableSectorNames(updatedSectorList);
                }
            }

            const BATCH_SIZE = 450;
            let savedCount = 0;
            let updatedCount = 0;

            // 2. Save Tickets
            if (ticketsToSave.length > 0) {
                setLoadingMessage('Salvando ingressos no banco de dados...');
                 const chunks = [];
                for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                    chunks.push(ticketsToSave.slice(i, i + BATCH_SIZE));
                }

                for (const chunk of chunks) {
                    const batch = writeBatch(db);
                    chunk.forEach(ticket => {
                        const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', ticket.id);
                        batch.set(ticketRef, {
                            sector: ticket.sector,
                            details: ticket.details,
                        }, { merge: true });
                    });
                    await batch.commit();
                    savedCount += chunk.length;
                }
            }

            // 3. Update Status
            if (ticketsToUpdateStatus.length > 0) {
                setLoadingMessage('Sincronizando check-ins...');
                const chunks = [];
                for (let i = 0; i < ticketsToUpdateStatus.length; i += BATCH_SIZE) {
                    chunks.push(ticketsToUpdateStatus.slice(i, i + BATCH_SIZE));
                }
                
                for (const chunk of chunks) {
                     const batch = writeBatch(db);
                     chunk.forEach(updateItem => {
                         const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', updateItem.id);
                         batch.set(ticketRef, {
                             status: 'USED',
                             usedAt: Timestamp.fromMillis(updateItem.usedAt)
                         }, { merge: true });
                     });
                     await batch.commit();
                     updatedCount += chunk.length;
                }
            }

            let msg = 'Processo concluído!\n';
            if (savedCount > 0) msg += `- ${savedCount} ingressos importados/atualizados.\n`;
            if (updatedCount > 0) msg += `- ${updatedCount} ingressos marcados como utilizados.\n`;
            
            alert(msg);
            
        } catch (error) {
            console.error('API Import Error:', error);
            alert(`Falha na importação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleSaveTickets = async () => {
        if (!selectedEvent) return;
        if ((Object.values(ticketCodes) as string[]).every(codes => !codes.trim())) {
            alert('Nenhum código de ingresso para salvar.');
            return;
        }
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const processCodes = (codes: string, sector: Sector) => {
                const codeList = codes.split('\n').map(c => c.trim()).filter(Boolean);
                codeList.forEach(code => {
                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', code);
                    batch.set(ticketRef, { 
                        sector: sector,
                        status: 'AVAILABLE',
                        usedAt: null,
                        details: {}
                    });
                });
            };
            
            for (const sector in ticketCodes) {
                if (sectorNames.includes(sector) && ticketCodes[sector].trim()) {
                    processCodes(ticketCodes[sector], sector);
                }
            }

            await batch.commit();
            alert('Ingressos salvos com sucesso!');
            setTicketCodes({});
        } catch (error) {
            console.error("Erro ao salvar ingressos: ", error);
            let message = 'Falha ao salvar ingressos. Verifique sua conexão e tente novamente.';
             if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as { code: string };
                if (firebaseError.code === 'permission-denied') {
                    message = 'Erro: Permissão negada. Verifique as regras de segurança do Firestore.';
                } else {
                    message = `Falha ao salvar. Código do erro: ${firebaseError.code}.`;
                }
            }
            alert(message);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownloadReport = () => {
        if (!selectedEvent) return;
        setIsGeneratingPdf(true);
        try {
            generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames);
        } catch (error) {
            console.error("Failed to generate PDF report:", error);
            alert("Ocorreu um erro ao gerar o relatório em PDF.");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleCreateEvent = async () => {
        if (!newEventName.trim()) {
            alert('O nome do evento não pode estar em branco.');
            return;
        }
        setIsLoading(true);
        try {
            const eventRef = await addDoc(collection(db, 'events'), {
                name: newEventName.trim(),
                isHidden: false,
            });
            await setDoc(doc(db, 'events', eventRef.id, 'settings', 'main'), {
                sectorNames: ['Pista', 'VIP']
            });
            alert(`Evento "${newEventName.trim()}" criado com sucesso!`);
            setNewEventName('');
        } catch (error) {
            console.error("Error creating event:", error);
            alert("Falha ao criar evento.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRenameEvent = async () => {
        if (!selectedEvent) return;
        if (!renameEventName.trim()) {
            alert('O nome do evento não pode estar em branco.');
            return;
        }
        if (renameEventName.trim() === selectedEvent.name) return;

        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', selectedEvent.id), {
                name: renameEventName.trim()
            });
            alert(`Evento renomeado para "${renameEventName.trim()}" com sucesso!`);
        } catch (error) {
            console.error("Error renaming event:", error);
            alert("Falha ao renomear evento.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleToggleEventVisibility = async (eventId: string, isHidden: boolean) => {
        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', eventId), { isHidden: !isHidden });
        } catch (error) {
            console.error("Error toggling event visibility:", error);
            alert("Falha ao alterar a visibilidade do evento.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (window.confirm(`Tem certeza que deseja apagar o evento "${eventName}"? Esta ação é irreversível e removerá todos os dados associados.`)) {
            setIsLoading(true);
            try {
                await deleteDoc(doc(db, 'events', eventId));
                alert(`Evento "${eventName}" apagado com sucesso.`);
            } catch (error) {
                console.error("Error deleting event:", error);
                alert("Falha ao apagar evento.");
            } finally {
                setIsLoading(false);
            }
        }
    };

    const NoEventSelectedMessage = () => (
        <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
            <p>Por favor, selecione um evento primeiro.</p>
            <p className="text-sm">Você pode criar um novo evento na aba "Gerenciar Eventos".</p>
        </div>
    );
  
    const renderContent = () => {
        if (!selectedEvent && activeTab !== 'events') {
            return <NoEventSelectedMessage />;
        }
        
        switch (activeTab) {
            case 'stats':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="space-y-6">
                        <div className="flex justify-end">
                             <button 
                                onClick={handleDownloadReport} 
                                disabled={isGeneratingPdf} 
                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                            >
                                {isGeneratingPdf ? 'Gerando...' : 'Baixar Relatório em PDF'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Stats allTickets={allTickets} sectorNames={sectorNames} />
                            <PieChart data={pieChartData} title="Distribuição de Entradas por Setor"/>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-4">Análise Temporal</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Primeiro Acesso</p>
                                    <p className="text-2xl font-bold text-green-300">
                                        {analyticsData.firstAccess ? new Date(analyticsData.firstAccess).toLocaleTimeString('pt-BR') : 'N/A'}
                                    </p>
                                </div>
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Último Acesso</p>
                                    <p className="text-2xl font-bold text-red-300">
                                        {analyticsData.lastAccess ? new Date(analyticsData.lastAccess).toLocaleTimeString('pt-BR') : 'N/A'}
                                    </p>
                                </div>
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Horário de Pico ({analyticsData.peak.time})</p>
                                    <p className="text-2xl font-bold text-orange-400">
                                        {analyticsData.peak.count} <span className="text-base font-normal">entradas</span>
                                    </p>
                                </div>
                            </div>
                            <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                        </div>
                    </div>
                );
            case 'settings':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3">Configurar Setores</h3>
                             <div className="space-y-3 mb-4">
                                {editableSectorNames.map((name, index) => (
                                    <div key={index} className="flex items-center space-x-2">
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => handleSectorNameChange(index, e.target.value)}
                                        placeholder={`Nome do Setor ${index + 1}`}
                                        className="flex-grow bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                    <button
                                        onClick={() => handleRemoveSector(index)}
                                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded disabled:bg-gray-500"
                                        disabled={editableSectorNames.length <= 1}
                                        aria-label={`Remover Setor ${name}`}
                                    >
                                        &times;
                                    </button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleAddSector} className="w-full bg-gray-600 hover:bg-gray-700 py-2 rounded font-bold mb-3">
                                Adicionar Novo Setor
                            </button>
                            <button
                                onClick={handleSaveSectorNames}
                                disabled={isSavingSectors || isLoading}
                                className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500"
                            >
                                {isSavingSectors ? 'Salvando...' : 'Salvar Nomes dos Setores'}
                            </button>
                        </div>
                        
                        <div className="space-y-6">
                            <div className="bg-gray-800 p-4 rounded-lg border border-orange-500/30">
                                <h3 className="text-lg font-semibold mb-3 text-orange-400 flex items-center">
                                    <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                    Importar Ingressos (API)
                                </h3>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-gray-400">Tipo de Dados / Fonte</label>
                                        <select
                                            value={importType}
                                            onChange={(e) => handleImportTypeChange(e.target.value as ImportType)}
                                            className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm mb-2"
                                        >
                                            <option value="tickets">Ingressos (Tickets)</option>
                                            <option value="participants">Participantes (Participants)</option>
                                            <option value="buyers">Compradores (Buyers)</option>
                                            <option value="checkins">Sincronizar Check-ins (Marcar como Usado)</option>
                                            <option value="custom">URL Personalizada</option>
                                        </select>

                                        <label className="text-xs text-gray-400">URL da API</label>
                                        <input
                                            type="text"
                                            value={apiUrl}
                                            onChange={(e) => setApiUrl(e.target.value)}
                                            className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-xs text-gray-400">API Token (Opcional)</label>
                                            <input
                                                type="password"
                                                value={apiToken}
                                                onChange={(e) => setApiToken(e.target.value)}
                                                placeholder="Bearer Token"
                                                className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">ID Evento Externo (Opcional)</label>
                                            <input
                                                type="text"
                                                value={apiEventId}
                                                onChange={(e) => setApiEventId(e.target.value)}
                                                placeholder="Ex: 123"
                                                className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleImportFromApi}
                                        disabled={isLoading}
                                        className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 flex justify-center items-center"
                                    >
                                        {isLoading ? (loadingMessage || 'Processando...') : 'Importar Dados'}
                                    </button>
                                    <p className="text-xs text-gray-500 mt-1">
                                        *Novos setores serão adicionados automaticamente.
                                        <br />*O sistema importará todas as páginas de resultados.
                                    </p>
                                </div>
                            </div>

                            <div className="bg-gray-800 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3">Gerenciar Ingressos Manualmente</h3>
                                <div className="space-y-3">
                                    {sectorNames.map((sector) => (
                                        <textarea
                                        key={sector}
                                        value={ticketCodes[sector] || ''}
                                        onChange={(e) => handleTicketCodeChange(sector, e.target.value)}
                                        placeholder={`Cole os códigos do setor "${sector}" aqui (um por linha)`}
                                        rows={3}
                                        className="w-full bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                    ))}
                                    <button onClick={handleSaveTickets} disabled={isLoading || isSavingSectors} className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold disabled:bg-gray-500">{isLoading ? 'Salvando...' : 'Salvar Ingressos no Banco de Dados'}</button>
                                    {!isOnline && <p className="text-xs text-yellow-400 text-center mt-2">Você está offline. Os ingressos serão salvos quando a conexão for restaurada.</p>}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'history':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'events':
                return (
                     <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-gray-800 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3">Criar Novo Evento</h3>
                                <div className="space-y-3">
                                    <input type="text" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Nome do Evento" className="w-full bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                    <button onClick={handleCreateEvent} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500">Criar Evento</button>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3">Lista de Eventos</h3>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                                    {events.map(event => (
                                        <div key={event.id} className="flex items-center justify-between bg-gray-700 p-2 rounded">
                                            <span className={`${event.isHidden ? 'text-gray-500 italic' : 'text-white'}`}>{event.name}</span>
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleToggleEventVisibility(event.id, event.isHidden || false)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded">
                                                    {event.isHidden ? 'Mostrar' : 'Ocultar'}
                                                </button>
                                                <button onClick={() => handleDeleteEvent(event.id, event.name)} className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 rounded">
                                                    Apagar
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {events.length === 0 && <p className="text-gray-500 text-sm text-center">Nenhum evento criado.</p>}
                                </div>
                            </div>

                             {selectedEvent && (
                                <div className="bg-gray-800 p-4 rounded-lg md:col-span-2">
                                    <h3 className="text-lg font-semibold mb-3">Renomear Evento Selecionado</h3>
                                    <div className="flex space-x-2">
                                        <input type="text" value={renameEventName} onChange={(e) => setRenameEventName(e.target.value)} className="flex-grow bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                        <button onClick={handleRenameEvent} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold disabled:bg-gray-500">Renomear</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-2">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded font-bold whitespace-nowrap ${activeTab === 'stats' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Dashboard e Stats</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded font-bold whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Configurações e Importação</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded font-bold whitespace-nowrap ${activeTab === 'history' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Histórico Completo</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded font-bold whitespace-nowrap ${activeTab === 'events' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Gerenciar Eventos</button>
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

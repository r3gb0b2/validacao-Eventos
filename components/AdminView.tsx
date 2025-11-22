import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, ValidationConfig, ValidationMode } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { CloudDownloadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, CogIcon } from './Icons';
import Papa from 'papaparse';

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

type ImportType = 'tickets' | 'participants' | 'buyers' | 'checkins' | 'custom' | 'google_sheets';

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

    // Import State
    const [importType, setImportType] = useState<ImportType>('tickets');
    const [importUrl, setImportUrl] = useState('https://public-api.stingressos.com.br/tickets');
    const [importToken, setImportToken] = useState('');
    const [importEventId, setImportEventId] = useState('');
    const [showImportToken, setShowImportToken] = useState(false);

    // Validation Config State
    const [validationMode, setValidationMode] = useState<ValidationMode>('OFFLINE');
    const [onlineUrls, setOnlineUrls] = useState<string[]>(['']);
    const [onlineToken, setOnlineToken] = useState('');
    const [onlineEventId, setOnlineEventId] = useState('');
    const [showOnlineToken, setShowOnlineToken] = useState(false);

    useEffect(() => {
        setEditableSectorNames(sectorNames);
    }, [sectorNames]);

    useEffect(() => {
        setRenameEventName(selectedEvent?.name ?? '');
    }, [selectedEvent]);
    
    useEffect(() => {
        if (!selectedEvent) {
            setActiveTab('events');
        } else {
            // Load validation config
             const unsubConfig = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'config'), (snap) => {
                if (snap.exists()) {
                    const data = snap.data() as ValidationConfig;
                    setValidationMode(data.mode || 'OFFLINE');
                    setOnlineUrls(data.onlineUrls?.length ? data.onlineUrls : ['']);
                    setOnlineToken(data.onlineToken || '');
                    setOnlineEventId(data.onlineEventId || '');
                }
            });

            // Load import settings (Pre-defined credentials)
            const unsubImport = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'import'), (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    setImportToken(data.token || '');
                    setImportEventId(data.eventId || '');
                } else {
                    // Reset fields if no settings exist for this event
                    setImportToken('');
                    setImportEventId('');
                }
            });

            return () => {
                unsubConfig();
                unsubImport();
            }
        }
    }, [selectedEvent, db]);

    const handleImportTypeChange = (type: ImportType) => {
        setImportType(type);
        // Do not clear token and eventID here, keep them for convenience
        
        switch (type) {
            case 'tickets': setImportUrl('https://public-api.stingressos.com.br/tickets'); break;
            case 'participants': setImportUrl('https://public-api.stingressos.com.br/participants'); break;
            case 'buyers': setImportUrl('https://public-api.stingressos.com.br/buyers'); break;
            case 'checkins': setImportUrl('https://public-api.stingressos.com.br/checkins'); break;
            case 'google_sheets': setImportUrl(''); break;
            default: setImportUrl('');
        }
    };

    const analyticsData: AnalyticsData = useMemo(() => {
        const validScans = scanHistory.filter(s => s.status === 'VALID');
        if (validScans.length === 0) {
            return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };
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
                if (total > peak.count) peak = { time, count: total };
                return { time, counts, total };
            })
            .sort((a, b) => a.time.localeCompare(b.time));

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
            alert('Falha ao salvar nomes dos setores.');
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
        setEditableSectorNames(editableSectorNames.filter((_, index) => index !== indexToRemove));
    };
    
    const handleTicketCodeChange = (sector: string, codes: string) => {
        setTicketCodes(prev => ({ ...prev, [sector]: codes }));
    };

    const handleDownloadTemplate = () => {
        const csvContent = "codigo,setor,nome\n123456,VIP,João Silva\n789012,Pista,Maria Souza";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "modelo_ingressos.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleSaveImportCredentials = async () => {
        if (!selectedEvent) return;
        setIsLoading(true);
        try {
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import'), {
                token: importToken,
                eventId: importEventId
            }, { merge: true });
            alert("Credenciais de importação salvas!");
        } catch(e) {
            alert("Erro ao salvar credenciais.");
        } finally {
            setIsLoading(false);
        }
    };

    // --- IMPORT LOGIC (RETAINED) ---
    const handleImportFromApi = async () => {
        if (!selectedEvent) return;
        if (!importUrl.trim()) { alert('A URL/Link é obrigatória.'); return; }

        setIsLoading(true);
        setLoadingMessage('Iniciando...');
        
        try {
            const allItems: any[] = [];
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            
            if (importType === 'google_sheets') {
                 setLoadingMessage('Baixando planilha...');
                 let fetchUrl = importUrl;
                 if (fetchUrl.includes('docs.google.com/spreadsheets') && !fetchUrl.includes('output=csv')) {
                     if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                 }
                 const response = await fetch(fetchUrl);
                 if (!response.ok) throw new Error('Falha ao baixar planilha.');
                 const csvText = await response.text();
                 const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                 const rows = parsed.data as any[];
                 setLoadingMessage(`Processando ${rows.length} linhas...`);

                 rows.forEach((row) => {
                     const normalizedRow: {[key: string]: string} = {};
                     Object.keys(row).forEach(k => { normalizedRow[k.toLowerCase().trim()] = row[k]; });
                     const code = normalizedRow['code'] || normalizedRow['código'] || normalizedRow['codigo'] || normalizedRow['id'] || normalizedRow['qr'] || normalizedRow['qrcode'];
                     let sector = normalizedRow['sector'] || normalizedRow['setor'] || normalizedRow['categoria'] || 'Geral';
                     const ownerName = normalizedRow['name'] || normalizedRow['nome'] || normalizedRow['cliente'] || '';
                     if (code) {
                         newSectors.add(sector);
                         ticketsToSave.push({ id: String(code).trim(), sector: String(sector).trim(), status: 'AVAILABLE', details: { ownerName: String(ownerName).trim() } });
                     }
                 });
            } else {
                 const urlObj = new URL(importUrl);
                 if (importEventId && !urlObj.searchParams.has('event_id')) urlObj.searchParams.set('event_id', importEventId);
                 urlObj.searchParams.set('per_page', '200');
                 urlObj.searchParams.set('limit', '200');
                 if (!urlObj.searchParams.has('page')) urlObj.searchParams.set('page', '1');

                 const headers: HeadersInit = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
                 if (importToken.trim()) headers['Authorization'] = `Bearer ${importToken.trim()}`;

                 let nextUrl: string | null = urlObj.toString();
                 let pageCount = 0;
                 const seenIds = new Set<string>();

                 while (nextUrl && pageCount < 200) { // Cap at 200 pages safety
                     pageCount++;
                     setLoadingMessage(`Baixando pág ${pageCount} (${allItems.length} itens)...`);
                     if (nextUrl.startsWith('http://') && !nextUrl.startsWith('http://localhost')) nextUrl = nextUrl.replace('http://', 'https://');
                     
                     const response = await fetch(nextUrl, { headers });
                     if (!response.ok) break;
                     const json = await response.json();
                     
                     // Extractor
                     let pageItems: any[] = [];
                     let meta: any = json;
                     if (Array.isArray(json)) pageItems = json;
                     else if (json.data && Array.isArray(json.data)) { pageItems = json.data; meta = json; }
                     else if (json.tickets) pageItems = json.tickets;
                     
                     if (pageItems.length === 0) break;
                     
                     pageItems.forEach((item: any) => {
                         const id = item.id || item.code || item.qr_code;
                         if (id && !seenIds.has(String(id))) {
                             seenIds.add(String(id));
                             allItems.push(item);
                         }
                     });

                     // Pagination
                     const hasNext = meta.next_page_url || (meta.links && meta.links.next);
                     if (hasNext) {
                         const tempUrl = new URL(hasNext);
                         if (importEventId) tempUrl.searchParams.set('event_id', importEventId);
                         tempUrl.searchParams.set('per_page', '200');
                         nextUrl = tempUrl.toString();
                     } else if (pageItems.length >= 15) {
                         // Speculative pagination
                         const cur = new URL(nextUrl);
                         const p = parseInt(cur.searchParams.get('page') || String(pageCount));
                         cur.searchParams.set('page', String(p + 1));
                         nextUrl = cur.toString();
                     } else {
                         nextUrl = null;
                     }
                 }
                 
                 // Process API Items
                 allItems.forEach((item: any) => {
                    const code = item.code || item.qr_code || item.ticket_code || item.id;
                    let sector = item.sector?.name || item.sector || item.section || 'Geral';
                    const name = item.owner_name || item.name || item.participant_name || '';
                    if (code) {
                        newSectors.add(String(sector));
                        ticketsToSave.push({ id: String(code), sector: String(sector), status: 'AVAILABLE', details: { ownerName: name } });
                    }
                 });
            }

            // Save
            if (ticketsToSave.length > 0) {
                setLoadingMessage('Salvando...');
                // Update sectors
                const currentSectors = new Set(sectorNames);
                let updated = false;
                newSectors.forEach(s => { if (!currentSectors.has(s)) { currentSectors.add(s); updated = true; }});
                if (updated) await onUpdateSectorNames(Array.from(currentSectors));

                // Batch save
                const BATCH = 450;
                for (let i = 0; i < ticketsToSave.length; i += BATCH) {
                    const batch = writeBatch(db);
                    ticketsToSave.slice(i, i+BATCH).forEach(t => {
                        batch.set(doc(db, 'events', selectedEvent!.id, 'tickets', t.id), { sector: t.sector, details: t.details }, { merge: true });
                    });
                    await batch.commit();
                }

                // Save credentials automatically on success
                if (importType !== 'google_sheets') {
                    await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import'), {
                        token: importToken,
                        eventId: importEventId
                    }, { merge: true });
                }

                alert(`${ticketsToSave.length} registros importados com sucesso!`);
            } else {
                alert('Nenhum registro encontrado. Verifique o ID do Evento.');
            }

        } catch (error) {
            console.error(error);
            alert('Erro ao realizar a importação. Verifique o console para mais detalhes.');
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleSaveConfig = async () => {
        if (!selectedEvent) return;
        const validUrls = onlineUrls.filter(u => u.trim() !== '');
        if (validationMode !== 'OFFLINE' && validUrls.length === 0) {
             alert('Adicione pelo menos uma URL para o modo Online.');
             return;
        }
        setIsLoading(true);
        try {
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'config'), {
                mode: validationMode,
                onlineUrls: validUrls,
                onlineToken,
                onlineEventId
            });
            alert('Configurações salvas com sucesso!');
        } catch (e) {
            alert('Erro ao salvar configurações.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveTickets = async () => {
        if (!selectedEvent) return;
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            for (const sector in ticketCodes) {
                if (ticketCodes[sector].trim()) {
                    ticketCodes[sector].split('\n').map(c => c.trim()).filter(Boolean).forEach(code => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), { 
                            sector, status: 'AVAILABLE', usedAt: null, details: {}
                        });
                    });
                }
            }
            await batch.commit();
            alert('Ingressos manuais salvos com sucesso!');
            setTicketCodes({});
        } catch (error) {
            alert('Erro ao salvar ingressos.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownloadReport = () => {
        if (!selectedEvent) return;
        setIsGeneratingPdf(true);
        try {
            generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames);
        } catch (error) { alert("Erro ao gerar PDF."); } finally { setIsGeneratingPdf(false); }
    };

    const handleCreateEvent = async () => {
        if (!newEventName.trim()) { alert("Nome do evento inválido"); return; }
        try {
            await addDoc(collection(db, 'events'), { name: newEventName, createdAt: serverTimestamp(), isHidden: false });
            setNewEventName('');
            alert("Evento criado com sucesso!");
        } catch (e) { alert("Erro ao criar evento."); }
    }; 
    
    const handleToggleEventVisibility = async (id: string, isHidden: boolean) => {
        try {
            await updateDoc(doc(db, 'events', id), { isHidden: !isHidden });
        } catch (e) { alert("Erro ao atualizar evento."); }
    };

    const NoEventSelectedMessage = () => (
        <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
            <p>Selecione um evento para começar.</p>
        </div>
    );
  
    const renderContent = () => {
        if (!selectedEvent && activeTab !== 'events') return <NoEventSelectedMessage />;
        
        switch (activeTab) {
            case 'stats': return (
                    <div className="space-y-6">
                        <div className="flex justify-end">
                             <button onClick={handleDownloadReport} disabled={isGeneratingPdf} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                {isGeneratingPdf ? 'Gerando...' : 'Baixar Relatório PDF'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Stats allTickets={allTickets} sectorNames={sectorNames} />
                            <div className="space-y-6">
                                <PieChart data={pieChartData} title="Distribuição de Acessos"/>
                                <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                            </div>
                        </div>
                    </div>
                );
            case 'settings': return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-6">
                            {/* SECTOR SETTINGS */}
                            <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
                                <h3 className="text-lg font-semibold mb-3 text-orange-400 border-b border-gray-700 pb-2">Configurar Setores</h3>
                                 <div className="space-y-2 mb-4">
                                    {editableSectorNames.map((name, index) => (
                                        <div key={index} className="flex items-center space-x-2">
                                        <input type="text" value={name} onChange={(e) => handleSectorNameChange(index, e.target.value)} className="flex-grow bg-gray-700 p-2 rounded border border-gray-600 focus:border-orange-500 outline-none" />
                                        <button onClick={() => handleRemoveSector(index)} className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded text-white font-bold">&times;</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleAddSector} className="flex-1 bg-gray-600 hover:bg-gray-500 py-2 rounded transition-colors">Adicionar</button>
                                    <button onClick={handleSaveSectorNames} className="flex-1 bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold transition-colors">Salvar</button>
                                </div>
                            </div>

                            {/* VALIDATION MODE CONFIG */}
                            <div className="bg-gray-800 p-4 rounded-lg border border-blue-500/50 shadow-lg">
                                <h3 className="text-lg font-semibold mb-3 flex items-center text-blue-400 border-b border-gray-700 pb-2">
                                    <CogIcon className="w-5 h-5 mr-2" />
                                    Modo de Validação
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex space-x-2 bg-gray-700 p-1 rounded">
                                        <button 
                                            onClick={() => setValidationMode('OFFLINE')}
                                            className={`flex-1 py-2 text-xs font-bold rounded transition-colors ${validationMode === 'OFFLINE' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Offline (Local)
                                        </button>
                                        <button 
                                            onClick={() => setValidationMode('ONLINE_API')}
                                            className={`flex-1 py-2 text-xs font-bold rounded transition-colors ${validationMode === 'ONLINE_API' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            API Online
                                        </button>
                                        <button 
                                            onClick={() => setValidationMode('ONLINE_SHEETS')}
                                            className={`flex-1 py-2 text-xs font-bold rounded transition-colors ${validationMode === 'ONLINE_SHEETS' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Planilha
                                        </button>
                                    </div>
                                    
                                    {validationMode !== 'OFFLINE' && (
                                        <div className="bg-gray-700/50 p-3 rounded space-y-3 border border-gray-600">
                                            <div>
                                                <div className="flex justify-between items-center mb-1">
                                                    <label className="text-xs text-gray-300 font-semibold">
                                                        {validationMode === 'ONLINE_SHEETS' ? 'Link Público CSV (Google Sheets)' : 'Lista de URLs da API (Check-ins)'}
                                                    </label>
                                                    {validationMode === 'ONLINE_SHEETS' && (
                                                        <button onClick={handleDownloadTemplate} className="text-xs text-orange-400 hover:text-orange-300 underline flex items-center">
                                                            <CloudDownloadIcon className="w-3 h-3 mr-1"/> Baixar Modelo
                                                        </button>
                                                    )}
                                                </div>
                                                {onlineUrls.map((url, i) => (
                                                    <div key={i} className="flex mb-2">
                                                        <input 
                                                            type="text" 
                                                            value={url} 
                                                            onChange={(e) => {const u = [...onlineUrls]; u[i] = e.target.value; setOnlineUrls(u);}}
                                                            placeholder={validationMode === 'ONLINE_SHEETS' ? 'https://docs.google.com/.../pub?output=csv' : 'https://api.site.com/v1'}
                                                            className="flex-grow bg-gray-900 border border-gray-600 p-2 rounded text-sm focus:border-blue-500 outline-none"
                                                        />
                                                        <button onClick={() => {const u = [...onlineUrls]; u.splice(i, 1); setOnlineUrls(u);}} className="ml-1 px-3 bg-red-600 hover:bg-red-700 rounded text-white">&times;</button>
                                                    </div>
                                                ))}
                                                <button onClick={() => setOnlineUrls([...onlineUrls, ''])} className="text-xs text-blue-300 hover:text-blue-200 underline">+ Adicionar URL</button>
                                            </div>

                                            {validationMode === 'ONLINE_API' && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="relative">
                                                        <label className="text-xs text-gray-300 font-semibold mb-1 block">Token (Senha)</label>
                                                        <input type={showOnlineToken ? "text" : "password"} value={onlineToken} onChange={(e) => setOnlineToken(e.target.value)} className="w-full bg-gray-900 border border-gray-600 p-2 rounded text-sm focus:border-blue-500 outline-none" />
                                                        <button onClick={() => setShowOnlineToken(!showOnlineToken)} className="absolute right-2 top-7 text-gray-400 hover:text-white">{showOnlineToken ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}</button>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-gray-300 font-semibold mb-1 block">ID Evento (Numérico)</label>
                                                        <input type="text" value={onlineEventId} onChange={(e) => setOnlineEventId(e.target.value)} className="w-full bg-gray-900 border border-gray-600 p-2 rounded text-sm focus:border-blue-500 outline-none" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <button onClick={handleSaveConfig} disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition-colors">Salvar Configuração</button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="space-y-6">
                             {/* IMPORT SECTION */}
                            <div className="bg-gray-800 p-4 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-semibold mb-3 text-orange-400 flex items-center border-b border-gray-700 pb-2">
                                    <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                    Importar Dados (Modo Offline)
                                </h3>
                                <div className="space-y-3">
                                    <label className="block text-xs text-gray-400">Fonte de Dados</label>
                                    <select value={importType} onChange={(e) => handleImportTypeChange(e.target.value as ImportType)} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm mb-2 focus:border-orange-500 outline-none">
                                        <option value="tickets">Ingressos (API Padrão)</option>
                                        <option value="google_sheets">Google Sheets (Link CSV)</option>
                                        <option value="participants">Lista de Participantes</option>
                                        <option value="buyers">Lista de Compradores</option>
                                        <option value="checkins">Histórico de Check-ins</option>
                                        <option value="custom">API Personalizada</option>
                                    </select>
                                    
                                    {importType === 'google_sheets' && (
                                        <div className="flex justify-end mb-2">
                                            <button onClick={handleDownloadTemplate} className="text-xs text-orange-400 hover:text-orange-300 underline flex items-center">
                                                <CloudDownloadIcon className="w-3 h-3 mr-1"/> Baixar Modelo Exemplo
                                            </button>
                                        </div>
                                    )}

                                    <input type="text" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="URL da API ou Link do CSV" className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm focus:border-orange-500 outline-none" />
                                    
                                    {importType !== 'google_sheets' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="relative">
                                                <input 
                                                    type={showImportToken ? "text" : "password"} 
                                                    value={importToken} 
                                                    onChange={(e) => setImportToken(e.target.value)} 
                                                    placeholder="Token (Opcional)" 
                                                    className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm focus:border-orange-500 outline-none pr-8" 
                                                />
                                                <button 
                                                    onClick={() => setShowImportToken(!showImportToken)}
                                                    className="absolute right-2 top-2 text-gray-400 hover:text-white"
                                                    tabIndex={-1}
                                                >
                                                    {showImportToken ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                                                </button>
                                            </div>
                                            <input 
                                                type="text" 
                                                value={importEventId} 
                                                onChange={(e) => setImportEventId(e.target.value)} 
                                                placeholder="ID Evento (Opcional)" 
                                                className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm focus:border-orange-500 outline-none" 
                                            />
                                        </div>
                                    )}
                                    
                                    {importType !== 'google_sheets' && (
                                        <button onClick={handleSaveImportCredentials} className="text-xs text-gray-400 hover:text-white underline w-full text-right mb-1">
                                            Salvar Acesso Padrão
                                        </button>
                                    )}

                                    <button onClick={handleImportFromApi} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 transition-colors">
                                        {isLoading ? loadingMessage : 'Importar para Banco de Dados'}
                                    </button>
                                </div>
                            </div>
                            {/* MANUAL ADD */}
                            <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
                                <h3 className="text-lg font-semibold mb-3 border-b border-gray-700 pb-2">Adicionar Manualmente</h3>
                                <p className="text-xs text-gray-400 mb-2">Cole os códigos abaixo (um por linha).</p>
                                {sectorNames.map((sector) => (
                                    <textarea key={sector} value={ticketCodes[sector] || ''} onChange={(e) => handleTicketCodeChange(sector, e.target.value)} placeholder={`Códigos para o setor: ${sector}`} rows={2} className="w-full bg-gray-700 p-2 mb-2 rounded border border-gray-600 text-sm focus:border-blue-500 outline-none" />
                                ))}
                                <button onClick={handleSaveTickets} disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold transition-colors">Salvar Ingressos Manuais</button>
                            </div>
                        </div>
                    </div>
                );
            case 'history': return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'events': return (
                <div className="grid grid-cols-1 gap-6">
                    <div className="bg-gray-800 p-4 rounded-lg flex items-center shadow-lg">
                        <input value={newEventName} onChange={(e)=>setNewEventName(e.target.value)} placeholder="Nome do Novo Evento" className="bg-gray-700 p-2 rounded mr-2 text-white flex-grow focus:border-orange-500 border border-gray-600 outline-none"/> 
                        <button onClick={handleCreateEvent} className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded font-bold transition-colors">Criar</button>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-lg space-y-2 shadow-lg">
                        <h3 className="text-lg font-semibold mb-2 border-b border-gray-700 pb-2">Gerenciar Eventos</h3>
                        {events.map(e => (
                            <div key={e.id} className={`p-3 rounded text-white flex justify-between items-center ${e.isHidden ? 'bg-gray-700/50' : 'bg-gray-700'}`}>
                                <span className={`font-medium ${e.isHidden ? 'text-gray-500 italic line-through' : ''}`}>{e.name}</span> 
                                <div className="flex space-x-2">
                                    <button onClick={() => handleToggleEventVisibility(e.id, e.isHidden || false)} className={`text-xs px-3 py-1 rounded font-semibold transition-colors ${e.isHidden ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-500'}`}>
                                        {e.isHidden ? 'Mostrar' : 'Ocultar'}
                                    </button>
                                </div>
                            </div>
                        ))}
                         {events.length === 0 && <p className="text-gray-500 text-center py-4">Nenhum evento encontrado.</p>}
                    </div>
                </div>
            );
            default: return null;
        }
    };

    const getTabLabel = (tab: string) => {
        switch(tab) {
            case 'stats': return 'Estatísticas';
            case 'settings': return 'Configurações';
            case 'history': return 'Histórico';
            case 'events': return 'Eventos';
            default: return tab;
        }
    }

    return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-2 shadow-md">
                {['stats', 'settings', 'history', 'events'].map(t => (
                    <button key={t} onClick={() => setActiveTab(t as any)} className={`px-4 py-2 rounded font-bold capitalize transition-all duration-200 ${activeTab === t ? 'bg-orange-600 text-white shadow-lg transform scale-105' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>
                        {getTabLabel(t)}
                    </button>
                ))}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;
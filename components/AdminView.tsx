
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import Scanner from './Scanner';
import SuperAdminView from './SuperAdminView'; // Import Super Admin Component
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc } from 'firebase/firestore';
import { CloudDownloadIcon, CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, QrCodeIcon, UsersIcon, LockClosedIcon, TicketIcon, PlusCircleIcon, FunnelIcon } from './Icons';
import Papa from 'papaparse';

interface AdminViewProps {
  db: Firestore;
  events: Event[];
  selectedEvent: Event | null;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  hiddenSectors?: string[];
  onUpdateSectorNames: (newNames: string[], hiddenSectors?: string[]) => Promise<void>;
  isOnline: boolean;
  onSelectEvent: (event: Event) => void;
  currentUser: User | null; // Added current user prop
  onUpdateCurrentUser?: (user: Partial<User>) => void;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

interface ImportPreset {
    id?: string;
    name: string;
    url: string;
    token: string;
    eventId: string;
}

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser, onUpdateCurrentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]); // Track visibility locally during edit
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // FIX: Added validationMode state to resolve "Cannot find name 'validationMode'" errors.
    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');

    // Event Management State
    const [newEventName, setNewEventName] = useState('');
    const [renameEventName, setRenameEventName] = useState(selectedEvent?.name ?? '');

    // Multi-Import State
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>('new');
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    
    // Auto Import Timer Ref
    const autoImportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Search Tab State
    const [searchType, setSearchType] = useState<'TICKET_LOCAL' | 'BUYER_API'>('TICKET_LOCAL');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<{ ticket: Ticket | undefined, logs: DisplayableScanLog[] } | null>(null);
    const [buyerSearchResults, setBuyerSearchResults] = useState<any[]>([]);
    const [showScanner, setShowScanner] = useState(false); // Scanner Modal State

    // "Localizadores" (Stand-by) State
    const [locatorCodes, setLocatorCodes] = useState('');
    const [selectedLocatorSector, setSelectedLocatorSector] = useState(sectorNames[0] || '');

    // Stats Configuration State
    const [statsViewMode, setStatsViewMode] = useState<'raw' | 'grouped'>('raw');
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
    const canManageEvents = currentUser?.role === 'ADMIN' || isSuperAdmin;

    // FIX: Initialize editable sector names and visibility from props when they change.
    useEffect(() => {
        if (sectorNames) {
            setEditableSectorNames(sectorNames);
            setSectorVisibility(sectorNames.map(name => !hiddenSectors.includes(name)));
        }
    }, [sectorNames, hiddenSectors]);

    // FIX: Load validation settings from Firestore whenever the selected event changes.
    useEffect(() => {
        if (!selectedEvent) return;
        const loadValidation = async () => {
            try {
                const vDoc = await getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'validation'));
                if (vDoc.exists() && vDoc.data().mode) {
                    setValidationMode(vDoc.data().mode);
                }
            } catch (e) { console.error("Error loading validation settings", e); }
        };
        loadValidation();
    }, [db, selectedEvent]);

    // Filter secret tickets from stats
    const nonSecretTickets = useMemo(() => {
        return allTickets.filter(t => t.source !== 'secret_generator');
    }, [allTickets]);

    const secretTicketIds = useMemo(() => {
        return new Set(allTickets.filter(t => t.source === 'secret_generator').map(t => t.id));
    }, [allTickets]);

    const nonSecretScanHistory = useMemo(() => {
        return scanHistory.filter(log => !secretTicketIds.has(log.ticketId));
    }, [scanHistory, secretTicketIds]);

    // Load Import Sources for current event
    useEffect(() => {
        if (!selectedEvent) return;
        const loadImportConfigs = async () => {
            try {
                const docRef = doc(db, 'events', selectedEvent.id, 'settings', 'import_v2');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    setImportSources(snap.data().sources || []);
                } else {
                    // Migration from single source if exists
                    const oldDocRef = doc(db, 'events', selectedEvent.id, 'settings', 'import');
                    const oldSnap = await getDoc(oldDocRef);
                    if (oldSnap.exists()) {
                        const data = oldSnap.data();
                        const initialSource: ImportSource = {
                            id: 'default',
                            name: 'API Principal',
                            url: data.url || 'https://public-api.stingressos.com.br/tickets',
                            token: data.token || '',
                            eventId: data.eventId || '',
                            type: 'tickets',
                            autoImport: false
                        };
                        setImportSources([initialSource]);
                        setActiveSourceId('default');
                    } else {
                        setImportSources([]);
                        setActiveSourceId('new');
                    }
                }
            } catch (e) { console.error("Error loading import configs", e); }
        };
        loadImportConfigs();
    }, [db, selectedEvent]);

    // Auto Import Manager
    useEffect(() => {
        if (!selectedEvent || importSources.length === 0) return;

        const runAutoImports = async () => {
            const sourcesToRun = importSources.filter(s => s.autoImport);
            if (sourcesToRun.length === 0) return;

            console.log(`Auto Import: Iniciando processamento de ${sourcesToRun.length} fontes.`);
            for (const source of sourcesToRun) {
                await executeImport(source, true);
            }
        };

        if (importSources.some(s => s.autoImport)) {
             // Run once on load
             runAutoImports();
             // Set interval (15 min)
             autoImportIntervalRef.current = setInterval(runAutoImports, 15 * 60 * 1000);
        } else {
            if (autoImportIntervalRef.current) clearInterval(autoImportIntervalRef.current);
        }

        return () => { if (autoImportIntervalRef.current) clearInterval(autoImportIntervalRef.current); };
    }, [importSources, selectedEvent]);

    const executeImport = async (source: ImportSource, isAuto = false) => {
        if (!selectedEvent) return;
        if (!isAuto) setIsLoading(true);
        
        try {
            const allItems: any[] = [];
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            const existingTicketIds = ignoreExisting ? new Set(allTickets.map(t => t.id)) : new Set();

            if (source.type === 'google_sheets') {
                 let fetchUrl = (source.url || '').trim();
                 if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                 const res = await fetch(fetchUrl);
                 const csvText = await res.text();
                 const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                 rows.forEach(row => {
                     const code = row['code'] || row['codigo'] || row['id'];
                     if (code && !existingTicketIds.has(String(code))) {
                         const sector = String(row['sector'] || row['setor'] || 'Geral');
                         ticketsToSave.push({ id: String(code), sector, status: 'AVAILABLE', details: { ownerName: row['name'] || row['nome'] } });
                         newSectors.add(sector);
                     }
                 });
            } else {
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if ((source.token || '').trim()) headers['Authorization'] = `Bearer ${(source.token || '').trim()}`;

                let page = 1;
                let hasMore = true;
                while (hasMore) {
                    if (!isAuto) setLoadingMessage(`[${source.name}] Baixando pág ${page}...`);
                    const urlObj = new URL((source.url || '').trim());
                    urlObj.searchParams.set('page', String(page));
                    urlObj.searchParams.set('per_page', '200');
                    if (source.eventId) urlObj.searchParams.set('event_id', source.eventId);
                    
                    const res = await fetch(urlObj.toString(), { headers });
                    const json = await res.json();
                    let pageItems = json.data || json.participants || json.tickets || json.buyers || (Array.isArray(json) ? json : []);
                    
                    if (pageItems.length === 0 || (json.last_page && page >= json.last_page)) hasMore = false;
                    
                    allItems.push(...pageItems);
                    page++;
                }
                
                allItems.forEach(item => {
                    const code = item.access_code || item.code || item.qr_code || item.id;
                    if (code && !existingTicketIds.has(String(code))) {
                        const sector = String(item.sector?.name || item.sector_name || item.category || 'Geral');
                        ticketsToSave.push({ id: String(code), sector, status: 'AVAILABLE', details: { ownerName: item.name, originalId: item.id } });
                        newSectors.add(sector);
                    }
                });
            }

            if (ticketsToSave.length > 0) {
                if (Array.from(newSectors).some(s => !sectorNames.includes(s))) {
                    await onUpdateSectorNames(Array.from(new Set([...sectorNames, ...newSectors])));
                }
                const BATCH_SIZE = 450;
                for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                    const chunk = ticketsToSave.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(t => batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true }));
                    await batch.commit();
                }
            }

            // Update last import time in state and DB
            const now = Date.now();
            setImportSources(prev => prev.map(s => s.id === source.id ? { ...s, lastImportTime: now } : s));
            
            if (!isAuto) alert(`Fonte [${source.name}]: ${ticketsToSave.length} novos ingressos importados.`);
        } catch (e) {
            console.error(`Import Error [${source.name}]:`, e);
            if (!isAuto) alert(`Erro na fonte [${source.name}]: ${e instanceof Error ? e.message : 'Desconhecido'}`);
        } finally {
            if (!isAuto) setIsLoading(false);
        }
    };

    const handleSaveSources = async (sources: ImportSource[]) => {
        if (!selectedEvent) return;
        try {
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources }, { merge: true });
        } catch (e) { console.error("Error saving sources", e); }
    };

    const handleAddUpdateSource = async (formData: Partial<ImportSource>) => {
        let newSources: ImportSource[];
        if (activeSourceId === 'new') {
            const newSource: ImportSource = {
                id: Math.random().toString(36).substr(2, 9),
                name: formData.name || 'Nova Fonte',
                url: formData.url || '',
                token: formData.token || '',
                eventId: formData.eventId || '',
                type: formData.type || 'tickets',
                autoImport: formData.autoImport || false
            };
            newSources = [...importSources, newSource];
        } else {
            newSources = importSources.map(s => s.id === activeSourceId ? { ...s, ...formData } : s);
        }
        setImportSources(newSources);
        await handleSaveSources(newSources);
        alert("Configuração salva!");
        if (activeSourceId === 'new') setActiveSourceId(newSources[newSources.length - 1].id);
    };

    const handleRemoveSource = async (id: string) => {
        if (!confirm("Remover esta fonte de importação?")) return;
        const newSources = importSources.filter(s => s.id !== id);
        setImportSources(newSources);
        await handleSaveSources(newSources);
        setActiveSourceId('new');
    };

    const handleRunManualImport = () => {
        if (activeSourceId === 'new') return alert("Selecione ou salve uma fonte primeiro.");
        const source = importSources.find(s => s.id === activeSourceId);
        if (source) executeImport(source);
    };

    const handleRunAllImports = async () => {
        if (importSources.length === 0) return;
        setIsLoading(true);
        for (const source of importSources) {
            setLoadingMessage(`Importando de ${source.name}...`);
            await executeImport(source, true);
        }
        setIsLoading(false);
        alert("Importação em massa concluída!");
    };

    const handleSaveStatsConfig = async (mode: 'raw' | 'grouped', groups: SectorGroup[]) => {
        if (!selectedEvent) return;
        setStatsViewMode(mode);
        setSectorGroups(groups);
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), { viewMode: mode, groups }, { merge: true });
    };

    const handleSearch = async (overrideQuery?: string) => {
        const queryToUse = overrideQuery || searchQuery;
        if (!(queryToUse || '').trim()) return;

        if (searchType === 'TICKET_LOCAL') {
            const ticket = allTickets.find(t => t.id === queryToUse.trim());
            const logs = scanHistory.filter(l => l.ticketId === queryToUse.trim()).sort((a,b) => b.timestamp - a.timestamp);
            setSearchResult({ ticket, logs });
        } else {
            // Online search logic using the currently active source if it has a token
            const activeSource = importSources.find(s => s.id === activeSourceId);
            if (!activeSource || !activeSource.token) {
                alert("Selecione uma fonte com Token configurado para busca online.");
                return;
            }
            setIsLoading(true);
            try {
                let urlObj = new URL(activeSource.url);
                const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                     pathSegments[pathSegments.length - 1] = 'participants';
                     urlObj.pathname = `/${pathSegments.join('/')}`;
                } else urlObj.pathname = '/participants';
                urlObj.searchParams.set('search', queryToUse);
                if (activeSource.eventId) urlObj.searchParams.set('event_id', activeSource.eventId);
                
                const res = await fetch(urlObj.toString(), { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${activeSource.token}` } });
                const json = await res.json();
                setBuyerSearchResults(json.data || json.participants || []);
            } catch (e) { alert("Erro na busca online."); } finally { setIsLoading(false); }
        }
    };

    const handleCopyPublicLink = () => {
        if (!selectedEvent) return;
        const url = `${window.location.origin}${window.location.pathname}?mode=stats&eventId=${selectedEvent.id}`;
        navigator.clipboard.writeText(url).then(() => alert("Link público copiado!"));
    };

    const currentSource = importSources.find(s => s.id === activeSourceId) || { name: '', url: '', token: '', eventId: '', type: 'tickets' as ImportType, autoImport: false };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p>Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats':
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-center"><h2 className="text-2xl font-bold">Dashboard</h2><div className="flex space-x-2"><button onClick={handleCopyPublicLink} className="bg-blue-600 p-2 rounded-lg text-sm flex items-center"><LinkIcon className="w-4 h-4 mr-1"/>Link Público</button><button onClick={() => generateEventReport(selectedEvent!.name, nonSecretTickets, nonSecretScanHistory, sectorNames)} disabled={isGeneratingPdf} className="bg-green-600 p-2 rounded-lg text-sm flex items-center"><CloudDownloadIcon className="w-4 h-4 mr-1"/>PDF</button></div></div>
                        <Stats allTickets={nonSecretTickets} sectorNames={sectorNames} viewMode={statsViewMode} onViewModeChange={m => handleSaveStatsConfig(m, sectorGroups)} groups={sectorGroups} onGroupsChange={g => handleSaveStatsConfig(statsViewMode, g)}/>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30">
                                <h3 className="text-lg font-bold mb-4 text-orange-400">Modo de Operação</h3>
                                <div className="space-y-2">
                                    <label><input type="radio" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} /> Offline</label>
                                    <label><input type="radio" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} /> Online (API)</label>
                                </div>
                                <button onClick={() => setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'validation'), { mode: validationMode }, { merge: true })} className="bg-green-600 w-full mt-2 p-2 rounded">Salvar Modo</button>
                             </div>
                             <div className="bg-gray-800 p-5 rounded-lg">
                                <h3 className="text-lg font-bold mb-3">Setores</h3>
                                <div className="space-y-2">
                                    {editableSectorNames.map((name, i) => (
                                        <div key={i} className="flex items-center space-x-2">
                                            <input value={name} onChange={e => { const n = [...editableSectorNames]; n[i] = e.target.value; setEditableSectorNames(n); }} className="flex-grow bg-gray-700 p-2 rounded"/>
                                            <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); }} className="p-1">{sectorVisibility[i] ? <EyeIcon className="w-5 h-5"/> : <EyeSlashIcon className="w-5 h-5 text-gray-500"/>}</button>
                                            <button onClick={() => { setEditableSectorNames(editableSectorNames.filter((_, idx) => idx !== i)); setSectorVisibility(sectorVisibility.filter((_, idx) => idx !== i)); }} className="bg-red-600 px-2 rounded font-bold">X</button>
                                        </div>
                                    ))}
                                    <button onClick={() => { setEditableSectorNames([...editableSectorNames, 'Novo Setor']); setSectorVisibility([...sectorVisibility, true]); }} className="text-sm text-blue-400">+ Adicionar Setor</button>
                                </div>
                                <button onClick={handleSaveSectorNames} className="bg-orange-600 w-full mt-3 p-2 rounded font-bold">Salvar Setores</button>
                             </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-lg border border-blue-500/20">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold text-blue-400">Importar Dados</h3>
                                    <button onClick={handleRunAllImports} className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded font-bold">Importar Tudo</button>
                                </div>
                                
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Selecionar Fonte de API</label>
                                <select 
                                    value={activeSourceId} 
                                    onChange={e => setActiveSourceId(e.target.value)} 
                                    className="w-full bg-gray-700 p-3 rounded mb-4 border border-gray-600 font-bold"
                                >
                                    <option value="new">+ Adicionar Nova API</option>
                                    {importSources.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} {s.autoImport ? ' (Auto)' : ''}</option>
                                    ))}
                                </select>

                                <div className="space-y-3 bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                                    <div>
                                        <label className="text-xs text-gray-500 uppercase">Nome Amigável</label>
                                        <input value={currentSource.name} onChange={e => handleAddUpdateSource({ name: e.target.value })} placeholder="Ex: API Store 1" className="w-full bg-gray-800 p-2 rounded text-sm"/>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 uppercase">Tipo / URL</label>
                                        <div className="flex gap-2">
                                            <select value={currentSource.type} onChange={e => handleAddUpdateSource({ type: e.target.value as ImportType })} className="bg-gray-800 p-2 rounded text-xs">
                                                <option value="tickets">Ingressos</option>
                                                <option value="participants">Participantes</option>
                                                <option value="google_sheets">Google Sheets</option>
                                            </select>
                                            <input value={currentSource.url} onChange={e => handleAddUpdateSource({ url: e.target.value })} placeholder="Endpoint" className="flex-1 bg-gray-800 p-2 rounded text-sm"/>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="text-xs text-gray-500 uppercase">Token</label>
                                            <input value={currentSource.token} onChange={e => handleAddUpdateSource({ token: e.target.value })} type="password" placeholder="Bearer Token" className="w-full bg-gray-800 p-2 rounded text-sm"/>
                                        </div>
                                        <div className="w-24">
                                            <label className="text-xs text-gray-500 uppercase">ID Evento</label>
                                            <input value={currentSource.eventId} onChange={e => handleAddUpdateSource({ eventId: e.target.value })} placeholder="ID" className="w-full bg-gray-800 p-2 rounded text-sm"/>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                                        <label className="flex items-center space-x-2 cursor-pointer">
                                            <input type="checkbox" checked={currentSource.autoImport} onChange={e => handleAddUpdateSource({ autoImport: e.target.checked })} className="rounded text-blue-600 bg-gray-800"/>
                                            <span className="text-xs font-bold text-gray-300">Auto-Importar (15m)</span>
                                        </label>
                                        {currentSource.lastImportTime && (
                                            <span className="text-[10px] text-gray-500">Última: {new Date(currentSource.lastImportTime).toLocaleTimeString()}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-4 flex gap-2">
                                    <button onClick={handleRunManualImport} disabled={isLoading || activeSourceId === 'new'} className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold text-sm disabled:opacity-50">
                                        {isLoading ? 'Importando...' : 'Importar Agora'}
                                    </button>
                                    {activeSourceId !== 'new' && (
                                        <button onClick={() => handleRemoveSource(activeSourceId)} className="bg-red-600 p-2 rounded hover:bg-red-700">
                                            <TrashIcon className="w-5 h-5"/>
                                        </button>
                                    )}
                                </div>
                                <div className="mt-4">
                                    <label className="text-xs flex items-center text-gray-400">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="mr-2"/>
                                        Ignorar ingressos já cadastrados
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'events':
                return (
                    <div className="space-y-6">
                        <div className="bg-gray-800 p-5 rounded-lg">
                            <h3 className="font-bold mb-4">Novo Evento</h3>
                            <div className="flex gap-2">
                                <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="Nome" className="flex-1 bg-gray-700 p-2 rounded"/>
                                <button onClick={handleCreateEvent} className="bg-orange-600 px-4 rounded font-bold">Criar</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-lg space-y-2">
                            <h3 className="font-bold mb-2">Eventos</h3>
                            {events.map(ev => (
                                <div key={ev.id} className="flex justify-between items-center bg-gray-700 p-2 rounded">
                                    <span>{ev.name}</span>
                                    <button onClick={() => onSelectEvent(ev)} className="bg-blue-600 text-xs px-3 py-1 rounded">Selecionar</button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'search': return <div className="bg-gray-800 p-6 rounded-lg">Search Content...</div>;
            case 'locators': return <div className="bg-gray-800 p-6 rounded-lg">Locators Content...</div>;
            case 'history': return <TicketList tickets={nonSecretScanHistory} sectorNames={sectorNames} />;
            case 'operators': return <div className="bg-gray-800 p-6 rounded-lg">Operators Content...</div>;
            default: return null;
        }
    };

    const handleCreateEvent = async () => {
        if (!newEventName.trim()) return;
        setIsLoading(true);
        try {
            const ref = await addDoc(collection(db, 'events'), { name: newEventName, isHidden: false });
            await setDoc(doc(db, 'events', ref.id, 'settings', 'main'), { sectorNames: ['Pista', 'VIP'] });
            alert("Evento criado!");
            setNewEventName('');
        } catch (e) { alert("Erro ao criar."); } finally { setIsLoading(false); }
    };

    const handleSaveSectorNames = async () => {
        if (!selectedEvent) return;
        setIsSavingSectors(true);
        try {
            const hidden = editableSectorNames.filter((_, i) => !sectorVisibility[i]);
            await onUpdateSectorNames(editableSectorNames, hidden);
            alert("Salvo!");
        } catch (e) { alert("Erro."); } finally { setIsSavingSectors(false); }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-1 custom-scrollbar border border-gray-700 items-center text-sm">
                <button onClick={() => setActiveTab('stats')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'stats' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'locators' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}><TicketIcon className="w-4 h-4 mr-1.5"/>Localizadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'history' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'events' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Eventos</button>
                <button onClick={() => setActiveTab('search')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'search' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Consultar</button>
                <button onClick={() => setActiveTab('operators')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'operators' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Operadores</button>
                {isSuperAdmin && (<div className="ml-auto pl-2 border-l border-gray-600"><button onClick={() => setActiveTab('users')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'users' ? 'bg-purple-600' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Usuários</button></div>)}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

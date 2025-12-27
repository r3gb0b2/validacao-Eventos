
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import Scanner from './Scanner';
import SuperAdminView from './SuperAdminView'; 
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
  currentUser: User | null;
  onUpdateCurrentUser?: (user: Partial<User>) => void;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser, onUpdateCurrentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');

    // Multi-Import State
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>('new');
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    
    // Local form state to prevent auto-save on keystroke
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({
        name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false
    });
    
    const autoImportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Form Temporary State for events
    const [newEventName, setNewEventName] = useState('');
    const [renameEventName, setRenameEventName] = useState(selectedEvent?.name ?? '');

    // Search Tab State
    const [searchType, setSearchType] = useState<'TICKET_LOCAL' | 'BUYER_API'>('TICKET_LOCAL');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<{ ticket: Ticket | undefined, logs: DisplayableScanLog[] } | null>(null);
    const [buyerSearchResults, setBuyerSearchResults] = useState<any[]>([]);
    const [showScanner, setShowScanner] = useState(false);

    // Stats Configuration State
    const [statsViewMode, setStatsViewMode] = useState<'raw' | 'grouped'>('raw');
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
    const canManageEvents = currentUser?.role === 'ADMIN' || isSuperAdmin;

    useEffect(() => {
        if (sectorNames) {
            setEditableSectorNames(sectorNames);
            setSectorVisibility(sectorNames.map(name => !hiddenSectors.includes(name)));
        }
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        if (!selectedEvent) return;
        const loadConfigs = async () => {
            try {
                const vDoc = await getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'validation'));
                if (vDoc.exists() && vDoc.data().mode) setValidationMode(vDoc.data().mode);

                const iDoc = await getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'));
                if (iDoc.exists()) {
                    setImportSources(iDoc.data().sources || []);
                } else {
                    const oldDoc = await getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import'));
                    if (oldDoc.exists()) {
                        const data = oldDoc.data();
                        const initial: ImportSource = {
                            id: 'default',
                            name: 'API Principal',
                            url: data.url || 'https://public-api.stingressos.com.br/tickets',
                            token: data.token || '',
                            eventId: data.eventId || '',
                            type: 'tickets',
                            autoImport: false
                        };
                        setImportSources([initial]);
                        setActiveSourceId('default');
                    }
                }
            } catch (e) { console.error("Error loading configs", e); }
        };
        loadConfigs();
    }, [db, selectedEvent]);

    // Update form when active source changes
    useEffect(() => {
        if (activeSourceId === 'new') {
            setEditSource({ name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false });
        } else {
            const found = importSources.find(s => s.id === activeSourceId);
            if (found) setEditSource({ ...found });
        }
    }, [activeSourceId, importSources]);

    useEffect(() => {
        if (!selectedEvent || importSources.length === 0) return;
        const runAutoImports = async () => {
            const sourcesToRun = importSources.filter(s => s.autoImport);
            if (sourcesToRun.length === 0) return;
            for (const source of sourcesToRun) {
                await executeImport(source, true);
            }
        };
        if (importSources.some(s => s.autoImport)) {
             runAutoImports();
             if (autoImportIntervalRef.current) clearInterval(autoImportIntervalRef.current);
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
                    if (!isAuto) setLoadingMessage(`[${source.name}] Pág ${page}...`);
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
            const now = Date.now();
            const updatedSources = importSources.map(s => s.id === source.id ? { ...s, lastImportTime: now } : s);
            setImportSources(updatedSources);
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources: updatedSources }, { merge: true });
            if (!isAuto) alert(`Fonte [${source.name}]: Importação finalizada.`);
        } catch (e) {
            console.error(`Import Error [${source.name}]:`, e);
            if (!isAuto) alert(`Erro na fonte [${source.name}]: ${e instanceof Error ? e.message : 'Erro'}`);
        } finally {
            if (!isAuto) setIsLoading(false);
        }
    };

    const handleSaveEditSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha ao menos Nome e URL.");
        
        let newSources: ImportSource[];
        if (activeSourceId === 'new') {
            const newSource: ImportSource = {
                id: Math.random().toString(36).substr(2, 9),
                name: editSource.name,
                url: editSource.url,
                token: editSource.token || '',
                eventId: editSource.eventId || '',
                type: editSource.type || 'tickets',
                autoImport: editSource.autoImport || false
            };
            newSources = [...importSources, newSource];
            setActiveSourceId(newSource.id);
        } else {
            newSources = importSources.map(s => s.id === activeSourceId ? { ...s, ...editSource } as ImportSource : s);
        }
        
        setImportSources(newSources);
        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: newSources }, { merge: true });
        alert("Fonte salva com sucesso!");
    };

    const handleRemoveSource = async (id: string) => {
        if (!confirm("Deseja remover esta fonte?")) return;
        const newSources = importSources.filter(s => s.id !== id);
        setImportSources(newSources);
        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: newSources }, { merge: true });
        setActiveSourceId('new');
    };

    const nonSecretTickets = useMemo(() => allTickets.filter(t => t.source !== 'secret_generator'), [allTickets]);
    const secretTicketIds = useMemo(() => new Set(allTickets.filter(t => t.source === 'secret_generator').map(t => t.id)), [allTickets]);
    const nonSecretScanHistory = useMemo(() => scanHistory.filter(log => !secretTicketIds.has(log.ticketId)), [scanHistory, secretTicketIds]);

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p>Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats':
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold">Dashboard</h2>
                            <div className="flex space-x-2">
                                <button onClick={() => {
                                    const url = `${window.location.origin}${window.location.pathname}?mode=stats&eventId=${selectedEvent!.id}`;
                                    navigator.clipboard.writeText(url).then(() => alert("Link copiado!"));
                                }} className="bg-blue-600 p-2 rounded-lg text-sm flex items-center"><LinkIcon className="w-4 h-4 mr-1"/>Link Público</button>
                                <button onClick={() => generateEventReport(selectedEvent!.name, nonSecretTickets, nonSecretScanHistory, sectorNames)} disabled={isGeneratingPdf} className="bg-green-600 p-2 rounded-lg text-sm flex items-center"><CloudDownloadIcon className="w-4 h-4 mr-1"/>PDF</button>
                            </div>
                        </div>
                        <Stats allTickets={nonSecretTickets} sectorNames={sectorNames} viewMode={statsViewMode} onViewModeChange={setStatsViewMode} groups={sectorGroups} onGroupsChange={setSectorGroups}/>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30">
                                <h3 className="text-lg font-bold mb-4 text-orange-400">Modo de Operação</h3>
                                <div className="space-y-2">
                                    <label className="flex items-center space-x-2"><input type="radio" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} className="text-orange-500"/> <span>Offline (BD Local)</span></label>
                                    <label className="flex items-center space-x-2"><input type="radio" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} className="text-orange-500"/> <span>Online (Validação via API)</span></label>
                                </div>
                                <button onClick={() => setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'validation'), { mode: validationMode }, { merge: true })} className="bg-green-600 w-full mt-4 p-2 rounded font-bold">Salvar Modo</button>
                             </div>
                             <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3">Setores</h3>
                                <div className="space-y-2">
                                    {editableSectorNames.map((name, i) => (
                                        <div key={i} className="flex items-center space-x-2">
                                            <input value={name} onChange={e => { const n = [...editableSectorNames]; n[i] = e.target.value; setEditableSectorNames(n); }} className="flex-grow bg-gray-700 p-2 rounded text-sm"/>
                                            <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); }} className="p-1">{sectorVisibility[i] ? <EyeIcon className="w-5 h-5"/> : <EyeSlashIcon className="w-5 h-5 text-gray-500"/>}</button>
                                            <button onClick={() => { if(confirm("Remover setor?")){ setEditableSectorNames(editableSectorNames.filter((_, idx) => idx !== i)); setSectorVisibility(sectorVisibility.filter((_, idx) => idx !== i)); }}} className="bg-red-600 px-2 py-1 rounded font-bold text-xs">X</button>
                                        </div>
                                    ))}
                                    <button onClick={() => { setEditableSectorNames([...editableSectorNames, 'Novo Setor']); setSectorVisibility([...sectorVisibility, true]); }} className="text-sm text-blue-400 mt-2 hover:underline">+ Adicionar Setor</button>
                                </div>
                                <button onClick={async () => {
                                    setIsSavingSectors(true);
                                    const hidden = editableSectorNames.filter((_, i) => !sectorVisibility[i]);
                                    await onUpdateSectorNames(editableSectorNames, hidden);
                                    setIsSavingSectors(false);
                                    alert("Setores salvos!");
                                }} disabled={isSavingSectors} className="bg-orange-600 w-full mt-4 p-2 rounded font-bold">Salvar Configuração de Setores</button>
                             </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-lg border border-blue-500/20">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold text-blue-400">Importar Dados (Multi-API)</h3>
                                    <button onClick={async () => {
                                        if (importSources.length === 0) return;
                                        setIsLoading(true);
                                        for (const s of importSources) {
                                            setLoadingMessage(`Importando ${s.name}...`);
                                            await executeImport(s, true);
                                        }
                                        setIsLoading(false);
                                        alert("Processamento concluído!");
                                    }} className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded font-bold">Rodar Todas Agora</button>
                                </div>
                                
                                <div className="mb-4">
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Selecionar Fonte para Editar</label>
                                    <select 
                                        value={activeSourceId} 
                                        onChange={e => setActiveSourceId(e.target.value)} 
                                        className="w-full bg-gray-700 p-3 rounded border border-gray-600 font-bold focus:border-blue-500 outline-none"
                                    >
                                        <option value="new">+ Adicionar Nova API / Planilha</option>
                                        {importSources.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} {s.autoImport ? ' (AUTO)' : ''}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-3 bg-gray-900/50 p-4 rounded-lg border border-gray-700 mb-4 transition-all">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] text-gray-500 uppercase font-bold">Nome da Fonte</label>
                                            <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Ex: API Store 1" className="w-full bg-gray-800 p-2 rounded text-sm border border-gray-700"/>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-500 uppercase font-bold">Tipo de Recurso</label>
                                            <select value={editSource.type} onChange={e => setEditSource({...editSource, type: e.target.value as ImportType})} className="w-full bg-gray-800 p-2 rounded text-sm border border-gray-700">
                                                <option value="tickets">Ingressos</option>
                                                <option value="participants">Participantes</option>
                                                <option value="google_sheets">Google Sheets (CSV)</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-500 uppercase font-bold">URL / Endpoint</label>
                                        <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="https://..." className="w-full bg-gray-800 p-2 rounded text-sm border border-gray-700 font-mono"/>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="text-[10px] text-gray-500 uppercase font-bold">Token (Bearer)</label>
                                            <input value={editSource.token} onChange={e => setEditSource({...editSource, token: e.target.value})} type="password" placeholder="Token" className="w-full bg-gray-800 p-2 rounded text-sm border border-gray-700"/>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-500 uppercase font-bold">ID Evento API</label>
                                            <input value={editSource.eventId} onChange={e => setEditSource({...editSource, eventId: e.target.value})} placeholder="ID" className="w-full bg-gray-800 p-2 rounded text-sm border border-gray-700"/>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})} className="rounded text-blue-600 bg-gray-800 border-gray-600 focus:ring-0 w-4 h-4"/>
                                            <span className="text-xs font-bold text-gray-300 group-hover:text-blue-400">Ativar Auto-Importação (15m)</span>
                                        </label>
                                        {activeSourceId !== 'new' && importSources.find(s=>s.id===activeSourceId)?.lastImportTime && (
                                            <div className="text-[10px] text-gray-500 flex items-center">
                                                <ClockIcon className="w-3 h-3 mr-1"/> {new Date(importSources.find(s=>s.id===activeSourceId)!.lastImportTime!).toLocaleTimeString('pt-BR')}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <button 
                                        onClick={handleSaveEditSource} 
                                        className="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold text-xs transition-colors mt-2"
                                    >
                                        {activeSourceId === 'new' ? 'Adicionar Nova Fonte' : 'Salvar Configuração desta Fonte'}
                                    </button>
                                </div>

                                <div className="flex gap-2">
                                    <button onClick={() => { if(activeSourceId !== 'new') executeImport(importSources.find(s => s.id === activeSourceId)!) }} disabled={isLoading || activeSourceId === 'new'} className="flex-grow bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold text-sm disabled:opacity-50 transition-colors">
                                        {isLoading ? 'Importando...' : 'Importar Esta Fonte Agora'}
                                    </button>
                                    {activeSourceId !== 'new' && (
                                        <button onClick={() => handleRemoveSource(activeSourceId)} className="bg-red-600 p-2 rounded hover:bg-red-700 transition-colors" title="Excluir">
                                            <TrashIcon className="w-5 h-5"/>
                                        </button>
                                    )}
                                </div>
                                
                                <div className="mt-6 border-t border-gray-700 pt-4">
                                    <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-2">Status das Fontes Configuradas</h4>
                                    <div className="space-y-2">
                                        {importSources.length === 0 ? (
                                            <p className="text-xs text-gray-600 italic">Nenhuma fonte cadastrada.</p>
                                        ) : importSources.map(s => (
                                            <div key={s.id} className="flex items-center justify-between bg-gray-900/30 p-2 rounded border border-gray-800">
                                                <div className="flex items-center">
                                                    <div className={`w-2 h-2 rounded-full mr-2 ${s.autoImport ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`}></div>
                                                    <span className="text-xs font-bold truncate max-w-[120px]">{s.name}</span>
                                                </div>
                                                <div className="text-[10px] text-gray-500">
                                                    {s.lastImportTime ? `Última: ${new Date(s.lastImportTime).toLocaleTimeString()}` : 'Nunca rodou'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/20 rounded">
                                    <label className="flex items-center text-xs text-blue-300 font-medium cursor-pointer">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="mr-2 rounded text-blue-600 bg-gray-800"/>
                                        Ignorar códigos já presentes no banco
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'events':
                return (
                    <div className="space-y-6">
                        <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                            <h3 className="font-bold mb-4 flex items-center"><PlusCircleIcon className="w-5 h-5 mr-2 text-orange-500"/> Criar Novo Evento</h3>
                            <div className="flex gap-2">
                                <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="Nome do Evento" className="flex-1 bg-gray-700 p-3 rounded border border-gray-600 outline-none focus:border-orange-500"/>
                                <button onClick={async () => {
                                    if(!newEventName.trim()) return;
                                    setIsLoading(true);
                                    try {
                                        const ref = await addDoc(collection(db, 'events'), { name: newEventName, isHidden: false });
                                        await setDoc(doc(db, 'events', ref.id, 'settings', 'main'), { sectorNames: ['Pista', 'VIP'] });
                                        alert("Evento criado com sucesso!");
                                        setNewEventName('');
                                    } catch (e) { alert("Falha ao criar evento."); } finally { setIsLoading(false); }
                                }} className="bg-orange-600 px-6 rounded font-bold hover:bg-orange-700 transition-colors">Criar</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                            <h3 className="font-bold mb-3 text-gray-400 text-sm uppercase">Meus Eventos</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {events.map(ev => (
                                    <div key={ev.id} className="flex justify-between items-center bg-gray-700/50 p-3 rounded hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-600">
                                        <span className="font-bold">{ev.name}</span>
                                        <button onClick={() => onSelectEvent(ev)} className="bg-blue-600 text-xs px-4 py-1.5 rounded font-bold hover:bg-blue-500">Gerenciar</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'search': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Selecione o campo de busca no painel superior.</div>;
            case 'locators': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Gerencie localizadores aqui.</div>;
            case 'history': return <TicketList tickets={nonSecretScanHistory} sectorNames={sectorNames} />;
            case 'operators': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Monitoramento de operadores em tempo real.</div>;
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-1 custom-scrollbar border border-gray-700 items-center text-sm shadow-xl">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-all ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-all ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap flex items-center transition-all ${activeTab === 'locators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><TicketIcon className="w-4 h-4 mr-1.5"/>Localizadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-all ${activeTab === 'history' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-all ${activeTab === 'events' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Eventos</button>
                <button onClick={() => setActiveTab('search')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-all ${activeTab === 'search' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Consultar</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap flex items-center transition-all ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Operadores</button>
                {isSuperAdmin && (<div className="ml-auto pl-2 border-l border-gray-600"><button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap flex items-center transition-all ${activeTab === 'users' ? 'bg-purple-600 shadow-lg scale-105' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Usuários</button></div>)}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

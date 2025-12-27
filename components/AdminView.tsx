
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import SuperAdminView from './SuperAdminView'; 
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc, getDocs } from 'firebase/firestore';
// FIX: Added missing TableCellsIcon to the import list.
import { CloudDownloadIcon, CloudUploadIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, QrCodeIcon, UsersIcon, LockClosedIcon, TicketIcon, PlusCircleIcon, FunnelIcon, VideoCameraIcon, TableCellsIcon } from './Icons';
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

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser, onUpdateCurrentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // Gestão de Usuários e Eventos
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [assigningEventId, setAssigningEventId] = useState<string | null>(null);

    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');

    // Configurações de Importação
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>('new');
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({
        name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false
    });
    
    const autoImportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [newEventName, setNewEventName] = useState('');
    const [locatorCodes, setLocatorCodes] = useState('');
    const [selectedLocatorSector, setSelectedLocatorSector] = useState(sectorNames[0] || '');

    const [statsViewMode, setStatsViewMode] = useState<'raw' | 'grouped'>('raw');
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.username === 'Administrador';

    // Carrega usuários para gestão de eventos
    useEffect(() => {
        if ((activeTab === 'events' || activeTab === 'users') && isSuperAdmin) {
            const fetchUsers = async () => {
                try {
                    const snap = await getDocs(collection(db, 'users'));
                    setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
                } catch (e) { console.error("Erro ao carregar usuários:", e); }
            };
            fetchUsers();
        }
    }, [db, isSuperAdmin, activeTab]);

    useEffect(() => {
        if (sectorNames) {
            setEditableSectorNames(sectorNames);
            setSectorVisibility(sectorNames.map(name => !hiddenSectors.includes(name)));
            if (!selectedLocatorSector && sectorNames.length > 0) setSelectedLocatorSector(sectorNames[0]);
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
                    setIgnoreExisting(iDoc.data().ignoreExisting !== false);
                }
            } catch (e) { console.error("Error loading configs", e); }
        };
        loadConfigs();
    }, [db, selectedEvent]);

    // Lógica de Auto-Importação (10 min)
    useEffect(() => {
        if (autoImportIntervalRef.current) clearInterval(autoImportIntervalRef.current);
        
        const sourcesToAuto = importSources.filter(s => s.autoImport);
        if (sourcesToAuto.length > 0 && selectedEvent) {
            autoImportIntervalRef.current = setInterval(() => {
                console.log("Executando auto-import de 10 minutos...");
                sourcesToAuto.forEach(s => executeImport(s, true));
            }, 600000); // 10 minutos
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
            
            // Lógica de ignorar existentes (se ativo, não sobrescreve os que já estão no banco)
            const existingTicketIds = ignoreExisting ? new Set(allTickets.map(t => t.id)) : new Set();

            if (source.type === 'google_sheets') {
                 let fetchUrl = (source.url || '').trim();
                 if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                 const res = await fetch(fetchUrl);
                 const csvText = await res.text();
                 const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                 rows.forEach(row => {
                     const code = String(row['code'] || row['codigo'] || row['id']).trim();
                     if (code && !existingTicketIds.has(code)) {
                         const sector = String(row['sector'] || row['setor'] || 'Geral');
                         ticketsToSave.push({ id: code, sector, status: 'AVAILABLE', details: { ownerName: row['name'] || row['nome'] } });
                         newSectors.add(sector);
                     }
                 });
            } else {
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if ((source.token || '').trim()) headers['Authorization'] = `Bearer ${(source.token || '').trim()}`;
                
                let page = 1;
                let hasMore = true;
                while (hasMore) {
                    const urlObj = new URL((source.url || '').trim());
                    urlObj.searchParams.set('page', String(page));
                    urlObj.searchParams.set('per_page', '500');
                    if (source.eventId) urlObj.searchParams.set('event_id', source.eventId);
                    
                    const res = await fetch(urlObj.toString(), { headers });
                    const json = await res.json();
                    let pageItems = json.data || json.participants || json.tickets || json.buyers || (Array.isArray(json) ? json : []);
                    
                    if (pageItems.length === 0 || (json.last_page && page >= json.last_page)) {
                        hasMore = false;
                    }
                    allItems.push(...pageItems);
                    page++;
                    if (page > 50) break; // Trava de segurança
                }

                allItems.forEach(item => {
                    const code = String(item.access_code || item.code || item.qr_code || item.id).trim();
                    if (code && !existingTicketIds.has(code)) {
                        const sector = String(item.sector?.name || item.sector_name || item.category || 'Geral');
                        ticketsToSave.push({ id: code, sector, status: 'AVAILABLE', details: { ownerName: item.name, originalId: item.id } });
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
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources: updatedSources, ignoreExisting }, { merge: true });
        } catch (e) { 
            console.error(e); 
            if (!isAuto) alert("Erro na importação: " + (e as any).message);
        } finally { if (!isAuto) setIsLoading(false); }
    };

    const handleSaveEditSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha ao menos Nome e URL.");
        let newSources: ImportSource[];
        if (activeSourceId === 'new') {
            const newSource: ImportSource = {
                id: Math.random().toString(36).substr(2, 9),
                name: editSource.name!,
                url: editSource.url!,
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
        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: newSources, ignoreExisting }, { merge: true });
        alert("Fonte salva!");
        setEditSource({ name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false });
        setActiveSourceId('new');
    };

    const handleToggleUserAccess = async (userId: string, eventId: string) => {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;
        const currentAllowed = Array.isArray(user.allowedEvents) ? user.allowedEvents : [];
        const newAllowed = currentAllowed.includes(eventId) ? currentAllowed.filter(id => id !== eventId) : [...currentAllowed, eventId];
        try {
            setAllUsers(allUsers.map(u => u.id === userId ? { ...u, allowedEvents: newAllowed } : u));
            await updateDoc(doc(db, 'users', userId), { allowedEvents: newAllowed });
        } catch (e) { alert("Erro ao salvar permissão."); }
    };

    const handleProcessLocators = async () => {
        if (!selectedEvent || !locatorCodes.trim() || !selectedLocatorSector) return;
        setIsLoading(true);
        try {
            const codes = locatorCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
            const batch = writeBatch(db);
            codes.forEach(code => {
                batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), {
                    sector: selectedLocatorSector,
                    status: 'AVAILABLE',
                    source: 'manual_locator',
                    details: { ownerName: 'LOCALIZADOR MANUAL', eventName: selectedEvent.name }
                }, { merge: true });
            });
            await batch.commit();
            setLocatorCodes('');
            alert("Processado!");
        } catch (e) { alert("Erro."); } finally { setIsLoading(false); }
    };

    const nonSecretTickets = useMemo(() => allTickets.filter(t => t.source !== 'secret_generator'), [allTickets]);
    const secretTicketIds = useMemo(() => new Set(allTickets.filter(t => t.source === 'secret_generator').map(t => t.id)), [allTickets]);
    const nonSecretScanHistory = useMemo(() => scanHistory.filter(log => !secretTicketIds.has(log.ticketId)), [scanHistory, secretTicketIds]);
    const manualLocatorTickets = useMemo(() => allTickets.filter(t => t.source === 'manual_locator'), [allTickets]);

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
                        <Stats allTickets={nonSecretTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode={statsViewMode} onViewModeChange={setStatsViewMode} groups={sectorGroups} onGroupsChange={setSectorGroups}/>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-bold mb-4 text-orange-400">Modo de Operação</h3>
                                <div className="space-y-3">
                                    <label className="flex items-center space-x-3 p-2 rounded hover:bg-gray-700 cursor-pointer">
                                        <input type="radio" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} className="w-4 h-4 text-orange-500"/> 
                                        <span>Offline (Base Local)</span>
                                    </label>
                                    <label className="flex items-center space-x-3 p-2 rounded hover:bg-gray-700 cursor-pointer">
                                        <input type="radio" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} className="w-4 h-4 text-orange-500"/> 
                                        <span>Online (API Externa)</span>
                                    </label>
                                </div>
                                <button onClick={() => setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'validation'), { mode: validationMode }, { merge: true })} className="bg-green-600 w-full mt-4 p-2 rounded font-bold shadow-lg hover:bg-green-700">Salvar Modo</button>
                             </div>

                             <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3">Setores do Evento</h3>
                                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                                    {editableSectorNames.map((name, i) => (
                                        <div key={i} className="flex items-center space-x-2">
                                            <input value={name} onChange={e => { const n = [...editableSectorNames]; n[i] = e.target.value; setEditableSectorNames(n); }} className="flex-grow bg-gray-700 p-2 rounded text-sm border border-gray-600"/>
                                            <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); }} className="p-2 bg-gray-700 rounded hover:bg-gray-600 transition-colors">
                                                {sectorVisibility[i] ? <EyeIcon className="w-5 h-5 text-blue-400"/> : <EyeSlashIcon className="w-5 h-5 text-gray-500"/>}
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={() => { setEditableSectorNames([...editableSectorNames, 'Novo Setor']); setSectorVisibility([...sectorVisibility, true]); }} className="text-sm text-orange-400 mt-2 hover:underline flex items-center"><PlusCircleIcon className="w-4 h-4 mr-1"/> Adicionar Setor</button>
                                </div>
                                <button onClick={async () => {
                                    setIsSavingSectors(true);
                                    const hidden = editableSectorNames.filter((_, i) => !sectorVisibility[i]);
                                    await onUpdateSectorNames(editableSectorNames, hidden);
                                    setIsSavingSectors(false);
                                    alert("Setores salvos!");
                                }} disabled={isSavingSectors} className="bg-orange-600 w-full mt-4 p-2 rounded font-bold shadow-lg">Salvar Configuração</button>
                             </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-lg border border-blue-500/20 shadow-lg">
                                <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center"><CloudUploadIcon className="w-5 h-5 mr-2"/> Importar Dados (APIs)</h3>
                                
                                <div className="bg-gray-900/50 p-3 rounded border border-gray-700 mb-4">
                                    <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="rounded text-blue-500 bg-gray-800"/>
                                        <span>Ignorar códigos já existentes (não apagar validações)</span>
                                    </label>
                                </div>

                                <div className="space-y-3 bg-gray-900/30 p-4 rounded-xl border border-gray-700">
                                    <p className="text-xs font-bold text-gray-500 uppercase">{activeSourceId === 'new' ? 'Nova Fonte' : 'Editando Fonte'}</p>
                                    <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Ex: Venda Online / Google Sheets" className="w-full bg-gray-700 p-2 rounded text-sm border border-gray-600"/>
                                    <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL da API ou CSV" className="w-full bg-gray-700 p-2 rounded text-sm border border-gray-600"/>
                                    <div className="flex gap-2">
                                        <input value={editSource.token} onChange={e => setEditSource({...editSource, token: e.target.value})} placeholder="Token (opcional)" className="flex-1 bg-gray-700 p-2 rounded text-xs border border-gray-600"/>
                                        <label className="flex items-center space-x-1 text-[10px] text-gray-400 bg-gray-700 px-2 rounded border border-gray-600">
                                            <input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})}/>
                                            <span>Auto-Import (10m)</span>
                                        </label>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={handleSaveEditSource} className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold text-sm">Salvar Fonte</button>
                                        {activeSourceId !== 'new' && <button onClick={() => { setActiveSourceId('new'); setEditSource({name:'', url:'', token:'', type:'tickets', autoImport:false}); }} className="bg-gray-600 px-3 rounded text-xs">Cancelar</button>}
                                    </div>
                                </div>

                                <div className="mt-6 space-y-2">
                                    <p className="text-xs font-bold text-gray-500 uppercase">Fontes Ativas</p>
                                    {importSources.map(s => (
                                        <div key={s.id} className="flex justify-between items-center bg-gray-700/50 p-3 rounded border border-gray-600 hover:border-blue-500/50 transition-all">
                                            <div className="flex-1 min-w-0" onClick={() => { setActiveSourceId(s.id); setEditSource(s); }}>
                                                <p className="text-sm font-bold text-white truncate">{s.name}</p>
                                                <p className="text-[10px] text-gray-400 truncate">{s.autoImport ? 'Auto-Sync: Ativo' : 'Sincronização Manual'}</p>
                                            </div>
                                            <div className="flex items-center space-x-2 ml-4">
                                                <button onClick={() => executeImport(s)} className="text-[10px] bg-green-600 px-3 py-1.5 rounded font-bold hover:bg-green-700">Sincronizar</button>
                                                <button onClick={async () => {
                                                    if(confirm("Remover esta fonte?")) {
                                                        const filtered = importSources.filter(src => src.id !== s.id);
                                                        setImportSources(filtered);
                                                        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: filtered, ignoreExisting }, { merge: true });
                                                    }
                                                }} className="p-1.5 bg-red-900/50 text-red-400 rounded hover:bg-red-900"><TrashIcon className="w-4 h-4"/></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'events':
                return (
                    <div className="space-y-6">
                        <div className="bg-gray-800 p-5 rounded-lg shadow-lg border border-gray-700">
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
                                    } catch (e) { alert("Erro ao criar evento."); } finally { setIsLoading(false); }
                                }} className="bg-orange-600 px-6 rounded font-bold hover:bg-orange-700 transition-colors shadow-lg">Criar</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-lg">
                            <h3 className="font-bold mb-3 text-gray-400 text-sm uppercase flex items-center"><TableCellsIcon className="w-4 h-4 mr-2"/> Gerenciar Meus Eventos</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {events.map(ev => {
                                    const assignedAdmins = allUsers.filter(u => Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id));
                                    const isAssigning = assigningEventId === ev.id;
                                    return (
                                        <div key={ev.id} className="bg-gray-700/50 p-4 rounded-xl border border-gray-600 hover:border-orange-500/50 transition-all flex flex-col">
                                            <div className="flex justify-between items-start mb-4">
                                                <span className="font-bold text-lg text-white">{ev.name}</span>
                                                <div className="flex space-x-2">
                                                    {isSuperAdmin && (
                                                        <button 
                                                            onClick={() => setAssigningEventId(isAssigning ? null : ev.id)} 
                                                            className={`p-1.5 rounded-lg border transition-colors ${isAssigning ? 'bg-orange-600 border-orange-500' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`} 
                                                            title="Atribuir Admins"
                                                        >
                                                            <UsersIcon className="w-5 h-5" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => onSelectEvent(ev)} className="bg-blue-600 text-xs px-4 py-1.5 rounded font-bold hover:bg-blue-700 shadow-md">Painel</button>
                                                </div>
                                            </div>

                                            {isSuperAdmin && (
                                                <div className="mt-2 pt-2 border-t border-gray-600">
                                                    {isAssigning ? (
                                                        <div className="bg-gray-800 p-3 rounded-lg border border-orange-500/30 animate-fade-in shadow-inner">
                                                            <p className="text-[10px] text-orange-400 uppercase font-black mb-2">Vincular Administradores:</p>
                                                            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                                                {allUsers.filter(u => u.role !== 'SUPER_ADMIN').map(u => (
                                                                    <label key={u.id} className="flex items-center p-2 rounded hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-600">
                                                                        <input type="checkbox" checked={Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id)} onChange={() => handleToggleUserAccess(u.id, ev.id)} className="w-4 h-4 text-orange-600 rounded bg-gray-900 border-gray-600"/>
                                                                        <span className="ml-2 text-xs font-medium text-gray-200">{u.username}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                            <button onClick={() => setAssigningEventId(null)} className="w-full mt-3 text-[10px] text-gray-400 hover:text-white font-black py-2 border border-gray-600 rounded uppercase">Fechar Atribuição</button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {assignedAdmins.length > 0 ? assignedAdmins.map(u => (
                                                                <span key={u.id} className="text-[10px] bg-gray-800 px-2 py-0.5 rounded text-gray-300 border border-gray-600">{u.username}</span>
                                                            )) : <span className="text-[10px] italic text-gray-600">Nenhum admin vinculado</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            case 'search': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Use o botão de busca no painel superior para pesquisar ingressos.</div>;
            case 'locators': 
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
                            <h2 className="text-xl font-bold mb-4 flex items-center"><TicketIcon className="w-6 h-6 mr-2 text-orange-500"/> Localizadores Manuais</h2>
                            <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="Insira os códigos (um por linha)" className="w-full h-48 bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4 font-mono text-sm outline-none focus:border-orange-500 transition-all shadow-inner"/>
                            <div className="flex gap-4">
                                <select value={selectedLocatorSector} onChange={e => setSelectedLocatorSector(e.target.value)} className="flex-1 bg-gray-700 p-3 rounded-xl border border-gray-700 text-sm outline-none">
                                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <button onClick={handleProcessLocators} className="bg-orange-600 px-10 rounded-xl font-bold hover:bg-orange-700 shadow-lg transition-transform active:scale-95">Importar</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl">
                            <div className="max-h-96 overflow-y-auto custom-scrollbar">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-700 text-gray-400 text-[10px] uppercase font-black tracking-widest">
                                        <tr><th className="p-4">Código</th><th className="p-4">Setor Alocado</th><th className="p-4">Situação</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {manualLocatorTickets.map(t => (
                                            <tr key={t.id} className="hover:bg-gray-700/30 transition-colors">
                                                <td className="p-4 font-mono font-bold text-orange-400">{t.id}</td>
                                                <td className="p-4">{t.sector}</td>
                                                <td className="p-4">
                                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black tracking-tight ${t.status === 'USED' ? 'bg-red-900/50 text-red-400 border border-red-500/20' : 'bg-green-900/50 text-green-400 border border-green-500/20'}`}>
                                                        {t.status === 'USED' ? 'UTILIZADO' : 'DISPONÍVEL'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            case 'history': return <TicketList tickets={nonSecretScanHistory} sectorNames={sectorNames} />;
            case 'operators':
                const operatorMonitorUrl = `${window.location.origin}${window.location.pathname}?mode=operators&eventId=${selectedEvent!.id}`;
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-gray-800 p-10 rounded-3xl border border-gray-700 shadow-2xl flex flex-col items-center text-center">
                            <div className="bg-orange-600/20 p-8 rounded-full mb-6 border border-orange-500/20 shadow-inner">
                                <VideoCameraIcon className="w-20 h-20 text-orange-500" />
                            </div>
                            <h2 className="text-4xl font-black mb-4 tracking-tighter">Monitoramento de Operadores</h2>
                            <p className="text-gray-400 max-w-lg mb-8 text-lg font-medium leading-relaxed">
                                Visualize o desempenho de cada portaria em tempo real através do nosso painel de monitoramento dinâmico.
                            </p>
                            
                            <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 p-5 rounded-2xl mb-8 font-mono text-xs break-all text-orange-300 shadow-inner leading-relaxed">
                                {operatorMonitorUrl}
                            </div>
                            
                            <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                                <button 
                                    onClick={() => {
                                        navigator.clipboard.writeText(operatorMonitorUrl).then(() => alert("Link de monitoramento copiado!"));
                                    }}
                                    className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-10 rounded-2xl flex items-center justify-center transition-all shadow-xl"
                                >
                                    <LinkIcon className="w-5 h-5 mr-3" />
                                    Copiar Link de Acesso
                                </button>
                                <a 
                                    href={operatorMonitorUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 px-10 rounded-2xl flex items-center justify-center transition-all shadow-xl"
                                >
                                    <VideoCameraIcon className="w-5 h-5 mr-3" />
                                    Abrir Monitoramento Agora
                                </a>
                            </div>
                        </div>
                        <div className="bg-orange-600/10 border border-orange-500/20 p-6 rounded-2xl text-orange-200">
                            <h4 className="font-bold flex items-center mb-2">
                                <AlertTriangleIcon className="w-5 h-5 mr-3" />
                                Monitoramento Externo
                            </h4>
                            <p className="text-sm leading-relaxed text-orange-200/70">
                                Este link é público e ideal para ser compartilhado com coordenadores de acesso. Ele permite visualizar estatísticas de falhas, repetidos e produtividade por portaria sem dar acesso administrativo ao sistema.
                            </p>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10 px-4">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 custom-scrollbar border border-gray-700 items-center text-sm shadow-2xl no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'locators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><TicketIcon className="w-4 h-4 mr-2"/>Localizadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'history' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'events' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Eventos</button>
                <button onClick={() => setActiveTab('operators')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><UsersIcon className="w-4 h-4 mr-2"/>Operadores</button>
                {isSuperAdmin && (
                    <div className="ml-auto pl-2 border-l border-gray-600">
                        <button onClick={() => setActiveTab('users')} className={`px-6 py-2.5 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'users' ? 'bg-purple-600 shadow-lg scale-105' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-2"/>Usuários</button>
                    </div>
                )}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

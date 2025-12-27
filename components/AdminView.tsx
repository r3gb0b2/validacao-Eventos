import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import Scanner from './Scanner';
import SuperAdminView from './SuperAdminView'; 
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc, getDocs } from 'firebase/firestore';
import { CloudDownloadIcon, CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, QrCodeIcon, UsersIcon, LockClosedIcon, TicketIcon, PlusCircleIcon, FunnelIcon, VideoCameraIcon } from './Icons';
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
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // Estados para atribuição de administradores
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [assigningEventId, setAssigningEventId] = useState<string | null>(null);

    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');

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
                }
            } catch (e) { console.error("Error loading configs", e); }
        };
        loadConfigs();
    }, [db, selectedEvent]);

    // Processamento de Estatísticas de Operadores
    const operatorStats = useMemo(() => {
        if (!scanHistory || scanHistory.length === 0) return [];

        const stats: Record<string, {
            name: string;
            total: number;
            valid: number;
            lastSeen: number;
            sectors: Record<string, number>;
            deviceIds: Set<string>;
        }> = {};

        scanHistory.forEach(log => {
            const opName = log.operator || 'Sem Nome';
            if (!stats[opName]) {
                stats[opName] = {
                    name: opName,
                    total: 0,
                    valid: 0,
                    lastSeen: 0,
                    sectors: {},
                    deviceIds: new Set()
                };
            }
            const s = stats[opName];
            s.total++;
            if (log.status === 'VALID') s.valid++;
            if (log.timestamp > s.lastSeen) s.lastSeen = log.timestamp;
            if (log.deviceId) s.deviceIds.add(log.deviceId);
            
            const sector = log.ticketSector || 'Desconhecido';
            s.sectors[sector] = (s.sectors[sector] || 0) + 1;
        });

        return Object.values(stats).sort((a, b) => b.lastSeen - a.lastSeen);
    }, [scanHistory]);

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
        } catch (e) { console.error(e); } finally { if (!isAuto) setIsLoading(false); }
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
        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: newSources }, { merge: true });
        alert("Fonte salva!");
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
                                }} disabled={isSavingSectors} className="bg-orange-600 w-full mt-4 p-2 rounded font-bold">Salvar Configuração</button>
                             </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-lg border border-blue-500/20">
                                <h3 className="text-lg font-bold text-blue-400 mb-4">Importar Dados</h3>
                                <div className="space-y-3">
                                    <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-700 p-2 rounded text-sm"/>
                                    <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL" className="w-full bg-gray-700 p-2 rounded text-sm"/>
                                    <button onClick={handleSaveEditSource} className="w-full bg-green-600 py-2 rounded font-bold text-xs">Salvar Fonte</button>
                                    {importSources.map(s => (
                                        <div key={s.id} className="flex justify-between items-center bg-gray-900/30 p-2 rounded border border-gray-800">
                                            <span className="text-xs font-bold">{s.name}</span>
                                            <button onClick={() => executeImport(s)} className="text-[10px] bg-blue-600 px-2 py-1 rounded">Rodar</button>
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
                                        alert("Evento criado!");
                                        setNewEventName('');
                                    } catch (e) { alert("Erro."); } finally { setIsLoading(false); }
                                }} className="bg-orange-600 px-6 rounded font-bold hover:bg-orange-700">Criar</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                            <h3 className="font-bold mb-3 text-gray-400 text-sm uppercase">Meus Eventos</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {events.map(ev => {
                                    const assignedAdmins = allUsers.filter(u => Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id));
                                    const isAssigning = assigningEventId === ev.id;
                                    return (
                                        <div key={ev.id} className="bg-gray-700/50 p-4 rounded border border-gray-600 hover:border-orange-500/50 transition-all">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="font-bold text-lg">{ev.name}</span>
                                                <div className="flex space-x-2">
                                                    {isSuperAdmin && (
                                                        <button onClick={() => setAssigningEventId(isAssigning ? null : ev.id)} className={`p-1.5 rounded-lg border transition-colors ${isAssigning ? 'bg-orange-600 border-orange-500' : 'bg-gray-800 border-gray-600 hover:bg-gray-700'}`} title="Atribuir Admins"><UsersIcon className="w-5 h-5" /></button>
                                                    )}
                                                    <button onClick={() => onSelectEvent(ev)} className="bg-blue-600 text-xs px-4 py-1.5 rounded font-bold">Gerenciar</button>
                                                </div>
                                            </div>
                                            {isSuperAdmin && (
                                                <div className="mt-2 pt-2 border-t border-gray-600">
                                                    {isAssigning ? (
                                                        <div className="bg-gray-800 p-3 rounded-lg border border-orange-500/30 animate-fade-in">
                                                            <p className="text-[10px] text-orange-400 uppercase font-bold mb-2">Selecione Admins para este Evento:</p>
                                                            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                                                                {allUsers.filter(u => u.role !== 'SUPER_ADMIN').map(u => (
                                                                    <label key={u.id} className="flex items-center p-1.5 rounded hover:bg-gray-700 cursor-pointer transition-colors">
                                                                        <input type="checkbox" checked={Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id)} onChange={() => handleToggleUserAccess(u.id, ev.id)} className="form-checkbox h-3.5 w-3.5 text-orange-600 rounded border-gray-600 bg-gray-900 focus:ring-0"/>
                                                                        <span className="ml-2 text-xs font-medium text-gray-200">{u.username}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                            <button onClick={() => setAssigningEventId(null)} className="w-full mt-2 text-[10px] text-gray-400 hover:text-white font-bold py-1 border border-gray-600 rounded uppercase">Fechar</button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Admins com Acesso:</p>
                                                            <div className="flex flex-wrap gap-1">
                                                                {assignedAdmins.length > 0 ? assignedAdmins.map(u => (
                                                                    <span key={u.id} className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 border border-gray-600">{u.username}</span>
                                                                )) : <span className="text-[10px] italic text-gray-600">Nenhum admin vinculado</span>}
                                                            </div>
                                                        </>
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
            case 'search': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Selecione the campo de busca no painel superior.</div>;
            case 'locators': 
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
                            <h2 className="text-xl font-bold mb-4 flex items-center"><TicketIcon className="w-6 h-6 mr-2 text-orange-500"/> Localizadores Manuais</h2>
                            <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="Códigos (um por linha)" className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-4 mb-4 font-mono text-sm"/>
                            <div className="flex gap-4">
                                <select value={selectedLocatorSector} onChange={e => setSelectedLocatorSector(e.target.value)} className="flex-1 bg-gray-700 p-3 rounded border border-gray-700 text-sm">
                                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <button onClick={handleProcessLocators} className="bg-orange-600 px-8 rounded font-bold">Processar</button>
                            </div>
                        </div>
                         <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden shadow-xl">
                            <div className="max-h-96 overflow-y-auto custom-scrollbar">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-700 text-gray-400 text-[10px] uppercase">
                                        <tr><th className="p-4">Código</th><th className="p-4">Setor</th><th className="p-4">Status</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-700">
                                        {manualLocatorTickets.map(t => (
                                            <tr key={t.id} className="hover:bg-gray-700/30">
                                                <td className="p-4 font-mono font-bold text-orange-400">{t.id}</td>
                                                <td className="p-4">{t.sector}</td>
                                                <td className="p-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.status === 'USED' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>{t.status}</span></td>
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
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-lg">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Operadores Únicos</p>
                                <p className="text-3xl font-bold text-white">{operatorStats.length}</p>
                            </div>
                            <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-lg">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Total de Scans</p>
                                <p className="text-3xl font-bold text-blue-400">{scanHistory.length}</p>
                            </div>
                            <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-lg">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Ações Ativas (Últ. 5m)</p>
                                <p className="text-3xl font-bold text-green-400">
                                    {operatorStats.filter(s => (Date.now() - s.lastSeen) < 300000).length}
                                </p>
                            </div>
                            <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-lg">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Taxa Geral Sucesso</p>
                                <p className="text-3xl font-bold text-orange-400">
                                    {scanHistory.length > 0 ? ((scanHistory.filter(h => h.status === 'VALID').length / scanHistory.length) * 100).toFixed(1) : '0'}%
                                </p>
                            </div>
                        </div>

                        <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-2xl">
                            <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-gray-700/30">
                                <h3 className="text-lg font-bold flex items-center">
                                    <VideoCameraIcon className="w-5 h-5 mr-2 text-orange-500" />
                                    Monitoramento em Tempo Real
                                </h3>
                                <div className="flex items-center text-xs text-gray-400">
                                     <span className="relative flex h-2 w-2 mr-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                    </span>
                                    Atualizando dados...
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                                {operatorStats.map(op => {
                                    const isActive = (Date.now() - op.lastSeen) < 300000; // 5 min
                                    const successRate = op.total > 0 ? ((op.valid / op.total) * 100).toFixed(0) : '0';
                                    // FIX: Explicitly cast to Number to avoid arithmetic type errors in sort on line 491.
                                    const mainSector = Object.entries(op.sectors).sort((a,b) => Number(b[1])-Number(a[1]))[0]?.[0] || 'N/A';

                                    return (
                                        <div key={op.name} className="bg-gray-900 border border-gray-700 rounded-xl p-5 hover:border-orange-500/50 transition-all group">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex items-center">
                                                    <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center font-bold text-lg text-orange-500 border border-gray-700 group-hover:bg-orange-600 group-hover:text-white transition-colors uppercase">
                                                        {op.name.charAt(0)}
                                                    </div>
                                                    <div className="ml-3">
                                                        <p className="font-bold text-white text-lg">{op.name}</p>
                                                        <p className="text-[10px] text-gray-500 flex items-center">
                                                            <ClockIcon className="w-3 h-3 mr-1" />
                                                            Visto em {new Date(op.lastSeen).toLocaleTimeString('pt-BR')}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className={`px-2 py-1 rounded text-[10px] font-bold ${isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                                                    {isActive ? 'ATIVO' : 'OFFLINE'}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-800">
                                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Scans</p>
                                                    <p className="text-xl font-bold text-white">{op.total}</p>
                                                </div>
                                                <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-800">
                                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Sucesso</p>
                                                    <p className="text-xl font-bold text-green-400">{successRate}%</p>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div>
                                                    <div className="flex justify-between text-[10px] mb-1">
                                                        <span className="text-gray-500 uppercase font-bold">Produtividade</span>
                                                        <span className="text-white font-bold">{op.valid}/{op.total}</span>
                                                    </div>
                                                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                                                        <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${successRate}%` }}></div>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] text-gray-500 border-t border-gray-800 pt-2 mt-2">
                                                    <span>Setor Principal: <b>{mainSector}</b></span>
                                                    <span>Devices: <b>{op.deviceIds.size}</b></span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {operatorStats.length === 0 && (
                                    <div className="col-span-full py-20 text-center">
                                        <UsersIcon className="w-16 h-16 mx-auto text-gray-700 mb-4" />
                                        <p className="text-gray-500 font-bold">Nenhum operador detectado até o momento.</p>
                                        <p className="text-xs text-gray-600">Inicie as validações para ver os dados aqui.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'search': return <div className="bg-gray-800 p-10 text-center text-gray-500 rounded-lg border border-gray-700 shadow-inner italic">Selecione the campo de busca no painel superior.</div>;
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
                {isSuperAdmin && (
                    <div className="ml-auto pl-2 border-l border-gray-600">
                        <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap flex items-center transition-all ${activeTab === 'users' ? 'bg-purple-600 shadow-lg scale-105' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Usuários</button>
                    </div>
                )}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;
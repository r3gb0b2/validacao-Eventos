
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import SuperAdminView from './SuperAdminView'; 
import OperatorMonitor from './OperatorMonitor';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc, getDocs } from 'firebase/firestore';
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

const API_PRESETS = [
    { name: "Personalizado / Outros", url: "", type: "tickets", token: "" },
    { name: "Google Sheets (CSV)", url: "https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/export?format=csv", type: "google_sheets", token: "" },
    { name: "E-Inscrição (Participantes)", url: "https://api.e-inscricao.com/v1/eventos/[ID_EVENTO]/participantes", type: "participants", token: "" },
    { name: "E-Inscrição (Ingressos)", url: "https://api.e-inscricao.com/v1/eventos/[ID_EVENTO]/ingressos", type: "tickets", token: "" },
    { name: "E-Inscrição (Check-ins)", url: "https://api.e-inscricao.com/v1/eventos/[ID_EVENTO]/checkins", type: "checkins", token: "" },
    { name: "Sympla (Participantes)", url: "https://api.sympla.com.br/v3/events/[ID_EVENTO]/participants", type: "participants", token: "" }
];

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser, onUpdateCurrentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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

    useEffect(() => {
        if ((activeTab === 'events' || activeTab === 'users') && isSuperAdmin) {
            const fetchUsers = async () => {
                try {
                    const snap = await getDocs(collection(db, 'users'));
                    setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
                } catch (e) { console.error("Erro:", e); }
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

    useEffect(() => {
        if (autoImportIntervalRef.current) clearInterval(autoImportIntervalRef.current);
        
        const sourcesToAuto = importSources.filter(s => s.autoImport);
        if (sourcesToAuto.length > 0 && selectedEvent) {
            autoImportIntervalRef.current = setInterval(() => {
                sourcesToAuto.forEach(s => executeImport(s, true));
            }, 600000); // 10 Minutos
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
            
            const existingTicketIds = ignoreExisting ? new Set(allTickets.map(t => String(t.id).trim())) : new Set();

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
                    
                    if (pageItems.length === 0 || (json.last_page && page >= json.last_page)) hasMore = false;
                    allItems.push(...pageItems);
                    page++;
                    if (page > 30) break; 
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
                const BATCH_SIZE = 400;
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
            if (!isAuto) alert(`${ticketsToSave.length} novos ingressos importados!`);
        } catch (e) { 
            console.error(e); 
            if (!isAuto) alert("Erro: " + (e as any).message);
        } finally { if (!isAuto) setIsLoading(false); }
    };

    const handleApplyPreset = (presetName: string) => {
        const preset = API_PRESETS.find(p => p.name === presetName);
        if (preset) {
            setEditSource(prev => ({
                ...prev,
                name: prev.name || preset.name,
                url: preset.url,
                type: preset.type as ImportType,
                token: preset.token
            }));
        }
    };

    const handleSaveEditSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha Nome e URL.");
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
        } else {
            newSources = importSources.map(s => s.id === activeSourceId ? { ...s, ...editSource } as ImportSource : s);
        }
        setImportSources(newSources);
        await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: newSources, ignoreExisting }, { merge: true });
        alert("Configuração salva!");
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
        if (!selectedEvent || !db) return;
        const codes = locatorCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (codes.length === 0) return alert("Nenhum código inserido.");
        
        setIsLoading(true);
        try {
            const BATCH_SIZE = 450;
            for (let i = 0; i < codes.length; i += BATCH_SIZE) {
                const chunk = codes.slice(i, i + BATCH_SIZE);
                const batch = writeBatch(db);
                chunk.forEach(code => {
                    batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), {
                        id: code,
                        sector: selectedLocatorSector,
                        status: 'AVAILABLE',
                        source: 'manual_locator'
                    }, { merge: true });
                });
                await batch.commit();
            }
            setLocatorCodes('');
            alert(`${codes.length} localizadores importados com sucesso.`);
        } catch (e) {
            console.error("Erro ao processar localizadores:", e);
            alert("Erro ao processar localizadores.");
        } finally {
            setIsLoading(false);
        }
    };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p>Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg shadow-inner">Selecione um evento na aba 'Eventos'.</div>;
        
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
                                }} className="bg-blue-600 p-2 rounded-lg text-sm flex items-center hover:bg-blue-700"><LinkIcon className="w-4 h-4 mr-1"/>Link Público</button>
                                <button onClick={() => generateEventReport(selectedEvent!.name, allTickets.filter(t => t.source !== 'secret_generator'), scanHistory.filter(s => !allTickets.find(t => t.id === s.ticketId && t.source === 'secret_generator')), sectorNames)} disabled={isGeneratingPdf} className="bg-green-600 p-2 rounded-lg text-sm flex items-center hover:bg-green-700"><CloudDownloadIcon className="w-4 h-4 mr-1"/>Gerar PDF</button>
                            </div>
                        </div>
                        <Stats allTickets={allTickets.filter(t => t.source !== 'secret_generator')} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode={statsViewMode} onViewModeChange={setStatsViewMode} groups={sectorGroups} onGroupsChange={setSectorGroups}/>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-2xl border border-orange-500/30 shadow-xl">
                                <h3 className="text-lg font-bold mb-4 text-orange-400 flex items-center"><CogIcon className="w-5 h-5 mr-2"/> Modo de Operação</h3>
                                <div className="space-y-3">
                                    <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-gray-700/50 cursor-pointer border border-transparent hover:border-gray-600 transition-all">
                                        <input type="radio" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} className="w-5 h-5 text-orange-500"/> 
                                        <span>Validação Offline (BD Local do App)</span>
                                    </label>
                                    <label className="flex items-center space-x-3 p-3 rounded-xl hover:bg-gray-700/50 cursor-pointer border border-transparent hover:border-gray-600 transition-all">
                                        <input type="radio" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} className="w-5 h-5 text-orange-500"/> 
                                        <span>Validação Online (API Externa Direta)</span>
                                    </label>
                                </div>
                                <button onClick={() => setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'validation'), { mode: validationMode }, { merge: true })} className="bg-green-600 w-full mt-4 p-3 rounded-xl font-bold shadow-lg hover:bg-green-700 transition-all">Salvar Modo</button>
                             </div>

                             <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                                <h3 className="text-lg font-bold mb-3 flex items-center"><TableCellsIcon className="w-5 h-5 mr-2"/> Setores do Evento</h3>
                                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                                    {editableSectorNames.map((name, i) => (
                                        <div key={i} className="flex items-center space-x-2">
                                            <input value={name} onChange={e => { const n = [...editableSectorNames]; n[i] = e.target.value; setEditableSectorNames(n); }} className="flex-grow bg-gray-900 border border-gray-700 p-3 rounded-xl text-sm focus:border-orange-500 outline-none transition-all"/>
                                            <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); }} className="p-3 bg-gray-900 rounded-xl hover:bg-gray-700 transition-all border border-gray-700">
                                                {sectorVisibility[i] ? <EyeIcon className="w-5 h-5 text-blue-400"/> : <EyeSlashIcon className="w-5 h-5 text-gray-500"/>}
                                            </button>
                                        </div>
                                    ))}
                                    <button onClick={() => { setEditableSectorNames([...editableSectorNames, 'Novo Setor']); setSectorVisibility([...sectorVisibility, true]); }} className="text-sm text-orange-400 mt-2 hover:underline flex items-center font-bold px-2 py-1"><PlusCircleIcon className="w-4 h-4 mr-1"/> Adicionar Setor</button>
                                </div>
                                <button onClick={async () => {
                                    setIsSavingSectors(true);
                                    const hidden = editableSectorNames.filter((_, i) => !sectorVisibility[i]);
                                    await onUpdateSectorNames(editableSectorNames, hidden);
                                    setIsSavingSectors(false);
                                    alert("Setores atualizados!");
                                }} disabled={isSavingSectors} className="bg-orange-600 w-full mt-4 p-3 rounded-xl font-bold shadow-lg hover:bg-orange-700 transition-all">Salvar Configuração</button>
                             </div>
                        </div>

                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-2xl border border-blue-500/20 shadow-xl">
                                <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center"><CloudUploadIcon className="w-5 h-5 mr-2"/> Configuração de Importação (Múltiplas APIs)</h3>
                                
                                <div className="bg-blue-600/10 p-4 rounded-xl border border-blue-500/20 mb-6">
                                    <label className="flex items-center space-x-3 text-sm text-blue-100 cursor-pointer">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="w-5 h-5 rounded text-blue-500 bg-gray-800 border-blue-500/50"/>
                                        <div className="flex flex-col">
                                            <span className="font-bold">Proteger Validações Existentes</span>
                                            <span className="text-[10px] text-blue-300 opacity-80">Se marcado, o sistema nunca apagará ou sobrescreverá o status de um ingresso que já está no banco de dados.</span>
                                        </div>
                                    </label>
                                </div>

                                <div className="space-y-4 bg-gray-900/50 p-5 rounded-2xl border border-gray-700 shadow-inner">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <p className="text-xs font-bold text-gray-500 uppercase">{activeSourceId === 'new' ? 'Cadastrar Nova API' : 'Editar Configuração'}</p>
                                            <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none focus:border-blue-500 transition-all"/>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-xs font-bold text-gray-500 uppercase">Escolher Modelo / Preset</p>
                                            <select 
                                                onChange={(e) => handleApplyPreset(e.target.value)}
                                                className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none focus:border-blue-500"
                                            >
                                                <option value="">Selecione um Preset para autopreencher...</option>
                                                {API_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-gray-600 uppercase">Endpoint / URL da API</p>
                                        <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL Completa do Recurso" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none focus:border-blue-500 transition-all"/>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-gray-600 uppercase">Chave de Autorização</p>
                                            <input value={editSource.token} onChange={e => setEditSource({...editSource, token: e.target.value})} placeholder="Bearer Token" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-xs outline-none focus:border-blue-500 transition-all"/>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold text-gray-600 uppercase">ID Externo</p>
                                            <input value={editSource.eventId} onChange={e => setEditSource({...editSource, eventId: e.target.value})} placeholder="ID do Evento na Origem" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-xs outline-none focus:border-blue-500 transition-all"/>
                                        </div>
                                    </div>

                                    <div className="flex flex-col md:flex-row items-center justify-between p-3 bg-gray-800/50 rounded-xl border border-gray-700 gap-4">
                                        <label className="flex items-center space-x-2 text-xs font-bold text-gray-400 cursor-pointer px-2">
                                            <input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})} className="w-4 h-4 text-blue-500 rounded"/>
                                            <span>Auto-Sincronização (10 min)</span>
                                        </label>
                                        <div className="flex items-center gap-3 w-full md:w-auto">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Formato:</span>
                                            <select value={editSource.type} onChange={e => setEditSource({...editSource, type: e.target.value as ImportType})} className="flex-1 md:flex-none bg-gray-900 border border-gray-700 text-xs p-2 rounded-lg outline-none font-bold text-blue-400">
                                                <option value="tickets">Ingressos (Geral)</option>
                                                <option value="google_sheets">Google Sheets (CSV)</option>
                                                <option value="participants">Participantes</option>
                                                <option value="checkins">Base de Check-ins</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-2">
                                        <button onClick={handleSaveEditSource} className="flex-1 bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-bold text-sm shadow-lg transition-all active:scale-95">Salvar Configuração</button>
                                        {activeSourceId !== 'new' && <button onClick={() => { setActiveSourceId('new'); setEditSource({name:'', url:'', token:'', type:'tickets', autoImport:false}); }} className="bg-gray-700 px-4 rounded-xl text-xs font-bold border border-gray-600">Limpar</button>}
                                    </div>
                                </div>

                                <div className="mt-8 space-y-3">
                                    <p className="text-xs font-bold text-gray-500 uppercase flex items-center"><CloudDownloadIcon className="w-4 h-4 mr-2"/> Fontes Conectadas</p>
                                    {importSources.length === 0 && <p className="text-xs text-gray-600 italic py-4 border-2 border-dashed border-gray-700 rounded-xl text-center">Nenhuma API configurada para este evento.</p>}
                                    {importSources.map(s => (
                                        <div key={s.id} className="flex flex-col bg-gray-700/30 p-4 rounded-2xl border border-gray-600 hover:border-blue-500/50 transition-all shadow-md">
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="cursor-pointer" onClick={() => { setActiveSourceId(s.id); setEditSource(s); }}>
                                                    <p className="text-sm font-bold text-white flex items-center">{s.name} {s.autoImport && <span className="ml-2 text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/30">AUTO-SYNC ON</span>}</p>
                                                    <p className="text-[9px] text-gray-500 truncate max-w-[200px]">{s.url}</p>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <button onClick={() => executeImport(s)} disabled={isLoading} className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center shadow-md transition-all active:scale-95">
                                                        {isLoading ? '...' : <><SearchIcon className="w-3 h-3 mr-1.5"/> Sincronizar Agora</>}
                                                    </button>
                                                    <button onClick={async () => {
                                                        if(confirm("Deseja realmente remover esta fonte?")) {
                                                            const filtered = importSources.filter(src => src.id !== s.id);
                                                            setImportSources(filtered);
                                                            await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: filtered, ignoreExisting }, { merge: true });
                                                        }
                                                    }} className="p-2 bg-red-900/30 text-red-400 rounded-xl hover:bg-red-600 hover:text-white transition-all border border-red-500/20"><TrashIcon className="w-4 h-4"/></button>
                                                </div>
                                            </div>
                                            {s.lastImportTime && (
                                                <div className="text-[9px] text-gray-500 border-t border-gray-600/50 pt-2 flex justify-between">
                                                    <span>Último sync: {new Date(s.lastImportTime).toLocaleString()}</span>
                                                    <span className="text-blue-400 font-bold uppercase">{s.type}</span>
                                                </div>
                                            )}
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
                        <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700">
                            <h3 className="font-bold mb-4 flex items-center text-lg"><PlusCircleIcon className="w-6 h-6 mr-2 text-orange-500"/> Criar Novo Evento</h3>
                            <div className="flex gap-3">
                                <input value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="Digite o nome do evento..." className="flex-1 bg-gray-900 border border-gray-700 p-4 rounded-xl outline-none focus:border-orange-500 transition-all"/>
                                <button onClick={async () => {
                                    if(!newEventName.trim()) return;
                                    setIsLoading(true);
                                    try {
                                        const ref = await addDoc(collection(db, 'events'), { name: newEventName, isHidden: false });
                                        await setDoc(doc(db, 'events', ref.id, 'settings', 'main'), { sectorNames: ['Pista', 'VIP'] });
                                        alert("Evento criado com sucesso!");
                                        setNewEventName('');
                                    } catch (e) { alert("Erro ao criar."); } finally { setIsLoading(false); }
                                }} className="bg-orange-600 px-8 rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg active:scale-95">Criar Evento</button>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl">
                            <h3 className="font-bold mb-5 text-gray-400 text-sm uppercase flex items-center tracking-widest"><TableCellsIcon className="w-5 h-5 mr-2"/> Gerenciar Acessos por Evento</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {events.map(ev => {
                                    const assignedAdmins = allUsers.filter(u => Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id));
                                    const isAssigning = assigningEventId === ev.id;
                                    return (
                                        <div key={ev.id} className="bg-gray-700/40 p-5 rounded-2xl border border-gray-600 hover:border-orange-500/40 transition-all flex flex-col group">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex flex-col">
                                                    <span className="font-black text-xl text-white group-hover:text-orange-400 transition-colors">{ev.name}</span>
                                                    <span className="text-[10px] text-gray-500 uppercase font-bold mt-1">ID: {ev.id}</span>
                                                </div>
                                                <div className="flex space-x-2">
                                                    {isSuperAdmin && (
                                                        <button 
                                                            onClick={() => setAssigningEventId(isAssigning ? null : ev.id)} 
                                                            className={`p-2 rounded-xl border transition-all ${isAssigning ? 'bg-orange-600 border-orange-500' : 'bg-gray-800 border-gray-700 hover:bg-gray-700'}`} 
                                                            title="Gerenciar Permissões"
                                                        >
                                                            <UsersIcon className="w-5 h-5" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => onSelectEvent(ev)} className="bg-blue-600 text-xs px-5 py-2 rounded-xl font-black uppercase tracking-tighter hover:bg-blue-700 shadow-lg active:scale-95 transition-all">Selecionar</button>
                                                </div>
                                            </div>

                                            {isSuperAdmin && (
                                                <div className="mt-2 pt-4 border-t border-gray-600/50">
                                                    {isAssigning ? (
                                                        <div className="bg-gray-900/80 p-4 rounded-xl border border-orange-500/30 animate-fade-in shadow-inner">
                                                            <p className="text-[11px] text-orange-400 uppercase font-black mb-3">Vincular Usuários:</p>
                                                            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                                                                {allUsers.filter(u => u.role !== 'SUPER_ADMIN').map(u => (
                                                                    <label key={u.id} className="flex items-center p-3 rounded-xl hover:bg-gray-800 cursor-pointer transition-all border border-transparent hover:border-gray-700">
                                                                        <input type="checkbox" checked={Array.isArray(u.allowedEvents) && u.allowedEvents.includes(ev.id)} onChange={() => handleToggleUserAccess(u.id, ev.id)} className="w-5 h-5 text-orange-600 rounded bg-gray-950 border-gray-700"/>
                                                                        <span className="ml-3 text-xs font-bold text-gray-300">{u.username}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                            <button onClick={() => setAssigningEventId(null)} className="w-full mt-4 text-[10px] text-gray-400 hover:text-white font-black py-3 border border-gray-700 rounded-xl uppercase transition-all">Fechar</button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {assignedAdmins.length > 0 ? assignedAdmins.map(u => (
                                                                <span key={u.id} className="text-[9px] bg-gray-800 px-2.5 py-1 rounded-full text-gray-400 border border-gray-700 font-bold">{u.username}</span>
                                                            )) : <span className="text-[10px] italic text-gray-600 flex items-center"><XCircleIcon className="w-3 h-3 mr-1"/> Sem usuários vinculados</span>}
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
            case 'locators': 
                return (
                    <div className="space-y-6 animate-fade-in pb-20">
                        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-2xl">
                            <h2 className="text-xl font-bold mb-4 flex items-center text-orange-500"><TicketIcon className="w-6 h-6 mr-2"/> Localizadores Manuais</h2>
                            <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="Cole os códigos um abaixo do outro..." className="w-full h-48 bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-4 font-mono text-sm outline-none focus:border-orange-500 transition-all shadow-inner"/>
                            <div className="flex gap-4">
                                <select value={selectedLocatorSector} onChange={e => setSelectedLocatorSector(e.target.value)} className="flex-1 bg-gray-700 p-4 rounded-2xl border border-gray-600 text-sm font-bold outline-none">
                                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <button onClick={handleProcessLocators} className="bg-orange-600 px-12 rounded-2xl font-black uppercase tracking-tighter hover:bg-orange-700 shadow-xl transition-all active:scale-95">Importar</button>
                            </div>
                        </div>
                    </div>
                );
            case 'operators':
                const operatorMonitorUrl = `${window.location.origin}${window.location.pathname}?mode=operators&eventId=${selectedEvent!.id}`;
                return (
                    <div className="space-y-6 animate-fade-in pb-20">
                         {/* Link copy panel - small and useful */}
                         <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="flex items-center space-x-3">
                                <VideoCameraIcon className="w-6 h-6 text-orange-500" />
                                <div>
                                    <h4 className="text-sm font-bold">Link de Monitoramento Externo</h4>
                                    <p className="text-[10px] text-gray-500">Compartilhe este link com supervisores de portaria.</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <input readOnly value={operatorMonitorUrl} className="flex-1 md:w-64 bg-gray-900 border border-gray-700 px-3 py-1.5 rounded-lg text-[10px] font-mono outline-none" />
                                <button 
                                    onClick={() => { navigator.clipboard.writeText(operatorMonitorUrl).then(() => alert("Link copiado!")); }}
                                    className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-lg whitespace-nowrap"
                                >
                                    Copiar Link
                                </button>
                            </div>
                         </div>
                         
                         {/* Integrated Monitor Component */}
                         <div className="bg-gray-800 rounded-3xl border border-gray-700 shadow-2xl overflow-hidden">
                             <OperatorMonitor event={selectedEvent!} scanHistory={scanHistory} isEmbedded />
                         </div>
                    </div>
                );
            case 'history': return <TicketList tickets={scanHistory.filter(s => !allTickets.find(t => t.id === s.ticketId && t.source === 'secret_generator'))} sectorNames={sectorNames} />;
            case 'search': return <div className="bg-gray-800 p-20 text-center text-gray-500 rounded-3xl border border-gray-700 shadow-inner italic">Use a busca global no menu superior para localizar ingressos.</div>;
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10 px-4">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 custom-scrollbar border border-gray-700 items-center text-sm shadow-2xl no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'locators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><TicketIcon className="w-4 h-4 mr-2"/>Localizadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'history' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap transition-all uppercase tracking-tighter ${activeTab === 'events' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}>Eventos</button>
                <button onClick={() => setActiveTab('operators')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg scale-105' : 'hover:bg-gray-700 text-gray-400'}`}><UsersIcon className="w-4 h-4 mr-2"/>Operadores</button>
                {isSuperAdmin && (
                    <div className="ml-auto pl-2 border-l border-gray-600">
                        <button onClick={() => setActiveTab('users')} className={`px-6 py-3 rounded-xl font-black whitespace-nowrap flex items-center transition-all uppercase tracking-tighter ${activeTab === 'users' ? 'bg-purple-600 shadow-lg scale-105' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-2"/>Usuários</button>
                    </div>
                )}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

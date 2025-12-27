
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
    { name: "Sympla (Participantes)", url: "https://api.sympla.com.br/v3/events/[ID_EVENTO]/participants", type: "participants", token: "" }
];

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames = [], hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>('new');
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({
        name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false
    });
    
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.username === 'Administrador';

    useEffect(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        setEditableSectorNames(names);
        setSectorVisibility(names.map(name => !hiddenSectors.includes(name)));
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        if (!selectedEvent) return;
        const loadConfigs = async () => {
            try {
                const iDoc = await getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'));
                if (iDoc.exists()) {
                    const data = iDoc.data();
                    setImportSources(Array.isArray(data.sources) ? data.sources : []);
                    setIgnoreExisting(data.ignoreExisting !== false);
                }
            } catch (e) { console.warn("Config load error", e); }
        };
        loadConfigs();
    }, [db, selectedEvent]);

    const executeImport = async (source: ImportSource) => {
        if (!selectedEvent || !isOnline) return;
        setIsLoading(true);
        try {
            const ticketsToSave: Ticket[] = [];
            const existingIds = ignoreExisting ? new Set(allTickets.map(t => String(t.id).trim())) : new Set();
            const newSectors = new Set<string>();

            if (source.type === 'google_sheets') {
                let fetchUrl = (source.url || '').trim();
                if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                const res = await fetch(fetchUrl);
                const csvText = await res.text();
                const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                rows.forEach(row => {
                    const code = String(row['code'] || row['codigo'] || row['id']).trim();
                    if (code && !existingIds.has(code)) {
                        const sec = String(row['sector'] || row['setor'] || 'Geral');
                        ticketsToSave.push({ id: code, sector: sec, status: 'AVAILABLE', details: { ownerName: row['name'] || row['nome'] } });
                        newSectors.add(sec);
                    }
                });
            } else {
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if (source.token) headers['Authorization'] = `Bearer ${source.token}`;
                const res = await fetch(source.url, { headers });
                const json = await res.json();
                const items = json.data || json.participants || (Array.isArray(json) ? json : []);
                items.forEach((item: any) => {
                    const code = String(item.access_code || item.code || item.qr_code || item.id).trim();
                    if (code && !existingIds.has(code)) {
                        const sec = String(item.sector_name || item.category || 'Geral');
                        ticketsToSave.push({ id: code, sector: sec, status: 'AVAILABLE', details: { ownerName: item.name } });
                        newSectors.add(sec);
                    }
                });
            }

            if (ticketsToSave.length > 0) {
                if (Array.from(newSectors).some(s => !sectorNames.includes(s))) {
                    await onUpdateSectorNames(Array.from(new Set([...sectorNames, ...newSectors])), hiddenSectors);
                }
                const batch = writeBatch(db);
                ticketsToSave.forEach(t => batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true }));
                await batch.commit();
                alert(`${ticketsToSave.length} novos registros importados!`);
            } else alert("Nenhum registro novo encontrado.");
        } catch (e) { alert("Erro: " + (e as any).message); }
        finally { setIsLoading(false); }
    };

    const handleApplyPreset = (name: string) => {
        const p = API_PRESETS.find(x => x.name === name);
        if (p) setEditSource(prev => ({ ...prev, name: p.name, url: p.url, type: p.type as ImportType }));
    };

    const handleSaveEditSource = async () => {
        if (!editSource.name || !editSource.url || !selectedEvent) return alert("Preencha Nome e URL.");
        const newSource = { ...editSource, id: activeSourceId === 'new' ? Math.random().toString(36).substr(2, 9) : activeSourceId } as ImportSource;
        const updated = activeSourceId === 'new' ? [...importSources, newSource] : importSources.map(s => s.id === activeSourceId ? newSource : s);
        setImportSources(updated);
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources: updated, ignoreExisting }, { merge: true });
        setEditSource({ name: '', url: '', token: '', type: 'tickets', autoImport: false });
        setActiveSourceId('new');
        alert("Configuração salva!");
    };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p className="p-10">Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats': return <div className="space-y-6"><Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode="raw" groups={[]} /></div>;
            case 'settings':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                        <div className="bg-gray-800 p-5 rounded-2xl border border-blue-500/20 shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-blue-400"><CloudUploadIcon className="w-5 h-5 mr-2" /> APIs de Importação</h3>
                            <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl mb-4">
                                <select onChange={(e) => handleApplyPreset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 p-2 rounded-lg text-xs">
                                    <option value="">Escolher Preset...</option>
                                    {API_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                                <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL / Endpoint" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <div className="flex items-center justify-between p-2">
                                    <label className="text-xs flex items-center"><input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})} className="mr-2" /> Auto-Sync (10 min)</label>
                                    <select value={editSource.type} onChange={e => setEditSource({...editSource, type: e.target.value as ImportType})} className="bg-gray-800 text-xs p-1 rounded">
                                        <option value="tickets">Ingressos</option>
                                        <option value="google_sheets">Google Sheets</option>
                                        <option value="participants">Participantes</option>
                                    </select>
                                </div>
                                <button onClick={handleSaveEditSource} className="w-full bg-blue-600 p-3 rounded-xl font-bold">Salvar Configuração</button>
                            </div>
                            <div className="space-y-2">
                                {importSources.map(s => (
                                    <div key={s.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl border border-gray-700">
                                        <div><p className="text-sm font-bold">{s.name}</p><p className="text-[10px] text-gray-500">{s.type}</p></div>
                                        <div className="flex gap-2">
                                            <button onClick={() => executeImport(s)} disabled={isLoading} className="text-xs bg-blue-900 text-blue-200 px-3 py-1 rounded-lg">Sync</button>
                                            <button onClick={async () => { if(confirm("Remover?")) { const f = importSources.filter(x => x.id !== s.id); setImportSources(f); await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: f }, { merge: true }); } }} className="text-xs bg-red-900 text-red-200 px-2 py-1 rounded-lg">X</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700">
                            <h3 className="font-bold mb-4 flex items-center"><TableCellsIcon className="w-5 h-5 mr-2" /> Setores Ativos</h3>
                            <div className="space-y-2">
                                {editableSectorNames.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-2">
                                        <span className="flex-grow text-sm">{name}</span>
                                        <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); const h = editableSectorNames.filter((_, idx) => !v[idx]); onUpdateSectorNames(editableSectorNames, h); }} className="p-2 bg-gray-900 rounded-lg">
                                            {sectorVisibility[i] ? <EyeIcon className="w-4 h-4 text-blue-400"/> : <EyeSlashIcon className="w-4 h-4 text-gray-500"/>}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'operators': return <OperatorMonitor event={selectedEvent!} scanHistory={scanHistory} isEmbedded />;
            case 'events':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {events.map(ev => (
                            <div key={ev.id} className="bg-gray-800 p-5 rounded-2xl border border-gray-700 flex justify-between items-center"><span className="font-bold">{ev.name}</span><button onClick={() => onSelectEvent(ev)} className="bg-orange-600 px-4 py-2 rounded-xl text-xs font-bold">Selecionar</button></div>
                        ))}
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg' : 'text-gray-400'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg' : 'text-gray-400'}`}>Configurações</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg' : 'text-gray-400'}`}>Operadores</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'events' ? 'bg-orange-600 shadow-lg' : 'text-gray-400'}`}>Eventos</button>
                {isSuperAdmin && <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'users' ? 'bg-purple-600 shadow-lg' : 'text-purple-400'}`}>Usuários</button>}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

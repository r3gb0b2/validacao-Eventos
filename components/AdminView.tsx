
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import SuperAdminView from './SuperAdminView'; 
import OperatorMonitor from './OperatorMonitor';
import { generateEventReport } from '../utils/pdfGenerator';
// FIX: Import serverTimestamp from firebase/firestore.
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc, getDocs, serverTimestamp } from 'firebase/firestore';
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
    { name: "E-Inscrição (Ingressos)", url: "https://api.e-inscricao.com/v1/eventos/[ID_DO_EVENTO]/ingressos", type: "tickets", token: "" },
    { name: "E-Inscrição (Participantes)", url: "https://api.e-inscricao.com/v1/eventos/[ID_DO_EVENTO]/participantes", type: "participants", token: "" },
    { name: "E-Inscrição (Check-ins)", url: "https://api.e-inscricao.com/v1/eventos/[ID_DO_EVENTO]/checkins", type: "checkins", token: "" },
    { name: "Sympla (Participantes)", url: "https://api.sympla.com.br/v3/events/[ID_DO_EVENTO]/participants", type: "participants", token: "" },
    { name: "Google Sheets (CSV)", url: "https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/export?format=csv", type: "google_sheets", token: "" },
    { name: "Personalizado / Outros", url: "", type: "tickets", token: "" }
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
    
    const [locatorCodes, setLocatorCodes] = useState('');
    const [selectedLocatorSector, setSelectedLocatorSector] = useState(sectorNames[0] || '');

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.username === 'Administrador';

    useEffect(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        setEditableSectorNames(names);
        setSectorVisibility(names.map(name => !hiddenSectors.includes(name)));
        if (!selectedLocatorSector && names.length > 0) setSelectedLocatorSector(names[0]);
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

    const handleCreateEvent = async () => {
        const name = prompt("Nome do novo evento:");
        if (!name) return;
        try {
            await addDoc(collection(db, 'events'), { name, isHidden: false, createdAt: serverTimestamp() });
            alert("Evento criado com sucesso!");
        } catch (e) { alert("Erro ao criar evento."); }
    };

    const handleDeleteSector = async (index: number) => {
        const sectorName = editableSectorNames[index];
        if (!confirm(`Deseja APAGAR permanentemente o setor "${sectorName}" das configurações? Os ingressos existentes manterão o setor, mas ele não aparecerá nas opções.`)) return;
        
        const newNames = editableSectorNames.filter((_, i) => i !== index);
        const newHidden = hiddenSectors.filter(s => s !== sectorName);
        
        setEditableSectorNames(newNames);
        await onUpdateSectorNames(newNames, newHidden);
    };

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
                    // Se ignorar existentes estiver ativo, pula códigos que já estão no banco
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
        if (p) {
            setEditSource(prev => ({ 
                ...prev, 
                name: prev.name || p.name, 
                url: p.url, 
                type: p.type as ImportType 
            }));
        }
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

    const handleProcessLocators = async () => {
        if (!selectedEvent || !db) return;
        const codesInput = locatorCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (codesInput.length === 0) return alert("Nenhum código inserido.");
        
        setIsLoading(true);
        try {
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));
            let addedCount = 0;
            let alreadyExistsCount = 0;
            const ticketsToCreate: { id: string, sector: string }[] = [];

            codesInput.forEach(code => {
                if (existingIds.has(code)) {
                    alreadyExistsCount++;
                } else {
                    ticketsToCreate.push({ id: code, sector: selectedLocatorSector });
                    addedCount++;
                }
            });

            if (ticketsToCreate.length > 0) {
                const BATCH_SIZE = 450;
                for (let i = 0; i < ticketsToCreate.length; i += BATCH_SIZE) {
                    const chunk = ticketsToCreate.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(t => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), {
                            id: t.id,
                            sector: t.sector,
                            status: 'AVAILABLE',
                            source: 'manual_locator'
                        });
                    });
                    await batch.commit();
                }
            }
            setLocatorCodes('');
            alert(`${addedCount} novos localizadores importados com sucesso. ${alreadyExistsCount} códigos já existiam no sistema e foram ignorados.`);
        } catch (e) {
            console.error("Erro ao processar localizadores:", e);
            alert("Erro ao processar localizadores.");
        } finally {
            setIsLoading(false);
        }
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
                            <h3 className="font-bold mb-4 flex items-center text-blue-400"><CloudUploadIcon className="w-5 h-5 mr-2" /> Configuração de Importação (APIs)</h3>
                            <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl mb-4">
                                <p className="text-[10px] font-bold text-gray-500 uppercase">Preencher com Modelo:</p>
                                <select onChange={(e) => handleApplyPreset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 p-2 rounded-lg text-xs outline-none">
                                    <option value="">Escolher Preset...</option>
                                    {API_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                                <hr className="border-gray-700 my-2" />
                                <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none focus:border-blue-500" />
                                <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL da API (Endpoint)" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none focus:border-blue-500" />
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-gray-500 mb-1 ml-1">Autorização (Bearer)</label>
                                        <input value={editSource.token} onChange={e => setEditSource({...editSource, token: e.target.value})} placeholder="Token..." className="bg-gray-800 border border-gray-700 p-2 rounded-lg text-xs outline-none" />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-[10px] text-gray-500 mb-1 ml-1">Tipo de Dado</label>
                                        <select value={editSource.type} onChange={e => setEditSource({...editSource, type: e.target.value as ImportType})} className="bg-gray-800 border border-gray-700 text-xs p-2 rounded-lg outline-none">
                                            <option value="tickets">Ingressos</option>
                                            <option value="participants">Participantes</option>
                                            <option value="checkins">Base de Check-ins</option>
                                            <option value="google_sheets">Google Sheets (CSV)</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="bg-gray-900 p-3 rounded-xl border border-gray-700">
                                    <label className="flex items-center cursor-pointer text-xs font-bold text-gray-400">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="mr-2 h-4 w-4 rounded bg-gray-800 border-gray-600 text-blue-600" />
                                        Ignorar atualizações de ingressos já existentes (Não alterar dados)
                                    </label>
                                </div>
                                <div className="flex items-center justify-between p-2">
                                    <label className="text-xs flex items-center font-bold text-gray-400 cursor-pointer"><input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})} className="mr-2" /> Auto-Sincronização (5 min)</label>
                                </div>
                                <button onClick={handleSaveEditSource} className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">Salvar Configuração</button>
                            </div>
                            <div className="space-y-2">
                                <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Fontes Ativas:</p>
                                {importSources.map(s => (
                                    <div key={s.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl border border-gray-700">
                                        <div>
                                            <p className="text-sm font-bold text-white">{s.name} {s.autoImport && <span className="text-[8px] bg-green-900 text-green-400 px-1 rounded ml-1">AUTO</span>}</p>
                                            <p className="text-[9px] text-gray-500 truncate max-w-[150px]">{s.url}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => executeImport(s)} disabled={isLoading} className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold">Sync</button>
                                            <button onClick={async () => { if(confirm("Remover?")) { const f = importSources.filter(x => x.id !== s.id); setImportSources(f); await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: f }, { merge: true }); } }} className="p-2 bg-red-900/30 text-red-500 hover:bg-red-600 hover:text-white rounded-lg transition-all"><TrashIcon className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-gray-300"><TableCellsIcon className="w-5 h-5 mr-2" /> Setores e Visibilidade</h3>
                            <div className="space-y-2">
                                {editableSectorNames.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-2 bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                                        <span className="flex-grow text-sm font-medium">{name}</span>
                                        <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); const h = editableSectorNames.filter((_, idx) => !v[idx]); onUpdateSectorNames(editableSectorNames, h); }} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all" title="Alternar Visibilidade">
                                            {sectorVisibility[i] ? <EyeIcon className="w-4 h-4 text-blue-400"/> : <EyeSlashIcon className="w-4 h-4 text-gray-500"/>}
                                        </button>
                                        <button onClick={() => handleDeleteSector(i)} className="p-2 bg-red-900/20 text-red-500 hover:bg-red-600 hover:text-white rounded-lg transition-all" title="Apagar Setor">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'operators': return <OperatorMonitor event={selectedEvent!} allTickets={allTickets} scanHistory={scanHistory} isEmbedded />;
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
                                <button onClick={handleProcessLocators} disabled={isLoading} className="bg-orange-600 px-12 rounded-2xl font-black uppercase tracking-tighter hover:bg-orange-700 shadow-xl transition-all active:scale-95 disabled:opacity-50">
                                    {isLoading ? 'Processando...' : 'Importar'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 'events':
                return (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-2xl border border-gray-700">
                            <div>
                                <h3 className="font-bold text-white">Gerenciar Eventos</h3>
                                <p className="text-xs text-gray-500">Crie ou selecione eventos ativos.</p>
                            </div>
                            <button onClick={handleCreateEvent} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center shadow-lg transition-all active:scale-95">
                                <PlusCircleIcon className="w-4 h-4 mr-2" /> Novo Evento
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {events.map(ev => (
                                <div key={ev.id} className={`bg-gray-800 p-5 rounded-2xl border transition-all flex justify-between items-center ${selectedEvent?.id === ev.id ? 'border-orange-500 bg-orange-500/5' : 'border-gray-700'}`}>
                                    <span className="font-bold">{ev.name}</span>
                                    <button onClick={() => onSelectEvent(ev)} className={`${selectedEvent?.id === ev.id ? 'bg-orange-600' : 'bg-gray-700'} px-4 py-2 rounded-xl text-xs font-bold`}>
                                        {selectedEvent?.id === ev.id ? 'Selecionado' : 'Selecionar'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'history': return <TicketList tickets={scanHistory.filter(s => !allTickets.find(t => t.id === s.ticketId && t.source === 'secret_generator'))} sectorNames={sectorNames} />;
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10 px-4">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'locators' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Localizadores</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Operadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'history' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'events' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Eventos</button>
                {isSuperAdmin && <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all ${activeTab === 'users' ? 'bg-purple-600 shadow-lg text-white' : 'text-purple-400 hover:bg-purple-900'}`}>Usuários</button>}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

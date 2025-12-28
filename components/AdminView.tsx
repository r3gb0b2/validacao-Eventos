
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup, ImportSource, ImportType } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import SuperAdminView from './SuperAdminView'; 
import OperatorMonitor from './OperatorMonitor';
import { generateEventReport } from '../utils/pdfGenerator';
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
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'manual_add'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [activeSourceId, setActiveSourceId] = useState<string>('new');
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({
        name: '', url: '', token: '', eventId: '', type: 'tickets', autoImport: false
    });
    
    // Estados para Adição Manual
    const [locatorCodes, setLocatorCodes] = useState('');
    const [singleCode, setSingleCode] = useState('');
    const [singleName, setSingleName] = useState('');
    const [selectedManualSector, setSelectedManualSector] = useState(sectorNames[0] || '');

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.username === 'Administrador';

    const publicLink = useMemo(() => {
        if (!selectedEvent) return '';
        const base = window.location.origin + window.location.pathname;
        return `${base}?mode=stats&eventId=${selectedEvent.id}`;
    }, [selectedEvent]);

    useEffect(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        setEditableSectorNames(names);
        setSectorVisibility(names.map(name => !hiddenSectors.includes(name)));
        if (!selectedManualSector && names.length > 0) setSelectedManualSector(names[0]);
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
        if (!confirm(`Deseja APAGAR permanentemente o setor "${sectorName}"?`)) return;
        const newNames = editableSectorNames.filter((_, i) => i !== index);
        const newHidden = hiddenSectors.filter(s => s !== sectorName);
        setEditableSectorNames(newNames);
        await onUpdateSectorNames(newNames, newHidden);
    };

    const handleAddSingleTicket = async () => {
        if (!selectedEvent || !singleCode.trim()) return alert("Informe ao menos o código.");
        setIsLoading(true);
        try {
            const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', singleCode.trim());
            const snap = await getDoc(ticketRef);
            if (snap.exists() && !confirm("Este código já existe. Deseja sobrescrever os dados?")) {
                setIsLoading(false);
                return;
            }
            await setDoc(ticketRef, {
                id: singleCode.trim(),
                sector: selectedManualSector,
                status: 'AVAILABLE',
                source: 'manual_entry',
                details: { ownerName: singleName.trim() }
            });
            setSingleCode('');
            setSingleName('');
            alert("Ingresso adicionado!");
        } catch (e) { alert("Erro ao adicionar."); }
        finally { setIsLoading(false); }
    };

    const handleProcessLocators = async () => {
        if (!selectedEvent || !db) return;
        const codesInput = locatorCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (codesInput.length === 0) return alert("Nenhum código inserido.");
        
        setIsLoading(true);
        try {
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));
            let addedCount = 0;
            const ticketsToCreate: any[] = [];

            codesInput.forEach(code => {
                if (!existingIds.has(code)) {
                    ticketsToCreate.push({ id: code, sector: selectedManualSector });
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
            alert(`${addedCount} novos ingressos importados.`);
        } catch (e) { alert("Erro ao importar lote."); }
        finally { setIsLoading(false); }
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
        if (p) setEditSource(prev => ({ ...prev, name: prev.name || p.name, url: p.url, type: p.type as ImportType }));
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

    const handleCopyPublicLink = () => {
        navigator.clipboard.writeText(publicLink);
        alert("Link público copiado!");
    };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p className="p-10">Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats': 
                return (
                    <div className="space-y-6">
                        {/* BARRA DE AÇÕES DO DASHBOARD */}
                        <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg">
                            <div className="flex items-center space-x-2">
                                <button 
                                    onClick={() => generateEventReport(selectedEvent!.name, allTickets, scanHistory, sectorNames)}
                                    className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center transition-all shadow-lg active:scale-95"
                                >
                                    <CloudDownloadIcon className="w-4 h-4 mr-2" /> Gerar Relatório PDF
                                </button>
                            </div>

                            <div className="flex items-center space-x-3 w-full md:w-auto bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                                <LinkIcon className="w-4 h-4 text-gray-500 ml-2" />
                                <input 
                                    type="text" 
                                    readOnly 
                                    value={publicLink} 
                                    className="bg-transparent text-[10px] text-gray-400 outline-none w-48 md:w-64 truncate"
                                />
                                <button 
                                    onClick={handleCopyPublicLink}
                                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold"
                                >
                                    Copiar Link Público
                                </button>
                            </div>
                        </div>

                        <Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode="raw" groups={[]} />
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                        <div className="bg-gray-800 p-5 rounded-2xl border border-blue-500/20 shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-blue-400"><CloudUploadIcon className="w-5 h-5 mr-2" /> Importação de APIs / Sheets</h3>
                            <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl mb-4">
                                <select onChange={(e) => handleApplyPreset(e.target.value)} className="w-full bg-gray-800 border border-gray-700 p-2 rounded-lg text-xs outline-none">
                                    <option value="">Escolher Preset...</option>
                                    {API_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                </select>
                                <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL da API" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <div className="bg-gray-900 p-3 rounded-xl border border-gray-700">
                                    <label className="flex items-center cursor-pointer text-xs font-bold text-gray-400">
                                        <input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} className="mr-2 h-4 w-4 rounded bg-gray-800 border-gray-600 text-blue-600" />
                                        Ignorar atualizações de ingressos existentes (Não sobrescrever dados)
                                    </label>
                                </div>
                                <div className="flex items-center justify-between p-2">
                                    <label className="text-xs flex items-center font-bold text-gray-400 cursor-pointer"><input type="checkbox" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})} className="mr-2" /> Auto-Sinc (5 min)</label>
                                </div>
                                <button onClick={handleSaveEditSource} className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">Salvar Configuração</button>
                            </div>
                            <div className="space-y-2">
                                {importSources.map(s => (
                                    <div key={s.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl border border-gray-700">
                                        <div className="truncate pr-4"><p className="text-sm font-bold text-white truncate">{s.name}</p></div>
                                        <div className="flex gap-2 shrink-0">
                                            <button onClick={() => executeImport(s)} disabled={isLoading} className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold">Sync</button>
                                            <button onClick={async () => { if(confirm("Remover?")) { const f = importSources.filter(x => x.id !== s.id); setImportSources(f); await setDoc(doc(db, 'events', selectedEvent!.id, 'settings', 'import_v2'), { sources: f }, { merge: true }); } }} className="p-2 bg-red-900/30 text-red-500 rounded-lg"><TrashIcon className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-gray-300"><TableCellsIcon className="w-5 h-5 mr-2" /> Setores Disponíveis</h3>
                            <div className="space-y-2">
                                {editableSectorNames.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-2 bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                                        <span className="flex-grow text-sm font-medium">{name}</span>
                                        <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); const h = editableSectorNames.filter((_, idx) => !v[idx]); onUpdateSectorNames(editableSectorNames, h); }} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg">
                                            {sectorVisibility[i] ? <EyeIcon className="w-4 h-4 text-blue-400"/> : <EyeSlashIcon className="w-4 h-4 text-gray-500"/>}
                                        </button>
                                        <button onClick={() => handleDeleteSector(i)} className="p-2 bg-red-900/20 text-red-500 hover:bg-red-600 hover:text-white rounded-lg transition-all">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'manual_add': 
                return (
                    <div className="space-y-6 animate-fade-in pb-20">
                        {/* ADICIONAR INDIVIDUAL */}
                        <div className="bg-gray-800 p-6 rounded-2xl border border-orange-500/20 shadow-2xl">
                            <h2 className="text-xl font-bold mb-6 flex items-center text-orange-500"><PlusCircleIcon className="w-6 h-6 mr-2"/> Novo Ingresso Individual</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500 ml-1 font-bold uppercase">Código (QR/ID)</label>
                                    <input type="text" value={singleCode} onChange={e => setSingleCode(e.target.value)} placeholder="Ex: ABC-123" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none focus:border-orange-500" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500 ml-1 font-bold uppercase">Nome do Participante</label>
                                    <input type="text" value={singleName} onChange={e => setSingleName(e.target.value)} placeholder="Opcional" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none focus:border-orange-500" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500 ml-1 font-bold uppercase">Setor</label>
                                    <select value={selectedManualSector} onChange={e => setSelectedManualSector(e.target.value)} className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm font-bold outline-none h-[54px]">
                                        {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>
                            <button onClick={handleAddSingleTicket} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-4 rounded-xl font-black uppercase text-sm tracking-widest shadow-lg transition-all active:scale-95">
                                {isLoading ? 'Salvando...' : 'Adicionar Ingresso'}
                            </button>
                        </div>

                        {/* CARGA EM LOTE */}
                        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold flex items-center text-gray-300"><TableCellsIcon className="w-6 h-6 mr-2"/> Carga de Códigos em Lote</h2>
                            </div>
                            <p className="text-xs text-gray-500 mb-4">Cole uma lista de códigos (um por linha). Todos serão associados ao setor selecionado abaixo.</p>
                            <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="ABC-001&#10;ABC-002&#10;ABC-003" className="w-full h-48 bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-4 font-mono text-sm outline-none focus:border-orange-500 transition-all shadow-inner"/>
                            <div className="flex gap-4">
                                <select value={selectedManualSector} onChange={e => setSelectedManualSector(e.target.value)} className="flex-1 bg-gray-700 p-4 rounded-2xl border border-gray-600 text-sm font-bold outline-none">
                                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <button onClick={handleProcessLocators} disabled={isLoading} className="bg-gray-700 px-12 rounded-2xl font-black uppercase text-xs tracking-tighter hover:bg-gray-600 shadow-xl transition-all active:scale-95 disabled:opacity-50 border border-gray-600">
                                    {isLoading ? 'Importando...' : 'Importar Lote'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            case 'operators': return <OperatorMonitor event={selectedEvent!} allTickets={allTickets} scanHistory={scanHistory} isEmbedded />;
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
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Configurações</button>
                <button onClick={() => setActiveTab('manual_add')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'manual_add' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Adicionar Ingressos</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Operadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'history' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'events' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Eventos</button>
                {isSuperAdmin && <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'users' ? 'bg-purple-600 shadow-lg text-white' : 'text-purple-400 hover:bg-purple-900'}`}>Usuários</button>}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

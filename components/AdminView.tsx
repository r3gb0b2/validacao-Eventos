
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

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames = [], hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'operators' | 'manual_direct' | 'localizadoras'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    const [ignoreExisting, setIgnoreExisting] = useState(true);
    
    // Estados para Entradas
    const [locatorCodes, setLocatorCodes] = useState('');
    const [manualCodes, setManualCodes] = useState('');
    const [singleCode, setSingleCode] = useState('');
    const [singleName, setSingleName] = useState('');
    const [selectedSector, setSelectedSector] = useState(sectorNames[0] || '');

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
        if (!selectedSector && names.length > 0) setSelectedSector(names[0]);
    }, [sectorNames, hiddenSectors]);

    const handleCreateEvent = async () => {
        const name = prompt("Nome do novo evento:");
        if (!name) return;
        try {
            await addDoc(collection(db, 'events'), { name, isHidden: false, createdAt: serverTimestamp() });
        } catch (e) { alert("Erro ao criar evento."); }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (!confirm(`TEM CERTEZA? Isso excluirá o evento "${eventName}" permanentemente. Ingressos e logs NÃO serão apagados automaticamente do banco, apenas o acesso ao evento.`)) return;
        try {
            await deleteDoc(doc(db, 'events', eventId));
            if (selectedEvent?.id === eventId) onSelectEvent(null as any);
        } catch (e) { alert("Erro ao excluir evento."); }
    };

    const handleAddTickets = async (mode: 'locator' | 'direct', inputType: 'single' | 'batch') => {
        if (!selectedEvent) return;
        setIsLoading(true);
        const source = mode === 'locator' ? 'manual_locator' : 'manual_direct';
        
        try {
            if (inputType === 'single') {
                if (!singleCode.trim()) throw new Error("Informe o código.");
                await setDoc(doc(db, 'events', selectedEvent.id, 'tickets', singleCode.trim()), {
                    id: singleCode.trim(),
                    sector: selectedSector,
                    status: 'AVAILABLE',
                    source,
                    details: { ownerName: singleName.trim() }
                });
                setSingleCode('');
                setSingleName('');
                alert("Ingresso adicionado!");
            } else {
                const codes = (mode === 'locator' ? locatorCodes : manualCodes).split('\n').map(c => c.trim()).filter(c => c.length > 0);
                if (codes.length === 0) throw new Error("Nenhum código inserido.");
                
                const BATCH_SIZE = 450;
                for (let i = 0; i < codes.length; i += BATCH_SIZE) {
                    const chunk = codes.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(code => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), {
                            id: code,
                            sector: selectedSector,
                            status: 'AVAILABLE',
                            source
                        });
                    });
                    await batch.commit();
                }
                mode === 'locator' ? setLocatorCodes('') : setManualCodes('');
                alert(`${codes.length} ingressos adicionados com sucesso!`);
            }
        } catch (e: any) { alert(e.message); }
        finally { setIsLoading(false); }
    };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p className="p-10">Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats': 
                return (
                    <div className="space-y-6">
                        <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg">
                            <button onClick={() => generateEventReport(selectedEvent!.name, allTickets, scanHistory, sectorNames)} className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center transition-all shadow-lg active:scale-95">
                                <CloudDownloadIcon className="w-4 h-4 mr-2" /> Gerar Relatório PDF
                            </button>
                            <div className="flex items-center space-x-3 w-full md:w-auto bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                                <LinkIcon className="w-4 h-4 text-gray-500 ml-2" />
                                <input type="text" readOnly value={publicLink} className="bg-transparent text-[10px] text-gray-400 outline-none w-48 md:w-64 truncate" />
                                <button onClick={() => { navigator.clipboard.writeText(publicLink); alert("Copiado!"); }} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold">Copiar Link Público</button>
                            </div>
                        </div>
                        <Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode="raw" groups={[]} />
                    </div>
                );
            case 'localizadoras':
                return (
                    <div className="space-y-6 animate-fade-in pb-20">
                        <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-2xl">
                            <h2 className="text-xl font-bold mb-2 flex items-center text-blue-400"><ClockIcon className="w-6 h-6 mr-2"/> Localizadoras (Lote ou Individual)</h2>
                            <p className="text-xs text-gray-500 mb-6 italic">* Estes ingressos só aparecerão no Dashboard após serem validados na portaria.</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <label className="text-xs font-bold text-gray-400 uppercase">Carga em Lote</label>
                                    <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="Cole os códigos aqui..." className="w-full h-40 bg-gray-900 border border-gray-700 rounded-xl p-4 font-mono text-sm outline-none focus:border-blue-500" />
                                    <select value={selectedSector} onChange={e => setSelectedSector(e.target.value)} className="w-full bg-gray-700 p-4 rounded-xl border border-gray-600 font-bold outline-none">
                                        {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <button onClick={() => handleAddTickets('locator', 'batch')} disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 py-4 rounded-xl font-black uppercase tracking-widest transition-all">Importar Lote</button>
                                </div>
                                <div className="space-y-4 border-l border-gray-700 pl-6">
                                    <label className="text-xs font-bold text-gray-400 uppercase">Entrada Individual</label>
                                    <input type="text" value={singleCode} onChange={e => setSingleCode(e.target.value)} placeholder="Código" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none" />
                                    <input type="text" value={singleName} onChange={e => setSingleName(e.target.value)} placeholder="Nome (Opcional)" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none" />
                                    <button onClick={() => handleAddTickets('locator', 'single')} disabled={isLoading} className="w-full bg-gray-700 hover:bg-gray-600 py-4 rounded-xl font-black uppercase tracking-widest transition-all">Adicionar Único</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'manual_direct':
                return (
                    <div className="space-y-6 animate-fade-in pb-20">
                        <div className="bg-gray-800 p-6 rounded-2xl border border-orange-500/20 shadow-2xl">
                            <h2 className="text-xl font-bold mb-2 flex items-center text-orange-500"><PlusCircleIcon className="w-6 h-6 mr-2"/> Adicionar Manual (Lote ou Individual)</h2>
                            <p className="text-xs text-gray-500 mb-6 italic">* Estes ingressos aparecerão imediatamente no total de carga do Dashboard.</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <label className="text-xs font-bold text-gray-400 uppercase">Carga em Lote</label>
                                    <textarea value={manualCodes} onChange={e => setManualCodes(e.target.value)} placeholder="Cole os códigos aqui..." className="w-full h-40 bg-gray-900 border border-gray-700 rounded-xl p-4 font-mono text-sm outline-none focus:border-orange-500" />
                                    <select value={selectedSector} onChange={e => setSelectedSector(e.target.value)} className="w-full bg-gray-700 p-4 rounded-xl border border-gray-600 font-bold outline-none">
                                        {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <button onClick={() => handleAddTickets('direct', 'batch')} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-4 rounded-xl font-black uppercase tracking-widest transition-all">Importar Lote</button>
                                </div>
                                <div className="space-y-4 border-l border-gray-700 pl-6">
                                    <label className="text-xs font-bold text-gray-400 uppercase">Entrada Individual</label>
                                    <input type="text" value={singleCode} onChange={e => setSingleCode(e.target.value)} placeholder="Código" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none" />
                                    <input type="text" value={singleName} onChange={e => setSingleName(e.target.value)} placeholder="Nome (Opcional)" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none" />
                                    <button onClick={() => handleAddTickets('direct', 'single')} disabled={isLoading} className="w-full bg-gray-700 hover:bg-gray-600 py-4 rounded-xl font-black uppercase tracking-widest transition-all">Adicionar Único</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'events':
                return (
                    <div className="space-y-6">
                        <div className="flex justify-between items-center bg-gray-800 p-4 rounded-2xl border border-gray-700">
                            <h3 className="font-bold text-white">Gerenciar Eventos</h3>
                            <button onClick={handleCreateEvent} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center shadow-lg transition-all active:scale-95">
                                <PlusCircleIcon className="w-4 h-4 mr-2" /> Novo Evento
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {events.map(ev => (
                                <div key={ev.id} className={`bg-gray-800 p-5 rounded-2xl border transition-all flex justify-between items-center ${selectedEvent?.id === ev.id ? 'border-orange-500 bg-orange-500/5' : 'border-gray-700'}`}>
                                    <span className="font-bold">{ev.name}</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => onSelectEvent(ev)} className={`${selectedEvent?.id === ev.id ? 'bg-orange-600' : 'bg-gray-700'} px-4 py-2 rounded-xl text-xs font-bold`}>
                                            {selectedEvent?.id === ev.id ? 'Selecionado' : 'Selecionar'}
                                        </button>
                                        <button onClick={() => handleDeleteEvent(ev.id, ev.name)} className="p-2 bg-red-900/30 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all">
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                            <h3 className="font-bold mb-4 flex items-center text-gray-300"><TableCellsIcon className="w-5 h-5 mr-2" /> Setores Disponíveis</h3>
                            <div className="space-y-2">
                                {editableSectorNames.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-2 bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                                        <span className="flex-grow text-sm font-medium">{name}</span>
                                        <button onClick={() => { const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v); const h = editableSectorNames.filter((_, idx) => !v[idx]); onUpdateSectorNames(editableSectorNames, h); }} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg">
                                            {sectorVisibility[i] ? <EyeIcon className="w-4 h-4 text-blue-400"/> : <EyeSlashIcon className="w-4 h-4 text-gray-500"/>}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10 px-4">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'stats' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Setores</button>
                <button onClick={() => setActiveTab('localizadoras')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'localizadoras' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Localizadoras</button>
                <button onClick={() => setActiveTab('manual_direct')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'manual_direct' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Add Manual</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'operators' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Operadores</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'events' ? 'bg-orange-600 shadow-lg text-white' : 'text-gray-400 hover:bg-gray-700'}`}>Eventos</button>
                {isSuperAdmin && <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap ${activeTab === 'users' ? 'bg-purple-600 shadow-lg text-white' : 'text-purple-400 hover:bg-purple-900'}`}>Usuários</button>}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

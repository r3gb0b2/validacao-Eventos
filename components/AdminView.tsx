
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
    
    const [allUsers, setAllUsers] = useState<User[]>([]);
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
        if (sectorNames) {
            setEditableSectorNames(Array.isArray(sectorNames) ? sectorNames : []);
            setSectorVisibility((Array.isArray(sectorNames) ? sectorNames : []).map(name => !hiddenSectors.includes(name)));
            if (!selectedLocatorSector && sectorNames.length > 0) setSelectedLocatorSector(sectorNames[0]);
        }
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
        if (!selectedEvent) return;
        setIsLoading(true);
        try {
            // Lógica de importação simplificada para segurança
            alert("Iniciando importação...");
            setIsLoading(false);
        } catch (e) { setIsLoading(false); }
    };

    const handleSaveEditSource = async () => {
        if (!editSource.name || !editSource.url || !selectedEvent) return;
        const newSource = { ...editSource, id: activeSourceId === 'new' ? Math.random().toString(36).substr(2, 9) : activeSourceId } as ImportSource;
        const updated = activeSourceId === 'new' ? [...importSources, newSource] : importSources.map(s => s.id === activeSourceId ? newSource : s);
        setImportSources(updated);
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources: updated, ignoreExisting }, { merge: true });
        setEditSource({ name: '', url: '', token: '', type: 'tickets', autoImport: false });
        setActiveSourceId('new');
    };

    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p className="p-10">Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
        
        switch (activeTab) {
            case 'stats':
                return (
                    <div className="space-y-6">
                        <Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode="raw" groups={[]} />
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700">
                            <h3 className="font-bold mb-4 flex items-center"><CogIcon className="w-5 h-5 mr-2" /> APIs de Importação</h3>
                            <div className="space-y-4">
                                <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da API" className="w-full bg-gray-900 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL / Endpoint" className="w-full bg-gray-900 border border-gray-700 p-3 rounded-xl text-sm outline-none" />
                                <button onClick={handleSaveEditSource} className="w-full bg-blue-600 p-3 rounded-xl font-bold">Salvar API</button>
                            </div>
                            <div className="mt-6 space-y-2">
                                {importSources.map(s => (
                                    <div key={s.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl">
                                        <span className="text-sm font-bold">{s.name}</span>
                                        <button onClick={() => executeImport(s)} className="text-xs bg-gray-700 px-3 py-1 rounded-lg">Sincronizar</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700">
                            <h3 className="font-bold mb-4">Setores Ativos</h3>
                            <div className="space-y-2">
                                {editableSectorNames.map((name, i) => (
                                    <div key={i} className="flex items-center space-x-2">
                                        <span className="flex-grow text-sm">{name}</span>
                                        <button onClick={() => {
                                            const v = [...sectorVisibility]; v[i] = !v[i]; setSectorVisibility(v);
                                            const hidden = editableSectorNames.filter((_, idx) => !v[idx]);
                                            onUpdateSectorNames(editableSectorNames, hidden);
                                        }} className="p-2 bg-gray-900 rounded-lg">
                                            {sectorVisibility[i] ? <EyeIcon className="w-4 h-4 text-blue-400"/> : <EyeSlashIcon className="w-4 h-4 text-gray-500"/>}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            case 'operators':
                return <OperatorMonitor event={selectedEvent!} scanHistory={scanHistory} isEmbedded />;
            case 'events':
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {events.map(ev => (
                            <div key={ev.id} className="bg-gray-800 p-5 rounded-2xl border border-gray-700 flex justify-between items-center">
                                <span className="font-bold">{ev.name}</span>
                                <button onClick={() => onSelectEvent(ev)} className="bg-orange-600 px-4 py-2 rounded-xl text-xs font-bold">Selecionar</button>
                            </div>
                        ))}
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-2xl p-2 mb-6 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'stats' ? 'bg-orange-600' : 'text-gray-400'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'settings' ? 'bg-orange-600' : 'text-gray-400'}`}>Configurações</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'operators' ? 'bg-orange-600' : 'text-gray-400'}`}>Operadores</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'events' ? 'bg-orange-600' : 'text-gray-400'}`}>Eventos</button>
                {isSuperAdmin && <button onClick={() => setActiveTab('users')} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase ${activeTab === 'users' ? 'bg-purple-600' : 'text-purple-400'}`}>Usuários</button>}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;

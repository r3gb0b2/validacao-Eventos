
import React, { useState, useEffect } from 'react';
import { Ticket, DisplayableScanLog, Event, User, SectorGroup, ImportSource } from './types';
import { Firestore, collection, writeBatch, doc, addDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { PlusCircleIcon, TrashIcon, SearchIcon, ShieldCheckIcon, CloudDownloadIcon } from './components/Icons';

// Módulos
import DashboardModule from './components/admin/DashboardModule';
import SettingsModule from './components/admin/SettingsModule';
import GroupingModule from './components/admin/GroupingModule';
import LocalizadorasModule from './components/admin/LocalizadorasModule';
import AlertTicketsModule from './components/admin/AlertTicketsModule';
import ManualAddModule from './components/admin/ManualAddModule';
import ParticipantsModule from './components/admin/ParticipantsModule';
import AutoImportModule from './components/admin/AutoImportModule';
import LookupModule from './components/admin/LookupModule';
import SecurityModule from './components/admin/SecurityModule'; // Novo
import OperatorMonitor from './components/OperatorMonitor';
import TicketList from './components/TicketList';
import SuperAdminView from './components/SuperAdminView';

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
}

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames = [], hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'groups' | 'settings' | 'history' | 'events' | 'operators' | 'manual' | 'locator' | 'alerts' | 'users' | 'participants' | 'auto_import' | 'lookup' | 'security'>(() => {
        try {
            return (localStorage.getItem('admin_active_tab') as any) || 'stats';
        } catch(e) { return 'stats'; }
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [groups, setGroups] = useState<SectorGroup[]>([]);
    const [importSources, setImportSources] = useState<ImportSource[]>([]);

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.username === 'Administrador';

    useEffect(() => {
        localStorage.setItem('admin_active_tab', activeTab);
    }, [activeTab]);

    useEffect(() => {
        if (!selectedEvent || !db) return;
        
        const unsubStats = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setGroups(Array.isArray(data.groups) ? data.groups : []);
            } else {
                setGroups([]);
            }
        });

        const unsubImport = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setImportSources(Array.isArray(data.sources) ? data.sources : []);
            } else {
                setImportSources([]);
            }
        });

        return () => { unsubStats(); unsubImport(); };
    }, [db, selectedEvent]);

    const handleUpdateGroups = async (newGroups: SectorGroup[]) => {
        if (!selectedEvent) return;
        setGroups(newGroups);
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), { groups: newGroups }, { merge: true });
    };

    const handleUpdateImportSources = async (sources: ImportSource[]) => {
        if (!selectedEvent) return;
        setImportSources(sources);
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), { sources }, { merge: true });
    };

    const downloadFirebaseRC = () => {
        const config = {
            projects: {
                default: "stingressos-e0a5f"
            }
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '.firebaserc';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const renderModule = () => {
        if (activeTab === 'events') return (
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-center bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl gap-4">
                    <h3 className="font-bold text-white text-lg">Gerenciar Eventos</h3>
                    <div className="flex gap-2">
                        <button 
                            onClick={downloadFirebaseRC} 
                            className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-2xl text-xs font-bold flex items-center shadow-lg transition-all active:scale-95"
                            title="Baixar arquivo de configuração do Firebase para CLI"
                        >
                            <CloudDownloadIcon className="w-5 h-5 mr-2" /> .firebaserc
                        </button>
                        <button 
                            onClick={async () => { const n = prompt("Nome do Evento:"); if(n) await addDoc(collection(db, 'events'), { name: n, createdAt: serverTimestamp() }); }} 
                            className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-2xl text-xs font-bold flex items-center shadow-lg transition-all active:scale-95"
                        >
                            <PlusCircleIcon className="w-5 h-5 mr-2" /> Novo Evento
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {events.map(ev => (
                        <div key={ev.id} className={`bg-gray-800 p-6 rounded-3xl border flex justify-between items-center transition-all ${selectedEvent?.id === ev.id ? 'border-orange-500 ring-2 ring-orange-500/20' : 'border-gray-700 hover:border-gray-600'}`}>
                            <span className="font-bold text-gray-100">{ev.name}</span>
                            <div className="flex gap-2">
                                <button onClick={() => onSelectEvent(ev)} className={`${selectedEvent?.id === ev.id ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300'} px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md`}>{selectedEvent?.id === ev.id ? 'Ativo' : 'Selecionar'}</button>
                                <button onClick={async () => { if(confirm("EXCLUIR EVENTO? Todos os ingressos e scans serão apagados.")) await deleteDoc(doc(db, 'events', ev.id)); }} className="p-2.5 text-red-500 bg-red-900/10 rounded-xl hover:bg-red-600 hover:text-white transition-all"><TrashIcon className="w-5 h-5" /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );

        if (activeTab === 'users' && isSuperAdmin) return <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} />;

        if (!selectedEvent) return (
            <div className="p-20 text-center text-gray-400 bg-gray-800 rounded-[2.5rem] border-2 border-dashed border-gray-700 shadow-inner">
                <p className="text-xl font-black mb-2 text-gray-200">Painel Bloqueado</p>
                <button onClick={() => setActiveTab('events')} className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-4 rounded-2xl font-bold">Ir para Eventos</button>
            </div>
        );

        switch (activeTab) {
            case 'stats': return <DashboardModule selectedEvent={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} groups={groups} />;
            case 'auto_import': return <AutoImportModule db={db} selectedEvent={selectedEvent} importSources={importSources} allTickets={allTickets} onUpdateSectorNames={onUpdateSectorNames} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} />;
            case 'security': return <SecurityModule scanHistory={scanHistory} />;
            case 'lookup': return <LookupModule allTickets={allTickets} scanHistory={scanHistory} />;
            case 'groups': return <GroupingModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} groups={groups} onUpdateGroups={handleUpdateGroups} />;
            case 'participants': return <ParticipantsModule allTickets={allTickets} sectorNames={sectorNames} />;
            case 'settings': return <SettingsModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} importSources={importSources} onUpdateSectorNames={onUpdateSectorNames} onUpdateImportSources={handleUpdateImportSources} isLoading={isLoading} setIsLoading={setIsLoading} allTickets={allTickets} />;
            case 'history': return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'operators': return <OperatorMonitor event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} isEmbedded />;
            case 'locator': return <LocalizadorasModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} isLoading={isLoading} setIsLoading={setIsLoading} allTickets={allTickets} />;
            case 'alerts': return <AlertTicketsModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} isLoading={isLoading} setIsLoading={setIsLoading} allTickets={allTickets} />;
            case 'manual': return <ManualAddModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} isLoading={isLoading} setIsLoading={setIsLoading} allTickets={allTickets} />;
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-32 px-4">
            <div className="bg-gray-800 rounded-[1.5rem] p-2 mb-8 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar sticky top-4 z-40 shadow-2xl backdrop-blur-md">
                {[
                    { id: 'stats', label: 'Dashboard' },
                    { id: 'auto_import', label: 'Auto Import' },
                    { id: 'security', label: 'Segurança' },
                    { id: 'lookup', label: 'Consulta' },
                    { id: 'participants', label: 'Participantes' },
                    { id: 'settings', label: 'Configurações' },
                    { id: 'alerts', label: 'Alertas' },
                    { id: 'manual', label: 'Add Manual' },
                    { id: 'locator', label: 'Localizadoras' },
                    { id: 'operators', label: 'Operadores' },
                    { id: 'history', label: 'Histórico' },
                    { id: 'events', label: 'Eventos' },
                    ...(isSuperAdmin ? [{ id: 'users', label: 'Usuários' }] : [])
                ].map(tab => (
                    <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id as any)} 
                        className={`px-6 py-3 rounded-2xl text-xs font-black uppercase transition-all whitespace-nowrap tracking-tighter ${activeTab === tab.id ? 'bg-orange-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-700'}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="animate-fade-in">{renderModule()}</div>
        </div>
    );
};

export default AdminView;

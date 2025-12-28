
import React, { useState, useEffect } from 'react';
import { Ticket, DisplayableScanLog, Event, User, SectorGroup, ImportSource } from '../types';
import { Firestore, collection, writeBatch, doc, addDoc, setDoc, deleteDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { PlusCircleIcon, TrashIcon } from './Icons';

// Módulos
import DashboardModule from './admin/DashboardModule';
import SettingsModule from './admin/SettingsModule';
import GroupingModule from './admin/GroupingModule';
import LocalizadorasModule from './admin/LocalizadorasModule';
import ManualAddModule from './admin/ManualAddModule';
import ParticipantsModule from './admin/ParticipantsModule';
import OperatorMonitor from './OperatorMonitor';
import TicketList from './TicketList';
import SuperAdminView from './SuperAdminView';

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
    const [activeTab, setActiveTab] = useState<'stats' | 'groups' | 'settings' | 'history' | 'events' | 'operators' | 'manual' | 'locator' | 'users' | 'participants'>(() => {
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
        
        // Listener para Grupos
        const unsubStats = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setGroups(Array.isArray(data.groups) ? data.groups : []);
            } else {
                setGroups([]);
            }
        }, (err) => {
            console.error("Firestore Groups Sync Error:", err);
            setGroups([]);
        });

        // Listener para Importações
        const unsubImport = onSnapshot(doc(db, 'events', selectedEvent.id, 'settings', 'import_v2'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setImportSources(Array.isArray(data.sources) ? data.sources : []);
            } else {
                setImportSources([]);
            }
        }, (err) => {
            console.error("Firestore Imports Sync Error:", err);
            setImportSources([]);
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

    const renderModule = () => {
        if (activeTab === 'events') return (
            <div className="space-y-6">
                <div className="flex justify-between items-center bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl">
                    <h3 className="font-bold text-white">Gerenciar Eventos</h3>
                    <button onClick={async () => { const n = prompt("Nome do Evento:"); if(n) await addDoc(collection(db, 'events'), { name: n, createdAt: serverTimestamp() }); }} className="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-2xl text-xs font-bold flex items-center shadow-lg transition-all active:scale-95"><PlusCircleIcon className="w-5 h-5 mr-2" /> Novo Evento</button>
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
                    {events.length === 0 && (
                        <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-700 rounded-3xl text-gray-500 font-bold">Nenhum evento criado ainda.</div>
                    )}
                </div>
            </div>
        );

        if (activeTab === 'users' && isSuperAdmin) return <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} />;

        if (!selectedEvent) return (
            <div className="p-20 text-center text-gray-400 bg-gray-800 rounded-[2.5rem] border-2 border-dashed border-gray-700 shadow-inner">
                <div className="bg-gray-700 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 opacity-50">
                    <PlusCircleIcon className="w-8 h-8" />
                </div>
                <p className="text-xl font-black mb-2 text-gray-200">Painel Bloqueado</p>
                <p className="mb-8 text-sm max-w-xs mx-auto">Você precisa selecionar ou criar um evento na aba 'Eventos' para acessar as ferramentas.</p>
                <button onClick={() => setActiveTab('events')} className="bg-orange-600 hover:bg-orange-700 text-white px-10 py-4 rounded-2xl font-bold shadow-2xl transition-all active:scale-95">Ir para Eventos</button>
            </div>
        );

        switch (activeTab) {
            case 'stats': return <DashboardModule selectedEvent={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} groups={groups} />;
            case 'groups': return <GroupingModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} groups={groups} onUpdateGroups={handleUpdateGroups} />;
            case 'participants': return <ParticipantsModule allTickets={allTickets} sectorNames={sectorNames} />;
            case 'settings': return <SettingsModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} importSources={importSources} onUpdateSectorNames={onUpdateSectorNames} onUpdateImportSources={handleUpdateImportSources} isLoading={isLoading} setIsLoading={setIsLoading} allTickets={allTickets} />;
            case 'history': return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'operators': return <OperatorMonitor event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} isEmbedded />;
            case 'locator': return <LocalizadorasModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} isLoading={isLoading} setIsLoading={setIsLoading} />;
            case 'manual': return <ManualAddModule db={db} selectedEvent={selectedEvent} sectorNames={sectorNames} isLoading={isLoading} setIsLoading={setIsLoading} />;
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-32 px-4">
            <div className="bg-gray-800 rounded-[1.5rem] p-2 mb-8 flex overflow-x-auto space-x-1 border border-gray-700 no-scrollbar sticky top-4 z-40 shadow-2xl backdrop-blur-md">
                {[
                    { id: 'stats', label: 'Dashboard' },
                    { id: 'participants', label: 'Participantes' },
                    { id: 'groups', label: 'Agrupamentos' },
                    { id: 'settings', label: 'Configurações' },
                    { id: 'locator', label: 'Localizadoras' },
                    { id: 'manual', label: 'Add Manual' },
                    { id: 'operators', label: 'Operadores' },
                    { id: 'history', label: 'Histórico' },
                    { id: 'events', label: 'Eventos' },
                    ...(isSuperAdmin ? [{ id: 'users', label: 'Usuários' }] : [])
                ].map(tab => (
                    <button 
                        key={tab.id} 
                        onClick={() => setActiveTab(tab.id as any)} 
                        className={`px-6 py-3 rounded-2xl text-xs font-black uppercase transition-all whitespace-nowrap tracking-tighter ${activeTab === tab.id ? 'bg-orange-600 text-white shadow-lg scale-105' : 'text-gray-400 hover:bg-gray-700'}`}
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

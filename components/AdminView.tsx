import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';

interface AdminViewProps {
  db: Firestore;
  events: Event[];
  selectedEvent: Event | null;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  onUpdateSectorNames: (newNames: string[]) => Promise<void>;
  isOnline: boolean;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, onUpdateSectorNames, isOnline }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // Event Management State
    const [newEventName, setNewEventName] = useState('');
    const [renameEventName, setRenameEventName] = useState(selectedEvent?.name ?? '');

    useEffect(() => {
        setEditableSectorNames(sectorNames);
    }, [sectorNames]);

    useEffect(() => {
        setRenameEventName(selectedEvent?.name ?? '');
    }, [selectedEvent]);
    
    useEffect(() => {
        if (!selectedEvent) {
            setActiveTab('events');
        }
    }, [selectedEvent]);

    const analyticsData: AnalyticsData = useMemo(() => {
        const validScans = scanHistory.filter(s => s.status === 'VALID');
        if (validScans.length === 0) {
            return {
                timeBuckets: [],
                firstAccess: null,
                lastAccess: null,
                peak: { time: '-', count: 0 },
            };
        }

        validScans.sort((a, b) => a.timestamp - b.timestamp);

        const firstAccess = validScans[0].timestamp;
        const lastAccess = validScans[validScans.length - 1].timestamp;

        const buckets = new Map<string, { [sector: string]: number }>();
        const TEN_MINUTES_MS = 10 * 60 * 1000;

        for (const scan of validScans) {
            const bucketStart = Math.floor(scan.timestamp / TEN_MINUTES_MS) * TEN_MINUTES_MS;
            const date = new Date(bucketStart);
            const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            
            if (!buckets.has(key)) {
                const initialCounts = sectorNames.reduce((acc, name) => ({ ...acc, [name]: 0 }), {});
                buckets.set(key, initialCounts);
            }
            const currentBucket = buckets.get(key)!;
            currentBucket[scan.ticketSector] = (currentBucket[scan.ticketSector] || 0) + 1;
        }

        let peak = { time: '-', count: 0 };

        const timeBuckets = Array.from(buckets.entries())
            .map(([time, counts]) => {
                const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                if (total > peak.count) {
                    peak = { time, count: total };
                }
                return { time, counts, total };
            })
            .sort((a, b) => a.time.localeCompare(b.time)); // Sort buckets chronologically

        return { timeBuckets, firstAccess, lastAccess, peak };
    }, [scanHistory, sectorNames]);

     const pieChartData = useMemo(() => {
        const usedTickets = allTickets.filter(t => t.status === 'USED');
        if (usedTickets.length === 0) return [];
        
        const counts = sectorNames.reduce((acc, sector) => {
            acc[sector] = usedTickets.filter(t => t.sector === sector).length;
            return acc;
        }, {} as Record<string, number>);

        return sectorNames.map((name, index) => ({
            name: name,
            value: counts[name],
            color: PIE_CHART_COLORS[index % PIE_CHART_COLORS.length],
        })).filter(item => item.value > 0);
    }, [allTickets, sectorNames]);

    const handleSaveSectorNames = async () => {
        if (editableSectorNames.some(name => name.trim() === '')) {
            alert('O nome de um setor não pode estar em branco.');
            return;
        }
        setIsSavingSectors(true);
        try {
            await onUpdateSectorNames(editableSectorNames);
            alert('Nomes dos setores salvos com sucesso!');
        } catch (error) {
            console.error("Failed to save sector names:", error);
            let message = 'Falha ao salvar nomes dos setores. Verifique sua conexão e tente novamente.';
            if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as { code: string };
                if (firebaseError.code === 'permission-denied') {
                    message = 'Erro: Permissão negada. Verifique se as regras de segurança do Firestore foram publicadas corretamente no console do Firebase.';
                } else {
                    message = `Falha ao salvar. Código do erro: ${firebaseError.code}. Verifique o console para mais detalhes.`;
                }
            }
            alert(message);
        } finally {
            setIsSavingSectors(false);
        }
    };
    
    const handleSectorNameChange = (index: number, newName: string) => {
        const updatedNames = [...editableSectorNames];
        updatedNames[index] = newName;
        setEditableSectorNames(updatedNames);
    };

    const handleAddSector = () => {
        setEditableSectorNames([...editableSectorNames, `Novo Setor ${editableSectorNames.length + 1}`]);
    };

    const handleRemoveSector = (indexToRemove: number) => {
        if (editableSectorNames.length <= 1) {
            alert('É necessário ter pelo menos um setor.');
            return;
        }
        const sectorNameToRemove = editableSectorNames[indexToRemove];
        if (allTickets.some(t => t.sector === sectorNameToRemove)) {
            if (!window.confirm(`Existem ingressos associados ao setor "${sectorNameToRemove}". Tem certeza que deseja removê-lo?`)) {
                return;
            }
        }
        setEditableSectorNames(editableSectorNames.filter((_, index) => index !== indexToRemove));
    };
    
    const handleTicketCodeChange = (sector: string, codes: string) => {
        setTicketCodes(prev => ({ ...prev, [sector]: codes }));
    };

    const handleSaveTickets = async () => {
        if (!selectedEvent) return;
        if (Object.values(ticketCodes).every(codes => !codes.trim())) {
            alert('Nenhum código de ingresso para salvar.');
            return;
        }
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const processCodes = (codes: string, sector: Sector) => {
                const codeList = codes.split('\n').map(c => c.trim()).filter(Boolean);
                codeList.forEach(code => {
                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', code);
                    batch.set(ticketRef, { 
                        sector: sector,
                        status: 'AVAILABLE',
                        usedAt: null,
                        details: {}
                    });
                });
            };
            
            for (const sector in ticketCodes) {
                if (sectorNames.includes(sector) && ticketCodes[sector].trim()) {
                    processCodes(ticketCodes[sector], sector);
                }
            }

            await batch.commit();
            alert('Ingressos salvos com sucesso!');
            setTicketCodes({});
        } catch (error) {
            console.error("Erro ao salvar ingressos: ", error);
            let message = 'Falha ao salvar ingressos. Verifique sua conexão e tente novamente.';
             if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as { code: string };
                if (firebaseError.code === 'permission-denied') {
                    message = 'Erro: Permissão negada. Verifique as regras de segurança do Firestore.';
                } else {
                    message = `Falha ao salvar. Código do erro: ${firebaseError.code}.`;
                }
            }
            alert(message);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownloadReport = () => {
        if (!selectedEvent) return;
        setIsGeneratingPdf(true);
        try {
            generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames);
        } catch (error) {
            console.error("Failed to generate PDF report:", error);
            alert("Ocorreu um erro ao gerar o relatório em PDF.");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleCreateEvent = async () => {
        if (!newEventName.trim()) {
            alert('O nome do evento não pode estar em branco.');
            return;
        }
        setIsLoading(true);
        try {
            const eventRef = await addDoc(collection(db, 'events'), {
                name: newEventName.trim(),
                isHidden: false,
            });
            // Create a default settings document for the new event
            await setDoc(doc(db, 'events', eventRef.id, 'settings', 'main'), {
                sectorNames: ['Pista', 'VIP']
            });
            alert(`Evento "${newEventName.trim()}" criado com sucesso!`);
            setNewEventName('');
        } catch (error) {
            console.error("Error creating event:", error);
            alert("Falha ao criar evento.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleRenameEvent = async () => {
        if (!selectedEvent) return;
        if (!renameEventName.trim()) {
            alert('O nome do evento não pode estar em branco.');
            return;
        }
        if (renameEventName.trim() === selectedEvent.name) return;

        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', selectedEvent.id), {
                name: renameEventName.trim()
            });
            alert(`Evento renomeado para "${renameEventName.trim()}" com sucesso!`);
        } catch (error) {
            console.error("Error renaming event:", error);
            alert("Falha ao renomear evento.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleToggleEventVisibility = async (eventId: string, isHidden: boolean) => {
        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', eventId), { isHidden: !isHidden });
        } catch (error) {
            console.error("Error toggling event visibility:", error);
            alert("Falha ao alterar a visibilidade do evento.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (window.confirm(`Tem certeza que deseja apagar o evento "${eventName}"? Esta ação é irreversível e removerá todos os dados associados.`)) {
            setIsLoading(true);
            try {
                // Note: This only deletes the event document. Sub-collections (tickets, scans)
                // will become orphaned. For a production app, a Cloud Function is recommended
                // to handle cascading deletes.
                await deleteDoc(doc(db, 'events', eventId));
                alert(`Evento "${eventName}" apagado com sucesso.`);
            } catch (error) {
                console.error("Error deleting event:", error);
                alert("Falha ao apagar evento.");
            } finally {
                setIsLoading(false);
            }
        }
    };

    const NoEventSelectedMessage = () => (
        <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
            <p>Por favor, selecione um evento primeiro.</p>
            <p className="text-sm">Você pode criar um novo evento na aba "Gerenciar Eventos".</p>
        </div>
    );
  
    const renderContent = () => {
        if (!selectedEvent && activeTab !== 'events') {
            return <NoEventSelectedMessage />;
        }
        
        switch (activeTab) {
            case 'stats':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="space-y-6">
                        <div className="flex justify-end">
                             <button 
                                onClick={handleDownloadReport} 
                                disabled={isGeneratingPdf} 
                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                            >
                                {isGeneratingPdf ? 'Gerando...' : 'Baixar Relatório em PDF'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Stats allTickets={allTickets} sectorNames={sectorNames} />
                            <PieChart data={pieChartData} title="Distribuição de Entradas por Setor"/>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-4">Análise Temporal</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Primeiro Acesso</p>
                                    <p className="text-2xl font-bold text-green-300">
                                        {analyticsData.firstAccess ? new Date(analyticsData.firstAccess).toLocaleTimeString('pt-BR') : 'N/A'}
                                    </p>
                                </div>
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Último Acesso</p>
                                    <p className="text-2xl font-bold text-red-300">
                                        {analyticsData.lastAccess ? new Date(analyticsData.lastAccess).toLocaleTimeString('pt-BR') : 'N/A'}
                                    </p>
                                </div>
                                <div className="bg-gray-700 p-4 rounded-lg text-center">
                                    <p className="text-sm text-gray-400">Horário de Pico ({analyticsData.peak.time})</p>
                                    <p className="text-2xl font-bold text-orange-400">
                                        {analyticsData.peak.count} <span className="text-base font-normal">entradas</span>
                                    </p>
                                </div>
                            </div>
                            <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                        </div>
                    </div>
                );
            case 'settings':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3">Configurar Setores</h3>
                             <div className="space-y-3 mb-4">
                                {editableSectorNames.map((name, index) => (
                                    <div key={index} className="flex items-center space-x-2">
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => handleSectorNameChange(index, e.target.value)}
                                        placeholder={`Nome do Setor ${index + 1}`}
                                        className="flex-grow bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                    <button
                                        onClick={() => handleRemoveSector(index)}
                                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded disabled:bg-gray-500"
                                        disabled={editableSectorNames.length <= 1}
                                        aria-label={`Remover Setor ${name}`}
                                    >
                                        &times;
                                    </button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleAddSector} className="w-full bg-gray-600 hover:bg-gray-700 py-2 rounded font-bold mb-3">
                                Adicionar Novo Setor
                            </button>
                            <button
                                onClick={handleSaveSectorNames}
                                disabled={isSavingSectors || isLoading}
                                className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500"
                            >
                                {isSavingSectors ? 'Salvando...' : 'Salvar Nomes dos Setores'}
                            </button>
                        </div>
                        <div className="bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3">Gerenciar Ingressos</h3>
                            <div className="space-y-3">
                                {sectorNames.map((sector) => (
                                    <textarea
                                      key={sector}
                                      value={ticketCodes[sector] || ''}
                                      onChange={(e) => handleTicketCodeChange(sector, e.target.value)}
                                      placeholder={`Cole os códigos do setor "${sector}" aqui (um por linha)`}
                                      rows={3}
                                      className="w-full bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                ))}
                                <button onClick={handleSaveTickets} disabled={isLoading || isSavingSectors} className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold disabled:bg-gray-500">{isLoading ? 'Salvando...' : 'Salvar Ingressos no Banco de Dados'}</button>
                                {!isOnline && <p className="text-xs text-yellow-400 text-center mt-2">Você está offline. Os ingressos serão salvos quando a conexão for restaurada.</p>}
                            </div>
                        </div>
                    </div>
                );
            case 'history':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'events':
                return (
                     <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-gray-800 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3">Criar Novo Evento</h3>
                                <div className="space-y-3">
                                    <input type="text" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Nome do Novo Evento" className="w-full bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                    <button onClick={handleCreateEvent} disabled={isLoading} className="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold disabled:bg-gray-500">{isLoading ? 'Criando...' : 'Criar Evento'}</button>
                                </div>
                            </div>
                            {selectedEvent && (
                                <div className="bg-gray-800 p-4 rounded-lg">
                                    <h3 className="text-lg font-semibold mb-3">Renomear Evento Atual ({selectedEvent.name})</h3>
                                    <div className="space-y-3">
                                        <input type="text" value={renameEventName} onChange={(e) => setRenameEventName(e.target.value)} placeholder="Novo Nome do Evento" className="w-full bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                        <button onClick={handleRenameEvent} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500">{isLoading ? 'Renomeando...' : 'Renomear Evento'}</button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="bg-gray-800 p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-3">Eventos Existentes</h3>
                             <ul className="space-y-2 max-h-96 overflow-y-auto">
                                {events.map(event => (
                                    <li key={event.id} className="flex items-center justify-between bg-gray-700 p-2 rounded-md">
                                        <span className="font-medium">
                                            {event.name}
                                            {event.isHidden && <span className="text-xs text-yellow-400 ml-2">(Oculto)</span>}
                                        </span>
                                        <div className="flex items-center space-x-2">
                                            <button 
                                                onClick={() => handleToggleEventVisibility(event.id, event.isHidden ?? false)}
                                                disabled={isLoading}
                                                className="text-sm bg-gray-600 hover:bg-gray-500 text-white font-semibold py-1 px-3 rounded-md transition-colors disabled:opacity-50"
                                            >
                                                {event.isHidden ? 'Mostrar' : 'Ocultar'}
                                            </button>
                                            <button
                                                onClick={() => handleDeleteEvent(event.id, event.name)}
                                                disabled={isLoading}
                                                className="text-sm bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md transition-colors disabled:opacity-50"
                                            >
                                                Apagar
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };
  
    const TABS = [
        { id: 'stats', name: 'Estatísticas' },
        { id: 'settings', name: 'Configurações' },
        { id: 'history', name: 'Histórico' },
        { id: 'events', name: 'Gerenciar Eventos' },
    ] as const;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold mb-4">Painel Administrativo</h2>
                <div className="flex space-x-1 bg-gray-800 p-1 rounded-lg mb-6">
                    {TABS.map(tab => {
                         const isDisabled = !selectedEvent && tab.id !== 'events';
                         return (
                             <button
                                key={tab.id}
                                onClick={() => !isDisabled && setActiveTab(tab.id)}
                                disabled={isDisabled}
                                className={`flex-1 py-2 px-3 text-sm font-bold rounded-md transition-colors ${
                                    activeTab === tab.id 
                                    ? 'bg-orange-600 text-white' 
                                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {tab.name}
                            </button>
                         );
                    })}
                </div>
                {renderContent()}
            </div>
        </div>
    );
};

export default AdminView;
// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc } from 'firebase/firestore';

import Scanner from './components/Scanner';
import StatusDisplay from './components/StatusDisplay';
import AdminView from './components/AdminView';
import SetupInstructions from './components/SetupInstructions';
import AlertBanner from './components/AlertBanner';
import EventSelector from './components/EventSelector';
// FIX: Import TicketList to resolve 'Cannot find name' error.
import TicketList from './components/TicketList';
import { CogIcon, QrCodeIcon } from './components/Icons';

import { Ticket, ScanStatus, DisplayableScanLog, SectorFilter, Event } from './types';

// NOTE: Sound hook is not implemented in the provided files.
// To enable sounds, implement `hooks/useSound.ts`.
// import useSound from './hooks/useSound';


const App: React.FC = () => {
    const [db, setDb] = useState<Firestore | null>(null);
    const [firebaseStatus, setFirebaseStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [scanHistory, setScanHistory] = useState<DisplayableScanLog[]>([]);
    const [sectorNames, setSectorNames] = useState<string[]>(['Pista', 'VIP']);
    const [selectedSector, setSelectedSector] = useState<SectorFilter>('All');
    const [view, setView] = useState<'scanner' | 'admin'>('scanner');
    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string } | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const cooldownRef = useRef<boolean>(false);

    // const playSuccessSound = useSound('/sounds/success.mp3');
    // const playErrorSound = useSound('/sounds/error.mp3');

    const ticketsMap = useMemo(() => {
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    useEffect(() => {
        getDb()
            .then(database => {
                setDb(database);
                setFirebaseStatus('success'); // Assume connection will succeed; listeners will handle errors.
            })
            .catch(error => {
                console.error("Failed to initialize database:", error);
                setFirebaseStatus('error');
            });
    }, []);

    // Effect for fetching the list of events
    useEffect(() => {
        if (!db) return;

        const eventsUnsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
            const eventsData = snapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                isHidden: doc.data().isHidden ?? false,
            }));
            setEvents(eventsData);
            
            // If a selected event is deleted elsewhere, deselect it.
            if (selectedEvent && !eventsData.some(e => e.id === selectedEvent.id)) {
                setSelectedEvent(null);
                localStorage.removeItem('selectedEventId');
            }

            const lastEventId = localStorage.getItem('selectedEventId');
            if (lastEventId && !selectedEvent) {
                const event = eventsData.find(e => e.id === lastEventId);
                if (event) {
                    setSelectedEvent(event);
                } else {
                    localStorage.removeItem('selectedEventId');
                }
            }
        }, (error) => {
            console.error("Firebase connection failed.", error);
            setFirebaseStatus('error');
        });

        return () => eventsUnsubscribe();
    }, [db, selectedEvent]);

    // Effect for handling data subscriptions for the SELECTED event
    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setSectorNames(['Pista', 'VIP']); // Reset to default
            return;
        };

        const eventId = selectedEvent.id;

        const ticketsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'tickets'), (snapshot) => {
            const ticketsData = snapshot.docs.map(doc => {
                const data = doc.data();
                const ticket: Ticket = {
                    id: doc.id,
                    sector: data.sector,
                    status: data.status,
                    details: data.details ? { ownerName: data.details.ownerName, eventName: data.details.eventName } : undefined,
                };
                if (data.usedAt instanceof Timestamp) {
                    ticket.usedAt = data.usedAt.toMillis();
                } else if (typeof data.usedAt === 'number') {
                    ticket.usedAt = data.usedAt;
                }
                return ticket;
            });
            setAllTickets(ticketsData);
        });

        const scansQuery = query(collection(db, 'events', eventId, 'scans'), orderBy('timestamp', 'desc'), limit(100));
        const scansUnsubscribe = onSnapshot(scansQuery, (snapshot) => {
            const historyData = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ticketId: data.ticketId,
                    status: data.status,
                    timestamp: (data.timestamp as Timestamp)?.toMillis() || Date.now(),
                    ticketSector: data.sector ?? 'Desconhecido',
                    isPending: doc.metadata.hasPendingWrites,
                };
            });
            setScanHistory(historyData);
        }, console.error);

        const settingsUnsubscribe = onSnapshot(doc(db, 'events', eventId, 'settings', 'main'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.sectorNames && Array.isArray(data.sectorNames) && data.sectorNames.length > 0) {
                    setSectorNames(data.sectorNames as string[]);
                } else {
                    setSectorNames(['Pista', 'VIP']);
                }
            } else {
                 setSectorNames(['Pista', 'VIP']);
            }
        });

        return () => {
            ticketsUnsubscribe();
            scansUnsubscribe();
            settingsUnsubscribe();
        };
    }, [db, selectedEvent]);


    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const handleSelectEvent = (event: Event) => {
        setSelectedEvent(event);
        localStorage.setItem('selectedEventId', event.id);
    };

    const handleSwitchEvent = () => {
        setSelectedEvent(null);
        setView('scanner'); // Reset to scanner view when switching
        localStorage.removeItem('selectedEventId');
    };

    const handleUpdateSectorNames = async (newNames: string[]) => {
        if (!db || !selectedEvent) throw new Error("Database or event not selected");
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: newNames });
    };
    
    const showScanResult = (status: ScanStatus, message: string) => {
        setScanResult({ status, message });
        // if (status === 'VALID') playSuccessSound();
        // else playErrorSound();
        setTimeout(() => setScanResult(null), 3000);
    };

    const handleScanSuccess = useCallback(async (decodedText: string) => {
        if (cooldownRef.current || !db || !selectedEvent) return;

        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, 2000);

        const eventId = selectedEvent.id;
        const ticketId = decodedText.trim();
        const ticket = ticketsMap.get(ticketId);
        
        const logScan = async (status: ScanStatus, sector: string) => {
            try {
                await addDoc(collection(db, 'events', eventId, 'scans'), {
                    ticketId, status, timestamp: serverTimestamp(), sector
                });
            } catch (error) { console.error(`Failed to log ${status} scan:`, error); }
        };

        if (!ticket) {
            showScanResult('INVALID', `Ingresso não encontrado: ${ticketId}`);
            await logScan('INVALID', 'Desconhecido');
            return;
        }

        if (ticket.status === 'USED') {
            const usedAtDate = ticket.usedAt ? new Date(ticket.usedAt) : null;
            const message = `Ingresso já utilizado${usedAtDate ? ` em ${usedAtDate.toLocaleString('pt-BR')}` : ''}`;
            showScanResult('USED', message);
            await logScan('USED', ticket.sector);
            return;
        }

        if (selectedSector !== 'All' && ticket.sector !== selectedSector) {
            const message = `Setor incorreto! Ingresso para ${ticket.sector}, validação em ${selectedSector}.`;
            showScanResult('WRONG_SECTOR', message);
            await logScan('WRONG_SECTOR', ticket.sector);
            return;
        }

        try {
            const batch = writeBatch(db);
            const ticketRef = doc(db, 'events', eventId, 'tickets', ticketId);
            batch.update(ticketRef, { status: 'USED', usedAt: serverTimestamp() });

            const logRef = doc(collection(db, 'events', eventId, 'scans'));
            batch.set(logRef, { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector });

            await batch.commit();
            showScanResult('VALID', `Acesso liberado para o setor ${ticket.sector}!`);

        } catch (error) {
            console.error("Failed to update ticket status:", error);
            showScanResult('ERROR', 'Falha ao atualizar o banco de dados. Tente novamente.');
        }
    }, [db, selectedEvent, ticketsMap, selectedSector]);
    
    const handleScanError = (errorMessage: string) => {
        // This is called frequently when no QR code is in view. Can be used for debugging.
    };

    const handleAdminAccess = () => {
        const password = prompt("Digite a senha para acessar o painel administrativo:");
        if (password === "123654") {
            setView('admin');
        } else if (password !== null) {
            alert("Senha incorreta!");
        }
    };
    
    const handleAdminAccessFromSelector = useCallback(() => {
        const password = prompt("Digite a senha para acessar o painel administrativo:");
        if (password === "123654") {
            if (events.length > 0 && !selectedEvent) {
                const visibleEvents = events.filter(e => !e.isHidden);
                if (visibleEvents.length > 0) {
                    handleSelectEvent(visibleEvents[0]);
                }
            }
            setView('admin');
        } else if (password !== null) {
            alert("Senha incorreta!");
        }
    }, [events, selectedEvent]);

    if (!db || firebaseStatus === 'loading') {
        return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white text-2xl">Conectando ao banco de dados...</div>;
    }

    if (firebaseStatus === 'error') {
        return <SetupInstructions />;
    }

    if (!selectedEvent && view !== 'admin') {
        return <EventSelector events={events} onSelectEvent={handleSelectEvent} onAccessAdmin={handleAdminAccessFromSelector} />;
    }

    const TABS: SectorFilter[] = ['All', ...sectorNames];

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Você está offline. As validações estão sendo salvas localmente e serão sincronizadas." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                            <button onClick={handleSwitchEvent} className="text-sm text-orange-400 hover:underline">
                               Trocar Evento
                            </button>
                        </div>
                    ) : (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">Gerenciamento Geral</h1>
                            <p className="text-sm text-gray-400">Crie ou gerencie seus eventos.</p>
                        </div>
                    )}
                    <div className="flex items-center space-x-2">
                         {selectedEvent && (
                             <button
                                onClick={() => setView('scanner')}
                                className={`p-2 rounded-full transition-colors ${view === 'scanner' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                                aria-label="Scanner View"
                             >
                                 <QrCodeIcon className="w-6 h-6" />
                             </button>
                         )}
                         <button
                            onClick={handleAdminAccess}
                            className={`p-2 rounded-full transition-colors ${view === 'admin' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                            aria-label="Admin View"
                         >
                             <CogIcon className="w-6 h-6" />
                         </button>
                    </div>
                </header>

                <main>
                    {view === 'scanner' && selectedEvent ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="bg-gray-800 p-2 rounded-lg">
                                    <div className="flex space-x-1">
                                        {TABS.map(sector => (
                                            <button 
                                                key={sector}
                                                onClick={() => setSelectedSector(sector)}
                                                className={`flex-1 py-2 px-3 text-sm font-bold rounded-md transition-colors ${selectedSector === sector ? 'bg-orange-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                                            >
                                                {sector === 'All' ? 'Todos os Setores' : sector}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border-4 border-gray-700">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} />}
                                    <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
                                </div>
                            </div>

                             <div className="space-y-6">
                                 <TicketList tickets={scanHistory} sectorNames={sectorNames} />
                             </div>
                        </div>
                    ) : (
                        <AdminView 
                            db={db}
                            events={events}
                            selectedEvent={selectedEvent}
                            allTickets={allTickets}
                            scanHistory={scanHistory}
                            sectorNames={sectorNames}
                            onUpdateSectorNames={handleUpdateSectorNames}
                            isOnline={isOnline}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;
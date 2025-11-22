// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDoc } from 'firebase/firestore';
import Papa from 'papaparse';

import Scanner from './components/Scanner';
import StatusDisplay from './components/StatusDisplay';
import AdminView from './components/AdminView';
import SetupInstructions from './components/SetupInstructions';
import AlertBanner from './components/AlertBanner';
import EventSelector from './components/EventSelector';
// FIX: Import TicketList to resolve 'Cannot find name' error.
import TicketList from './components/TicketList';
import { CogIcon, QrCodeIcon } from './components/Icons';

import { Ticket, ScanStatus, DisplayableScanLog, SectorFilter, Event, ValidationConfig } from './types';

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
    
    // Validation Config
    const [validationConfig, setValidationConfig] = useState<ValidationConfig>({ mode: 'OFFLINE', onlineUrls: [] });

    // New state for Sector Selection Flow
    const [isSectorSelectionStep, setIsSectorSelectionStep] = useState(false);
    const [lockedSector, setLockedSector] = useState<string | null>(null);

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

            // Restore session only if not already selected
            const lastEventId = localStorage.getItem('selectedEventId');
            if (lastEventId && !selectedEvent) {
                const event = eventsData.find(e => e.id === lastEventId);
                // if (event) setSelectedEvent(event); // Optional: Auto-restore
            }
        }, (error) => {
            console.error("Firebase connection failed.", error);
            setFirebaseStatus('error');
        });

        return () => eventsUnsubscribe();
    }, [db, selectedEvent]);

    // Effect for fetching config and data for SELECTED event
    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setSectorNames(['Pista', 'VIP']);
            return;
        };

        const eventId = selectedEvent.id;

        // Fetch Validation Configuration
        const configUnsubscribe = onSnapshot(doc(db, 'events', eventId, 'settings', 'config'), (docSnap) => {
            if (docSnap.exists()) {
                setValidationConfig(docSnap.data() as ValidationConfig);
            } else {
                setValidationConfig({ mode: 'OFFLINE', onlineUrls: [] });
            }
        });

        // Fetch Tickets
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

        // Fetch History
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

        // Fetch Settings (Sector Names)
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
            configUnsubscribe();
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
        setIsSectorSelectionStep(true);
        setLockedSector(null);
        localStorage.setItem('selectedEventId', event.id);
    };

    const handleConfirmSectorSelection = (sector: string | null) => {
        if (sector) {
            setSelectedSector(sector);
            setLockedSector(sector);
        } else {
            setSelectedSector('All');
            setLockedSector(null);
        }
        setIsSectorSelectionStep(false);
    };

    const handleSwitchEvent = () => {
        setSelectedEvent(null);
        setView('scanner');
        setLockedSector(null);
        setIsSectorSelectionStep(false);
        localStorage.removeItem('selectedEventId');
    };

    const handleUpdateSectorNames = async (newNames: string[]) => {
        if (!db || !selectedEvent) throw new Error("Database or event not selected");
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: newNames });
    };
    
    const showScanResult = (status: ScanStatus, message: string) => {
        setScanResult({ status, message });
        setTimeout(() => setScanResult(null), 3000);
    };

    const logScan = async (ticketId: string, status: ScanStatus, sector: string) => {
        if (!db || !selectedEvent) return;
        try {
            await addDoc(collection(db, 'events', selectedEvent.id, 'scans'), {
                ticketId, status, timestamp: serverTimestamp(), sector
            });
        } catch (error) { console.error(`Failed to log ${status} scan:`, error); }
    };

    const handleScanSuccess = useCallback(async (decodedText: string) => {
        if (cooldownRef.current || !db || !selectedEvent) return;

        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, 2000); // 2 sec cooldown

        const eventId = selectedEvent.id;
        let ticketId = decodedText.trim();
        // Attempt to extract code from URL if applicable
        try {
            if (ticketId.startsWith('http')) {
                const urlObj = new URL(ticketId);
                const pathSegments = urlObj.pathname.split('/');
                const possibleCode = pathSegments[pathSegments.length - 1];
                if (possibleCode && possibleCode.length > 4) {
                    ticketId = possibleCode;
                } else if (urlObj.searchParams.has('code')) {
                    ticketId = urlObj.searchParams.get('code') || ticketId;
                }
            }
        } catch(e) { /* ignore url parsing errors */ }

        // --- ONLINE MODE: GOOGLE SHEETS ---
        if (validationConfig.mode === 'ONLINE_SHEETS' && validationConfig.onlineUrls.length > 0) {
            if (!isOnline) {
                showScanResult('ERROR', 'Sem internet para validação online.');
                return;
            }

            try {
                // Fetch from Google Sheets (First URL)
                let fetchUrl = validationConfig.onlineUrls[0];
                 // Smart fix for common Google Sheet link mistake
                 if (fetchUrl.includes('docs.google.com/spreadsheets') && !fetchUrl.includes('output=csv')) {
                     if (fetchUrl.includes('/edit')) {
                         fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                     }
                 }

                const response = await fetch(fetchUrl);
                if (!response.ok) throw new Error('Erro ao acessar planilha.');
                const csvText = await response.text();
                const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                const rows = parsed.data as any[];

                // Find ticket in sheet
                const row = rows.find(r => {
                     const rCode = r['code'] || r['código'] || r['codigo'] || r['id'] || r['qr'] || r['qrcode'];
                     return String(rCode).trim() === ticketId;
                });

                if (!row) {
                     showScanResult('INVALID', `Ingresso não encontrado na planilha: ${ticketId}`);
                     await logScan(ticketId, 'INVALID', 'Desconhecido');
                     return;
                }

                // Found in sheet. Now check LOCAL DB for 'USED' status (Hybrid approach)
                const ticketSector = row['sector'] || row['setor'] || row['categoria'] || 'Geral';
                const ticketOwner = row['name'] || row['nome'] || row['cliente'] || '';

                // Check sector lock
                if (selectedSector !== 'All' && ticketSector !== selectedSector) {
                     showScanResult('WRONG_SECTOR', `Setor incorreto! Ingresso: ${ticketSector}`);
                     await logScan(ticketId, 'WRONG_SECTOR', ticketSector);
                     return;
                }

                const ticketRef = doc(db, 'events', eventId, 'tickets', ticketId);
                const ticketSnap = await getDoc(ticketRef);

                if (ticketSnap.exists() && ticketSnap.data().status === 'USED') {
                    const data = ticketSnap.data();
                     const usedAtDate = data.usedAt instanceof Timestamp ? data.usedAt.toDate() : new Date(data.usedAt);
                     showScanResult('USED', `Já utilizado em ${usedAtDate.toLocaleTimeString()}`);
                     await logScan(ticketId, 'USED', ticketSector);
                } else {
                     // Mark as USED in Firestore
                     const batch = writeBatch(db);
                     batch.set(ticketRef, {
                         sector: ticketSector,
                         status: 'USED',
                         usedAt: serverTimestamp(),
                         details: { ownerName: ticketOwner }
                     }, { merge: true });
                     
                     const logRef = doc(collection(db, 'events', eventId, 'scans'));
                     batch.set(logRef, { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticketSector });

                     await batch.commit();
                     showScanResult('VALID', `Acesso Liberado! (Planilha)`);
                }

            } catch (error) {
                console.error('Online Sheet Error:', error);
                showScanResult('ERROR', 'Erro ao consultar planilha online.');
            }
            return;
        }

        // --- ONLINE MODE: API ---
        if (validationConfig.mode === 'ONLINE_API' && validationConfig.onlineUrls.length > 0) {
             if (!isOnline) {
                showScanResult('ERROR', 'Sem internet para validação online.');
                return;
            }

            for (const apiUrl of validationConfig.onlineUrls) {
                try {
                     // Determine endpoint type
                     const checkinUrl = apiUrl.endsWith('/') ? `${apiUrl}checkins` : `${apiUrl}/checkins`;
                     const headers: any = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
                     if (validationConfig.onlineToken) headers['Authorization'] = `Bearer ${validationConfig.onlineToken}`;

                     const payload: any = {
                         code: ticketId,
                         qr_code: ticketId,
                         ticket_code: ticketId,
                         uuid: ticketId
                     };
                     if (validationConfig.onlineEventId) payload.event_id = Number(validationConfig.onlineEventId);

                     // Try POST first
                     let response = await fetch(checkinUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
                     
                     // If 404/405, try GET query
                     if (!response.ok && (response.status === 404 || response.status === 405)) {
                         const queryUrl = new URL(apiUrl.includes('tickets') ? apiUrl : `${apiUrl}/tickets`);
                         queryUrl.searchParams.set('code', ticketId);
                         if (validationConfig.onlineEventId) queryUrl.searchParams.set('event_id', validationConfig.onlineEventId);
                         response = await fetch(queryUrl.toString(), { headers });
                     }

                     const data = await response.json();
                     
                     if (response.ok && (data.success !== false)) {
                         // Success
                         showScanResult('VALID', 'Acesso Liberado! (API)');
                         await logScan(ticketId, 'VALID', 'Online API');
                         return;
                     } else if (response.status === 409 || data.message?.includes('used') || data.message?.includes('utilizado')) {
                         showScanResult('USED', 'Ingresso já utilizado (API)');
                         await logScan(ticketId, 'USED', 'Online API');
                         return;
                     }
                } catch (e) {
                    console.error("API Attempt failed", e);
                    continue; // Try next URL
                }
            }
            showScanResult('INVALID', 'Não encontrado em nenhuma API.');
            await logScan(ticketId, 'INVALID', 'Desconhecido');
            return;
        }

        // --- OFFLINE MODE (DEFAULT) ---
        const ticket = ticketsMap.get(ticketId);

        if (!ticket) {
            showScanResult('INVALID', `Ingresso não encontrado: ${ticketId}`);
            await logScan(ticketId, 'INVALID', 'Desconhecido');
            return;
        }

        if (ticket.status === 'USED') {
            const usedAtDate = ticket.usedAt ? new Date(ticket.usedAt) : null;
            const message = `Ingresso já utilizado${usedAtDate ? ` em ${usedAtDate.toLocaleString('pt-BR')}` : ''}`;
            showScanResult('USED', message);
            await logScan(ticketId, 'USED', ticket.sector);
            return;
        }

        if (selectedSector !== 'All' && ticket.sector !== selectedSector) {
            const message = `Setor incorreto! Ingresso para ${ticket.sector}, validação em ${selectedSector}.`;
            showScanResult('WRONG_SECTOR', message);
            await logScan(ticketId, 'WRONG_SECTOR', ticket.sector);
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
            showScanResult('ERROR', 'Falha ao atualizar o banco de dados.');
        }
    }, [db, selectedEvent, ticketsMap, selectedSector, validationConfig, isOnline]);
    
    const handleScanError = (errorMessage: string) => { };

    const handleAdminAccess = () => {
        const password = prompt("Digite a senha para acessar o painel administrativo:");
        if (password === "123654") {
            setView('admin');
        } else { if(password !== null) alert("Senha incorreta!"); }
    };
    
    const handleAdminAccessFromSelector = useCallback(() => {
        const password = prompt("Digite a senha para acessar o painel administrativo:");
        if (password === "123654") {
            if (events.length > 0 && !selectedEvent) {
                const visibleEvents = events.filter(e => !e.isHidden);
                if (visibleEvents.length > 0) {
                    setSelectedEvent(visibleEvents[0]);
                    setIsSectorSelectionStep(false);
                }
            }
            setView('admin');
        } else { if(password !== null) alert("Senha incorreta!"); }
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

    // Sector Selection Screen
    if (selectedEvent && view === 'scanner' && isSectorSelectionStep) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-2 text-orange-500">{selectedEvent.name}</h2>
                    <h3 className="text-xl font-semibold text-center mb-8">O que você vai validar?</h3>
                    
                    <button 
                        onClick={() => handleConfirmSectorSelection(null)}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 px-6 rounded-lg text-lg mb-6 shadow-md transition-transform transform hover:scale-105"
                    >
                        Validar Todos os Setores (Geral)
                    </button>

                    <div className="border-t border-gray-600 my-4 relative">
                        <span className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-800 px-2 text-gray-400 text-sm">OU SELECIONE UM SETOR</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6">
                        {sectorNames.map(sector => (
                            <button
                                key={sector}
                                onClick={() => handleConfirmSectorSelection(sector)}
                                className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg border border-gray-600 hover:border-orange-400 transition-colors"
                            >
                                {sector}
                            </button>
                        ))}
                    </div>

                    <div className="mt-8 text-center">
                        <button onClick={handleSwitchEvent} className="text-gray-400 hover:text-white text-sm underline">
                            Voltar para seleção de eventos
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const TABS: SectorFilter[] = ['All', ...sectorNames];
    const displayHistory = lockedSector 
        ? scanHistory.filter(s => s.ticketSector === lockedSector || s.status === 'INVALID' || s.status === 'WRONG_SECTOR')
        : scanHistory;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && validationConfig.mode !== 'OFFLINE' && <AlertBanner message="Sem internet. O modo online pode falhar." type="error" />}
                {!isOnline && validationConfig.mode === 'OFFLINE' && <AlertBanner message="Você está offline. Validações salvas localmente." type="warning" />}
                
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                            <div className="flex flex-col">
                                {validationConfig.mode !== 'OFFLINE' && (
                                     <span className="text-xs text-blue-400 font-mono font-bold">
                                        MODO ONLINE: {validationConfig.mode === 'ONLINE_SHEETS' ? 'PLANILHA' : 'API'}
                                     </span>
                                )}
                                {lockedSector ? (
                                    <div className="flex items-center space-x-2 mt-1">
                                        <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-orange-300 border border-orange-500/30">
                                            Validando: {lockedSector}
                                        </span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline">
                                            Alterar
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={handleSwitchEvent} className="text-sm text-orange-400 hover:underline mt-1">
                                        Trocar Evento
                                    </button>
                                )}
                            </div>
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
                                {!lockedSector && (
                                    <div className="bg-gray-800 p-2 rounded-lg overflow-hidden">
                                        <div className="flex space-x-2 overflow-x-auto pb-1">
                                            {TABS.map(sector => (
                                                <button 
                                                    key={sector}
                                                    onClick={() => setSelectedSector(sector)}
                                                    className={`flex-shrink-0 py-2 px-3 text-sm font-bold rounded-md transition-colors whitespace-nowrap ${selectedSector === sector ? 'bg-orange-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                                                >
                                                    {sector === 'All' ? 'Todos os Setores' : sector}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border-4 border-gray-700">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} />}
                                    <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
                                </div>
                                {validationConfig.mode === 'ONLINE_API' && !validationConfig.onlineEventId && (
                                    <p className="text-red-400 text-xs text-center font-bold">AVISO: ID do evento não configurado. A validação pode falhar.</p>
                                )}
                            </div>

                             <div className="space-y-6">
                                 <TicketList 
                                    tickets={displayHistory} 
                                    sectorNames={sectorNames} 
                                    hideTabs={!!lockedSector}
                                 />
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
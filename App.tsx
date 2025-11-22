
// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDoc } from 'firebase/firestore';

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

interface ApiEndpointConfig {
    id?: string;
    name?: string;
    url: string;
    token: string;
    customEventId?: string;
}

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
    
    // New state for Sector Selection Flow
    const [isSectorSelectionStep, setIsSectorSelectionStep] = useState(false);
    // Changed from single string to array of strings for multi-selection
    const [activeSectors, setActiveSectors] = useState<string[]>([]);

    // Validation Config State
    const [validationConfig, setValidationConfig] = useState<{
        mode: string;
        endpoints: ApiEndpointConfig[];
    }>({ mode: 'OFFLINE', endpoints: [] });

    const cooldownRef = useRef<boolean>(false);

    const ticketsMap = useMemo(() => {
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    useEffect(() => {
        getDb()
            .then(database => {
                setDb(database);
                setFirebaseStatus('success'); 
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
            
            if (selectedEvent && !eventsData.some(e => e.id === selectedEvent.id)) {
                setSelectedEvent(null);
                localStorage.removeItem('selectedEventId');
            }

            const lastEventId = localStorage.getItem('selectedEventId');
            if (lastEventId && !selectedEvent) {
                const event = eventsData.find(e => e.id === lastEventId);
                // Optional: Auto-select logic could go here
            }
        }, (error) => {
            console.error("Firebase connection failed.", error);
            setFirebaseStatus('error');
        });

        return () => eventsUnsubscribe();
    }, [db, selectedEvent]);

    // Effect for fetching data for selected event
    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setSectorNames(['Pista', 'VIP']); 
            return;
        };

        const eventId = selectedEvent.id;

        // Ticket Sync (Offline Mode primarily uses this)
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

        // History Sync
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

        // Settings Sync (Sector Names + Validation Mode)
        const settingsUnsubscribe = onSnapshot(doc(db, 'events', eventId, 'settings', 'main'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.sectorNames && Array.isArray(data.sectorNames)) {
                    setSectorNames(data.sectorNames);
                }
                if (data.validation) {
                    const mode = data.validation.mode || 'OFFLINE';
                    let endpoints: ApiEndpointConfig[] = [];
                    
                    if (data.validation.endpoints && Array.isArray(data.validation.endpoints)) {
                        endpoints = data.validation.endpoints;
                    } else if (data.validation.url) {
                        // Legacy support
                        endpoints.push({ url: data.validation.url, token: data.validation.token || '' });
                    }
                    
                    setValidationConfig({ mode, endpoints });
                }
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
        setIsSectorSelectionStep(true);
        setActiveSectors([]); // Reset selection
        localStorage.setItem('selectedEventId', event.id);
    };

    // Toggle sector selection for the setup screen
    const toggleSectorSelection = (sector: string) => {
        setActiveSectors(prev => {
            if (prev.includes(sector)) {
                return prev.filter(s => s !== sector);
            } else {
                return [...prev, sector];
            }
        });
    };

    const confirmSectorSelection = () => {
        // If empty, it implies all (but usually we use the "All" button for that).
        // If the user clicks confirm with empty list, we assume All.
        setIsSectorSelectionStep(false);
        setSelectedSector('All');
    };

    const handleSelectAllSectors = () => {
        setActiveSectors([]); // Empty array means ALL sectors
        setIsSectorSelectionStep(false);
        setSelectedSector('All');
    };

    const handleSwitchEvent = () => {
        setSelectedEvent(null);
        setView('scanner');
        setActiveSectors([]);
        setIsSectorSelectionStep(false);
        localStorage.removeItem('selectedEventId');
    };

    const handleUpdateSectorNames = async (newNames: string[]) => {
        if (!db || !selectedEvent) throw new Error("Database or event not selected");
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: newNames }, { merge: true });
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
        setTimeout(() => { cooldownRef.current = false; }, 2000);

        const eventId = selectedEvent.id;
        const ticketId = decodedText.trim();

        // Helper to check if sector is allowed
        const isSectorAllowed = (sectorToCheck: string) => {
            if (activeSectors.length === 0) return true; // All allowed
            return activeSectors.includes(sectorToCheck);
        };

        // --- ONLINE MODE ---
        if (validationConfig.mode === 'ONLINE') {
            if (!navigator.onLine) {
                showScanResult('ERROR', 'Sem internet para validação online.');
                return;
            }
            
            const endpoints = validationConfig.endpoints.length > 0 
                ? validationConfig.endpoints 
                : [{ url: '', token: '' }]; 

            let resultStatus: ScanStatus | null = null;
            let resultMessage = '';
            let resultSector = 'API';
            let found = false;
            let networkErrors = 0;

            // PREPARE CODES TO TRY
            // 1. Always try the raw code scanned
            const codesToTry = [ticketId];
            
            // 2. If it looks like a URL, try to extract ID/Code from it
            try {
                if (ticketId.match(/^https?:\/\//i)) {
                    const urlObj = new URL(ticketId);
                    
                    // Try query parameters common for tickets
                    const paramKeys = ['code', 'id', 'uuid', 'ticket', 'ticket_code', 't'];
                    for (const key of paramKeys) {
                        if (urlObj.searchParams.has(key)) {
                            const val = urlObj.searchParams.get(key);
                            if (val) codesToTry.push(val);
                        }
                    }

                    // Try the last segment of the path (e.g. /checkins/12345)
                    const pathSegments = urlObj.pathname.split('/').filter(p => p && p.length > 0);
                    if (pathSegments.length > 0) {
                        const lastSegment = pathSegments[pathSegments.length - 1];
                        // Avoid duplicates
                        if (!codesToTry.includes(lastSegment)) codesToTry.push(lastSegment);
                    }
                }
            } catch (e) {
                console.warn("Error parsing potential URL code:", e);
            }

            const uniqueCodes = [...new Set(codesToTry)];
            console.log(`[Online Scan] Codes derived:`, uniqueCodes);

            // Loop through configured APIs
            for (const api of endpoints) {
                if (!api.url) continue;
                
                // Loop through possible codes (Raw vs Extracted)
                for (const codeAttempt of uniqueCodes) {
                    try {
                        const payloadEventId = api.customEventId || eventId;
                        // Force numeric if possible, otherwise string
                        const finalEventId = /^\d+$/.test(String(payloadEventId)) ? parseInt(String(payloadEventId), 10) : payloadEventId;

                        const headers: HeadersInit = { 
                            'Content-Type': 'application/json', 
                            'Accept': 'application/json' 
                        };
                        if (api.token) headers['Authorization'] = `Bearer ${api.token}`;

                        // Prepare Request Body
                        const body = JSON.stringify({ 
                            code: codeAttempt, 
                            qr_code: codeAttempt, 
                            ticket_code: codeAttempt,
                            uuid: codeAttempt,
                            event_id: finalEventId 
                        });

                        // Prepare URL - Append event_id to query string as fallback
                        const fetchUrl = new URL(api.url);
                        if (finalEventId) fetchUrl.searchParams.set('event_id', String(finalEventId));

                        console.log(`[Online Scan] Checking ${api.name || api.url} with code: ${codeAttempt}`);

                        const response = await fetch(fetchUrl.toString(), {
                            method: 'POST',
                            headers,
                            body 
                        });

                        // If 404, try next code or next API
                        if (response.status === 404) {
                            continue; 
                        }

                        // If we get a definitive response (Success or Used or Server Error that isn't 404)
                        found = true; 
                        const json = await response.json().catch(() => ({}));
                        
                        // Detect sector
                        if (json.sector) resultSector = typeof json.sector === 'object' ? json.sector.name : json.sector;
                        else if (json.data && json.data.sector) resultSector = typeof json.data.sector === 'object' ? json.data.sector.name : json.data.sector;
                        else if (api.name) resultSector = api.name;

                        if (response.ok) {
                            // VALID (200/201)
                            if (!isSectorAllowed(resultSector) && resultSector !== 'API' && resultSector !== api.name) {
                                resultStatus = 'WRONG_SECTOR';
                                resultMessage = `Setor incorreto! (${resultSector})`;
                            } else {
                                resultStatus = 'VALID';
                                resultMessage = `Acesso Liberado${api.name ? ` (${api.name})` : ''}!`;
                            }
                        } else if (response.status === 422 || response.status === 409) {
                            // USED
                            resultStatus = 'USED';
                            resultMessage = `Ingresso já utilizado${api.name ? ` (${api.name})` : ''}.`;
                        } else {
                            // OTHER ERROR
                            resultStatus = 'ERROR';
                            resultMessage = `Erro API${api.name ? ` (${api.name})` : ''}: ${response.status}`;
                        }
                        
                        // Found valid response, break inner loop (codes)
                        break; 

                    } catch (err) {
                        console.error(`API Error on ${api.url}`, err);
                        networkErrors++;
                    }
                }
                // Found valid response, break outer loop (APIs)
                if (found) break;
            }

            if (!found) {
                 if (networkErrors === (endpoints.length * uniqueCodes.length)) {
                     showScanResult('ERROR', 'Erro de conexão com a API.');
                 } else {
                     showScanResult('INVALID', `Ingresso não encontrado (API).`);
                     await logScan(ticketId, 'INVALID', 'Desconhecido');
                 }
                 return;
            }

            if (resultStatus) {
                showScanResult(resultStatus, resultMessage);
                await logScan(ticketId, resultStatus, resultSector);
            }
            return;
        }

        // --- OFFLINE MODE (Original Logic) ---
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

        // Sector check
        // 1. Check strict Multi-Sector selection
        if (!isSectorAllowed(ticket.sector)) {
             const message = `Setor incorreto! (É: ${ticket.sector})`;
             showScanResult('WRONG_SECTOR', message);
             await logScan(ticketId, 'WRONG_SECTOR', ticket.sector);
             return;
        }

        // 2. Check legacy single selector in "All" mode (TicketList tabs)
        // Only applies if we are NOT in restricted mode (activeSectors is empty)
        if (activeSectors.length === 0 && selectedSector !== 'All' && ticket.sector !== selectedSector) {
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
            showScanResult('ERROR', 'Falha ao atualizar o banco de dados. Tente novamente.');
        }
    }, [db, selectedEvent, ticketsMap, selectedSector, validationConfig, activeSectors]);
    
    const handleScanError = (errorMessage: string) => {
        // Debugging only
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
                    setSelectedEvent(visibleEvents[0]);
                    setIsSectorSelectionStep(false);
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

    if (selectedEvent && view === 'scanner' && isSectorSelectionStep) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-2 text-orange-500">{selectedEvent.name}</h2>
                    <h3 className="text-xl font-semibold text-center mb-8">O que você vai validar?</h3>
                    
                    <button 
                        onClick={handleSelectAllSectors}
                        className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-6 rounded-lg text-lg mb-6 shadow-md transition-colors border border-gray-600"
                    >
                        Validar Todos os Setores (Geral)
                    </button>

                    <div className="border-t border-gray-600 my-4 relative">
                        <span className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-800 px-2 text-gray-400 text-sm">OU SELECIONE OS SETORES</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6 mb-6">
                        {sectorNames.map(sector => {
                            const isSelected = activeSectors.includes(sector);
                            return (
                                <button
                                    key={sector}
                                    onClick={() => toggleSectorSelection(sector)}
                                    className={`font-semibold py-3 px-4 rounded-lg border transition-colors ${
                                        isSelected 
                                        ? 'bg-orange-600 text-white border-orange-500' 
                                        : 'bg-gray-700 text-gray-300 border-gray-600 hover:border-gray-500'
                                    }`}
                                >
                                    {sector}
                                </button>
                            );
                        })}
                    </div>
                    
                    {activeSectors.length > 0 && (
                         <button 
                            onClick={confirmSectorSelection}
                            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 px-6 rounded-lg text-lg shadow-md animate-fade-in"
                        >
                            Validar {activeSectors.length} Setor(es) Selecionado(s)
                        </button>
                    )}

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
    
    // Filter history based on active sectors restriction
    const displayHistory = activeSectors.length > 0
        ? scanHistory.filter(s => activeSectors.includes(s.ticketSector) || s.status === 'INVALID' || s.status === 'WRONG_SECTOR')
        : scanHistory;

    // Format header text
    const validationLabel = activeSectors.length > 0 
        ? activeSectors.join(', ') 
        : 'Todos os Setores';

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Você está offline. As validações estão sendo salvas localmente e serão sincronizadas." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3">
                                {validationConfig.mode === 'ONLINE' && (
                                    <span className="text-xs font-bold bg-green-900 text-green-200 px-2 py-0.5 rounded border border-green-700 mb-1 sm:mb-0 self-start">
                                        MODO ONLINE ({validationConfig.endpoints.length} APIs)
                                    </span>
                                )}
                                {activeSectors.length > 0 ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-orange-300 border border-orange-500/30 max-w-[200px] truncate" title={validationLabel}>
                                            Validando: {validationLabel}
                                        </span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline whitespace-nowrap">
                                            Alterar
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setIsSectorSelectionStep(true)} className="text-sm text-orange-400 hover:underline">
                                        Selecionar Setores
                                    </button>
                                )}
                                <button onClick={handleSwitchEvent} className="text-sm text-gray-500 hover:text-gray-300 underline ml-2">
                                    Sair
                                </button>
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
                                {/* Only show sector tabs if NO specific sector restriction is active */}
                                {activeSectors.length === 0 && (
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
                            </div>

                             <div className="space-y-6">
                                 <TicketList 
                                    tickets={displayHistory} 
                                    sectorNames={sectorNames} 
                                    hideTabs={activeSectors.length > 0}
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

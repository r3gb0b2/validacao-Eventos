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
import { CogIcon, QrCodeIcon, VideoCameraIcon } from './components/Icons';

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
    
    // New state for Sector Selection Flow
    const [isSectorSelectionStep, setIsSectorSelectionStep] = useState(false);
    // Changed from lockedSector (string) to activeSectors (string array) to support multiple
    const [activeSectors, setActiveSectors] = useState<string[]>([]);

    // Camera inactivity logic
    const [isCameraActive, setIsCameraActive] = useState(true);
    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cooldownRef = useRef<boolean>(false);

    // const playSuccessSound = useSound('/sounds/success.mp3');
    // const playErrorSound = useSound('/sounds/error.mp3');

    // Online Validation Config State (Loaded from DB)
    const [validationConfig, setValidationConfig] = useState<{
        mode: 'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS';
        apiEndpoints: { url: string, token: string, eventId: string }[];
        sheetUrl: string;
    }>({ mode: 'OFFLINE', apiEndpoints: [], sheetUrl: '' });

    const ticketsMap = useMemo(() => {
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
        }
        setIsCameraActive(true);
        inactivityTimerRef.current = setTimeout(() => {
            setIsCameraActive(false);
        }, 60000); // 60 seconds
    }, []);

    useEffect(() => {
        // Start timer on mount
        resetInactivityTimer();
        
        // Add listeners for user interaction to reset timer? 
        // The prompt specifically asked for "1 minute without usage". 
        // Usually means without scanning. But let's reset on interaction too for better UX?
        // For now, sticking to strictly scanning or manual reactivation to keep it simple as requested.
        
        return () => {
            if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        };
    }, [resetInactivityTimer]);

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
                if (event) {
                   // We don't auto-select here to allow the user to see the event selector if they refresh
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

        // Load validation settings (Online/Offline)
        const valSettingsUnsubscribe = onSnapshot(doc(db, 'events', eventId, 'settings', 'validation'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setValidationConfig({
                    mode: data.mode || 'OFFLINE',
                    apiEndpoints: Array.isArray(data.apiEndpoints) ? data.apiEndpoints : (data.apiUrl ? [{ url: data.apiUrl, token: data.apiToken || '', eventId: data.apiEventId || '' }] : []),
                    sheetUrl: data.sheetUrl || ''
                });
            }
        });

        return () => {
            ticketsUnsubscribe();
            scansUnsubscribe();
            settingsUnsubscribe();
            valSettingsUnsubscribe();
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
        setActiveSectors([]); // Start with no specific sectors selected (which allows selecting All via button)
        localStorage.setItem('selectedEventId', event.id);
    };

    // Toggle a sector in the selection list
    const toggleSectorSelection = (sector: string) => {
        setActiveSectors(prev => 
            prev.includes(sector) 
                ? prev.filter(s => s !== sector) 
                : [...prev, sector]
        );
    };

    const handleConfirmSectorSelection = (sectorsToValidate: string[] | 'All') => {
        if (sectorsToValidate === 'All') {
            setSelectedSector('All');
            setActiveSectors([]);
        } else {
            // If specific sectors are chosen
            if (sectorsToValidate.length === 1) {
                setSelectedSector(sectorsToValidate[0]);
            } else {
                setSelectedSector('All'); // UI tab view
            }
            setActiveSectors(sectorsToValidate);
        }
        setIsSectorSelectionStep(false);
        resetInactivityTimer(); // Ensure camera starts fresh
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
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: newNames });
    };
    
    const showScanResult = (status: ScanStatus, message: string) => {
        setScanResult({ status, message });
        setTimeout(() => setScanResult(null), 3000);
    };

    // --- ONLINE API VALIDATION (ST INGRESSOS / LARAVEL) ---
    const validateOnlineApi = async (code: string, eventId: string, apiEndpoints: { url: string, token: string, eventId: string }[]) => {
        // Try each endpoint sequentially until a valid response or all fail
        for (const endpoint of apiEndpoints) {
            if (!endpoint.url) continue;
            
            try {
                // Ensure URL doesn't end with slash for consistency
                const baseUrl = endpoint.url.replace(/\/$/, '');
                
                // 1. Extract code if it's a URL
                let cleanCode = code.trim();
                try {
                    if (cleanCode.startsWith('http')) {
                        const urlObj = new URL(cleanCode);
                        const parts = urlObj.pathname.split('/');
                        const possibleCode = parts[parts.length - 1];
                        if (possibleCode && possibleCode.length > 4) {
                            cleanCode = possibleCode;
                        }
                    }
                } catch (e) {}

                // Determine Event ID to use (Endpoint specific overrides global)
                const targetEventId = endpoint.eventId ? endpoint.eventId : '';
                const numericEventId = targetEventId ? parseInt(targetEventId, 10) : null;

                const headers: HeadersInit = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };
                if (endpoint.token) {
                    headers['Authorization'] = `Bearer ${endpoint.token}`;
                }

                const tryRequests = async () => {
                    // Strategy 1: POST to /checkins (Standard)
                    // Send multiple keys to ensure compatibility
                    const bodyData: any = { 
                        code: cleanCode,
                        qr_code: cleanCode,
                        ticket_code: cleanCode,
                        uuid: cleanCode
                    };
                    if (numericEventId) bodyData['event_id'] = numericEventId;

                    // Query param string for GET requests
                    const queryParams = numericEventId ? `?event_id=${numericEventId}` : '';
                    
                    // Attempt 1: POST Body
                    try {
                        const res = await fetch(baseUrl, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(bodyData)
                        });
                        if (res.status === 200 || res.status === 201 || res.status === 422 || res.status === 409) return res;
                    } catch(e) {}

                    // Attempt 2: POST to /checkins/{code}
                    try {
                        const res = await fetch(`${baseUrl}/${cleanCode}${queryParams}`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({}) // Empty body, code in URL
                        });
                        if (res.status === 200 || res.status === 201 || res.status === 422 || res.status === 409) return res;
                    } catch(e) {}

                    // Attempt 3: GET /checkins/{code} or /tickets/{code} (Check status)
                    try {
                         // Try to deduce a GET url if the base is checkins, maybe tickets exists?
                         // Or just GET the base url + code
                         const res = await fetch(`${baseUrl}/${cleanCode}${queryParams}`, { method: 'GET', headers });
                         if (res.status === 200) return res;
                    } catch(e) {}
                    
                    // Attempt 4: GET ?code={code}
                    try {
                        const res = await fetch(`${baseUrl}?code=${cleanCode}${numericEventId ? `&event_id=${numericEventId}` : ''}`, { method: 'GET', headers });
                         if (res.status === 200) return res;
                    } catch(e) {}

                    return null;
                };

                const response = await tryRequests();

                if (response) {
                    const data = await response.json();
                    const status = response.status;
                    
                    // Identify sector from response if possible
                    let sectorName = 'Online';
                    if (data.sector) sectorName = typeof data.sector === 'string' ? data.sector : (data.sector.name || 'Online');
                    else if (data.ticket?.sector) sectorName = data.ticket.sector.name || data.ticket.sector || 'Online';
                    
                    // Success
                    if (status === 200 || status === 201) {
                         // Some APIs return 200 but success: false in body
                         if (data.success === false) {
                             return { status: 'INVALID', message: data.message || 'Erro na validação', sector: sectorName };
                         }
                         return { status: 'VALID', message: data.message || 'Acesso Liberado', sector: sectorName, source: 'API' };
                    }
                    
                    // Already Used
                    if (status === 422 || status === 409 || (data.message && (data.message.includes('utilizado') || data.message.includes('used')))) {
                        return { status: 'USED', message: data.message || 'Ingresso Já Utilizado', sector: sectorName };
                    }

                    // Found response but error
                     if (data.message) {
                        return { status: 'INVALID', message: data.message, sector: sectorName };
                    }
                }

                // If 404, loop continues to next endpoint
                
            } catch (error) {
                console.error("API Scan Error:", error);
                // Continue to next endpoint on network error
            }
        }

        // If loop finishes without returning
        return { status: 'INVALID', message: 'Ingresso não encontrado em nenhuma API.', sector: 'Desconhecido' };
    };

    // --- ONLINE SHEETS VALIDATION ---
    const validateOnlineSheets = async (code: string, sheetUrl: string) => {
         try {
            // Append random param to prevent caching
            const fetchUrl = `${sheetUrl}${sheetUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
            const response = await fetch(fetchUrl);
            const csvText = await response.text();
             // Simple parser
            const rows = csvText.split('\n').map(row => row.split(','));
            
            // Find header index
            const header = rows[0].map(h => h.toLowerCase().trim());
            const codeIdx = header.findIndex(h => h.includes('code') || h.includes('codigo') || h.includes('qr'));
            const sectorIdx = header.findIndex(h => h.includes('sector') || h.includes('setor'));
            
            if (codeIdx === -1) return { status: 'ERROR', message: 'Coluna de código não encontrada na planilha' };

            const cleanCode = code.trim().toLowerCase();
            const match = rows.find(row => row[codeIdx]?.trim().toLowerCase() === cleanCode);

            if (match) {
                const sector = sectorIdx !== -1 ? match[sectorIdx]?.trim() : 'Geral';
                // In sheets mode, we need to check local DB for "USED" status since sheets is read-only usually
                return { status: 'VALID_SHEET', sector: sector, rowData: match };
            }

            return { status: 'INVALID', message: 'Ingresso não encontrado na planilha' };

         } catch (e) {
             console.error(e);
             return { status: 'ERROR', message: 'Erro ao ler planilha Google' };
         }
    };


    const handleScanSuccess = useCallback(async (decodedText: string) => {
        resetInactivityTimer(); // Reset timer on scan
        if (cooldownRef.current || !db || !selectedEvent) return;

        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, 2500); // Slightly longer cooldown

        const eventId = selectedEvent.id;
        const ticketId = decodedText.trim();
        
        const logScan = async (status: ScanStatus, sector: string) => {
            try {
                await addDoc(collection(db, 'events', eventId, 'scans'), {
                    ticketId, status, timestamp: serverTimestamp(), sector
                });
            } catch (error) { console.error(`Failed to log ${status} scan:`, error); }
        };

        // --- ONLINE MODE HANDLING ---
        if (validationConfig.mode === 'ONLINE_API') {
            showScanResult('VALID', 'Validando na API...'); // Loading state
            
            const result = await validateOnlineApi(ticketId, eventId, validationConfig.apiEndpoints);
            
            // Check Sector Lock even for Online Mode if we have sector info
            if (result.status === 'VALID' && activeSectors.length > 0 && result.sector !== 'Online') {
                if (!activeSectors.includes(result.sector)) {
                    showScanResult('WRONG_SECTOR', `Setor incorreto! É ${result.sector}.`);
                    await logScan('WRONG_SECTOR', result.sector);
                    return;
                }
            }

            showScanResult(result.status as ScanStatus, result.message);
            await logScan(result.status as ScanStatus, result.sector || 'Online');
            return;
        }

        if (validationConfig.mode === 'ONLINE_SHEETS') {
            showScanResult('VALID', 'Verificando Planilha...');
            const sheetResult = await validateOnlineSheets(ticketId, validationConfig.sheetUrl);
            
            if (sheetResult.status === 'VALID_SHEET') {
                // Check if already used locally (Hybrid approach)
                const ticketRef = doc(db, 'events', eventId, 'tickets', ticketId); // Use ID as doc ID
                // We might not have imported it, so we check `scans` or create a lightweight ticket doc on fly
                // Better: Check if we have a 'USED' ticket record
                
                // For simplicity in this mode: We treat the sheet as the "list of valids". 
                // We MUST store usage in Firebase to prevent reuse.
                
                // First, check sector lock
                if (activeSectors.length > 0 && sheetResult.sector && !activeSectors.includes(sheetResult.sector)) {
                     showScanResult('WRONG_SECTOR', `Setor incorreto! É ${sheetResult.sector}.`);
                     await logScan('WRONG_SECTOR', sheetResult.sector || 'Planilha');
                     return;
                }

                // Check if already used in DB
                // We need to query tickets collection to see if it was marked used. 
                // Since we didn't import, the ticket might not exist or exist only if used.
                // Let's check ticketsMap first (which loads all tickets). 
                // If mode is Online Sheets, ticketsMap might be empty if we never imported. 
                // We should trust the `allTickets` listener.
                
                const existingTicket = ticketsMap.get(ticketId);
                if (existingTicket && existingTicket.status === 'USED') {
                    showScanResult('USED', 'Ingresso já utilizado (Local)');
                    await logScan('USED', sheetResult.sector || 'Planilha');
                    return;
                }

                // Mark as used
                const batch = writeBatch(db);
                batch.set(ticketRef, { 
                    sector: sheetResult.sector, 
                    status: 'USED', 
                    usedAt: serverTimestamp() 
                }, { merge: true });
                
                const logRef = doc(collection(db, 'events', eventId, 'scans'));
                batch.set(logRef, { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: sheetResult.sector });
                
                await batch.commit();
                showScanResult('VALID', `Acesso Liberado (Planilha)!`);
            } else {
                showScanResult(sheetResult.status as ScanStatus, sheetResult.message || 'Erro');
                await logScan('INVALID', 'Desconhecido');
            }
            return;
        }

        // --- OFFLINE MODE (DEFAULT) ---
        const ticket = ticketsMap.get(ticketId);

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

        // Logic check: if we have active sectors (Locked Mode), ensure the ticket matches ONE of them
        if (activeSectors.length > 0 && !activeSectors.includes(ticket.sector)) {
            const message = `Setor incorreto! Ingresso para ${ticket.sector}, validando: ${activeSectors.join(', ')}.`;
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
    }, [db, selectedEvent, ticketsMap, activeSectors, validationConfig, resetInactivityTimer]);
    
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
                    // We select it but skip sector selection step for admin view
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

    // Sector Selection Screen
    if (selectedEvent && view === 'scanner' && isSectorSelectionStep) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-2 text-orange-500">{selectedEvent.name}</h2>
                    <h3 className="text-xl font-semibold text-center mb-6">O que você vai validar?</h3>
                    
                    {/* Single button to select ALL */}
                    <button 
                        onClick={() => handleConfirmSectorSelection('All')}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-lg mb-6 shadow-md transition-transform transform hover:scale-105"
                    >
                        Validar Todos os Setores (Geral)
                    </button>

                    <div className="border-t border-gray-600 my-4 relative">
                        <span className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-800 px-2 text-gray-400 text-sm uppercase">Ou selecione setores específicos</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                        {sectorNames.map(sector => {
                            const isSelected = activeSectors.includes(sector);
                            return (
                                <button
                                    key={sector}
                                    onClick={() => toggleSectorSelection(sector)}
                                    className={`font-semibold py-3 px-4 rounded-lg border transition-colors ${
                                        isSelected 
                                            ? 'bg-orange-600 text-white border-orange-400' 
                                            : 'bg-gray-700 text-gray-300 border-gray-600 hover:border-gray-400'
                                    }`}
                                >
                                    {sector}
                                    {isSelected && <span className="ml-2 text-xs bg-white text-orange-600 px-1 rounded-full">✓</span>}
                                </button>
                            );
                        })}
                    </div>

                    {activeSectors.length > 0 && (
                        <div className="mt-6 animate-fade-in">
                            <button 
                                onClick={() => handleConfirmSectorSelection(activeSectors)}
                                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 px-6 rounded-lg text-lg shadow-md transition-transform transform hover:scale-105 border-2 border-orange-400"
                            >
                                Validar {activeSectors.length} Setor{activeSectors.length > 1 ? 'es' : ''} Selecionado{activeSectors.length > 1 ? 's' : ''}
                            </button>
                        </div>
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
    
    // Filter history if sectors are locked so the user only sees relevant scans
    // We also include INVALID (not found) and WRONG_SECTOR scans.
    const displayHistory = activeSectors.length > 0
        ? scanHistory.filter(s => activeSectors.includes(s.ticketSector) || s.status === 'INVALID' || s.status === 'WRONG_SECTOR')
        : scanHistory;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Você está offline. As validações estão sendo salvas localmente e serão sincronizadas." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                            <div className="flex items-center space-x-2">
                                <span className={`text-sm font-semibold px-2 py-1 rounded border ${validationConfig.mode !== 'OFFLINE' ? 'bg-blue-900 text-blue-300 border-blue-500' : 'bg-gray-800 text-gray-400 border-gray-600'}`}>
                                    {validationConfig.mode === 'OFFLINE' ? 'MODO OFFLINE' : 'MODO ONLINE'}
                                </span>
                                {activeSectors.length > 0 ? (
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-orange-300 border border-orange-500/30 max-w-[200px] truncate" title={activeSectors.join(', ')}>
                                            Validando: {activeSectors.join(', ')}
                                        </span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline">
                                            Alterar
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center space-x-2">
                                         <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-green-300 border border-green-500/30">
                                            Todos os Setores
                                        </span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline">
                                            Filtrar
                                        </button>
                                        <button onClick={handleSwitchEvent} className="text-xs text-orange-400 hover:underline ml-2">
                                            (Trocar Evento)
                                        </button>
                                    </div>
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
                                {/* Only show sector tabs if NO specific sectors are locked */}
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
                                    
                                    {/* Inactivity / Economy Mode Screen */}
                                    {!isCameraActive ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-0">
                                            <VideoCameraIcon className="w-16 h-16 text-gray-600 mb-4" />
                                            <h3 className="text-xl font-bold text-gray-400">Modo Econômico</h3>
                                            <p className="text-sm text-gray-500 mb-6 text-center px-4">Câmera desligada por inatividade.</p>
                                            <button 
                                                onClick={resetInactivityTimer}
                                                className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform transform hover:scale-105 flex items-center"
                                            >
                                                <VideoCameraIcon className="w-5 h-5 mr-2" />
                                                ATIVAR CÂMERA
                                            </button>
                                        </div>
                                    ) : (
                                        <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
                                    )}
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
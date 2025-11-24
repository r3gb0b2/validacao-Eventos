// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDocs, where, getDoc } from 'firebase/firestore';

import Scanner from './components/Scanner';
import StatusDisplay from './components/StatusDisplay';
import AdminView from './components/AdminView';
import SetupInstructions from './components/SetupInstructions';
import AlertBanner from './components/AlertBanner';
import EventSelector from './components/EventSelector';
// FIX: Import TicketList to resolve 'Cannot find name' error.
import TicketList from './components/TicketList';
import PublicStatsView from './components/PublicStatsView';
import { CogIcon, QrCodeIcon, VideoCameraIcon } from './components/Icons';

import { Ticket, ScanStatus, DisplayableScanLog, SectorFilter, Event } from './types';

// NOTE: Sound hook is not implemented in the provided files.
// To enable sounds, implement `hooks/useSound.ts`.
// import useSound from './hooks/useSound';

// Helper to get or create a unique ID for this browser/device
const getDeviceId = () => {
    let id = localStorage.getItem('device_id');
    if (!id) {
        // Generate a simple random ID
        id = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('device_id', id);
    }
    return id;
};

const App: React.FC = () => {
    const [db, setDb] = useState<Firestore | null>(null);
    const [firebaseStatus, setFirebaseStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [scanHistory, setScanHistory] = useState<DisplayableScanLog[]>([]);
    const [sectorNames, setSectorNames] = useState<string[]>(['Pista', 'VIP']);
    const [selectedSector, setSelectedSector] = useState<SectorFilter>('All');
    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats'>('scanner');
    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string } | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [ticketsLoaded, setTicketsLoaded] = useState(false); // New state to track if data is ready
    const [isCheckingUrl, setIsCheckingUrl] = useState(true); // New state to prevent flashing login screen
    const [manualCode, setManualCode] = useState(''); // State for manual code entry
    
    // New state for Operator Flow
    const [operatorName, setOperatorName] = useState(localStorage.getItem('operatorName') || '');
    const [isOperatorStep, setIsOperatorStep] = useState(false);
    const [tempOperatorName, setTempOperatorName] = useState('');

    // New state for Sector Selection Flow
    const [isSectorSelectionStep, setIsSectorSelectionStep] = useState(false);
    const [lockedSector, setLockedSector] = useState<string | null>(null);
    const [activeSectors, setActiveSectors] = useState<string[]>([]);

    // Inactivity Timer State
    const [isCameraActive, setIsCameraActive] = useState(true);
    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Online Validation Config State
    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');
    const [onlineApiEndpoints, setOnlineApiEndpoints] = useState<{ url: string, token: string, eventId: string }[]>([{ url: '', token: '', eventId: '' }]);
    const [onlineSheetUrl, setOnlineSheetUrl] = useState('');

    const cooldownRef = useRef<boolean>(false);
    
    // Get current device ID
    const deviceId = useMemo(() => getDeviceId(), []);

    // const playSuccessSound = useSound('/sounds/success.mp3');
    // const playErrorSound = useSound('/sounds/error.mp3');

    const ticketsMap = useMemo(() => {
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    // Function to reset the inactivity timer
    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
        }
        if (!isCameraActive) {
             setIsCameraActive(true);
        }
        // Set timer for 60 seconds (60000 ms)
        inactivityTimerRef.current = setTimeout(() => {
            setIsCameraActive(false);
        }, 60000);
    }, [isCameraActive]);

    // Initial Database Connection
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

    // Check for Public Stats Mode in URL - OPTIMIZED for Mobile
    useEffect(() => {
        const checkUrlParams = async () => {
            if (!db) return;
            
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const eventIdParam = params.get('eventId');
            
            if (mode === 'stats' && eventIdParam) {
                // IMPORTANT: Set loading state immediately to prevent "blank screen" rendering on mobile
                setTicketsLoaded(false); 
                
                // Direct fetch to avoid waiting for full event list
                try {
                    const eventDoc = await getDoc(doc(db, 'events', eventIdParam));
                    if (eventDoc.exists()) {
                        setSelectedEvent({ id: eventDoc.id, name: eventDoc.data().name, isHidden: eventDoc.data().isHidden });
                        setView('public_stats');
                        setIsSectorSelectionStep(false);
                        setIsOperatorStep(false);
                    } else {
                        console.error("Event not found for public stats");
                    }
                } catch (e) {
                    console.error("Error fetching event from URL", e);
                }
            }
            
            // Allow the app to render the view
            setIsCheckingUrl(false);
        };

        if (db && firebaseStatus === 'success') {
            checkUrlParams();
        }
    }, [db, firebaseStatus]);

    // Effect for fetching the list of events (Only if NOT in public stats mode to save bandwidth)
    useEffect(() => {
        if (!db || view === 'public_stats') return;

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
        }, (error) => {
            console.error("Firebase connection failed.", error);
            setFirebaseStatus('error');
        });

        return () => eventsUnsubscribe();
    }, [db, selectedEvent, view]);

    // Effect for handling data subscriptions for the SELECTED event
    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setSectorNames(['Pista', 'VIP']); // Reset to default
            setValidationMode('OFFLINE');
            setTicketsLoaded(false);
            return;
        };

        const eventId = selectedEvent.id;
        setTicketsLoaded(false); // Reset loading state when event changes

        // Load Event Settings (Sector Names & Validation Mode)
        const settingsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'settings'), (snapshot) => {
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (docSnap.id === 'main') {
                    if (data.sectorNames && Array.isArray(data.sectorNames) && data.sectorNames.length > 0) {
                        setSectorNames(data.sectorNames as string[]);
                    } else {
                        setSectorNames(['Pista', 'VIP']);
                    }
                } else if (docSnap.id === 'validation') {
                    if (data.mode) setValidationMode(data.mode);
                    else setValidationMode('OFFLINE'); // Default

                    if (data.apiEndpoints && Array.isArray(data.apiEndpoints)) setOnlineApiEndpoints(data.apiEndpoints);
                    else if (data.apiUrl) setOnlineApiEndpoints([{ url: data.apiUrl, token: data.apiToken || '', eventId: data.apiEventId || '' }]);
                    
                    if (data.sheetUrl) setOnlineSheetUrl(data.sheetUrl);
                }
            });
        });

        // Load Tickets
        const ticketsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'tickets'), (snapshot) => {
            const ticketsData = snapshot.docs.map(doc => {
                const data = doc.data();
                const ticket: Ticket = {
                    id: doc.id,
                    sector: data.sector,
                    status: data.status,
                    details: data.details ? { 
                        ownerName: data.details.ownerName, 
                        eventName: data.details.eventName,
                        originalId: data.details.originalId // Load original numeric ID if available
                    } : undefined,
                };
                if (data.usedAt instanceof Timestamp) {
                    ticket.usedAt = data.usedAt.toMillis();
                } else if (typeof data.usedAt === 'number') {
                    ticket.usedAt = data.usedAt;
                }
                return ticket;
            });
            setAllTickets(ticketsData);
            setTicketsLoaded(true); // Data loaded - set to true to hide skeleton
        });

        // Load Scan History
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
                    deviceId: data.deviceId, // Ensure we capture who scanned it
                    operatorName: data.operatorName // Who scanned it
                };
            });
            setScanHistory(historyData);
        }, console.error);

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

        // Start inactivity timer on mount
        resetInactivityTimer();

        // Add event listeners for user activity to reset timer
        const events = ['mousemove', 'keydown', 'click', 'touchstart'];
        const activityHandler = () => resetInactivityTimer();
        
        events.forEach(event => window.addEventListener(event, activityHandler));

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            events.forEach(event => window.removeEventListener(event, activityHandler));
            if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        };
    }, [resetInactivityTimer]);

    const handleSelectEvent = (event: Event) => {
        setSelectedEvent(event);
        
        // Flow: Event -> Operator -> Sector -> Scanner
        // Check if operator name is already set
        if (!operatorName) {
             setIsOperatorStep(true);
             setTempOperatorName('');
        } else {
             setIsOperatorStep(false);
             setIsSectorSelectionStep(true);
        }
        
        setLockedSector(null);
        setActiveSectors([]);
        localStorage.setItem('selectedEventId', event.id);
    };

    const handleConfirmOperator = () => {
        if (!tempOperatorName.trim()) {
            alert("Por favor, insira seu nome.");
            return;
        }
        const name = tempOperatorName.trim();
        setOperatorName(name);
        localStorage.setItem('operatorName', name);
        setIsOperatorStep(false);
        setIsSectorSelectionStep(true);
    };

    const handleChangeOperator = () => {
        setView('scanner');
        setIsSectorSelectionStep(false);
        setIsOperatorStep(true);
        setTempOperatorName(operatorName);
    };

    const handleToggleSectorSelection = (sector: string) => {
        if (activeSectors.includes(sector)) {
            setActiveSectors(activeSectors.filter(s => s !== sector));
        } else {
            setActiveSectors([...activeSectors, sector]);
        }
    };

    const handleConfirmSectorSelection = () => {
        if (activeSectors.length > 0) {
            setLockedSector('Multiple'); // We use 'Multiple' as a flag, actual filtering uses activeSectors
            setSelectedSector('All'); // For UI display purposes
        } else {
            setLockedSector(null);
            setSelectedSector('All');
        }
        setIsSectorSelectionStep(false);
    };

    const handleSwitchEvent = () => {
        setSelectedEvent(null);
        setView('scanner');
        setLockedSector(null);
        setActiveSectors([]);
        setIsSectorSelectionStep(false);
        setIsOperatorStep(false);
        localStorage.removeItem('selectedEventId');
    };

    const handleUpdateSectorNames = async (newNames: string[]) => {
        if (!db || !selectedEvent) throw new Error("Database or event not selected");
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: newNames }, { merge: true });
    };
    
    const showScanResult = (status: ScanStatus, message: string) => {
        setScanResult({ status, message });
        // if (status === 'VALID') playSuccessSound();
        // else playErrorSound();
        setTimeout(() => setScanResult(null), 3000);
        resetInactivityTimer(); // Reset timer on scan result
    };

    const handleScanSuccess = useCallback(async (decodedText: string) => {
        if (cooldownRef.current || !db || !selectedEvent) return;
        resetInactivityTimer();

        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, 2000);

        const eventId = selectedEvent.id;
        
        // --- ONLINE VALIDATION LOGIC ---
        if (validationMode !== 'OFFLINE') {
            
            // 1. Google Sheets Validation
            if (validationMode === 'ONLINE_SHEETS' && onlineSheetUrl) {
                // ... (Google Sheets logic logic)
                 showScanResult('ERROR', 'Validação Online via Planilha não implementada completamente neste passo.');
                 return;
            }

            // 2. API Validation
            if (validationMode === 'ONLINE_API') {
                const endpoints = onlineApiEndpoints.filter(ep => ep.url);
                
                if (endpoints.length === 0) {
                    showScanResult('ERROR', 'Nenhuma API configurada para modo online.');
                    return;
                }

                showScanResult('VALID', 'Validando online...'); // Temporary loading state

                // Extract code from URL if it's a URL
                let codeToValidate = decodedText.trim();
                let urlCode = '';
                try {
                    if (codeToValidate.startsWith('http')) {
                        const urlObj = new URL(codeToValidate);
                        const segments = urlObj.pathname.split('/');
                        urlCode = segments[segments.length - 1]; // Get last part of path
                        if (urlObj.searchParams.get('code')) urlCode = urlObj.searchParams.get('code')!;
                        if (urlObj.searchParams.get('id')) urlCode = urlObj.searchParams.get('id')!;
                    }
                } catch (e) {}

                // Priority: extracted URL code, then raw text
                const codesToSend = [];
                if (urlCode && urlCode !== codeToValidate) codesToSend.push(urlCode);
                codesToSend.push(codeToValidate);

                for (const endpoint of endpoints) {
                    try {
                        let response = null;
                        let foundCode = '';
                        const numericEventId = parseInt(endpoint.eventId || '0', 10);
                        
                        if (!numericEventId) {
                             showScanResult('ERROR', 'ID do Evento não configurado nas opções (Necessário p/ API).');
                             return;
                        }
                        
                        // ROBUST URL SANITIZATION
                        // Remove trailing slash
                        let apiBase = endpoint.url.trim();
                        if (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);
                        
                        // Remove known endpoints to get the root or parent if user pasted something specific
                        // ST Ingressos works best with base url ending in nothing specific or just host
                        apiBase = apiBase.replace(/\/tickets(\/.*)?$/, '')
                                         .replace(/\/participants(\/.*)?$/, '')
                                         .replace(/\/buyers(\/.*)?$/, '')
                                         .replace(/\/checkins(\/.*)?$/, '');
                        
                        const checkinUrl = `${apiBase}/checkins`;

                        // Try each extracted code variant
                        for (const code of codesToSend) {
                            const headers = {
                                'Accept': 'application/json',
                                'Authorization': `Bearer ${endpoint.token}`
                            };

                            // STRATEGY 1: POST to /checkins/{code} with JSON body (Best for ST Ingressos)
                            try {
                                const pathUrl = `${checkinUrl}/${code}`;
                                const urlWithQuery = `${pathUrl}?event_id=${numericEventId}`; // Some APIs check query
                                
                                const res = await fetch(urlWithQuery, {
                                    method: 'POST',
                                    headers: { ...headers, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ 
                                        event_id: numericEventId,
                                        qr_code: code 
                                    })
                                });
                                
                                // 200, 201 = Valid/Recorded. 409, 422 = Already Used/Logical Error
                                if (res.status !== 404 && res.status !== 405) {
                                    response = res; foundCode = code; break;
                                }
                            } catch(e) { console.warn('Strat 1 fail', e); }

                            // STRATEGY 2: POST to /checkins (Body only)
                            if (!response) {
                                try {
                                    const bodyPayload = {
                                        event_id: numericEventId,
                                        code: code,
                                        qr_code: code,
                                        ticket_code: code,
                                        uuid: code
                                    };
                                    const res = await fetch(checkinUrl, {
                                        method: 'POST',
                                        headers: { ...headers, 'Content-Type': 'application/json' },
                                        body: JSON.stringify(bodyPayload)
                                    });
                                    if (res.status !== 404) {
                                        response = res; foundCode = code; break;
                                    }
                                } catch (e) {}
                            }
                            
                            // STRATEGY 3: POST to /checkins/{code} with FormData (PHP Fallback)
                            if (!response) {
                                try {
                                    const formData = new FormData();
                                    formData.append('event_id', String(numericEventId));
                                    formData.append('qr_code', code);
                                    
                                    const pathUrl = `${checkinUrl}/${code}`;
                                    const res = await fetch(pathUrl, {
                                        method: 'POST',
                                        headers: headers, // Content-Type is automatic
                                        body: formData
                                    });
                                     if (res.status !== 404) {
                                        response = res; foundCode = code; break;
                                    }
                                } catch(e) {}
                            }

                            // STRATEGY 4: GET /tickets/{code} (Last resort - Read Only)
                            if (!response) {
                                try {
                                     const ticketsUrl = `${apiBase}/tickets/${code}?event_id=${numericEventId}`;
                                     const res = await fetch(ticketsUrl, {
                                        method: 'GET',
                                        headers: headers
                                     });
                                     if (res.ok) { response = res; foundCode = code; break; }
                                } catch (e) {}
                            }
                        }

                        if (response) {
                            const data = await response.json();
                            const apiHost = new URL(endpoint.url).hostname;
                            const apiName = apiHost.replace('public-api.', '').replace('.com.br', '');

                            // Handle Error Messages explicitly from JSON body even if HTTP 200
                            if (data.message && (data.message.includes('belongs to another event') || data.message.includes('not found'))) {
                                continue; // Try next API
                            }

                            if (response.status === 200 || response.status === 201) {
                                // Double check success flag often used in JSON responses even with 200 OK
                                if (data.success === false || data.error === true) {
                                     // Treat as used or invalid based on message
                                      if (data.message && (data.message.toLowerCase().includes('used') || data.message.toLowerCase().includes('utilizado'))) {
                                          showScanResult('USED', `Ingresso já utilizado! (${apiName})`);
                                          return;
                                      } else {
                                           if (data.message.toLowerCase().includes('not found')) continue;
                                           showScanResult('INVALID', `${data.message || 'Erro na validação'} (${apiName})`);
                                           return;
                                      }
                                }

                                const sector = (data.sector_name || data.sector || data.category || 'Externo').trim();
                                
                                // SECTOR VALIDATION LOGIC FOR ONLINE API
                                if (activeSectors.length > 0) {
                                    const isAllowed = activeSectors.some(s => s.trim().toLowerCase() === sector.toLowerCase());
                                    if (!isAllowed) {
                                         showScanResult('WRONG_SECTOR', `Setor incorreto! Ingresso é do setor "${sector}".`);
                                         await addDoc(collection(db, 'events', eventId, 'scans'), {
                                            ticketId: foundCode, 
                                            status: 'WRONG_SECTOR', 
                                            timestamp: serverTimestamp(), 
                                            sector: sector,
                                            deviceId: deviceId,
                                            operatorName: operatorName // Add operator
                                        });
                                        return;
                                    }
                                }

                                showScanResult('VALID', `Acesso Liberado! (${apiName}) - ${sector}`);
                                
                                await addDoc(collection(db, 'events', eventId, 'scans'), {
                                    ticketId: foundCode, 
                                    status: 'VALID', 
                                    timestamp: serverTimestamp(), 
                                    sector: sector,
                                    deviceId: deviceId,
                                    operatorName: operatorName // Add operator
                                });
                                return;
                            } else if (response.status === 409 || response.status === 422) {
                                showScanResult('USED', `Ingresso já utilizado! (${apiName})`);
                                await addDoc(collection(db, 'events', eventId, 'scans'), {
                                    ticketId: foundCode, 
                                    status: 'USED', 
                                    timestamp: serverTimestamp(), 
                                    sector: 'Externo',
                                    deviceId: deviceId,
                                    operatorName: operatorName // Add operator
                                });
                                return;
                            } else {
                                // Other error status
                                showScanResult('INVALID', `Erro: ${data.message || response.statusText}`);
                                return;
                            }
                        }
                    } catch (error) {
                        console.error("API error", error);
                    }
                }

                showScanResult('INVALID', 'Não encontrado em nenhuma API configurada.');
                await addDoc(collection(db, 'events', eventId, 'scans'), {
                    ticketId: decodedText, 
                    status: 'INVALID', 
                    timestamp: serverTimestamp(), 
                    sector: 'Externo',
                    deviceId: deviceId,
                    operatorName: operatorName // Add operator
                });
                return;
            }
        }

        // --- OFFLINE VALIDATION LOGIC (Standard) ---
        
        const ticketId = decodedText.trim();
        const ticket = ticketsMap.get(ticketId);
        
        const logScan = async (status: ScanStatus, sector: string) => {
            try {
                await addDoc(collection(db, 'events', eventId, 'scans'), {
                    ticketId, status, timestamp: serverTimestamp(), sector, deviceId, operatorName
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

        // Logic check: if we have locked sectors (Multi-sector selection), ensure the ticket matches one of them
        if (activeSectors.length > 0 && !activeSectors.includes(ticket.sector)) {
            const message = `Setor incorreto! Ingresso é do setor "${ticket.sector}".`;
            showScanResult('WRONG_SECTOR', message);
            await logScan('WRONG_SECTOR', ticket.sector);
            return;
        }

        try {
            const batch = writeBatch(db);
            const ticketRef = doc(db, 'events', eventId, 'tickets', ticketId);
            batch.update(ticketRef, { status: 'USED', usedAt: serverTimestamp() });

            const logRef = doc(collection(db, 'events', eventId, 'scans'));
            batch.set(logRef, { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operatorName });

            await batch.commit();
            showScanResult('VALID', `Acesso liberado para o setor ${ticket.sector}!`);

        } catch (error) {
            console.error("Failed to update ticket status:", error);
            showScanResult('ERROR', 'Falha ao atualizar o banco de dados. Tente novamente.');
        }
    }, [db, selectedEvent, ticketsMap, validationMode, onlineApiEndpoints, activeSectors, onlineSheetUrl, deviceId, operatorName]);
    
    const handleManualSubmit = () => {
        if (!manualCode.trim()) return;
        handleScanSuccess(manualCode);
        setManualCode('');
    };

    const handleScanError = (errorMessage: string) => {
        // This is called frequently when no QR code is in view. Can be used for debugging.
    };

    const checkAdminAuth = () => {
        const storedAuth = localStorage.getItem('admin_auth_expiry');
        if (storedAuth) {
            const expiry = parseInt(storedAuth, 10);
            if (Date.now() < expiry) {
                return true;
            }
        }
        return false;
    };

    const loginAdmin = () => {
        const password = prompt("Digite a senha para acessar o painel administrativo:");
        if (password === "123654") {
            // Save persistence for 24 hours
            const expiry = Date.now() + (24 * 60 * 60 * 1000);
            localStorage.setItem('admin_auth_expiry', expiry.toString());
            return true;
        } else if (password !== null) {
            alert("Senha incorreta!");
        }
        return false;
    };

    const handleAdminAccess = () => {
        if (checkAdminAuth() || loginAdmin()) {
            setView('admin');
        }
    };
    
    const handleAdminAccessFromSelector = useCallback(() => {
        const storedAuth = localStorage.getItem('admin_auth_expiry');
        let isAuthenticated = false;

        if (storedAuth && Date.now() < parseInt(storedAuth, 10)) {
            isAuthenticated = true;
        } else {
             const password = prompt("Digite a senha para acessar o painel administrativo:");
             if (password === "123654") {
                const expiry = Date.now() + (24 * 60 * 60 * 1000);
                localStorage.setItem('admin_auth_expiry', expiry.toString());
                isAuthenticated = true;
             } else if (password !== null) {
                alert("Senha incorreta!");
             }
        }

        if (isAuthenticated) {
            if (events.length > 0 && !selectedEvent) {
                const visibleEvents = events.filter(e => !e.isHidden);
                if (visibleEvents.length > 0) {
                    // We select it but skip sector selection step for admin view
                    setSelectedEvent(visibleEvents[0]);
                    setIsSectorSelectionStep(false);
                    setIsOperatorStep(false);
                }
            }
            setView('admin');
        }
    }, [events, selectedEvent]);

    if (!db || firebaseStatus === 'loading' || isCheckingUrl) {
        return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white text-2xl animate-pulse">Carregando...</div>;
    }

    if (firebaseStatus === 'error') {
        return <SetupInstructions />;
    }

    // Public Stats View (No login required)
    if (view === 'public_stats' && selectedEvent) {
        return (
            <PublicStatsView 
                event={selectedEvent}
                allTickets={allTickets || []} // Safeguard for mobile
                scanHistory={scanHistory || []} // Safeguard for mobile
                sectorNames={sectorNames || []} // Safeguard for mobile
                isLoading={!ticketsLoaded} // Pass loading state
            />
        );
    }

    if (!selectedEvent && view !== 'admin') {
        return <EventSelector events={events} onSelectEvent={handleSelectEvent} onAccessAdmin={handleAdminAccessFromSelector} />;
    }

    // Operator Input Screen
    if (selectedEvent && view === 'scanner' && isOperatorStep) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-md bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                     <h2 className="text-2xl font-bold text-center mb-2 text-orange-500">{selectedEvent.name}</h2>
                     <h3 className="text-xl font-semibold text-center mb-6">Identificação do Operador</h3>
                     
                     <div className="mb-6">
                         <label className="block text-sm text-gray-400 mb-2">Qual seu nome?</label>
                         <input 
                             type="text" 
                             value={tempOperatorName}
                             onChange={(e) => setTempOperatorName(e.target.value)}
                             placeholder="Ex: João Silva"
                             className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                             onKeyDown={(e) => e.key === 'Enter' && handleConfirmOperator()}
                             autoFocus
                         />
                     </div>

                     <button 
                         onClick={handleConfirmOperator}
                         className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-transform transform active:scale-95"
                     >
                         Continuar
                     </button>

                     <div className="mt-6 text-center">
                        <button onClick={handleSwitchEvent} className="text-gray-400 hover:text-white text-sm underline">
                            Voltar para seleção de eventos
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Sector Selection Screen
    if (selectedEvent && view === 'scanner' && isSectorSelectionStep) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-1 text-orange-500">{selectedEvent.name}</h2>
                    <p className="text-center text-gray-400 mb-6 text-sm">
                        Operador: <strong className="text-white">{operatorName}</strong> 
                        <button onClick={handleChangeOperator} className="ml-2 text-orange-400 hover:underline text-xs">(Trocar)</button>
                    </p>
                    <h3 className="text-xl font-semibold text-center mb-8">O que você vai validar?</h3>
                    
                    <button 
                        onClick={() => { setActiveSectors([]); handleConfirmSectorSelection(); }}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 px-6 rounded-lg text-lg mb-6 shadow-md transition-transform transform hover:scale-105"
                    >
                        Validar Todos os Setores (Geral)
                    </button>

                    <div className="border-t border-gray-600 my-4 relative">
                        <span className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-800 px-2 text-gray-400 text-sm">OU SELECIONE SETORES</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6">
                        {sectorNames.map(sector => (
                            <button
                                key={sector}
                                onClick={() => handleToggleSectorSelection(sector)}
                                className={`font-semibold py-3 px-4 rounded-lg border transition-colors ${
                                    activeSectors.includes(sector)
                                    ? 'bg-orange-500 text-white border-orange-400'
                                    : 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600'
                                }`}
                            >
                                {sector}
                            </button>
                        ))}
                    </div>

                    {activeSectors.length > 0 && (
                        <div className="mt-6">
                            <button 
                                onClick={handleConfirmSectorSelection}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-md animate-fade-in"
                            >
                                Validar {activeSectors.length} Setores Selecionados
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
    
    // Filter history logic:
    // 1. Filter by device ID (Local Scans Only for the list)
    const myScans = scanHistory.filter(s => s.deviceId === deviceId);

    // 2. Apply Sector Filters and Error Logic
    const displayHistory = (lockedSector && activeSectors.length > 0)
        ? myScans.filter(s => activeSectors.includes(s.ticketSector) || s.status === 'INVALID' || s.status === 'WRONG_SECTOR')
        : myScans;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Você está offline. As validações estão sendo salvas localmente e serão sincronizadas." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                             <div className="flex flex-col md:flex-row md:items-center space-y-1 md:space-y-0 md:space-x-2">
                                <span className="text-xs text-gray-400">
                                    {validationMode === 'OFFLINE' ? 'Modo Offline' : 'Modo Online'}
                                </span>
                                {lockedSector && activeSectors.length > 0 ? (
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-orange-300 border border-orange-500/30">
                                            Validando: {activeSectors.join(', ')}
                                        </span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline">
                                            Alterar
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={handleSwitchEvent} className="text-sm text-orange-400 hover:underline">
                                        Trocar Evento
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center mt-1">
                                 <span className="text-xs text-gray-400 mr-2">Operador: <strong className="text-gray-300">{operatorName}</strong></span>
                                 <button onClick={handleChangeOperator} className="text-[10px] bg-gray-800 px-1 rounded text-gray-500 hover:text-white border border-gray-700">Trocar</button>
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
                                {/* Only show sector tabs if NO specific sector is locked */}
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
                                
                                {validationMode !== 'OFFLINE' && !onlineApiEndpoints[0]?.eventId && (
                                     <div className="bg-red-600/20 border border-red-500 p-2 rounded text-center text-sm text-red-200">
                                        ⚠️ ID do Evento não configurado. Validação Online falhará.
                                     </div>
                                )}

                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border-4 border-gray-700 shadow-xl">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} />}
                                    
                                    {isCameraActive ? (
                                        <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-gray-400">
                                            <VideoCameraIcon className="w-16 h-16 mb-4 text-gray-600" />
                                            <p className="text-lg font-semibold">Câmera em repouso</p>
                                            <p className="text-sm mb-6">Toque abaixo para reativar</p>
                                            <button 
                                                onClick={resetInactivityTimer}
                                                className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform transform active:scale-95"
                                            >
                                                Ativar Câmera
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {!isCameraActive && (
                                     <p className="text-center text-xs text-gray-500 mt-2">Modo economia de energia ativo</p>
                                )}

                                {/* Manual Input */}
                                <div className="mt-4 bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700">
                                    <p className="text-sm text-gray-400 mb-2 font-bold">Problemas com a câmera?</p>
                                    <div className="flex space-x-2">
                                        <input
                                            type="text"
                                            value={manualCode}
                                            onChange={(e) => setManualCode(e.target.value)}
                                            placeholder="Digite o código do ingresso..."
                                            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors"
                                            onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                                        />
                                        <button
                                            onClick={handleManualSubmit}
                                            className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg border border-gray-600 transition-colors"
                                        >
                                            Validar
                                        </button>
                                    </div>
                                </div>
                            </div>

                             <div className="space-y-6">
                                 {/* Pass only local device history to the TicketList */}
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
                            scanHistory={scanHistory} // Admin sees ALL history
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
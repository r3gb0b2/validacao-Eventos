
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
import TicketList from './components/TicketList';
import PublicStatsView from './components/PublicStatsView';
import LoginModal from './components/LoginModal';
import { CogIcon, QrCodeIcon, VideoCameraIcon, LogoutIcon } from './components/Icons';

import { Ticket, ScanStatus, DisplayableScanLog, SectorFilter, Event, User } from './types';

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
    
    // Data State
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [scanHistory, setScanHistory] = useState<DisplayableScanLog[]>([]);
    const [sectorNames, setSectorNames] = useState<string[]>(['Pista', 'VIP']);
    const [hiddenSectors, setHiddenSectors] = useState<string[]>([]); // New state for hidden sectors
    
    // Auth State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);

    // View State
    const [selectedSector, setSelectedSector] = useState<SectorFilter>('All');
    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats'>('scanner');
    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string } | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [ticketsLoaded, setTicketsLoaded] = useState(false); 
    const [isCheckingUrl, setIsCheckingUrl] = useState(true); 
    const [manualCode, setManualCode] = useState(''); 
    
    // Sector Selection & Operator Flow
    const [isOperatorStep, setIsOperatorStep] = useState(false); 
    const [isSectorSelectionStep, setIsSectorSelectionStep] = useState(false); 
    const [lockedSector, setLockedSector] = useState<string | null>(null);
    const [activeSectors, setActiveSectors] = useState<string[]>([]);
    const [operatorName, setOperatorName] = useState(() => localStorage.getItem('operatorName') || '');

    // Inactivity Timer
    const [isCameraActive, setIsCameraActive] = useState(true);
    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Online Validation Config
    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');
    const [onlineApiEndpoints, setOnlineApiEndpoints] = useState<{ url: string, token: string, eventId: string }[]>([{ url: '', token: '', eventId: '' }]);
    const [onlineSheetUrl, setOnlineSheetUrl] = useState('');

    const cooldownRef = useRef<boolean>(false);
    const lastCodeRef = useRef<string | null>(null);
    const lastCodeTimeRef = useRef<number>(0);
    const selectedSectorRef = useRef<SectorFilter>('All');
    
    useEffect(() => {
        selectedSectorRef.current = selectedSector;
    }, [selectedSector]);

    const deviceId = useMemo(() => getDeviceId(), []);

    const ticketsMap = useMemo(() => {
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    // Derived state for visible sectors (UI only)
    const visibleSectors = useMemo(() => {
        return sectorNames.filter(s => !hiddenSectors.includes(s));
    }, [sectorNames, hiddenSectors]);

    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        if (!isCameraActive) setIsCameraActive(true);
        inactivityTimerRef.current = setTimeout(() => setIsCameraActive(false), 60000);
    }, [isCameraActive]);

    // Initial Database Connection & Super Admin Bootstrap
    useEffect(() => {
        getDb()
            .then(async database => {
                setDb(database);
                setFirebaseStatus('success');
                
                // BOOTSTRAP SUPER ADMIN (Force check/create)
                try {
                    const adminQuery = query(collection(database, 'users'), where('username', '==', 'admin'));
                    const adminSnap = await getDocs(adminQuery);

                    if (adminSnap.empty) {
                        await addDoc(collection(database, 'users'), {
                            username: 'admin',
                            password: 'admin',
                            role: 'SUPER_ADMIN',
                            allowedEvents: []
                        });
                        console.log("Bootstrap: Super Admin created (admin/admin)");
                    } else {
                        // Safety Check: If admin exists but has wrong password/role, reset it
                        const adminDocRef = adminSnap.docs[0];
                        const adminData = adminDocRef.data();
                        if (adminData.password !== 'admin' || adminData.role !== 'SUPER_ADMIN') {
                            await updateDoc(doc(database, 'users', adminDocRef.id), {
                                password: 'admin',
                                role: 'SUPER_ADMIN'
                            });
                            console.log("Bootstrap: Admin credentials reset to default (admin/admin)");
                        }
                    }
                } catch (e) {
                    console.error("Auth Bootstrap failed", e);
                }

                // Restore Session from LocalStorage
                const storedUser = localStorage.getItem('auth_user_session');
                if (storedUser) {
                    try {
                        const userObj = JSON.parse(storedUser);
                        // Check expiration
                        if (userObj && userObj._expiry > Date.now()) {
                             setCurrentUser(userObj);
                             console.log("Session restored", userObj.username);
                        } else {
                            localStorage.removeItem('auth_user_session');
                        }
                    } catch (e) {}
                }

            })
            .catch(error => {
                console.error("Failed to initialize database:", error);
                setFirebaseStatus('error');
            });
    }, []);

    // URL Check (Public Stats)
    useEffect(() => {
        const checkUrlParams = async () => {
            if (!db) return;
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const eventIdParam = params.get('eventId');
            
            if (mode === 'stats' && eventIdParam) {
                setTicketsLoaded(false); 
                try {
                    const eventDoc = await getDoc(doc(db, 'events', eventIdParam));
                    if (eventDoc.exists()) {
                        setSelectedEvent({ id: eventDoc.id, name: eventDoc.data().name, isHidden: eventDoc.data().isHidden });
                        setView('public_stats');
                        setIsSectorSelectionStep(false);
                        setIsOperatorStep(false);
                    }
                } catch (e) { console.error("Error fetching event from URL", e); }
            }
            setIsCheckingUrl(false);
        };
        if (db && firebaseStatus === 'success') checkUrlParams();
    }, [db, firebaseStatus]);

    // Restore Operator State on Refresh
    useEffect(() => {
        if (selectedEvent && view === 'scanner') {
            const savedFlow = localStorage.getItem('flow_step');
            
            if (savedFlow === 'SCANNING') {
                const savedSectors = localStorage.getItem('active_sectors');
                const savedLocked = localStorage.getItem('locked_sector');
                
                if (savedSectors) {
                    try {
                        const parsedSectors = JSON.parse(savedSectors);
                        setActiveSectors(parsedSectors);
                    } catch (e) {}
                }
                
                if (savedLocked) {
                    setLockedSector(savedLocked === 'null' ? null : savedLocked);
                    // Also restore selectedSector if locked is set
                    if (savedLocked === 'Multiple' || (savedLocked !== 'null' && savedLocked)) {
                         setSelectedSector('All');
                    }
                }

                setIsOperatorStep(false);
                setIsSectorSelectionStep(false);
            } else if (savedFlow === 'SECTOR_SELECT') {
                setIsOperatorStep(false);
                setIsSectorSelectionStep(true);
            }
        }
    }, [selectedEvent, view]);


    // Fetch Events
    useEffect(() => {
        if (!db || view === 'public_stats') return;

        const eventsUnsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
            const eventsData = snapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name,
                isHidden: doc.data().isHidden ?? false,
            }));
            setEvents(eventsData);
            
            if (selectedEvent && !eventsData.some(e => e.id === selectedEvent.id)) {
                // If the selected event was deleted or lost access
                // BUT we verify persistence before nullifying to allow refresh
                const storedId = localStorage.getItem('selectedEventId');
                if (!storedId || storedId !== selectedEvent.id) {
                     setSelectedEvent(null);
                     localStorage.removeItem('selectedEventId');
                }
            } else if (!selectedEvent) {
                // Try restore from LocalStorage on load
                const storedId = localStorage.getItem('selectedEventId');
                if (storedId) {
                    const ev = eventsData.find(e => e.id === storedId);
                    if (ev) {
                        setSelectedEvent(ev);
                        // Default to operator step if no specific flow saved
                        if (!localStorage.getItem('flow_step')) {
                             setIsOperatorStep(true);
                        }
                    }
                }
            }
        });
        return () => eventsUnsubscribe();
    }, [db, selectedEvent, view]);

    // Fetch Selected Event Data
    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setSectorNames(['Pista', 'VIP']);
            setHiddenSectors([]);
            setValidationMode('OFFLINE');
            setTicketsLoaded(false);
            return;
        };

        const eventId = selectedEvent.id;
        setTicketsLoaded(false);

        const settingsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'settings'), (snapshot) => {
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (docSnap.id === 'main') {
                    if (data.sectorNames?.length > 0) setSectorNames(data.sectorNames);
                    else setSectorNames(['Pista', 'VIP']);
                    
                    // Load hidden sectors
                    if (data.hiddenSectors && Array.isArray(data.hiddenSectors)) {
                        setHiddenSectors(data.hiddenSectors);
                    } else {
                        setHiddenSectors([]);
                    }

                } else if (docSnap.id === 'validation') {
                    if (data.mode) setValidationMode(data.mode);
                    if (data.apiEndpoints) setOnlineApiEndpoints(data.apiEndpoints);
                    else if (data.apiUrl) setOnlineApiEndpoints([{ url: data.apiUrl, token: data.apiToken || '', eventId: data.apiEventId || '' }]);
                    if (data.sheetUrl) setOnlineSheetUrl(data.sheetUrl);
                }
            });
        }, (error) => {
            console.error("Settings snapshot error:", error);
        });

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
                        originalId: data.details.originalId
                    } : undefined,
                };
                if (data.usedAt instanceof Timestamp) ticket.usedAt = data.usedAt.toMillis();
                else if (typeof data.usedAt === 'number') ticket.usedAt = data.usedAt;
                return ticket;
            });
            setAllTickets(ticketsData);
            setTicketsLoaded(true);
        }, (error) => {
            console.error("Tickets snapshot error:", error);
            // Ensure we stop loading state even on error so UI doesn't hang
            setTicketsLoaded(true);
        });

        const scansQuery = query(collection(db, 'events', eventId, 'scans'), orderBy('timestamp', 'desc'), limit(100));
        const scansUnsubscribe = onSnapshot(scansQuery, (snapshot) => {
            const historyData = snapshot.docs.map(doc => {
                const data = doc.data();
                let timestamp = Date.now();
                
                // Robust timestamp parsing
                try {
                    if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
                        timestamp = data.timestamp.toMillis();
                    } else if (typeof data.timestamp === 'number') {
                        timestamp = data.timestamp;
                    } else if (typeof data.timestamp === 'string') {
                        const parsed = Date.parse(data.timestamp);
                        if (!isNaN(parsed)) timestamp = parsed;
                    }
                } catch (e) { console.error("Error parsing scan timestamp", e); }

                return {
                    id: doc.id,
                    ticketId: data.ticketId,
                    status: data.status,
                    timestamp: timestamp,
                    ticketSector: data.sector ?? 'Desconhecido',
                    isPending: doc.metadata.hasPendingWrites,
                    deviceId: data.deviceId,
                    operator: data.operator
                };
            });
            setScanHistory(historyData);
        }, (error) => {
            console.error("Scans snapshot error:", error);
        });

        // Safety timer: If data takes too long (e.g. 15s), force loading to true to show what we have
        const safetyTimer = setTimeout(() => {
            setTicketsLoaded(prev => {
                if (!prev) console.warn("Forcing tickets loaded state due to timeout.");
                return true;
            });
        }, 15000);

        return () => {
            clearTimeout(safetyTimer);
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
        resetInactivityTimer();
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

    // --- AUTH FUNCTIONS ---

    const handleLogin = async (username: string, pass: string) => {
        if (!db) return;
        setIsAuthLoading(true);
        try {
            // Hardcoded Master Passwords for quick roles
            let hardcodedUser: User | null = null;
            
            if (pass === '123654') {
                hardcodedUser = { id: 'admin_master', username: 'Administrador', role: 'ADMIN', allowedEvents: [] };
            } else if (pass === '987654') {
                hardcodedUser = { id: 'super_admin_master', username: 'Super Admin', role: 'SUPER_ADMIN', allowedEvents: [] };
            }

            if (hardcodedUser) {
                 const expiry = Date.now() + (24 * 60 * 60 * 1000);
                 const sessionObj = { ...hardcodedUser, _expiry: expiry };
                 localStorage.setItem('auth_user_session', JSON.stringify(sessionObj));
                 setCurrentUser(hardcodedUser);
                 setShowLoginModal(false);
                 setView('admin');
                 setIsAuthLoading(false);
                 return;
            }

            // Fallback to Database Users
            const snap = await getDocs(collection(db, 'users'));
            const normalizedInputName = username.trim().toLowerCase();
            let foundUser: User | null = null;
            
            snap.forEach(doc => {
                const data = doc.data();
                if ((data.username || '').toLowerCase() === normalizedInputName) {
                    if (data.password === pass) { 
                        foundUser = { id: doc.id, ...data } as User;
                    }
                }
            });

            if (foundUser) {
                const user = foundUser as User;
                const expiry = Date.now() + (24 * 60 * 60 * 1000);
                const sessionObj = { ...user, _expiry: expiry };
                localStorage.setItem('auth_user_session', JSON.stringify(sessionObj));
                setCurrentUser(user);
                setShowLoginModal(false);
                
                setView('admin');
                
                if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && selectedEvent) {
                    if (!user.allowedEvents.includes(selectedEvent.id)) {
                        setSelectedEvent(null);
                    }
                }
            } else {
                alert("Usuário ou senha incorretos.");
            }
        } catch (e) {
            console.error(e);
            alert("Erro no login.");
        } finally {
            setIsAuthLoading(false);
        }
    };

    const handleLogout = () => {
        setCurrentUser(null);
        localStorage.removeItem('auth_user_session');
        setSelectedEvent(null);
        setView('scanner');
        setIsOperatorStep(false);
        setIsSectorSelectionStep(false);
        setLockedSector(null);
        setActiveSectors([]);
        localStorage.removeItem('selectedEventId');
        // Clear flow state
        localStorage.removeItem('flow_step');
        localStorage.removeItem('active_sectors');
        localStorage.removeItem('locked_sector');
    };

    const handleAdminRequest = () => {
        if (currentUser) {
            setView('admin');
        } else {
            setShowLoginModal(true);
        }
    };
    
    // Filter events for the logged in user
    const getAllowedEvents = () => {
        if (!currentUser) return events; 
        if (currentUser.role === 'SUPER_ADMIN' || (currentUser.role === 'ADMIN' && currentUser.username === 'Administrador')) return events; // Allow master admin
        return events.filter(e => currentUser.allowedEvents.includes(e.id));
    };

    const handleUpdateCurrentUser = (updatedData: Partial<User>) => {
        if (currentUser) {
            const newUser = { ...currentUser, ...updatedData };
            setCurrentUser(newUser);
            // Update storage if using master session or db session
            const stored = localStorage.getItem('auth_user_session');
            if (stored) {
                const parsed = JSON.parse(stored);
                localStorage.setItem('auth_user_session', JSON.stringify({ ...parsed, ...updatedData }));
            }
        }
    };

    // --- NAVIGATION ---

    const handleSelectEvent = (event: Event) => {
        setSelectedEvent(event);
        setIsOperatorStep(true);
        setLockedSector(null);
        setActiveSectors([]);
        localStorage.setItem('selectedEventId', event.id);
        // Clear old flow state on new event selection
        localStorage.removeItem('flow_step');
        localStorage.removeItem('active_sectors');
        localStorage.removeItem('locked_sector');
    };

    const handleAdminSelectEvent = (event: Event) => {
        setSelectedEvent(event);
        setView('admin');
        localStorage.setItem('selectedEventId', event.id);
    };

    const handleOperatorConfirm = () => {
        if (!operatorName.trim()) return alert("Por favor, digite o nome do operador.");
        localStorage.setItem('operatorName', operatorName);
        setIsOperatorStep(false);
        setIsSectorSelectionStep(true);
        // Persist flow step
        localStorage.setItem('flow_step', 'SECTOR_SELECT');
    };

    const handleBackToEvents = () => {
        // If in Admin mode, we just clear selection but stay in admin (handled by AdminView logic usually, but here for safety)
        if (view === 'admin') {
             setSelectedEvent(null);
             localStorage.removeItem('selectedEventId');
             return;
        }

        setSelectedEvent(null);
        setView('scanner');
        setLockedSector(null);
        setActiveSectors([]);
        setIsSectorSelectionStep(false);
        setIsOperatorStep(false);
        localStorage.removeItem('selectedEventId');
        // Clear flow state
        localStorage.removeItem('flow_step');
        localStorage.removeItem('active_sectors');
        localStorage.removeItem('locked_sector');
    };

    const handleToggleSectorSelection = (sector: string) => {
        if (activeSectors.includes(sector)) setActiveSectors(activeSectors.filter(s => s !== sector));
        else setActiveSectors([...activeSectors, sector]);
    };

    const handleConfirmSectorSelection = () => {
        const newLocked = activeSectors.length > 0 ? 'Multiple' : null;
        
        if (activeSectors.length > 0) {
            setLockedSector('Multiple');
            setSelectedSector('All');
        } else {
            setLockedSector(null);
            setSelectedSector('All');
        }
        setIsSectorSelectionStep(false);

        // Persist state
        localStorage.setItem('flow_step', 'SCANNING');
        localStorage.setItem('active_sectors', JSON.stringify(activeSectors));
        localStorage.setItem('locked_sector', newLocked || 'null');
    };

    const handleUpdateSectorNames = async (newNames: string[], newHiddenSectors?: string[]) => {
        if (!db || !selectedEvent) return;
        const payload: any = { sectorNames: newNames };
        if (newHiddenSectors) payload.hiddenSectors = newHiddenSectors;
        
        await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), payload, { merge: true });
    };
    
    const showScanResult = (status: ScanStatus, message: string) => {
        setScanResult({ status, message });
        setTimeout(() => setScanResult(null), 3000);
        resetInactivityTimer();
    };

    // --- SCAN LOGIC ---
    const handleScanSuccess = useCallback(async (decodedText: string) => {
        const now = Date.now();
        // 1. Global cooldown check (400ms) - User requested shorter delay
        if (cooldownRef.current || !db || !selectedEvent) return;

        // 2. Duplicate Check: If scanning the exact same code, wait 3 seconds before allowing it again
        // This prevents the "machine gun" effect while allowing fast scanning of different tickets
        if (lastCodeRef.current === decodedText.trim()) {
            if (now - lastCodeTimeRef.current < 3000) {
                return;
            }
        }
        
        // Update trackers
        lastCodeRef.current = decodedText.trim();
        lastCodeTimeRef.current = now;
        
        resetInactivityTimer();
        const currentSelectedSector = selectedSectorRef.current;

        cooldownRef.current = true;
        // Reduced to 400ms per user request
        setTimeout(() => { cooldownRef.current = false; }, 400); 
        
        const eventId = selectedEvent.id;
        
        // --- ONLINE VALIDATION ---
        if (validationMode !== 'OFFLINE') {
            if (validationMode === 'ONLINE_API') {
                 const endpoints = onlineApiEndpoints.filter(ep => ep.url);
                if (endpoints.length === 0) {
                    showScanResult('ERROR', 'Nenhuma API configurada.');
                    return;
                }
                showScanResult('VALID', 'Validando online...');
                let codeToValidate = decodedText.trim();
                let urlCode = '';
                try {
                    if (codeToValidate.startsWith('http')) {
                        const urlObj = new URL(codeToValidate);
                        const segments = urlObj.pathname.split('/');
                        urlCode = segments[segments.length - 1]; 
                        if (urlObj.searchParams.get('code')) urlCode = urlObj.searchParams.get('code')!;
                        if (urlObj.searchParams.get('id')) urlCode = urlObj.searchParams.get('id')!;
                    }
                } catch (e) {}
                const codesToSend = [];
                if (urlCode && urlCode !== codeToValidate) codesToSend.push(urlCode);
                codesToSend.push(codeToValidate);

                for (const endpoint of endpoints) {
                    try {
                        let response = null;
                        let foundCode = '';
                        const numericEventId = parseInt(endpoint.eventId || '0', 10);
                        if (!numericEventId) { showScanResult('ERROR', 'ID Evento inválido.'); return; }
                        
                        let apiBase = endpoint.url.trim();
                        if (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1);
                        apiBase = apiBase.replace(/\/tickets(\/.*)?$/, '').replace(/\/checkins(\/.*)?$/, '').replace(/\/participants(\/.*)?$/, ''); 
                        
                        const checkinUrl = `${apiBase}/checkins`;

                        // Helper for Response Handling
                        const processResponse = async (res: Response, code: string) => {
                            if (res.status === 404 || res.status === 405) return null;
                            const data = await res.json();
                            
                            // Logically failed (e.g. invalid status) but HTTP OK
                            if (res.ok && (data.success === false || data.error === true)) {
                                if (data.message && (data.message.toLowerCase().includes('used') || data.message.toLowerCase().includes('utilizado'))) {
                                    return { status: 'USED' as ScanStatus, message: 'Ingresso já utilizado!', sector: 'Externo', raw: data };
                                }
                                if (data.message && (data.message.toLowerCase().includes('not found') || data.message.includes('não encontrado'))) return null;
                                return { status: 'INVALID' as ScanStatus, message: data.message || 'Erro na validação', sector: 'Externo', raw: data };
                            }
                            
                            if (res.ok || res.status === 201) {
                                const sector = (data.sector_name || data.sector || data.category || 'Externo').trim();
                                return { status: 'VALID' as ScanStatus, message: `Acesso Liberado! - ${sector}`, sector: sector, raw: data };
                            }
                            
                            if (res.status === 409 || res.status === 422) {
                                return { status: 'USED' as ScanStatus, message: 'Ingresso já utilizado!', sector: 'Externo', raw: data };
                            }

                            return null;
                        };

                        // --------------------------------------------------------------------------------
                        // STEP 1: PARTICIPANT LOOKUP (DEFAULT)
                        // Consult /participants to resolve access_code/qr_code to a numeric Ticket ID
                        // --------------------------------------------------------------------------------
                        let resolvedId: string | null = null;
                        
                        for (const code of codesToSend) {
                            const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${endpoint.token}` };
                            try {
                                const searchUrl = `${apiBase}/participants?event_id=${numericEventId}&search=${code}`;
                                const lookupRes = await fetch(searchUrl, { headers });
                                
                                if (lookupRes.ok) {
                                    const lookupData = await lookupRes.json();
                                    
                                    // RECURSIVE DEEP SEARCH to find ID
                                    const findIdRecursive = (obj: any, targetCode: string, depth = 0): string | null => {
                                        if (!obj || typeof obj !== 'object' || depth > 5) return null;
                                        const c = targetCode.trim().toLowerCase();
                                        
                                        // Priority on 'access_code'
                                        if (obj.access_code && String(obj.access_code).trim().toLowerCase() === c) return obj.id || null;
                                        
                                        // Check other fields
                                        if ((obj.code && String(obj.code).trim().toLowerCase() === c) ||
                                            (obj.qr_code && String(obj.qr_code).trim().toLowerCase() === c) ||
                                            (obj.ticket_code && String(obj.ticket_code).trim().toLowerCase() === c)) {
                                                return obj.id || obj.ticket_id || obj.pk || null;
                                        }

                                        // Dig into children
                                        if (Array.isArray(obj)) {
                                            for (const item of obj) {
                                                const res = findIdRecursive(item, targetCode, depth + 1);
                                                if (res) return res;
                                            }
                                        } else {
                                            const keysToCheck = ['tickets', 'data', 'participants', 'items', 'ticket'];
                                            for (const key of keysToCheck) {
                                                if (obj[key]) {
                                                    const res = findIdRecursive(obj[key], targetCode, depth + 1);
                                                    if (res) return res;
                                                }
                                            }
                                            for (const k in obj) {
                                                if (typeof obj[k] === 'object' && obj[k] !== null && !keysToCheck.includes(k)) {
                                                        const res = findIdRecursive(obj[k], targetCode, depth + 1);
                                                        if (res) return res;
                                                }
                                            }
                                        }
                                        return null;
                                    };

                                    resolvedId = findIdRecursive(lookupData, code);
                                    if (resolvedId) {
                                        foundCode = code; // Keep original code for display/log
                                        break; // Found it, proceed to check-in
                                    }
                                }
                            } catch(e) { console.error("Lookup error", e); }
                        }

                        // --------------------------------------------------------------------------------
                        // STEP 2: CHECK-IN
                        // Use resolved ID if found, otherwise fall back to original code
                        // --------------------------------------------------------------------------------
                        
                        const idToCheckIn = resolvedId || codesToSend[0];
                        const headers = { 'Accept': 'application/json', 'Authorization': `Bearer ${endpoint.token}` };

                        // Strategy A: JSON Body (Preferred)
                        try {
                            const payload = { 
                                event_id: numericEventId, 
                                qr_code: idToCheckIn, 
                                code: idToCheckIn, 
                                ticket_id: idToCheckIn 
                            };
                            
                            // If we resolved an ID, try path strategy first as it's often stricter on ID
                            if (resolvedId) {
                                const res = await fetch(`${checkinUrl}/${resolvedId}?event_id=${numericEventId}`, {
                                    method: 'POST',
                                    headers: { ...headers, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                                const result = await processResponse(res, idToCheckIn);
                                if (result) { response = result; foundCode = foundCode || idToCheckIn; }
                            }

                            if (!response) {
                                const res = await fetch(checkinUrl, {
                                    method: 'POST',
                                    headers: { ...headers, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                                const result = await processResponse(res, idToCheckIn);
                                if (result) { response = result; foundCode = foundCode || idToCheckIn; }
                            }
                        } catch(e) {}

                        if (response) {
                            const { status, message, sector } = response;
                            
                            // Sector Validation
                            const sectorLower = sector.toLowerCase();
                            const currentTabLower = currentSelectedSector.toLowerCase();
                            if (activeSectors.length > 0) {
                                if (!activeSectors.some(s => s.trim().toLowerCase() === sectorLower)) {
                                     showScanResult('WRONG_SECTOR', `Setor incorreto! Ingresso é: "${sector}".`);
                                     await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId: foundCode, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector, deviceId, operator: operatorName });
                                    return;
                                }
                            }
                            if (currentSelectedSector !== 'All' && sectorLower !== currentTabLower) {
                                showScanResult('WRONG_SECTOR', `Setor Incorreto! (Filtro: ${currentSelectedSector}). Ingresso: ${sector}`);
                                await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId: foundCode, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector, deviceId, operator: operatorName });
                                return;
                            }
                            
                            showScanResult(status, message);
                            await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId: foundCode, status, timestamp: serverTimestamp(), sector, deviceId, operator: operatorName });
                            return;
                        }

                    } catch (error) { console.error("API error", error); }
                }
                showScanResult('INVALID', 'Não encontrado em nenhuma API.');
                await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId: decodedText, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Externo', deviceId, operator: operatorName });
                return;
            }
        }

        // --- OFFLINE VALIDATION ---
        const ticketId = decodedText.trim();
        const ticket = ticketsMap.get(ticketId);
        
        if (!ticket) {
            showScanResult('INVALID', `Ingresso não encontrado: ${ticketId}`);
            await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Desconhecido', deviceId, operator: operatorName });
            return;
        }
        const ticketSectorLower = ticket.sector.trim().toLowerCase();
        if (activeSectors.length > 0) {
            if (!activeSectors.some(s => s.trim().toLowerCase() === ticketSectorLower)) {
                showScanResult('WRONG_SECTOR', `Setor incorreto! Ingresso é: "${ticket.sector}".`);
                await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
                return;
            }
        }
        const currentTabLower = currentSelectedSector.toLowerCase();
        if (currentSelectedSector !== 'All' && ticketSectorLower !== currentTabLower) {
             showScanResult('WRONG_SECTOR', `Setor incorreto! Filtro: "${currentSelectedSector}". Ingresso: "${ticket.sector}".`);
             await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
             return;
        }

        if (ticket.status === 'USED') {
            const usedAtDate = ticket.usedAt ? new Date(ticket.usedAt) : null;
            showScanResult('USED', `Ingresso já utilizado${usedAtDate ? ` em ${usedAtDate.toLocaleString('pt-BR')}` : ''}`);
            await addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'USED', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'events', eventId, 'tickets', ticketId), { status: 'USED', usedAt: serverTimestamp() });
            batch.set(doc(collection(db, 'events', eventId, 'scans')), { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            await batch.commit();
            showScanResult('VALID', `Acesso liberado para ${ticket.sector}!`);
        } catch (error) { showScanResult('ERROR', 'Falha ao atualizar BD.'); }

    }, [db, selectedEvent, ticketsMap, validationMode, onlineApiEndpoints, activeSectors, deviceId, operatorName]);

    const handleManualSubmit = () => {
        if (!manualCode.trim()) return;
        handleScanSuccess(manualCode);
        setManualCode('');
    };

    // --- RENDER ---

    if (!db || firebaseStatus === 'loading' || isCheckingUrl) {
        return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white text-2xl animate-pulse">Carregando...</div>;
    }

    if (firebaseStatus === 'error') return <SetupInstructions />;

    if (view === 'public_stats' && selectedEvent) {
        return <PublicStatsView event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} isLoading={!ticketsLoaded} />;
    }
    
    // LOGIN MODAL
    if (showLoginModal) {
        return <LoginModal onLogin={handleLogin} onCancel={() => setShowLoginModal(false)} isLoading={isAuthLoading} />;
    }

    if (!selectedEvent && view !== 'admin') {
        return (
            <div className="relative">
                <EventSelector events={events.filter(e => !e.isHidden)} onSelectEvent={handleSelectEvent} onAccessAdmin={handleAdminRequest} />
                {currentUser && (
                     <div className="fixed top-4 right-4 z-50 bg-gray-800 p-2 rounded-lg flex items-center shadow-xl border border-gray-700">
                        <div className="mr-3 text-right hidden md:block">
                            <p className="text-xs text-gray-400">Logado como</p>
                            <p className="text-sm font-bold text-orange-500">{currentUser.username}</p>
                        </div>
                        <button onClick={handleLogout} className="bg-red-600 hover:bg-red-700 p-2 rounded text-white" title="Sair">
                            <LogoutIcon className="w-5 h-5" />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // OPERATOR & SECTOR STEPS [SAME AS BEFORE]
    if (selectedEvent && view === 'scanner' && isOperatorStep) {
        return (
             <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-6 text-orange-500">{selectedEvent.name}</h2>
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-2">Identificação</h3>
                        <input type="text" value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="Nome do Operador / Portaria" className="w-full bg-gray-700 p-4 rounded text-white border border-gray-600 focus:border-orange-500 text-lg" />
                    </div>
                    <button onClick={handleOperatorConfirm} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg text-lg">Continuar</button>
                    <div className="mt-8 text-center"><button onClick={handleBackToEvents} className="text-gray-400 underline">Voltar</button></div>
                </div>
            </div>
        );
    }

    if (selectedEvent && view === 'scanner' && isSectorSelectionStep) {
         return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
                <div className="w-full max-w-lg bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                    <h2 className="text-2xl font-bold text-center mb-2 text-orange-500">{selectedEvent.name}</h2>
                    <p className="text-center text-gray-400 text-sm mb-6">Op: <b>{operatorName}</b></p>
                    <button onClick={() => { setActiveSectors([]); handleConfirmSectorSelection(); }} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg text-lg mb-6">Validar Todos (Geral)</button>
                    <p className="text-center text-gray-500 mb-4 text-xs">OU SELECIONE:</p>
                    <div className="grid grid-cols-2 gap-4">
                        {visibleSectors.map(sector => (
                            <button key={sector} onClick={() => handleToggleSectorSelection(sector)} className={`font-semibold py-3 rounded-lg border ${activeSectors.includes(sector) ? 'bg-orange-500 text-white border-orange-400' : 'bg-gray-700 text-white border-gray-600'}`}>{sector}</button>
                        ))}
                    </div>
                    {activeSectors.length > 0 && (
                        <div className="mt-6"><button onClick={handleConfirmSectorSelection} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg">Confirmar {activeSectors.length} Setores</button></div>
                    )}
                    <div className="mt-8 text-center flex justify-between px-4">
                         <button onClick={() => { setIsSectorSelectionStep(false); setIsOperatorStep(true); }} className="text-gray-400 underline">&larr; Voltar</button>
                        <button onClick={handleBackToEvents} className="text-gray-400 underline">Trocar Evento</button>
                    </div>
                </div>
            </div>
        );
    }

    const TABS: SectorFilter[] = ['All', ...visibleSectors];
    const myScans = scanHistory.filter(s => s.deviceId === deviceId);
    const displayHistory = (lockedSector && activeSectors.length > 0)
        ? myScans.filter(s => activeSectors.includes(s.ticketSector) || s.status === 'INVALID' || s.status === 'WRONG_SECTOR')
        : myScans;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Offline. Validações salvas localmente." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    {selectedEvent ? (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">{selectedEvent.name}</h1>
                             <div className="flex flex-col md:flex-row md:items-center space-y-1 md:space-y-0 md:space-x-2">
                                <span className="text-xs text-gray-400">{validationMode === 'OFFLINE' ? 'Modo Offline' : 'Modo Online'}</span>
                                {lockedSector && activeSectors.length > 0 ? (
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm font-semibold bg-gray-800 px-2 py-1 rounded text-orange-300 border border-orange-500/30">Validando: {activeSectors.join(', ')}</span>
                                        <button onClick={() => setIsSectorSelectionStep(true)} className="text-xs text-gray-400 hover:text-white underline">Alterar</button>
                                    </div>
                                ) : (
                                    <button onClick={handleBackToEvents} className="text-sm text-orange-400 hover:underline">Trocar Evento</button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <h1 className="text-3xl font-bold text-orange-500">Painel Administrativo</h1>
                            <p className="text-sm text-gray-400">Bem-vindo, {currentUser?.username}</p>
                        </div>
                    )}
                    <div className="flex items-center space-x-2">
                         {selectedEvent && (
                             <button onClick={() => setView('scanner')} className={`p-2 rounded-full transition-colors ${view === 'scanner' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`}><QrCodeIcon className="w-6 h-6" /></button>
                         )}
                         <button onClick={handleAdminRequest} className={`p-2 rounded-full transition-colors ${view === 'admin' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`}><CogIcon className="w-6 h-6" /></button>
                         {currentUser && (
                            <button onClick={handleLogout} className="p-2 rounded-full bg-red-600 hover:bg-red-700 ml-2" title="Sair"><LogoutIcon className="w-6 h-6" /></button>
                         )}
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
                                                <button key={sector} onClick={() => setSelectedSector(sector)} className={`flex-shrink-0 py-2 px-3 text-sm font-bold rounded-md whitespace-nowrap ${selectedSector === sector ? 'bg-orange-600 text-white' : 'bg-gray-700'}`}>{sector === 'All' ? 'Todos' : sector}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border-4 border-gray-700 shadow-xl">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} />}
                                    {isCameraActive ? (
                                        <Scanner onScanSuccess={handleScanSuccess} onScanError={() => {}} />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-gray-400">
                                            <VideoCameraIcon className="w-16 h-16 mb-4 text-gray-600" />
                                            <p className="text-lg font-semibold">Câmera em repouso</p>
                                            <button onClick={resetInactivityTimer} className="bg-orange-600 text-white font-bold py-3 px-8 rounded-full mt-4">Ativar</button>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-4 bg-gray-800 p-4 rounded-lg flex space-x-2">
                                    <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Digite código..." className="flex-1 bg-gray-900 border border-gray-600 rounded px-4 py-3 text-white" />
                                    <button onClick={handleManualSubmit} className="bg-gray-700 text-white font-bold py-3 px-6 rounded border border-gray-600">Validar</button>
                                </div>
                            </div>
                            <div className="space-y-6">
                                 <TicketList tickets={displayHistory} sectorNames={visibleSectors} hideTabs={!!lockedSector} />
                             </div>
                        </div>
                    ) : (
                        <AdminView 
                            db={db}
                            events={getAllowedEvents()}
                            selectedEvent={selectedEvent}
                            allTickets={allTickets}
                            scanHistory={scanHistory}
                            sectorNames={sectorNames}
                            hiddenSectors={hiddenSectors}
                            onUpdateSectorNames={handleUpdateSectorNames}
                            isOnline={isOnline}
                            onSelectEvent={handleAdminSelectEvent}
                            currentUser={currentUser}
                            onUpdateCurrentUser={handleUpdateCurrentUser}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;

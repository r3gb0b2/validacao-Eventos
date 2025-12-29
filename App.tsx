
// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDocs, where, getDoc } from 'firebase/firestore';
import Papa from 'papaparse';

import Scanner from './components/Scanner';
import StatusDisplay from './components/StatusDisplay';
import AdminView from './components/AdminView';
import SetupInstructions from './components/SetupInstructions';
import AlertBanner from './components/AlertBanner';
import EventSelector from './components/EventSelector';
import TicketList from './components/TicketList';
import PublicStatsView from './components/PublicStatsView';
import LoginModal from './components/LoginModal';
import SecretTicketGenerator from './components/SecretTicketGenerator'; 
import OperatorMonitor from './components/OperatorMonitor'; 
import { CogIcon, QrCodeIcon, VideoCameraIcon, LogoutIcon, TicketIcon, LogoSVG } from './components/Icons';
import { useSound } from './hooks/useSound';

import { Ticket, ScanStatus, DisplayableScanLog, SectorFilter, Event, User, ImportSource } from './types';

const getDeviceId = () => {
    try {
        let id = localStorage.getItem('device_id');
        if (!id) {
            id = 'device_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
            localStorage.setItem('device_id', id);
        }
        return id;
    } catch (e) {
        return 'device_fallback_' + Date.now();
    }
};

const App: React.FC = () => {
    const [db, setDb] = useState<Firestore | null>(null);
    const [firebaseStatus, setFirebaseStatus] = useState<'loading' | 'success' | 'error'>('loading');
    
    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [scanHistory, setScanHistory] = useState<DisplayableScanLog[]>([]);
    const [sectorNames, setSectorNames] = useState<string[]>([]); 
    const [hiddenSectors, setHiddenSectors] = useState<string[]>([]); 
    const [importSources, setImportSources] = useState<ImportSource[]>([]);
    
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);

    const [selectedSector, setSelectedSector] = useState<SectorFilter>('All');
    
    // VIEW STATE PERSISTENCE
    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats' | 'generator' | 'operators'>(() => {
        try {
            return (localStorage.getItem('current_view') as any) || 'scanner';
        } catch(e) { return 'scanner'; }
    });

    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string; extra?: string } | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [ticketsLoaded, setTicketsLoaded] = useState(false); 
    const [scansLoaded, setScansLoaded] = useState(false); 
    const [isCheckingUrl, setIsCheckingUrl] = useState(true); 
    const [manualCode, setManualCode] = useState(''); 
    
    const [operatorName, setOperatorName] = useState(() => {
        try { return localStorage.getItem('operatorName') || ''; } catch(e) { return ''; }
    });

    const deviceId = useMemo(() => getDeviceId(), []);
    const playBeep = useSound();
    const cooldownRef = useRef<boolean>(false);
    const lastCodeRef = useRef<string | null>(null);
    const lastCodeTimeRef = useRef<number>(0);
    const autoSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Persist View
    useEffect(() => {
        localStorage.setItem('current_view', view);
    }, [view]);

    const ticketsMap = useMemo(() => {
        if (!Array.isArray(allTickets)) return new Map();
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

    // --- LÓGICA DE FILTRAGEM PARA TICKETS SECRETOS ---
    const filteredAllTickets = useMemo(() => {
        return allTickets.filter(t => t.source !== 'secret_generator');
    }, [allTickets]);

    const filteredScanHistory = useMemo(() => {
        const secretIds = new Set(allTickets.filter(t => t.source === 'secret_generator').map(t => t.id));
        return scanHistory.filter(s => !secretIds.has(s.ticketId));
    }, [scanHistory, allTickets]);

    const visibleSectors = useMemo(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        const hidden = Array.isArray(hiddenSectors) ? hiddenSectors : [];
        return names.filter(s => !hidden.includes(s));
    }, [sectorNames, hiddenSectors]);

    const runExternalSync = async (source: ImportSource, eventId: string) => {
        if (!db || !isOnline) return;
        try {
            const ticketsToSave: any[] = [];
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));

            if (source.type === 'google_sheets') {
                let fetchUrl = (source.url || '').trim();
                if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                const res = await fetch(fetchUrl);
                const csvText = await res.text();
                const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                rows.forEach(row => {
                    const code = String(row['code'] || row['codigo'] || row['id']).trim();
                    if (code && !existingIds.has(code)) {
                        ticketsToSave.push({ id: code, sector: String(row['sector'] || row['setor'] || 'Geral'), status: 'AVAILABLE', details: { ownerName: row['name'] || row['nome'] } });
                    }
                });
            } else {
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if (source.token) headers['Authorization'] = `Bearer ${source.token}`;
                const res = await fetch(source.url, { headers });
                const json = await res.json();
                const items = json.data || json.participants || (Array.isArray(json) ? json : []);
                items.forEach((item: any) => {
                    const code = String(item.access_code || item.code || item.qr_code || item.id).trim();
                    if (code && !existingIds.has(code)) {
                        ticketsToSave.push({ id: code, sector: String(item.sector_name || item.category || 'Geral'), status: 'AVAILABLE', details: { ownerName: item.name } });
                    }
                });
            }

            if (ticketsToSave.length > 0) {
                const batchSize = 450;
                for (let i = 0; i < ticketsToSave.length; i += batchSize) {
                    const chunk = ticketsToSave.slice(i, i + batchSize);
                    const batch = writeBatch(db);
                    chunk.forEach(t => batch.set(doc(db, 'events', eventId, 'tickets', t.id), t, { merge: true }));
                    await batch.commit();
                }
            }
            
            const updatedSources = importSources.map(s => s.id === source.id ? { ...s, lastImportTime: Date.now() } : s);
            await setDoc(doc(db, 'events', eventId, 'settings', 'import_v2'), { sources: updatedSources }, { merge: true });
        } catch (e) { console.error(`Auto-Sync Error:`, e); }
    };

    useEffect(() => {
        if (autoSyncIntervalRef.current) clearInterval(autoSyncIntervalRef.current);
        const sourcesToSync = importSources.filter(s => s.autoImport);
        if (sourcesToSync.length > 0 && selectedEvent && isOnline) {
            autoSyncIntervalRef.current = setInterval(() => {
                sourcesToSync.forEach(s => runExternalSync(s, selectedEvent.id));
            }, 300000); 
        }
        return () => { if (autoSyncIntervalRef.current) clearInterval(autoSyncIntervalRef.current); };
    }, [importSources, selectedEvent, isOnline]);

    useEffect(() => {
        getDb().then(async database => {
            setDb(database);
            setFirebaseStatus('success');
            try {
                const storedUser = localStorage.getItem('auth_user_session');
                if (storedUser) {
                    const userObj = JSON.parse(storedUser);
                    if (userObj && userObj._expiry > Date.now()) setCurrentUser(userObj);
                    else localStorage.removeItem('auth_user_session');
                }
            } catch (e) { console.warn("Session restore failed", e); }
        }).catch(() => setFirebaseStatus('error'));
    }, []);

    useEffect(() => {
        if (!db) return;
        const checkUrlParams = async () => {
            const params = new URLSearchParams(window.location.search);
            const eventIdParam = params.get('eventId');
            const modeParam = params.get('mode');

            if (modeParam === 'stats' && eventIdParam) {
                const docSnap = await getDoc(doc(db, 'events', eventIdParam));
                if (docSnap.exists()) {
                    const ev = { id: docSnap.id, name: docSnap.data().name, isHidden: docSnap.data().isHidden };
                    setSelectedEvent(ev);
                    localStorage.setItem('selected_event_id', ev.id);
                    setView('public_stats');
                }
            } else if (modeParam === 'operators' && eventIdParam) {
                 const docSnap = await getDoc(doc(db, 'events', eventIdParam));
                 if (docSnap.exists()) {
                    const ev = { id: docSnap.id, name: docSnap.data().name, isHidden: docSnap.data().isHidden };
                    setSelectedEvent(ev);
                    localStorage.setItem('selected_event_id', ev.id);
                    setView('operators');
                 }
            } else if (modeParam === 'generator') {
                setView('generator');
            }
            setIsCheckingUrl(false);
        };
        checkUrlParams();
    }, [db]);

    useEffect(() => {
        if (!db || view === 'public_stats' || view === 'operators') return;
        const eventsUnsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
            const eventsData = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name || 'Sem Nome', isHidden: doc.data().isHidden ?? false }));
            setEvents(eventsData);

            const savedEventId = localStorage.getItem('selected_event_id');
            if (savedEventId && !selectedEvent) {
                const found = eventsData.find(e => e.id === savedEventId);
                if (found) setSelectedEvent(found);
            }
        });
        return () => eventsUnsubscribe();
    }, [db, view, selectedEvent]);

    useEffect(() => {
        if (!db || !selectedEvent) {
            setAllTickets([]);
            setScanHistory([]);
            setImportSources([]);
            setSectorNames([]); 
            setTicketsLoaded(false);
            setScansLoaded(false);
            return;
        };

        const eventId = selectedEvent.id;
        setTicketsLoaded(false);
        setScansLoaded(false);

        const settingsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'settings'), (snapshot) => {
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (docSnap.id === 'main') {
                    setSectorNames(Array.isArray(data.sectorNames) ? data.sectorNames : []);
                    setHiddenSectors(Array.isArray(data.hiddenSectors) ? data.hiddenSectors : []);
                } else if (docSnap.id === 'import_v2') {
                    setImportSources(Array.isArray(data.sources) ? data.sources : []);
                }
            });
        });

        const ticketsUnsubscribe = onSnapshot(collection(db, 'events', eventId, 'tickets'), (snapshot) => {
            const ticketsData = snapshot.docs.map(doc => {
                // HABILITA ESTIMATIVA PARA OFFLINE
                const data = doc.data({ serverTimestamps: 'estimate' });
                const ticket: Ticket = { id: doc.id, sector: data.sector || 'Geral', status: data.status || 'AVAILABLE', source: data.source, details: data.details };
                
                if (data.usedAt instanceof Timestamp) ticket.usedAt = data.usedAt.toMillis();
                else if (data.usedAt instanceof Date) ticket.usedAt = data.usedAt.getTime();
                else if (typeof data.usedAt === 'number') ticket.usedAt = data.usedAt;
                
                return ticket;
            });
            setAllTickets(ticketsData);
            setTicketsLoaded(true);
        }, () => setTicketsLoaded(true));

        const scansQuery = query(collection(db, 'events', eventId, 'scans'), orderBy('timestamp', 'desc'), limit(10000));
        const scansUnsubscribe = onSnapshot(scansQuery, (snapshot) => {
            const historyData = snapshot.docs.map(doc => {
                const data = doc.data({ serverTimestamps: 'estimate' });
                let timestamp = Date.now();
                if (data.timestamp?.toMillis) timestamp = data.timestamp.toMillis();
                else if (data.timestamp instanceof Date) timestamp = data.timestamp.getTime();
                else if (typeof data.timestamp === 'number') timestamp = data.timestamp;
                return { 
                    id: doc.id, 
                    ticketId: data.ticketId || '---', 
                    status: data.status || 'ERROR', 
                    timestamp: timestamp, 
                    ticketSector: data.sector ?? 'Desconhecido', 
                    isPending: doc.metadata.hasPendingWrites, 
                    deviceId: data.deviceId, 
                    operator: data.operator 
                };
            });
            setScanHistory(historyData);
            setScansLoaded(true);
        }, (err) => {
            console.error("ERRO FIRESTORE SCANS:", err);
            setScansLoaded(true);
        });

        return () => {
            ticketsUnsubscribe();
            scansUnsubscribe();
            settingsUnsubscribe();
        };
    }, [db, selectedEvent]);

    const handleLogin = async (username: string, pass: string) => {
        if (!db) return;
        setIsAuthLoading(true);
        try {
            if (pass === '123654' || pass === '987654') {
                const role = pass === '987654' ? 'SUPER_ADMIN' : 'ADMIN';
                const user = { id: role.toLowerCase(), username: role === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador', role, allowedEvents: [] };
                localStorage.setItem('auth_user_session', JSON.stringify({ ...user, _expiry: Date.now() + 86400000 }));
                setCurrentUser(user as User);
                setShowLoginModal(false);
                setView('admin');
                return;
            }
            const snap = await getDocs(collection(db, 'users'));
            let foundUser: User | null = null;
            snap.forEach(doc => {
                const data = doc.data();
                if ((data.username || '').toLowerCase() === username.trim().toLowerCase() && data.password === pass) foundUser = { id: doc.id, ...data } as User;
            });
            if (foundUser) {
                const user = foundUser as User;
                localStorage.setItem('auth_user_session', JSON.stringify({ ...user, _expiry: Date.now() + 86400000 }));
                setCurrentUser(user);
                setShowLoginModal(false);
                setView('admin');
            } else alert("Credenciais inválidas.");
        } catch (e) { alert("Erro no login."); } finally { setIsAuthLoading(false); }
    };

    const handleScanSuccess = useCallback(async (decodedText: string) => {
        const now = Date.now();
        if (cooldownRef.current || !db || !selectedEvent) return;
        if (lastCodeRef.current === decodedText.trim() && now - lastCodeTimeRef.current < 3000) return;
        
        lastCodeRef.current = decodedText.trim();
        lastCodeTimeRef.current = now;
        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, 400); 

        const ticketId = decodedText.trim();
        const ticket = ticketsMap.get(ticketId);
        const eventId = selectedEvent.id;
        
        // PRIORIDADE 1: EXIBIR ALERTA VISUAL IMEDIATAMENTE
        if (!ticket) {
            showScanResult('INVALID', `Não encontrado: ${ticketId}`);
            addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Desconhecido', deviceId, operator: operatorName });
            return;
        }

        if (ticket.status === 'USED') {
            const timeStr = ticket.usedAt ? new Date(ticket.usedAt).toLocaleTimeString('pt-BR') : 'Agora';
            showScanResult('USED', `Entrada realizada às ${timeStr}.`, `Código: ${ticketId}`);
            addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'USED', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        // Caso válido
        showScanResult('VALID', `Liberado: ${ticket.sector}!`);
        
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'events', eventId, 'tickets', ticketId), { status: 'USED', usedAt: serverTimestamp() });
            batch.set(doc(collection(db, 'events', eventId, 'scans')), { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            batch.commit(); // Não aguardamos o commit para não atrasar a interface
        } catch (error) { 
            console.error("Erro ao salvar scan", error);
        }
    }, [db, selectedEvent, ticketsMap, deviceId, operatorName]);

    const showScanResult = (status: ScanStatus, message: string, extra?: string) => {
        if (status === 'VALID') playBeep('success');
        else playBeep('error');
        setScanResult({ status, message, extra });
        setTimeout(() => setScanResult(null), 3000);
    };

    if (!db || firebaseStatus === 'loading' || isCheckingUrl) return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white text-2xl animate-pulse">Carregando...</div>;
    if (firebaseStatus === 'error') return <SetupInstructions />;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center px-4 md:px-8 ios-safe-top ios-safe-bottom">
            <div className="w-full max-w-6xl mx-auto space-y-6 pt-4">
                {!isOnline && <AlertBanner message="Você está offline." type="warning" />}
                <header className="flex justify-between items-center w-full">
                    <div className="flex items-center space-x-3">
                        <LogoSVG className="w-10 h-10 text-white" />
                        <div>
                            <h1 className="text-2xl font-black text-white tracking-tighter leading-tight">ST CHECK-IN</h1>
                            <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">{selectedEvent?.name || 'Selecione um Evento'}</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2">
                         <button onClick={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} className={`p-2 rounded-full transition-colors ${view === 'admin' ? 'bg-orange-600' : 'bg-gray-700 hover:bg-gray-600'}`} title="Configurações"><CogIcon className="w-6 h-6" /></button>
                         {currentUser && <button onClick={() => { setCurrentUser(null); localStorage.removeItem('auth_user_session'); setSelectedEvent(null); localStorage.removeItem('selected_event_id'); setView('scanner'); }} className="p-2 rounded-full bg-red-600 hover:bg-red-700 ml-2" title="Sair"><LogoutIcon className="w-6 h-6" /></button>}
                    </div>
                </header>

                <main>
                    {showLoginModal && <LoginModal onLogin={handleLogin} onCancel={() => setShowLoginModal(false)} isLoading={isAuthLoading} />}
                    {view === 'public_stats' && selectedEvent && <PublicStatsView event={selectedEvent} allTickets={filteredAllTickets} scanHistory={filteredScanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} isLoading={!ticketsLoaded} />}
                    {view === 'operators' && selectedEvent && <OperatorMonitor event={selectedEvent} allTickets={filteredAllTickets} scanHistory={filteredScanHistory} isLoading={!scansLoaded} />}
                    {view === 'generator' && db && <SecretTicketGenerator db={db} />}
                    {view === 'admin' && <AdminView db={db} events={events} selectedEvent={selectedEvent} allTickets={filteredAllTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} onUpdateSectorNames={async (n, h) => { if(selectedEvent) await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: n, hiddenSectors: h }, { merge: true }); }} isOnline={isOnline} onSelectEvent={(e) => { setSelectedEvent(e); localStorage.setItem('selected_event_id', e.id); setView('admin'); }} currentUser={currentUser} />}
                    {view === 'scanner' && selectedEvent && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
                            <div className="space-y-4">
                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border-4 border-gray-700 shadow-xl">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} extra={scanResult.extra} />}
                                    <Scanner onScanSuccess={handleScanSuccess} onScanError={(e) => alert(e)} />
                                </div>
                                <div className="bg-gray-800 p-4 rounded-lg flex space-x-2">
                                    <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Código manual..." className="flex-1 bg-gray-900 border border-gray-600 rounded px-4 py-3 text-white outline-none focus:border-orange-500" />
                                    <button onClick={() => { handleScanSuccess(manualCode); setManualCode(''); }} className="bg-orange-600 text-white font-bold py-3 px-6 rounded shadow-lg active:scale-95 transition-all">Validar</button>
                                </div>
                            </div>
                            <TicketList tickets={filteredScanHistory.filter(s => s.deviceId === deviceId)} sectorNames={visibleSectors} />
                        </div>
                    )}
                    {view === 'scanner' && !selectedEvent && !showLoginModal && <EventSelector events={events.filter(e => !e.isHidden)} onSelectEvent={(e) => { setSelectedEvent(e); localStorage.setItem('selected_event_id', e.id); }} onAccessAdmin={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} />}
                </main>
            </div>
        </div>
    );
};

export default App;

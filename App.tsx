
// FIX: Implement the main App component, resolving "not a module" and other related errors.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDocs, where, getDoc } from 'firebase/firestore';
import Papa from 'papaparse';

import Scanner from './components/Scanner';
import StatusDisplay from './components/StatusDisplay';
import AdminView from './AdminView';
import SetupInstructions from './components/SetupInstructions';
import AlertBanner from './components/AlertBanner';
import EventSelector from './components/EventSelector';
import TicketList from './components/TicketList';
import PublicStatsView from './components/PublicStatsView';
import LoginModal from './components/LoginModal';
import SecretTicketGenerator from './components/SecretTicketGenerator'; 
import OperatorMonitor from './components/OperatorMonitor'; 
import AlertConfirmationModal from './components/AlertConfirmationModal';
import { CogIcon, QrCodeIcon, VideoCameraIcon, LogoutIcon, TicketIcon, UsersIcon, FunnelIcon } from './components/Icons';
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
    
    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats' | 'generator' | 'operators'>(() => {
        try {
            return (localStorage.getItem('current_view') as any) || 'scanner';
        } catch(e) { return 'scanner'; }
    });

    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string; extra?: string } | null>(null);
    const [pendingAlert, setPendingAlert] = useState<{ticket: Ticket, code: string} | null>(null);

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

    useEffect(() => {
        localStorage.setItem('current_view', view);
    }, [view]);

    useEffect(() => {
        localStorage.setItem('operatorName', operatorName);
    }, [operatorName]);

    const ticketsMap = useMemo(() => {
        if (!Array.isArray(allTickets)) return new Map();
        return new Map(allTickets.map(ticket => [ticket.id, ticket]));
    }, [allTickets]);

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

    useEffect(() => {
        getDb().then(async database => {
            setDb(database);
            setFirebaseStatus('success');
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
                    setView('public_stats');
                }
            } else if (modeParam === 'operators' && eventIdParam) {
                 const docSnap = await getDoc(doc(db, 'events', eventIdParam));
                 if (docSnap.exists()) {
                    const ev = { id: docSnap.id, name: docSnap.data().name, isHidden: docSnap.data().isHidden };
                    setSelectedEvent(ev);
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
        if (!db || !selectedEvent) return;
        const eventId = selectedEvent.id;
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
        });

        return () => { ticketsUnsubscribe(); scansUnsubscribe(); settingsUnsubscribe(); };
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

    const processFinalValidation = useCallback(async (ticket: Ticket, ticketId: string) => {
        if (!db || !selectedEvent) return;
        const eventId = selectedEvent.id;
        showScanResult('VALID', `Liberado: ${ticket.sector}!`);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'events', eventId, 'tickets', ticketId), { status: 'USED', usedAt: serverTimestamp() });
            batch.set(doc(collection(db, 'events', eventId, 'scans')), { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            batch.commit();
        } catch (error) { console.error("Erro ao salvar scan", error); }
    }, [db, selectedEvent, deviceId, operatorName]);

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
        
        if (!ticket) {
            showScanResult('INVALID', `Não encontrado: ${ticketId}`);
            addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Desconhecido', deviceId, operator: operatorName });
            return;
        }

        // VALIDAÇÃO DE SETOR
        if (selectedSector !== 'All' && ticket.sector !== selectedSector) {
            showScanResult('WRONG_SECTOR', `Setor do Ingresso: ${ticket.sector}`, `Este ponto é: ${selectedSector}`);
            addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        if (ticket.status === 'USED') {
            const timeStr = ticket.usedAt ? new Date(ticket.usedAt).toLocaleTimeString('pt-BR') : 'Agora';
            showScanResult('USED', `Entrada realizada às ${timeStr}.`, `Código: ${ticketId}`);
            addDoc(collection(db, 'events', eventId, 'scans'), { ticketId, status: 'USED', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        if (ticket.details?.alertMessage) {
            playBeep('error');
            setPendingAlert({ ticket, code: ticketId });
            return;
        }

        processFinalValidation(ticket, ticketId);
    }, [db, selectedEvent, ticketsMap, deviceId, operatorName, processFinalValidation, playBeep, selectedSector]);

    const showScanResult = (status: ScanStatus, message: string, extra?: string) => {
        if (status === 'VALID') playBeep('success');
        else playBeep('error');
        setScanResult({ status, message, extra });
        setTimeout(() => setScanResult(null), 3000);
    };

    const handleSwitchEvent = () => {
        setTicketsLoaded(false);
        setScansLoaded(false);
        setAllTickets([]);
        setScanHistory([]);
        setSelectedEvent(null);
        localStorage.removeItem('selected_event_id');
        setView('scanner');
    };

    if (!db || firebaseStatus === 'loading' || isCheckingUrl) return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white text-2xl animate-pulse font-black uppercase tracking-widest">Carregando Sistema...</div>;
    if (firebaseStatus === 'error') return <SetupInstructions />;

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                {!isOnline && <AlertBanner message="Você está offline." type="warning" />}
                
                {pendingAlert && (
                    <AlertConfirmationModal 
                        message={pendingAlert.ticket.details?.alertMessage || ''}
                        ticketId={pendingAlert.code}
                        ownerName={pendingAlert.ticket.details?.ownerName}
                        onConfirm={() => {
                            const t = pendingAlert.ticket;
                            const c = pendingAlert.code;
                            setPendingAlert(null);
                            processFinalValidation(t, c);
                        }}
                        onCancel={() => setPendingAlert(null)}
                    />
                )}

                <header className="flex justify-between items-center w-full">
                    <div>
                        <h1 className="text-3xl font-black text-orange-500 tracking-tighter uppercase">{selectedEvent?.name || 'ST CHECK-IN'}</h1>
                        {selectedEvent && (
                            <button 
                                onClick={handleSwitchEvent} 
                                className="text-xs font-bold text-gray-500 hover:text-white uppercase tracking-widest mt-1 transition-colors"
                            >
                                [ Trocar Evento ]
                            </button>
                        )}
                    </div>
                    <div className="flex items-center space-x-3">
                         <button onClick={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} className={`p-3 rounded-2xl transition-all shadow-lg ${view === 'admin' ? 'bg-orange-600' : 'bg-gray-800 hover:bg-gray-700'}`} title="Configurações"><CogIcon className="w-6 h-6" /></button>
                         {currentUser && <button onClick={() => { setCurrentUser(null); localStorage.removeItem('auth_user_session'); setView('scanner'); }} className="p-3 rounded-2xl bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white transition-all shadow-lg" title="Sair"><LogoutIcon className="w-6 h-6" /></button>}
                    </div>
                </header>

                <main className="animate-fade-in">
                    {showLoginModal && <LoginModal onLogin={handleLogin} onCancel={() => setShowLoginModal(false)} isLoading={isAuthLoading} />}
                    {view === 'public_stats' && selectedEvent && <PublicStatsView event={selectedEvent} allTickets={filteredAllTickets} scanHistory={filteredScanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} isLoading={!ticketsLoaded} />}
                    {view === 'operators' && selectedEvent && <OperatorMonitor event={selectedEvent} allTickets={filteredAllTickets} scanHistory={filteredScanHistory} isLoading={!scansLoaded} />}
                    {view === 'generator' && db && <SecretTicketGenerator db={db} />}
                    {view === 'admin' && <AdminView db={db} events={events} selectedEvent={selectedEvent} allTickets={filteredAllTickets} scanHistory={filteredScanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors || []} onUpdateSectorNames={async (n, h) => { if(selectedEvent) await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: n, hiddenSectors: h }, { merge: true }); }} isOnline={isOnline} onSelectEvent={(e) => { setSelectedEvent(e); localStorage.setItem('selected_event_id', e.id); setView('admin'); }} currentUser={currentUser} />}
                    
                    {view === 'scanner' && selectedEvent && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                {/* PAINEL DE OPERAÇÃO (OPERADOR E SETOR) */}
                                <div className="bg-gray-800 p-5 rounded-[2rem] border border-gray-700 shadow-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                                            <UsersIcon className="w-3 h-3 mr-1.5" /> Nome do Operador
                                        </label>
                                        <input 
                                            type="text"
                                            value={operatorName}
                                            onChange={(e) => setOperatorName(e.target.value)}
                                            placeholder="Identifique-se..."
                                            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm font-bold text-orange-500 focus:border-orange-500 outline-none transition-all shadow-inner"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center">
                                            <FunnelIcon className="w-3 h-3 mr-1.5" /> Validar Setor
                                        </label>
                                        <select 
                                            value={selectedSector}
                                            onChange={(e) => setSelectedSector(e.target.value as SectorFilter)}
                                            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm font-black text-white focus:border-orange-500 outline-none transition-all cursor-pointer shadow-inner"
                                        >
                                            <option value="All">TODOS OS SETORES</option>
                                            {visibleSectors.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-[2.5rem] overflow-hidden border-4 border-gray-700 shadow-2xl ring-1 ring-orange-500/10">
                                    {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} extra={scanResult.extra} />}
                                    <Scanner onScanSuccess={handleScanSuccess} onScanError={(e) => alert(e)} />
                                    
                                    {/* MIRA VISUAL */}
                                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
                                        <div className="w-64 h-64 border-2 border-dashed border-orange-500 rounded-3xl"></div>
                                    </div>
                                </div>

                                <div className="bg-gray-800 p-5 rounded-[2rem] flex space-x-3 border border-gray-700 shadow-xl">
                                    <input 
                                        type="text" 
                                        value={manualCode} 
                                        onChange={(e) => setManualCode(e.target.value)} 
                                        placeholder="Digitar código manual..." 
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded-2xl px-5 py-4 text-white font-mono text-lg outline-none focus:border-orange-500 shadow-inner" 
                                    />
                                    <button 
                                        onClick={() => { handleScanSuccess(manualCode); setManualCode(''); }} 
                                        className="bg-orange-600 hover:bg-orange-700 text-white font-black px-8 rounded-2xl shadow-lg shadow-orange-900/40 transition-all active:scale-95 uppercase text-sm tracking-tighter"
                                    >
                                        Validar
                                    </button>
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center px-2">
                                    <TicketIcon className="w-4 h-4 mr-2" /> Suas últimas validações
                                </h3>
                                <TicketList tickets={filteredScanHistory.filter(s => s.deviceId === deviceId)} sectorNames={visibleSectors} />
                            </div>
                        </div>
                    )}

                    {view === 'scanner' && !selectedEvent && !showLoginModal && (
                        <EventSelector 
                            events={events.filter(e => !e.isHidden)} 
                            onSelectEvent={(e) => { 
                                setSelectedEvent(e); 
                                localStorage.setItem('selected_event_id', e.id); 
                            }} 
                            onAccessAdmin={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} 
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;

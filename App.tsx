
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getDb } from './firebaseConfig';
import { collection, onSnapshot, doc, writeBatch, serverTimestamp, query, orderBy, addDoc, Timestamp, Firestore, setDoc, limit, updateDoc, getDocs, where, getDoc } from 'firebase/firestore';

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
import SecurityModule from './components/admin/SecurityModule';
import LookupModule from './components/admin/LookupModule';
import { CogIcon, LogoutIcon, TicketIcon, UsersIcon, FunnelIcon, CheckCircleIcon, QrCodeIcon } from './components/Icons';
import { useSound } from './hooks/useSound';

import { Ticket, ScanStatus, DisplayableScanLog, Event, User, ImportSource, formatSafeTime } from './types';

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
    const [isInitializing, setIsInitializing] = useState(true);
    
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        try {
            const saved = localStorage.getItem('auth_user_session');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed._expiry > Date.now()) return parsed;
                localStorage.removeItem('auth_user_session');
            }
        } catch(e) {}
        return null;
    });

    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats' | 'generator' | 'operators' | 'security' | 'lookup'>(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mode') === 'stats') return 'public_stats';
            const savedView = localStorage.getItem('current_view');
            if (savedView) return savedView as any;
        } catch(e) {}
        return 'scanner';
    });

    const [events, setEvents] = useState<Event[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [scanHistory, setScanHistory] = useState<DisplayableScanLog[]>([]);
    const [sectorNames, setSectorNames] = useState<string[]>([]); 
    const [hiddenSectors, setHiddenSectors] = useState<string[]>([]); 
    
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showOpConfigModal, setShowOpConfigModal] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);

    const [operatorName, setOperatorName] = useState('');
    const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
    const [isOperatorConfigured, setIsOperatorConfigured] = useState(false);
    
    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string; extra?: string } | null>(null);
    const [pendingAlert, setPendingAlert] = useState<{ticket: Ticket, code: string} | null>(null);

    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [ticketsLoaded, setTicketsLoaded] = useState(false); 
    const [scansLoaded, setScansLoaded] = useState(false); 
    const [manualCode, setManualCode] = useState(''); 
    
    const deviceId = useMemo(() => getDeviceId(), []);
    const playBeep = useSound();
    const cooldownRef = useRef<boolean>(false);
    const lastCodeRef = useRef<string | null>(null);
    const lastCodeTimeRef = useRef<number>(0);

    // EFEITO CRÍTICO: Esconde a tela de boot do index.html quando o React montar
    useEffect(() => {
        const bootScreen = document.getElementById('boot-screen');
        if (bootScreen) {
            bootScreen.style.opacity = '0';
            setTimeout(() => bootScreen.style.display = 'none', 500);
        }
    }, []);

    useEffect(() => { 
        try { localStorage.setItem('current_view', view); } catch(e) {}
    }, [view]);

    const ticketsMap = useMemo(() => {
        const map = new Map<string, Ticket>();
        (allTickets || []).forEach(t => map.set(t.id, t));
        return map;
    }, [allTickets]);

    const visibleSectors = useMemo(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        const hidden = Array.isArray(hiddenSectors) ? hiddenSectors : [];
        return names.filter(s => !hidden.includes(s));
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        getDb().then(database => {
            setDb(database);
            setFirebaseStatus('success');
        }).catch((err) => {
            console.error("Erro ao obter DB:", err);
            setFirebaseStatus('error');
        });
    }, []);

    useEffect(() => {
        if (!db) return;
        
        let savedEventId: string | null = null;
        try {
            const params = new URLSearchParams(window.location.search);
            const urlEventId = params.get('eventId');
            savedEventId = urlEventId || localStorage.getItem('selected_event_id');
        } catch(e) {}

        const eventsUnsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
            const eventsData = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                name: doc.data().name || 'Sem Nome', 
                isHidden: doc.data().isHidden ?? false 
            }));
            setEvents(eventsData);
            
            if (savedEventId) {
                const found = eventsData.find(e => e.id === savedEventId);
                if (found) {
                    setSelectedEvent(found);
                    try {
                        const savedConfig = localStorage.getItem(`op_config_${found.id}`);
                        if (savedConfig) {
                            const parsed = JSON.parse(savedConfig);
                            setOperatorName(parsed.name || '');
                            setSelectedSectors(parsed.sectors || []);
                            setIsOperatorConfigured(true);
                        } else if (view === 'scanner') {
                            setShowOpConfigModal(true);
                        }
                    } catch(e) {}
                }
            }
            setIsInitializing(false);
        }, (err) => {
            console.error("Erro ao carregar eventos:", err);
            setIsInitializing(false);
        });
        
        return () => eventsUnsubscribe();
    }, [db, view]);

    useEffect(() => {
        if (!db || !selectedEvent) return;
        const eventId = selectedEvent.id;
        
        const unsubSettings = onSnapshot(doc(db, 'events', eventId, 'settings', 'main'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setSectorNames(data.sectorNames || []);
                setHiddenSectors(data.hiddenSectors || []);
            }
        });

        const unsubTickets = onSnapshot(collection(db, 'events', eventId, 'tickets'), (snap) => {
            setAllTickets(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ticket)));
            setTicketsLoaded(true);
        }, () => setTicketsLoaded(true));

        const unsubScans = onSnapshot(query(collection(db, 'events', eventId, 'scans'), orderBy('timestamp', 'desc'), limit(50)), (snap) => {
            setScanHistory(snap.docs.map(d => ({ 
                id: d.id, 
                ticketId: d.data().ticketId, 
                status: d.data().status, 
                timestamp: d.data().timestamp?.toMillis ? d.data().timestamp.toMillis() : (d.data().timestamp?.seconds ? d.data().timestamp.seconds * 1000 : Date.now()), 
                ticketSector: d.data().sector,
                deviceId: d.data().deviceId,
                operator: d.data().operator
            } as DisplayableScanLog)));
            setScansLoaded(true);
        });

        return () => { unsubSettings(); unsubTickets(); unsubScans(); };
    }, [db, selectedEvent]);

    const handleLogin = async (username: string, pass: string) => {
        if (!db) return;
        setIsAuthLoading(true);
        try {
            if (pass === '123654' || pass === '987654') {
                const role = pass === '987654' ? 'SUPER_ADMIN' : 'ADMIN';
                const user = { id: role.toLowerCase(), username: role === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador', role, allowedEvents: [] };
                try { localStorage.setItem('auth_user_session', JSON.stringify({ ...user, _expiry: Date.now() + 86400000 })); } catch(e) {}
                setCurrentUser(user as User);
                setShowLoginModal(false);
                setView('admin');
                return;
            }
            const snap = await getDocs(collection(db, 'users'));
            let foundUser: User | null = null;
            snap.forEach(doc => {
                const data = doc.data();
                if (data.username?.toLowerCase() === username.toLowerCase() && data.password === pass) foundUser = { id: doc.id, ...data } as User;
            });
            if (foundUser) {
                setCurrentUser(foundUser);
                try { localStorage.setItem('auth_user_session', JSON.stringify({ ...foundUser, _expiry: Date.now() + 86400000 })); } catch(e) {}
                setShowLoginModal(false);
                setView('admin');
            } else alert("Inválido");
        } catch (e) { alert("Erro"); } finally { setIsAuthLoading(false); }
    };

    const processFinalValidation = useCallback(async (ticket: Ticket, ticketId: string) => {
        if (!db || !selectedEvent) return;
        showScanResult('VALID', `Liberado: ${ticket.sector}!`);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'events', selectedEvent.id, 'tickets', ticketId), { status: 'USED', usedAt: serverTimestamp() });
            batch.set(doc(collection(db, 'events', selectedEvent.id, 'scans')), { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            batch.commit();
        } catch (e) {}
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
        
        if (!ticket) {
            showScanResult('INVALID', `Não encontrado: ${ticketId}`);
            addDoc(collection(db, 'events', selectedEvent.id, 'scans'), { ticketId, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Desconhecido', deviceId, operator: operatorName });
            return;
        }

        if (selectedSectors.length > 0 && !selectedSectors.includes(ticket.sector)) {
            showScanResult('WRONG_SECTOR', `Setor: ${ticket.sector}`, `Permitidos: ${selectedSectors.join(', ')}`);
            addDoc(collection(db, 'events', selectedEvent.id, 'scans'), { ticketId, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        if (ticket.status === 'USED') {
            const usedAtTime = formatSafeTime(ticket.usedAt);
            showScanResult('USED', `Já utilizado às ${usedAtTime}.`, `Código: ${ticketId}`);
            addDoc(collection(db, 'events', selectedEvent.id, 'scans'), { ticketId, status: 'USED', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        if (ticket.details?.alertMessage) {
            playBeep('error');
            setPendingAlert({ ticket, code: ticketId });
            return;
        }

        processFinalValidation(ticket, ticketId);
    }, [db, selectedEvent, ticketsMap, deviceId, operatorName, processFinalValidation, playBeep, selectedSectors]);

    const showScanResult = (status: ScanStatus, message: string, extra?: string) => {
        if (status === 'VALID') playBeep('success');
        else playBeep('error');
        setScanResult({ status, message, extra });
        setTimeout(() => setScanResult(null), 3000);
    };

    const handleLogout = () => {
        setCurrentUser(null);
        try { localStorage.removeItem('auth_user_session'); } catch(e) {}
        setView('scanner');
    };

    const handleSwitchEvent = () => {
        setSelectedEvent(null);
        setAllTickets([]);
        setScanHistory([]);
        setIsOperatorConfigured(false);
        setOperatorName('');
        setSelectedSectors([]);
        setShowOpConfigModal(false);
        try { localStorage.removeItem('selected_event_id'); } catch(e) {}
        setView('scanner');
    };

    if (!db || firebaseStatus === 'loading' || isInitializing) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 space-y-4">
            <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-orange-500 font-black uppercase tracking-widest text-xs animate-pulse">Sincronizando Banco...</p>
        </div>
    );
    
    if (firebaseStatus === 'error') return <SetupInstructions />;

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4">
            <div className="w-full max-w-6xl space-y-6">
                {!isOnline && <AlertBanner message="Você está trabalhando offline" type="warning" />}
                
                {showOpConfigModal && (
                    <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
                        <div className="w-full max-w-md bg-gray-800 border border-gray-700 rounded-[2.5rem] p-8 shadow-2xl space-y-8 animate-fade-in">
                            <div className="text-center">
                                <UsersIcon className="w-16 h-16 text-orange-500 mx-auto mb-2" />
                                <h2 className="text-2xl font-black uppercase">Configurar Ponto</h2>
                            </div>
                            <div className="space-y-4">
                                <input 
                                    type="text" value={operatorName} onChange={e => setOperatorName(e.target.value)} 
                                    placeholder="Nome do Operador" className="w-full bg-gray-900 border border-gray-700 p-4 rounded-2xl text-white font-bold outline-none" 
                                />
                                <div className="space-y-2">
                                    <p className="text-[10px] font-black text-gray-500 uppercase ml-2">Setores vinculados:</p>
                                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                        {visibleSectors.map(s => (
                                            <label key={s} className={`flex items-center p-3 rounded-xl border cursor-pointer transition-all ${selectedSectors.includes(s) ? 'bg-orange-600 border-orange-400 text-white' : 'bg-gray-900 border-gray-700 text-gray-500'}`}>
                                                <input type="checkbox" className="hidden" checked={selectedSectors.includes(s)} onChange={() => {
                                                    if (selectedSectors.includes(s)) setSelectedSectors(selectedSectors.filter(x => x !== s));
                                                    else setSelectedSectors([...selectedSectors, s]);
                                                }} />
                                                <span className="text-xs font-bold truncate">{s}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <button onClick={() => {
                                    if(!operatorName || selectedSectors.length === 0) return alert("Preencha todos os campos");
                                    setIsOperatorConfigured(true);
                                    setShowOpConfigModal(false);
                                    try {
                                        if(selectedEvent) localStorage.setItem(`op_config_${selectedEvent.id}`, JSON.stringify({name: operatorName, sectors: selectedSectors}));
                                    } catch(e) {}
                                }} className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl uppercase shadow-xl active:scale-95 transition-all">Salvar e Iniciar</button>
                                <button onClick={handleSwitchEvent} className="w-full text-xs text-gray-500 hover:text-white uppercase font-bold">Trocar Evento</button>
                            </div>
                        </div>
                    </div>
                )}

                {pendingAlert && (
                    <AlertConfirmationModal message={pendingAlert.ticket.details?.alertMessage || ''} ticketId={pendingAlert.code} ownerName={pendingAlert.ticket.details?.ownerName} onConfirm={() => {
                        const t = pendingAlert.ticket; const c = pendingAlert.code;
                        setPendingAlert(null); processFinalValidation(t, c);
                    }} onCancel={() => setPendingAlert(null)} />
                )}

                <header className="flex justify-between items-center w-full">
                    <div>
                        <h1 className="text-2xl font-black text-orange-500 uppercase">{selectedEvent?.name || 'ST CHECK-IN'}</h1>
                        {selectedEvent && <button onClick={handleSwitchEvent} className="text-[10px] text-gray-500 uppercase font-bold mt-1 tracking-widest">[ TROCAR EVENTO ]</button>}
                    </div>
                    <div className="flex gap-2">
                         <button onClick={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} className="p-3 rounded-2xl bg-gray-800 hover:bg-gray-700"><CogIcon className="w-5 h-5" /></button>
                         {currentUser && <button onClick={handleLogout} className="p-3 rounded-2xl bg-red-600/20 text-red-500"><LogoutIcon className="w-5 h-5" /></button>}
                    </div>
                </header>

                <main>
                    {showLoginModal && <LoginModal onLogin={handleLogin} onCancel={() => setShowLoginModal(false)} isLoading={isAuthLoading} />}
                    
                    {view === 'admin' && (
                        <AdminView db={db!} events={events} selectedEvent={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} onUpdateSectorNames={async (n, h) => { if(selectedEvent) await setDoc(doc(db!, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: n, hiddenSectors: h }, { merge: true }); }} isOnline={isOnline} onSelectEvent={(e) => { setSelectedEvent(e); try { localStorage.setItem('selected_event_id', e.id); } catch(err) {} setView('admin'); }} currentUser={currentUser} />
                    )}

                    {view === 'scanner' && (
                        <>
                            {!selectedEvent ? (
                                <EventSelector events={events.filter(e => !e.isHidden)} onSelectEvent={(e) => { setSelectedEvent(e); try { localStorage.setItem('selected_event_id', e.id); } catch(err) {} setShowOpConfigModal(true); }} onAccessAdmin={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} />
                            ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="bg-gray-800 p-4 rounded-3xl border border-gray-700 flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <UsersIcon className="w-4 h-4 text-orange-500" />
                                                <span className="text-xs font-black uppercase text-white truncate max-w-[120px]">{operatorName}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <FunnelIcon className="w-4 h-4 text-gray-500" />
                                                <span className="text-[10px] font-bold text-orange-400">{selectedSectors.length} setores ativos</span>
                                                <button onClick={() => setShowOpConfigModal(true)} className="ml-2 bg-gray-700 p-1.5 rounded-lg hover:bg-gray-600"><CogIcon className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                        <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-[2.5rem] overflow-hidden border-4 border-gray-700 shadow-2xl">
                                            {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} extra={scanResult.extra} />}
                                            <Scanner onScanSuccess={handleScanSuccess} onScanError={e => alert(e)} />
                                        </div>
                                        <div className="bg-gray-800 p-4 rounded-3xl flex gap-2 border border-gray-700 shadow-xl">
                                            <input type="text" value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="Código manual..." className="flex-1 bg-gray-900 border border-gray-700 rounded-2xl px-4 py-3 text-white outline-none focus:border-orange-500 font-mono" />
                                            <button onClick={() => { handleScanSuccess(manualCode); setManualCode(''); }} className="bg-orange-600 text-white font-black px-6 rounded-2xl shadow-lg active:scale-95 transition-all">Validar</button>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest px-2 flex items-center gap-2">
                                            <TicketIcon className="w-4 h-4" /> Histórico deste Dispositivo
                                        </h3>
                                        <TicketList tickets={scanHistory.filter(s => s.deviceId === deviceId)} sectorNames={visibleSectors} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {view === 'public_stats' && selectedEvent && <PublicStatsView event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} isLoading={!ticketsLoaded} />}
                    {view === 'operators' && selectedEvent && <OperatorMonitor event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} isLoading={!scansLoaded} />}
                    {view === 'security' && <SecurityModule scanHistory={scanHistory} />}
                    {view === 'lookup' && <LookupModule allTickets={allTickets} scanHistory={scanHistory} />}
                </main>
            </div>
        </div>
    );
};

export default App;

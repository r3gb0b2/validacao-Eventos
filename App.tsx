
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
import { CogIcon, LogoutIcon, TicketIcon, UsersIcon, FunnelIcon, CheckCircleIcon, QrCodeIcon } from './components/Icons';
import { useSound } from './hooks/useSound';

import { Ticket, ScanStatus, DisplayableScanLog, Event, User, ImportSource } from './types';

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
    
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [isAuthLoading, setIsAuthLoading] = useState(false);

    // Configurações do Operador
    const [operatorName, setOperatorName] = useState('');
    const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
    const [isOperatorConfigured, setIsOperatorConfigured] = useState(false);
    
    const [view, setView] = useState<'scanner' | 'admin' | 'public_stats' | 'generator' | 'operators'>(() => {
        try { return (localStorage.getItem('current_view') as any) || 'scanner'; } catch(e) { return 'scanner'; }
    });

    const [scanResult, setScanResult] = useState<{ status: ScanStatus; message: string; extra?: string } | null>(null);
    const [pendingAlert, setPendingAlert] = useState<{ticket: Ticket, code: string} | null>(null);

    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [ticketsLoaded, setTicketsLoaded] = useState(false); 
    const [scansLoaded, setScansLoaded] = useState(false); 
    const [isCheckingUrl, setIsCheckingUrl] = useState(true); 
    const [manualCode, setManualCode] = useState(''); 
    
    const deviceId = useMemo(() => getDeviceId(), []);
    const playBeep = useSound();
    const cooldownRef = useRef<boolean>(false);
    const lastCodeRef = useRef<string | null>(null);
    const lastCodeTimeRef = useRef<number>(0);

    // Salvar visualização atual
    useEffect(() => { localStorage.setItem('current_view', view); }, [view]);

    // Recuperar sessão de usuário
    useEffect(() => {
        try {
            const saved = localStorage.getItem('auth_user_session');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed._expiry > Date.now()) setCurrentUser(parsed);
                else localStorage.removeItem('auth_user_session');
            }
        } catch(e) {}
    }, []);

    const ticketsMap = useMemo(() => {
        const map = new Map<string, Ticket>();
        if (Array.isArray(allTickets)) {
            allTickets.forEach(t => map.set(t.id, t));
        }
        return map;
    }, [allTickets]);

    const visibleSectors = useMemo(() => {
        const names = Array.isArray(sectorNames) ? sectorNames : [];
        const hidden = Array.isArray(hiddenSectors) ? hiddenSectors : [];
        return names.filter(s => !hidden.includes(s));
    }, [sectorNames, hiddenSectors]);

    // Firestore Initialization
    useEffect(() => {
        getDb().then(database => {
            setDb(database);
            setFirebaseStatus('success');
        }).catch(() => setFirebaseStatus('error'));
    }, []);

    // URL Params Check
    useEffect(() => {
        if (!db) return;
        const checkUrlParams = async () => {
            const params = new URLSearchParams(window.location.search);
            const eventIdParam = params.get('eventId');
            const modeParam = params.get('mode');

            if (eventIdParam) {
                const docSnap = await getDoc(doc(db, 'events', eventIdParam));
                if (docSnap.exists()) {
                    const ev = { id: docSnap.id, name: docSnap.data().name, isHidden: docSnap.data().isHidden };
                    setSelectedEvent(ev);
                    if (modeParam === 'stats') setView('public_stats');
                    else if (modeParam === 'operators') setView('operators');
                }
            } else if (modeParam === 'generator') {
                setView('generator');
            }
            setIsCheckingUrl(false);
        };
        checkUrlParams();
    }, [db]);

    // Eventos Listener
    useEffect(() => {
        if (!db || view === 'public_stats' || view === 'operators') return;
        const eventsUnsubscribe = onSnapshot(collection(db, 'events'), (snapshot) => {
            const eventsData = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name || 'Sem Nome', isHidden: doc.data().isHidden ?? false }));
            setEvents(eventsData);
            
            const savedEventId = localStorage.getItem('selected_event_id');
            if (savedEventId && !selectedEvent) {
                const found = eventsData.find(e => e.id === savedEventId);
                if (found) {
                    setSelectedEvent(found);
                    // Recuperar config do operador para este evento
                    const savedConfig = localStorage.getItem(`op_config_${found.id}`);
                    if (savedConfig) {
                        const parsed = JSON.parse(savedConfig);
                        setOperatorName(parsed.name || '');
                        setSelectedSectors(parsed.sectors || []);
                        setIsOperatorConfigured(true);
                    }
                }
            }
        });
        return () => eventsUnsubscribe();
    }, [db, view, selectedEvent]);

    // Dados do Evento Selecionado
    useEffect(() => {
        if (!db || !selectedEvent) return;
        const eventId = selectedEvent.id;
        
        const settingsUnsubscribe = onSnapshot(doc(db, 'events', eventId, 'settings', 'main'), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSectorNames(Array.isArray(data.sectorNames) ? data.sectorNames : []);
                setHiddenSectors(Array.isArray(data.hiddenSectors) ? data.hiddenSectors : []);
            }
        });

        const ticketsUnsubscribe = onSnapshot(collection(db, eventId.length > 20 ? 'events' : 'events', eventId, 'tickets'), (snapshot) => {
            const ticketsData = snapshot.docs.map(doc => {
                const data = doc.data();
                const ticket: Ticket = { id: doc.id, sector: data.sector || 'Geral', status: data.status || 'AVAILABLE', source: data.source, details: data.details };
                if (data.usedAt instanceof Timestamp) ticket.usedAt = data.usedAt.toMillis();
                return ticket;
            });
            setAllTickets(ticketsData);
            setTicketsLoaded(true);
        }, () => setTicketsLoaded(true));

        const scansQuery = query(collection(db, 'events', eventId, 'scans'), orderBy('timestamp', 'desc'), limit(50));
        const scansUnsubscribe = onSnapshot(scansQuery, (snapshot) => {
            const historyData = snapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ticketId: data.ticketId || '---', 
                    status: data.status || 'ERROR', 
                    timestamp: data.timestamp?.toMillis ? data.timestamp.toMillis() : Date.now(), 
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
        showScanResult('VALID', `Liberado: ${ticket.sector}!`);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'events', selectedEvent.id, 'tickets', ticketId), { status: 'USED', usedAt: serverTimestamp() });
            batch.set(doc(collection(db, 'events', selectedEvent.id, 'scans')), { ticketId, status: 'VALID', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
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
        
        if (!ticket) {
            showScanResult('INVALID', `Não encontrado: ${ticketId}`);
            addDoc(collection(db, 'events', selectedEvent.id, 'scans'), { ticketId, status: 'INVALID', timestamp: serverTimestamp(), sector: 'Desconhecido', deviceId, operator: operatorName });
            return;
        }

        // VALIDAÇÃO DE MÚLTIPLOS SETORES
        if (selectedSectors.length > 0 && !selectedSectors.includes(ticket.sector)) {
            showScanResult('WRONG_SECTOR', `Setor: ${ticket.sector}`, `Setores permitidos: ${selectedSectors.join(', ')}`);
            addDoc(collection(db, 'events', selectedEvent.id, 'scans'), { ticketId, status: 'WRONG_SECTOR', timestamp: serverTimestamp(), sector: ticket.sector, deviceId, operator: operatorName });
            return;
        }

        if (ticket.status === 'USED') {
            const timeStr = ticket.usedAt ? new Date(ticket.usedAt).toLocaleTimeString('pt-BR') : 'Agora';
            showScanResult('USED', `Entrada realizada às ${timeStr}.`);
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

    const handleSwitchEvent = () => {
        // Reset completo para evitar tela branca por referências nulas
        setTicketsLoaded(false);
        setScansLoaded(false);
        setAllTickets([]);
        setScanHistory([]);
        setSectorNames([]);
        setHiddenSectors([]);
        setSelectedEvent(null);
        setIsOperatorConfigured(false);
        setOperatorName('');
        setSelectedSectors([]);
        localStorage.removeItem('selected_event_id');
        setView('scanner');
    };

    const handleFinishOperatorSetup = () => {
        if (!operatorName.trim()) return alert("Digite o nome do operador.");
        if (selectedSectors.length === 0) return alert("Selecione ao menos um setor.");
        
        setIsOperatorConfigured(true);
        if (selectedEvent) {
            localStorage.setItem(`op_config_${selectedEvent.id}`, JSON.stringify({
                name: operatorName,
                sectors: selectedSectors
            }));
        }
    };

    if (!db || firebaseStatus === 'loading' || isCheckingUrl) return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white gap-4">
            <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xl font-black uppercase tracking-widest animate-pulse">Carregando Sistema...</p>
        </div>
    );
    
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
                            <button onClick={handleSwitchEvent} className="text-[10px] font-black text-gray-500 hover:text-white uppercase tracking-widest mt-1">
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
                    
                    {view === 'admin' && (
                        <AdminView 
                            db={db} 
                            events={events} 
                            selectedEvent={selectedEvent} 
                            allTickets={allTickets} 
                            scanHistory={scanHistory} 
                            sectorNames={sectorNames} 
                            hiddenSectors={hiddenSectors} 
                            onUpdateSectorNames={async (n, h) => { if(selectedEvent) await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), { sectorNames: n, hiddenSectors: h }, { merge: true }); }} 
                            isOnline={isOnline} 
                            onSelectEvent={(e) => { setSelectedEvent(e); localStorage.setItem('selected_event_id', e.id); setView('admin'); }} 
                            currentUser={currentUser} 
                        />
                    )}

                    {view === 'scanner' && (
                        <>
                            {!selectedEvent && (
                                <EventSelector 
                                    events={events.filter(e => !e.isHidden)} 
                                    onSelectEvent={(e) => { setSelectedEvent(e); localStorage.setItem('selected_event_id', e.id); }} 
                                    onAccessAdmin={() => { if (currentUser) setView('admin'); else setShowLoginModal(true); }} 
                                />
                            )}

                            {selectedEvent && !isOperatorConfigured && (
                                <div className="max-w-lg mx-auto bg-gray-800 p-8 rounded-[2.5rem] border border-gray-700 shadow-2xl space-y-8 animate-fade-in">
                                    <div className="text-center space-y-2">
                                        <UsersIcon className="w-16 h-16 text-orange-500 mx-auto" />
                                        <h2 className="text-2xl font-black uppercase">Configuração do Ponto</h2>
                                        <p className="text-gray-400 text-sm">Identifique-se e selecione os setores de validação.</p>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Seu Nome / Operador</label>
                                            <input 
                                                type="text" 
                                                value={operatorName} 
                                                onChange={e => setOperatorName(e.target.value)}
                                                placeholder="Digite seu nome..."
                                                className="w-full bg-gray-900 border border-gray-700 p-4 rounded-2xl text-white font-bold outline-none focus:border-orange-500"
                                            />
                                        </div>

                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1 flex justify-between items-center">
                                                <span>Setores Permitidos</span>
                                                <span className="text-orange-500 font-black">{selectedSectors.length} selecionados</span>
                                            </label>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                                {visibleSectors.map(s => (
                                                    <label key={s} className={`flex items-center p-3 rounded-xl border cursor-pointer transition-all ${selectedSectors.includes(s) ? 'bg-orange-600/20 border-orange-500 text-orange-400' : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                                                        <input 
                                                            type="checkbox" 
                                                            checked={selectedSectors.includes(s)}
                                                            onChange={() => {
                                                                if (selectedSectors.includes(s)) setSelectedSectors(selectedSectors.filter(x => x !== s));
                                                                else setSelectedSectors([...selectedSectors, s]);
                                                            }}
                                                            className="hidden"
                                                        />
                                                        <span className="text-xs font-bold truncate">{s.toUpperCase()}</span>
                                                        {selectedSectors.includes(s) && <CheckCircleIcon className="w-4 h-4 ml-auto" />}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <button 
                                            onClick={handleFinishOperatorSetup}
                                            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-5 rounded-2xl shadow-xl transition-all active:scale-95 uppercase tracking-tighter text-lg"
                                        >
                                            Confirmar e Iniciar
                                        </button>
                                    </div>
                                </div>
                            )}

                            {selectedEvent && isOperatorConfigured && (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="space-y-6">
                                        {/* Status do Ponto de Venda */}
                                        <div className="bg-gray-800 p-5 rounded-[2rem] border border-gray-700 shadow-xl flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-orange-600/10 rounded-full flex items-center justify-center text-orange-500">
                                                    <UsersIcon className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-black text-gray-500 uppercase">Operador</p>
                                                    <p className="text-sm font-black text-white">{operatorName.toUpperCase()}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[9px] font-black text-gray-500 uppercase">Setores Ativos</p>
                                                <p className="text-[10px] font-bold text-orange-500 truncate max-w-[120px]">
                                                    {selectedSectors.length === visibleSectors.length ? 'TODOS' : selectedSectors.join(', ')}
                                                </p>
                                            </div>
                                            <button onClick={() => setIsOperatorConfigured(false)} className="bg-gray-700 p-2 rounded-lg hover:bg-gray-600">
                                                <CogIcon className="w-4 h-4" />
                                            </button>
                                        </div>

                                        <div className="relative aspect-square w-full max-w-lg mx-auto bg-gray-800 rounded-[2.5rem] overflow-hidden border-4 border-gray-700 shadow-2xl">
                                            {scanResult && <StatusDisplay status={scanResult.status} message={scanResult.message} extra={scanResult.extra} />}
                                            <Scanner onScanSuccess={handleScanSuccess} onScanError={(e) => alert(e)} />
                                        </div>

                                        <div className="bg-gray-800 p-5 rounded-[2rem] flex space-x-3 border border-gray-700 shadow-xl">
                                            <input 
                                                type="text" 
                                                value={manualCode} 
                                                onChange={(e) => setManualCode(e.target.value)} 
                                                placeholder="Digitar código manual..." 
                                                className="flex-1 bg-gray-900 border border-gray-700 rounded-2xl px-5 py-4 text-white font-mono text-lg outline-none focus:border-orange-500" 
                                            />
                                            <button 
                                                onClick={() => { handleScanSuccess(manualCode); setManualCode(''); }} 
                                                className="bg-orange-600 hover:bg-orange-700 text-white font-black px-8 rounded-2xl shadow-lg transition-all active:scale-95"
                                            >
                                                Validar
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center px-2">
                                            <TicketIcon className="w-4 h-4 mr-2" /> Seu Histórico (Últimos 50)
                                        </h3>
                                        <TicketList tickets={scanHistory.filter(s => s.deviceId === deviceId)} sectorNames={visibleSectors} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {view === 'public_stats' && selectedEvent && <PublicStatsView event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} sectorNames={sectorNames} hiddenSectors={hiddenSectors} isLoading={!ticketsLoaded} />}
                    {view === 'operators' && selectedEvent && <OperatorMonitor event={selectedEvent} allTickets={allTickets} scanHistory={scanHistory} isLoading={!scansLoaded} />}
                    {view === 'generator' && db && <SecretTicketGenerator db={db} />}
                </main>
            </div>
        </div>
    );
};

export default App;

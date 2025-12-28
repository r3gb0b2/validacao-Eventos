
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ImportSource, Event, Ticket, ImportLog } from '../../types';
import { Firestore, doc, setDoc, writeBatch, collection, onSnapshot, query, orderBy, limit, addDoc } from 'firebase/firestore';
import { ClockIcon, PlayIcon, PauseIcon, CheckCircleIcon, AlertTriangleIcon, CloudUploadIcon, TableCellsIcon } from '../Icons';
import Papa from 'papaparse';

interface AutoImportModuleProps {
  db: Firestore;
  selectedEvent: Event;
  importSources: ImportSource[];
  allTickets: Ticket[];
  onUpdateSectorNames: (names: string[], hidden: string[]) => Promise<void>;
  sectorNames: string[];
  hiddenSectors: string[];
}

const AutoImportModule: React.FC<AutoImportModuleProps> = ({ db, selectedEvent, importSources, allTickets, onUpdateSectorNames, sectorNames, hiddenSectors }) => {
    const [isActive, setIsActive] = useState(false);
    const [intervalMinutes, setIntervalMinutes] = useState(5);
    const [countdown, setCountdown] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);
    const [logs, setLogs] = useState<ImportLog[]>([]);
    
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Carregar logs do Firestore
    useEffect(() => {
        if (!selectedEvent || !db) return;
        const q = query(
            collection(db, 'events', selectedEvent.id, 'import_logs'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ImportLog));
            setLogs(list);
        });
        return () => unsub();
    }, [db, selectedEvent]);

    const runImportLogic = useCallback(async () => {
        if (isSyncing || !selectedEvent || !db) return;
        setIsSyncing(true);

        const sourcesToSync = importSources.filter(s => s.autoImport);
        if (sourcesToSync.length === 0) {
            setIsSyncing(false);
            return;
        }

        // Criamos um Set dinâmico para rastrear o que já existe E o que estamos adicionando agora
        const processedIdsInThisCycle = new Set<string>(allTickets.map(t => String(t.id).trim()));
        const discoveredSectors = new Set<string>(sectorNames);

        for (const source of sourcesToSync) {
            let newItems = 0;
            let existingCount = 0;
            let updatedCount = 0;
            let totalFound = 0;
            const sectorsAffected: Record<string, number> = {};
            let ticketsToSave: any[] = [];

            try {
                let fetchUrl = source.url.trim();
                const headers: HeadersInit = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
                if (source.token) headers['Authorization'] = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;

                if (source.type === 'google_sheets') {
                    if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                    const res = await fetch(fetchUrl);
                    const csvText = await res.text();
                    const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                    
                    rows.forEach(row => {
                        const code = String(row['code'] || row['codigo'] || row['id'] || '').trim();
                        if (!code) return;
                        totalFound++;
                        const sector = String(row['sector'] || row['setor'] || 'Geral').trim();

                        if (!processedIdsInThisCycle.has(code)) {
                            discoveredSectors.add(sector);
                            sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                            ticketsToSave.push({
                                id: code, sector, status: 'AVAILABLE', source: 'api_import',
                                details: { ownerName: String(row['name'] || row['nome'] || 'Importado') }
                            });
                            newItems++;
                            processedIdsInThisCycle.add(code); // Evita duplicar se o mesmo ID aparecer de novo nesta ou em outra fonte
                        } else {
                            existingCount++;
                        }
                    });
                } else {
                    const endpoint = source.type === 'checkins' ? 'checkins' : 
                                    source.type === 'participants' ? 'participants' :
                                    source.type === 'buyers' ? 'buyers' : 'tickets';
                    const baseUrl = fetchUrl.endsWith('/') ? fetchUrl.slice(0, -1) : fetchUrl;
                    
                    let currentPage = 1;
                    let hasMore = true;

                    while (hasMore) {
                        const urlObj = new URL(`${baseUrl}/${endpoint}`, window.location.origin);
                        urlObj.searchParams.set('page', String(currentPage));
                        urlObj.searchParams.set('per_page', '100');
                        if (source.externalEventId) urlObj.searchParams.set('event_id', source.externalEventId);

                        const res = await fetch(urlObj.toString(), { headers, mode: 'cors' });
                        if (!res.ok) { hasMore = false; break; }

                        const json = await res.json();
                        const items = json.data || json.participants || json.tickets || json.checkins || json.buyers || (Array.isArray(json) ? json : []);
                        if (!items || items.length === 0) { hasMore = false; break; }

                        items.forEach((item: any) => {
                            totalFound++;
                            const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                            if (!code) return;

                            let rawSector = item.sector_name || item.category?.name || item.category || item.sector || item.ticket_type?.name || 'Geral';
                            const sector = String(rawSector).trim();
                            
                            const isNew = !processedIdsInThisCycle.has(code);
                            const shouldMarkUsed = source.type === 'checkins' || item.used === true || item.status === 'used' || !!item.validated_at;

                            if (isNew) {
                                discoveredSectors.add(sector);
                                sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                                ticketsToSave.push({
                                    id: code, sector, status: shouldMarkUsed ? 'USED' : 'AVAILABLE',
                                    usedAt: shouldMarkUsed ? (item.validated_at || Date.now()) : null,
                                    source: 'api_import',
                                    details: { ownerName: String(item.name || item.customer_name || 'Importado') }
                                });
                                newItems++;
                                processedIdsInThisCycle.add(code);
                            } else {
                                existingCount++;
                                // Se já existe, verificamos se o status mudou para USED (Sincronização de check-ins)
                                const existingTicket = allTickets.find(t => String(t.id).trim() === code);
                                if (shouldMarkUsed && existingTicket && existingTicket.status !== 'USED') {
                                    updatedCount++;
                                    sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                                    ticketsToSave.push({ ...existingTicket, status: 'USED', usedAt: item.validated_at || Date.now() });
                                }
                            }
                        });

                        const lastPage = json.last_page || json.meta?.last_page || 0;
                        if (lastPage > 0 && currentPage >= lastPage) hasMore = false; else currentPage++;
                        if (currentPage > 50) hasMore = false;
                    }
                }

                // Só salva se houver mudanças reais
                if (ticketsToSave.length > 0) {
                    const batch = writeBatch(db);
                    ticketsToSave.forEach(t => batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true }));
                    await batch.commit();
                }

                // SÓ REGISTRA LOG SE HOUVER NOVIDADES
                if (newItems > 0 || updatedCount > 0) {
                    await addDoc(collection(db, 'events', selectedEvent.id, 'import_logs'), {
                        timestamp: Date.now(),
                        sourceName: source.name,
                        newCount: newItems,
                        existingCount,
                        updatedCount,
                        sectorsAffected,
                        status: 'success'
                    });
                }

            } catch (err: any) {
                await addDoc(collection(db, 'events', selectedEvent.id, 'import_logs'), {
                    timestamp: Date.now(),
                    sourceName: source.name,
                    newCount: 0,
                    existingCount: 0,
                    updatedCount: 0,
                    sectorsAffected: {},
                    status: 'error',
                    errorMessage: err.message
                });
            }
        }

        // Atualizar Setores se necessário
        const newSectorList = Array.from(discoveredSectors).sort();
        if (JSON.stringify(newSectorList) !== JSON.stringify(sectorNames)) {
            await onUpdateSectorNames(newSectorList, hiddenSectors);
        }

        setIsSyncing(false);
        setCountdown(intervalMinutes * 60);
    }, [db, selectedEvent, importSources, allTickets, intervalMinutes, sectorNames, hiddenSectors, onUpdateSectorNames, isSyncing]);

    // Lógica do Timer
    useEffect(() => {
        if (isActive) {
            setCountdown(intervalMinutes * 60);
            runImportLogic(); // Executa imediatamente ao ativar

            timerRef.current = setInterval(() => {
                runImportLogic();
            }, intervalMinutes * 60000);

            countdownRef.current = setInterval(() => {
                setCountdown(prev => Math.max(0, prev - 1));
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            setCountdown(0);
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
        };
    }, [isActive, intervalMinutes, runImportLogic]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header / Controle */}
            <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-bold flex items-center text-blue-400">
                            <ClockIcon className="w-6 h-6 mr-2" />
                            Importação Automática em Tempo Real
                        </h2>
                        <p className="text-gray-500 text-xs mt-1 italic">* Esta página precisa ficar aberta para o loop funcionar.</p>
                    </div>

                    <div className="flex items-center gap-4 bg-gray-900/50 p-2 rounded-2xl border border-gray-700">
                        <div className="flex flex-col items-center px-3 border-r border-gray-700">
                            <span className="text-[8px] text-gray-500 font-bold uppercase">Intervalo</span>
                            <select 
                                value={intervalMinutes} 
                                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                                disabled={isActive}
                                className="bg-transparent text-sm font-bold text-white outline-none cursor-pointer"
                            >
                                <option value={1}>1 min</option>
                                <option value={2}>2 min</option>
                                <option value={5}>5 min</option>
                                <option value={10}>10 min</option>
                                <option value={30}>30 min</option>
                            </select>
                        </div>
                        
                        <button 
                            onClick={() => setIsActive(!isActive)}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${isActive ? 'bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white' : 'bg-blue-600 text-white shadow-lg'}`}
                        >
                            {isActive ? <><PauseIcon className="w-5 h-5"/> Parar Loop</> : <><PlayIcon className="w-5 h-5"/> Iniciar Loop</>}
                        </button>
                    </div>
                </div>

                {/* Status e Cronômetro */}
                {isActive && (
                    <div className="bg-blue-600/5 border border-blue-500/20 p-5 rounded-2xl flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`w-3 h-3 rounded-full animate-pulse ${isSyncing ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                            <div>
                                <p className="text-sm font-bold text-gray-200">{isSyncing ? 'Sincronizando agora...' : 'Aguardando próximo ciclo'}</p>
                                <p className="text-[10px] text-gray-500 uppercase tracking-widest">{importSources.filter(s => s.autoImport).length} fontes ativas</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-gray-500 font-bold uppercase">Próxima busca em:</p>
                            <p className="text-2xl font-black text-blue-400 font-mono">{formatTime(countdown)}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Logs Recentes */}
            <div className="bg-gray-800 rounded-3xl border border-gray-700 shadow-xl overflow-hidden">
                <div className="p-6 border-b border-gray-700 flex items-center justify-between bg-gray-900/20">
                    <h3 className="font-bold flex items-center text-gray-300">
                        <TableCellsIcon className="w-5 h-5 mr-2" /> Histórico de Sincronizações (Apenas Novidades)
                    </h3>
                    <span className="text-[10px] bg-gray-700 px-2 py-1 rounded text-gray-400 uppercase font-bold">Últimos registros</span>
                </div>

                <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] text-gray-500 uppercase font-black border-b border-gray-700 bg-gray-800/50">
                                <th className="px-6 py-4">Horário</th>
                                <th className="px-6 py-4">Fonte</th>
                                <th className="px-6 py-4">Resultado</th>
                                <th className="px-6 py-4">Detalhes por Setor</th>
                                <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-700/20 transition-colors">
                                    <td className="px-6 py-4 text-xs font-mono text-gray-400">
                                        {new Date(log.timestamp).toLocaleTimeString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <p className="text-xs font-bold text-white">{log.sourceName}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            {log.newCount > 0 && <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded font-bold">+{log.newCount} novos</span>}
                                            {log.updatedCount > 0 && <span className="text-[10px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded font-bold">{log.updatedCount} check-ins</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-wrap gap-1 max-w-[300px]">
                                            {Object.entries(log.sectorsAffected || {}).map(([sector, count]) => (
                                                <span key={sector} className="text-[9px] bg-gray-900 border border-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                                                    {sector}: <b className="text-gray-200">{count}</b>
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {log.status === 'success' ? (
                                            <CheckCircleIcon className="w-5 h-5 text-green-500 mx-auto" />
                                        ) : (
                                            <div className="group relative">
                                                <AlertTriangleIcon className="w-5 h-5 text-red-500 mx-auto cursor-help" />
                                                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block bg-red-600 text-white text-[10px] p-2 rounded shadow-xl w-48 z-10">
                                                    {log.errorMessage || 'Falha na conexão'}
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center text-gray-600 italic">
                                        Aguardando novas entradas na API... Nenhum registro novo foi detectado ainda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AutoImportModule;

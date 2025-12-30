
import React, { useState, useEffect } from 'react';
import { ImportSource, Event, Ticket, ImportLog } from '../../types';
import { Firestore, collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functionsInstance } from '../../firebaseConfig';
import { ClockIcon, CheckCircleIcon, AlertTriangleIcon, ShieldCheckIcon, CloudUploadIcon } from '../Icons';

interface AutoImportModuleProps {
  db: Firestore;
  selectedEvent: Event;
  importSources: ImportSource[];
}

const AutoImportModule: React.FC<AutoImportModuleProps> = ({ db, selectedEvent, importSources }) => {
    const [logs, setLogs] = useState<ImportLog[]>([]);
    const [isManualSyncing, setIsManualSyncing] = useState(false);
    
    useEffect(() => {
        if (!selectedEvent || !db) return;
        const q = query(
            collection(db, 'events', selectedEvent.id, 'import_logs'),
            orderBy('timestamp', 'desc'),
            limit(100)
        );
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as ImportLog));
            setLogs(list);
        });
        return () => unsub();
    }, [db, selectedEvent]);

    const handleManualServerSync = async () => {
        setIsManualSyncing(true);
        try {
            const manualSync = httpsCallable(functionsInstance, 'manualTriggerSync');
            await manualSync();
            alert("Sincronização do servidor solicitada! Os logs aparecerão abaixo em instantes.");
        } catch (e: any) {
            console.error("Erro ao disparar sync manual:", e);
            alert("Erro ao disparar sincronização: " + e.message);
        } finally {
            setIsManualSyncing(false);
        }
    };

    const activeSources = importSources.filter(s => s.autoImport);

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            <div className="bg-gray-800 p-8 rounded-[2.5rem] border border-blue-500/20 shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-600/10 rounded-3xl flex items-center justify-center text-blue-500 shadow-inner">
                            <ShieldCheckIcon className="w-10 h-10" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tighter">
                                Histórico de <span className="text-blue-500">Sincronização</span>
                            </h2>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">
                                Acompanhe as atualizações automáticas (Cloud) e manuais (Locais)
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-3">
                        <div className="flex items-center gap-4 bg-gray-900/50 p-4 rounded-3xl border border-gray-700">
                            <div className="text-right border-r border-gray-700 pr-4">
                                <p className="text-[10px] text-gray-500 font-bold uppercase">Fontes Automáticas</p>
                                <p className="text-xl font-black text-white">{activeSources.length}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${activeSources.length > 0 ? 'bg-green-500 shadow-green-500/50' : 'bg-gray-600'}`}></div>
                                <span className="text-xs font-black uppercase text-gray-400">{activeSources.length > 0 ? 'Agendado' : 'Desativado'}</span>
                            </div>
                        </div>
                        <button 
                            onClick={handleManualServerSync}
                            disabled={isManualSyncing}
                            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 ${isManualSyncing ? 'bg-gray-700 text-gray-500' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                        >
                            <CloudUploadIcon className={`w-4 h-4 ${isManualSyncing ? 'animate-bounce' : ''}`} />
                            {isManualSyncing ? 'Acionando Cloud...' : 'Forçar Cloud Sync (Servidor)'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-gray-800 rounded-[2.5rem] border border-gray-700 shadow-xl overflow-hidden">
                <div className="p-6 border-b border-gray-700 bg-gray-900/20">
                    <h3 className="font-black text-xs text-gray-400 uppercase tracking-widest flex items-center">
                        <ClockIcon className="w-4 h-4 mr-2" /> Log de Execuções Recentes
                    </h3>
                </div>

                <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-[10px] text-gray-500 uppercase font-black border-b border-gray-700 bg-gray-800/50">
                                <th className="px-6 py-4">Horário</th>
                                <th className="px-6 py-4">Origem / Tipo</th>
                                <th className="px-6 py-4">Fonte de Dados</th>
                                <th className="px-6 py-4">Novos / Check-ins</th>
                                <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-700/20 transition-colors">
                                    <td className="px-6 py-4 text-xs font-mono text-gray-400">
                                        {new Date(log.timestamp).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${log.type === 'cloud' ? 'bg-blue-600/10 border-blue-600/30 text-blue-400' : 'bg-orange-600/10 border-orange-600/30 text-orange-400'}`}>
                                            {log.type === 'cloud' ? 'AUTO / CLOUD' : 'MANUAL / LOCAL'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <p className="text-xs font-black text-white">{log.sourceName}</p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            {log.newCount > 0 ? (
                                                <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-black">+{log.newCount} NOVOS</span>
                                            ) : (
                                                <span className="text-[9px] text-gray-600 uppercase font-bold">0 Novos</span>
                                            )}
                                            {log.updatedCount > 0 && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full font-black">{log.updatedCount} CHECK-INS</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {log.status === 'success' ? (
                                            <CheckCircleIcon className="w-5 h-5 text-green-500 mx-auto" />
                                        ) : (
                                            <div className="group relative">
                                                <AlertTriangleIcon className="w-5 h-5 text-red-500 mx-auto cursor-help" />
                                                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block bg-red-600 text-white text-[10px] p-2 rounded shadow-xl w-48 z-10">
                                                    {log.errorMessage}
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center text-gray-600 italic">
                                        Nenhuma importação registrada recentemente.
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

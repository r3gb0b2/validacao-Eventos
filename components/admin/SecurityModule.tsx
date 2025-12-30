
import React, { useMemo } from 'react';
import { DisplayableScanLog } from '../../types';
import { ShieldCheckIcon, FingerPrintIcon, ExclamationCircleIcon, ClockIcon, UsersIcon, AlertTriangleIcon } from '../Icons';

interface SecurityModuleProps {
  scanHistory: DisplayableScanLog[];
}

const SecurityModule: React.FC<SecurityModuleProps> = ({ scanHistory = [] }) => {
    
    const analysis = useMemo(() => {
        const ticketCounts: Record<string, { count: number; operators: Set<string>; devices: Set<string>; lastStatus: string }> = {};
        const operatorAnomalies: Record<string, { invalid: number; used: number; total: number }> = {};
        const deviceLoad: Record<string, { errors: number; total: number }> = {};

        scanHistory.forEach(log => {
            const tId = log.ticketId;
            const op = log.operator || 'Desconhecido';
            const dev = log.deviceId || 'Desconhecido';

            // 1. Monitoramento de Ingressos
            if (!ticketCounts[tId]) {
                ticketCounts[tId] = { count: 0, operators: new Set(), devices: new Set(), lastStatus: log.status };
            }
            if (log.status === 'USED') {
                ticketCounts[tId].count++;
                ticketCounts[tId].operators.add(op);
                ticketCounts[tId].devices.add(dev);
            }

            // 2. Anomalias de Operador
            if (!operatorAnomalies[op]) operatorAnomalies[op] = { invalid: 0, used: 0, total: 0 };
            operatorAnomalies[op].total++;
            if (log.status === 'INVALID') operatorAnomalies[op].invalid++;
            if (log.status === 'USED') operatorAnomalies[op].used++;

            // 3. Carga de Dispositivo
            if (!deviceLoad[dev]) deviceLoad[dev] = { errors: 0, total: 0 };
            deviceLoad[dev].total++;
            if (['INVALID', 'USED', 'WRONG_SECTOR'].includes(log.status)) deviceLoad[dev].errors++;
        });

        const duplicates = Object.entries(ticketCounts)
            .filter(([_, data]) => data.count > 1)
            .map(([id, data]) => ({ id, ...data, operators: Array.from(data.operators) }))
            .sort((a, b) => b.count - a.count);

        const suspiciousOps = Object.entries(operatorAnomalies)
            .map(([name, data]) => ({ name, ...data, errorRate: ((data.invalid + data.used) / data.total) * 100 }))
            .filter(op => op.total > 5 && op.errorRate > 15)
            .sort((a, b) => b.errorRate - a.errorRate);

        const hotDevices = Object.entries(deviceLoad)
            .map(([id, data]) => ({ id, ...data, errorRate: (data.errors / data.total) * 100 }))
            .filter(d => d.total > 10)
            .sort((a, b) => b.errorRate - a.errorRate);

        return { duplicates, suspiciousOps, hotDevices };
    }, [scanHistory]);

    const threatLevel = useMemo(() => {
        const score = (analysis.duplicates.length * 5) + (analysis.suspiciousOps.length * 10);
        if (score > 50) return { label: 'ALTO', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500' };
        if (score > 20) return { label: 'MÉDIO', color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500' };
        return { label: 'BAIXO', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500' };
    }, [analysis]);

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {/* HUD DE SEGURANÇA */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`p-8 rounded-[2.5rem] border ${threatLevel.border} ${threatLevel.bg} shadow-2xl flex flex-col items-center text-center transition-all`}>
                    <ShieldCheckIcon className={`w-16 h-16 ${threatLevel.color} mb-4`} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Status de Risco</p>
                    <h2 className={`text-4xl font-black ${threatLevel.color}`}>{threatLevel.label}</h2>
                </div>
                <div className="p-8 rounded-[2.5rem] border border-gray-700 bg-gray-800 shadow-2xl flex flex-col items-center text-center">
                    <ExclamationCircleIcon className="w-16 h-16 text-orange-500 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ingressos Duplicados</p>
                    <h2 className="text-4xl font-black text-white">{analysis.duplicates.length}</h2>
                </div>
                <div className="p-8 rounded-[2.5rem] border border-gray-700 bg-gray-800 shadow-2xl flex flex-col items-center text-center">
                    <FingerPrintIcon className="w-16 h-16 text-blue-500 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Alvos Suspeitos</p>
                    <h2 className="text-4xl font-black text-white">{analysis.suspiciousOps.length + analysis.hotDevices.length}</h2>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* ALERTA DE REPETIÇÃO EM TEMPO REAL */}
                <div className="bg-gray-800 rounded-[2.5rem] border border-gray-700 shadow-xl overflow-hidden">
                    <div className="p-6 border-b border-gray-700 bg-gray-900/20 flex items-center justify-between">
                        <h3 className="font-black text-xs text-orange-500 uppercase tracking-widest flex items-center">
                            <AlertTriangleIcon className="w-4 h-4 mr-2" /> Monitor de Repetições Críticas
                        </h3>
                    </div>
                    <div className="divide-y divide-gray-700/50 max-h-[500px] overflow-y-auto custom-scrollbar">
                        {analysis.duplicates.map(ticket => (
                            <div key={ticket.id} className="p-6 space-y-4 hover:bg-orange-500/5 transition-all">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-[10px] font-black text-gray-500 uppercase">Ticket ID</p>
                                        <p className="text-lg font-black text-white font-mono">{ticket.id}</p>
                                    </div>
                                    <div className="bg-orange-600 text-white px-3 py-1 rounded-full text-[10px] font-black">
                                        {ticket.count}X TENTATIVAS
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {ticket.operators.map(op => (
                                        <span key={op} className="px-2 py-1 bg-gray-900 border border-gray-700 rounded-lg text-[10px] font-bold text-gray-300 flex items-center">
                                            <UsersIcon className="w-3 h-3 mr-1 text-orange-500" /> {op}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {analysis.duplicates.length === 0 && (
                            <div className="p-20 text-center text-gray-600 italic text-sm">Nenhuma repetição de ingresso detectada até o momento.</div>
                        )}
                    </div>
                </div>

                {/* ANÁLISE DE COMPORTAMENTO */}
                <div className="space-y-8">
                    {/* Operadores sob vigilância */}
                    <div className="bg-gray-800 rounded-[2.5rem] border border-gray-700 shadow-xl overflow-hidden">
                        <div className="p-6 border-b border-gray-700 bg-gray-900/20 flex items-center">
                            <h3 className="font-black text-xs text-red-500 uppercase tracking-widest flex items-center">
                                <UsersIcon className="w-4 h-4 mr-2" /> Operadores sob Vigilância
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            {analysis.suspiciousOps.map(op => (
                                <div key={op.name} className="bg-gray-900 border border-gray-700 p-4 rounded-2xl flex justify-between items-center">
                                    <div>
                                        <p className="text-sm font-black text-white">{op.name}</p>
                                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                                            {op.total} Scans | {op.invalid + op.used} Falhas
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-black text-red-500">{op.errorRate.toFixed(1)}%</p>
                                        <p className="text-[8px] text-gray-600 uppercase font-black">Taxa de Rejeição</p>
                                    </div>
                                </div>
                            ))}
                            {analysis.suspiciousOps.length === 0 && (
                                <p className="text-center py-8 text-gray-600 text-xs italic">Nenhum comportamento anormal de operador.</p>
                            )}
                        </div>
                    </div>

                    {/* Dispositivos Quentes */}
                    <div className="bg-gray-800 rounded-[2.5rem] border border-gray-700 shadow-xl overflow-hidden">
                        <div className="p-6 border-b border-gray-700 bg-gray-900/20 flex items-center">
                            <h3 className="font-black text-xs text-blue-500 uppercase tracking-widest flex items-center">
                                <FingerPrintIcon className="w-4 h-4 mr-2" /> Alvos de Falha (Dispositivos)
                            </h3>
                        </div>
                        <div className="p-4 space-y-4">
                            {analysis.hotDevices.map(dev => (
                                <div key={dev.id} className="bg-gray-900 border border-gray-700 p-4 rounded-2xl flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-500">
                                            <FingerPrintIcon className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-mono font-black text-white uppercase">{dev.id.slice(-12)}</p>
                                            <p className="text-[9px] text-gray-500 font-bold uppercase">{dev.total} Scans Processados</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-black text-blue-400">{dev.errorRate.toFixed(1)}%</p>
                                        <p className="text-[8px] text-gray-600 uppercase font-black">Índice de Erro</p>
                                    </div>
                                </div>
                            ))}
                            {analysis.hotDevices.length === 0 && (
                                <p className="text-center py-8 text-gray-600 text-xs italic">Dispositivos operando dentro da normalidade.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* LIVE AUDIT STREAM */}
            <div className="bg-black border border-gray-800 rounded-[2.5rem] shadow-2xl p-8">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tighter">Live Audit Stream</h3>
                </div>
                <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar font-mono text-[10px]">
                    {scanHistory.slice(0, 20).map((log, i) => (
                        <div key={i} className={`flex gap-4 p-2 rounded ${log.status === 'VALID' ? 'text-gray-500' : 'bg-red-500/5 text-red-400 border-l-2 border-red-500'}`}>
                            <span className="text-gray-700">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span className="font-bold uppercase w-20 truncate">{log.status}</span>
                            <span className="w-32 truncate">TICKET: {log.ticketId}</span>
                            <span className="flex-1 truncate">OP: {log.operator || 'SYSTEM'}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SecurityModule;

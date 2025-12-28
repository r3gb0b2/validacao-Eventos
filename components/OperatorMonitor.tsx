
import React, { useMemo } from 'react';
import { DisplayableScanLog, Event, Ticket } from '../types';
import { UsersIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, VideoCameraIcon, TableCellsIcon } from './Icons';

interface OperatorMonitorProps {
  event: Event;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  isLoading?: boolean;
  isEmbedded?: boolean; 
}

const OperatorMonitor: React.FC<OperatorMonitorProps> = ({ event, allTickets, scanHistory, isLoading = false, isEmbedded = false }) => {
  
  const stats = useMemo(() => {
    if (!scanHistory || scanHistory.length === 0) return [];

    const operatorMap: Record<string, {
      name: string;
      total: number;
      valid: number;
      invalid: number; 
      used: number;    
      wrongSector: number;
      error: number;
      lastSeen: number;
      sectors: Record<string, number>;
      timeline: Record<string, number>;
    }> = {};

    // Processamento de alto desempenho para até 20.000 logs
    for (let i = 0; i < scanHistory.length; i++) {
      const log = scanHistory[i];
      const op = log.operator || 'Sem Nome';
      
      if (!operatorMap[op]) {
        operatorMap[op] = {
          name: op,
          total: 0,
          valid: 0,
          invalid: 0,
          used: 0,
          wrongSector: 0,
          error: 0,
          lastSeen: 0,
          sectors: {},
          timeline: {}
        };
      }

      const s = operatorMap[op];
      s.total++;
      if (log.status === 'VALID') s.valid++;
      else if (log.status === 'INVALID') s.invalid++;
      else if (log.status === 'USED') s.used++;
      else if (log.status === 'WRONG_SECTOR') s.wrongSector++;
      else if (log.status === 'ERROR') s.error++;

      if (log.timestamp > s.lastSeen) s.lastSeen = log.timestamp;

      const sector = log.ticketSector || 'Desconhecido';
      s.sectors[sector] = (s.sectors[sector] || 0) + 1;
    }

    return Object.values(operatorMap).sort((a, b) => (Number(b.valid) || 0) - (Number(a.valid) || 0));
  }, [scanHistory]);

  const totalScans = scanHistory.length;
  
  // Fonte da verdade: Ingressos com status USED no banco
  const totalValidGlobal = useMemo(() => {
      return allTickets.filter(t => t.status === 'USED').length;
  }, [allTickets]);

  const activeNowCount = useMemo(() => {
      return stats.filter(s => (Date.now() - (Number(s.lastSeen) || 0)) < 300000).length;
  }, [stats]);

  return (
    <div className={`${isEmbedded ? 'p-6' : 'min-h-screen bg-gray-900 text-white font-sans p-4 md:p-8 pb-20'}`}>
      <div className={`w-full ${isEmbedded ? '' : 'max-w-7xl mx-auto space-y-8'}`}>
        
        {!isEmbedded && (
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-2xl mb-8">
              <div className="flex items-center space-x-4">
                <div className="bg-orange-600 p-3 rounded-xl shadow-lg shadow-orange-900/20">
                  <VideoCameraIcon className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-tight">{event.name}</h1>
                  <p className="text-gray-400 text-sm font-medium flex items-center">
                    <UsersIcon className="w-4 h-4 mr-1.5 text-orange-500" />
                    Monitoramento de Operadores (Sincronizado)
                  </p>
                </div>
              </div>
              
              <div className="flex items-center bg-gray-900/50 px-4 py-2 rounded-full border border-gray-700">
                <span className="relative flex h-3 w-3 mr-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-xs font-bold text-green-500 uppercase tracking-widest">Tempo Real</span>
              </div>
            </header>
        )}

        {/* Dash de Resumo */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${isEmbedded ? 'mb-8' : ''}`}>
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl border-l-4 border-l-green-500">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Total Validado (Banco)</p>
            <p className="text-4xl font-black text-green-400">{totalValidGlobal}</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl border-l-4 border-l-blue-500">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Operadores Online</p>
            <p className="text-4xl font-black text-white">{activeNowCount}</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl border-l-4 border-l-orange-500">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Total de Tentativas</p>
            <p className="text-4xl font-black text-orange-400">{totalScans}</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl border-l-4 border-l-red-500">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2">Recusados (Scan)</p>
            <p className="text-4xl font-black text-red-500">{totalScans - stats.reduce((acc, curr) => acc + curr.valid, 0)}</p>
          </div>
        </div>

        {/* Grid de Operadores */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stats.map(op => {
            const isActive = (Date.now() - (Number(op.lastSeen) || 0)) < 300000;
            const successRate = (Number(op.total) || 0) > 0 ? ((Number(op.valid) / Number(op.total)) * 100).toFixed(1) : '0';
            const topSector = Object.entries(op.sectors).sort((a,b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))[0]?.[0] || '---';

            return (
              <div key={op.name} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-xl hover:border-orange-500/40 transition-all duration-300 group">
                <div className="p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border transition-all ${isActive ? 'bg-orange-600 border-orange-400 text-white rotate-3' : 'bg-gray-700 border-gray-600 text-gray-400'}`}>
                        {op.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-white group-hover:text-orange-400 transition-colors">{op.name}</h3>
                        <p className="text-[10px] text-gray-500 font-bold uppercase flex items-center">
                          <ClockIcon className="w-3 h-3 mr-1" />
                          Último: {new Date(op.lastSeen).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded text-[10px] font-black tracking-tighter ${isActive ? 'bg-green-500/10 text-green-400' : 'bg-gray-900 text-gray-600'}`}>
                      {isActive ? 'ONLINE' : 'AUSENTE'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-gray-900/80 p-3 rounded-xl border border-gray-700 shadow-inner">
                    <div className="text-center flex-1 border-r border-gray-700">
                      <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Check-ins</p>
                      <p className="text-xl font-black text-green-400">{op.valid}</p>
                    </div>
                    <div className="text-center flex-1">
                      <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Bruto (Scans)</p>
                      <p className="text-xl font-black text-white">{op.total}</p>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between items-end">
                      <p className="text-[10px] font-black text-gray-500 uppercase">Qualidade da Operação</p>
                      <p className="text-sm font-black text-green-400">{successRate}%</p>
                    </div>
                    <div className="w-full bg-gray-900 h-2 rounded-full overflow-hidden flex">
                      <div className="bg-green-500 h-full" style={{ width: `${(Number(op.total) || 0) > 0 ? (Number(op.valid) / Number(op.total)) * 100 : 0}%` }}></div>
                      <div className="bg-red-500 h-full" style={{ width: `${(Number(op.total) || 0) > 0 ? ((Number(op.invalid) + Number(op.error)) / Number(op.total)) * 100 : 0}%` }}></div>
                      <div className="bg-yellow-500 h-full" style={{ width: `${(Number(op.total) || 0) > 0 ? (Number(op.used) / Number(op.total)) * 100 : 0}%` }}></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-900/50 p-2 rounded-lg border border-gray-700/50 text-center">
                      <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Inválidos</p>
                      <p className="text-sm font-black text-red-500">{op.invalid}</p>
                    </div>
                    <div className="bg-gray-900/50 p-2 rounded-lg border border-gray-700/50 text-center">
                      <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Repetidos</p>
                      <p className="text-sm font-black text-yellow-500">{op.used}</p>
                    </div>
                    <div className="bg-gray-900/50 p-2 rounded-lg border border-gray-700/50 text-center">
                      <p className="text-[9px] text-gray-500 font-bold uppercase mb-1">Outro Setor</p>
                      <p className="text-sm font-black text-orange-500">{op.wrongSector}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-700 flex justify-between items-center text-[10px] font-bold">
                    <span className="text-gray-500 uppercase">Filtro / Setor:</span>
                    <span className="text-gray-300 truncate max-w-[120px]">{topSector}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {stats.length === 0 && (
            <div className="col-span-full py-20 text-center bg-gray-800/50 rounded-3xl border-2 border-dashed border-gray-700">
              <TableCellsIcon className="w-16 h-16 mx-auto text-gray-700 mb-4" />
              <p className="text-xl font-bold text-gray-500">Nenhum operador detectado...</p>
              <p className="text-gray-600">Aguardando scans no histórico (Limite: 20.000).</p>
            </div>
          )}
        </div>

        {/* Resumo de Produtividade em Tabela (Ranking) */}
        {stats.length > 0 && (
            <div className="mt-12 bg-gray-800 rounded-3xl border border-gray-700 shadow-2xl overflow-hidden">
                <div className="bg-gray-700/50 p-6 border-b border-gray-700 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <TableCellsIcon className="w-6 h-6 text-orange-500" />
                        <h2 className="text-xl font-bold">Produtividade (Baseado nos últimos 20.000 scans)</h2>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-black tracking-widest">
                            <tr>
                                <th className="px-6 py-4">Operador</th>
                                <th className="px-6 py-4 text-center">Válidos</th>
                                <th className="px-6 py-4 text-center">Tentativas</th>
                                <th className="px-6 py-4 text-center">Taxa Sucesso</th>
                                <th className="px-6 py-4 text-right">Última</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {stats.map((op, idx) => (
                                <tr key={op.name} className="hover:bg-gray-700/30 transition-colors">
                                    <td className="px-6 py-4 font-bold">
                                        {op.name}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="bg-green-500/10 text-green-400 px-3 py-1 rounded-full font-black border border-green-500/20">
                                            {op.valid}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-center font-medium text-gray-300">
                                        {op.total}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="text-blue-400 font-bold">
                                            {((op.valid / op.total) * 100).toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right text-xs text-gray-500 font-mono">
                                        {new Date(op.lastSeen).toLocaleTimeString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>
      
      {!isEmbedded && (
          <button 
            onClick={() => window.location.href = window.location.pathname}
            className="fixed bottom-6 right-6 bg-gray-800 hover:bg-gray-700 text-white p-4 rounded-full shadow-2xl border border-gray-600 flex items-center space-x-2 transition-all hover:scale-105"
          >
            <CheckCircleIcon className="w-6 h-6 text-orange-500" />
            <span className="font-bold text-sm">Voltar ao Início</span>
          </button>
      )}
    </div>
  );
};

export default OperatorMonitor;

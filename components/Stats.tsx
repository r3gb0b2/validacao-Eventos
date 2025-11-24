
import React, { useMemo, useState } from 'react';
import { Ticket } from '../types';
import { TableCellsIcon } from './Icons';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
}

const Stats: React.FC<StatsProps> = ({ allTickets = [], sectorNames = [] }) => {
    const [isGrouped, setIsGrouped] = useState(true);
    
    // 1. Calculate General Stats (KPIs)
    const generalStats = useMemo(() => {
        if (!allTickets) return { total: 0, scanned: 0, remaining: 0, percentage: '0.0' };
        const total = allTickets.length;
        const scanned = allTickets.filter(t => t.status === 'USED').length;
        const remaining = total - scanned;
        const percentage = total > 0 ? ((scanned / total) * 100).toFixed(1) : '0.0';
        return { total, scanned, remaining, percentage };
    }, [allTickets]);

    // 2. Calculate Sector Stats (Grouped or Raw)
    const tableStats = useMemo(() => {
        // Map to store stats: Key -> { total, scanned, originalName }
        const statsMap: Record<string, { total: number; scanned: number; displayName: string }> = {};
        const safeSectorNames = sectorNames || [];

        // Helper to get the key based on grouping setting
        const getKey = (name: string) => {
            if (!name) return 'Desconhecido';
            return isGrouped ? name.trim().toLowerCase() : name;
        };

        // Helper to formatting display name (capitalize first letter if grouped)
        const formatName = (name: string) => {
            if (!isGrouped) return name;
            return name.charAt(0).toUpperCase() + name.slice(1);
        };

        // 1. Initialize with Configured Sectors (so they appear even if empty)
        safeSectorNames.forEach(name => {
            const key = getKey(name);
            if (!statsMap[key]) {
                statsMap[key] = { 
                    total: 0, 
                    scanned: 0, 
                    displayName: isGrouped ? name.trim() : name // Prefer the configured casing
                };
            }
        });

        // 2. Iterate Tickets
        allTickets.forEach(ticket => {
            const rawSector = ticket.sector || 'Desconhecido';
            const key = getKey(rawSector);

            if (!statsMap[key]) {
                statsMap[key] = { 
                    total: 0, 
                    scanned: 0, 
                    displayName: isGrouped ? formatName(rawSector.trim()) : rawSector 
                };
            }

            statsMap[key].total += 1;
            if (ticket.status === 'USED') {
                statsMap[key].scanned += 1;
            }
        });

        // 3. Convert to Array and Sort
        // We try to respect the order of sectorNames config if possible
        const result = Object.values(statsMap).sort((a, b) => {
            // Sort logic: Configured sectors first, then others alphabetically
            const idxA = safeSectorNames.findIndex(s => getKey(s) === getKey(a.displayName));
            const idxB = safeSectorNames.findIndex(s => getKey(s) === getKey(b.displayName));
            
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.displayName.localeCompare(b.displayName);
        });

        return result;
    }, [allTickets, sectorNames, isGrouped]);

  return (
    <div className="space-y-6">
      {/* 1. Top Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-blue-500 shadow-md">
              <p className="text-gray-400 text-sm font-medium uppercase">Total de Ingressos</p>
              <p className="text-3xl font-bold text-white mt-1">{generalStats.total}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md">
              <p className="text-gray-400 text-sm font-medium uppercase">Check-ins Realizados</p>
              <p className="text-3xl font-bold text-green-400 mt-1">{generalStats.scanned}</p>
          </div>
           <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-orange-500 shadow-md">
              <p className="text-gray-400 text-sm font-medium uppercase">Taxa de Ocupação</p>
              <p className="text-3xl font-bold text-orange-400 mt-1">{generalStats.percentage}%</p>
              <div className="w-full bg-gray-700 rounded-full h-2.5 mt-2">
                <div className="bg-orange-500 h-2.5 rounded-full" style={{ width: `${generalStats.percentage}%` }}></div>
              </div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-yellow-500 shadow-md">
              <p className="text-gray-400 text-sm font-medium uppercase">Faltam Entrar</p>
              <p className="text-3xl font-bold text-yellow-400 mt-1">{generalStats.remaining}</p>
          </div>
      </div>

      {/* 2. Detailed Sector Table */}
      <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700">
          <div className="bg-gray-700 px-6 py-4 border-b border-gray-600 flex justify-between items-center flex-wrap gap-2">
              <div className="flex items-center">
                  <TableCellsIcon className="w-5 h-5 mr-2 text-gray-400" />
                  <h3 className="text-lg font-bold text-white">Detalhamento por Setor</h3>
              </div>
              
              {/* Toggle Grouping */}
              <label className="flex items-center cursor-pointer bg-gray-800 px-3 py-1.5 rounded-full border border-gray-600 hover:border-gray-500 transition-colors">
                  <div className="relative">
                      <input 
                        type="checkbox" 
                        className="sr-only" 
                        checked={isGrouped} 
                        onChange={() => setIsGrouped(!isGrouped)} 
                      />
                      <div className={`block w-10 h-6 rounded-full transition-colors ${isGrouped ? 'bg-orange-600' : 'bg-gray-600'}`}></div>
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isGrouped ? 'transform translate-x-4' : ''}`}></div>
                  </div>
                  <div className="ml-3 text-sm text-gray-300 font-medium select-none">
                      Agrupar Semelhantes
                  </div>
              </label>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead>
                      <tr className="text-gray-400 border-b border-gray-600 text-sm uppercase">
                          <th className="px-6 py-3 font-medium">Setor</th>
                          <th className="px-6 py-3 font-medium text-center">Progresso</th>
                          <th className="px-6 py-3 font-medium text-center">Total</th>
                          <th className="px-6 py-3 font-medium text-center">Entradas</th>
                          <th className="px-6 py-3 font-medium text-center">Restantes</th>
                          <th className="px-6 py-3 font-medium text-center">%</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                      {tableStats.map((stats) => {
                          const remaining = stats.total - stats.scanned;
                          const percentage = stats.total > 0 ? ((stats.scanned / stats.total) * 100).toFixed(1) : '0.0';
                          
                          return (
                              <tr key={stats.displayName} className="hover:bg-gray-700/50 transition-colors">
                                  <td className="px-6 py-4 font-medium text-white">{stats.displayName}</td>
                                  <td className="px-6 py-4 w-1/3 min-w-[150px]">
                                      <div className="w-full bg-gray-900 rounded-full h-2">
                                          <div 
                                            className="bg-green-500 h-2 rounded-full transition-all duration-500" 
                                            style={{ width: `${percentage}%` }}
                                          ></div>
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-gray-300">{stats.total}</td>
                                  <td className="px-6 py-4 text-center text-green-400 font-bold">{stats.scanned}</td>
                                  <td className="px-6 py-4 text-center text-yellow-400">{remaining}</td>
                                  <td className="px-6 py-4 text-center text-white font-bold">{percentage}%</td>
                              </tr>
                          );
                      })}
                  </tbody>
              </table>
          </div>
          {tableStats.length === 0 && (
              <div className="p-6 text-center text-gray-500">
                  Nenhum setor configurado ou ingressos importados.
              </div>
          )}
      </div>
    </div>
  );
};

export default Stats;

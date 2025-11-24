
import React, { useMemo } from 'react';
import { Ticket } from '../types';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
}

const Stats: React.FC<StatsProps> = ({ allTickets = [], sectorNames = [] }) => {
    
    // 1. Calculate General Stats (KPIs)
    const generalStats = useMemo(() => {
        if (!allTickets) return { total: 0, scanned: 0, remaining: 0, percentage: '0.0' };
        const total = allTickets.length;
        const scanned = allTickets.filter(t => t.status === 'USED').length;
        const remaining = total - scanned;
        const percentage = total > 0 ? ((scanned / total) * 100).toFixed(1) : '0.0';
        return { total, scanned, remaining, percentage };
    }, [allTickets]);

    // 2. Calculate Grouped Sector Stats (The Table)
    const groupedSectorStats = useMemo(() => {
        const statsMap: Record<string, { total: number; scanned: number }> = {};
        const safeSectorNames = sectorNames || [];

        // Initialize with configured sectors to ensure custom order and existence (even if count is 0)
        safeSectorNames.forEach(name => {
            const normalized = name.trim();
            if (!normalized) return;
            if (!statsMap[normalized]) {
                statsMap[normalized] = { total: 0, scanned: 0 };
            }
        });

        // Iterate tickets and aggregate
        allTickets.forEach(ticket => {
            const normalized = (ticket.sector || 'Desconhecido').trim();
            
            // Initialize if it wasn't in sectorNames list (e.g. imported sector not yet saved in config)
            if (!statsMap[normalized]) {
                statsMap[normalized] = { total: 0, scanned: 0 };
            }

            statsMap[normalized].total += 1;
            if (ticket.status === 'USED') {
                statsMap[normalized].scanned += 1;
            }
        });

        // Convert map to array for rendering
        // We prioritize the order in 'sectorNames', then append any others found in tickets
        const definedOrder = safeSectorNames.map(s => s.trim()).filter(s => !!s);
        const uniqueDefinedOrder = Array.from(new Set(definedOrder)); // Remove duplicates in config
        
        const result = uniqueDefinedOrder.map(name => ({
            name,
            ...statsMap[name]
        }));

        // Add extra sectors found in tickets that aren't in config
        Object.keys(statsMap).forEach(key => {
            if (!uniqueDefinedOrder.includes(key)) {
                result.push({
                    name: key,
                    ...statsMap[key]
                });
            }
        });

        return result;
    }, [allTickets, sectorNames]);

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
          <div className="bg-gray-700 px-6 py-4 border-b border-gray-600">
              <h3 className="text-lg font-bold text-white">Detalhamento por Setor (Agrupado)</h3>
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
                      {groupedSectorStats.map((stats) => {
                          const remaining = stats.total - stats.scanned;
                          const percentage = stats.total > 0 ? ((stats.scanned / stats.total) * 100).toFixed(1) : '0.0';
                          
                          return (
                              <tr key={stats.name} className="hover:bg-gray-700/50 transition-colors">
                                  <td className="px-6 py-4 font-medium text-white">{stats.name}</td>
                                  <td className="px-6 py-4 w-1/3">
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
          {groupedSectorStats.length === 0 && (
              <div className="p-6 text-center text-gray-500">
                  Nenhum setor configurado ou ingressos importados.
              </div>
          )}
      </div>
    </div>
  );
};

export default Stats;


import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, SectorGroup } from '../types';
import { TableCellsIcon, FunnelIcon, PlusCircleIcon, TrashIcon, CogIcon } from './Icons';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
  hiddenSectors?: string[]; 
  viewMode: 'raw' | 'grouped';
  onViewModeChange?: (mode: 'raw' | 'grouped') => void;
  groups: SectorGroup[];
  onGroupsChange?: (groups: SectorGroup[]) => void;
  isReadOnly?: boolean; 
}

const Stats: React.FC<StatsProps> = ({ 
    allTickets = [], 
    sectorNames = [], 
    hiddenSectors = [],
    viewMode, 
    onViewModeChange, 
    groups = [], 
    onGroupsChange,
    isReadOnly = false 
}) => {
    const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);

    const visibleSectorNames = useMemo(() => {
        return (sectorNames || []).filter(name => !hiddenSectors.includes(name));
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        if (visibleSectorNames.length > 0 && selectedSectors.length === 0) {
            setSelectedSectors(visibleSectorNames);
        }
    }, [visibleSectorNames]);

    const normalize = (s: string) => (s || '').trim().toLowerCase();

    // LÓGICA DE FILTRO DE CONTAGEM
    // 'manual_locator' só conta se status for USED.
    // Outras origens contam sempre.
    const getGeneralStats = (tickets: Ticket[]) => {
        const filtered = tickets.filter(t => {
            const ticketSectorNorm = normalize(t.sector);
            return selectedSectors.some(sel => normalize(sel) === ticketSectorNorm);
        });

        const total = filtered.filter(t => 
            t.status !== 'STANDBY' && 
            (t.source !== 'manual_locator' || t.status === 'USED')
        ).length;

        const scanned = filtered.filter(t => t.status === 'USED').length;
        const remaining = Math.max(0, total - scanned);
        const percentage = total > 0 ? ((scanned / total) * 100).toFixed(1) : '0.0';
        
        return { total, scanned, remaining, percentage };
    };

    const generalStats = useMemo(() => getGeneralStats(allTickets), [allTickets, selectedSectors]);

    const tableData = useMemo(() => {
        const statsMap: Record<string, { total: number; scanned: number; displayName: string }> = {};
        
        visibleSectorNames.forEach(sectorName => {
            if (!selectedSectors.includes(sectorName)) return;

            const sectorTickets = allTickets.filter(t => normalize(t.sector) === normalize(sectorName));
            const stats = getGeneralStats(sectorTickets);

            statsMap[sectorName] = {
                total: stats.total,
                scanned: stats.scanned,
                displayName: sectorName
            };
        });
        
        return Object.values(statsMap).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }, [allTickets, visibleSectorNames, selectedSectors]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-blue-500 shadow-md">
              <p className="text-gray-400 text-[10px] font-bold uppercase">Carga Total</p>
              <p className="text-3xl font-black text-white mt-1">{generalStats.total}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-green-500 shadow-md">
              <p className="text-gray-400 text-[10px] font-bold uppercase">Check-ins</p>
              <p className="text-3xl font-black text-green-400 mt-1">{generalStats.scanned}</p>
          </div>
           <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-orange-500 shadow-md">
              <p className="text-gray-400 text-[10px] font-bold uppercase">Ocupação</p>
              <p className="text-3xl font-black text-orange-400 mt-1">{generalStats.percentage}%</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg border-l-4 border-yellow-500 shadow-md">
              <p className="text-gray-400 text-[10px] font-bold uppercase">Restantes</p>
              <p className="text-3xl font-black text-yellow-400 mt-1">{generalStats.remaining}</p>
          </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center"><TableCellsIcon className="w-5 h-5 mr-2" /> Detalhamento</h3>
              <div className="relative" ref={filterRef}>
                  <button onClick={() => setIsFilterOpen(!isFilterOpen)} className="bg-gray-700 px-3 py-1 rounded text-xs font-bold text-gray-300">Filtro ({selectedSectors.length})</button>
                  {isFilterOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2">
                          {visibleSectorNames.map(sector => (
                              <label key={sector} className="flex items-center p-2 hover:bg-gray-700 cursor-pointer text-xs">
                                  <input type="checkbox" checked={selectedSectors.includes(sector)} onChange={() => {
                                      if (selectedSectors.includes(sector)) setSelectedSectors(selectedSectors.filter(s => s !== sector));
                                      else setSelectedSectors([...selectedSectors, sector]);
                                  }} className="mr-2" />
                                  {sector}
                              </label>
                          ))}
                      </div>
                  )}
              </div>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                  <thead>
                      <tr className="text-gray-500 border-b border-gray-700">
                          <th className="py-2">Setor</th>
                          <th className="py-2 text-center">Carga</th>
                          <th className="py-2 text-center">Entradas</th>
                          <th className="py-2 text-center">Saldo</th>
                          <th className="py-2 text-center">%</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                      {tableData.map((stats) => (
                          <tr key={stats.displayName} className="hover:bg-gray-700/30">
                              <td className="py-3 text-white font-medium">{stats.displayName}</td>
                              <td className="py-3 text-center text-gray-400">{stats.total}</td>
                              <td className="py-3 text-center text-green-400 font-bold">{stats.scanned}</td>
                              <td className="py-3 text-center text-yellow-400">{stats.total - stats.scanned}</td>
                              <td className="py-3 text-center font-bold">{stats.total > 0 ? ((stats.scanned/stats.total)*100).toFixed(1) : 0}%</td>
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};

export default Stats;

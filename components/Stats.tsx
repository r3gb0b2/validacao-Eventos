
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, SectorGroup } from '../types.ts';
import { TableCellsIcon, FunnelIcon, PlusCircleIcon, TrashIcon, CogIcon, UsersIcon } from './Icons.tsx';

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

    const nonSecretTickets = useMemo(() => {
        return allTickets.filter(t => t.source !== 'secret_generator');
    }, [allTickets]);

    const visibleSectorNames = useMemo(() => {
        return (sectorNames || []).filter(name => !hiddenSectors.includes(name));
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        if (visibleSectorNames.length > 0 && selectedSectors.length === 0) {
            setSelectedSectors(visibleSectorNames);
        }
    }, [visibleSectorNames]);

    const normalize = (s: string) => (s || '').trim().toLowerCase();

    const getGeneralStats = (tickets: Ticket[]) => {
        const filtered = tickets.filter(t => {
            if (t.source === 'secret_generator') return false;
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

    const generalStats = useMemo(() => getGeneralStats(nonSecretTickets), [nonSecretTickets, selectedSectors]);

    const tableData = useMemo(() => {
        const result: { total: number; scanned: number; displayName: string; isGroup: boolean }[] = [];
        const processedSectors = new Set<string>();

        if (viewMode === 'grouped' && groups.length > 0) {
            groups.forEach(group => {
                const groupSectors = (group.includedSectors || []).filter(s => visibleSectorNames.includes(s));
                const groupTickets = nonSecretTickets.filter(t => 
                    groupSectors.some(gs => normalize(gs) === normalize(t.sector))
                );

                const stats = getGeneralStats(groupTickets);
                result.push({
                    displayName: group.name,
                    total: stats.total,
                    scanned: stats.scanned,
                    isGroup: true
                });

                groupSectors.forEach(s => processedSectors.add(normalize(s)));
            });

            visibleSectorNames.forEach(sectorName => {
                if (!processedSectors.has(normalize(sectorName))) {
                    const sectorTickets = nonSecretTickets.filter(t => normalize(t.sector) === normalize(sectorName));
                    const stats = getGeneralStats(sectorTickets);
                    result.push({
                        displayName: sectorName,
                        total: stats.total,
                        scanned: stats.scanned,
                        isGroup: false
                    });
                }
            });
        } else {
            visibleSectorNames.forEach(sectorName => {
                const sectorTickets = nonSecretTickets.filter(t => normalize(t.sector) === normalize(sectorName));
                const stats = getGeneralStats(sectorTickets);
                result.push({
                    displayName: sectorName,
                    total: stats.total,
                    scanned: stats.scanned,
                    isGroup: false
                });
            });
        }
        
        return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }, [nonSecretTickets, visibleSectorNames, selectedSectors, viewMode, groups]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl">
              <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest">Carga Total</p>
              <p className="text-4xl font-black text-white mt-1">{generalStats.total}</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl">
              <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest">Check-ins</p>
              <p className="text-4xl font-black text-green-400 mt-1">{generalStats.scanned}</p>
          </div>
           <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl">
              <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest">Ocupação</p>
              <p className="text-4xl font-black text-orange-400 mt-1">{generalStats.percentage}%</p>
          </div>
          <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl">
              <p className="text-gray-500 text-[10px] font-black uppercase tracking-widest">Restantes</p>
              <p className="text-4xl font-black text-yellow-400 mt-1">{generalStats.remaining}</p>
          </div>
      </div>

      <div className="bg-gray-800 rounded-[2rem] p-6 border border-gray-700 shadow-2xl">
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-black text-white flex items-center uppercase tracking-tighter">
                <TableCellsIcon className="w-5 h-5 mr-2 text-orange-500" /> 
                Detalhamento {viewMode === 'grouped' ? 'Agrupado' : 'por Setor'}
              </h3>
              
              <div className="relative" ref={filterRef}>
                  <button 
                    onClick={() => setIsFilterOpen(!isFilterOpen)} 
                    className="bg-gray-900 border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-xl text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center transition-all"
                  >
                    <FunnelIcon className="w-3 h-3 mr-2" />
                    Filtro ({selectedSectors.length})
                  </button>
                  {isFilterOpen && (
                      <div className="absolute right-0 mt-3 w-64 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl z-50 p-3 animate-fade-in">
                          <p className="text-[10px] font-black text-gray-600 uppercase mb-2 px-2">Setores Disponíveis</p>
                          <div className="max-h-60 overflow-y-auto">
                            {visibleSectorNames.map(sector => (
                                <label key={sector} className="flex items-center p-2.5 hover:bg-gray-800 rounded-xl cursor-pointer text-xs">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedSectors.includes(sector)} 
                                        onChange={() => {
                                            if (selectedSectors.includes(sector)) setSelectedSectors(selectedSectors.filter(s => s !== sector));
                                            else setSelectedSectors([...selectedSectors, sector]);
                                        }} 
                                        className="mr-3 w-4 h-4 accent-orange-500" 
                                    />
                                    <span className="text-gray-300">{sector}</span>
                                </label>
                            ))}
                          </div>
                      </div>
                  )}
              </div>
          </div>

          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead>
                      <tr className="text-[10px] text-gray-500 uppercase font-black border-b border-gray-700 bg-gray-900/20">
                          <th className="px-4 py-4">Item / Categoria</th>
                          <th className="py-4 text-center">Carga</th>
                          <th className="py-4 text-center">Entradas</th>
                          <th className="py-4 text-center">Saldo</th>
                          <th className="px-4 py-4 text-center">% Ocupação</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                      {tableData.map((stats) => (
                          <tr key={stats.displayName} className={`group hover:bg-gray-700/30 transition-all ${stats.isGroup ? 'bg-orange-500/5' : ''}`}>
                              <td className="px-4 py-4">
                                  <div className="flex items-center">
                                      <span className={`w-1.5 h-6 rounded-full mr-3 ${stats.isGroup ? 'bg-orange-500' : 'bg-gray-700'}`}></span>
                                      <p className={`text-sm font-bold ${stats.isGroup ? 'text-orange-400' : 'text-white'}`}>{stats.displayName}</p>
                                  </div>
                              </td>
                              <td className="py-4 text-center text-sm font-bold text-gray-400">{stats.total}</td>
                              <td className="py-4 text-center text-lg font-black text-green-400">{stats.scanned}</td>
                              <td className="py-4 text-center text-sm font-bold text-yellow-500/80">{stats.total - stats.scanned}</td>
                              <td className="px-4 py-4 text-center">
                                  <span className="text-sm font-black text-white">{stats.total > 0 ? ((stats.scanned/stats.total)*100).toFixed(1) : 0}%</span>
                              </td>
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

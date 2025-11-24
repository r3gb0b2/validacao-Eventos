
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticket, SectorGroup } from '../types';
import { TableCellsIcon, FunnelIcon, PlusCircleIcon, TrashIcon, CogIcon } from './Icons';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
  // New props for controlled mode
  viewMode: 'raw' | 'grouped';
  onViewModeChange?: (mode: 'raw' | 'grouped') => void;
  groups: SectorGroup[];
  onGroupsChange?: (groups: SectorGroup[]) => void;
  isReadOnly?: boolean; // If true, hides controls
}

const Stats: React.FC<StatsProps> = ({ 
    allTickets = [], 
    sectorNames = [], 
    viewMode, 
    onViewModeChange, 
    groups, 
    onGroupsChange,
    isReadOnly = false 
}) => {
    // --- LOCAL STATE (UI Only) ---
    const [isConfiguringGroups, setIsConfiguringGroups] = useState(false);
    
    // Config Form State
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupSectors, setNewGroupSectors] = useState<string[]>([]);

    // Filter State (UI Only - Viewer can filter locally if they want, or we can hide it too. Usually filtering is fine for viewers)
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
    const filterRef = useRef<HTMLDivElement>(null);

    // Initialize selected sectors when sectorNames changes
    useEffect(() => {
        if (sectorNames.length > 0) {
            setSelectedSectors(sectorNames);
        }
    }, [sectorNames]);

    // Close filter dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // --- HELPERS ---
    const normalize = (s: string) => s.trim().toLowerCase();

    // Toggle a sector in the filter
    const toggleSectorFilter = (sector: string) => {
        if (selectedSectors.includes(sector)) {
             setSelectedSectors(selectedSectors.filter(s => s !== sector));
        } else {
            setSelectedSectors([...selectedSectors, sector]);
        }
    };
    
    const handleSelectAll = () => setSelectedSectors(sectorNames);
    const handleClearAll = () => setSelectedSectors([]);

    // --- GROUP MANAGEMENT ---
    const handleAddGroup = () => {
        if (!newGroupName.trim()) {
            alert("Digite um nome para o grupo.");
            return;
        }
        if (newGroupSectors.length === 0) {
            alert("Selecione pelo menos um setor para o grupo.");
            return;
        }
        
        const newGroup: SectorGroup = {
            id: Date.now().toString(),
            name: newGroupName.trim(),
            includedSectors: newGroupSectors
        };

        if (onGroupsChange) {
            onGroupsChange([...groups, newGroup]);
        }
        setNewGroupName('');
        setNewGroupSectors([]);
    };

    const handleDeleteGroup = (id: string) => {
        if (confirm("Excluir este grupo?")) {
            if (onGroupsChange) {
                onGroupsChange(groups.filter(g => g.id !== id));
            }
        }
    };

    const toggleSectorInNewGroup = (sector: string) => {
        if (newGroupSectors.includes(sector)) {
            setNewGroupSectors(newGroupSectors.filter(s => s !== sector));
        } else {
            setNewGroupSectors([...newGroupSectors, sector]);
        }
    };

    // --- STATS CALCULATION ---

    // 1. Calculate General Stats (KPIs) based on SELECTED filters
    const generalStats = useMemo(() => {
        if (!allTickets) return { total: 0, scanned: 0, remaining: 0, percentage: '0.0' };
        
        const filteredTickets = allTickets.filter(t => {
            if (!t.sector) return false;
            const ticketSectorNorm = normalize(t.sector);
            return selectedSectors.some(sel => normalize(sel) === ticketSectorNorm);
        });

        const total = filteredTickets.length;
        const scanned = filteredTickets.filter(t => t.status === 'USED').length;
        const remaining = total - scanned;
        const percentage = total > 0 ? ((scanned / total) * 100).toFixed(1) : '0.0';
        return { total, scanned, remaining, percentage };
    }, [allTickets, selectedSectors]);

    // 2. Calculate Table Data (Rows)
    const tableData = useMemo(() => {
        const statsMap: Record<string, { total: number; scanned: number; displayName: string; isGroup?: boolean; subSectors?: string[] }> = {};
        const handledSectors = new Set<string>();

        // If Grouped Mode is ON
        if (viewMode === 'grouped') {
            // Process Groups first
            groups.forEach(group => {
                let groupTotal = 0;
                let groupScanned = 0;
                
                // Find tickets belonging to any sector in this group
                allTickets.forEach(ticket => {
                    const tSector = normalize(ticket.sector || 'Desconhecido');
                    const isInGroup = group.includedSectors.some(s => normalize(s) === tSector);
                    
                    if (isInGroup) {
                        groupTotal++;
                        if (ticket.status === 'USED') groupScanned++;
                    }
                });

                // Mark these sectors as handled
                group.includedSectors.forEach(s => handledSectors.add(normalize(s)));

                // Add to stats map
                statsMap[`group_${group.id}`] = {
                    total: groupTotal,
                    scanned: groupScanned,
                    displayName: group.name,
                    isGroup: true,
                    subSectors: group.includedSectors
                };
            });
        }

        // Process Individual Sectors (Either all of them if raw mode, or remaining ones if grouped mode)
        const sectorsToProcess = viewMode === 'raw' 
            ? sectorNames 
            : sectorNames.filter(s => !handledSectors.has(normalize(s)));

        sectorsToProcess.forEach(sectorName => {
             if (!selectedSectors.includes(sectorName)) return;

             let total = 0;
             let scanned = 0;

             allTickets.forEach(ticket => {
                 if (normalize(ticket.sector) === normalize(sectorName)) {
                     total++;
                     if (ticket.status === 'USED') scanned++;
                 }
             });

             statsMap[`sector_${sectorName}`] = {
                 total,
                 scanned,
                 displayName: sectorName,
                 isGroup: false
             };
        });
        
        let result = Object.values(statsMap);
        
        result.sort((a, b) => {
            if (a.isGroup && !b.isGroup) return -1;
            if (!a.isGroup && b.isGroup) return 1;
            return a.displayName.localeCompare(b.displayName);
        });

        return result;

    }, [allTickets, sectorNames, viewMode, groups, selectedSectors]);

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

      {/* 2. Controls & Configuration */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center space-x-2">
                    <TableCellsIcon className="w-5 h-5 text-gray-400" />
                    <h3 className="text-lg font-bold text-white">Detalhamento por Setor</h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                     {/* View Mode Toggle - ONLY IF NOT READ ONLY */}
                    {!isReadOnly && onViewModeChange && (
                        <div className="bg-gray-700 p-1 rounded-lg flex text-sm font-bold">
                            <button 
                                onClick={() => onViewModeChange('raw')}
                                className={`px-3 py-1 rounded transition-colors ${viewMode === 'raw' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            >
                                Detalhado
                            </button>
                            <button 
                                onClick={() => onViewModeChange('grouped')}
                                className={`px-3 py-1 rounded transition-colors ${viewMode === 'grouped' ? 'bg-orange-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            >
                                Agrupado
                            </button>
                        </div>
                    )}

                    {/* Manage Groups Button - ONLY IF NOT READ ONLY */}
                    {!isReadOnly && onGroupsChange && (
                        <button 
                            onClick={() => setIsConfiguringGroups(!isConfiguringGroups)}
                            className={`flex items-center px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                                isConfiguringGroups ? 'bg-gray-600 text-white border-gray-500' : 'bg-gray-800 text-gray-300 border-gray-600 hover:bg-gray-700'
                            }`}
                        >
                            <CogIcon className="w-4 h-4 mr-2" />
                            {isConfiguringGroups ? 'Fechar Configuração' : 'Gerenciar Grupos'}
                        </button>
                    )}

                    {/* Filter Button - Allowed for Public View too (local filter) */}
                    <div className="relative" ref={filterRef}>
                        <button 
                            onClick={() => setIsFilterOpen(!isFilterOpen)}
                            className={`flex items-center px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                                selectedSectors.length < sectorNames.length 
                                ? 'bg-blue-600 text-white border-blue-500' 
                                : 'bg-gray-800 text-gray-300 border-gray-600 hover:border-gray-500'
                            }`}
                        >
                            <FunnelIcon className="w-4 h-4 mr-2" />
                            Filtrar ({selectedSectors.length})
                        </button>
                         {isFilterOpen && (
                            <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2">
                                <div className="flex justify-between mb-2 pb-2 border-b border-gray-700">
                                    <button onClick={handleSelectAll} className="text-xs text-blue-400 hover:text-blue-300">Todos</button>
                                    <button onClick={handleClearAll} className="text-xs text-red-400 hover:text-red-300">Nenhum</button>
                                </div>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
                                    {sectorNames.map(sector => (
                                        <label key={sector} className="flex items-center p-2 rounded hover:bg-gray-700 cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedSectors.includes(sector)}
                                                onChange={() => toggleSectorFilter(sector)}
                                                className="form-checkbox h-4 w-4 text-orange-600 rounded border-gray-500 bg-gray-700 focus:ring-0"
                                            />
                                            <span className="ml-2 text-sm text-gray-200">{sector}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* GROUP CONFIGURATION UI - ONLY IF NOT READ ONLY */}
            {isConfiguringGroups && !isReadOnly && (
                <div className="mt-4 p-4 bg-gray-700/50 rounded-lg border border-gray-600 animate-fade-in">
                    <h4 className="font-bold text-white mb-3">Criar/Editar Grupos de Setores</h4>
                    
                    {/* Creator */}
                    <div className="flex flex-col md:flex-row gap-4 mb-6">
                        <div className="flex-1">
                            <label className="text-xs text-gray-400 mb-1 block">Nome do Grupo (ex: "VIP")</label>
                            <input 
                                type="text" 
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-white focus:border-orange-500 outline-none"
                                placeholder="Nome do novo grupo"
                            />
                        </div>
                        <div className="flex-[2]">
                            <label className="text-xs text-gray-400 mb-1 block">Selecione os Setores para agrupar:</label>
                            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-900 rounded border border-gray-600">
                                {sectorNames.map(sector => (
                                    <label key={sector} className="inline-flex items-center bg-gray-800 px-2 py-1 rounded cursor-pointer hover:bg-gray-700 border border-gray-700">
                                        <input 
                                            type="checkbox"
                                            checked={newGroupSectors.includes(sector)}
                                            onChange={() => toggleSectorInNewGroup(sector)}
                                            className="text-orange-500 rounded bg-gray-900 border-gray-600"
                                        />
                                        <span className="ml-2 text-xs">{sector}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-end">
                            <button 
                                onClick={handleAddGroup}
                                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded text-sm flex items-center"
                            >
                                <PlusCircleIcon className="w-4 h-4 mr-2"/>
                                Criar Grupo
                            </button>
                        </div>
                    </div>

                    {/* List of Existing Groups */}
                    <div className="border-t border-gray-600 pt-4">
                        <h5 className="text-sm font-bold text-gray-300 mb-2">Grupos Ativos ({groups.length})</h5>
                        {groups.length === 0 ? (
                            <p className="text-xs text-gray-500 italic">Nenhum grupo criado ainda.</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {groups.map(group => (
                                    <div key={group.id} className="bg-gray-800 p-3 rounded border border-gray-600 flex justify-between items-start">
                                        <div>
                                            <p className="font-bold text-orange-400 text-sm">{group.name}</p>
                                            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                                                {group.includedSectors.join(', ')}
                                            </p>
                                        </div>
                                        <button 
                                            onClick={() => handleDeleteGroup(group.id)}
                                            className="text-gray-500 hover:text-red-500 p-1"
                                            title="Excluir Grupo"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
      </div>

      {/* 3. Detailed Table */}
      <div className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700 z-10 relative">
          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead>
                      <tr className="bg-gray-700 text-gray-400 border-b border-gray-600 text-sm uppercase">
                          <th className="px-6 py-3 font-medium">Setor / Grupo</th>
                          <th className="px-6 py-3 font-medium text-center">Progresso</th>
                          <th className="px-6 py-3 font-medium text-center">Total</th>
                          <th className="px-6 py-3 font-medium text-center">Entradas</th>
                          <th className="px-6 py-3 font-medium text-center">Restantes</th>
                          <th className="px-6 py-3 font-medium text-center">%</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                      {tableData.map((stats) => {
                          const remaining = stats.total - stats.scanned;
                          const percentage = stats.total > 0 ? ((stats.scanned / stats.total) * 100).toFixed(1) : '0.0';
                          
                          return (
                              <tr key={stats.displayName} className={`hover:bg-gray-700/50 transition-colors ${stats.isGroup ? 'bg-gray-800/80' : ''}`}>
                                  <td className="px-6 py-4 font-medium text-white">
                                    <div className="flex items-center">
                                        {stats.isGroup && <span className="mr-2 text-xs bg-orange-600 px-1.5 py-0.5 rounded font-bold">GRUPO</span>}
                                        {stats.displayName}
                                    </div>
                                    {stats.isGroup && stats.subSectors && (
                                        <span className="block text-xs text-gray-500 font-normal mt-0.5 max-w-xs truncate">
                                            {stats.subSectors.join(', ')}
                                        </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 w-1/3 min-w-[150px]">
                                      <div className="w-full bg-gray-900 rounded-full h-2">
                                          <div 
                                            className={`${stats.isGroup ? 'bg-orange-500' : 'bg-green-500'} h-2 rounded-full transition-all duration-500`} 
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
          {tableData.length === 0 && (
              <div className="p-6 text-center text-gray-500">
                  Nenhum setor encontrado para a configuração atual.
              </div>
          )}
      </div>
    </div>
  );
};

export default Stats;

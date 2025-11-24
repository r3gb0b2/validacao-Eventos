import React, { useState, useEffect } from 'react';
import { Ticket } from '../types';
import { CogIcon, TrashIcon, PlusCircleIcon } from './Icons';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
}

interface SectorGroup {
  name: string;
  sectors: string[];
}

const Stats: React.FC<StatsProps> = ({ allTickets = [], sectorNames = [] }) => {
    const [isConfiguringGroups, setIsConfiguringGroups] = useState(false);
    const [groups, setGroups] = useState<SectorGroup[]>([]);
    const [newGroupName, setNewGroupName] = useState('');
    const [selectedSectorsForGroup, setSelectedSectorsForGroup] = useState<string[]>([]);

    // Load groups from local storage on mount
    useEffect(() => {
        try {
            const savedGroups = localStorage.getItem('stats_sector_groups');
            if (savedGroups) {
                setGroups(JSON.parse(savedGroups));
            }
        } catch (e) {
            console.error("Failed to load sector groups", e);
        }
    }, []);

    // Save groups to local storage whenever they change
    useEffect(() => {
        localStorage.setItem('stats_sector_groups', JSON.stringify(groups));
    }, [groups]);

    const calculateStats = (filter?: string | string[]) => {
        if (!allTickets) return { total: 0, scanned: 0, remaining: 0, percentage: '0.0' };
        
        let relevantTickets: Ticket[] = [];
        
        if (!filter) {
            relevantTickets = allTickets;
        } else if (Array.isArray(filter)) {
            relevantTickets = allTickets.filter(t => filter.includes(t.sector));
        } else {
            relevantTickets = allTickets.filter(t => t.sector === filter);
        }

        const total = relevantTickets.length;
        const scanned = relevantTickets.filter(t => t.status === 'USED').length;
        const remaining = total - scanned;
        const percentage = total > 0 ? ((scanned / total) * 100).toFixed(1) : '0.0';
        return { total, scanned, remaining, percentage };
    };

    const generalStats = calculateStats();
    const safeSectorNames = sectorNames || [];

    // Helper to determine which sectors are already in a group
    const sectorsInGroups = new Set<string>();
    groups.forEach(g => g.sectors.forEach(s => sectorsInGroups.add(s)));

    // Sectors that are NOT in any group (to be displayed individually)
    const individualSectors = safeSectorNames.filter(s => !sectorsInGroups.has(s));

    const handleCreateGroup = () => {
        if (!newGroupName.trim()) {
            alert("Digite um nome para o grupo.");
            return;
        }
        if (selectedSectorsForGroup.length < 2) {
            alert("Selecione pelo menos 2 setores para agrupar.");
            return;
        }

        const newGroup: SectorGroup = {
            name: newGroupName.trim(),
            sectors: selectedSectorsForGroup
        };

        setGroups([...groups, newGroup]);
        setNewGroupName('');
        setSelectedSectorsForGroup([]);
    };

    const handleDeleteGroup = (index: number) => {
        if (confirm("Desagrupar estes setores?")) {
            const newGroups = [...groups];
            newGroups.splice(index, 1);
            setGroups(newGroups);
        }
    };

    const toggleSectorSelection = (sector: string) => {
        if (selectedSectorsForGroup.includes(sector)) {
            setSelectedSectorsForGroup(selectedSectorsForGroup.filter(s => s !== sector));
        } else {
            setSelectedSectorsForGroup([...selectedSectorsForGroup, sector]);
        }
    };

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
          <div className="bg-gray-700 px-6 py-4 border-b border-gray-600 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Detalhamento por Setor</h3>
              <button 
                onClick={() => setIsConfiguringGroups(!isConfiguringGroups)}
                className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-600 transition"
                title="Configurar Agrupamento de Setores"
              >
                  <CogIcon className="w-5 h-5" />
              </button>
          </div>

          {/* Group Configuration Panel */}
          {isConfiguringGroups && (
              <div className="bg-gray-900/50 p-4 border-b border-gray-600 animate-fade-in">
                  <h4 className="text-sm font-bold text-orange-400 mb-3">Criar Novo Grupo de Visualização</h4>
                  <div className="flex flex-col space-y-3">
                      <input 
                        type="text" 
                        placeholder="Nome do Grupo (ex: VIP Total)" 
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        className="bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white"
                      />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 bg-gray-800 rounded border border-gray-700">
                          {individualSectors.map(sector => (
                              <label key={sector} className="flex items-center space-x-2 cursor-pointer p-1 hover:bg-gray-700 rounded">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedSectorsForGroup.includes(sector)}
                                    onChange={() => toggleSectorSelection(sector)}
                                    className="rounded text-orange-500 focus:ring-orange-500 bg-gray-700 border-gray-500"
                                  />
                                  <span className="text-xs text-gray-200 truncate">{sector}</span>
                              </label>
                          ))}
                          {individualSectors.length === 0 && <p className="text-xs text-gray-500 col-span-full text-center">Todos os setores já estão agrupados.</p>}
                      </div>
                      <button 
                        onClick={handleCreateGroup}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded text-sm flex items-center justify-center w-full md:w-auto"
                      >
                          <PlusCircleIcon className="w-4 h-4 mr-2" />
                          Criar Grupo
                      </button>
                  </div>
                  
                  {groups.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-700">
                          <h4 className="text-sm font-bold text-gray-400 mb-2">Grupos Ativos</h4>
                          <ul className="space-y-2">
                              {groups.map((g, idx) => (
                                  <li key={idx} className="flex justify-between items-center bg-gray-800 p-2 rounded border border-gray-700">
                                      <div>
                                          <span className="text-sm font-bold text-white">{g.name}</span>
                                          <p className="text-xs text-gray-500">{g.sectors.join(', ')}</p>
                                      </div>
                                      <button onClick={() => handleDeleteGroup(idx)} className="text-red-400 hover:text-red-300">
                                          <TrashIcon className="w-4 h-4" />
                                      </button>
                                  </li>
                              ))}
                          </ul>
                      </div>
                  )}
              </div>
          )}

          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead>
                      <tr className="text-gray-400 border-b border-gray-600 text-sm uppercase">
                          <th className="px-6 py-3 font-medium">Setor / Grupo</th>
                          <th className="px-6 py-3 font-medium text-center">Progresso</th>
                          <th className="px-6 py-3 font-medium text-center">Total</th>
                          <th className="px-6 py-3 font-medium text-center">Entradas</th>
                          <th className="px-6 py-3 font-medium text-center">Restantes</th>
                          <th className="px-6 py-3 font-medium text-center">%</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                      {/* Render Groups First */}
                      {groups.map((group) => {
                          const stats = calculateStats(group.sectors);
                          return (
                              <tr key={group.name} className="bg-gray-700/30 hover:bg-gray-700/50 transition-colors border-l-4 border-purple-500">
                                  <td className="px-6 py-4">
                                      <span className="font-bold text-purple-300 block">{group.name}</span>
                                      <span className="text-xs text-gray-500">Agrupado</span>
                                  </td>
                                  <td className="px-6 py-4 w-1/3">
                                      <div className="w-full bg-gray-900 rounded-full h-2">
                                          <div 
                                            className="bg-purple-500 h-2 rounded-full transition-all duration-500" 
                                            style={{ width: `${stats.percentage}%` }}
                                          ></div>
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-gray-300">{stats.total}</td>
                                  <td className="px-6 py-4 text-center text-green-400 font-bold">{stats.scanned}</td>
                                  <td className="px-6 py-4 text-center text-yellow-400">{stats.remaining}</td>
                                  <td className="px-6 py-4 text-center text-white font-bold">{stats.percentage}%</td>
                              </tr>
                          );
                      })}

                      {/* Render Individual Sectors */}
                      {individualSectors.map((sector) => {
                          const stats = calculateStats(sector);
                          return (
                              <tr key={sector} className="hover:bg-gray-700/50 transition-colors">
                                  <td className="px-6 py-4 font-medium text-white">{sector}</td>
                                  <td className="px-6 py-4 w-1/3">
                                      <div className="w-full bg-gray-900 rounded-full h-2">
                                          <div 
                                            className="bg-green-500 h-2 rounded-full transition-all duration-500" 
                                            style={{ width: `${stats.percentage}%` }}
                                          ></div>
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 text-center text-gray-300">{stats.total}</td>
                                  <td className="px-6 py-4 text-center text-green-400 font-bold">{stats.scanned}</td>
                                  <td className="px-6 py-4 text-center text-yellow-400">{stats.remaining}</td>
                                  <td className="px-6 py-4 text-center text-white font-bold">{stats.percentage}%</td>
                              </tr>
                          );
                      })}
                  </tbody>
              </table>
          </div>
          {safeSectorNames.length === 0 && (
              <div className="p-6 text-center text-gray-500">
                  Nenhum setor configurado.
              </div>
          )}
      </div>
    </div>
  );
};

export default Stats;
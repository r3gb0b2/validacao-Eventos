import React from 'react';
import { Ticket } from '../types';

interface StatsProps {
  allTickets: Ticket[];
  sectorNames: string[];
}

const Stats: React.FC<StatsProps> = ({ allTickets, sectorNames }) => {
    const calculateStats = (filter?: string) => {
        const relevantTickets = filter ? allTickets.filter(t => t.sector === filter) : allTickets;
        const total = relevantTickets.length;
        const scanned = relevantTickets.filter(t => t.status === 'USED').length;
        const remaining = total - scanned;
        return { total, scanned, remaining };
    };

    const generalStats = calculateStats();

  return (
    <div className="w-full bg-gray-800/80 backdrop-blur-sm p-4 rounded-lg border border-gray-700 shadow-lg">
      <h2 className="text-xl font-bold text-center text-white mb-4">Estatísticas do Evento</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* General Stats */}
        <div className="bg-gray-700 p-3 rounded-lg text-center">
            <h3 className="font-semibold mb-2 text-orange-400">Geral</h3>
            <div className="grid grid-cols-3 gap-2">
                 <div>
                    <p className="text-2xl font-bold text-blue-300">{generalStats.total}</p>
                    <p className="text-xs text-gray-400">Total</p>
                </div>
                <div>
                    <p className="text-2xl font-bold text-green-300">{generalStats.scanned}</p>
                    <p className="text-xs text-gray-400">Entradas</p>
                </div>
                <div>
                    <p className="text-2xl font-bold text-yellow-300">{generalStats.remaining}</p>
                    <p className="text-xs text-gray-400">Restantes</p>
                </div>
            </div>
        </div>
         {/* Sector Stats */}
        {sectorNames.map(sector => {
            const stats = calculateStats(sector);
            return (
                <div key={sector} className="bg-gray-700 p-3 rounded-lg text-center">
                    <h3 className="font-semibold mb-2 text-orange-400">{sector}</h3>
                    <div className="grid grid-cols-3 gap-2">
                         <div>
                            <p className="text-2xl font-bold text-blue-300">{stats.total}</p>
                            <p className="text-xs text-gray-400">Total</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-green-300">{stats.scanned}</p>
                            <p className="text-xs text-gray-400">Entradas</p>
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-yellow-300">{stats.remaining}</p>
                            <p className="text-xs text-gray-400">Restantes</p>
                        </div>
                    </div>
                </div>
            )
        })}
      </div>
    </div>
  );
};

export default Stats;
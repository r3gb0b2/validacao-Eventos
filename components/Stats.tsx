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
        const percentage = total > 0 ? Math.round((scanned / total) * 100) : 0;
        return { total, scanned, remaining, percentage };
    };

    const generalStats = calculateStats();

  return (
    <div className="w-full space-y-6">
      {/* Card Principal - Visão Geral */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 shadow-lg">
        <h2 className="text-xl font-bold text-orange-500 mb-4 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Visão Geral do Evento
        </h2>
        
        <div className="grid grid-cols-3 gap-4 text-center mb-6">
            <div className="p-4 bg-gray-700/50 rounded-lg border border-gray-600">
                <p className="text-gray-400 text-xs uppercase font-bold tracking-wider">Total</p>
                <p className="text-3xl font-bold text-white">{generalStats.total}</p>
            </div>
            <div className="p-4 bg-green-900/20 rounded-lg border border-green-800/50">
                <p className="text-green-400 text-xs uppercase font-bold tracking-wider">Acessos</p>
                <p className="text-3xl font-bold text-green-400">{generalStats.scanned}</p>
            </div>
            <div className="p-4 bg-gray-700/50 rounded-lg border border-gray-600">
                <p className="text-gray-400 text-xs uppercase font-bold tracking-wider">Restantes</p>
                <p className="text-3xl font-bold text-white">{generalStats.remaining}</p>
            </div>
        </div>

        {/* Barra de Progresso Geral */}
        <div className="w-full bg-gray-700 rounded-full h-6 relative overflow-hidden">
            <div 
                className="bg-gradient-to-r from-orange-600 to-orange-400 h-6 rounded-full transition-all duration-1000 ease-out flex items-center justify-center text-xs font-bold text-white shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                style={{ width: `${generalStats.percentage}%` }}
            >
               {generalStats.percentage > 10 && `${generalStats.percentage}%`}
            </div>
            {generalStats.percentage <= 10 && (
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                    {generalStats.percentage}%
                </span>
            )}
        </div>
      </div>

      {/* Tabela Detalhada por Setor */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-lg overflow-hidden">
        <div className="p-4 border-b border-gray-700 bg-gray-750">
            <h3 className="font-semibold text-white flex items-center">
                Detalhes por Setor
            </h3>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-gray-700/50 text-gray-400 text-xs uppercase">
                        <th className="p-4 font-semibold border-b border-gray-700">Setor</th>
                        <th className="p-4 font-semibold border-b border-gray-700 text-right">Progresso</th>
                        <th className="p-4 font-semibold border-b border-gray-700 text-center">Total</th>
                        <th className="p-4 font-semibold border-b border-gray-700 text-center text-green-400">Entradas</th>
                        <th className="p-4 font-semibold border-b border-gray-700 text-center">Restantes</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {sectorNames.map(sector => {
                        const stats = calculateStats(sector);
                        return (
                            <tr key={sector} className="hover:bg-gray-700/30 transition-colors">
                                <td className="p-4 font-medium text-white">{sector}</td>
                                <td className="p-4 text-right w-1/4">
                                    <div className="flex items-center justify-end space-x-3">
                                        <span className="text-xs font-bold text-gray-400">{stats.percentage}%</span>
                                        <div className="w-24 bg-gray-700 rounded-full h-2">
                                            <div 
                                                className="bg-orange-500 h-2 rounded-full" 
                                                style={{ width: `${stats.percentage}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-center text-gray-300">{stats.total}</td>
                                <td className="p-4 text-center font-bold text-green-400">{stats.scanned}</td>
                                <td className="p-4 text-center text-gray-300">{stats.remaining}</td>
                            </tr>
                        );
                    })}
                     {sectorNames.length === 0 && (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-gray-500">
                                Nenhum setor configurado.
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

export default Stats;
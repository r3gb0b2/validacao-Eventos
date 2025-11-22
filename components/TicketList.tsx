import React, { useState } from 'react';
import { DisplayableScanLog, Sector, ScanStatus } from '../types';
import { ClockIcon } from './Icons';

interface TicketListProps {
  tickets: DisplayableScanLog[];
  // FIX: Changed type from `[string, string]` to `string[]` to support a variable number of sectors.
  sectorNames: string[];
}

const TicketList: React.FC<TicketListProps> = ({ tickets, sectorNames }) => {
    const [activeTab, setActiveTab] = useState<Sector | 'All'>('All');
    
    const filteredTickets = tickets.filter(ticket => 
        activeTab === 'All' || ticket.ticketSector === activeTab
    );

  if (!tickets.length) {
    return (
      <div className="text-center text-gray-400 py-4 bg-gray-800 rounded-lg">
        Nenhuma validação registrada.
      </div>
    );
  }

  const getStatusBadgeStyle = (status: ScanStatus): string => {
      switch (status) {
          case 'VALID':
              return 'bg-green-500 text-white';
          case 'USED':
              return 'bg-yellow-500 text-gray-800 font-bold';
          case 'WRONG_SECTOR':
              return 'bg-orange-500 text-white font-bold';
          case 'INVALID':
          case 'ERROR':
          default:
              return 'bg-red-500 text-white font-bold';
      }
  };

  return (
    <div className="w-full bg-gray-800/80 backdrop-blur-sm p-4 rounded-lg border border-gray-700 shadow-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-white">Histórico de Validações</h3>
        <div className="flex space-x-1 bg-gray-700 p-1 rounded-lg">
            {(['All', ...sectorNames] as (Sector | 'All')[]).map(tab => (
                 <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 text-sm font-bold rounded-md transition-colors ${
                        activeTab === tab
                        ? 'bg-orange-600 text-white'
                        : 'text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    {tab === 'All' ? 'Todos' : tab}
                </button>
            ))}
        </div>
      </div>
      <ul className="divide-y divide-gray-700 h-96 overflow-y-auto">
        {filteredTickets.map((ticket) => (
          <li key={ticket.id} className="py-3 flex justify-between items-center">
            <div>
              <p className="font-medium text-white">{ticket.ticketId}</p>
              <div className="flex items-center text-xs text-gray-500 mt-1">
                 <p>
                    Validado em: {new Date(ticket.timestamp).toLocaleString('pt-BR')}
                 </p>
                 {ticket.isPending && (
                    <span title="Esta validação foi feita offline e será sincronizada." className="ml-2 flex items-center text-yellow-400 font-semibold">
                        <ClockIcon className="w-3 h-3 mr-1" />
                        Pendente
                    </span>
                 )}
              </div>
            </div>
            <div className="flex items-center space-x-3">
                <span className="px-2 py-1 text-xs font-semibold text-white bg-gray-600 rounded-full">{ticket.ticketSector}</span>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeStyle(ticket.status)}`}>{ticket.status}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TicketList;
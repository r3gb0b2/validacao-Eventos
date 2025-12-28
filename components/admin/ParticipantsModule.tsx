
import React, { useState, useMemo } from 'react';
import { Ticket } from '../../types';
import { SearchIcon, UsersIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from '../Icons';

interface ParticipantsModuleProps {
  allTickets: Ticket[];
  sectorNames: string[];
}

const ParticipantsModule: React.FC<ParticipantsModuleProps> = ({ allTickets = [], sectorNames = [] }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSector, setSelectedSector] = useState('All');

    const filteredParticipants = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        return allTickets.filter(t => {
            // Só exibe se tiver algum dado de participante
            if (!t.details?.ownerName && !t.details?.email) return false;
            
            const matchesSearch = 
                (t.details?.ownerName || '').toLowerCase().includes(term) ||
                (t.details?.email || '').toLowerCase().includes(term) ||
                (t.details?.document || '').toLowerCase().includes(term) ||
                t.id.toLowerCase().includes(term);
            
            const matchesSector = selectedSector === 'All' || t.sector === selectedSector;

            return matchesSearch && matchesSector;
        }).sort((a, b) => (a.details?.ownerName || '').localeCompare(b.details?.ownerName || ''));
    }, [allTickets, searchTerm, selectedSector]);

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header e Busca */}
            <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center text-orange-500">
                        <UsersIcon className="w-6 h-6 mr-2" />
                        Participantes ({filteredParticipants.length})
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2 relative">
                        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                        <input 
                            type="text" 
                            placeholder="Buscar por Nome, E-mail, CPF ou Código..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-2xl pl-12 pr-4 py-3 text-sm focus:border-orange-500 outline-none transition-all shadow-inner"
                        />
                    </div>
                    <select 
                        value={selectedSector}
                        onChange={(e) => setSelectedSector(e.target.value)}
                        className="bg-gray-900 border border-gray-700 rounded-2xl px-4 py-3 text-sm focus:border-orange-500 outline-none font-bold"
                    >
                        <option value="All">Todos os Setores</option>
                        {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
            </div>

            {/* Lista de Participantes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredParticipants.map(participant => (
                    <div key={participant.id} className="bg-gray-800 border border-gray-700 rounded-3xl p-5 hover:border-orange-500/40 transition-all shadow-lg group relative overflow-hidden">
                        {/* Status Badge */}
                        <div className={`absolute top-0 right-0 px-4 py-1.5 rounded-bl-2xl text-[10px] font-black uppercase tracking-tighter shadow-sm ${participant.status === 'USED' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                            {participant.status === 'USED' ? 'Check-in Realizado' : 'Aguardando'}
                        </div>

                        <div className="flex items-start gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-inner border ${participant.status === 'USED' ? 'bg-green-600/10 border-green-500 text-green-400' : 'bg-gray-700 border-gray-600 text-gray-500'}`}>
                                {(participant.details?.ownerName || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-bold text-white truncate group-hover:text-orange-400 transition-colors">
                                    {participant.details?.ownerName || 'Participante Sem Nome'}
                                </h3>
                                <p className="text-[11px] text-gray-500 truncate mt-0.5">{participant.details?.email || 'E-mail não informado'}</p>
                            </div>
                        </div>

                        <div className="mt-6 space-y-2.5">
                            <div className="flex items-center justify-between bg-gray-900/50 p-2.5 rounded-xl border border-gray-700/50">
                                <span className="text-[10px] text-gray-500 font-bold uppercase">Ingresso</span>
                                <span className="text-xs font-mono text-orange-400 font-bold">{participant.id}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-gray-900/50 p-2 rounded-xl border border-gray-700/50">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">Setor</p>
                                    <p className="text-[10px] font-bold text-gray-300 truncate">{participant.sector}</p>
                                </div>
                                <div className="bg-gray-900/50 p-2 rounded-xl border border-gray-700/50">
                                    <p className="text-[8px] text-gray-500 font-bold uppercase">Documento</p>
                                    <p className="text-[10px] font-bold text-gray-300 truncate">{participant.details?.document || 'N/A'}</p>
                                </div>
                            </div>

                            {participant.details?.phone && (
                                <div className="flex items-center text-[10px] text-gray-400 px-1">
                                    <span className="font-bold mr-1">Tel:</span> {participant.details.phone}
                                </div>
                            )}

                            {participant.usedAt && (
                                <div className="flex items-center text-[9px] text-green-500/70 px-1 mt-2">
                                    <ClockIcon className="w-3 h-3 mr-1" />
                                    Entrou às {new Date(participant.usedAt).toLocaleTimeString()}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {filteredParticipants.length === 0 && (
                    <div className="col-span-full py-20 text-center bg-gray-800/50 rounded-[2.5rem] border-2 border-dashed border-gray-700">
                        <UsersIcon className="w-16 h-16 mx-auto text-gray-700 mb-4" />
                        <p className="text-xl font-bold text-gray-500">Nenhum participante encontrado</p>
                        <p className="text-gray-600 text-sm mt-2">Tente buscar por outro termo ou importar dados da API.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ParticipantsModule;


import React, { useState, useMemo } from 'react';
import { Ticket, DisplayableScanLog } from '../../types';
import { SearchIcon, TicketIcon, UsersIcon, CheckCircleIcon, XCircleIcon, ClockIcon, AlertTriangleIcon, TableCellsIcon } from '../Icons';

interface LookupModuleProps {
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
}

const LookupModule: React.FC<LookupModuleProps> = ({ allTickets = [], scanHistory = [] }) => {
    const [searchTerm, setSearchTerm] = useState('');
    
    const foundTicket = useMemo(() => {
        if (!searchTerm.trim()) return null;
        return allTickets.find(t => t.id.toLowerCase() === searchTerm.toLowerCase().trim());
    }, [allTickets, searchTerm]);

    const ticketLogs = useMemo(() => {
        if (!foundTicket) return [];
        return scanHistory
            .filter(log => log.ticketId === foundTicket.id)
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [foundTicket, scanHistory]);

    const renderStatusBadge = (status: string) => {
        if (status === 'USED') return <span className="px-4 py-1.5 bg-yellow-500 text-white rounded-full text-xs font-black uppercase tracking-widest">Utilizado</span>;
        if (status === 'AVAILABLE') return <span className="px-4 py-1.5 bg-green-600 text-white rounded-full text-xs font-black uppercase tracking-widest">Disponível</span>;
        return <span className="px-4 py-1.5 bg-gray-600 text-white rounded-full text-xs font-black uppercase tracking-widest">{status}</span>;
    };

    return (
        <div className="space-y-8 animate-fade-in pb-20">
            {/* Search Header */}
            <div className="bg-gray-800 p-8 rounded-[2.5rem] border border-gray-700 shadow-2xl space-y-4">
                <div className="text-center max-w-lg mx-auto space-y-2">
                    <h2 className="text-2xl font-black text-orange-500 uppercase flex items-center justify-center">
                        <SearchIcon className="w-8 h-8 mr-3" /> Consulta de Ingresso
                    </h2>
                    <p className="text-gray-500 text-xs font-bold">Digite o código exato do ingresso para auditoria completa.</p>
                </div>

                <div className="relative max-w-xl mx-auto group">
                    <SearchIcon className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-500 group-focus-within:text-orange-500 transition-colors" />
                    <input 
                        type="text" 
                        autoFocus
                        placeholder="Ex: ABC123XYZ..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-900 border-2 border-gray-700 rounded-3xl pl-16 pr-6 py-5 text-xl font-mono text-white outline-none focus:border-orange-500 transition-all shadow-inner"
                    />
                </div>
            </div>

            {foundTicket ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Info Column */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-gray-800 p-8 rounded-[2.5rem] border border-gray-700 shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-8">
                                {renderStatusBadge(foundTicket.status)}
                            </div>
                            
                            <div className="flex items-center gap-6 mb-8">
                                <div className="w-16 h-16 bg-orange-600/10 rounded-3xl flex items-center justify-center text-orange-500">
                                    <TicketIcon className="w-8 h-8" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Código do Ingresso</p>
                                    <h3 className="text-3xl font-black text-white font-mono">{foundTicket.id}</h3>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                <div className="bg-gray-900/50 p-4 rounded-2xl border border-gray-700">
                                    <p className="text-[9px] font-black text-gray-500 uppercase mb-1">Setor</p>
                                    <p className="text-sm font-bold text-white uppercase">{foundTicket.sector}</p>
                                </div>
                                <div className="bg-gray-900/50 p-4 rounded-2xl border border-gray-700">
                                    <p className="text-[9px] font-black text-gray-500 uppercase mb-1">Origem</p>
                                    <p className="text-sm font-bold text-blue-400 uppercase">{foundTicket.source?.replace('_', ' ') || 'Manual'}</p>
                                </div>
                                <div className="bg-gray-900/50 p-4 rounded-2xl border border-gray-700">
                                    <p className="text-[9px] font-black text-gray-500 uppercase mb-1">Cód. Compra</p>
                                    <p className="text-sm font-bold text-gray-300 font-mono">{foundTicket.details?.purchaseCode || 'N/A'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Audit Log / History */}
                        <div className="bg-gray-800 rounded-[2.5rem] border border-gray-700 shadow-xl overflow-hidden">
                            <div className="p-6 border-b border-gray-700 bg-gray-900/20 flex items-center justify-between">
                                <h3 className="font-black text-xs text-gray-400 uppercase tracking-widest flex items-center">
                                    <ClockIcon className="w-4 h-4 mr-2" /> Histórico de Auditoria ({ticketLogs.length})
                                </h3>
                            </div>
                            <div className="divide-y divide-gray-700/50">
                                {ticketLogs.map((log, idx) => (
                                    <div key={log.id} className="p-6 flex items-center justify-between hover:bg-gray-700/20 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                                log.status === 'VALID' ? 'bg-green-500/10 text-green-500' : 
                                                log.status === 'USED' ? 'bg-yellow-500/10 text-yellow-500' : 
                                                'bg-red-500/10 text-red-500'
                                            }`}>
                                                {log.status === 'VALID' ? <CheckCircleIcon className="w-5 h-5" /> : <AlertTriangleIcon className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <p className="text-sm font-black text-white uppercase tracking-tighter">
                                                    {log.status === 'VALID' ? 'Entrada Autorizada' : 
                                                     log.status === 'USED' ? 'Repetição de Entrada' : 
                                                     log.status === 'WRONG_SECTOR' ? 'Setor Errado' : 'Tentativa Negada'}
                                                </p>
                                                <p className="text-[10px] text-gray-500 font-bold">
                                                    {new Date(log.timestamp).toLocaleString('pt-BR')} 
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Operador</p>
                                            <p className="text-xs font-bold text-orange-500">{log.operator || '---'}</p>
                                            <p className="text-[9px] text-gray-600 font-mono mt-1">{log.deviceId?.slice(-8) || 'Desconhecido'}</p>
                                        </div>
                                    </div>
                                ))}
                                {ticketLogs.length === 0 && (
                                    <div className="p-12 text-center text-gray-600 italic">
                                        Nenhuma tentativa de scan registrada para este ingresso.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Participant Info Column */}
                    <div className="space-y-6">
                        <div className="bg-gray-800 p-8 rounded-[2.5rem] border border-gray-700 shadow-xl space-y-6">
                            <h3 className="font-black text-xs text-gray-500 uppercase tracking-widest flex items-center border-b border-gray-700 pb-4">
                                <UsersIcon className="w-4 h-4 mr-2" /> Dados do Portador
                            </h3>
                            
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500 font-black text-xl">
                                    {(foundTicket.details?.ownerName || '?').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h4 className="font-black text-white text-lg leading-tight">{foundTicket.details?.ownerName || 'Não Informado'}</h4>
                                    <p className="text-xs text-blue-400 font-bold">{foundTicket.details?.email || 'Sem e-mail'}</p>
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-gray-700/50">
                                <div>
                                    <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Documento / CPF</p>
                                    <p className="text-sm font-bold text-gray-200">{foundTicket.details?.document || '---'}</p>
                                </div>
                                <div>
                                    <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">Telefone</p>
                                    <p className="text-sm font-bold text-gray-200">{foundTicket.details?.phone || '---'}</p>
                                </div>
                                {foundTicket.details?.alertMessage && (
                                    <div className="bg-red-900/10 border border-red-500/50 p-4 rounded-2xl">
                                        <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mb-1">Alerta Ativo</p>
                                        <p className="text-xs font-bold text-red-400 italic">"{foundTicket.details.alertMessage}"</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Additional Info / Purchase */}
                        <div className="bg-gray-800 p-8 rounded-[2.5rem] border border-gray-700 shadow-xl space-y-4">
                             <h3 className="font-black text-xs text-gray-500 uppercase tracking-widest flex items-center">
                                <TableCellsIcon className="w-4 h-4 mr-2" /> Dados de Compra
                            </h3>
                            <div className="space-y-3">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-500">ID Original</span>
                                    <span className="text-gray-300 font-bold">{foundTicket.details?.originalId || '---'}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-500">Status no Check-in</span>
                                    <span className={foundTicket.status === 'USED' ? 'text-green-500 font-bold' : 'text-blue-500 font-bold'}>
                                        {foundTicket.status === 'USED' ? 'Entrada OK' : 'Disponível'}
                                    </span>
                                </div>
                                {foundTicket.usedAt && (
                                    <div className="flex justify-between text-xs pt-2 border-t border-gray-700">
                                        <span className="text-gray-500">Validado em</span>
                                        <span className="text-gray-300 font-bold">{new Date(foundTicket.usedAt).toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : searchTerm.trim() ? (
                <div className="py-20 text-center bg-gray-800 rounded-[2.5rem] border-2 border-dashed border-gray-700">
                    <XCircleIcon className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                    <p className="text-xl font-bold text-gray-400">Ingresso Não Encontrado</p>
                    <p className="text-gray-600 text-sm mt-2">Certifique-se de que o código digitado está correto.</p>
                </div>
            ) : (
                <div className="py-20 text-center bg-gray-800/50 rounded-[2.5rem] border border-gray-700">
                    <TableCellsIcon className="w-16 h-16 text-gray-700 mx-auto mb-4 opacity-20" />
                    <p className="text-gray-500 font-bold">Aguardando busca...</p>
                </div>
            )}
        </div>
    );
};

export default LookupModule;

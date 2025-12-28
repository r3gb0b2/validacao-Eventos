
import React, { useState } from 'react';
import { SectorGroup, Event } from '../../types';
import { Firestore, doc, setDoc } from 'firebase/firestore';
import { PlusCircleIcon, TrashIcon, TableCellsIcon } from '../Icons';

interface GroupingModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  groups: SectorGroup[];
  onUpdateGroups: (groups: SectorGroup[]) => Promise<void>;
}

const GroupingModule: React.FC<GroupingModuleProps> = ({ db, selectedEvent, sectorNames = [], groups = [], onUpdateGroups }) => {
    const [newGroupName, setNewGroupName] = useState('');

    // SAFETY CHECK: Se groups não for array, inicializa como vazio para não quebrar o render
    const safeGroups = Array.isArray(groups) ? groups : [];
    const safeSectorNames = Array.isArray(sectorNames) ? sectorNames : [];

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return;
        const newGroup: SectorGroup = { 
            id: Math.random().toString(36).substr(2, 9), 
            name: newGroupName.trim(), 
            includedSectors: [] 
        };
        onUpdateGroups([...safeGroups, newGroup]);
        setNewGroupName('');
    };

    const toggleSectorInGroup = (groupId: string, sector: string) => {
        const updated = safeGroups.map(g => {
            if (g.id !== groupId) return g;
            const exists = (g.includedSectors || []).includes(sector);
            return { 
                ...g, 
                includedSectors: exists 
                    ? g.includedSectors.filter(s => s !== sector) 
                    : [...(g.includedSectors || []), sector] 
            };
        });
        onUpdateGroups(updated);
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-20">
            <div className="bg-gray-800 p-6 rounded-3xl border border-purple-500/20 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold flex items-center text-purple-400">
                            <TableCellsIcon className="w-6 h-6 mr-2"/> Agrupamento de Setores
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">Crie grupos para somar estatísticas de diferentes setores no Dashboard.</p>
                    </div>
                </div>

                <div className="flex gap-2 mb-8 bg-gray-900/50 p-2 rounded-2xl border border-gray-700">
                    <input 
                        value={newGroupName} 
                        onChange={e => setNewGroupName(e.target.value)} 
                        placeholder="Ex: Geral (Pista + VIP)" 
                        className="flex-1 bg-transparent p-4 rounded-xl text-sm outline-none" 
                    />
                    <button 
                        onClick={handleCreateGroup} 
                        className="bg-purple-600 hover:bg-purple-700 text-white px-8 rounded-xl font-bold transition-all shadow-lg active:scale-95"
                    >
                        Criar Grupo
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {safeGroups.map(group => (
                        <div key={group.id} className="bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-inner relative group transition-all hover:border-purple-500/30">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-white text-lg">{group.name}</h3>
                                <button 
                                    onClick={() => onUpdateGroups(safeGroups.filter(g => g.id !== group.id))} 
                                    className="text-gray-500 hover:text-red-500 p-2 transition-colors"
                                    title="Remover Grupo"
                                >
                                    <TrashIcon className="w-4 h-4"/>
                                </button>
                            </div>
                            
                            <div className="flex flex-wrap gap-2">
                                {safeSectorNames.length === 0 ? (
                                    <p className="text-[10px] text-gray-600 italic">Nenhum setor disponível.</p>
                                ) : (
                                    safeSectorNames.map(sector => {
                                        const active = (group.includedSectors || []).includes(sector);
                                        return (
                                            <button 
                                                key={sector} 
                                                onClick={() => toggleSectorInGroup(group.id, sector)}
                                                className={`text-[10px] px-4 py-2 rounded-full font-bold transition-all border ${
                                                    active 
                                                    ? 'bg-purple-600 border-purple-400 text-white shadow-lg' 
                                                    : 'bg-gray-800 border-gray-600 text-gray-500 hover:text-gray-300'
                                                }`}
                                            >
                                                {sector}
                                            </button>
                                        );
                                    })
                                )}
                            </div>

                            {(group.includedSectors || []).length === 0 && (
                                <p className="mt-4 text-[10px] text-orange-500/70 flex items-center">
                                    <PlusCircleIcon className="w-3 h-3 mr-1" /> Selecione os setores acima
                                </p>
                            )}
                        </div>
                    ))}

                    {safeGroups.length === 0 && (
                        <div className="col-span-full py-16 text-center bg-gray-900/30 rounded-3xl border-2 border-dashed border-gray-700">
                            <TableCellsIcon className="w-12 h-12 mx-auto text-gray-700 mb-4" />
                            <p className="text-gray-500 font-medium">Nenhum grupo criado ainda.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GroupingModule;

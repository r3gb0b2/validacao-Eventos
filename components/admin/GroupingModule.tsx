
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

const GroupingModule: React.FC<GroupingModuleProps> = ({ db, selectedEvent, sectorNames, groups, onUpdateGroups }) => {
    const [newGroupName, setNewGroupName] = useState('');

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return;
        const newGroup: SectorGroup = { id: Math.random().toString(36).substr(2, 9), name: newGroupName.trim(), includedSectors: [] };
        onUpdateGroups([...groups, newGroup]);
        setNewGroupName('');
    };

    const toggleSectorInGroup = (groupId: string, sector: string) => {
        const updated = groups.map(g => {
            if (g.id !== groupId) return g;
            const exists = g.includedSectors.includes(sector);
            return { ...g, includedSectors: exists ? g.includedSectors.filter(s => s !== sector) : [...g.includedSectors, sector] };
        });
        onUpdateGroups(updated);
    };

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-gray-800 p-6 rounded-2xl border border-purple-500/20 shadow-xl">
                <h2 className="text-xl font-bold mb-4 flex items-center text-purple-400"><TableCellsIcon className="w-6 h-6 mr-2"/> Agrupamento de Setores</h2>
                <div className="flex gap-2 mb-6">
                    <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Ex: Geral (Pista + Vip)" className="flex-1 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm" />
                    <button onClick={handleCreateGroup} className="bg-purple-600 px-6 rounded-xl font-bold">Criar Grupo</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {groups.map(group => (
                        <div key={group.id} className="bg-gray-900 border border-gray-700 p-5 rounded-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-white">{group.name}</h3>
                                <button onClick={() => onUpdateGroups(groups.filter(g => g.id !== group.id))} className="text-red-500"><TrashIcon className="w-4 h-4"/></button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {sectorNames.map(sector => {
                                    const active = group.includedSectors.includes(sector);
                                    return (
                                        <button 
                                            key={sector} 
                                            onClick={() => toggleSectorInGroup(group.id, sector)}
                                            className={`text-[10px] px-3 py-1.5 rounded-full font-bold transition-all border ${active ? 'bg-purple-600 border-purple-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-500'}`}
                                        >
                                            {sector}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default GroupingModule;

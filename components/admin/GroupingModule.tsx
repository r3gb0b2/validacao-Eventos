
import React, { useState } from 'react';
import { SectorGroup, Event } from '../../types';
import { Firestore, doc, setDoc } from 'firebase/firestore';
// FIX: Added missing AlertTriangleIcon to imports
import { PlusCircleIcon, TrashIcon, TableCellsIcon, CheckCircleIcon, AlertTriangleIcon } from '../Icons';

interface GroupingModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  groups: SectorGroup[];
  onUpdateGroups: (groups: SectorGroup[]) => Promise<void>;
}

const GroupingModule: React.FC<GroupingModuleProps> = ({ db, selectedEvent, sectorNames = [], groups = [], onUpdateGroups }) => {
    const [newGroupName, setNewGroupName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // SEGURANÇA MÁXIMA: Garante que os iteráveis sejam arrays válidos antes de qualquer processamento
    const safeGroups = Array.isArray(groups) ? groups : [];
    const safeSectorNames = Array.isArray(sectorNames) ? sectorNames : [];

    const handleCreateGroup = async () => {
        if (!newGroupName.trim() || !selectedEvent) return;
        
        setIsSaving(true);
        try {
            const newGroup: SectorGroup = { 
                id: Math.random().toString(36).substr(2, 9), 
                name: newGroupName.trim(), 
                includedSectors: [] 
            };
            await onUpdateGroups([...safeGroups, newGroup]);
            setNewGroupName('');
        } catch (e) {
            console.error("Erro ao criar grupo:", e);
        } finally {
            setIsSaving(false);
        }
    };

    const toggleSectorInGroup = async (groupId: string, sector: string) => {
        if (isSaving) return;
        
        const updated = safeGroups.map(g => {
            if (g.id !== groupId) return g;
            const currentSectors = Array.isArray(g.includedSectors) ? g.includedSectors : [];
            const exists = currentSectors.includes(sector);
            return { 
                ...g, 
                includedSectors: exists 
                    ? currentSectors.filter(s => s !== sector) 
                    : [...currentSectors, sector] 
            };
        });
        
        try {
            await onUpdateGroups(updated);
        } catch (e) {
            console.error("Erro ao atualizar setores do grupo:", e);
        }
    };

    return (
        <div className="space-y-8 max-w-5xl mx-auto pb-32 animate-fade-in">
            <div className="bg-gray-800 p-8 rounded-3xl border border-purple-500/20 shadow-2xl space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-black flex items-center text-purple-400 tracking-tight">
                            <TableCellsIcon className="w-8 h-8 mr-3"/> Agrupamento de Ingressos
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">Combine setores (ex: Pista + VIP) para visualizar totais unificados no Dashboard.</p>
                    </div>
                </div>

                <div className="flex gap-3 bg-gray-900/50 p-3 rounded-2xl border border-gray-700 shadow-inner">
                    <input 
                        value={newGroupName} 
                        onChange={e => setNewGroupName(e.target.value)} 
                        placeholder="Nome do Grupo (ex: Área Geral)" 
                        className="flex-1 bg-transparent p-4 rounded-xl text-sm outline-none focus:ring-1 ring-purple-500/30" 
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                    />
                    <button 
                        onClick={handleCreateGroup} 
                        disabled={isSaving || !newGroupName.trim()}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-8 rounded-xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center"
                    >
                        {isSaving ? "Criando..." : <><PlusCircleIcon className="w-5 h-5 mr-2"/> Criar</>}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {safeGroups.map(group => (
                        <div key={group.id} className="bg-gray-900 border border-gray-700 p-6 rounded-3xl shadow-xl relative group transition-all hover:border-purple-500/40">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-black text-white text-lg tracking-tight">{group.name}</h3>
                                <button 
                                    onClick={() => onUpdateGroups(safeGroups.filter(g => g.id !== group.id))} 
                                    className="text-gray-500 hover:text-red-500 p-2 transition-colors rounded-lg hover:bg-red-500/10"
                                    title="Remover Grupo"
                                >
                                    <TrashIcon className="w-5 h-5"/>
                                </button>
                            </div>
                            
                            <div className="flex flex-wrap gap-2">
                                {safeSectorNames.length === 0 ? (
                                    <p className="text-xs text-gray-600 italic py-4">Configure setores na aba de Configurações primeiro.</p>
                                ) : (
                                    safeSectorNames.map(sector => {
                                        const active = (group.includedSectors || []).includes(sector);
                                        return (
                                            <button 
                                                key={sector} 
                                                onClick={() => toggleSectorInGroup(group.id, sector)}
                                                className={`text-[10px] px-4 py-2.5 rounded-xl font-bold transition-all border ${
                                                    active 
                                                    ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_12px_rgba(147,51,234,0.3)]' 
                                                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
                                                }`}
                                            >
                                                {sector}
                                            </button>
                                        );
                                    })
                                )}
                            </div>

                            {(!group.includedSectors || group.includedSectors.length === 0) && (
                                <div className="mt-6 p-3 bg-orange-900/10 border border-orange-500/20 rounded-xl text-[10px] text-orange-400 flex items-center font-bold">
                                    <AlertTriangleIcon className="w-4 h-4 mr-2" /> 
                                    Selecione ao menos um setor acima para este grupo.
                                </div>
                            )}
                        </div>
                    ))}

                    {safeGroups.length === 0 && (
                        <div className="col-span-full py-24 text-center bg-gray-900/40 rounded-[2.5rem] border-2 border-dashed border-gray-700">
                            <div className="bg-gray-800 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl">
                                <TableCellsIcon className="w-10 h-10 text-gray-600" />
                            </div>
                            <p className="text-gray-400 font-bold text-lg">Nenhum grupo ativo</p>
                            <p className="text-gray-600 text-sm mt-2">Crie seu primeiro grupo usando o campo acima.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GroupingModule;

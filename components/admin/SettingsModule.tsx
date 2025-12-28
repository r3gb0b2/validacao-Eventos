
import React, { useState } from 'react';
import { ImportSource, ImportType, Event } from '../../types';
import { Firestore, doc, setDoc } from 'firebase/firestore';
import { CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon } from '../Icons';
import Papa from 'papaparse';

interface SettingsModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  hiddenSectors: string[];
  importSources: ImportSource[];
  onUpdateSectorNames: (names: string[], hidden: string[]) => Promise<void>;
  onUpdateImportSources: (sources: ImportSource[]) => Promise<void>;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
}

const API_PRESETS = [
    { name: "E-Inscrição", url: "https://api.e-inscricao.com/v1/eventos/[ID]/participantes", type: "participants" },
    { name: "Google Sheets (CSV)", url: "https://docs.google.com/spreadsheets/d/ID/export?format=csv", type: "google_sheets" }
];

const SettingsModule: React.FC<SettingsModuleProps> = ({ db, selectedEvent, sectorNames, hiddenSectors, importSources, onUpdateSectorNames, onUpdateImportSources, isLoading, setIsLoading }) => {
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({ name: '', url: '', token: '', type: 'tickets', autoImport: false });

    const handleSaveSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha Nome e URL.");
        const newSource = { ...editSource, id: Math.random().toString(36).substr(2, 9) } as ImportSource;
        const updated = [...importSources, newSource];
        await onUpdateImportSources(updated);
        setEditSource({ name: '', url: '', token: '', type: 'tickets', autoImport: false });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
            <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                <h3 className="font-bold mb-4 flex items-center text-blue-400"><CloudUploadIcon className="w-5 h-5 mr-2" /> APIs e Integrações</h3>
                <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl mb-4">
                    <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Nome da Fonte" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm" />
                    <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="URL ou Link CSV" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm" />
                    <button onClick={handleSaveSource} className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-xl font-bold">Adicionar Fonte</button>
                </div>
                <div className="space-y-2">
                    {importSources.map(s => (
                        <div key={s.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl border border-gray-700">
                            <span className="text-sm font-bold">{s.name}</span>
                            <button onClick={() => onUpdateImportSources(importSources.filter(x => x.id !== s.id))} className="text-red-500 p-2"><TrashIcon className="w-4 h-4"/></button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-gray-800 p-5 rounded-2xl border border-gray-700 shadow-xl">
                <h3 className="font-bold mb-4 flex items-center text-gray-300"><TableCellsIcon className="w-5 h-5 mr-2" /> Gerenciar Setores</h3>
                <div className="space-y-2">
                    {sectorNames.map((name, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-900/50 p-3 rounded-xl border border-gray-700">
                            <span className="text-sm">{name}</span>
                            <div className="flex gap-2">
                                <button onClick={() => {
                                    const isHidden = hiddenSectors.includes(name);
                                    const newHidden = isHidden ? hiddenSectors.filter(h => h !== name) : [...hiddenSectors, name];
                                    onUpdateSectorNames(sectorNames, newHidden);
                                }} className="p-2 bg-gray-800 rounded-lg">
                                    {hiddenSectors.includes(name) ? <EyeSlashIcon className="w-4 h-4 text-gray-500"/> : <EyeIcon className="w-4 h-4 text-blue-400"/>}
                                </button>
                                <button onClick={() => onUpdateSectorNames(sectorNames.filter((_, idx) => idx !== i), hiddenSectors)} className="p-2 text-red-500"><TrashIcon className="w-4 h-4"/></button>
                            </div>
                        </div>
                    ))}
                    <button onClick={() => { const n = prompt("Nome do Setor:"); if(n) onUpdateSectorNames([...sectorNames, n], hiddenSectors); }} className="w-full mt-4 p-3 border-2 border-dashed border-gray-700 rounded-xl text-gray-500 hover:text-white hover:border-gray-500">+ Novo Setor</button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModule;

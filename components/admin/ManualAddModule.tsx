
import React, { useState } from 'react';
import { Event } from '../../types';
import { Firestore, writeBatch, doc, setDoc } from 'firebase/firestore';
import { PlusCircleIcon } from '../Icons';

interface ManualAddModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
}

const ManualAddModule: React.FC<ManualAddModuleProps> = ({ db, selectedEvent, sectorNames, isLoading, setIsLoading }) => {
    const [codes, setCodes] = useState('');
    const [sector, setSector] = useState(sectorNames[0] || '');

    const handleAdd = async () => {
        const list = codes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (list.length === 0) return;
        setIsLoading(true);
        try {
            const batchSize = 450;
            for (let i = 0; i < list.length; i += batchSize) {
                const chunk = list.slice(i, i + batchSize);
                const batch = writeBatch(db);
                chunk.forEach(code => {
                    batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), { id: code, sector, status: 'AVAILABLE', source: 'manual_direct' });
                });
                await batch.commit();
            }
            setCodes('');
            alert("Lote adicionado! (Já visíveis na carga total do Dashboard)");
        } catch (e) { alert("Erro ao salvar."); } finally { setIsLoading(false); }
    };

    return (
        <div className="bg-gray-800 p-6 rounded-2xl border border-orange-500/20 shadow-xl">
            <h2 className="text-xl font-bold mb-4 flex items-center text-orange-500"><PlusCircleIcon className="w-6 h-6 mr-2"/> Adicionar Manual (Direto)</h2>
            <p className="text-xs text-gray-500 mb-4">* Contam imediatamente para a carga total do evento.</p>
            <textarea value={codes} onChange={e => setCodes(e.target.value)} placeholder="Cole os códigos aqui..." className="w-full h-48 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm mb-4" />
            <div className="flex gap-4">
                <select value={sector} onChange={e => setSector(e.target.value)} className="flex-1 bg-gray-700 p-4 rounded-xl font-bold">
                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={handleAdd} disabled={isLoading} className="bg-orange-600 px-10 rounded-xl font-bold">{isLoading ? 'Salvando...' : 'Adicionar Lote'}</button>
            </div>
        </div>
    );
};

export default ManualAddModule;

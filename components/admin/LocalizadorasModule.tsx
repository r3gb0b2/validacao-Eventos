
import React, { useState, useEffect } from 'react';
import { Event } from '../../types';
import { Firestore, writeBatch, doc, setDoc } from 'firebase/firestore';
import { ClockIcon, AlertTriangleIcon } from '../Icons';

interface LocalizadorasModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
}

const LocalizadorasModule: React.FC<LocalizadorasModuleProps> = ({ db, selectedEvent, sectorNames = [], isLoading, setIsLoading }) => {
    const [codes, setCodes] = useState('');
    const [sector, setSector] = useState('');

    useEffect(() => {
        if (sectorNames.length > 0 && !sector) {
            setSector(sectorNames[0]);
        }
    }, [sectorNames]);

    const handleAdd = async () => {
        if (sectorNames.length === 0) return alert("Crie ao menos um setor na aba Configurações primeiro.");
        const list = codes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
        if (list.length === 0) return;
        setIsLoading(true);
        try {
            const batchSize = 450;
            for (let i = 0; i < list.length; i += batchSize) {
                const chunk = list.slice(i, i + batchSize);
                const batch = writeBatch(db);
                chunk.forEach(code => {
                    batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), { id: code, sector, status: 'AVAILABLE', source: 'manual_locator' });
                });
                await batch.commit();
            }
            setCodes('');
            alert("Lote adicionado! (Não aparecerão no Dashboard até serem usados)");
        } catch (e) { alert("Erro ao salvar."); } finally { setIsLoading(false); }
    };

    if (sectorNames.length === 0) {
        return (
            <div className="bg-gray-800 p-8 rounded-2xl border border-blue-500/20 shadow-xl text-center">
                <AlertTriangleIcon className="w-12 h-12 text-blue-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Nenhum setor configurado</h2>
                <p className="text-gray-400 text-sm">Vá na aba <b>Configurações</b> e adicione os setores do evento antes de carregar localizadoras.</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 p-6 rounded-2xl border border-blue-500/20 shadow-xl animate-fade-in">
            <h2 className="text-xl font-bold mb-4 flex items-center text-blue-400"><ClockIcon className="w-6 h-6 mr-2"/> Ingressos Localizadoras</h2>
            <p className="text-xs text-gray-500 mb-4">* Só aparecem no Dashboard após validação na portaria.</p>
            <textarea value={codes} onChange={e => setCodes(e.target.value)} placeholder="Cole os códigos aqui (um por linha)..." className="w-full h-48 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm mb-4 outline-none focus:border-blue-500" />
            <div className="flex gap-4">
                <select value={sector} onChange={e => setSector(e.target.value)} className="flex-1 bg-gray-700 p-4 rounded-xl font-bold outline-none cursor-pointer">
                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={handleAdd} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 px-10 rounded-xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50">{isLoading ? 'Salvando...' : 'Adicionar Lote'}</button>
            </div>
        </div>
    );
};

export default LocalizadorasModule;

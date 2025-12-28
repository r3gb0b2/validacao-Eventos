
import React, { useState, useEffect } from 'react';
import { Event, Ticket } from '../../types';
import { Firestore, writeBatch, doc } from 'firebase/firestore';
import { ClockIcon, AlertTriangleIcon, CheckCircleIcon } from '../Icons';

interface LocalizadorasModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  allTickets: Ticket[];
}

const LocalizadorasModule: React.FC<LocalizadorasModuleProps> = ({ db, selectedEvent, sectorNames = [], isLoading, setIsLoading, allTickets = [] }) => {
    const [codes, setCodes] = useState('');
    const [sector, setSector] = useState('');

    useEffect(() => {
        if (sectorNames.length > 0 && !sector) {
            setSector(sectorNames[0]);
        }
    }, [sectorNames]);

    const handleAdd = async () => {
        if (sectorNames.length === 0) return alert("Crie ao menos um setor na aba Configurações primeiro.");
        
        const inputList = codes.split('\n')
            .map(c => c.trim())
            .filter(c => c.length > 0);
        
        if (inputList.length === 0) return;

        setIsLoading(true);
        try {
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));
            let addedCount = 0;
            let skippedCount = 0;

            const toAdd = inputList.filter(code => {
                if (existingIds.has(code)) {
                    skippedCount++;
                    return false;
                }
                addedCount++;
                return true;
            });

            if (toAdd.length > 0) {
                const batchSize = 450;
                for (let i = 0; i < toAdd.length; i += batchSize) {
                    const chunk = toAdd.slice(i, i + batchSize);
                    const batch = writeBatch(db);
                    chunk.forEach(code => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), { 
                            id: code, 
                            sector, 
                            status: 'AVAILABLE', 
                            source: 'manual_locator' 
                        });
                    });
                    await batch.commit();
                }
            }

            setCodes('');
            alert(
                `Processamento Concluído!\n\n` +
                `• ${addedCount} ingressos adicionados com sucesso.\n` +
                `• ${skippedCount} ingressos ignorados por já existirem na base (duplicados).`
            );
        } catch (e) { 
            console.error(e);
            alert("Erro ao salvar o lote."); 
        } finally { 
            setIsLoading(false); 
        }
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
            <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl mb-4 flex items-start space-x-3">
                <CheckCircleIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-200/70 leading-relaxed">
                    <p className="font-bold text-blue-400 uppercase mb-1">Proteção de Dados Ativa:</p>
                    <p>Códigos que já existem no sistema (de qualquer fonte ou status) serão <b>automaticamente ignorados</b> para evitar perda de check-ins ou informações de participantes.</p>
                </div>
            </div>
            <textarea value={codes} onChange={e => setCodes(e.target.value)} placeholder="Cole os códigos aqui (um por linha)..." className="w-full h-48 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm mb-4 outline-none focus:border-blue-500" />
            <div className="flex flex-col md:flex-row gap-4">
                <select value={sector} onChange={e => setSector(e.target.value)} className="flex-1 bg-gray-700 p-4 rounded-xl font-bold outline-none cursor-pointer">
                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={handleAdd} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 px-10 py-4 rounded-xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50">{isLoading ? 'Salvando...' : 'Adicionar Lote'}</button>
            </div>
        </div>
    );
};

export default LocalizadorasModule;

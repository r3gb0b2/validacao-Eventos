
import React, { useState, useEffect } from 'react';
import { Event, Ticket } from '../../types';
import { Firestore, writeBatch, doc } from 'firebase/firestore';
import { AlertTriangleIcon, CheckCircleIcon, PlusCircleIcon } from '../Icons';

interface AlertTicketsModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  allTickets: Ticket[];
}

const AlertTicketsModule: React.FC<AlertTicketsModuleProps> = ({ db, selectedEvent, sectorNames = [], isLoading, setIsLoading, allTickets = [] }) => {
    const [codes, setCodes] = useState('');
    const [sector, setSector] = useState('');
    const [alertMessage, setAlertMessage] = useState('');

    useEffect(() => {
        if (sectorNames.length > 0 && !sector) {
            setSector(sectorNames[0]);
        }
    }, [sectorNames]);

    const handleAdd = async () => {
        if (!alertMessage.trim()) return alert("Defina uma mensagem de alerta para estes ingressos.");
        if (sectorNames.length === 0) return alert("Crie ao menos um setor na aba Configurações primeiro.");
        
        const inputList = codes.split('\n')
            .map(c => c.trim())
            .filter(c => c.length > 0);
        
        if (inputList.length === 0) return alert("Insira ao menos um código.");

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
                            source: 'alert_manual',
                            details: {
                                alertMessage: alertMessage.trim()
                            }
                        });
                    });
                    await batch.commit();
                }
            }

            setCodes('');
            setAlertMessage('');
            alert(
                `Processamento de Alertas Concluído!\n\n` +
                `• ${addedCount} ingressos com alerta adicionados.\n` +
                `• ${skippedCount} ingressos ignorados por já existirem.`
            );
        } catch (e) { 
            console.error(e);
            alert("Erro ao salvar ingressos com alerta."); 
        } finally { 
            setIsLoading(false); 
        }
    };

    return (
        <div className="bg-gray-800 p-6 rounded-3xl border border-red-500/20 shadow-xl animate-fade-in">
            <h2 className="text-xl font-bold mb-4 flex items-center text-red-500"><AlertTriangleIcon className="w-6 h-6 mr-2"/> Ingressos com Alerta</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
                <div className="space-y-4">
                    <label className="block text-xs font-black text-gray-500 uppercase">1. Códigos dos Ingressos (Um por linha)</label>
                    <textarea 
                        value={codes} 
                        onChange={e => setCodes(e.target.value)} 
                        placeholder="Cole os códigos..." 
                        className="w-full h-48 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none focus:border-red-500" 
                    />
                </div>

                <div className="space-y-4">
                    <label className="block text-xs font-black text-gray-500 uppercase">2. Mensagem para o Operador</label>
                    <textarea 
                        value={alertMessage} 
                        onChange={e => setAlertMessage(e.target.value)} 
                        placeholder="Ex: Entregar brinde do patrocinador. / Cliente VIP, encaminhar para mesa 10." 
                        className="w-full h-32 bg-gray-900 border border-gray-700 p-4 rounded-xl text-sm outline-none focus:border-red-500 text-red-400 font-bold" 
                    />
                    
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-500 uppercase font-bold">Setor de Destino</label>
                        <select value={sector} onChange={e => setSector(e.target.value)} className="w-full bg-gray-700 p-4 rounded-xl font-bold outline-none cursor-pointer">
                            {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <button 
                onClick={handleAdd} 
                disabled={isLoading || !codes.trim() || !alertMessage.trim()} 
                className="w-full bg-red-600 hover:bg-red-700 text-white px-10 py-5 rounded-2xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {isLoading ? 'Salvando...' : <><PlusCircleIcon className="w-5 h-5"/> Gravar Ingressos com Alerta</>}
            </button>
        </div>
    );
};

export default AlertTicketsModule;

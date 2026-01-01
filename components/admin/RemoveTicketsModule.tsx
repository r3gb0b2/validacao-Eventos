
import React, { useState } from 'react';
import { Event, Ticket } from '../../types';
import { Firestore, writeBatch, doc } from 'firebase/firestore';
import { TrashIcon, AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from '../Icons';

interface RemoveTicketsModuleProps {
  db: Firestore;
  selectedEvent: Event;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  allTickets: Ticket[];
}

const RemoveTicketsModule: React.FC<RemoveTicketsModuleProps> = ({ db, selectedEvent, isLoading, setIsLoading, allTickets = [] }) => {
    const [codes, setCodes] = useState('');

    const handleRemove = async () => {
        const inputList = codes.split('\n')
            .map(c => c.trim())
            .filter(c => c.length > 0);
            
        if (inputList.length === 0) return alert("Insira ao menos um código para remover.");

        if (!confirm(`TEM CERTEZA?\nVocê está prestes a remover permanentemente ${inputList.length} códigos deste evento. Esta ação não pode ser desfeita.`)) {
            return;
        }

        setIsLoading(true);
        try {
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));
            let deletedCount = 0;
            let notFoundCount = 0;

            const toDelete = inputList.filter(code => {
                if (existingIds.has(code)) {
                    deletedCount++;
                    return true;
                }
                notFoundCount++;
                return false;
            });

            if (toDelete.length > 0) {
                const batchSize = 450;
                for (let i = 0; i < toDelete.length; i += batchSize) {
                    const chunk = toDelete.slice(i, i + batchSize);
                    const batch = writeBatch(db);
                    chunk.forEach(code => {
                        batch.delete(doc(db, 'events', selectedEvent.id, 'tickets', code));
                    });
                    await batch.commit();
                }
            }

            setCodes('');
            alert(
                `Operação de Remoção Concluída!\n\n` +
                `• ${deletedCount} ingressos foram removidos com sucesso.\n` +
                `• ${notFoundCount} códigos não foram encontrados na lista atual.`
            );
        } catch (e) { 
            console.error(e);
            alert("Erro ao realizar a remoção em massa."); 
        } finally { 
            setIsLoading(false); 
        }
    };

    return (
        <div className="bg-gray-800 p-6 rounded-[2.5rem] border border-red-500/20 shadow-xl animate-fade-in max-w-4xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <div className="bg-red-600/20 p-3 rounded-2xl text-red-500">
                    <TrashIcon className="w-8 h-8" />
                </div>
                <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">Remover Ingressos da Lista</h2>
                    <p className="text-xs text-gray-500 font-bold uppercase">Exclusão permanente por lote de códigos</p>
                </div>
            </div>

            <div className="bg-orange-900/10 border border-orange-500/30 p-5 rounded-3xl mb-6 flex items-start space-x-4">
                <AlertTriangleIcon className="w-6 h-6 text-orange-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-orange-200/70 leading-relaxed">
                    <p className="font-bold text-orange-400 uppercase mb-1 text-sm">Aviso de Segurança:</p>
                    <p>Esta ferramenta remove os ingressos <b>permanentemente</b>. Se um ingresso removido for escaneado posteriormente, ele aparecerá como "Não Encontrado" no scanner. Ingressos que já possuem check-in também serão removidos se o código for incluído na lista.</p>
                </div>
            </div>

            <div className="space-y-4">
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest ml-2">Lista de códigos para exclusão (Um por linha)</label>
                <textarea 
                    value={codes} 
                    onChange={e => setCodes(e.target.value)} 
                    placeholder="Cole os códigos aqui para remover do banco..." 
                    className="w-full h-64 bg-gray-900 border-2 border-gray-700 p-5 rounded-3xl text-sm outline-none focus:border-red-500 transition-all font-mono text-red-400" 
                />
            </div>

            <div className="mt-8 flex flex-col md:flex-row items-center gap-4">
                <button 
                    onClick={handleRemove} 
                    disabled={isLoading || !codes.trim()} 
                    className="w-full md:flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-5 rounded-2xl shadow-xl shadow-red-900/20 transition-all transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 text-lg"
                >
                    {isLoading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                        <TrashIcon className="w-6 h-6" />
                    )}
                    {isLoading ? 'Processando Exclusão...' : 'Remover Ingressos Agora'}
                </button>
                <button 
                    onClick={() => setCodes('')}
                    className="w-full md:w-auto px-8 py-5 bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold rounded-2xl transition-all"
                >
                    Limpar Lista
                </button>
            </div>
        </div>
    );
};

export default RemoveTicketsModule;

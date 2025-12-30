
import React from 'react';
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from './Icons';

interface AlertConfirmationModalProps {
    message: string;
    ticketId: string;
    ownerName?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const AlertConfirmationModal: React.FC<AlertConfirmationModalProps> = ({ message, ticketId, ownerName, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-lg bg-gray-800 border-2 border-red-500 rounded-[2.5rem] shadow-[0_0_50px_rgba(239,68,68,0.3)] overflow-hidden">
                <div className="bg-red-600 p-6 flex flex-col items-center text-center">
                    <AlertTriangleIcon className="w-20 h-20 text-white animate-pulse mb-2" />
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Atenção Operador!</h2>
                </div>
                
                <div className="p-8 space-y-6">
                    <div className="bg-gray-900/50 p-6 rounded-3xl border border-gray-700 text-center">
                        <p className="text-xl md:text-2xl font-black text-red-400 leading-tight">
                            "{message}"
                        </p>
                    </div>

                    <div className="flex flex-col items-center text-gray-400">
                        <p className="text-sm font-bold">{ownerName || 'Participante não identificado'}</p>
                        <p className="text-[10px] font-mono tracking-widest">{ticketId}</p>
                    </div>

                    <div className="flex gap-4">
                        <button 
                            onClick={onCancel}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-5 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                            <XCircleIcon className="w-5 h-5" /> CANCELAR
                        </button>
                        <button 
                            onClick={onConfirm}
                            className="flex-3 bg-green-600 hover:bg-green-700 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-green-900/40 active:scale-95 flex items-center justify-center gap-2 text-lg"
                        >
                            <CheckCircleIcon className="w-6 h-6" /> OK / VALIDAR
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AlertConfirmationModal;

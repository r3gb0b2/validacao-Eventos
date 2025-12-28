
import React from 'react';
import { ScanStatus } from '../types';
import { CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon } from './Icons';

interface StatusDisplayProps {
  status: ScanStatus;
  message: string;
  extra?: string;
}

const StatusDisplay: React.FC<StatusDisplayProps> = ({ status, message, extra }) => {
  const getStatusStyle = () => {
    switch (status) {
      case 'VALID':
        return {
          Icon: CheckCircleIcon,
          color: 'text-green-300',
          bgColor: 'bg-green-500/90',
          title: 'Acesso Liberado',
        };
      case 'USED':
        return {
          Icon: AlertTriangleIcon,
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-600/90',
          title: 'Já Utilizado',
        };
      case 'INVALID':
      case 'ERROR':
        return {
          Icon: XCircleIcon,
          color: 'text-red-300',
          bgColor: 'bg-red-600/90',
          title: 'Acesso Negado',
        };
      case 'WRONG_SECTOR':
         return {
          Icon: XCircleIcon,
          color: 'text-orange-300',
          bgColor: 'bg-orange-600/90',
          title: 'Setor Incorreto',
        };
      default:
        return {
          Icon: XCircleIcon,
          color: 'text-gray-300',
          bgColor: 'bg-gray-800/90',
          title: 'Status Desconhecido',
        };
    }
  };

  const { Icon, color, bgColor, title } = getStatusStyle();

  return (
    <div 
      className={`absolute inset-0 flex flex-col items-center justify-center text-center p-8 ${bgColor} backdrop-blur-md z-50 transition-all duration-150 animate-fade-in`}
      style={{ animationDuration: '150ms' }}
    >
      <Icon className={`w-28 h-28 mb-4 ${color} drop-shadow-2xl`} />
      
      <h2 className={`text-3xl md:text-5xl font-black uppercase tracking-tighter ${color} mb-2`}>
        {title}
      </h2>
      
      <div className="bg-black/20 p-4 rounded-3xl border border-white/10 backdrop-blur-xl max-w-xs w-full">
        {status === 'USED' && (
            <div className="flex items-center justify-center space-x-2 text-white mb-2 font-black uppercase tracking-widest text-[10px]">
                <ClockIcon className="w-4 h-4 text-yellow-300" />
                <span>Primeira Entrada</span>
            </div>
        )}
        <p className="text-lg md:text-xl text-white font-bold leading-tight">
            {message}
        </p>
        {extra && (
            <p className="text-[10px] text-white/60 mt-2 font-mono uppercase tracking-widest">
                {extra}
            </p>
        )}
      </div>

      <div className="mt-8">
          <div className="w-12 h-1 bg-white/30 rounded-full animate-pulse mx-auto"></div>
      </div>
    </div>
  );
};

export default StatusDisplay;

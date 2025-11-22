import React from 'react';
import { ScanStatus } from '../types';
import { CheckCircleIcon, XCircleIcon, AlertTriangleIcon } from './Icons';

interface StatusDisplayProps {
  status: ScanStatus;
  message: string;
}

const StatusDisplay: React.FC<StatusDisplayProps> = ({ status, message }) => {
  const getStatusStyle = () => {
    switch (status) {
      // FIX: Changed 'SUCCESS' to 'VALID' to match the ScanStatus type.
      case 'VALID':
        return {
          Icon: CheckCircleIcon,
          color: 'text-green-300',
          bgColor: 'bg-green-500/80',
          title: 'Acesso Liberado',
        };
      case 'USED':
        return {
          Icon: AlertTriangleIcon,
          color: 'text-yellow-300',
          bgColor: 'bg-yellow-500/80',
          title: 'Ingresso Já Utilizado',
        };
      case 'INVALID':
      case 'ERROR':
        return {
          Icon: XCircleIcon,
          color: 'text-red-300',
          bgColor: 'bg-red-500/80',
          title: 'Acesso Negado',
        };
      case 'WRONG_SECTOR':
         return {
          Icon: XCircleIcon,
          color: 'text-orange-300',
          bgColor: 'bg-orange-600/80',
          title: 'Acesso Negado',
        };
      default:
        return {
          Icon: XCircleIcon,
          color: 'text-gray-300',
          bgColor: 'bg-gray-700/80',
          title: 'Status Desconhecido',
        };
    }
  };

  const { Icon, color, bgColor, title } = getStatusStyle();

  return (
    <div 
      className={`absolute inset-0 flex flex-col items-center justify-center text-center p-8 ${bgColor} backdrop-blur-sm z-10 transition-opacity duration-300 animate-fade-in`}
    >
      <Icon className={`w-24 h-24 mb-4 ${color}`} />
      <h2 className={`text-3xl md:text-4xl font-bold ${color}`}>{title}</h2>
      <p className="text-lg md:text-xl text-white mt-2 font-semibold break-words">{message}</p>
    </div>
  );
};

export default StatusDisplay;

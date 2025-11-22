import React from 'react';
import { Event } from '../types';
import { CogIcon, QrCodeIcon } from './Icons';

interface EventSelectorProps {
  events: Event[];
  onSelectEvent: (event: Event) => void;
  onAccessAdmin: () => void;
}

const EventSelector: React.FC<EventSelectorProps> = ({ events, onSelectEvent, onAccessAdmin }) => {
  const visibleEvents = events.filter(event => !event.isHidden);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-md text-center">
        <QrCodeIcon className="w-20 h-20 mx-auto text-orange-500 mb-4" />
        <h1 className="text-4xl font-bold mb-2">Selecione um Evento</h1>
        <p className="text-gray-400 mb-8">Escolha o evento que você deseja gerenciar ou validar.</p>

        <div className="space-y-4">
          {visibleEvents.length > 0 ? (
            visibleEvents.map(event => (
              <button
                key={event.id}
                onClick={() => onSelectEvent(event)}
                className="w-full bg-gray-800 hover:bg-orange-600 border-2 border-gray-700 hover:border-orange-600 text-white font-bold py-4 px-6 rounded-lg transition-all duration-300 transform hover:scale-105"
              >
                {event.name}
              </button>
            ))
          ) : (
            <div className="text-gray-500 bg-gray-800 p-6 rounded-lg">
                <p>Nenhum evento ativo encontrado.</p>
                <p className="text-sm mt-2">Crie ou mostre um evento no painel administrativo.</p>
            </div>
          )}
        </div>
        <div className="mt-12">
           <button
             onClick={onAccessAdmin}
             className="text-gray-400 hover:text-orange-500 transition-colors flex items-center mx-auto group"
           >
               <CogIcon className="w-5 h-5 mr-2 transition-transform group-hover:rotate-90" />
               Acessar Painel Administrativo
           </button>
       </div>
      </div>
    </div>
  );
};

export default EventSelector;
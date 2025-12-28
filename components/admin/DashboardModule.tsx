
import React, { useMemo } from 'react';
import { Ticket, DisplayableScanLog, Event, SectorGroup } from '../../types';
import Stats from '../Stats';
import { generateEventReport } from '../../utils/pdfGenerator';
import { CloudDownloadIcon, LinkIcon } from '../Icons';

interface DashboardModuleProps {
  selectedEvent: Event;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  hiddenSectors: string[];
  groups: SectorGroup[];
}

const DashboardModule: React.FC<DashboardModuleProps> = ({ selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors, groups }) => {
    const publicLink = useMemo(() => {
        const base = window.location.origin + window.location.pathname;
        return `${base}?mode=stats&eventId=${selectedEvent.id}`;
    }, [selectedEvent]);

    return (
        <div className="space-y-6">
            <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700 flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg">
                <button 
                    onClick={() => generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames)}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center transition-all shadow-lg active:scale-95"
                >
                    <CloudDownloadIcon className="w-4 h-4 mr-2" /> Gerar Relatório PDF
                </button>

                <div className="flex items-center space-x-3 w-full md:w-auto bg-gray-900/50 p-2 rounded-xl border border-gray-700">
                    <LinkIcon className="w-4 h-4 text-gray-500 ml-2" />
                    <input type="text" readOnly value={publicLink} className="bg-transparent text-[10px] text-gray-400 outline-none w-48 md:w-64 truncate" />
                    <button 
                        onClick={() => { navigator.clipboard.writeText(publicLink); alert("Copiado!"); }}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold"
                    >
                        Copiar Link Público
                    </button>
                </div>
            </div>
            <Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode={groups.length > 0 ? 'grouped' : 'raw'} groups={groups} />
        </div>
    );
};

export default DashboardModule;

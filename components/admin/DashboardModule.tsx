import React, { useMemo, useState, useEffect } from 'react';
import { Ticket, DisplayableScanLog, Event, SectorGroup } from '../../types';
import Stats from '../Stats';
import { generateEventReport } from '../../utils/pdfGenerator';
import { CloudDownloadIcon, LinkIcon, TableCellsIcon, FunnelIcon } from '../Icons';

interface DashboardModuleProps {
  selectedEvent: Event;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  hiddenSectors: string[];
  groups: SectorGroup[];
}

const DashboardModule: React.FC<DashboardModuleProps> = ({ selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors, groups }) => {
    const [viewMode, setViewMode] = useState<'raw' | 'grouped'>(() => {
        return groups.length > 0 ? 'grouped' : 'raw';
    });

    useEffect(() => {
        if (groups.length === 0 && viewMode === 'grouped') {
            setViewMode('raw');
        }
    }, [groups, viewMode]);

    const publicLink = useMemo(() => {
        const base = window.location.origin + window.location.pathname;
        return `${base}?mode=stats&eventId=${selectedEvent.id}`;
    }, [selectedEvent]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="bg-gray-800 p-4 rounded-3xl border border-gray-700 flex flex-col lg:flex-row justify-between items-center gap-4 shadow-2xl">
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames)}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center shadow-lg transition-all"
                    >
                        <CloudDownloadIcon className="w-4 h-4 mr-2" /> PDF
                    </button>
                    {groups.length > 0 && (
                        <div className="flex bg-gray-900/80 p-1 rounded-2xl border border-gray-700 ml-2">
                            <button onClick={() => setViewMode('raw')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase ${viewMode === 'raw' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>Individuais</button>
                            <button onClick={() => setViewMode('grouped')} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase ${viewMode === 'grouped' ? 'bg-orange-600 text-white' : 'text-gray-500'}`}>Agrupados</button>
                        </div>
                    )}
                </div>
                <div className="flex items-center space-x-3 bg-gray-900/50 p-2 rounded-2xl border border-gray-700">
                    <LinkIcon className="w-4 h-4 text-gray-500 ml-2" />
                    <input type="text" readOnly value={publicLink} className="bg-transparent text-[10px] text-gray-500 outline-none w-64 truncate" />
                    <button onClick={() => { navigator.clipboard.writeText(publicLink); alert("Link copiado!"); }} className="bg-gray-800 text-gray-300 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase">Copiar</button>
                </div>
            </div>
            <Stats allTickets={allTickets} sectorNames={sectorNames} hiddenSectors={hiddenSectors} viewMode={viewMode} groups={groups} onViewModeChange={setViewMode} />
        </div>
    );
};

export default DashboardModule;
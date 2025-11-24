import React, { useMemo, useEffect, useState } from 'react';
import { Event, Ticket, DisplayableScanLog, AnalyticsData, SectorGroup } from '../types';
import Stats from './Stats';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';

interface PublicStatsViewProps {
  event: Event;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  isLoading?: boolean;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#f43f5e', '#84cc16', '#a855f7', '#06b6d4'];

const PublicStatsView: React.FC<PublicStatsViewProps> = ({ event, allTickets = [], scanHistory = [], sectorNames = [], isLoading = false }) => {
    
    // Load Sector Groups from LocalStorage (Read Only)
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);
    
    useEffect(() => {
        try {
            const savedGroups = localStorage.getItem('stats_sector_groups');
            if (savedGroups) {
                setSectorGroups(JSON.parse(savedGroups));
            }
        } catch (e) {
            console.error("Failed to load sector groups", e);
        }
    }, []);

    // Logic extracted from AdminView to calculate charts data
    const chartDisplayData = useMemo(() => {
        if (isLoading) {
             return {
                analyticsData: { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } },
                displaySectors: [],
                pieData: []
            };
        }

        // Prepare list of display names (Groups + Ungrouped Sectors)
        const groupedSectorNames = new Set<string>();
        sectorGroups.forEach(g => g.sectors.forEach(s => groupedSectorNames.add(s)));
        
        const displaySectors = [
            ...sectorGroups.map(g => g.name),
            ...(sectorNames || []).filter(s => !groupedSectorNames.has(s))
        ];

        // Safeguard: Filter out valid scans with invalid timestamps which crash Safari
        const validScans = (scanHistory || []).filter(s => 
            s && 
            s.status === 'VALID' && 
            s.timestamp && 
            !isNaN(Number(s.timestamp))
        );

        if (validScans.length === 0) {
            return {
                analyticsData: {
                    timeBuckets: [],
                    firstAccess: null,
                    lastAccess: null,
                    peak: { time: '-', count: 0 },
                },
                displaySectors,
                pieData: []
            };
        }

        validScans.sort((a, b) => a.timestamp - b.timestamp);

        const firstAccess = validScans[0].timestamp;
        const lastAccess = validScans[validScans.length - 1].timestamp;

        const buckets = new Map<string, { [sector: string]: number }>();
        const THIRTY_MINUTES_MS = 30 * 60 * 1000;

        for (const scan of validScans) {
            const bucketStart = Math.floor(scan.timestamp / THIRTY_MINUTES_MS) * THIRTY_MINUTES_MS;
            const date = new Date(bucketStart);
            
            // Skip invalid dates to prevent crash
            if (isNaN(date.getTime())) continue;

            const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            
            if (!buckets.has(key)) {
                const initialCounts = displaySectors.reduce((acc, name) => ({ ...acc, [name]: 0 }), {});
                buckets.set(key, initialCounts);
            }
            const currentBucket = buckets.get(key)!;
            
            // Determine if sector belongs to a group
            let sectorKey = scan.ticketSector;
            const foundGroup = sectorGroups.find(g => g.sectors.includes(scan.ticketSector));
            if (foundGroup) {
                sectorKey = foundGroup.name;
            }

            if (currentBucket[sectorKey] !== undefined) {
                currentBucket[sectorKey]++;
            }
        }

        let peak = { time: '-', count: 0 };

        const timeBuckets = Array.from(buckets.entries())
            .map(([time, counts]) => {
                const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                if (total > peak.count) {
                    peak = { time, count: total };
                }
                return { time, counts, total };
            })
            .sort((a, b) => a.time.localeCompare(b.time));

        // PIE CHART DATA (Grouped)
        const usedTickets = (allTickets || []).filter(t => t && t.status === 'USED');
        const counts: Record<string, number> = {};
        
        displaySectors.forEach(ds => counts[ds] = 0);
        
        usedTickets.forEach(t => {
            let key = t.sector;
            const grp = sectorGroups.find(g => g.sectors.includes(t.sector));
            if (grp) key = grp.name;
            
            if (counts[key] !== undefined) counts[key]++;
        });

        const pieData = displaySectors.map((name, index) => ({
            name: name,
            value: counts[name],
            color: PIE_CHART_COLORS[index % PIE_CHART_COLORS.length],
        })).filter(item => item.value > 0);

        return { 
            analyticsData: { timeBuckets, firstAccess, lastAccess, peak },
            displaySectors,
            pieData
        };
    }, [scanHistory, sectorNames, isLoading, sectorGroups, allTickets]);

    // Helper for safe date formatting
    const safeFormatTime = (timestamp: number | null) => {
        if (!timestamp || isNaN(timestamp)) return '--:--';
        try {
            return new Date(timestamp).toLocaleTimeString('pt-BR');
        } catch (e) { return '--:--'; }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                <header className="flex justify-between items-center w-full border-b border-gray-700 pb-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-orange-500">{event?.name || 'Evento'}</h1>
                        <p className="text-sm text-gray-400">Painel de Acesso em Tempo Real</p>
                    </div>
                     <div className="text-right">
                        <p className="text-xs text-gray-500">Atualização Automática</p>
                        <div className="flex items-center justify-end mt-1">
                             <span className="relative flex h-3 w-3 mr-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                            <span className="text-xs font-bold text-green-500">Ao Vivo</span>
                        </div>
                    </div>
                </header>

                {isLoading ? (
                    /* Loading Skeleton */
                    <div className="space-y-6 animate-pulse">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="bg-gray-800 p-4 rounded-lg h-24 border-l-4 border-gray-600 flex flex-col justify-center">
                                    <div className="h-3 bg-gray-600 rounded w-1/2 mb-3"></div>
                                    <div className="h-6 bg-gray-500 rounded w-3/4"></div>
                                </div>
                            ))}
                        </div>
                        <div className="bg-gray-800 h-64 rounded-lg border border-gray-700"></div>
                         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                             <div className="bg-gray-800 h-64 rounded-lg"></div>
                             <div className="bg-gray-800 h-64 rounded-lg"></div>
                         </div>
                         <div className="text-center text-white font-bold mt-4 text-lg">Carregando estatísticas...</div>
                    </div>
                ) : (
                    <div className="space-y-6 animate-fade-in">
                        {/* Main Stats Component (KPIs + Table) */}
                        <Stats 
                            allTickets={allTickets || []} 
                            sectorNames={sectorNames || []} 
                            groups={sectorGroups}
                            // Public View does not allow editing groups
                        />

                        {/* Charts Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <PieChart data={chartDisplayData.pieData} title="Distribuição por Setor"/>
                            </div>
                            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <AnalyticsChart data={chartDisplayData.analyticsData} sectorNames={chartDisplayData.displaySectors} />
                            </div>
                        </div>

                        {/* Temporal Analysis Cards */}
                        <div>
                            <h3 className="text-xl font-bold text-white mb-4">Análise Temporal</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Primeiro Acesso</p>
                                    <p className="text-2xl font-bold text-green-400">
                                        {safeFormatTime(chartDisplayData.analyticsData.firstAccess)}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Último Acesso</p>
                                    <p className="text-2xl font-bold text-red-400">
                                        {safeFormatTime(chartDisplayData.analyticsData.lastAccess)}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Horário de Pico ({chartDisplayData.analyticsData.peak.time})</p>
                                    <p className="text-2xl font-bold text-orange-400">
                                        {chartDisplayData.analyticsData.peak.count} <span className="text-sm font-normal text-gray-400">entradas</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PublicStatsView;
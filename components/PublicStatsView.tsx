
import React, { useMemo, useState, useEffect } from 'react';
import { Event, Ticket, DisplayableScanLog, AnalyticsData, SectorGroup, formatSafeTime } from '../types';
import Stats from './Stats';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { getDb } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

interface PublicStatsViewProps {
  event: Event;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  hiddenSectors?: string[]; 
  isLoading?: boolean;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

const PublicStatsView: React.FC<PublicStatsViewProps> = ({ event, allTickets = [], scanHistory = [], sectorNames = [], hiddenSectors = [], isLoading = false }) => {
    
    const [viewMode, setViewMode] = useState<'raw' | 'grouped'>('raw');
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);

    const visibleTickets = useMemo(() => {
        return (allTickets || []).filter(t => 
            t &&
            t.source !== 'secret_generator' && 
            !hiddenSectors.includes(t.sector)
        );
    }, [allTickets, hiddenSectors]);

    useEffect(() => {
        if (!event) return;
        const loadConfig = async () => {
             try {
                 const db = await getDb();
                 const docRef = doc(db, 'events', event.id, 'settings', 'stats');
                 const snap = await getDoc(docRef);
                 if (snap.exists()) {
                     const data = snap.data();
                     if (data.viewMode) setViewMode(data.viewMode);
                     if (data.groups) setSectorGroups(data.groups);
                 }
             } catch(e) { console.error("Error loading public stats config", e); }
        };
        loadConfig();
    }, [event]);

    const analyticsData: AnalyticsData = useMemo(() => {
        if (isLoading) return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };

        const validUsedTickets = (visibleTickets || []).filter(t => 
            t && 
            t.status === 'USED' && 
            t.usedAt
        );

        if (validUsedTickets.length === 0) {
            return {
                timeBuckets: [],
                firstAccess: null,
                lastAccess: null,
                peak: { time: '-', count: 0 },
            };
        }

        const getMs = (val: any) => {
            if (!val) return 0;
            if (typeof val.toMillis === 'function') return val.toMillis();
            if (val.seconds !== undefined) return val.seconds * 1000;
            return Number(val);
        };

        validUsedTickets.sort((a, b) => getMs(a.usedAt) - getMs(b.usedAt));

        const firstAccess = getMs(validUsedTickets[0].usedAt) || null;
        const lastAccess = getMs(validUsedTickets[validUsedTickets.length - 1].usedAt) || null;

        const buckets = new Map<string, { [sector: string]: number }>();
        const INTERVAL_MS = 30 * 60 * 1000; 

        for (const ticket of validUsedTickets) {
            const ts = getMs(ticket.usedAt);
            const bucketStart = Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
            const date = new Date(bucketStart);
            
            if (isNaN(date.getTime())) continue;

            const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            
            if (!buckets.has(key)) {
                const initialCounts: Record<string, number> = {};
                 if (viewMode === 'grouped') {
                     sectorGroups.forEach(g => initialCounts[g.name] = 0);
                     sectorNames.filter(s => !hiddenSectors.includes(s)).forEach(name => {
                        const isGrouped = sectorGroups.some(g => g.includedSectors.some(s => s.toLowerCase() === name.toLowerCase()));
                        if (!isGrouped) initialCounts[name] = 0;
                    });
                } else {
                     sectorNames.filter(s => !hiddenSectors.includes(s)).forEach(name => initialCounts[name] = 0);
                }
                buckets.set(key, initialCounts);
            }
            const currentBucket = buckets.get(key)!;
            
            const sector = ticket.sector || 'Desconhecido';
            let targetKey = sector;
            if (viewMode === 'grouped') {
                 const group = sectorGroups.find(g => g.includedSectors.some(s => s.toLowerCase() === sector.toLowerCase()));
                 if (group) targetKey = group.name;
            }

            if (currentBucket[targetKey] !== undefined) {
                 currentBucket[targetKey]++;
            } else {
                currentBucket[targetKey] = 1;
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

        return { timeBuckets, firstAccess, lastAccess, peak };
    }, [visibleTickets, sectorNames, hiddenSectors, isLoading, viewMode, sectorGroups]);

     const pieChartData = useMemo(() => {
        if (isLoading) return [];
        const usedTickets = (visibleTickets || []).filter(t => t && t.status === 'USED');
        if (usedTickets.length === 0) return [];
        
        const counts: Record<string, number> = {};

        usedTickets.forEach(t => {
            const sector = t.sector || 'Desconhecido';
            let targetKey = sector;
            
            if (viewMode === 'grouped') {
                const group = sectorGroups.find(g => g.includedSectors.some(s => s.toLowerCase() === sector.toLowerCase()));
                if (group) targetKey = group.name;
            }
            counts[targetKey] = (counts[targetKey] || 0) + 1;
        });

        const keys = Object.keys(counts);
        return keys.map((name, index) => ({
            name: name,
            value: counts[name],
            color: PIE_CHART_COLORS[index % PIE_CHART_COLORS.length],
        })).filter(item => item.value > 0);
    }, [visibleTickets, sectorNames, hiddenSectors, isLoading, viewMode, sectorGroups]);

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
                        <Stats 
                            allTickets={visibleTickets || []} 
                            sectorNames={sectorNames || []}
                            hiddenSectors={hiddenSectors}
                            viewMode={viewMode}
                            groups={sectorGroups}
                            isReadOnly={true}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                    <PieChart data={pieChartData} title="Distribuição por Setor"/>
                                </div>
                            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <AnalyticsChart data={analyticsData} sectorNames={sectorNames.filter(s => !hiddenSectors.includes(s)) || []} />
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xl font-bold text-white mb-4">Análise Temporal</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Primeiro Acesso</p>
                                    <p className="text-2xl font-bold text-green-400">
                                        {formatSafeTime(analyticsData.firstAccess)}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Último Acesso</p>
                                    <p className="text-2xl font-bold text-red-400">
                                        {formatSafeTime(analyticsData.lastAccess)}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Horário de Pico ({analyticsData.peak.time})</p>
                                    <p className="text-2xl font-bold text-orange-400">
                                        {analyticsData.peak.count} <span className="text-sm font-normal text-gray-400">entradas</span>
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

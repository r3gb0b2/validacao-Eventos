
import React, { useMemo, useState, useEffect } from 'react';
import { Event, Ticket, DisplayableScanLog, AnalyticsData, SectorGroup } from '../types';
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
            t && t.status === 'USED' && t.usedAt && !isNaN(Number(t.usedAt))
        );

        if (validUsedTickets.length === 0) return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };

        validUsedTickets.sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0));
        const firstAccess = validUsedTickets[0].usedAt || null;
        const lastAccess = validUsedTickets[validUsedTickets.length - 1].usedAt || null;

        const buckets = new Map<string, { [sector: string]: number }>();
        const INTERVAL_MS = 30 * 60 * 1000;

        for (const ticket of validUsedTickets) {
            const ts = ticket.usedAt || 0;
            const bucketStart = Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
            const date = new Date(bucketStart);
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
            if (currentBucket[targetKey] !== undefined) currentBucket[targetKey]++;
        }

        let peak = { time: '-', count: 0 };
        const timeBuckets = Array.from(buckets.entries())
            .map(([time, counts]) => {
                const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                if (total > peak.count) peak = { time, count: total };
                return { time, counts, total };
            })
            .sort((a, b) => a.time.localeCompare(b.time));

        return { timeBuckets, firstAccess, lastAccess, peak };
    }, [visibleTickets, sectorNames, hiddenSectors, isLoading, viewMode, sectorGroups]);

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans p-4 md:p-8">
            <div className="w-full max-w-6xl mx-auto space-y-6">
                <header className="flex justify-between items-center w-full border-b border-gray-700 pb-4 mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-orange-500">{event?.name || 'Evento'}</h1>
                        <p className="text-sm text-gray-400">Painel de Acesso em Tempo Real</p>
                    </div>
                </header>
                <div className="space-y-6 animate-fade-in">
                    <Stats 
                        allTickets={visibleTickets} 
                        sectorNames={sectorNames}
                        hiddenSectors={hiddenSectors}
                        viewMode={viewMode}
                        groups={sectorGroups}
                        isReadOnly={true}
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                            <AnalyticsChart data={analyticsData} sectorNames={sectorNames.filter(s => !hiddenSectors.includes(s))} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PublicStatsView;

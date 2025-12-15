
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import Scanner from './Scanner';
import SuperAdminView from './SuperAdminView'; // Import Super Admin Component
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc } from 'firebase/firestore';
import { CloudDownloadIcon, CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, QrCodeIcon, UsersIcon, LockClosedIcon, TicketIcon } from './Icons';
import Papa from 'papaparse';

interface AdminViewProps {
  db: Firestore;
  events: Event[];
  selectedEvent: Event | null;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  hiddenSectors?: string[];
  onUpdateSectorNames: (newNames: string[], hiddenSectors?: string[]) => Promise<void>;
  isOnline: boolean;
  onSelectEvent: (event: Event) => void;
  currentUser: User | null; // Added current user prop
  onUpdateCurrentUser?: (user: Partial<User>) => void;
}

const PIE_CHART_COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];

type ImportType = 'tickets' | 'participants' | 'buyers' | 'checkins' | 'custom' | 'google_sheets';
type SearchType = 'TICKET_LOCAL' | 'BUYER_API';

interface ImportPreset {
    id?: string;
    name: string;
    url: string;
    token: string;
    eventId: string;
}

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, hiddenSectors = [], onUpdateSectorNames, isOnline, onSelectEvent, currentUser, onUpdateCurrentUser }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators' | 'locators'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [sectorVisibility, setSectorVisibility] = useState<boolean[]>([]); // Track visibility locally during edit
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    // Event Management State
    const [newEventName, setNewEventName] = useState('');
    const [renameEventName, setRenameEventName] = useState(selectedEvent?.name ?? '');

    // API Import State
    const [importType, setImportType] = useState<ImportType>('tickets');
    const [apiUrl, setApiUrl] = useState('https://public-api.stingressos.com.br/tickets');
    const [apiToken, setApiToken] = useState('');
    const [apiEventId, setApiEventId] = useState('');
    const [showImportToken, setShowImportToken] = useState(false);
    
    // Auto Import State
    const [autoImportEnabled, setAutoImportEnabled] = useState(false);
    const [lastAutoImportTime, setLastAutoImportTime] = useState<Date | null>(null);
    // FIX: Use ReturnType<typeof setInterval> instead of NodeJS.Timeout to avoid namespace errors.
    const autoImportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    
    // Ignore Existing State (Locked for normal admins)
    const [ignoreExisting, setIgnoreExisting] = useState(true);

    // Presets State
    const [importPresets, setImportPresets] = useState<ImportPreset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');

    // Online Mode State (Multi-API)
    const [validationMode, setValidationMode] = useState<'OFFLINE' | 'ONLINE_API' | 'ONLINE_SHEETS'>('OFFLINE');
    const [onlineApiEndpoints, setOnlineApiEndpoints] = useState<{ url: string, token: string, eventId: string }[]>([{ url: '', token: '', eventId: '' }]);
    const [onlineSheetUrl, setOnlineSheetUrl] = useState('');
    const [visibleTokens, setVisibleTokens] = useState<{ [key: number]: boolean }>({});
    
    // Search Tab State
    const [searchType, setSearchType] = useState<SearchType>('TICKET_LOCAL');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<{ ticket: Ticket | undefined, logs: DisplayableScanLog[] } | null>(null);
    const [buyerSearchResults, setBuyerSearchResults] = useState<any[]>([]);
    const [showScanner, setShowScanner] = useState(false); // Scanner Modal State

    // "Localizadores" (Stand-by) State
    const [locatorCodes, setLocatorCodes] = useState('');
    const [selectedLocatorSector, setSelectedLocatorSector] = useState(sectorNames[0] || '');

    // Stats Configuration State
    const [statsViewMode, setStatsViewMode] = useState<'raw' | 'grouped'>('raw');
    const [sectorGroups, setSectorGroups] = useState<SectorGroup[]>([]);

    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
    const canManageEvents = currentUser?.role === 'ADMIN' || isSuperAdmin;

    // Enforce Ignore Existing for non-super admins
    useEffect(() => {
        if (!isSuperAdmin) {
            setIgnoreExisting(true);
        }
    }, [isSuperAdmin]);

    // Load Stats Configuration (Groups & ViewMode) from Firestore
    useEffect(() => {
        if (!selectedEvent) return;
        const loadStatsConfig = async () => {
            try {
                // Wrap in try-catch to prevent crashes on invalid data
                const docRef = doc(db, 'events', selectedEvent.id, 'settings', 'stats');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.viewMode) setStatsViewMode(data.viewMode);
                    if (data.groups && Array.isArray(data.groups)) {
                        setSectorGroups(data.groups);
                    } else {
                        setSectorGroups([]);
                    }
                } else {
                    // Try to migrate from localStorage if Firestore is empty (for backward compatibility)
                    const savedLocal = localStorage.getItem('stats_sector_groups');
                    if (savedLocal) {
                        try {
                            const localGroups = JSON.parse(savedLocal);
                            if (Array.isArray(localGroups)) {
                                setSectorGroups(localGroups);
                                // Save to Firestore to complete migration
                                await setDoc(docRef, { viewMode: 'raw', groups: localGroups }, { merge: true });
                            }
                        } catch(e) { /* ignore invalid local data */ }
                    }
                }
            } catch (e) {
                console.error("Failed to load stats config", e);
                setSectorGroups([]); // Fallback to empty array
            }
        };
        loadStatsConfig();
    }, [db, selectedEvent]);

    const handleStatsViewModeChange = async (mode: 'raw' | 'grouped') => {
        setStatsViewMode(mode);
        if (selectedEvent) {
             await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), { viewMode: mode }, { merge: true });
        }
    };

    const handleSectorGroupsChange = async (newGroups: SectorGroup[]) => {
        setSectorGroups(newGroups);
        if (selectedEvent) {
             await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'stats'), { groups: newGroups }, { merge: true });
        }
    };

    // Load validation settings (Online Mode)
    useEffect(() => {
        if (!selectedEvent) return;
        const loadSettings = async () => {
            const docRef = doc(db, 'events', selectedEvent.id, 'settings', 'validation');
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data.mode) setValidationMode(data.mode);
                if (data.apiEndpoints && Array.isArray(data.apiEndpoints)) setOnlineApiEndpoints(data.apiEndpoints);
                // Migrate old single endpoint to array if needed
                else if (data.apiUrl) setOnlineApiEndpoints([{ url: data.apiUrl, token: data.apiToken || '', eventId: data.apiEventId || '' }]);
                
                if (data.sheetUrl) setOnlineSheetUrl(data.sheetUrl);
            }
        };
        loadSettings();
    }, [db, selectedEvent]);
    
    // Load import presets
    useEffect(() => {
        const loadPresets = async () => {
            try {
                const docRef = doc(db, 'settings', 'import_presets');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    setImportPresets(snap.data().presets || []);
                }
            } catch (e) {
                console.error("Failed to load presets", e);
            }
        };
        loadPresets();
    }, [db]);


    // Load saved import credentials (offline import) when event is selected
    useEffect(() => {
        if (!selectedEvent) return;
        const loadImportSettings = async () => {
            try {
                // Reset first to avoid showing previous event's data
                setApiToken('');
                setApiEventId('');
                setAutoImportEnabled(false); // Disable auto import on event switch for safety

                const docRef = doc(db, 'events', selectedEvent.id, 'settings', 'import');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.url) setApiUrl(data.url);
                    if (data.token) setApiToken(data.token);
                    if (data.eventId) setApiEventId(data.eventId);
                }
            } catch (error) {
                console.error("Failed to load import settings:", error);
            }
        };
        loadImportSettings();
    }, [db, selectedEvent]);

    useEffect(() => {
        setEditableSectorNames(sectorNames);
        setSelectedLocatorSector(sectorNames[0] || ''); // Keep default sector for locators in sync
        // Map visibility based on hiddenSectors prop
        const visibility = sectorNames.map(name => !hiddenSectors.includes(name));
        setSectorVisibility(visibility);
    }, [sectorNames, hiddenSectors]);

    useEffect(() => {
        setRenameEventName(selectedEvent?.name ?? '');
    }, [selectedEvent]);
    
    useEffect(() => {
        if (!selectedEvent) {
            setActiveTab('events');
        }
    }, [selectedEvent]);

    // AUTO IMPORT LOGIC
    // We use a ref for the import function to avoid stale closures in the interval
    const handleImportFromApiRef = useRef<(isAuto?: boolean) => Promise<void>>();

    useEffect(() => {
        if (autoImportEnabled) {
            const INTERVAL_MS = 15 * 60 * 1000; // 15 Minutes
            
            // Run immediately on enable
            if (handleImportFromApiRef.current) {
                handleImportFromApiRef.current(true);
            }

            autoImportIntervalRef.current = setInterval(() => {
                if (handleImportFromApiRef.current) {
                    console.log("Executando auto-importação...");
                    handleImportFromApiRef.current(true);
                }
            }, INTERVAL_MS);
        } else {
            if (autoImportIntervalRef.current) {
                clearInterval(autoImportIntervalRef.current);
                autoImportIntervalRef.current = null;
            }
        }

        return () => {
            if (autoImportIntervalRef.current) {
                clearInterval(autoImportIntervalRef.current);
            }
        };
    }, [autoImportEnabled]);


    // Calculate Locator Stats
    const locatorStats = useMemo(() => {
        if (!allTickets) return { sectorTotal: 0, sectorUsed: 0, globalTotal: 0, globalUsed: 0 };
        
        const locators = allTickets.filter(t => t.details?.ownerName === 'Localizador');
        
        // Filter by currently selected sector in the Locators tab
        const currentSectorLocators = locators.filter(t => t.sector === selectedLocatorSector);
        
        return {
            sectorTotal: currentSectorLocators.length,
            sectorUsed: currentSectorLocators.filter(t => t.status === 'USED').length,
            globalTotal: locators.length,
            globalUsed: locators.filter(t => t.status === 'USED').length
        };
    }, [allTickets, selectedLocatorSector]);

    const handleImportTypeChange = (type: ImportType) => {
        setImportType(type);
        // Do NOT clear token/eventId automatically here, user might want to reuse them.
        
        switch (type) {
            case 'tickets':
                setApiUrl('https://public-api.stingressos.com.br/tickets');
                break;
            case 'participants':
                setApiUrl('https://public-api.stingressos.com.br/participants');
                break;
            case 'buyers':
                setApiUrl('https://public-api.stingressos.com.br/buyers');
                break;
            case 'checkins':
                setApiUrl('https://public-api.stingressos.com.br/checkins');
                break;
            case 'google_sheets':
                setApiUrl(''); 
                break;
            default:
                setApiUrl('');
        }
    };
    
    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const presetId = e.target.value;
        setSelectedPresetId(presetId);
        
        if (presetId === '') return; // "Select..." option
        
        const preset = importPresets.find(p => p.name === presetId); // using name as ID essentially for simplicity
        if (preset) {
            setApiUrl(preset.url || '');
            setApiToken(preset.token || '');
            setApiEventId(preset.eventId || '');
        }
    };

    const handleSavePreset = async () => {
        const name = prompt("Nome para salvar esta configuração (ex: Evento X - ST):");
        if (!name) return;

        const newPreset: ImportPreset = {
            name,
            url: apiUrl,
            token: apiToken,
            eventId: apiEventId
        };

        const updatedPresets = [...importPresets.filter(p => p.name !== name), newPreset]; // Overwrite if name exists
        setImportPresets(updatedPresets);
        
        try {
             await setDoc(doc(db, 'settings', 'import_presets'), { presets: updatedPresets }, { merge: true });
             alert("Configuração salva na lista!");
             setSelectedPresetId(name);
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar preset.");
        }
    };

    const handleDeletePreset = async () => {
        if (!selectedPresetId) return;
        if (!confirm(`Excluir a configuração "${selectedPresetId}"?`)) return;

        const updatedPresets = importPresets.filter(p => p.name !== selectedPresetId);
        setImportPresets(updatedPresets);
        setSelectedPresetId('');
        
        try {
             await setDoc(doc(db, 'settings', 'import_presets'), { presets: updatedPresets }, { merge: true });
        } catch (e) {
            console.error(e);
        }
    };

    const analyticsData: AnalyticsData = useMemo(() => {
        try {
            if (!Array.isArray(allTickets)) return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };
            
            // Use USED tickets from the main list, not scan history, for accuracy.
            const usedTickets = allTickets.filter(t => t && t.status === 'USED' && t.usedAt && !isNaN(Number(t.usedAt)));

            if (usedTickets.length === 0) {
                return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };
            }

            usedTickets.sort((a, b) => (a.usedAt || 0) - (b.usedAt || 0));

            const firstAccess = usedTickets[0].usedAt || null;
            const lastAccess = usedTickets[usedTickets.length - 1].usedAt || null;

            const buckets = new Map<string, { [sector: string]: number }>();
            const INTERVAL_MS = 30 * 60 * 1000;

            for (const ticket of usedTickets) {
                const timestamp = ticket.usedAt || 0;
                const bucketStart = Math.floor(timestamp / INTERVAL_MS) * INTERVAL_MS;
                const date = new Date(bucketStart);
                if (isNaN(date.getTime())) continue;

                const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                
                if (!buckets.has(key)) {
                    const initialCounts: Record<string, number> = {};
                    if (statsViewMode === 'grouped') {
                         sectorGroups.forEach(g => initialCounts[g.name] = 0);
                         sectorNames.forEach(name => {
                            if (!sectorGroups.some(g => g.includedSectors.includes(name))) initialCounts[name] = 0;
                        });
                    } else {
                         sectorNames.forEach(name => initialCounts[name] = 0);
                    }
                    buckets.set(key, initialCounts);
                }
                
                const currentBucket = buckets.get(key)!;
                const sector = ticket.sector || 'Desconhecido';
                
                let targetKey = sector;
                if (statsViewMode === 'grouped' && sectorGroups) {
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
                    if (total > peak.count) peak = { time, count: total };
                    return { time, counts, total };
                })
                .sort((a, b) => a.time.localeCompare(b.time));

            return { timeBuckets, firstAccess, lastAccess, peak };
        } catch (e) {
            console.error("Analytics Calculation Error", e);
            return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };
        }
    }, [allTickets, sectorNames, statsViewMode, sectorGroups]);

     const pieChartData = useMemo(() => {
        try {
            if (!Array.isArray(allTickets)) return [];
            const usedTickets = allTickets.filter(t => t && t.status === 'USED');
            if (usedTickets.length === 0) return [];
            
            const counts: Record<string, number> = {};
            
            usedTickets.forEach(t => {
                const sector = t.sector || 'Desconhecido';
                let targetKey = sector;
                
                if (statsViewMode === 'grouped' && Array.isArray(sectorGroups)) {
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
        } catch (e) {
            console.error("Pie Chart Calculation Error", e);
            return [];
        }

    }, [allTickets, sectorNames, statsViewMode, sectorGroups]);
    
    // Calculate Operator Stats
    const operatorStats = useMemo(() => {
        if (!scanHistory) return [];
        const stats = new Map<string, { name: string; validScans: number; devices: Set<string> }>();

        scanHistory.forEach(scan => {
            const operatorName = scan.operator || 'Desconhecido';
            if (!stats.has(operatorName)) {
                stats.set(operatorName, {
                    name: operatorName,
                    validScans: 0,
                    devices: new Set<string>()
                });
            }
            const current = stats.get(operatorName)!;
            if (scan.status === 'VALID') {
                current.validScans++;
            }
            if (scan.deviceId) {
                current.devices.add(scan.deviceId);
            }
        });

        return Array.from(stats.values()).sort((a, b) => b.validScans - a.validScans);
    }, [scanHistory]);


    const handleSaveSectorNames = async () => {
        if (editableSectorNames.some(name => (name || '').trim() === '')) {
            alert('O nome de um setor não pode estar em branco.');
            return;
        }
        setIsSavingSectors(true);
        try {
            // Build hidden list based on visibility map
            const newHiddenSectors = editableSectorNames.filter((_, index) => !sectorVisibility[index]);
            await onUpdateSectorNames(editableSectorNames, newHiddenSectors);
            alert('Nomes dos setores e visibilidade salvos com sucesso!');
        } catch (error) {
            console.error("Failed to save sector names:", error);
            alert("Falha ao salvar nomes dos setores.");
        } finally {
            setIsSavingSectors(false);
        }
    };
    
    const handleSectorNameChange = (index: number, newName: string) => {
        const updatedNames = [...editableSectorNames];
        updatedNames[index] = newName;
        setEditableSectorNames(updatedNames);
    };

    const handleToggleSectorVisibility = (index: number) => {
        const updatedVisibility = [...sectorVisibility];
        updatedVisibility[index] = !updatedVisibility[index];
        setSectorVisibility(updatedVisibility);
    };

    const handleAddSector = () => {
        setEditableSectorNames([...editableSectorNames, `Novo Setor ${editableSectorNames.length + 1}`]);
        setSectorVisibility([...sectorVisibility, true]); // New sectors default to visible
    };

    const handleRemoveSector = (indexToRemove: number) => {
        if (editableSectorNames.length <= 1) {
            alert('É necessário ter pelo menos um setor.');
            return;
        }
        const sectorNameToRemove = editableSectorNames[indexToRemove];
        if (allTickets.some(t => t.sector === sectorNameToRemove)) {
            if (!window.confirm(`Existem ingressos associados ao setor "${sectorNameToRemove}". Tem certeza que deseja removê-lo?`)) {
                return;
            }
        }
        setEditableSectorNames(editableSectorNames.filter((_, index) => index !== indexToRemove));
        setSectorVisibility(sectorVisibility.filter((_, index) => index !== indexToRemove));
    };
    
    const handleTicketCodeChange = (sector: string, codes: string) => {
        setTicketCodes(prev => ({ ...prev, [sector]: codes }));
    };

    // Function to save import credentials manually
    const handleSaveImportCredentials = async () => {
        if (!selectedEvent) return;
        try {
             await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import'), {
                url: apiUrl,
                token: apiToken,
                eventId: apiEventId,
                lastUpdated: Timestamp.now()
            }, { merge: true });
            alert("Credenciais de acesso (URL, Token e ID) salvas para este evento!");
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar credenciais.");
        }
    };

    const handleCopyPublicLink = () => {
        if (!selectedEvent) return;
        const url = `${window.location.origin}${window.location.pathname}?mode=stats&eventId=${selectedEvent.id}`;
        navigator.clipboard.writeText(url).then(() => {
            alert("Link público copiado para a área de transferência!");
        }).catch(err => {
            console.error('Falha ao copiar:', err);
            prompt("Copie o link abaixo:", url);
        });
    };
    
    // Helper function to find keys deep in object (Recursive)
    const findValueRecursively = (obj: any, keys: string[], depth = 0): any => {
        if (!obj || typeof obj !== 'object' || depth > 5) return null;

        // 1. Check current level properties
        for (const key of keys) {
             // Exact match
             if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
             
             // Case insensitive match
             const foundKey = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
             if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null && obj[foundKey] !== '') {
                 return obj[foundKey];
             }
        }

        // 2. Go deeper into children (objects and arrays)
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findValueRecursively(item, keys, depth + 1);
                if (found) return found;
            }
        } else {
            for (const k in obj) {
                if (typeof obj[k] === 'object') {
                    const found = findValueRecursively(obj[k], keys, depth + 1);
                    if (found) return found;
                }
            }
        }

        return null;
    };

    // Search handler
    const handleSearch = async (overrideQuery?: string) => {
        const queryToUse = overrideQuery || searchQuery;
        
        if (!(queryToUse || '').trim()) return;

        if (searchType === 'TICKET_LOCAL') {
            const ticket = allTickets.find(t => t.id === queryToUse.trim());
            const logs = scanHistory.filter(l => l.ticketId === queryToUse.trim()).sort((a,b) => b.timestamp - a.timestamp);
            setSearchResult({ ticket, logs });
        } else {
            if (!apiToken) {
                alert("Para buscar online, configure o Token na aba 'Importar Dados'.");
                return;
            }
            setIsLoading(true);
            setBuyerSearchResults([]);
            
            try {
                // More robust URL handling that preserves base paths
                let baseUrl = (apiUrl || '').trim();
                let urlObj;
                try {
                     urlObj = new URL(baseUrl);
                } catch(e) {
                    alert("URL da API inválida.");
                    setIsLoading(false);
                    return;
                }
                
                // Replace the last path segment with 'participants'
                const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                     pathSegments[pathSegments.length - 1] = 'participants';
                     urlObj.pathname = `/${pathSegments.join('/')}`;
                } else {
                    urlObj.pathname = '/participants';
                }

                urlObj.searchParams.set('search', queryToUse);
                if (apiEventId) urlObj.searchParams.set('event_id', apiEventId);
                
                const searchUrl = urlObj.toString();
                
                const res = await fetch(searchUrl, {
                    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiToken}` }
                });
                
                if (!res.ok) throw new Error(`Erro API: ${res.status}`);
                
                const data = await res.json();
                let results = [];
                
                if (Array.isArray(data)) results = data;
                else if (data.data && Array.isArray(data.data)) results = data.data;
                else if (data.participants && Array.isArray(data.participants)) results = data.participants;

                results.forEach((r: any) => {
                     const code = findValueRecursively(r, ['access_code', 'code', 'qr_code']);
                     if (code && (!r.tickets || r.tickets.length === 0)) {
                         r.tickets = [{ code, sector: 'Geral', status: 'available' }];
                     }
                });
                
                setBuyerSearchResults(results);
                if (results.length === 0) alert("Nenhum registro encontrado.");

            } catch (error) {
                alert(`Erro na busca: ${error instanceof Error ? error.message : 'Desconhecido'}`);
            } finally {
                setIsLoading(false);
            }
        }
    };
    
    // Scan in Admin
    const handleScanInAdmin = (decodedText: string) => {
        setShowScanner(false);
        setSearchQuery(decodedText);
        handleSearch(decodedText);
    };

    // Import tickets from a specific buyer found in search
    const handleImportSingleBuyer = async (buyer: any) => {
        if (!selectedEvent || !buyer) return alert("Dados inválidos.");
        
        const ticketsList = buyer.tickets && Array.isArray(buyer.tickets) ? buyer.tickets : (Array.isArray(buyer) ? buyer : [buyer]);

        if (ticketsList.length === 0) return alert("Lista de ingressos vazia.");
        
        const ownerName = buyer.name || 'Comprador Importado';
        if (!window.confirm(`Deseja importar ingressos de "${ownerName}"?`)) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const newSectors = new Set<string>();
            let importedCount = 0;

            for (const t of ticketsList) {
                const code = findValueRecursively(t, ['access_code', 'qr_code', 'code', 'ticket_code', 'uuid']);
                if (code) {
                    importedCount++;
                    const sector = findValueRecursively(t, ['sector', 'sector_name', 'category']) || 'Geral';
                    const status = t.checked_in === true || findValueRecursively(t, ['status']) === 'used' ? 'USED' : 'AVAILABLE';
                    const originalId = findValueRecursively(t, ['id', 'ticket_id']);
                    
                    const ticketData: any = { sector, status, details: { ownerName, originalId } };
                    if(status === 'USED') ticketData.usedAt = Timestamp.now();
                    
                    batch.set(doc(db, 'events', selectedEvent.id, 'tickets', String(code)), ticketData, { merge: true });
                    newSectors.add(String(sector));
                }
            }

            if (importedCount === 0) {
                alert(`Nenhum código de ingresso válido encontrado para importar.\n\nDados recebidos (debug):\n${JSON.stringify(ticketsList[0], null, 2).substring(0, 500)}`);
                return;
            }

            const currentSectorsSet = new Set(sectorNames);
            if (Array.from(newSectors).some(s => !currentSectorsSet.has(s))) {
                await onUpdateSectorNames(Array.from(new Set([...sectorNames, ...newSectors])));
            }

            await batch.commit();
            alert(`${importedCount} ingressos importados com sucesso!`);
            
        } catch (error) {
            alert("Erro ao importar ingressos.");
        } finally {
            setIsLoading(false);
        }
    };

    // --- SYNC EXPORT FUNCTIONALITY ---
    const handleSyncExport = async () => {
        if (!selectedEvent) return;
        
        let cleanBaseUrl = (apiUrl || '').trim().replace(/\/tickets\/?$/, '').replace(/\/participants\/?$/, '').replace(/\/checkins\/?.*$/, '');
        const targetUrl = `${cleanBaseUrl}/checkins`;
        
        if (!apiToken) return alert("Token da API é necessário.");

        const usedTickets = allTickets.filter(t => t.status === 'USED');
        if (usedTickets.length === 0) return alert("Não há ingressos utilizados para sincronizar.");
        
        const missingOriginalIdCount = usedTickets.filter(t => !t.details?.originalId).length;
        if (missingOriginalIdCount > 0 && !confirm(`ATENÇÃO: ${missingOriginalIdCount} ingressos não possuem "ID Original". A sincronização pode falhar. Re-importe os dados para corrigir. Continuar?`)) return;

        if (!confirm(`Deseja enviar ${usedTickets.length} validações para: ${targetUrl}?`)) return;

        setIsLoading(true);
        setLoadingMessage('Sincronizando...');
        
        let successCount = 0, failCount = 0, lastErrorMessage = '', lastErrorStatus = '';
        
        // Ensure event ID is parsed as integer (many APIs require numeric ID, NOT string)
        const numericEventId = apiEventId ? parseInt(apiEventId, 10) : undefined;
        if (!numericEventId) { alert("ID do Evento inválido."); setIsLoading(false); return; }

        for (let i = 0; i < usedTickets.length; i++) {
            const ticket = usedTickets[i];
            setLoadingMessage(`Enviando ${i+1}/${usedTickets.length}...`);
            
            let itemSuccess = false;
            let currentError = '';

            const tryHandleResponse = async (res: Response) => {
                const data = await res.json().catch(() => ({}));
                
                if (res.ok || res.status === 201 || res.status === 409 || res.status === 422) {
                     if ((data.success === false || data.error === true) && !res.ok) {
                         if (data.message && (data.message.toLowerCase().includes('used') || data.message.toLowerCase().includes('utilizado'))) {
                             return true;
                         }
                         currentError = data.message ? `${res.status}: ${data.message}` : JSON.stringify(data);
                         return false;
                     }
                     if (res.status === 409 || res.status === 422) {
                         if (data.message && (data.message.toLowerCase().includes('used') || data.message.toLowerCase().includes('utilizado'))) {
                             return true;
                         }
                         currentError = data.message ? `${res.status}: ${data.message}` : `Status ${res.status}`;
                         return false;
                     }
                     return true;
                }
                
                // Detailed error capture
                if (data.message) {
                    currentError = `${res.status}: ${data.message}`;
                    if (data.errors) currentError += ` ${JSON.stringify(data.errors)}`;
                } else {
                    currentError = `Status ${res.status}`;
                }
                return false;
            };

            const idToSend = ticket.details?.originalId || ticket.id;
            const codeToSend = ticket.id;
            
            // Payload: Send redundant fields to ensure compatibility with different API expectations
            const payload: any = { 
                event_id: numericEventId, 
                qr_code: String(codeToSend),
                code: String(codeToSend),
                access_code: String(codeToSend)
            };
            
            if (ticket.usedAt) {
                try {
                     const d = new Date(ticket.usedAt);
                     const pad = (n: number) => n < 10 ? '0'+n : n;
                     const formattedDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                     payload.checked_in_at = formattedDate;
                } catch(e) {}
            }

            const headers = { 
                'Content-Type': 'application/json', 
                'Accept': 'application/json', 
                'Authorization': `Bearer ${apiToken}` 
            };

            const isNumericId = !isNaN(Number(idToSend));

            // Strategy 1: Path Variable (Best for IDs)
            const strategyPath = async () => {
                try {
                     const res = await fetch(`${targetUrl}/${idToSend}?event_id=${numericEventId}`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload),
                    });
                    return await tryHandleResponse(res);
                } catch(e) { 
                    if (!currentError) currentError = (e as any).message; 
                    return false;
                }
            };

            // Strategy 2: Body Only (Best for Codes)
            const strategyBody = async () => {
                try {
                     const res = await fetch(`${targetUrl}?event_id=${numericEventId}`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload),
                    });
                    return await tryHandleResponse(res);
                } catch(e) { 
                    if (!currentError) currentError = (e as any).message; 
                    return false;
                }
            };

            // Try the most likely strategy first
            if (isNumericId) {
                itemSuccess = await strategyPath();
                if (!itemSuccess) itemSuccess = await strategyBody();
            } else {
                itemSuccess = await strategyBody();
                if (!itemSuccess) itemSuccess = await strategyPath();
            }

            if (itemSuccess) successCount++;
            else { 
                failCount++; 
                if (!lastErrorMessage) { 
                    lastErrorMessage = currentError; 
                } 
            }
            
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 50));
        }

        setIsLoading(false);
        let report = `Sincronização concluída!\nSucesso: ${successCount}\nFalhas: ${failCount}`;
        if (failCount > 0) report += `\n\nÚltimo Erro: "${lastErrorMessage}"`;
        alert(report);
    };

    const handleImportFromApi = async (isAuto = false) => {
        if (!selectedEvent) return;
        
        // Prevent manual click overlapping
        if (!isAuto && isLoading) return;

        const startTime = Date.now();
        setIsLoading(true);
        try {
            const allItems: any[] = [];
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            const existingTicketIds = ignoreExisting ? new Set(allTickets.map(t => t.id)) : new Set();

            if (importType === 'google_sheets') {
                 let fetchUrl = (apiUrl || '').trim();
                 if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                 const res = await fetch(fetchUrl);
                 const csvText = await res.text();
                 const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                 rows.forEach(row => {
                     const code = row['code'] || row['codigo'] || row['id'];
                     if (code && !existingTicketIds.has(String(code))) {
                         // FIX: Ensure sector is a string to prevent downstream errors.
                         const sector = String(row['sector'] || row['setor'] || 'Geral');
                         ticketsToSave.push({ id: String(code), sector, status: 'AVAILABLE', details: { ownerName: row['name'] || row['nome'] } });
                         newSectors.add(sector);
                     }
                 });
            } else {
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if ((apiToken || '').trim()) headers['Authorization'] = `Bearer ${(apiToken || '').trim()}`;

                let page = 1;
                let hasMore = true;
                while (hasMore) {
                    setLoadingMessage(`Baixando página ${page}...`);
                    const urlObj = new URL((apiUrl || '').trim());
                    urlObj.searchParams.set('page', String(page));
                    urlObj.searchParams.set('per_page', '200');
                    if (apiEventId) urlObj.searchParams.set('event_id', apiEventId);
                    
                    const res = await fetch(urlObj.toString(), { headers });
                    const json = await res.json();
                    let pageItems = json.data || json.participants || json.tickets || json.buyers || (Array.isArray(json) ? json : []);
                    
                    if (pageItems.length === 0 || (json.last_page && page >= json.last_page)) hasMore = false;
                    
                    allItems.push(...pageItems);
                    page++;
                }
                
                allItems.forEach(item => {
                    const code = item.access_code || item.code || item.qr_code || item.id;
                    if (code && !existingTicketIds.has(String(code))) {
                        // FIX: Ensure sector is a string to prevent downstream errors.
                        const sector = String(item.sector?.name || item.sector_name || item.category || 'Geral');
                        ticketsToSave.push({ id: String(code), sector, status: 'AVAILABLE', details: { ownerName: item.name, originalId: item.id } });
                        newSectors.add(sector);
                    }
                });
            }

            if (ticketsToSave.length > 0) {
                if (Array.from(newSectors).some(s => !sectorNames.includes(s))) {
                    await onUpdateSectorNames(Array.from(new Set([...sectorNames, ...newSectors])));
                }
                const BATCH_SIZE = 450;
                for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                    const chunk = ticketsToSave.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(t => batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true }));
                    await batch.commit();
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            if (isAuto) {
                setLastAutoImportTime(new Date());
                console.log(`Auto Importação concluída em ${duration}s. ${ticketsToSave.length} novos.`);
            } else {
                alert(`Importação concluída em ${duration}s!\n${ticketsToSave.length} novos ingressos importados.`);
            }
        } catch (e) {
            const errorMsg = `Falha na importação: ${e instanceof Error ? e.message : 'Erro'}`;
            console.error(errorMsg);
            if (!isAuto) alert(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };
    
    // Assign Ref for Auto Import
    handleImportFromApiRef.current = handleImportFromApi;

    const handleSaveTickets = async () => {
        if (!selectedEvent || Object.values(ticketCodes).every((c: string) => !(c || '').trim())) return alert('Nenhum código para salvar.');
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            for (const sector in ticketCodes) {
                if ((ticketCodes[sector] || '').trim()) {
                    (ticketCodes[sector] || '').split('\n').map((c: string) => c.trim()).filter(Boolean).forEach(code => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', code), { sector, status: 'AVAILABLE' });
                    });
                }
            }
            await batch.commit();
            alert('Ingressos salvos!');
            setTicketCodes({});
        } catch (e) { alert('Falha ao salvar.'); } finally { setIsLoading(false); }
    };

    const handleSaveLocators = async () => {
        if (!selectedEvent || !(locatorCodes || '').trim()) return alert("Nenhum código para salvar.");
        setIsLoading(true);
        try {
            const codes = (locatorCodes || '').split('\n').map((c: string) => c.trim()).filter(Boolean);
            const batch = writeBatch(db);
            codes.forEach(code => {
                const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', code);
                batch.set(ticketRef, {
                    sector: selectedLocatorSector,
                    status: 'STANDBY',
                    details: { ownerName: 'Localizador' }
                }, { merge: true });
            });
            await batch.commit();
            alert(`${codes.length} localizadores salvos com sucesso!`);
            setLocatorCodes('');
        } catch(e) {
            alert("Erro ao salvar localizadores.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownloadReport = () => {
        if (!selectedEvent) return;
        setIsGeneratingPdf(true);
        try {
            generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames);
        } catch (e) { alert("Erro ao gerar PDF."); } finally { setIsGeneratingPdf(false); }
    };

    // Event Handlers
    const handleCreateEvent = async () => {
        if (!(newEventName || '').trim()) return;
        setIsLoading(true);
        try {
            const eventRef = await addDoc(collection(db, 'events'), { name: (newEventName || '').trim(), isHidden: false });
            await setDoc(doc(db, 'events', eventRef.id, 'settings', 'main'), { sectorNames: ['Pista', 'VIP'] });
            
            if (currentUser && currentUser.role === 'ADMIN' && onUpdateCurrentUser) {
                const newAllowed = [...(currentUser.allowedEvents || []), eventRef.id];
                if (!currentUser.id.startsWith('admin_master')) {
                     await updateDoc(doc(db, 'users', currentUser.id), { allowedEvents: newAllowed });
                }
                onUpdateCurrentUser({ allowedEvents: newAllowed });
            }
            alert(`Evento "${newEventName.trim()}" criado!`);
            setNewEventName('');
        } catch (e) { alert("Falha ao criar evento."); } finally { setIsLoading(false); }
    };

    const handleRenameEvent = async () => {
        if (!selectedEvent || !(renameEventName || '').trim()) return;
        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', selectedEvent.id), { name: (renameEventName || '').trim() });
            alert("Evento renomeado!");
        } catch (e) { alert("Falha ao renomear."); } finally { setIsLoading(false); }
    };
    
    const handleToggleEventVisibility = async (eventId: string, isHidden: boolean) => {
        setIsLoading(true);
        try { await updateDoc(doc(db, 'events', eventId), { isHidden: !isHidden }); } 
        catch (e) { alert("Falha ao alterar visibilidade."); } finally { setIsLoading(false); }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (confirm(`Apagar "${eventName}"?`)) {
            setIsLoading(true);
            try { await deleteDoc(doc(db, 'events', eventId)); alert("Evento apagado."); } 
            catch (e) { alert("Falha ao apagar."); } finally { setIsLoading(false); }
        }
    };

    // Online Config Handlers
    const handleSaveValidationConfig = async () => {
        if (!selectedEvent) return;
        try {
            // FIX: Use `onlineApiEndpoints` for the `apiEndpoints` property.
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'validation'), {
                mode: validationMode,
                apiEndpoints: onlineApiEndpoints,
                sheetUrl: onlineSheetUrl
            }, { merge: true });
            alert('Configurações salvas!');
        } catch (e) { alert('Erro ao salvar.'); }
    };

    const handleAddEndpoint = () => setOnlineApiEndpoints([...onlineApiEndpoints, { url: '', token: '', eventId: '' }]);
    const handleRemoveEndpoint = (index: number) => setOnlineApiEndpoints(onlineApiEndpoints.filter((_, i) => i !== index));
    const handleEndpointChange = (index: number, field: 'url' | 'token' | 'eventId', value: string) => {
        const newEndpoints = [...onlineApiEndpoints];
        newEndpoints[index][field] = value;
        setOnlineApiEndpoints(newEndpoints);
    };
    const toggleTokenVisibility = (index: number) => setVisibleTokens(prev => ({ ...prev, [index]: !prev[index] }));
    const handleDownloadTemplate = () => {
        const link = document.createElement('a');
        link.href = 'data:text/csv;charset=utf-8,' + encodeURI("codigo,setor,nome\n123,VIP,Joao");
        link.download = 'modelo_ingressos.csv';
        link.click();
    };

    const NoEventSelectedMessage = () => <div className="p-10 text-center text-gray-400 bg-gray-800 rounded-lg">Selecione um evento na aba 'Eventos'.</div>;
  
    const renderContent = () => {
        if (activeTab === 'users') return isSuperAdmin ? <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} /> : <p>Acesso negado.</p>;
        if (!selectedEvent && activeTab !== 'events') return <NoEventSelectedMessage />;
        
        switch (activeTab) {
            case 'stats':
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-center"><h2 className="text-2xl font-bold">Dashboard</h2><div className="flex space-x-2"><button onClick={handleCopyPublicLink} className="bg-blue-600 p-2 rounded-lg text-sm flex items-center"><LinkIcon className="w-4 h-4 mr-1"/>Link Público</button><button onClick={handleDownloadReport} disabled={isGeneratingPdf} className="bg-green-600 p-2 rounded-lg text-sm flex items-center"><CloudDownloadIcon className="w-4 h-4 mr-1"/>PDF</button></div></div>
                        <Stats allTickets={allTickets} sectorNames={sectorNames} viewMode={statsViewMode} onViewModeChange={handleStatsViewModeChange} groups={sectorGroups} onGroupsChange={handleSectorGroupsChange}/>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><PieChart data={pieChartData} title="Distribuição"/><AnalyticsChart data={analyticsData} sectorNames={sectorNames} /></div>
                        <div><h3 className="text-xl font-bold mb-4">Análise Temporal</h3><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="bg-gray-800 p-4 rounded-lg"><p className="text-xs text-gray-400">Primeiro Acesso</p><p className="text-2xl font-bold">{analyticsData.firstAccess ? new Date(analyticsData.firstAccess).toLocaleTimeString('pt-BR') : '--:--'}</p></div><div className="bg-gray-800 p-4 rounded-lg"><p className="text-xs text-gray-400">Último Acesso</p><p className="text-2xl font-bold">{analyticsData.lastAccess ? new Date(analyticsData.lastAccess).toLocaleTimeString('pt-BR') : '--:--'}</p></div><div className="bg-gray-800 p-4 rounded-lg"><p className="text-xs text-gray-400">Pico ({analyticsData.peak.time})</p><p className="text-2xl font-bold">{analyticsData.peak.count} entradas</p></div></div></div>
                    </div>
                );
            case 'search':
                 return (
                    <div className="max-w-2xl mx-auto space-y-6">
                        <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
                            <h2 className="text-xl font-bold mb-4 flex items-center"><SearchIcon className="w-6 h-6 mr-2 text-blue-500" /> Consultar</h2>
                            <div className="flex bg-gray-700 rounded-lg p-1 mb-4">
                                <button onClick={() => setSearchType('TICKET_LOCAL')} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${searchType === 'TICKET_LOCAL' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>Código do Ingresso (Local)</button>
                                <button onClick={() => setSearchType('BUYER_API')} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${searchType === 'BUYER_API' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>Buscar Comprador (API Online)</button>
                            </div>
                            <div className="flex space-x-2">
                                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={searchType === 'TICKET_LOCAL' ? "Digite o código do ingresso..." : "Nome, E-mail ou CPF do comprador..."} className="flex-grow bg-gray-900 border border-gray-600 rounded p-3 text-white focus:outline-none focus:border-blue-500" onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
                                <button onClick={() => setShowScanner(true)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 rounded border border-gray-600" title="Escanear QR Code"><QrCodeIcon className="w-6 h-6" /></button>
                                <button onClick={() => handleSearch()} disabled={isLoading} className={`${searchType === 'TICKET_LOCAL' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white font-bold px-6 rounded transition-colors disabled:opacity-50`}>{isLoading ? 'Buscando...' : 'Buscar'}</button>
                            </div>
                        </div>
                        {showScanner && ( <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"><div className="w-full max-w-md bg-gray-800 rounded-lg relative"><button onClick={() => setShowScanner(false)} className="absolute top-2 right-2 z-10"><XCircleIcon className="w-8 h-8 text-white"/></button><div className="aspect-square w-full"><Scanner onScanSuccess={handleScanInAdmin} onScanError={() => {}} /></div></div></div>)}
                        {searchType === 'TICKET_LOCAL' && searchResult && (
                             <div className="animate-fade-in bg-gray-800 p-4 rounded-lg">
                                {searchResult.ticket ? (
                                    <div>
                                        <p>Código: {searchResult.ticket.id}</p>
                                        <p>Status: {searchResult.ticket.status}</p>
                                        <p>Setor: {searchResult.ticket.sector}</p>
                                        {searchResult.ticket.usedAt && <p>Usado em: {new Date(searchResult.ticket.usedAt).toLocaleString('pt-BR')}</p>}
                                        <h4 className="font-bold mt-2">Histórico:</h4>
                                        {searchResult.logs.map(log => <p key={log.id} className="text-xs">{new Date(log.timestamp).toLocaleString('pt-BR')} - {log.status}</p>)}
                                    </div>
                                ) : <p>Ingresso não encontrado.</p>}
                             </div>
                        )}
                        {searchType === 'BUYER_API' && buyerSearchResults.length > 0 && (
                            <div className="animate-fade-in space-y-4">
                                {buyerSearchResults.map((buyer, idx) => (
                                    <div key={idx} className="bg-gray-800 p-4 rounded-lg">
                                         <div className="flex justify-between items-center"><h3 className="font-bold">{buyer.name}</h3><button onClick={() => handleImportSingleBuyer(buyer)} className="bg-green-600 p-1 text-xs rounded">Importar</button></div>
                                        <p>Email: {buyer.email}</p>
                                        <p>Telefone: {buyer.phone}</p>
                                        <div className="mt-2">
                                            {buyer.tickets?.map((t: any, ti: number) => {
                                                const code = findValueRecursively(t, ['access_code', 'qr_code', 'code', 'ticket_code', 'id']);
                                                return <p key={ti} className="text-xs bg-gray-700 p-1 rounded">Ingresso: {code || 'S/CÓDIGO'}</p>
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
             case 'operators':
                return (
                    <div className="bg-gray-800 p-6 rounded-lg">
                        <h2 className="text-xl font-bold mb-4">Painel de Operadores</h2>
                        <table className="w-full text-left">
                            <thead><tr className="border-b border-gray-600"><th className="p-2">Operador</th><th className="p-2">Validações</th><th className="p-2">Dispositivos</th></tr></thead>
                            <tbody>{operatorStats.map(op => (<tr key={op.name} className="border-b border-gray-700"><td className="p-2">{op.name}</td><td className="p-2">{op.validScans}</td><td className="p-2 text-xs font-mono">{Array.from(op.devices).join(', ')}</td></tr>))}</tbody>
                        </table>
                    </div>
                );
            case 'settings':
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30">
                                <h3 className="text-lg font-bold mb-4 text-orange-400">Modo de Operação</h3>
                                <div className="space-y-2">
                                    <label><input type="radio" name="mode" value="OFFLINE" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} /> Offline</label>
                                    <label><input type="radio" name="mode" value="ONLINE_API" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} /> Online (API)</label>
                                    <label><input type="radio" name="mode" value="ONLINE_SHEETS" checked={validationMode === 'ONLINE_SHEETS'} onChange={() => setValidationMode('ONLINE_SHEETS')} /> Online (Sheets)</label>
                                </div>
                                {validationMode === 'ONLINE_API' && (
                                    <div className="mt-4 space-y-2">
                                        {onlineApiEndpoints.map((ep, i) => (
                                            <div key={i} className="bg-gray-700 p-2 rounded">
                                                <input value={ep.url} onChange={e => handleEndpointChange(i, 'url', e.target.value)} placeholder="URL" className="w-full bg-gray-800 p-1 rounded mb-1" />
                                                <input value={ep.token} onChange={e => handleEndpointChange(i, 'token', e.target.value)} placeholder="Token" className="w-full bg-gray-800 p-1 rounded mb-1" />
                                                <input value={ep.eventId} onChange={e => handleEndpointChange(i, 'eventId', e.target.value)} placeholder="ID Evento" className="w-full bg-gray-800 p-1 rounded" />
                                                <button onClick={() => handleRemoveEndpoint(i)}>Remover</button>
                                            </div>
                                        ))}
                                        <button onClick={handleAddEndpoint}>+ Endpoint</button>
                                    </div>
                                )}
                                {validationMode === 'ONLINE_SHEETS' && <input value={onlineSheetUrl} onChange={e => setOnlineSheetUrl(e.target.value)} placeholder="Link CSV" className="w-full bg-gray-700 p-2 rounded mt-2"/>}
                                <button onClick={handleSaveValidationConfig} className="bg-green-600 w-full mt-2 p-2 rounded">Salvar Modo</button>
                             </div>
                            <div className="bg-gray-800 p-5 rounded-lg"><h3 className="text-lg font-bold mb-3">Setores</h3><div className="space-y-2">{editableSectorNames.map((name, i) => (<div key={i} className="flex items-center"><input value={name} onChange={e => handleSectorNameChange(i, e.target.value)} className="flex-grow bg-gray-700 p-2 rounded"/><button onClick={() => handleToggleSectorVisibility(i)} className="p-1">{sectorVisibility[i] ? <EyeIcon className="w-5 h-5"/> : <EyeSlashIcon className="w-5 h-5"/>}</button><button onClick={() => handleRemoveSector(i)} className="bg-red-600 px-2 rounded">X</button></div>))}<button onClick={handleAddSector}>+ Setor</button></div><button onClick={handleSaveSectorNames} disabled={isSavingSectors} className="bg-orange-600 w-full mt-2 p-2 rounded">Salvar Setores</button></div>
                            <div className="bg-gray-800 p-5 rounded-lg"><h3 className="text-lg font-bold mb-3">Adicionar Códigos (Manual)</h3><div className="space-y-2">{sectorNames.map(s => (<div key={s}><label className="text-sm">{s}</label><textarea value={ticketCodes[s] || ''} onChange={e => handleTicketCodeChange(s, e.target.value)} className="w-full bg-gray-700 p-1 rounded h-20"/></div>))}<button onClick={handleSaveTickets} disabled={isLoading} className="bg-blue-600 w-full p-2 rounded">Salvar Códigos</button></div></div>
                        </div>
                        <div className="space-y-6">
                            <div className="bg-gray-800 p-5 rounded-lg"><h3 className="text-lg font-bold mb-3">Importar Dados</h3><select value={importType} onChange={e => handleImportTypeChange(e.target.value as ImportType)} className="w-full bg-gray-700 p-2 rounded mb-2"><option value="tickets">Ingressos (API)</option><option value="participants">Participantes (API)</option><option value="buyers">Compradores (API)</option><option value="checkins">Check-ins (API)</option><option value="google_sheets">Google Sheets</option></select><input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="URL" className="w-full bg-gray-700 p-2 rounded mb-2"/><div className="flex gap-2"><input value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder="Token" className="w-full bg-gray-700 p-2 rounded"/><input value={apiEventId} onChange={e => setApiEventId(e.target.value)} placeholder="ID Evento" className="w-full bg-gray-700 p-2 rounded"/></div><button onClick={handleSaveImportCredentials} className="text-xs text-blue-400 hover:text-white underline mb-2 mt-1 block w-full text-right">Salvar estas credenciais no evento</button>
                            
                            {/* Auto Import Toggle */}
                            <div className="bg-gray-700 p-3 rounded mt-2 border border-gray-600">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={autoImportEnabled} 
                                        onChange={(e) => setAutoImportEnabled(e.target.checked)} 
                                        className="w-4 h-4 text-orange-600 rounded focus:ring-0"
                                    />
                                    <span className="text-sm font-bold text-white">Importação Automática (15 min)</span>
                                </label>
                                <p className="text-xs text-gray-400 mt-1 ml-6">
                                    {autoImportEnabled ? (
                                        <span className="text-green-400">Ativado. Mantenha esta aba aberta.</span>
                                    ) : (
                                        "O sistema buscará novos dados a cada 15 minutos."
                                    )}
                                </p>
                                {lastAutoImportTime && (
                                    <p className="text-xs text-gray-500 mt-1 ml-6">
                                        Última execução: {lastAutoImportTime.toLocaleTimeString('pt-BR')}
                                    </p>
                                )}
                            </div>

                            <label className="text-xs flex items-center mt-2"><input type="checkbox" checked={ignoreExisting} onChange={e => setIgnoreExisting(e.target.checked)} disabled={!isSuperAdmin}/> Ignorar existentes</label><button onClick={() => handleImportFromApi(false)} disabled={isLoading} className="bg-orange-600 w-full p-2 rounded mt-2">{isLoading ? loadingMessage : 'Importar Agora'}</button><button onClick={handleSyncExport} disabled={isLoading} className="bg-gray-600 w-full p-2 rounded mt-2">Sincronizar Validações</button></div>
                        </div>
                    </div>
                );
            case 'history':
                return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'locators':
                 return (
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 animate-fade-in">
                        <h2 className="text-xl font-bold mb-4 flex items-center"><TicketIcon className="w-6 h-6 mr-2 text-yellow-400" /> Gerenciar Localizadores (Stand-by)</h2>
                        <p className="text-sm text-gray-400 mb-6">Cole uma lista de códigos (um por linha) para adicioná-los como ingressos stand-by. Eles não contam nas estatísticas até serem validados na portaria.</p>
                        
                        {/* Stats Panel for Locators */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div className="bg-gray-700/50 p-4 rounded-lg border-l-4 border-yellow-500">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Neste Setor ({selectedLocatorSector})</p>
                                <div className="flex items-baseline space-x-2">
                                    <span className="text-3xl font-bold text-white">{locatorStats.sectorUsed}</span>
                                    <span className="text-sm text-gray-400">utilizados de {locatorStats.sectorTotal}</span>
                                </div>
                                <div className="w-full bg-gray-600 rounded-full h-1.5 mt-2">
                                    <div className="bg-yellow-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${locatorStats.sectorTotal > 0 ? (locatorStats.sectorUsed / locatorStats.sectorTotal) * 100 : 0}%` }}></div>
                                </div>
                            </div>
                            <div className="bg-gray-700/50 p-4 rounded-lg border-l-4 border-gray-500">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Total Geral (Todos Setores)</p>
                                <div className="flex items-baseline space-x-2">
                                    <span className="text-3xl font-bold text-white">{locatorStats.globalUsed}</span>
                                    <span className="text-sm text-gray-400">utilizados de {locatorStats.globalTotal}</span>
                                </div>
                                <div className="w-full bg-gray-600 rounded-full h-1.5 mt-2">
                                    <div className="bg-gray-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${locatorStats.globalTotal > 0 ? (locatorStats.globalUsed / locatorStats.globalTotal) * 100 : 0}%` }}></div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <div className="md:col-span-1">
                                <label className="block text-xs font-bold text-gray-300 mb-1 uppercase">Setor</label>
                                <select value={selectedLocatorSector} onChange={e => setSelectedLocatorSector(e.target.value)} className="w-full bg-gray-700 p-3 rounded border border-gray-600 text-white">
                                    {sectorNames.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                             </div>
                             <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-gray-300 mb-1 uppercase">Códigos dos Localizadores</label>
                                <textarea value={locatorCodes} onChange={e => setLocatorCodes(e.target.value)} placeholder="Cole os códigos aqui, um por linha..." className="w-full bg-gray-900 p-3 rounded border border-gray-600 text-white h-48 font-mono text-sm" />
                             </div>
                        </div>
                        <button onClick={handleSaveLocators} disabled={isLoading} className="w-full mt-4 bg-yellow-600 hover:bg-yellow-700 text-gray-900 font-bold py-3 rounded disabled:opacity-50 text-sm shadow-lg flex items-center justify-center">
                            {isLoading ? 'Salvando...' : 'Salvar Localizadores'}
                        </button>
                    </div>
                 );
            case 'events':
                return (
                     <div className="space-y-6 animate-fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {canManageEvents && (
                                <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                    <h3 className="text-lg font-bold mb-3">Criar Novo Evento</h3>
                                    <div className="space-y-3">
                                        <input type="text" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Nome do Evento" className="w-full bg-gray-700 p-3 rounded" />
                                        <button onClick={handleCreateEvent} disabled={isLoading} className="w-full bg-orange-600 py-3 rounded font-bold">Criar Evento</button>
                                    </div>
                                </div>
                            )}
                            <div className={`bg-gray-800 p-5 rounded-lg shadow-lg ${!canManageEvents ? 'md:col-span-2' : ''}`}>
                                <h3 className="text-lg font-bold mb-3">Lista de Eventos</h3>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                                    {events.map(event => (
                                        <div key={event.id} className="flex items-center justify-between bg-gray-700 p-3 rounded">
                                            <span className={`${event.isHidden ? 'text-gray-500' : ''}`}>{event.name}</span>
                                            <div className="flex space-x-2">
                                                <button onClick={() => { onSelectEvent(event); setActiveTab('stats'); }} className="text-xs px-3 py-1 bg-green-600 rounded">Gerenciar</button>
                                                {canManageEvents && (<button onClick={() => handleToggleEventVisibility(event.id, !!event.isHidden)} className="text-xs px-3 py-1 bg-gray-600 rounded">{event.isHidden ? 'Mostrar' : 'Ocultar'}</button>)}
                                                {isSuperAdmin && (<button onClick={() => handleDeleteEvent(event.id, event.name)} className="text-xs px-3 py-1 bg-red-600 rounded">Apagar</button>)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                             {selectedEvent && canManageEvents && (
                                <div className="bg-gray-800 p-5 rounded-lg md:col-span-2">
                                    <h3 className="text-lg font-bold mb-3">Editar: {selectedEvent.name}</h3>
                                    <div className="flex space-x-2">
                                        <input type="text" value={renameEventName} onChange={(e) => setRenameEventName(e.target.value)} className="flex-grow bg-gray-700 p-3 rounded" />
                                        <button onClick={handleRenameEvent} disabled={isLoading} className="bg-blue-600 px-6 py-2 rounded font-bold">Renomear</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-1 custom-scrollbar border border-gray-700 items-center text-sm">
                <button onClick={() => setActiveTab('stats')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'stats' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'settings' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Configurações</button>
                <button onClick={() => setActiveTab('locators')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'locators' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}><TicketIcon className="w-4 h-4 mr-1.5"/>Localizadores</button>
                <button onClick={() => setActiveTab('history')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'history' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'events' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Eventos</button>
                <button onClick={() => setActiveTab('search')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap ${activeTab === 'search' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}>Consultar</button>
                <button onClick={() => setActiveTab('operators')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'operators' ? 'bg-orange-600' : 'hover:bg-gray-700'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Operadores</button>
                {isSuperAdmin && (<div className="ml-auto pl-2 border-l border-gray-600"><button onClick={() => setActiveTab('users')} className={`px-3 py-1.5 rounded-md font-bold whitespace-nowrap flex items-center ${activeTab === 'users' ? 'bg-purple-600' : 'text-purple-400 hover:bg-purple-900'}`}><UsersIcon className="w-4 h-4 mr-1.5"/>Usuários</button></div>)}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;



import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event, User, SectorGroup } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import Scanner from './Scanner';
import SuperAdminView from './SuperAdminView'; // Import Super Admin Component
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc } from 'firebase/firestore';
import { CloudDownloadIcon, CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon, QrCodeIcon, UsersIcon, LockClosedIcon } from './Icons';
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
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search' | 'users' | 'operators'>('stats');
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

                const docRef = doc(db, 'events', selectedEvent.id, 'settings', 'import');
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data();
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
            setApiUrl(preset.url);
            setApiToken(preset.token);
            setApiEventId(preset.eventId);
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
            // Safeguard: Filter valid scans with valid timestamps
            if (!Array.isArray(scanHistory)) return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };

            const validScans = scanHistory.filter(s => s && s.status === 'VALID' && s.timestamp && !isNaN(Number(s.timestamp)));
            if (validScans.length === 0) {
                return {
                    timeBuckets: [],
                    firstAccess: null,
                    lastAccess: null,
                    peak: { time: '-', count: 0 },
                };
            }

            validScans.sort((a, b) => a.timestamp - b.timestamp);

            const firstAccess = validScans[0].timestamp;
            const lastAccess = validScans[validScans.length - 1].timestamp;

            const buckets = new Map<string, { [sector: string]: number }>();
            const INTERVAL_MS = 30 * 60 * 1000; // 30 Minutes

            for (const scan of validScans) {
                const bucketStart = Math.floor(scan.timestamp / INTERVAL_MS) * INTERVAL_MS;
                const date = new Date(bucketStart);
                if (isNaN(date.getTime())) continue;

                const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                
                if (!buckets.has(key)) {
                    // Initial counts: use groups if in grouped mode
                    const initialCounts: Record<string, number> = {};
                    
                    if (statsViewMode === 'grouped' && Array.isArray(sectorGroups)) {
                         sectorGroups.forEach(g => initialCounts[g.name] = 0);
                         // Also add sectors not in any group
                         sectorNames.forEach(name => {
                            const isGrouped = sectorGroups.some(g => g.includedSectors.some(s => s.toLowerCase() === name.toLowerCase()));
                            if (!isGrouped) initialCounts[name] = 0;
                        });
                    } else {
                         sectorNames.forEach(name => initialCounts[name] = 0);
                    }
                    
                    buckets.set(key, initialCounts);
                }
                
                const currentBucket = buckets.get(key)!;
                const sector = scan.ticketSector || 'Desconhecido';
                
                let targetKey = sector;
                if (statsViewMode === 'grouped' && Array.isArray(sectorGroups)) {
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
        } catch (e) {
            console.error("Analytics Calculation Error", e);
            return { timeBuckets: [], firstAccess: null, lastAccess: null, peak: { time: '-', count: 0 } };
        }
    }, [scanHistory, sectorNames, statsViewMode, sectorGroups]);

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
        if (editableSectorNames.some(name => name.trim() === '')) {
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
                token: apiToken,
                eventId: apiEventId,
                lastUpdated: Timestamp.now()
            }, { merge: true });
            alert("Credenciais de acesso (Token e ID) salvas para este evento!");
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
        
        if (!queryToUse.trim()) return;

        if (searchType === 'TICKET_LOCAL') {
            // Find ticket info
            const ticket = allTickets.find(t => t.id === queryToUse.trim());
            
            // Find scan logs for this ticket
            const logs = scanHistory.filter(l => l.ticketId === queryToUse.trim());
            logs.sort((a,b) => b.timestamp - a.timestamp); // Newest first
            
            setSearchResult({ ticket, logs });
        } else {
            // API BUYER SEARCH
            if (!apiToken) {
                alert("Para buscar online, configure o Token na aba 'Configurações' > 'Importação'.");
                return;
            }
            
            setIsLoading(true);
            setBuyerSearchResults([]);
            
            try {
                // Construct URL to /buyers OR /participants endpoint
                // PREFER PARTICIPANTS if default (user request)
                let searchEndpoint = apiUrl.trim();
                
                // If user didn't explicitly set URL to something else, force /participants
                // Or if it was set to /tickets (default), switch to /participants for search
                if (!searchEndpoint.includes('/participants') && !searchEndpoint.includes('/buyers')) {
                    try {
                        const urlObj = new URL(searchEndpoint || 'https://public-api.stingressos.com.br/tickets');
                        searchEndpoint = `${urlObj.origin}/participants`;
                    } catch (e) {
                         searchEndpoint = 'https://public-api.stingressos.com.br/participants';
                    }
                }
                
                // SAFE URL CONSTRUCTION
                const urlObj = new URL(searchEndpoint);
                urlObj.searchParams.set('search', queryToUse);
                if (apiEventId) {
                     urlObj.searchParams.set('event_id', apiEventId);
                }
                
                const searchUrl = urlObj.toString();
                
                const res = await fetch(searchUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${apiToken}`
                    }
                });
                
                if (!res.ok) throw new Error(`Erro API: ${res.status}`);
                
                const data = await res.json();
                let results = [];
                
                if (Array.isArray(data)) results = data;
                else if (data.data && Array.isArray(data.data)) results = data.data;
                else if (data.buyers && Array.isArray(data.buyers)) results = data.buyers;
                else if (data.participants && Array.isArray(data.participants)) results = data.participants;

                // POST-PROCESSING: Normalize results
                results.forEach((r: any) => {
                     // Check if 'tickets' is missing or empty
                     if (!r.tickets || r.tickets.length === 0) {
                         // Check if this object ITSELF is the ticket/participant with an access_code
                         // Use recursive search to find any code
                         const code = findValueRecursively(r, ['access_code', 'code', 'qr_code']);
                         if (code) {
                             const sector = findValueRecursively(r, ['sector', 'sector_name', 'product_name']) || 'Geral';
                             const status = findValueRecursively(r, ['status', 'checked_in']) || 'available';
                             r.tickets = [{
                                 code: code,
                                 sector: typeof sector === 'object' ? sector.name : sector,
                                 status: (status === true || status === 'used' || status === 'checked_in') ? 'used' : 'available'
                             }];
                         }
                     }
                });
                
                setBuyerSearchResults(results);
                if (results.length === 0) alert("Nenhum registro encontrado com esse termo.");

            } catch (error) {
                console.error(error);
                alert(`Erro na busca: ${error instanceof Error ? error.message : 'Desconhecido'}`);
            } finally {
                setIsLoading(false);
            }
        }
    };
    
    // Scan in Admin
    const handleScanInAdmin = (decodedText: string) => {
        // Stop scanning UI
        setShowScanner(false);
        // Set text
        setSearchQuery(decodedText);
        // Trigger search immediately
        handleSearch(decodedText);
    };

    // Import tickets from a specific buyer found in search
    const handleImportSingleBuyer = async (buyer: any) => {
        if (!selectedEvent || !buyer) {
            alert("Dados inválidos.");
            return;
        }
        
        let ticketsList = [];
        if (buyer.tickets && Array.isArray(buyer.tickets)) ticketsList = buyer.tickets;
        else if (Array.isArray(buyer)) ticketsList = buyer; // Sometimes the buyer object is just the list itself
        else ticketsList = [buyer]; // Or it's a single object

        if (ticketsList.length === 0) {
            alert("A lista de ingressos deste comprador está vazia ou mal formatada.");
            return;
        }
        
        const ownerName = buyer.name || buyer.buyer_name || buyer.first_name || 'Comprador Importado';
        const confirmMsg = `Deseja importar ingressos de "${ownerName}" para o sistema local?`;
        if (!window.confirm(confirmMsg)) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const ticketsToSave: Ticket[] = [];
            const newSectors = new Set<string>();

            // Added access_code to high priority
            const HIGH_PRIORITY_CODE_KEYS = [
                'access_code', 'code', 'qr_code', 'ticket_code', 'uuid', 'barcode', 
                'token', 'loc', 'locator', 'identifier', 'friendly_id', 'hash', 'serial', 
                'number', 'localizador', 'cod', 'codigo', 'id_ingresso'
            ];
            
            const LOW_PRIORITY_CODE_KEYS = ['id', 'ticket_id', 'pk'];
            
            const SECTOR_KEYS = ['sector', 'sector_name', 'section', 'product_name', 'category', 'setor', 'nome_setor'];
            const STATUS_KEYS = ['status', 'state', 'estado'];
            const DATE_KEYS = ['updated_at', 'checked_in_at', 'used_at', 'created_at', 'data_uso'];

            ticketsList.forEach((t: any) => {
                // RECURSIVE SEARCH FOR DATA
                
                // 1. Find Code (Deep Search) - Prioritizing access_code
                let code = findValueRecursively(t, HIGH_PRIORITY_CODE_KEYS);
                if (!code) {
                    code = findValueRecursively(t, LOW_PRIORITY_CODE_KEYS);
                }

                if (code) {
                    // 2. Find Sector (Deep Search)
                    let sector = findValueRecursively(t, SECTOR_KEYS);
                    
                    // 3. Find Status (Deep Search)
                    let statusRaw = findValueRecursively(t, STATUS_KEYS);
                    if (t.checked_in === true) statusRaw = 'used'; // Participant API flag
                    
                    // 4. Find Date (Deep Search)
                    let dateStr = findValueRecursively(t, DATE_KEYS);
                    
                    // 5. Find Original ID (for Sync) usually 'id'
                    let originalId = t.id || findValueRecursively(t, ['id', 'ticket_id']);

                    // Normalize Sector Object if needed
                    if (typeof sector === 'object' && sector && (sector as any).name) sector = (sector as any).name;

                    const idStr = String(code).trim();
                    const sectorStr = String(sector || 'Geral').trim();
                    
                    newSectors.add(sectorStr);
                    
                    const ticketData: Ticket = {
                        id: idStr,
                        sector: sectorStr,
                        status: (statusRaw === 'used' || statusRaw === 'checked_in' || statusRaw === 'utilizado') ? 'USED' : 'AVAILABLE',
                        details: { 
                            ownerName: ownerName,
                            originalId: originalId || idStr
                        },
                    };
                    
                    // Handle Used At date
                    if ((ticketData.status === 'USED') && dateStr) {
                         // Fix date format for Safari if needed
                         const dS = String(dateStr).replace(' ', 'T');
                         const ts = new Date(dS).getTime();
                         if (!isNaN(ts)) ticketData.usedAt = ts;
                         else ticketData.usedAt = Date.now();
                    }
                    
                    ticketsToSave.push(ticketData);

                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', idStr);
                    batch.set(ticketRef, {
                        ...ticketData,
                        usedAt: ticketData.usedAt ? Timestamp.fromMillis(ticketData.usedAt) : null
                    }, { merge: true });
                }
            });

            if (ticketsToSave.length === 0) {
                console.log("Debug Buyer Tickets Data (Dump):", ticketsList);
                alert(`Nenhum código de ingresso válido encontrado para importar. (Erro de Formato)\n\nESTRUTURA DO PRIMEIRO ITEM (DEBUG):\n${JSON.stringify(ticketsList[0], null, 2).substring(0, 500)}...`);
                return;
            }

            // Update sectors if needed
            const currentSectorsSet = new Set(sectorNames);
            let sectorsUpdated = false;
            newSectors.forEach(s => {
                if (!currentSectorsSet.has(s)) {
                    currentSectorsSet.add(s);
                    sectorsUpdated = true;
                }
            });

            if (sectorsUpdated) {
                const updatedSectorList = Array.from(currentSectorsSet);
                await onUpdateSectorNames(updatedSectorList);
                setEditableSectorNames(updatedSectorList);
            }

            await batch.commit();
            alert(`${ticketsToSave.length} ingressos importados com sucesso!`);
            
            setSearchType('TICKET_LOCAL'); 
            setSearchQuery(''); 

        } catch (error) {
            console.error("Error importing buyer tickets", error);
            alert("Erro ao importar ingressos.");
        } finally {
            setIsLoading(false);
        }
    };

    // --- SYNC EXPORT FUNCTIONALITY ---
    const handleSyncExport = async () => {
        if (!selectedEvent) return;
        
        // INTELLIGENT URL CONSTRUCTION
        let cleanBaseUrl = apiUrl.trim();
        // Remove known suffixes to get the base API URL
        cleanBaseUrl = cleanBaseUrl.replace(/\/tickets\/?$/, '');
        cleanBaseUrl = cleanBaseUrl.replace(/\/participants\/?$/, '');
        cleanBaseUrl = cleanBaseUrl.replace(/\/buyers\/?$/, '');
        cleanBaseUrl = cleanBaseUrl.replace(/\/checkins\/?(\d+|[a-zA-Z0-9-]+)?$/, ''); // Remove trailing /checkins or /checkins/123
        if (cleanBaseUrl.endsWith('/')) cleanBaseUrl = cleanBaseUrl.slice(0, -1);

        // The target endpoint for checking is usually /checkins
        const targetUrl = `${cleanBaseUrl}/checkins`;
        
        if (!apiToken) {
            alert("Token da API é necessário para exportar. Por favor preencha no campo de Importação.");
            return;
        }

        const usedTickets = allTickets.filter(t => t.status === 'USED');
        if (usedTickets.length === 0) {
            alert("Não há ingressos utilizados para sincronizar.");
            return;
        }
        
        // WARNING about originalId
        const missingOriginalIdCount = usedTickets.filter(t => !t.details?.originalId).length;
        if (missingOriginalIdCount > 0) {
            if (!confirm(`ATENÇÃO: ${missingOriginalIdCount} ingressos não possuem o "ID Original" (Provavelmente importados em versão antiga). \n\nA sincronização pode falhar para estes itens. Recomendamos IMPORTAR novamente os ingressos antes de sincronizar.\n\nDeseja continuar mesmo assim?`)) {
                return;
            }
        }

        if (!confirm(`Deseja enviar ${usedTickets.length} validações para a API externa?\n\nURL Alvo: ${targetUrl}\n\nIsso marcará esses ingressos como usados no sistema de origem.`)) return;

        setIsLoading(true);
        setLoadingMessage('Sincronizando...');
        
        let successCount = 0;
        let failCount = 0;
        let lastErrorMessage = '';
        let lastErrorStatus = '';
        const total = usedTickets.length;

        const numericEventId = apiEventId ? parseInt(apiEventId, 10) : undefined;
        if (!numericEventId) {
            alert("Erro: ID do Evento não configurado ou inválido (precisa ser número).");
            setIsLoading(false);
            return;
        }
        
        const isStIngressos = targetUrl.includes('stingressos.com.br');

        for (let i = 0; i < total; i++) {
            const ticket = usedTickets[i];
            setLoadingMessage(`Enviando ${i+1}/${total} para API...`);
            
            let itemSuccess = false;
            let currentError = '';
            let currentStatus = '';

            const tryHandleResponse = async (res: Response, strategyName: string) => {
                if (res.ok || res.status === 409 || res.status === 422) {
                     try {
                         const data = await res.json();
                         if (data.success === false || data.error === true) {
                             currentError = data.message || JSON.stringify(data);
                             currentStatus = `API Error (${res.status})`;
                             
                             // If it says "used", it's good
                             if (data.message && (data.message.toLowerCase().includes('used') || data.message.toLowerCase().includes('utilizado'))) {
                                 return true;
                             }
                             console.warn(`${strategyName} failed logically:`, data);
                             return false; 
                         }
                         return true;
                     } catch(e) {
                         // JSON parse failed but HTTP OK, assume success if not 4xx
                         return true;
                     }
                }
                
                // HTTP Error
                currentStatus = `HTTP ${res.status}`;
                try {
                    const data = await res.json();
                    currentError = data.message || `Status ${res.status}`;
                } catch(e) { 
                    currentError = `Status ${res.status}`; 
                }
                console.warn(`${strategyName} failed HTTP:`, res.status, currentError);
                return false;
            };

            // --- STRATEGY 1: Path Parameter (POST /checkins/{id}) ---
            // ST Ingressos specifically often requires ID in path AND event_id in body
            if (isStIngressos && !itemSuccess) {
                 try {
                     const idToSend = ticket.details?.originalId || ticket.id;
                     const pathUrl = `${targetUrl}/${idToSend}`;
                     // Add query param backup
                     const urlWithQuery = `${pathUrl}${numericEventId ? `?event_id=${numericEventId}` : ''}`;
                     
                     const res = await fetch(urlWithQuery, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                        },
                        // Include body even for path strategy
                        body: JSON.stringify({ 
                            event_id: numericEventId, 
                            qr_code: ticket.id 
                        }),
                        mode: 'cors'
                    });
                     itemSuccess = await tryHandleResponse(res, 'Strategy 1 (Path+Body)');
                } catch(e) { 
                    console.warn("Strategy 1 Network Fail", e); 
                    if (!currentError) currentError = (e as any).message || "Network Error";
                }
            }

            // --- STRATEGY 2: Standard JSON POST ---
            if (!itemSuccess) {
                try {
                    const payload = {
                        event_id: numericEventId,
                        code: ticket.id,
                        qr_code: ticket.id,
                        ticket_code: ticket.id,
                        uuid: ticket.id
                    };
                    const urlWithParams = `${targetUrl}${numericEventId ? `?event_id=${numericEventId}` : ''}`;
                    const res = await fetch(urlWithParams, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                        },
                        body: JSON.stringify(payload),
                        mode: 'cors'
                    });
                    itemSuccess = await tryHandleResponse(res, 'Strategy 2 (JSON)');
                } catch (e) { console.warn("Strategy 2 Network Fail", e); }
            }
            
            // --- STRATEGY 3: FormData ---
            if (!itemSuccess) {
                try {
                    const formData = new FormData();
                    formData.append('event_id', String(numericEventId));
                    formData.append('code', ticket.id);
                    formData.append('qr_code', ticket.id);
                    
                    const urlWithParams = `${targetUrl}${numericEventId ? `?event_id=${numericEventId}` : ''}`;
                    const res = await fetch(urlWithParams, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${apiToken}`
                        },
                        body: formData,
                        mode: 'cors'
                    });
                     itemSuccess = await tryHandleResponse(res, 'Strategy 3 (FormData)');
                } catch(e) { console.warn("Strategy 3 Network Fail", e); }
            }

            if (itemSuccess) successCount++;
            else {
                failCount++;
                if (!lastErrorMessage && currentError) {
                    lastErrorMessage = currentError;
                    lastErrorStatus = currentStatus;
                }
            }
            
            // Delay for rate limiting
            if (i % 10 === 0) await new Promise(r => setTimeout(r, 100));
        }

        setIsLoading(false);
        setLoadingMessage('');
        
        let report = `Sincronização concluída!\n\nSucesso Confirmado: ${successCount}\nFalhas: ${failCount}`;
        if (failCount > 0) {
            report += `\n\n--- DETALHES DO PRIMEIRO ERRO ---`;
            report += `\nResposta da API: "${lastErrorMessage}"`;
            if (lastErrorStatus) report += `\nStatus: ${lastErrorStatus}`;
            
            if (lastErrorStatus.includes('404')) {
                report += `\n\nCAUSA PROVÁVEL: ID do Ingresso incorreto na URL. Se você importou os dados em uma versão anterior do sistema, RE-IMPORTE os dados agora para capturar o ID correto da API.`;
            } else if (lastErrorMessage.includes('Failed to fetch') || lastErrorMessage.includes('Network Error')) {
                report += `\n\nCAUSA PROVÁVEL: Bloqueio CORS do navegador ou URL inválida.`;
            }
        }
        alert(report);
    };


    const handleImportFromApi = async () => {
        if (!selectedEvent) return;
        if (!apiUrl.trim()) {
            alert('A URL/Link é obrigatória.');
            return;
        }

        const startTime = Date.now(); // Start Timer
        setIsLoading(true);
        setLoadingMessage('Iniciando...');
        
        try {
            const allItems: any[] = [];
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            const ticketsToUpdateStatus: { id: string, usedAt: number }[] = [];

            // Create a Set of existing IDs for O(1) lookup
            const existingTicketIds = new Set(allTickets.map(t => t.id));

            // Save credentials for future use
            if (importType !== 'google_sheets' && apiToken) {
                 await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'import'), {
                    token: apiToken,
                    eventId: apiEventId,
                    lastUpdated: Timestamp.now()
                }, { merge: true });
            }

            // --- GOOGLE SHEETS / CSV PROCESSING ---
            if (importType === 'google_sheets') {
                 setLoadingMessage('Baixando e processando planilha...');
                 
                 let fetchUrl = apiUrl;
                 if (fetchUrl.includes('docs.google.com/spreadsheets') && !fetchUrl.includes('output=csv')) {
                     if (fetchUrl.includes('/edit')) {
                         fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                     }
                 }

                 const response = await fetch(fetchUrl);
                 if (!response.ok) throw new Error('Falha ao baixar planilha. Verifique se o link é público.');
                 
                 const csvText = await response.text();
                 
                 const parsed = Papa.parse(csvText, {
                     header: true,
                     skipEmptyLines: true,
                 });

                 const rows = parsed.data as any[];
                 setLoadingMessage(`Processando ${rows.length} linhas da planilha...`);

                 rows.forEach((row) => {
                     const normalizedRow: {[key: string]: string} = {};
                     Object.keys(row).forEach(k => {
                         normalizedRow[k.toLowerCase().trim()] = row[k];
                     });

                     const code = normalizedRow['code'] || normalizedRow['código'] || normalizedRow['codigo'] || normalizedRow['id'] || normalizedRow['qr'] || normalizedRow['qrcode'] || normalizedRow['ticket'];
                     let sector = normalizedRow['sector'] || normalizedRow['setor'] || normalizedRow['categoria'] || normalizedRow['category'] || 'Geral';
                     const ownerName = normalizedRow['name'] || normalizedRow['nome'] || normalizedRow['cliente'] || normalizedRow['owner'] || '';
                     
                     if (code) {
                         const idStr = String(code).trim();
                         if (ignoreExisting && existingTicketIds.has(idStr)) {
                             return; // Skip existing
                         }

                         newSectors.add(sector);
                         ticketsToSave.push({
                             id: idStr,
                             sector: String(sector).trim(),
                             status: 'AVAILABLE',
                             details: { ownerName: String(ownerName).trim() }
                         });
                     }
                 });

            } 
            // --- STANDARD API PROCESSING (MANUAL PAGINATION) ---
            else {
                const headers: HeadersInit = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };
                if (apiToken.trim()) {
                    headers['Authorization'] = `Bearer ${apiToken.trim()}`;
                }

                const seenIds = new Set<string>();
                const BATCH_LIMIT = 200; // Force large batches
                let page = 1;
                let hasMore = true;
                let totalRecords = 0;
                
                // Clean base URL (remove params to re-add them cleanly)
                let baseUrl = apiUrl;
                try {
                    const urlObj = new URL(apiUrl);
                    baseUrl = urlObj.origin + urlObj.pathname;
                } catch(e) { /* ignore invalid url here, fetch will catch it */ }

                while (hasMore) {
                    setLoadingMessage(`Baixando página ${page} (Itens: ${allItems.length}${totalRecords ? '/' + totalRecords : ''})...`);
                    
                    // Construct URL with strict parameters for this page
                    const currentUrlObj = new URL(apiUrl); 
                    // We use the User provided API Url as base, but force overrides
                    currentUrlObj.searchParams.set('page', String(page));
                    currentUrlObj.searchParams.set('per_page', String(BATCH_LIMIT));
                    currentUrlObj.searchParams.set('limit', String(BATCH_LIMIT));
                    if (apiEventId) currentUrlObj.searchParams.set('event_id', apiEventId);

                    let fetchUrl = currentUrlObj.toString();
                     if (fetchUrl.startsWith('http://') && !fetchUrl.startsWith('http://localhost')) {
                        fetchUrl = fetchUrl.replace('http://', 'https://');
                    }

                    // Add items processing logic (omitted for brevity as it's unchanged from previous version)
                    // [SAME IMPORT LOGIC AS PREVIOUS VERSION]
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const response = await fetch(fetchUrl, { headers });
                    if (!response.ok) {
                        if (response.status === 404 && page > 1) {
                            hasMore = false; break;
                        }
                        throw new Error(`Erro HTTP ${response.status} na página ${page}`);
                    }
                    const jsonResponse = await response.json();
                    let pageItems: any[] = [];
                    let meta: any = null;
                    if (Array.isArray(jsonResponse)) pageItems = jsonResponse;
                    else if (jsonResponse.data && Array.isArray(jsonResponse.data)) { pageItems = jsonResponse.data; meta = jsonResponse; if (jsonResponse.meta) meta = jsonResponse.meta; }
                    else if (jsonResponse.items && Array.isArray(jsonResponse.items)) { pageItems = jsonResponse.items; meta = jsonResponse; }
                    else if (jsonResponse.tickets && Array.isArray(jsonResponse.tickets)) { pageItems = jsonResponse.tickets; meta = jsonResponse; }
                    else if (jsonResponse.participants && Array.isArray(jsonResponse.participants)) { pageItems = jsonResponse.participants; meta = jsonResponse; }
                    else { const keys = Object.keys(jsonResponse); for (const k of keys) { if (Array.isArray(jsonResponse[k])) { pageItems = jsonResponse[k]; break; } } }

                    if (!pageItems || pageItems.length === 0) { hasMore = false; break; }

                    if (!totalRecords) {
                        if (meta?.total) totalRecords = meta.total;
                        else if (meta?.meta?.total) totalRecords = meta.meta.total;
                        else if (jsonResponse.total) totalRecords = jsonResponse.total;
                    }
                    let lastPage = 0;
                    if (meta?.last_page) lastPage = meta.last_page;
                    else if (jsonResponse.last_page) lastPage = jsonResponse.last_page;

                    let newItemsOnPage = 0;
                    pageItems.forEach((item: any) => {
                        const id = item.id || item.code || item.qr_code || item.ticket_code || item.uuid || JSON.stringify(item);
                        const idStr = String(id);
                        if (!seenIds.has(idStr)) { seenIds.add(idStr); allItems.push(item); newItemsOnPage++; }
                    });

                    if (newItemsOnPage === 0 && pageItems.length > 0) { console.warn("Detectado loop de paginação (itens duplicados). Parando."); hasMore = false; }
                    else {
                        if (lastPage > 0 && page >= lastPage) hasMore = false;
                        else if (totalRecords > 0 && allItems.length >= totalRecords) hasMore = false;
                        else if (pageItems.length < (BATCH_LIMIT / 2) && totalRecords === 0) { if (pageItems.length < BATCH_LIMIT) hasMore = false; }
                        if (page >= 500) hasMore = false;
                    }
                    page++;
                }

                if (allItems.length === 0) { alert('Nenhum registro encontrado.'); setIsLoading(false); return; }

                if (importType === 'checkins' || apiUrl.includes('checkins')) {
                    allItems.forEach((item: any) => {
                        const code = item.ticket_code || item.ticket_id || item.code || item.qr_code;
                        const timestampStr = item.created_at || item.checked_in_at || item.timestamp;
                        if (code) {
                            const usedAt = timestampStr ? new Date(String(timestampStr).replace(' ', 'T')).getTime() : Date.now();
                            if (!isNaN(usedAt)) ticketsToUpdateStatus.push({ id: String(code), usedAt });
                        }
                    });
                } else {
                    const processItem = (item: any) => {
                        // Priority: access_code (for participants), then generic codes, then ID
                        const code = item.access_code || item.code || item.qr_code || item.ticket_code || item.barcode || item.id;
                        
                        let sector = item.sector || item.sector_name || item.section || item.setor || item.category || item.ticket_name || item.product_name || 'Geral';
                        if (typeof sector === 'object' && sector.name) sector = sector.name;
                        const ownerName = item.owner_name || item.name || item.participant_name || item.client_name || item.buyer_name || '';
                        
                        // Handle nested tickets list (for buyers import)
                        if (item.tickets && Array.isArray(item.tickets)) { 
                            item.tickets.forEach((subTicket: any) => { 
                                if (!subTicket.owner_name && ownerName) subTicket.owner_name = ownerName; 
                                processItem(subTicket); 
                            }); 
                            return; 
                        }

                        if (code) {
                            const idStr = String(code);
                            if (ignoreExisting && existingTicketIds.has(idStr)) return; 
                            newSectors.add(String(sector));
                            ticketsToSave.push({ id: idStr, sector: String(sector), status: 'AVAILABLE', details: { ownerName: String(ownerName), originalId: item.id } });
                        }
                    };
                    allItems.forEach(processItem);
                }
            }

            if (ticketsToSave.length > 0) {
                const currentSectorsSet = new Set(sectorNames);
                let sectorsUpdated = false;
                newSectors.forEach(s => { if (!currentSectorsSet.has(s)) { currentSectorsSet.add(s); sectorsUpdated = true; } });
                if (sectorsUpdated) { const updatedSectorList = Array.from(currentSectorsSet); await onUpdateSectorNames(updatedSectorList); setEditableSectorNames(updatedSectorList); }
            }

            const BATCH_SIZE = 450;
            let savedCount = 0;
            let updatedCount = 0;

            if (ticketsToSave.length > 0) {
                setLoadingMessage(`Salvando ${ticketsToSave.length} ingressos (Novos)...`);
                 const chunks = [];
                for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) chunks.push(ticketsToSave.slice(i, i + BATCH_SIZE));
                for (const chunk of chunks) {
                    const batch = writeBatch(db);
                    chunk.forEach(ticket => { const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', ticket.id); batch.set(ticketRef, { sector: ticket.sector, details: ticket.details, status: ticket.status }, { merge: true }); });
                    await batch.commit();
                    savedCount += chunk.length;
                }
            }

            if (ticketsToUpdateStatus.length > 0) {
                setLoadingMessage('Sincronizando check-ins...');
                const chunks = [];
                for (let i = 0; i < ticketsToUpdateStatus.length; i += BATCH_SIZE) chunks.push(ticketsToUpdateStatus.slice(i, i + BATCH_SIZE));
                for (const chunk of chunks) {
                     const batch = writeBatch(db);
                     chunk.forEach(updateItem => { const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', updateItem.id); batch.set(ticketRef, { status: 'USED', usedAt: Timestamp.fromMillis(updateItem.usedAt) }, { merge: true }); });
                     await batch.commit();
                     updatedCount += chunk.length;
                }
            }

            // Calculate duration
            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const durationSeconds = (durationMs / 1000).toFixed(1);
            let timeString = `${durationSeconds}s`;
            if (durationMs > 60000) {
                const minutes = Math.floor(durationMs / 60000);
                const seconds = ((durationMs % 60000) / 1000).toFixed(0);
                timeString = `${minutes}m ${seconds}s`;
            }

            let msg = 'Processo concluído!\n';
            if (savedCount > 0) msg += `- ${savedCount} novos ingressos importados.\n`;
            else if (ticketsToSave.length === 0 && ticketsToUpdateStatus.length === 0) msg += `- Nenhum dado novo encontrado.\n`;
            if (updatedCount > 0) msg += `- ${updatedCount} ingressos marcados como utilizados.\n`;
            msg += `\nTempo total: ${timeString}`; // Show total time

            alert(msg);
            
        } catch (error) {
            console.error('Import Error:', error);
            alert(`Falha na importação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleSaveTickets = async () => {
        if (!selectedEvent) return;
        if ((Object.values(ticketCodes) as string[]).every(codes => !codes.trim())) {
            alert('Nenhum código de ingresso para salvar.');
            return;
        }
        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const processCodes = (codes: string, sector: Sector) => {
                const codeList = codes.split('\n').map(c => c.trim()).filter(Boolean);
                codeList.forEach(code => {
                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', code);
                    batch.set(ticketRef, { 
                        sector: sector,
                        status: 'AVAILABLE',
                        usedAt: null,
                        details: {}
                    });
                });
            };
            
            for (const sector in ticketCodes) {
                if (sectorNames.includes(sector) && ticketCodes[sector].trim()) {
                    processCodes(ticketCodes[sector], sector);
                }
            }

            await batch.commit();
            alert('Ingressos salvos com sucesso!');
            setTicketCodes({});
        } catch (error) {
            console.error("Erro ao salvar ingressos: ", error);
            alert('Falha ao salvar ingressos.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownloadReport = () => {
        if (!selectedEvent) return;
        setIsGeneratingPdf(true);
        try {
            generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames);
        } catch (error) {
            console.error("Failed to generate PDF report:", error);
            alert("Ocorreu um erro ao gerar o relatório em PDF.");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    // Event Handlers
    const handleCreateEvent = async () => {
        if (!newEventName.trim()) return;
        setIsLoading(true);
        try {
            const eventRef = await addDoc(collection(db, 'events'), { name: newEventName.trim(), isHidden: false });
            await setDoc(doc(db, 'events', eventRef.id, 'settings', 'main'), { sectorNames: ['Pista', 'VIP'] });
            
            // Auto-grant permission to the creator if regular admin
            if (currentUser && currentUser.role === 'ADMIN' && onUpdateCurrentUser) {
                const newAllowed = [...(currentUser.allowedEvents || []), eventRef.id];
                // Update in DB (assuming we can write to users if we are admin, or through cloud function ideally, but client-side restricted here)
                try {
                     if (currentUser.id.startsWith('admin_master')) {
                         // Master admin session update local only as it's not in DB
                         onUpdateCurrentUser({ allowedEvents: newAllowed });
                     } else {
                         await updateDoc(doc(db, 'users', currentUser.id), { allowedEvents: newAllowed });
                         onUpdateCurrentUser({ allowedEvents: newAllowed });
                     }
                } catch(e) { console.error("Failed to self-grant permission", e); }
            }

            alert(`Evento "${newEventName.trim()}" criado!`);
            setNewEventName('');
        } catch (error) { alert("Falha ao criar evento."); } finally { setIsLoading(false); }
    };

    const handleRenameEvent = async () => {
        if (!selectedEvent || !renameEventName.trim()) return;
        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'events', selectedEvent.id), { name: renameEventName.trim() });
            alert("Evento renomeado!");
        } catch (error) { alert("Falha ao renomear."); } finally { setIsLoading(false); }
    };
    
    const handleToggleEventVisibility = async (eventId: string, isHidden: boolean) => {
        setIsLoading(true);
        try { await updateDoc(doc(db, 'events', eventId), { isHidden: !isHidden }); } 
        catch (error) { alert("Falha ao alterar visibilidade."); } finally { setIsLoading(false); }
    };

    const handleDeleteEvent = async (eventId: string, eventName: string) => {
        if (confirm(`Apagar "${eventName}"?`)) {
            setIsLoading(true);
            try { await deleteDoc(doc(db, 'events', eventId)); alert("Evento apagado."); } 
            catch (error) { alert("Falha ao apagar."); } finally { setIsLoading(false); }
        }
    };

    // Online Config Handlers
    const handleSaveValidationConfig = async () => {
        if (!selectedEvent) return;
        try {
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'validation'), {
                mode: validationMode,
                apiEndpoints: onlineApiEndpoints,
                sheetUrl: onlineSheetUrl
            }, { merge: true });
            alert('Configurações de Modo de Operação salvas!');
        } catch (error) {
            alert('Erro ao salvar configurações.');
        }
    };

    const handleAddEndpoint = () => {
        setOnlineApiEndpoints([...onlineApiEndpoints, { url: '', token: '', eventId: '' }]);
    };

    const handleRemoveEndpoint = (index: number) => {
        const newEndpoints = [...onlineApiEndpoints];
        newEndpoints.splice(index, 1);
        setOnlineApiEndpoints(newEndpoints);
    };

    const handleEndpointChange = (index: number, field: 'url' | 'token' | 'eventId', value: string) => {
        const newEndpoints = [...onlineApiEndpoints];
        newEndpoints[index][field] = value;
        setOnlineApiEndpoints(newEndpoints);
    };
    
    const toggleTokenVisibility = (index: number) => {
        setVisibleTokens(prev => ({ ...prev, [index]: !prev[index] }));
    };

    const handleDownloadTemplate = () => {
        const csvContent = "codigo,setor,nome\n123456,VIP,Joao Silva\n654321,Pista,Maria Oliveira";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'modelo_ingressos.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const NoEventSelectedMessage = () => (
        <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
            <p>Por favor, selecione um evento primeiro.</p>
        </div>
    );
  
    const renderContent = () => {
        if (activeTab === 'users') {
            if (isSuperAdmin) {
                return <SuperAdminView db={db} events={events} onClose={() => setActiveTab('stats')} />;
            } else {
                return <div className="p-4 text-red-400">Acesso negado.</div>;
            }
        }

        if (!selectedEvent && activeTab !== 'events') return <NoEventSelectedMessage />;
        
        switch (activeTab) {
            case 'stats':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="flex justify-between items-center flex-wrap gap-2">
                            <h2 className="text-2xl font-bold text-white">Dashboard do Evento</h2>
                            <div className="flex space-x-2">
                                <button 
                                    onClick={handleCopyPublicLink}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center shadow-lg"
                                    title="Gerar link para visualização pública das estatísticas"
                                >
                                    <LinkIcon className="w-5 h-5 mr-2" />
                                    Link Público
                                </button>
                                <button 
                                    onClick={handleDownloadReport} 
                                    disabled={isGeneratingPdf} 
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center shadow-lg disabled:opacity-50"
                                >
                                    <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                    {isGeneratingPdf ? 'Gerando...' : 'Baixar PDF'}
                                </button>
                            </div>
                        </div>
                        
                        {/* PASS CONTROLLED PROPS TO STATS */}
                        <Stats 
                            allTickets={allTickets} 
                            sectorNames={sectorNames} 
                            viewMode={statsViewMode}
                            onViewModeChange={handleStatsViewModeChange}
                            groups={sectorGroups}
                            onGroupsChange={handleSectorGroupsChange}
                            isReadOnly={false}
                        />

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                             <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <PieChart data={pieChartData} title="Distribuição por Setor"/>
                            </div>
                            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-4">Análise Temporal</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm hover:border-green-500 transition-colors">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Primeiro Acesso</p>
                                    <p className="text-2xl font-bold text-green-400">
                                        {analyticsData.firstAccess ? new Date(analyticsData.firstAccess).toLocaleTimeString('pt-BR') : '--:--'}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm hover:border-red-500 transition-colors">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Último Acesso</p>
                                    <p className="text-2xl font-bold text-red-400">
                                        {analyticsData.lastAccess ? new Date(analyticsData.lastAccess).toLocaleTimeString('pt-BR') : '--:--'}
                                    </p>
                                </div>
                                <div className="bg-gray-800 p-5 rounded-lg border border-gray-700 shadow-sm hover:border-orange-500 transition-colors">
                                    <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Horário de Pico ({analyticsData.peak.time})</p>
                                    <p className="text-2xl font-bold text-orange-400">
                                        {analyticsData.peak.count} <span className="text-sm font-normal text-gray-400">entradas</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'search':
                if (!selectedEvent) return <NoEventSelectedMessage />;
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
                        {showScanner && ( <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"> <div className="w-full max-w-md bg-gray-800 rounded-lg overflow-hidden relative shadow-2xl border border-gray-700"> <button onClick={() => setShowScanner(false)} className="absolute top-2 right-2 z-10 text-white bg-black/50 rounded-full p-1 hover:bg-red-600 transition-colors"><XCircleIcon className="w-8 h-8" /></button> <div className="p-4 text-center"> <h3 className="text-lg font-bold text-white mb-2">Escanear para Consultar</h3> <div className="aspect-square w-full bg-black rounded overflow-hidden"> <Scanner onScanSuccess={handleScanInAdmin} onScanError={() => {}} /> </div> </div> </div> </div> )}
                        {searchType === 'TICKET_LOCAL' && searchResult && (
                             <div className="animate-fade-in space-y-4">
                                <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
                                    <div className="bg-gray-700 px-6 py-4 border-b border-gray-600"><h3 className="font-bold text-lg">Detalhes do Ingresso</h3></div>
                                    <div className="p-6">
                                        {searchResult.ticket ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div><p className="text-gray-400 text-sm uppercase font-bold">Código</p><p className="text-xl text-white font-mono">{searchResult.ticket.id}</p></div>
                                                <div><p className="text-gray-400 text-sm uppercase font-bold">Status Atual</p><div className="flex items-center mt-1">{searchResult.ticket.status === 'USED' ? (<><AlertTriangleIcon className="w-5 h-5 text-yellow-500 mr-2" /><span className="text-yellow-400 font-bold">JÁ UTILIZADO</span></>) : (<><CheckCircleIcon className="w-5 h-5 text-green-500 mr-2" /><span className="text-green-400 font-bold">DISPONÍVEL</span></>)}</div></div>
                                                {searchResult.ticket.status === 'USED' && searchResult.ticket.usedAt && (
                                                    <div className="col-span-1 md:col-span-2 bg-yellow-900/20 border border-yellow-700/50 p-3 rounded flex items-center">
                                                        <ClockIcon className="w-6 h-6 text-yellow-500 mr-3" />
                                                        <div>
                                                            <p className="text-yellow-500 text-xs font-bold uppercase">Validado em</p>
                                                            <p className="text-yellow-100 font-mono text-lg">{new Date(searchResult.ticket.usedAt).toLocaleString('pt-BR')}</p>
                                                        </div>
                                                    </div>
                                                )}
                                                <div><p className="text-gray-400 text-sm uppercase font-bold">Setor</p><p className="text-white text-lg">{searchResult.ticket.sector}</p></div>
                                                <div><p className="text-gray-400 text-sm uppercase font-bold">Nome do Dono</p><p className="text-white text-lg">{searchResult.ticket.details?.ownerName || '-'}</p></div>
                                            </div>
                                        ) : (
                                            <div className="text-center py-4"><XCircleIcon className="w-12 h-12 text-red-500 mx-auto mb-2" /><p className="text-red-400 font-bold text-lg">Ingresso não encontrado.</p></div>
                                        )}
                                    </div>
                                    {searchResult.logs.length > 0 && (
                                        <div className="border-t border-gray-600">
                                            <div className="bg-gray-700/50 px-6 py-2 border-b border-gray-600"><h4 className="font-bold text-sm text-gray-300">Histórico de Validação</h4></div>
                                            <div className="max-h-48 overflow-y-auto">
                                                {searchResult.logs.map((log, i) => (
                                                    <div key={i} className="px-6 py-3 border-b border-gray-700 flex justify-between items-center hover:bg-gray-700/30">
                                                        <div>
                                                            <p className="text-sm font-mono text-white">{new Date(log.timestamp).toLocaleString('pt-BR')}</p>
                                                            <p className="text-xs text-gray-400">{log.operator ? `Operador: ${log.operator}` : 'Operador Desconhecido'}</p>
                                                        </div>
                                                        <span className={`text-xs px-2 py-1 rounded font-bold ${log.status === 'VALID' ? 'bg-green-600 text-white' : log.status === 'USED' ? 'bg-yellow-600 text-white' : 'bg-red-600 text-white'}`}>{log.status}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                             </div>
                        )}
                        {searchType === 'BUYER_API' && buyerSearchResults.length > 0 && (
                            <div className="animate-fade-in space-y-4">
                                {buyerSearchResults.map((buyer, idx) => (
                                    <div key={idx} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
                                         <div className="bg-purple-900/30 px-6 py-4 border-b border-gray-600 flex justify-between items-center flex-wrap gap-2">
                                            <h3 className="font-bold text-lg text-purple-300">{buyer.name || buyer.buyer_name || "Comprador Desconhecido"}</h3>
                                            {(buyer.tickets && buyer.tickets.length > 0) && (<button onClick={() => handleImportSingleBuyer(buyer)} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center shadow"><CloudDownloadIcon className="w-3 h-3 mr-1" />Importar</button>)}
                                        </div>
                                        
                                        {/* DETAILED BUYER INFO GRID */}
                                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {/* IMPORTANT: Access Code Display */}
                                            {buyer.access_code && (
                                                <div className="bg-black/40 p-2 rounded border border-purple-500/30">
                                                    <span className="text-xs text-purple-400 uppercase font-bold">Código de Acesso (Ingresso)</span>
                                                    <p className="text-white font-mono text-lg font-bold tracking-wider">{buyer.access_code}</p>
                                                </div>
                                            )}
                                            
                                            <div><span className="text-xs text-gray-400 uppercase font-bold">Email</span><p className="text-white">{buyer.email || '-'}</p></div>
                                            <div><span className="text-xs text-gray-400 uppercase font-bold">Telefone</span><p className="text-white">{buyer.phone || '-'}</p></div>
                                            <div><span className="text-xs text-gray-400 uppercase font-bold">Documento ({buyer.document_type || 'DOC'})</span><p className="text-white">{buyer.document || buyer.cpf || '-'}</p></div>
                                            
                                            <div>
                                                <span className="text-xs text-gray-400 uppercase font-bold">Check-in na API?</span>
                                                <p className={`font-bold ${buyer.checked_in || buyer.status === 'used' || buyer.status === 'checked_in' ? 'text-green-400' : 'text-gray-400'}`}>
                                                    {(buyer.checked_in || buyer.status === 'used' || buyer.status === 'checked_in') ? 'SIM' : 'NÃO'}
                                                </p>
                                            </div>
                                            {(!buyer.name && buyer.first_name) && (
                                                <div><span className="text-xs text-gray-400 uppercase font-bold">Nome Completo</span><p className="text-white">{buyer.first_name} {buyer.last_name}</p></div>
                                            )}
                                        </div>

                                        {/* Custom Questions */}
                                        {buyer.custom_questions && buyer.custom_questions.length > 0 && (
                                            <div className="px-4 pb-4">
                                                <p className="text-xs text-gray-400 uppercase font-bold mb-1">Perguntas Personalizadas</p>
                                                <ul className="text-sm text-gray-300 list-disc pl-4">
                                                    {buyer.custom_questions.map((q: any, i: number) => (
                                                        <li key={i}>{typeof q === 'string' ? q : JSON.stringify(q)}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {buyer.tickets && buyer.tickets.length > 0 && (
                                            <div className="bg-black/20 p-4">
                                                <p className="text-xs font-bold text-gray-400 mb-2 uppercase">Ingressos ({buyer.tickets.length})</p>
                                                <div className="space-y-2">
                                                    {buyer.tickets.map((t: any, ti: number) => {
                                                        const code = findValueRecursively(t, ['qr_code', 'code', 'ticket_code', 'uuid', 'barcode', 'id', 'ticket_id', 'pk', 'locator', 'identifier', 'friendly_id', 'access_code']);
                                                        const sector = findValueRecursively(t, ['sector', 'sector_name', 'section', 'category', 'product_name']);
                                                        const status = findValueRecursively(t, ['status', 'state']);
                                                        
                                                        let sectorName = 'Geral';
                                                        if (typeof sector === 'object' && sector && (sector as any).name) sectorName = (sector as any).name;
                                                        else if (typeof sector === 'string') sectorName = sector;

                                                        return (
                                                            <div key={ti} className="flex justify-between items-center bg-gray-700/50 p-2 rounded border border-gray-600">
                                                                <div>
                                                                    <p className="text-sm font-mono text-white font-bold">{code || 'S/ CÓDIGO'}</p>
                                                                    <p className="text-xs text-gray-400">{sectorName}</p>
                                                                </div>
                                                                <span className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${status === 'used' || status === 'checked_in' ? 'bg-yellow-600 text-white' : 'bg-green-600 text-white'}`}>{status || 'available'}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
             case 'operators':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 animate-fade-in">
                        <h2 className="text-xl font-bold mb-4 flex items-center"><UsersIcon className="w-6 h-6 mr-2 text-blue-500" /> Painel de Operadores</h2>
                        <div className="overflow-x-auto">
                             <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-700 text-gray-300 text-xs uppercase">
                                        <th className="px-4 py-2">Operador</th>
                                        <th className="px-4 py-2 text-center">Validações Válidas</th>
                                        <th className="px-4 py-2">Dispositivos Utilizados</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {operatorStats.map(op => (
                                        <tr key={op.name} className="hover:bg-gray-700/50">
                                            <td className="px-4 py-3 font-medium text-white">{op.name}</td>
                                            <td className="px-4 py-3 text-center text-green-400 font-bold text-lg">{op.validScans}</td>
                                            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{Array.from(op.devices).join(', ')}</td>
                                        </tr>
                                    ))}
                                    {operatorStats.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="text-center py-4 text-gray-500">Nenhuma atividade de operador registrada.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            case 'settings':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* SETTINGS CONTENT (VALIDATION, SECTOR NAMES, ETC) - UNCHANGED BUT RE-RENDERED */}
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-bold mb-4 text-orange-400 flex items-center"><CogIcon className="w-5 h-5 mr-2" /> Modo de Operação (Validação)</h3>
                                <div className="space-y-3">
                                    <div className="flex flex-col space-y-2">
                                        <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition"><input type="radio" name="validationMode" value="OFFLINE" checked={validationMode === 'OFFLINE'} onChange={() => setValidationMode('OFFLINE')} className="mr-3 h-4 w-4 text-orange-600" /><div><span className="font-bold text-white">Offline (Banco de Dados Local)</span><p className="text-xs text-gray-400">Requer importação prévia.</p></div></label>
                                        <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition"><input type="radio" name="validationMode" value="ONLINE_API" checked={validationMode === 'ONLINE_API'} onChange={() => setValidationMode('ONLINE_API')} className="mr-3 h-4 w-4 text-orange-600" /><div><span className="font-bold text-white">Online (API em Tempo Real)</span><p className="text-xs text-gray-400">Valida direto na API Externa.</p></div></label>
                                        <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition"><input type="radio" name="validationMode" value="ONLINE_SHEETS" checked={validationMode === 'ONLINE_SHEETS'} onChange={() => setValidationMode('ONLINE_SHEETS')} className="mr-3 h-4 w-4 text-orange-600" /><div><span className="font-bold text-white">Online (Google Sheets)</span><p className="text-xs text-gray-400">Valida direto na planilha.</p></div></label>
                                    </div>
                                    {validationMode === 'ONLINE_API' && (
                                        <div className="mt-4 pl-4 border-l-2 border-orange-500/50">
                                            <h4 className="text-sm font-bold text-white mb-2">Endpoints da API</h4>
                                            {onlineApiEndpoints.map((endpoint, idx) => (
                                                <div key={idx} className="bg-gray-900/50 p-3 rounded mb-2 space-y-2 relative">
                                                    <button onClick={() => handleRemoveEndpoint(idx)} className="absolute top-2 right-2 text-gray-500 hover:text-red-400">&times;</button>
                                                    <input type="text" value={endpoint.url} onChange={(e) => handleEndpointChange(idx, 'url', e.target.value)} placeholder="URL da API" className="w-full bg-gray-700 p-2 rounded text-sm" />
                                                    <div className="relative">
                                                        <input type={visibleTokens[idx] ? "text" : "password"} value={endpoint.token} onChange={(e) => handleEndpointChange(idx, 'token', e.target.value)} placeholder="Token (Bearer)" className="w-full bg-gray-700 p-2 rounded text-sm pr-10" />
                                                        <button onClick={() => toggleTokenVisibility(idx)} className="absolute right-2 top-2 text-gray-400 hover:text-white">{visibleTokens[idx] ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}</button>
                                                    </div>
                                                    <input type="text" value={endpoint.eventId} onChange={(e) => handleEndpointChange(idx, 'eventId', e.target.value)} placeholder="ID do Evento (Obrigatório)" className={`w-full bg-gray-700 p-2 rounded text-sm ${!endpoint.eventId ? 'border border-red-500/50' : ''}`} />
                                                </div>
                                            ))}
                                            <button onClick={handleAddEndpoint} className="text-xs text-orange-400 hover:underline">+ Adicionar outro endpoint</button>
                                        </div>
                                    )}
                                     {validationMode === 'ONLINE_SHEETS' && (
                                        <div className="mt-4 pl-4 border-l-2 border-orange-500/50">
                                            <input type="text" value={onlineSheetUrl} onChange={(e) => setOnlineSheetUrl(e.target.value)} placeholder="Link CSV" className="w-full bg-gray-700 p-2 rounded text-sm mb-2" />
                                             <button onClick={handleDownloadTemplate} className="text-xs text-blue-400 hover:underline flex items-center mb-2"><CloudDownloadIcon className="w-3 h-3 mr-1" /> Baixar Modelo</button>
                                        </div>
                                    )}
                                    <button onClick={handleSaveValidationConfig} className="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold mt-2">Salvar Configuração de Modo</button>
                                </div>
                             </div>
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                <h3 className="text-lg font-bold mb-3">Nomes dos Setores</h3>
                                 <div className="space-y-3 mb-4">
                                     {editableSectorNames.map((name, index) => ( 
                                         <div key={index} className="flex items-center space-x-2"> 
                                            <input type="text" value={name} onChange={(e) => handleSectorNameChange(index, e.target.value)} className="flex-grow bg-gray-700 p-2 rounded border border-gray-600" /> 
                                            <button onClick={() => handleToggleSectorVisibility(index)} className="p-2 text-gray-400 hover:text-white" title={sectorVisibility[index] ? "Visível na validação" : "Oculto na validação"}>
                                                {sectorVisibility[index] ? <EyeIcon className="w-5 h-5 text-green-500"/> : <EyeSlashIcon className="w-5 h-5 text-gray-500"/>}
                                            </button>
                                            <button onClick={() => handleRemoveSector(index)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded disabled:bg-gray-500" disabled={editableSectorNames.length <= 1}>&times;</button> 
                                        </div> 
                                    ))}
                                </div>
                                <div className="flex space-x-2"><button onClick={handleAddSector} className="flex-1 bg-gray-600 hover:bg-gray-700 py-2 rounded font-bold text-sm">+ Setor</button><button onClick={handleSaveSectorNames} disabled={isSavingSectors || isLoading} className="flex-1 bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 text-sm">Salvar</button></div>
                            </div>
                            {/* Manual Code Entry Block */}
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3 flex items-center"><TableCellsIcon className="w-5 h-5 mr-2 text-green-400" /> Adicionar Códigos por Lista (Manual)</h3>
                                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2"> {sectorNames.map((sector) => ( <div key={sector}> <label className="block text-xs font-bold text-gray-300 mb-1 uppercase">{sector}</label> <textarea value={ticketCodes[sector] || ''} onChange={(e) => handleTicketCodeChange(sector, e.target.value)} placeholder={`Cole os códigos...`} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm h-24 font-mono" /> </div> ))} </div>
                                <button onClick={handleSaveTickets} disabled={isLoading} className="w-full mt-4 bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold disabled:bg-gray-500 text-sm shadow-lg">Salvar Lista de Códigos</button>
                            </div>
                        </div>
                        <div className="space-y-6">
                             {/* CSV Upload Local */}
                            <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3 flex items-center"><TableCellsIcon className="w-5 h-5 mr-2 text-blue-400" /> Upload Arquivo CSV</h3>
                                <input type="file" accept=".csv" onChange={(e) => { if (e.target.files && e.target.files[0]) { const reader = new FileReader(); reader.onload = async (event) => { const text = event.target?.result; if (typeof text === 'string') { const blob = new Blob([text], { type: 'text/csv' }); const url = URL.createObjectURL(blob); setImportType('google_sheets'); setApiUrl(url); } }; reader.readAsText(e.target.files[0]); } }} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600" />
                            </div>

                            <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-bold mb-3 text-orange-400 flex items-center"><CloudDownloadIcon className="w-5 h-5 mr-2" /> Importar Dados (Modo Offline)</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end"><div className="w-full mr-2"><label className="text-xs text-gray-400">Carregar Configuração Salva</label><div className="flex space-x-1"><select value={selectedPresetId} onChange={handlePresetChange} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"><option value="">Selecione...</option>{importPresets.map((p, i) => <option key={i} value={p.name}>{p.name}</option>)}</select><button onClick={handleDeletePreset} disabled={!selectedPresetId} className="bg-red-600 px-2 rounded disabled:opacity-50"><TrashIcon className="w-4 h-4"/></button></div></div></div>
                                    <div><label className="text-xs text-gray-400">Tipo de Importação</label><select value={importType} onChange={(e) => handleImportTypeChange(e.target.value as ImportType)} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm mb-2"><option value="tickets">Ingressos (API Padrão)</option><option value="participants">Participantes (API)</option><option value="buyers">Compradores (API)</option><option value="checkins">Sincronizar Check-ins (API)</option><option value="google_sheets">Google Sheets (Link CSV)</option></select></div>
                                    <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://..." className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm" />
                                    {importType !== 'google_sheets' && (<div className="grid grid-cols-2 gap-2"><div className="relative"><label className="text-xs text-gray-400">Token</label><input type={showImportToken ? "text" : "password"} value={apiToken} onChange={(e) => setApiToken(e.target.value)} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm pr-8" /><button onClick={() => setShowImportToken(!showImportToken)} className="absolute right-2 top-6 text-gray-400">{showImportToken ? <EyeSlashIcon className="w-3 h-3"/> : <EyeIcon className="w-3 h-3"/>}</button></div><div><label className="text-xs text-gray-400">ID Evento</label><input type="text" value={apiEventId} onChange={(e) => setApiEventId(e.target.value)} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm" /></div></div>)}
                                    <div className="flex items-center my-2 bg-gray-700/50 p-2 rounded border border-gray-600">
                                        <input 
                                            type="checkbox" 
                                            id="ignoreExisting" 
                                            checked={ignoreExisting} 
                                            onChange={(e) => setIgnoreExisting(e.target.checked)} 
                                            disabled={!isSuperAdmin}
                                            className={`w-4 h-4 text-orange-600 rounded bg-gray-600 border-gray-500 ${!isSuperAdmin ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} 
                                        />
                                        <label htmlFor="ignoreExisting" className={`ml-2 text-xs text-gray-400 flex items-center ${!isSuperAdmin ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                            Ignorar ingressos já importados
                                            {!isSuperAdmin ? (
                                                <span className="flex items-center ml-1 text-gray-500" title="Apenas Super Admin pode alterar">
                                                    (Bloqueado) <LockClosedIcon className="w-3 h-3 ml-1" />
                                                </span>
                                            ) : (
                                                <span className="ml-1 text-green-400 text-[10px] uppercase font-bold border border-green-500/50 px-1 rounded">Editável</span>
                                            )}
                                        </label>
                                    </div>
                                    <div className="flex space-x-2 pt-2"><button onClick={handleImportFromApi} disabled={isLoading} className="flex-grow bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 flex justify-center items-center text-sm">{isLoading ? (loadingMessage || 'Processando...') : 'Importar Agora'}</button>{importType !== 'google_sheets' && (<button onClick={handleSavePreset} className="px-3 bg-gray-600 hover:bg-gray-500 rounded text-xs font-bold" title="Salvar na Lista">Salvar Lista</button>)}</div>
                                    <div className="mt-4 pt-4 border-t border-gray-700"><button onClick={handleSyncExport} disabled={isLoading} className="w-full bg-gray-700 hover:bg-gray-600 text-orange-400 py-2 rounded text-sm font-bold flex items-center justify-center border border-orange-500/30"><CloudUploadIcon className="w-4 h-4 mr-2" /> Enviar Validações para ST / API</button></div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'history':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'events':
                return (
                     <div className="space-y-6 animate-fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {canManageEvents && (
                                <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                    <h3 className="text-lg font-bold mb-3">Criar Novo Evento</h3>
                                    <div className="space-y-3">
                                        <input type="text" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Nome do Evento" className="w-full bg-gray-700 p-3 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                        <button onClick={handleCreateEvent} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-3 rounded font-bold disabled:bg-gray-500">Criar Evento</button>
                                    </div>
                                </div>
                            )}
                            
                            <div className={`bg-gray-800 p-5 rounded-lg shadow-lg ${!canManageEvents ? 'col-span-2' : ''}`}>
                                <h3 className="text-lg font-bold mb-3">Lista de Eventos Disponíveis</h3>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {events.map(event => (
                                        <div key={event.id} className="flex items-center justify-between bg-gray-700 p-3 rounded hover:bg-gray-600 transition-colors">
                                            <span className={`font-medium ${event.isHidden ? 'text-gray-500 italic' : 'text-white'}`}>{event.name}</span>
                                            <div className="flex space-x-2">
                                                <button onClick={() => { onSelectEvent(event); setActiveTab('stats'); }} className="text-xs px-3 py-1 bg-green-600 hover:bg-green-500 rounded font-bold text-white shadow-sm">
                                                    Gerenciar
                                                </button>
                                                {canManageEvents && (
                                                    <button onClick={() => handleToggleEventVisibility(event.id, event.isHidden || false)} className="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded border border-gray-500">
                                                        {event.isHidden ? 'Mostrar' : 'Ocultar'}
                                                    </button>
                                                )}
                                                {isSuperAdmin && (
                                                    <button onClick={() => handleDeleteEvent(event.id, event.name)} className="text-xs px-3 py-1 bg-red-600 hover:bg-red-500 rounded">
                                                        Apagar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {events.length === 0 && <p className="text-gray-500 text-sm text-center py-4">Nenhum evento disponível.</p>}
                                </div>
                            </div>

                             {selectedEvent && canManageEvents && (
                                <div className="bg-gray-800 p-5 rounded-lg md:col-span-2 border border-gray-700">
                                    <h3 className="text-lg font-bold mb-3">Editar Evento: <span className="text-orange-400">{selectedEvent.name}</span></h3>
                                    <div className="flex space-x-2">
                                        <input type="text" value={renameEventName} onChange={(e) => setRenameEventName(e.target.value)} className="flex-grow bg-gray-700 p-3 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                        <button onClick={handleRenameEvent} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded font-bold disabled:bg-gray-500">Renomear</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-10">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-2 custom-scrollbar border border-gray-700 items-center">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'stats' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'settings' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Configurações</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'history' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'events' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Eventos</button>
                <button onClick={() => setActiveTab('search')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'search' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Consultar</button>
                <button onClick={() => setActiveTab('operators')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors flex items-center ${activeTab === 'operators' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}><UsersIcon className="w-4 h-4 mr-2"/>Operadores</button>
                
                {isSuperAdmin && (
                     <div className="ml-auto pl-2 border-l border-gray-600">
                        <button 
                            onClick={() => setActiveTab('users')}
                            className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors flex items-center ${
                                activeTab === 'users' ? 'bg-purple-600 text-white shadow-md' : 'text-purple-400 hover:bg-purple-900/50 hover:text-purple-300'
                            }`}
                        >
                            <UsersIcon className="w-4 h-4 mr-2" />
                            Usuários
                        </button>
                    </div>
                )}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;


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

    // Locators State
    const [locatorCodes, setLocatorCodes] = useState('');

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
                    const initialCounts: Record<string, number> = {};
                    if (statsViewMode === 'grouped' && Array.isArray(sectorGroups)) {
                         sectorGroups.forEach(g => initialCounts[g.name] = 0);
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
            // Exclude standby tickets from pie chart calculation
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
            const ticket = allTickets.find(t => t.id === queryToUse.trim());
            const logs = scanHistory.filter(l => l.ticketId === queryToUse.trim());
            logs.sort((a,b) => b.timestamp - a.timestamp); // Newest first
            setSearchResult({ ticket, logs });
        } else { // API BUYER SEARCH
            if (!apiToken) {
                alert("Para buscar online, configure o Token na aba de Importação.");
                return;
            }
            setIsLoading(true);
            setBuyerSearchResults([]);
            
            try {
                let baseUrl = apiUrl.trim();
                if (!baseUrl) throw new Error("URL da API não configurada.");
                
                // --- Safe URL Construction ---
                const url = new URL(baseUrl);
                let pathSegments = url.pathname.split('/').filter(Boolean);
                const knownEndpoints = ['tickets', 'buyers', 'checkins', 'participants'];

                // Find if a known endpoint is the last segment
                if (pathSegments.length > 0 && knownEndpoints.includes(pathSegments[pathSegments.length - 1])) {
                    // Replace it with 'participants'
                    pathSegments[pathSegments.length - 1] = 'participants';
                } else {
                    // If not, append 'participants'
                    pathSegments.push('participants');
                }
                
                url.pathname = '/' + pathSegments.join('/');
                
                // Add search parameters safely using URLSearchParams
                url.searchParams.set('search', queryToUse.trim());
                if (apiEventId) {
                    url.searchParams.set('event_id', apiEventId);
                }
                
                const searchUrl = url.toString();
                // --- End of Safe URL Construction ---

                const res = await fetch(searchUrl, {
                    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiToken}` }
                });
                
                if (!res.ok) throw new Error(`Erro API: ${res.status} - ${res.statusText}`);
                
                const data = await res.json();
                let results = [];
                if (Array.isArray(data)) results = data;
                else if (data.data && Array.isArray(data.data)) results = data.data;
                else if (data.buyers && Array.isArray(data.buyers)) results = data.buyers;
                else if (data.participants && Array.isArray(data.participants)) results = data.participants;

                results.forEach((r: any) => {
                     if (!r.tickets || r.tickets.length === 0) {
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
        setShowScanner(false);
        setSearchQuery(decodedText);
        handleSearch(decodedText);
    };

    // Import tickets from a specific buyer found in search
    const handleImportSingleBuyer = async (buyer: any) => {
        if (!selectedEvent || !buyer) { alert("Dados inválidos."); return; }
        
        let ticketsList = [];
        if (buyer.tickets && Array.isArray(buyer.tickets)) ticketsList = buyer.tickets;
        else if (Array.isArray(buyer)) ticketsList = buyer; 
        else ticketsList = [buyer]; 

        if (ticketsList.length === 0) { alert("A lista de ingressos deste comprador está vazia."); return; }
        
        const ownerName = buyer.name || buyer.buyer_name || buyer.first_name || 'Comprador Importado';
        if (!window.confirm(`Deseja importar ingressos de "${ownerName}"?`)) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const ticketsToSave: Ticket[] = [];
            const newSectors = new Set<string>();

            const HIGH_PRIORITY_CODE_KEYS = ['access_code', 'qr_code', 'code', 'ticket_code', 'uuid', 'barcode', 'token', 'locator', 'identifier', 'friendly_id', 'hash', 'serial', 'number', 'localizador', 'cod', 'codigo', 'id_ingresso', 'access_code', 'ticket_id', 'locator'];
            const LOW_PRIORITY_CODE_KEYS = ['id', 'pk'];
            const SECTOR_KEYS = ['sector', 'sector_name', 'section', 'product_name', 'category', 'setor', 'nome_setor'];
            const STATUS_KEYS = ['status', 'state', 'estado'];
            const DATE_KEYS = ['updated_at', 'checked_in_at', 'used_at', 'created_at', 'data_uso'];

            ticketsList.forEach((t: any) => {
                let code = findValueRecursively(t, HIGH_PRIORITY_CODE_KEYS);
                if (!code) code = findValueRecursively(t, LOW_PRIORITY_CODE_KEYS);

                if (code) {
                    let sector = findValueRecursively(t, SECTOR_KEYS);
                    let statusRaw = findValueRecursively(t, STATUS_KEYS);
                    if (t.checked_in === true) statusRaw = 'used';
                    let dateStr = findValueRecursively(t, DATE_KEYS);
                    let originalId = t.id || findValueRecursively(t, ['id', 'ticket_id']);
                    if (typeof sector === 'object' && sector && (sector as any).name) sector = (sector as any).name;
                    const idStr = String(code).trim();
                    const sectorStr = String(sector || 'Geral').trim();
                    newSectors.add(sectorStr);
                    const ticketData: Ticket = {
                        id: idStr,
                        sector: sectorStr,
                        status: (statusRaw === 'used' || statusRaw === 'checked_in' || statusRaw === 'utilizado') ? 'USED' : 'AVAILABLE',
                        details: { ownerName: ownerName, originalId: originalId || idStr },
                    };
                    if ((ticketData.status === 'USED') && dateStr) {
                         const dS = String(dateStr).replace(' ', 'T');
                         const ts = new Date(dS).getTime();
                         if (!isNaN(ts)) ticketData.usedAt = ts; else ticketData.usedAt = Date.now();
                    }
                    ticketsToSave.push(ticketData);
                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', idStr);
                    batch.set(ticketRef, { ...ticketData, usedAt: ticketData.usedAt ? Timestamp.fromMillis(ticketData.usedAt) : null }, { merge: true });
                }
            });

            if (ticketsToSave.length === 0) {
                console.log("Debug Buyer Tickets Data (Dump):", ticketsList);
                alert(`Nenhum código de ingresso válido encontrado para importar. (Erro de Formato)\n\nESTRUTURA DO PRIMEIRO ITEM (DEBUG):\n${JSON.stringify(ticketsList[0], null, 2).substring(0, 500)}...`);
                return;
            }

            const currentSectorsSet = new Set(sectorNames);
            let sectorsUpdated = false;
            newSectors.forEach(s => { if (!currentSectorsSet.has(s)) { currentSectorsSet.add(s); sectorsUpdated = true; } });
            if (sectorsUpdated) { const updatedSectorList = Array.from(currentSectorsSet); await onUpdateSectorNames(updatedSectorList); setEditableSectorNames(updatedSectorList); }
            await batch.commit();
            alert(`${ticketsToSave.length} ingressos importados com sucesso!`);
            setSearchType('TICKET_LOCAL'); setSearchQuery('');
        } catch (error) { console.error("Error importing buyer tickets", error); alert("Erro ao importar ingressos."); } finally { setIsLoading(false); }
    };

    const handleSyncExport = async () => { /* ... (Unchanged) ... */ };
    const handleImportFromApi = async () => { /* ... (Unchanged) ... */ };
    const handleSaveTickets = async () => { /* ... (Unchanged) ... */ };
    const handleDownloadReport = () => { /* ... (Unchanged) ... */ };
    const handleCreateEvent = async () => { /* ... (Unchanged) ... */ };
    const handleRenameEvent = async () => { /* ... (Unchanged) ... */ };
    const handleToggleEventVisibility = async (eventId: string, isHidden: boolean) => { /* ... (Unchanged) ... */ };
    const handleDeleteEvent = async (eventId: string, eventName: string) => { /* ... (Unchanged) ... */ };
    const handleSaveValidationConfig = async () => { /* ... (Unchanged) ... */ };
    const handleAddEndpoint = () => { /* ... (Unchanged) ... */ };
    const handleRemoveEndpoint = (index: number) => { /* ... (Unchanged) ... */ };
    const handleEndpointChange = (index: number, field: 'url' | 'token' | 'eventId', value: string) => { /* ... (Unchanged) ... */ };
    const toggleTokenVisibility = (index: number) => { /* ... (Unchanged) ... */ };
    const handleDownloadTemplate = () => { /* ... (Unchanged) ... */ };

    const handleSaveLocators = async () => {
        if (!selectedEvent) return;
        const codes = locatorCodes.split('\n').map(c => c.trim()).filter(Boolean);
        if (codes.length === 0) {
            alert("Nenhum localizador para salvar.");
            return;
        }

        setIsLoading(true);
        setLoadingMessage(`Salvando ${codes.length} localizadores...`);
        try {
            const batch = writeBatch(db);
            codes.forEach(code => {
                const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', code);
                batch.set(ticketRef, {
                    sector: 'Localizador',
                    status: 'STANDBY',
                }, { merge: true });
            });
            await batch.commit();
            alert(`${codes.length} localizadores salvos com sucesso!`);
            setLocatorCodes('');
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar localizadores.");
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
  
    const NoEventSelectedMessage = () => ( /* ... (Unchanged) ... */ );
  
    const renderContent = () => {
        // ... (Navigation logic, same as before)
        switch (activeTab) {
            case 'stats': // ... (Unchanged)
            case 'search': // ... (Unchanged)
            case 'operators': // ... (Unchanged)
            case 'settings': // ... (Unchanged)
            case 'history': // ... (Unchanged)
            case 'events': // ... (Unchanged)
            case 'users': // ... (Unchanged)
            case 'locators':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 animate-fade-in">
                        <h2 className="text-xl font-bold mb-4 flex items-center"><TicketIcon className="w-6 h-6 mr-2 text-blue-500" /> Gerenciar Localizadores (Stand-by)</h2>
                        <p className="text-sm text-gray-400 mb-4">
                            Cole uma lista de códigos (um por linha). Estes ingressos não contarão nas estatísticas até serem validados pela primeira vez.
                        </p>
                        <textarea
                            value={locatorCodes}
                            onChange={(e) => setLocatorCodes(e.target.value)}
                            placeholder="ABC-123&#10;DEF-456&#10;GHI-789"
                            className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white font-mono h-60"
                        />
                        <button
                            onClick={handleSaveLocators}
                            disabled={isLoading}
                            className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded"
                        >
                            {isLoading ? loadingMessage : 'Salvar Localizadores'}
                        </button>
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
                 <button onClick={() => setActiveTab('locators')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors flex items-center ${activeTab === 'locators' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}><TicketIcon className="w-4 h-4 mr-2"/>Localizadores</button>
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

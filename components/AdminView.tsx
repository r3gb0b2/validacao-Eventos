
import React, { useState, useEffect, useMemo } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, collection, writeBatch, doc, addDoc, updateDoc, setDoc, deleteDoc, Timestamp, getDoc } from 'firebase/firestore';
import { CloudDownloadIcon, CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, CogIcon, LinkIcon, SearchIcon, CheckCircleIcon, XCircleIcon, AlertTriangleIcon, ClockIcon } from './Icons';
import Papa from 'papaparse';

interface AdminViewProps {
  db: Firestore;
  events: Event[];
  selectedEvent: Event | null;
  allTickets: Ticket[];
  scanHistory: DisplayableScanLog[];
  sectorNames: string[];
  onUpdateSectorNames: (newNames: string[]) => Promise<void>;
  isOnline: boolean;
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

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, onUpdateSectorNames, isOnline }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events' | 'search'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
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
    const [ignoreExisting, setIgnoreExisting] = useState(false); // New state for skipping existing tickets

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
    }, [sectorNames]);

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
        // Safeguard: Filter valid scans with valid timestamps
        const validScans = scanHistory.filter(s => s.status === 'VALID' && s.timestamp && !isNaN(Number(s.timestamp)));
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
        const TEN_MINUTES_MS = 10 * 60 * 1000;

        for (const scan of validScans) {
            const bucketStart = Math.floor(scan.timestamp / TEN_MINUTES_MS) * TEN_MINUTES_MS;
            const date = new Date(bucketStart);
            // Check if date is valid
            if (isNaN(date.getTime())) continue;

            const key = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            
            if (!buckets.has(key)) {
                const initialCounts = sectorNames.reduce((acc, name) => ({ ...acc, [name]: 0 }), {});
                buckets.set(key, initialCounts);
            }
            const currentBucket = buckets.get(key)!;
            currentBucket[scan.ticketSector] = (currentBucket[scan.ticketSector] || 0) + 1;
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
    }, [scanHistory, sectorNames]);

     const pieChartData = useMemo(() => {
        const usedTickets = allTickets.filter(t => t.status === 'USED');
        if (usedTickets.length === 0) return [];
        
        const counts = sectorNames.reduce((acc, sector) => {
            acc[sector] = usedTickets.filter(t => t.sector === sector).length;
            return acc;
        }, {} as Record<string, number>);

        return sectorNames.map((name, index) => ({
            name: name,
            value: counts[name],
            color: PIE_CHART_COLORS[index % PIE_CHART_COLORS.length],
        })).filter(item => item.value > 0);
    }, [allTickets, sectorNames]);

    const handleSaveSectorNames = async () => {
        if (editableSectorNames.some(name => name.trim() === '')) {
            alert('O nome de um setor não pode estar em branco.');
            return;
        }
        setIsSavingSectors(true);
        try {
            await onUpdateSectorNames(editableSectorNames);
            alert('Nomes dos setores salvos com sucesso!');
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

    const handleAddSector = () => {
        setEditableSectorNames([...editableSectorNames, `Novo Setor ${editableSectorNames.length + 1}`]);
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
    
    // Search handler
    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        if (searchType === 'TICKET_LOCAL') {
            // Find ticket info
            const ticket = allTickets.find(t => t.id === searchQuery.trim());
            
            // Find scan logs for this ticket
            const logs = scanHistory.filter(l => l.ticketId === searchQuery.trim());
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
                // Construct URL to /buyers endpoint
                let buyersUrl = apiUrl.trim();
                if (!buyersUrl.includes('/buyers')) {
                    // Try to guess base URL from configuration or default
                    const urlObj = new URL(buyersUrl || 'https://public-api.stingressos.com.br/tickets');
                    buyersUrl = `${urlObj.origin}/buyers`;
                }
                
                // Append Query
                const searchUrl = `${buyersUrl}?search=${encodeURIComponent(searchQuery)}${apiEventId ? `&event_id=${apiEventId}` : ''}`;
                
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
                
                setBuyerSearchResults(results);
                if (results.length === 0) alert("Nenhum comprador encontrado com esse termo.");

            } catch (error) {
                console.error(error);
                alert(`Erro na busca: ${error instanceof Error ? error.message : 'Desconhecido'}`);
            } finally {
                setIsLoading(false);
            }
        }
    };
    
    // Import tickets from a specific buyer found in search
    const handleImportSingleBuyer = async (buyer: any) => {
        if (!selectedEvent || !buyer.tickets || buyer.tickets.length === 0) return;
        
        const confirmMsg = `Deseja importar ${buyer.tickets.length} ingressos de "${buyer.name || 'Comprador'}" para o sistema local?`;
        if (!window.confirm(confirmMsg)) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const ticketsToSave: Ticket[] = [];
            const newSectors = new Set<string>();
            const ownerName = buyer.name || buyer.buyer_name || '';

            buyer.tickets.forEach((t: any) => {
                const code = t.code || t.qr_code || t.ticket_code || t.id;
                let sector = t.sector || t.sector_name || t.section || t.product_name || 'Geral';
                if (typeof sector === 'object' && sector.name) sector = sector.name;

                if (code) {
                    const idStr = String(code);
                    const sectorStr = String(sector);
                    
                    newSectors.add(sectorStr);
                    ticketsToSave.push({
                        id: idStr,
                        sector: sectorStr,
                        status: (t.status === 'used' || t.status === 'checked_in') ? 'USED' : 'AVAILABLE',
                        details: { 
                            ownerName: ownerName,
                            originalId: t.id // Capture ID
                        },
                        usedAt: (t.status === 'used' && t.updated_at) ? new Date(t.updated_at).getTime() : undefined
                    });

                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', idStr);
                    batch.set(ticketRef, {
                        sector: sectorStr,
                        status: (t.status === 'used' || t.status === 'checked_in') ? 'USED' : 'AVAILABLE',
                        details: { 
                            ownerName: ownerName,
                            originalId: t.id
                        },
                        usedAt: (t.status === 'used' && t.updated_at) ? Timestamp.fromDate(new Date(t.updated_at)) : null
                    }, { merge: true });
                }
            });

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
            
            // Clear search to show updated local state (optional, or just alert)
            setSearchType('TICKET_LOCAL'); // Switch to local search to encourage checking
            setSearchQuery(''); // Clear query

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

                    // Add delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const response = await fetch(fetchUrl, { headers });
                    if (!response.ok) {
                        // 404 on page > 1 usually means end of list for some APIs
                        if (response.status === 404 && page > 1) {
                            hasMore = false;
                            break;
                        }
                        throw new Error(`Erro HTTP ${response.status} na página ${page}`);
                    }

                    const jsonResponse = await response.json();
                    
                    // Intelligent Data Extraction
                    let pageItems: any[] = [];
                    let meta: any = null;

                    // Check common patterns
                    if (Array.isArray(jsonResponse)) {
                        pageItems = jsonResponse;
                    } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
                        pageItems = jsonResponse.data;
                        meta = jsonResponse; // Laravel paginated often has meta at root or inside data
                        if (jsonResponse.meta) meta = jsonResponse.meta;
                    } else if (jsonResponse.items && Array.isArray(jsonResponse.items)) {
                        pageItems = jsonResponse.items;
                        meta = jsonResponse;
                    } else if (jsonResponse.tickets && Array.isArray(jsonResponse.tickets)) {
                        pageItems = jsonResponse.tickets;
                        meta = jsonResponse;
                    } else {
                        // Fallback: find first array
                        const keys = Object.keys(jsonResponse);
                        for (const k of keys) {
                            if (Array.isArray(jsonResponse[k])) {
                                pageItems = jsonResponse[k];
                                break;
                            }
                        }
                    }

                    if (!pageItems || pageItems.length === 0) {
                        hasMore = false;
                        break;
                    }

                    // Try to find Total / Last Page info to be smarter
                    if (!totalRecords) {
                        if (meta?.total) totalRecords = meta.total;
                        else if (meta?.meta?.total) totalRecords = meta.meta.total;
                        else if (jsonResponse.total) totalRecords = jsonResponse.total;
                    }
                    
                    let lastPage = 0;
                    if (meta?.last_page) lastPage = meta.last_page;
                    else if (jsonResponse.last_page) lastPage = jsonResponse.last_page;

                    // Add items
                    let newItemsOnPage = 0;
                    pageItems.forEach((item: any) => {
                        const id = item.id || item.code || item.qr_code || item.ticket_code || item.uuid || JSON.stringify(item);
                        const idStr = String(id);
                        
                        if (!seenIds.has(idStr)) {
                            seenIds.add(idStr);
                            allItems.push(item);
                            newItemsOnPage++;
                        }
                    });

                    // Logic to stop or continue
                    if (newItemsOnPage === 0 && pageItems.length > 0) {
                        // We received items, but we had already seen all of them. 
                        // This implies the API is returning the same page repeatedly (ignoring page param).
                        console.warn("Detectado loop de paginação (itens duplicados). Parando.");
                        hasMore = false;
                    } else {
                        // Check termination conditions
                        if (lastPage > 0 && page >= lastPage) {
                            hasMore = false;
                        } else if (totalRecords > 0 && allItems.length >= totalRecords) {
                            hasMore = false;
                        } else if (pageItems.length < (BATCH_LIMIT / 2) && totalRecords === 0) {
                             if (pageItems.length < BATCH_LIMIT) hasMore = false;
                        }
                        
                        // Failsafe: Stop at 500 pages (100k items)
                        if (page >= 500) hasMore = false;
                    }

                    page++;
                }

                if (allItems.length === 0) {
                    alert('Nenhum registro encontrado. Verifique o ID do Evento e o Token.');
                    setIsLoading(false);
                    return;
                }

                // Process Items
                if (importType === 'checkins' || apiUrl.includes('checkins')) {
                    allItems.forEach((item: any) => {
                        const code = item.ticket_code || item.ticket_id || item.code || item.qr_code;
                        const timestampStr = item.created_at || item.checked_in_at || item.timestamp;
                        if (code) {
                            // FIX FOR SAFARI: Replace space with T for ISO format
                            const usedAt = timestampStr 
                                ? new Date(String(timestampStr).replace(' ', 'T')).getTime() 
                                : Date.now();
                            
                            if (!isNaN(usedAt)) {
                                ticketsToUpdateStatus.push({ id: String(code), usedAt });
                            }
                        }
                    });
                } else {
                    const processItem = (item: any) => {
                        const code = item.code || item.qr_code || item.ticket_code || item.barcode || item.id;
                        let sector = item.sector || item.sector_name || item.section || item.setor || item.category || item.ticket_name || item.product_name || 'Geral';
                        if (typeof sector === 'object' && sector.name) sector = sector.name;
                        const ownerName = item.owner_name || item.name || item.participant_name || item.client_name || item.buyer_name || '';

                        if (item.tickets && Array.isArray(item.tickets)) {
                            item.tickets.forEach((subTicket: any) => {
                                if (!subTicket.owner_name && ownerName) subTicket.owner_name = ownerName;
                                processItem(subTicket);
                            });
                            return;
                        }

                        if (code) {
                            const idStr = String(code);
                            if (ignoreExisting && existingTicketIds.has(idStr)) {
                                return; // Skip existing in API mode
                            }

                            newSectors.add(String(sector));
                            ticketsToSave.push({
                                id: idStr,
                                sector: String(sector),
                                status: 'AVAILABLE',
                                details: { 
                                    ownerName: String(ownerName),
                                    originalId: item.id // SAVE ORIGINAL ID FOR SYNC
                                }
                            });
                        }
                    };
                    allItems.forEach(processItem);
                }
            }

            // --- SAVE TO FIRESTORE ---
            
            if (ticketsToSave.length > 0) {
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
            }

            const BATCH_SIZE = 450;
            let savedCount = 0;
            let updatedCount = 0;

            if (ticketsToSave.length > 0) {
                setLoadingMessage(`Salvando ${ticketsToSave.length} ingressos (Novos)...`);
                 const chunks = [];
                for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                    chunks.push(ticketsToSave.slice(i, i + BATCH_SIZE));
                }

                for (const chunk of chunks) {
                    const batch = writeBatch(db);
                    chunk.forEach(ticket => {
                        const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', ticket.id);
                        batch.set(ticketRef, {
                            sector: ticket.sector,
                            details: ticket.details,
                            status: ticket.status // Ensure status is set for new tickets
                        }, { merge: true });
                    });
                    await batch.commit();
                    savedCount += chunk.length;
                }
            }

            if (ticketsToUpdateStatus.length > 0) {
                setLoadingMessage('Sincronizando check-ins...');
                const chunks = [];
                for (let i = 0; i < ticketsToUpdateStatus.length; i += BATCH_SIZE) {
                    chunks.push(ticketsToUpdateStatus.slice(i, i + BATCH_SIZE));
                }
                
                for (const chunk of chunks) {
                     const batch = writeBatch(db);
                     chunk.forEach(updateItem => {
                         const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', updateItem.id);
                         batch.set(ticketRef, {
                             status: 'USED',
                             usedAt: Timestamp.fromMillis(updateItem.usedAt)
                         }, { merge: true });
                     });
                     await batch.commit();
                     updatedCount += chunk.length;
                }
            }

            let msg = 'Processo concluído!\n';
            if (savedCount > 0) msg += `- ${savedCount} novos ingressos importados.\n`;
            else if (ticketsToSave.length === 0 && allItems.length > 0 && ignoreExisting) msg += `- Todos os ingressos baixados já existiam no sistema.\n`;
            
            if (updatedCount > 0) msg += `- ${updatedCount} ingressos marcados como utilizados.\n`;
            
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

                        {/* Main Stats Component (KPIs + Table) */}
                        <Stats allTickets={allTickets} sectorNames={sectorNames} />

                        {/* Charts Section */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                             <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <PieChart data={pieChartData} title="Distribuição por Setor"/>
                            </div>
                            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                            </div>
                        </div>

                        {/* Temporal Analysis Cards */}
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
                            <h2 className="text-xl font-bold mb-4 flex items-center">
                                <SearchIcon className="w-6 h-6 mr-2 text-blue-500" />
                                Consultar
                            </h2>
                            
                            {/* Toggle Switch */}
                            <div className="flex bg-gray-700 rounded-lg p-1 mb-4">
                                <button 
                                    onClick={() => setSearchType('TICKET_LOCAL')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                                        searchType === 'TICKET_LOCAL' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                    Código do Ingresso (Local)
                                </button>
                                <button 
                                    onClick={() => setSearchType('BUYER_API')}
                                    className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${
                                        searchType === 'BUYER_API' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                    Buscar Comprador (API Online)
                                </button>
                            </div>

                            <div className="flex space-x-2">
                                <input 
                                    type="text" 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={searchType === 'TICKET_LOCAL' ? "Digite o código do ingresso..." : "Nome, E-mail ou CPF do comprador..."}
                                    className="flex-grow bg-gray-900 border border-gray-600 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                                <button 
                                    onClick={handleSearch}
                                    disabled={isLoading}
                                    className={`${searchType === 'TICKET_LOCAL' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white font-bold px-6 rounded transition-colors disabled:opacity-50`}
                                >
                                    {isLoading ? 'Buscando...' : 'Buscar'}
                                </button>
                            </div>
                            {searchType === 'BUYER_API' && (
                                <p className="text-[10px] text-gray-500 mt-2">* Requer Token da API configurado na aba de Importação.</p>
                            )}
                        </div>

                        {/* Local Search Result */}
                        {searchType === 'TICKET_LOCAL' && searchResult && (
                            <div className="animate-fade-in space-y-4">
                                {/* Ticket Details Card */}
                                <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
                                    <div className="bg-gray-700 px-6 py-4 border-b border-gray-600">
                                        <h3 className="font-bold text-lg">Detalhes do Ingresso</h3>
                                    </div>
                                    <div className="p-6">
                                        {searchResult.ticket ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div>
                                                    <p className="text-gray-400 text-sm uppercase font-bold">Código</p>
                                                    <p className="text-xl text-white font-mono">{searchResult.ticket.id}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400 text-sm uppercase font-bold">Status Atual</p>
                                                    <div className="flex items-center mt-1">
                                                        {searchResult.ticket.status === 'USED' ? (
                                                            <>
                                                                <AlertTriangleIcon className="w-5 h-5 text-yellow-500 mr-2" />
                                                                <span className="text-yellow-400 font-bold">JÁ UTILIZADO</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckCircleIcon className="w-5 h-5 text-green-500 mr-2" />
                                                                <span className="text-green-400 font-bold">DISPONÍVEL</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400 text-sm uppercase font-bold">Setor</p>
                                                    <p className="text-white text-lg">{searchResult.ticket.sector}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-400 text-sm uppercase font-bold">Nome do Dono</p>
                                                    <p className="text-white text-lg">{searchResult.ticket.details?.ownerName || '-'}</p>
                                                </div>
                                                {searchResult.ticket.status === 'USED' && (
                                                    <div className="md:col-span-2 bg-gray-700/30 p-3 rounded border border-gray-600/50">
                                                         <p className="text-gray-400 text-xs uppercase font-bold mb-1">Horário da Validação (Acesso)</p>
                                                         <div className="flex items-center text-yellow-400">
                                                             <ClockIcon className="w-5 h-5 mr-2" />
                                                             <p className="text-xl font-mono font-bold">
                                                                {searchResult.ticket.usedAt 
                                                                    ? new Date(searchResult.ticket.usedAt).toLocaleString('pt-BR') 
                                                                    : 'Horário não registrado'}
                                                             </p>
                                                         </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-center py-4">
                                                <XCircleIcon className="w-12 h-12 text-red-500 mx-auto mb-2" />
                                                <p className="text-red-400 font-bold text-lg">Ingresso não encontrado na base de dados.</p>
                                                <p className="text-gray-400 text-sm mt-1">Verifique se o código está correto ou se foi importado.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Validation History Timeline */}
                                <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6">
                                    <h3 className="font-bold text-lg mb-4">Histórico de Tentativas</h3>
                                    
                                    {searchResult.logs.length > 0 ? (
                                        <div className="relative border-l-2 border-gray-600 ml-3 pl-6 space-y-6">
                                            {searchResult.logs.map((log, index) => (
                                                <div key={index} className="relative">
                                                    <div className={`absolute -left-[31px] w-4 h-4 rounded-full border-2 border-gray-800 ${
                                                        log.status === 'VALID' ? 'bg-green-500' :
                                                        log.status === 'USED' ? 'bg-yellow-500' : 'bg-red-500'
                                                    }`}></div>
                                                    <div>
                                                        <p className="text-sm text-gray-400">
                                                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                                                        </p>
                                                        <p className={`font-bold ${
                                                            log.status === 'VALID' ? 'text-green-400' :
                                                            log.status === 'USED' ? 'text-yellow-400' : 'text-red-400'
                                                        }`}>
                                                            {log.status === 'VALID' ? 'Acesso Liberado' :
                                                             log.status === 'USED' ? 'Tentativa de Reuso' : 
                                                             log.status === 'WRONG_SECTOR' ? 'Setor Incorreto' : 'Inválido'}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            Setor Lido: {log.ticketSector} | Device: {log.deviceId ? log.deviceId.substr(0,8) : 'N/A'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-gray-500 text-center italic">Nenhuma tentativa de validação registrada para este código.</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* API Buyer Search Result */}
                        {searchType === 'BUYER_API' && buyerSearchResults.length > 0 && (
                            <div className="animate-fade-in space-y-4">
                                {buyerSearchResults.map((buyer, idx) => (
                                    <div key={idx} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden border border-gray-700">
                                        <div className="bg-purple-900/30 px-6 py-4 border-b border-gray-600 flex justify-between items-center flex-wrap gap-2">
                                            <h3 className="font-bold text-lg text-purple-300">
                                                {buyer.name || buyer.buyer_name || "Comprador Desconhecido"}
                                            </h3>
                                            {(buyer.tickets && buyer.tickets.length > 0) && (
                                                <button 
                                                    onClick={() => handleImportSingleBuyer(buyer)}
                                                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold flex items-center shadow"
                                                >
                                                    <CloudDownloadIcon className="w-3 h-3 mr-1" />
                                                    Importar Ingressos deste Comprador
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-6">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                                <div>
                                                    <p className="text-xs text-gray-500 uppercase">Email</p>
                                                    <p className="text-white">{buyer.email || '-'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-gray-500 uppercase">CPF</p>
                                                    <p className="text-white">{buyer.cpf || buyer.document || '-'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-gray-500 uppercase">Telefone</p>
                                                    <p className="text-white">{buyer.phone || buyer.whatsapp || '-'}</p>
                                                </div>
                                            </div>
                                            
                                            <div className="border-t border-gray-700 pt-4">
                                                <h4 className="text-sm font-bold text-gray-300 mb-2">Ingressos Associados (API)</h4>
                                                {(buyer.tickets && buyer.tickets.length > 0) ? (
                                                    <ul className="space-y-2">
                                                        {buyer.tickets.map((t: any, tIdx: number) => (
                                                            <li key={tIdx} className="bg-gray-700/50 p-3 rounded flex justify-between items-center">
                                                                <div>
                                                                    <div className="flex items-center space-x-2">
                                                                         <p className="font-mono font-bold text-sm text-white">{t.code || t.qr_code || t.ticket_code}</p>
                                                                         <span className="text-xs bg-gray-600 px-1 rounded text-gray-300">
                                                                             {t.id ? `ID: ${t.id}` : ''}
                                                                         </span>
                                                                    </div>
                                                                    <p className="text-xs text-gray-400">{t.sector_name || t.sector || t.product_name || 'Setor Geral'}</p>
                                                                </div>
                                                                <span className={`text-xs px-2 py-1 rounded font-bold ${
                                                                    t.status === 'used' || t.status === 'checked_in' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                                                                }`}>
                                                                    {t.status === 'used' || t.status === 'checked_in' ? 'UTILIZADO' : 'VÁLIDO'}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-xs text-gray-500 italic">Nenhum ingresso listado neste objeto de comprador.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            case 'settings':
                 if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left Column */}
                        <div className="space-y-6">
                             {/* Operation Mode */}
                             <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-bold mb-4 text-orange-400 flex items-center">
                                    <CogIcon className="w-5 h-5 mr-2" />
                                    Modo de Operação (Validação)
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex flex-col space-y-2">
                                        <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition">
                                            <input 
                                                type="radio" 
                                                name="validationMode" 
                                                value="OFFLINE" 
                                                checked={validationMode === 'OFFLINE'}
                                                onChange={() => setValidationMode('OFFLINE')}
                                                className="mr-3 h-4 w-4 text-orange-600"
                                            />
                                            <div>
                                                <span className="font-bold text-white">Offline (Banco de Dados Local)</span>
                                                <p className="text-xs text-gray-400">Requer importação prévia. Funciona sem internet.</p>
                                            </div>
                                        </label>

                                        <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition">
                                            <input 
                                                type="radio" 
                                                name="validationMode" 
                                                value="ONLINE_API" 
                                                checked={validationMode === 'ONLINE_API'}
                                                onChange={() => setValidationMode('ONLINE_API')}
                                                className="mr-3 h-4 w-4 text-orange-600"
                                            />
                                             <div>
                                                <span className="font-bold text-white">Online (API em Tempo Real)</span>
                                                <p className="text-xs text-gray-400">Valida direto na API Externa. Requer internet.</p>
                                            </div>
                                        </label>
                                        
                                         <label className="flex items-center p-3 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition">
                                            <input 
                                                type="radio" 
                                                name="validationMode" 
                                                value="ONLINE_SHEETS" 
                                                checked={validationMode === 'ONLINE_SHEETS'}
                                                onChange={() => setValidationMode('ONLINE_SHEETS')}
                                                className="mr-3 h-4 w-4 text-orange-600"
                                            />
                                             <div>
                                                <span className="font-bold text-white">Online (Google Sheets)</span>
                                                <p className="text-xs text-gray-400">Valida direto na planilha. Requer internet.</p>
                                            </div>
                                        </label>
                                    </div>

                                    {/* Config for Online API */}
                                    {validationMode === 'ONLINE_API' && (
                                        <div className="mt-4 pl-4 border-l-2 border-orange-500/50">
                                            <h4 className="text-sm font-bold text-white mb-2">Endpoints da API</h4>
                                            {onlineApiEndpoints.map((endpoint, idx) => (
                                                <div key={idx} className="bg-gray-900/50 p-3 rounded mb-2 space-y-2 relative">
                                                    <button onClick={() => handleRemoveEndpoint(idx)} className="absolute top-2 right-2 text-gray-500 hover:text-red-400">
                                                        &times;
                                                    </button>
                                                    <input
                                                        type="text"
                                                        value={endpoint.url}
                                                        onChange={(e) => handleEndpointChange(idx, 'url', e.target.value)}
                                                        placeholder="URL da API (https://...)"
                                                        className="w-full bg-gray-700 p-2 rounded text-sm"
                                                    />
                                                    <div className="relative">
                                                        <input
                                                            type={visibleTokens[idx] ? "text" : "password"}
                                                            value={endpoint.token}
                                                            onChange={(e) => handleEndpointChange(idx, 'token', e.target.value)}
                                                            placeholder="Token (Bearer)"
                                                            className="w-full bg-gray-700 p-2 rounded text-sm pr-10"
                                                        />
                                                        <button 
                                                            onClick={() => toggleTokenVisibility(idx)}
                                                            className="absolute right-2 top-2 text-gray-400 hover:text-white"
                                                        >
                                                            {visibleTokens[idx] ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                                                        </button>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={endpoint.eventId}
                                                        onChange={(e) => handleEndpointChange(idx, 'eventId', e.target.value)}
                                                        placeholder="ID do Evento (Obrigatório)"
                                                        className={`w-full bg-gray-700 p-2 rounded text-sm ${!endpoint.eventId ? 'border border-red-500/50' : ''}`}
                                                    />
                                                    {!endpoint.eventId && <p className="text-[10px] text-red-400">ID do evento é necessário para validação online.</p>}
                                                </div>
                                            ))}
                                            <button onClick={handleAddEndpoint} className="text-xs text-orange-400 hover:underline">+ Adicionar outro endpoint</button>
                                        </div>
                                    )}
                                    
                                    {/* Config for Online Sheets */}
                                    {validationMode === 'ONLINE_SHEETS' && (
                                        <div className="mt-4 pl-4 border-l-2 border-orange-500/50">
                                            <label className="text-xs text-gray-400 block mb-1">Link CSV da Planilha</label>
                                            <input
                                                type="text"
                                                value={onlineSheetUrl}
                                                onChange={(e) => setOnlineSheetUrl(e.target.value)}
                                                placeholder="https://docs.google.com/spreadsheets/.../pub?output=csv"
                                                className="w-full bg-gray-700 p-2 rounded text-sm mb-2"
                                            />
                                             <button onClick={handleDownloadTemplate} className="text-xs text-blue-400 hover:underline flex items-center mb-2">
                                                <CloudDownloadIcon className="w-3 h-3 mr-1" />
                                                Baixar Modelo de Planilha (.csv)
                                            </button>
                                        </div>
                                    )}

                                    <button 
                                        onClick={handleSaveValidationConfig}
                                        className="w-full bg-green-600 hover:bg-green-700 py-2 rounded font-bold mt-2"
                                    >
                                        Salvar Configuração de Modo
                                    </button>
                                </div>
                             </div>
                             
                             {/* Sector Names */}
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                <h3 className="text-lg font-bold mb-3">Nomes dos Setores</h3>
                                 <div className="space-y-3 mb-4">
                                    {editableSectorNames.map((name, index) => (
                                        <div key={index} className="flex items-center space-x-2">
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => handleSectorNameChange(index, e.target.value)}
                                            className="flex-grow bg-gray-700 p-2 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                        <button
                                            onClick={() => handleRemoveSector(index)}
                                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded disabled:bg-gray-500"
                                            disabled={editableSectorNames.length <= 1}
                                        >
                                            &times;
                                        </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex space-x-2">
                                    <button onClick={handleAddSector} className="flex-1 bg-gray-600 hover:bg-gray-700 py-2 rounded font-bold text-sm">
                                        + Setor
                                    </button>
                                    <button
                                        onClick={handleSaveSectorNames}
                                        disabled={isSavingSectors || isLoading}
                                        className="flex-1 bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 text-sm"
                                    >
                                        Salvar
                                    </button>
                                </div>
                            </div>

                            {/* Manual Code Entry Block */}
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3 flex items-center">
                                    <TableCellsIcon className="w-5 h-5 mr-2 text-green-400" />
                                    Adicionar Códigos por Lista (Manual)
                                </h3>
                                <p className="text-xs text-gray-400 mb-3">
                                    Cole os códigos dos ingressos abaixo (um por linha). Eles serão salvos no banco de dados.
                                </p>
                                
                                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                                    {sectorNames.map((sector) => (
                                        <div key={sector}>
                                            <label className="block text-xs font-bold text-gray-300 mb-1 uppercase">{sector}</label>
                                            <textarea
                                                value={ticketCodes[sector] || ''}
                                                onChange={(e) => handleTicketCodeChange(sector, e.target.value)}
                                                placeholder={`Cole os códigos do setor ${sector} aqui...`}
                                                className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                            />
                                        </div>
                                    ))}
                                </div>
                                
                                <button
                                    onClick={handleSaveTickets}
                                    disabled={isLoading}
                                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 py-2 rounded font-bold disabled:bg-gray-500 text-sm shadow-lg transition-transform transform active:scale-95"
                                >
                                    Salvar Lista de Códigos
                                </button>
                            </div>
                        </div>
                        
                        {/* Right Column: Import */}
                        <div className="space-y-6">
                             {/* CSV Upload Local (New) */}
                            <div className="bg-gray-800 p-5 rounded-lg border border-gray-700">
                                <h3 className="text-lg font-bold mb-3 flex items-center">
                                    <TableCellsIcon className="w-5 h-5 mr-2 text-blue-400" />
                                    Upload Arquivo CSV
                                </h3>
                                <p className="text-xs text-gray-400 mb-2">Selecione um arquivo .csv do seu computador para importar ingressos.</p>
                                <input 
                                    type="file" 
                                    accept=".csv"
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                            // Read file
                                            const reader = new FileReader();
                                            reader.onload = async (event) => {
                                                const text = event.target?.result;
                                                if (typeof text === 'string') {
                                                    // Simulate API url setting but treat as local content
                                                    const blob = new Blob([text], { type: 'text/csv' });
                                                    const url = URL.createObjectURL(blob);
                                                    setImportType('google_sheets'); // Reuse CSV parser
                                                    setApiUrl(url);
                                                }
                                            };
                                            reader.readAsText(e.target.files[0]);
                                        }
                                    }}
                                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600"
                                />
                            </div>

                            <div className="bg-gray-800 p-5 rounded-lg border border-orange-500/30 shadow-lg">
                                <h3 className="text-lg font-bold mb-3 text-orange-400 flex items-center">
                                    <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                    Importar Dados (Modo Offline)
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-end">
                                        <div className="w-full mr-2">
                                            <label className="text-xs text-gray-400">Carregar Configuração Salva</label>
                                            <div className="flex space-x-1">
                                                <select 
                                                    value={selectedPresetId} 
                                                    onChange={handlePresetChange}
                                                    className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                                >
                                                    <option value="">Selecione...</option>
                                                    {importPresets.map((p, i) => <option key={i} value={p.name}>{p.name}</option>)}
                                                </select>
                                                <button onClick={handleDeletePreset} disabled={!selectedPresetId} className="bg-red-600 px-2 rounded disabled:opacity-50"><TrashIcon className="w-4 h-4"/></button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs text-gray-400">Tipo de Importação</label>
                                        <select
                                            value={importType}
                                            onChange={(e) => handleImportTypeChange(e.target.value as ImportType)}
                                            className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm mb-2"
                                        >
                                            <option value="tickets">Ingressos (API Padrão)</option>
                                            <option value="participants">Participantes (API)</option>
                                            <option value="buyers">Compradores (API)</option>
                                            <option value="checkins">Sincronizar Check-ins (API)</option>
                                            <option value="google_sheets">Google Sheets (Link CSV)</option>
                                        </select>
                                        
                                        {importType === 'google_sheets' && (
                                            <div className="bg-blue-900/40 p-3 rounded mb-2 border border-blue-500/30">
                                                 <button onClick={handleDownloadTemplate} className="text-xs text-blue-300 hover:underline flex items-center float-right">
                                                    <CloudDownloadIcon className="w-3 h-3 mr-1" /> Modelo
                                                </button>
                                                <p className="text-xs text-blue-200 mb-1 font-bold">Como usar Google Sheets:</p>
                                                <ol className="text-xs text-gray-300 list-decimal list-inside space-y-1">
                                                    <li>Arquivo {'>'} Compartilhar {'>'} Publicar na Web.</li>
                                                    <li>Formato: <strong>CSV</strong>. Copie o link.</li>
                                                </ol>
                                            </div>
                                        )}

                                        <label className="text-xs text-gray-400">
                                            {importType === 'google_sheets' ? 'Link Público do CSV' : 'URL da API'}
                                        </label>
                                        <input
                                            type="text"
                                            value={apiUrl}
                                            onChange={(e) => setApiUrl(e.target.value)}
                                            placeholder="https://..."
                                            className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                        />
                                    </div>
                                    
                                    {importType !== 'google_sheets' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="relative">
                                                <label className="text-xs text-gray-400">Token (Bearer)</label>
                                                <input
                                                    type={showImportToken ? "text" : "password"}
                                                    value={apiToken}
                                                    onChange={(e) => setApiToken(e.target.value)}
                                                    className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm pr-8"
                                                />
                                                 <button 
                                                    onClick={() => setShowImportToken(!showImportToken)}
                                                    className="absolute right-2 top-8 text-gray-400 hover:text-white"
                                                >
                                                    {showImportToken ? <EyeSlashIcon className="w-3 h-3"/> : <EyeIcon className="w-3 h-3"/>}
                                                </button>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-400">ID Evento (Numérico)</label>
                                                <input
                                                    type="text"
                                                    value={apiEventId}
                                                    onChange={(e) => setApiEventId(e.target.value)}
                                                    className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-sm"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center my-2 bg-gray-700 p-2 rounded">
                                        <input
                                            type="checkbox"
                                            id="ignoreExisting"
                                            checked={ignoreExisting}
                                            onChange={(e) => setIgnoreExisting(e.target.checked)}
                                            className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                                        />
                                        <label htmlFor="ignoreExisting" className="ml-2 text-xs text-gray-200 cursor-pointer select-none">
                                            Ignorar ingressos já importados (Mais rápido)
                                        </label>
                                    </div>
                                    
                                    <div className="flex space-x-2 pt-2">
                                         <button
                                            onClick={handleImportFromApi}
                                            disabled={isLoading}
                                            className="flex-grow bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:bg-gray-500 flex justify-center items-center text-sm"
                                        >
                                            {isLoading ? (loadingMessage || 'Processando...') : 'Importar Agora'}
                                        </button>
                                        {importType !== 'google_sheets' && (
                                            <button
                                                onClick={handleSavePreset}
                                                className="px-3 bg-gray-600 hover:bg-gray-500 rounded text-xs font-bold"
                                                title="Salvar na Lista"
                                            >
                                                Salvar Lista
                                            </button>
                                        )}
                                    </div>
                                    {importType !== 'google_sheets' && (
                                        <div className="text-center mt-1">
                                             <button onClick={handleSaveImportCredentials} className="text-xs text-gray-500 hover:text-gray-300 underline">
                                                Salvar apenas credenciais (Token/ID) como padrão
                                            </button>
                                        </div>
                                    )}
                                    {/* Sync Export Button */}
                                    <div className="mt-4 pt-4 border-t border-gray-700">
                                        <button 
                                            onClick={handleSyncExport}
                                            disabled={isLoading}
                                            className="w-full bg-gray-700 hover:bg-gray-600 text-orange-400 py-2 rounded text-sm font-bold flex items-center justify-center border border-orange-500/30"
                                        >
                                            <CloudUploadIcon className="w-4 h-4 mr-2" />
                                            Enviar Validações para ST / API
                                        </button>
                                        <p className="text-[10px] text-gray-500 text-center mt-1">
                                            Sincroniza ingressos usados localmente com a API externa.
                                        </p>
                                    </div>
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
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                <h3 className="text-lg font-bold mb-3">Criar Novo Evento</h3>
                                <div className="space-y-3">
                                    <input type="text" value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Nome do Evento" className="w-full bg-gray-700 p-3 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                                    <button onClick={handleCreateEvent} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-3 rounded font-bold disabled:bg-gray-500">Criar Evento</button>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 p-5 rounded-lg shadow-lg">
                                <h3 className="text-lg font-bold mb-3">Lista de Eventos</h3>
                                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {events.map(event => (
                                        <div key={event.id} className="flex items-center justify-between bg-gray-700 p-3 rounded hover:bg-gray-600 transition-colors">
                                            <span className={`font-medium ${event.isHidden ? 'text-gray-500 italic' : 'text-white'}`}>{event.name}</span>
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleToggleEventVisibility(event.id, event.isHidden || false)} className="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded border border-gray-500">
                                                    {event.isHidden ? 'Mostrar' : 'Ocultar'}
                                                </button>
                                                <button onClick={() => handleDeleteEvent(event.id, event.name)} className="text-xs px-3 py-1 bg-red-600 hover:bg-red-500 rounded">
                                                    Apagar
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {events.length === 0 && <p className="text-gray-500 text-sm text-center py-4">Nenhum evento criado.</p>}
                                </div>
                            </div>

                             {selectedEvent && (
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
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-2 custom-scrollbar border border-gray-700">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'stats' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Dashboard</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'settings' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Configurações</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'history' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Histórico</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'events' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Eventos</button>
                <button onClick={() => setActiveTab('search')} className={`px-4 py-2 rounded-md font-bold whitespace-nowrap transition-colors ${activeTab === 'search' ? 'bg-orange-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}>Consultar</button>
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;


import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, writeBatch, doc, setDoc, addDoc, collection, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { CloudDownloadIcon, TableCellsIcon, CogIcon, EyeIcon, EyeSlashIcon } from './Icons';
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
type ValidationMode = 'OFFLINE' | 'ONLINE';

interface ApiEndpoint {
    id: string;
    name: string;
    url: string;
    token: string;
    customEventId: string;
}

const AdminView: React.FC<AdminViewProps> = ({ db, events, selectedEvent, allTickets, scanHistory, sectorNames, onUpdateSectorNames, isOnline }) => {
    const [activeTab, setActiveTab] = useState<'stats' | 'settings' | 'history' | 'events'>('stats');
    const [editableSectorNames, setEditableSectorNames] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);
    
    // Event Creation State
    const [newEventName, setNewEventName] = useState('');

    // API Import State
    const [importType, setImportType] = useState<ImportType>('tickets');
    const [apiUrl, setApiUrl] = useState('https://public-api.stingressos.com.br/tickets');
    const [apiToken, setApiToken] = useState('');
    const [apiEventId, setApiEventId] = useState('');

    // Validation Mode State
    const [validationMode, setValidationMode] = useState<ValidationMode>('OFFLINE');
    const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([
        { id: '1', name: 'Principal', url: 'https://public-api.stingressos.com.br/checkins', token: '', customEventId: '' }
    ]);
    
    // Visibility State for API tokens
    const [visibleTokens, setVisibleTokens] = useState<{[key: string]: boolean}>({});

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setEditableSectorNames(sectorNames);
    }, [sectorNames]);

    useEffect(() => {
        // Load validation settings if available
        if (selectedEvent && db) {
             import('firebase/firestore').then(({ getDoc, doc }) => {
                 getDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main')).then(snap => {
                     if (snap.exists()) {
                         const data = snap.data();
                         if (data.validation) {
                             setValidationMode(data.validation.mode || 'OFFLINE');
                             
                             if (data.validation.endpoints && Array.isArray(data.validation.endpoints) && data.validation.endpoints.length > 0) {
                                 setApiEndpoints(data.validation.endpoints);
                             } else if (data.validation.url) {
                                 // Migrate legacy single URL to array
                                 setApiEndpoints([{
                                     id: Date.now().toString(),
                                     name: 'API Principal',
                                     url: data.validation.url,
                                     token: data.validation.token || '',
                                     customEventId: ''
                                 }]);
                             }
                         }
                     }
                 });
             });
        }
    }, [selectedEvent, db]);
    
    useEffect(() => {
        if (!selectedEvent) {
            setActiveTab('events');
        }
    }, [selectedEvent]);

    const handleImportTypeChange = (type: ImportType) => {
        setImportType(type);
        setApiToken(''); // Reset token usually
        setApiEventId('');
        
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
                setApiUrl(''); // User must paste link
                break;
            default:
                setApiUrl('');
        }
    };

    // --- Event Management Functions ---
    const handleCreateEvent = async () => {
        if (!newEventName.trim()) return alert('Nome do evento é obrigatório');
        try {
            await addDoc(collection(db, 'events'), {
                name: newEventName,
                createdAt: serverTimestamp(),
                isHidden: false
            });
            setNewEventName('');
            alert('Evento criado com sucesso!');
        } catch (e) {
            console.error(e);
            alert('Erro ao criar evento');
        }
    };

    const handleToggleEventVisibility = async (event: Event) => {
        try {
            await updateDoc(doc(db, 'events', event.id), {
                isHidden: !event.isHidden
            });
        } catch (e) {
            console.error(e);
            alert('Erro ao atualizar evento');
        }
    };

    // --- Analytics Data ---
    const analyticsData: AnalyticsData = useMemo(() => {
        const validScans = scanHistory.filter(s => s.status === 'VALID');
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
            alert('Falha ao salvar nomes dos setores.');
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
        setEditableSectorNames(editableSectorNames.filter((_, index) => index !== indexToRemove));
    };
    
    // Helper to process CSV Data (reused for File Upload and Google Sheets)
    const processCsvData = async (csvData: any[]) => {
        const newSectors = new Set<string>();
        const ticketsToSave: Ticket[] = [];
        
        csvData.forEach((row) => {
            const normalizedRow: {[key: string]: string} = {};
            Object.keys(row).forEach(k => {
                normalizedRow[k.toLowerCase().trim()] = row[k];
            });

            const code = normalizedRow['code'] || normalizedRow['código'] || normalizedRow['codigo'] || normalizedRow['id'] || normalizedRow['qr'] || normalizedRow['qrcode'] || normalizedRow['ticket'];
            let sector = normalizedRow['sector'] || normalizedRow['setor'] || normalizedRow['categoria'] || normalizedRow['category'] || 'Geral';
            const ownerName = normalizedRow['name'] || normalizedRow['nome'] || normalizedRow['cliente'] || normalizedRow['owner'] || '';
            
            if (code) {
                newSectors.add(sector);
                ticketsToSave.push({
                    id: String(code).trim(),
                    sector: String(sector).trim(),
                    status: 'AVAILABLE',
                    details: { ownerName: String(ownerName).trim() }
                });
            }
        });
        return { newSectors, ticketsToSave };
    };

    const saveImportedData = async (newSectors: Set<string>, ticketsToSave: Ticket[]) => {
        if (!selectedEvent) return;
        
        // Update Sectors
        if (newSectors.size > 0) {
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

        // Save Tickets
        if (ticketsToSave.length > 0) {
            setLoadingMessage('Salvando ingressos no banco de dados...');
            const chunks = [];
            for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                chunks.push(ticketsToSave.slice(i, i + BATCH_SIZE));
            }

            for (const chunk of chunks) {
                const batch = writeBatch(db);
                chunk.forEach(ticket => {
                    const ticketRef = doc(db, 'events', selectedEvent.id, 'tickets', ticket.id);
                    batch.set(ticketRef, ticket);
                });
                await batch.commit();
                savedCount += chunk.length;
                setLoadingMessage(`Salvando... ${savedCount}/${ticketsToSave.length}`);
            }
        }
    };

    // --- IMPORT API LOGIC (REVISED) ---
    const handleImportApi = async () => {
        if (!selectedEvent) return;
        setIsLoading(true);
        setLoadingMessage('Iniciando conexão com a API...');

        try {
            let allItems: any[] = [];
            let page = 1;
            let hasNextPage = true;
            const PER_PAGE = 200; // Safe batch size
            
            // Construct Initial URL
            const baseUrlObj = new URL(apiUrl);
            if (apiEventId) baseUrlObj.searchParams.set('event_id', apiEventId);
            baseUrlObj.searchParams.set('per_page', String(PER_PAGE)); 
            
            let currentUrl = baseUrlObj.toString();
            let consecutiveEmptyPages = 0;

            while (hasNextPage) {
                setLoadingMessage(`Baixando página ${page}... (Total: ${allItems.length})`);
                
                const response = await fetch(currentUrl, {
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
                }

                const data = await response.json();
                
                // --- ROBUST DATA EXTRACTION ---
                let pageItems: any[] = [];
                
                if (Array.isArray(data)) {
                    pageItems = data;
                } else if (data.data && Array.isArray(data.data)) {
                    pageItems = data.data;
                } else if (data.tickets && Array.isArray(data.tickets)) {
                    pageItems = data.tickets;
                } else if (data.items && Array.isArray(data.items)) {
                    pageItems = data.items;
                } else {
                    // Last resort: look for ANY array property
                     const foundArray = Object.values(data).find(v => Array.isArray(v));
                     if (foundArray) pageItems = foundArray as any[];
                }

                if (pageItems.length === 0) {
                    // If we got empty list, assume end of data
                    hasNextPage = false;
                    break;
                }
                
                // Check for duplicates to prevent loops
                const firstNewItem = pageItems[0];
                const isDuplicate = allItems.some(i => 
                    (i.id && i.id === firstNewItem.id) || 
                    (i.code && i.code === firstNewItem.code)
                );

                if (isDuplicate && page > 1) {
                    console.warn("Duplicate page detected. Stopping pagination.");
                    hasNextPage = false;
                    break;
                }

                allItems = [...allItems, ...pageItems];

                // --- DETERMINE NEXT URL ---
                let nextLink = null;

                if (data.next_page_url) {
                    nextLink = data.next_page_url;
                } else if (data.links && Array.isArray(data.links)) {
                    // Laravel/JSON:API pagination links
                    const nextObj = data.links.find((l: any) => l.label === 'Next' || l.rel === 'next');
                    if (nextObj && nextObj.url) nextLink = nextObj.url;
                }

                if (nextLink) {
                    // Use official next link with fixes
                    if (nextLink.startsWith('http:')) nextLink = nextLink.replace('http:', 'https:');
                    const nextUrlObj = new URL(nextLink);
                    if (apiEventId && !nextUrlObj.searchParams.has('event_id')) nextUrlObj.searchParams.set('event_id', apiEventId);
                    nextUrlObj.searchParams.set('per_page', String(PER_PAGE));
                    currentUrl = nextUrlObj.toString();
                    page++;
                } else if (pageItems.length >= PER_PAGE) {
                    // Speculative Pagination: If we got a full page but no link, try next page number manually
                    page++;
                    baseUrlObj.searchParams.set('page', String(page));
                    currentUrl = baseUrlObj.toString();
                } else {
                    // Less items than limit and no next link -> End of list
                    hasNextPage = false;
                }
            }

            setLoadingMessage(`Processando ${allItems.length} itens...`);
            
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];

            allItems.forEach(item => {
                let code, sector, ownerName, status = 'AVAILABLE';
                
                // Normalize item data based on endpoint type
                if (importType === 'tickets') {
                    code = item.code || item.qr_code || item.uuid || item.id;
                    sector = item.sector?.name || item.sector || item.category || 'Geral';
                    ownerName = item.participant?.name || item.owner_name || item.owner || 'Participante';
                    if (item.is_used || item.status === 'used') status = 'USED';
                } else if (importType === 'participants') {
                     code = item.ticket_code || item.code;
                     sector = item.sector || 'Geral';
                     ownerName = item.name;
                } else if (importType === 'buyers') {
                     if (item.tickets && Array.isArray(item.tickets)) {
                         item.tickets.forEach((t: any) => {
                             newSectors.add(t.sector || 'Geral');
                             ticketsToSave.push({
                                 id: String(t.code || t.qr_code).trim(),
                                 sector: String(t.sector || 'Geral').trim(),
                                 status: 'AVAILABLE',
                                 details: { ownerName: item.name }
                             });
                         });
                         return;
                     }
                }

                if (code) {
                    newSectors.add(String(sector));
                    ticketsToSave.push({
                        id: String(code).trim(),
                        sector: String(sector).trim(),
                        status: status as any,
                        details: { ownerName: String(ownerName) }
                    });
                }
            });
            
            if (ticketsToSave.length === 0) {
                alert('Importação concluída, mas 0 ingressos foram encontrados. \n\nDica: Verifique se o ID do Evento está correto.');
            } else {
                await saveImportedData(newSectors, ticketsToSave);
                alert(`Importação concluída! ${ticketsToSave.length} ingressos importados.`);
            }

        } catch (error: any) {
            console.error("Erro importação:", error);
            alert(`Erro: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            complete: async (results) => {
                const { newSectors, ticketsToSave } = await processCsvData(results.data);
                await saveImportedData(newSectors, ticketsToSave);
                alert(`Arquivo CSV processado! ${ticketsToSave.length} ingressos importados.`);
            },
            error: (error) => {
                alert(`Erro ao ler CSV: ${error.message}`);
            }
        });
    };
    
    const handleGoogleSheetsImport = () => {
        if (!apiUrl) return alert('Cole o link CSV do Google Sheets.');
        setIsLoading(true);
        Papa.parse(apiUrl, {
            download: true,
            header: true,
            complete: async (results) => {
                const { newSectors, ticketsToSave } = await processCsvData(results.data);
                await saveImportedData(newSectors, ticketsToSave);
                alert(`Planilha importada! ${ticketsToSave.length} ingressos salvos.`);
                setIsLoading(false);
            },
            error: (err) => {
                alert('Erro ao baixar planilha. Verifique se está publicada como CSV na Web.');
                setIsLoading(false);
            }
        });
    };
    
    // --- VALIDATION CONFIG SAVE ---
    const handleSaveValidationConfig = async () => {
        if (!selectedEvent) return;
        try {
            await setDoc(doc(db, 'events', selectedEvent.id, 'settings', 'main'), {
                validation: {
                    mode: validationMode,
                    endpoints: apiEndpoints
                }
            }, { merge: true });
            alert('Configurações de validação salvas!');
        } catch (e) {
            console.error(e);
            alert('Erro ao salvar configurações.');
        }
    };

    // Add/Remove Endpoint Handlers
    const handleAddEndpoint = () => {
        setApiEndpoints([...apiEndpoints, { id: Date.now().toString(), name: '', url: '', token: '', customEventId: '' }]);
    };
    
    const handleRemoveEndpoint = (id: string) => {
        setApiEndpoints(apiEndpoints.filter(ep => ep.id !== id));
    };
    
    const handleEndpointChange = (id: string, field: keyof ApiEndpoint, value: string) => {
        setApiEndpoints(apiEndpoints.map(ep => ep.id === id ? { ...ep, [field]: value } : ep));
    };

    const toggleTokenVisibility = (id: string) => {
        setVisibleTokens(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="w-full bg-gray-800 p-6 rounded-lg shadow-xl">
            <h2 className="text-2xl font-bold text-orange-500 mb-6">Painel Administrativo</h2>
            
            <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'stats' ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Estatísticas</button>
                <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'settings' ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Configurar Ingressos</button>
                <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'history' ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Histórico Completo</button>
                <button onClick={() => setActiveTab('events')} className={`px-4 py-2 rounded-lg transition-colors ${activeTab === 'events' ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Gerenciar Eventos</button>
            </div>
            
            {activeTab === 'stats' && selectedEvent && (
                <div className="space-y-6 animate-fade-in">
                    <Stats allTickets={allTickets} sectorNames={sectorNames} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <PieChart data={pieChartData} title="Distribuição de Entradas por Setor" />
                        <AnalyticsChart data={analyticsData} sectorNames={sectorNames} />
                    </div>
                    <div className="flex justify-center mt-6">
                        <button 
                            onClick={() => generateEventReport(selectedEvent.name, allTickets, scanHistory, sectorNames)}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg flex items-center shadow-lg transition-transform transform hover:scale-105"
                        >
                            <CloudDownloadIcon className="w-5 h-5 mr-2" />
                            Baixar Relatório Completo (PDF)
                        </button>
                    </div>
                </div>
            )}
            
            {activeTab === 'settings' && selectedEvent && (
                 <div className="space-y-8 animate-fade-in text-white">
                    
                    {/* --- VALIDATION MODE --- */}
                    <div className="bg-gray-700 p-6 rounded-lg border border-gray-600">
                        <h3 className="text-xl font-bold text-white mb-4 flex items-center">
                            <CogIcon className="w-6 h-6 mr-2 text-orange-400"/>
                            Modo de Operação
                        </h3>
                        
                        <div className="flex items-center space-x-4 mb-6">
                            <label className="flex items-center cursor-pointer">
                                <input 
                                    type="radio" 
                                    name="validationMode"
                                    value="OFFLINE"
                                    checked={validationMode === 'OFFLINE'}
                                    onChange={() => setValidationMode('OFFLINE')}
                                    className="form-radio text-orange-600 h-5 w-5"
                                />
                                <span className="ml-2 text-lg">Offline (Banco de Dados Local)</span>
                            </label>
                            <label className="flex items-center cursor-pointer">
                                <input 
                                    type="radio" 
                                    name="validationMode"
                                    value="ONLINE"
                                    checked={validationMode === 'ONLINE'}
                                    onChange={() => setValidationMode('ONLINE')}
                                    className="form-radio text-orange-600 h-5 w-5"
                                />
                                <span className="ml-2 text-lg">Online (API em Tempo Real)</span>
                            </label>
                        </div>

                        {validationMode === 'ONLINE' && (
                            <div className="space-y-4 pl-4 border-l-2 border-orange-500 bg-gray-800/50 p-4 rounded-r-lg">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-semibold text-orange-300">Conexões de API (Endpoints)</h4>
                                    <button 
                                        onClick={handleAddEndpoint}
                                        className="text-xs bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded"
                                    >
                                        + Adicionar API
                                    </button>
                                </div>
                                
                                {apiEndpoints.map((ep, index) => (
                                    <div key={ep.id} className="bg-gray-900 p-4 rounded border border-gray-700 relative">
                                        {apiEndpoints.length > 1 && (
                                            <button onClick={() => handleRemoveEndpoint(ep.id)} className="absolute top-2 right-2 text-red-400 hover:text-red-300 text-xs">Remover</button>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                             <div>
                                                <label className="block text-xs text-gray-400 mb-1">Nome (ex: ST Ingressos)</label>
                                                <input 
                                                    type="text" 
                                                    value={ep.name}
                                                    onChange={(e) => handleEndpointChange(ep.id, 'name', e.target.value)}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white"
                                                    placeholder="Nome da Integração"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">URL de Validação (Endpoint)</label>
                                                <input 
                                                    type="text" 
                                                    value={ep.url}
                                                    onChange={(e) => handleEndpointChange(ep.id, 'url', e.target.value)}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white font-mono"
                                                    placeholder="https://api.exemplo.com/checkins"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1">Token de Acesso</label>
                                                <div className="relative">
                                                    <input 
                                                        type={visibleTokens[ep.id] ? "text" : "password"}
                                                        value={ep.token}
                                                        onChange={(e) => handleEndpointChange(ep.id, 'token', e.target.value)}
                                                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white pr-10"
                                                        placeholder="Token Bearer"
                                                    />
                                                    <button 
                                                        type="button"
                                                        onClick={() => toggleTokenVisibility(ep.id)}
                                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                                                    >
                                                        {visibleTokens[ep.id] ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}
                                                    </button>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-gray-400 mb-1 flex items-center">
                                                    ID do Evento (Numérico) 
                                                    {!ep.customEventId && <span className="ml-2 text-red-400 text-[10px] font-bold animate-pulse">OBRIGATÓRIO</span>}
                                                </label>
                                                <input 
                                                    type="number" 
                                                    value={ep.customEventId || ''}
                                                    onChange={(e) => handleEndpointChange(ep.id, 'customEventId', e.target.value)}
                                                    className={`w-full bg-gray-800 border rounded p-2 text-sm text-white ${!ep.customEventId ? 'border-red-500' : 'border-gray-600'}`}
                                                    placeholder="Ex: 155"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="mt-4 text-right">
                            <button onClick={handleSaveValidationConfig} className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold">Salvar Configuração</button>
                        </div>
                    </div>

                    <div className="border-t border-gray-600 my-8"></div>

                    {/* --- IMPORT DATA SECTION --- */}
                    <h3 className="text-xl font-bold mb-4">Importar Dados (Base Local)</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <button 
                            onClick={() => handleImportTypeChange('tickets')}
                            className={`p-4 rounded border ${importType === 'tickets' ? 'border-orange-500 bg-orange-900/20 text-orange-400' : 'border-gray-600 bg-gray-700'}`}
                        >
                            Ingressos (/tickets)
                        </button>
                        <button 
                            onClick={() => handleImportTypeChange('participants')}
                             className={`p-4 rounded border ${importType === 'participants' ? 'border-orange-500 bg-orange-900/20 text-orange-400' : 'border-gray-600 bg-gray-700'}`}
                        >
                            Participantes (/participants)
                        </button>
                        <button 
                            onClick={() => handleImportTypeChange('buyers')}
                             className={`p-4 rounded border ${importType === 'buyers' ? 'border-orange-500 bg-orange-900/20 text-orange-400' : 'border-gray-600 bg-gray-700'}`}
                        >
                            Compradores (/buyers)
                        </button>
                        <button 
                            onClick={() => handleImportTypeChange('checkins')}
                             className={`p-4 rounded border ${importType === 'checkins' ? 'border-orange-500 bg-orange-900/20 text-orange-400' : 'border-gray-600 bg-gray-700'}`}
                        >
                            Histórico Check-ins
                        </button>
                         <button 
                            onClick={() => handleImportTypeChange('google_sheets')}
                             className={`p-4 rounded border ${importType === 'google_sheets' ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-gray-600 bg-gray-700'}`}
                        >
                           <TableCellsIcon className="w-5 h-5 inline mr-2"/>
                            Google Sheets / CSV
                        </button>
                    </div>

                    {importType === 'google_sheets' ? (
                        <div className="bg-gray-700 p-4 rounded-lg">
                             <p className="text-sm text-gray-300 mb-2">
                                1. No Google Sheets: Arquivo {'>'} Compartilhar {'>'} Publicar na Web {'>'} Formato CSV.<br/>
                                2. Cole o link gerado abaixo.
                            </p>
                            <input 
                                type="text" 
                                className="w-full p-2 rounded bg-gray-800 border border-gray-600 text-white mb-2"
                                placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
                                value={apiUrl}
                                onChange={(e) => setApiUrl(e.target.value)}
                            />
                             <div className="flex space-x-2">
                                <button 
                                    onClick={handleGoogleSheetsImport}
                                    disabled={isLoading}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-bold flex items-center disabled:opacity-50"
                                >
                                    {isLoading ? 'Importando...' : 'Importar Planilha'}
                                </button>
                                <span className="text-gray-400 self-center">OU</span>
                                <input 
                                    type="file" 
                                    accept=".csv"
                                    ref={fileInputRef}
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-bold"
                                >
                                    Upload Arquivo CSV
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">URL da API</label>
                                <input 
                                    type="text" 
                                    className="w-full p-2 rounded bg-gray-800 border border-gray-600 text-white"
                                    value={apiUrl}
                                    onChange={(e) => setApiUrl(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Token (Bearer)</label>
                                    <input 
                                        type="password" 
                                        className="w-full p-2 rounded bg-gray-800 border border-gray-600 text-white"
                                        value={apiToken}
                                        onChange={(e) => setApiToken(e.target.value)}
                                        placeholder="Cole seu token aqui"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">ID Evento (Filtro)</label>
                                    <input 
                                        type="text" 
                                        className="w-full p-2 rounded bg-gray-800 border border-gray-600 text-white"
                                        value={apiEventId}
                                        onChange={(e) => setApiEventId(e.target.value)}
                                        placeholder="Opcional (ex: 155)"
                                    />
                                </div>
                            </div>
                            <button 
                                onClick={handleImportApi}
                                disabled={isLoading}
                                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded disabled:opacity-50 flex justify-center items-center"
                            >
                                <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                {isLoading ? (loadingMessage || 'Importando...') : 'Importar da API'}
                            </button>
                        </div>
                    )}

                    <div className="border-t border-gray-600 my-8"></div>
                    
                    {/* --- SECTOR MANAGEMENT --- */}
                    <h3 className="text-xl font-bold mb-4">Gerenciar Setores</h3>
                    <div className="space-y-3">
                        {editableSectorNames.map((name, index) => (
                            <div key={index} className="flex items-center space-x-2">
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => handleSectorNameChange(index, e.target.value)}
                                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                                />
                                <button 
                                    onClick={() => handleRemoveSector(index)}
                                    className="text-red-400 hover:text-red-300 px-2"
                                >
                                    X
                                </button>
                            </div>
                        ))}
                        <div className="flex space-x-3 mt-4">
                            <button onClick={handleAddSector} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white">
                                + Adicionar Setor
                            </button>
                            <button 
                                onClick={handleSaveSectorNames} 
                                disabled={isSavingSectors}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white font-bold disabled:opacity-50"
                            >
                                {isSavingSectors ? 'Salvando...' : 'Salvar Alterações'}
                            </button>
                        </div>
                    </div>
                 </div>
            )}

            {activeTab === 'history' && selectedEvent && (
                 <div className="space-y-4 animate-fade-in">
                     <h3 className="text-xl font-bold text-white">Histórico Completo</h3>
                     <TicketList tickets={scanHistory} sectorNames={sectorNames} />
                 </div>
            )}

            {activeTab === 'events' && (
                <div className="space-y-6 animate-fade-in">
                    <h3 className="text-xl font-bold text-white">Meus Eventos</h3>
                    
                    <div className="bg-gray-700 p-4 rounded-lg flex space-x-2">
                        <input 
                            type="text" 
                            placeholder="Nome do novo evento"
                            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 text-white"
                            value={newEventName}
                            onChange={(e) => setNewEventName(e.target.value)}
                        />
                        <button 
                            onClick={handleCreateEvent}
                            className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded font-bold"
                        >
                            Criar
                        </button>
                    </div>

                    <div className="space-y-2">
                        {events.map(event => (
                            <div key={event.id} className="bg-gray-700 p-4 rounded flex justify-between items-center">
                                <span className={`font-bold text-lg ${event.isHidden ? 'text-gray-500 line-through' : 'text-white'}`}>{event.name}</span>
                                <div className="flex items-center space-x-3">
                                    <span className="text-xs text-gray-400">{event.id}</span>
                                    <button 
                                        onClick={() => handleToggleEventVisibility(event)}
                                        className="text-sm underline text-orange-300 hover:text-orange-200"
                                    >
                                        {event.isHidden ? 'Mostrar' : 'Ocultar'}
                                    </button>
                                </div>
                            </div>
                        ))}
                        {events.length === 0 && <p className="text-gray-400 text-center">Nenhum evento criado.</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminView;

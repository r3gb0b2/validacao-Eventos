
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket, DisplayableScanLog, Sector, AnalyticsData, Event } from '../types';
import Stats from './Stats';
import TicketList from './TicketList';
import AnalyticsChart from './AnalyticsChart';
import PieChart from './PieChart';
import { generateEventReport } from '../utils/pdfGenerator';
import { Firestore, writeBatch, doc, setDoc } from 'firebase/firestore';
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
    const [ticketCodes, setTicketCodes] = useState<{ [key: string]: string }>({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [isSavingSectors, setIsSavingSectors] = useState(false);

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

    // ... analytics code omitted for brevity, unchanged ...
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

    const saveImportedData = async (newSectors: Set<string>, ticketsToSave: Ticket[], ticketsToUpdateStatus: any[] = []) => {
        if (!selectedEvent) return;
        
        // Update Sectors
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
                    batch.set(ticketRef, {
                        sector: ticket.sector,
                        details: ticket.details,
                    }, { merge: true });
                });
                await batch.commit();
                savedCount += chunk.length;
            }
        }
        
        return savedCount;
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        setIsLoading(true);
        setLoadingMessage('Lendo arquivo...');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                 try {
                    const { newSectors, ticketsToSave } = await processCsvData(results.data);
                    if (ticketsToSave.length === 0) {
                        alert('Nenhum ingresso identificado no arquivo. Verifique os cabeçalhos (Code, Sector, Name).');
                    } else {
                        const count = await saveImportedData(newSectors, ticketsToSave);
                        alert(`${count} ingressos importados do arquivo com sucesso!`);
                    }
                 } catch (err) {
                     console.error(err);
                     alert('Erro ao processar arquivo.');
                 } finally {
                     setIsLoading(false);
                     setLoadingMessage('');
                     if (fileInputRef.current) fileInputRef.current.value = '';
                 }
            },
            error: (err) => {
                alert('Erro ao ler CSV: ' + err.message);
                setIsLoading(false);
            }
        });
    };

    const handleImportFromApi = async () => {
        if (!selectedEvent) return;
        
        setIsLoading(true);
        setLoadingMessage('Iniciando...');
        
        try {
            const allItems: any[] = [];
            const newSectors = new Set<string>();
            const ticketsToSave: Ticket[] = [];
            const ticketsToUpdateStatus: { id: string, usedAt: number }[] = [];

            // --- GOOGLE SHEETS ---
            if (importType === 'google_sheets') {
                 if (!apiUrl.trim()) { throw new Error("Link da planilha é obrigatório"); }
                 setLoadingMessage('Baixando planilha...');
                 
                 let fetchUrl = apiUrl;
                 if (fetchUrl.includes('docs.google.com/spreadsheets') && !fetchUrl.includes('output=csv')) {
                     if (fetchUrl.includes('/edit')) {
                         fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                     }
                 }

                 const response = await fetch(fetchUrl);
                 if (!response.ok) throw new Error('Falha ao baixar planilha. Verifique se o link é público.');
                 const csvText = await response.text();
                 const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                 
                 const { newSectors: ns, ticketsToSave: ts } = await processCsvData(parsed.data);
                 if (ts.length === 0) throw new Error("Nenhum dado válido encontrado na planilha.");
                 
                 const count = await saveImportedData(ns, ts);
                 alert(`Importação concluída! ${count} ingressos salvos.`);
                 setIsLoading(false);
                 return;
            } 
            
            // --- STANDARD API IMPORTS ---
            const urlObj = new URL(apiUrl);
            if (apiEventId && !urlObj.searchParams.has('event_id')) urlObj.searchParams.set('event_id', apiEventId);
            urlObj.searchParams.set('per_page', '500');
            
            let nextUrl: string | null = urlObj.toString();
            let pageCount = 0;
            const headers: HeadersInit = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (apiToken.trim()) headers['Authorization'] = `Bearer ${apiToken.trim()}`;
            const seenIds = new Set<string>();

            while (nextUrl && pageCount < 5000) {
                pageCount++;
                setLoadingMessage(`Baixando pág ${pageCount} (Itens: ${allItems.length})...`);
                
                if (nextUrl.startsWith('http://')) nextUrl = nextUrl.replace('http://', 'https://');
                const res = await fetch(nextUrl, { headers });
                if (!res.ok) break;
                const json = await res.json();
                
                let items: any[] = [];
                if (Array.isArray(json)) items = json;
                else if (json.data && Array.isArray(json.data)) items = json.data;
                else if (json.tickets) items = json.tickets;
                
                if (items.length === 0) break;
                
                let newCount = 0;
                items.forEach(item => {
                    const id = item.id || item.code || item.ticket_code;
                    if (id && !seenIds.has(String(id))) {
                        seenIds.add(String(id));
                        allItems.push(item);
                        newCount++;
                    }
                });
                if (newCount === 0 && allItems.length > 0) break;

                nextUrl = json.next_page_url || (json.links?.next) || (json.meta?.next_page_url);
                if (nextUrl) {
                     const u = new URL(nextUrl);
                     if (apiEventId) u.searchParams.set('event_id', apiEventId);
                     u.searchParams.set('per_page', '500');
                     nextUrl = u.toString();
                }
            }
            
            if (allItems.length === 0) throw new Error("Nenhum dado retornado pela API.");

            allItems.forEach(item => {
                 const code = item.code || item.qr_code || item.ticket_code || item.id;
                 if (!code) return;
                 
                 if (importType === 'checkins' || apiUrl.includes('checkins')) {
                     const ts = item.created_at || item.checked_in_at;
                     ticketsToUpdateStatus.push({ id: String(code), usedAt: ts ? new Date(ts).getTime() : Date.now() });
                 } else {
                     let sector = item.sector || item.sector_name || item.category || 'Geral';
                     if (typeof sector === 'object') sector = sector.name;
                     const name = item.owner_name || item.name || '';
                     newSectors.add(String(sector));
                     ticketsToSave.push({ id: String(code), sector: String(sector), status: 'AVAILABLE', details: { ownerName: String(name) } });
                 }
            });

            const count = await saveImportedData(newSectors, ticketsToSave, ticketsToUpdateStatus);
            alert(`Sucesso! ${count} registros processados.`);

        } catch (error) {
            console.error('Import Error:', error);
            alert(`Falha na importação: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    // --- Multi-Endpoint Validation Config Helpers ---
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

    const handleSaveValidationSettings = async () => {
        if (!selectedEvent) return;
        setIsSavingSectors(true);
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
        } finally {
            setIsSavingSectors(false);
        }
    };

    // Helper for rendering
    const NoEventSelectedMessage = () => <div className="p-8 text-center text-gray-400">Selecione um evento.</div>;

    const renderContent = () => {
        if (!selectedEvent && activeTab !== 'events') return <NoEventSelectedMessage />;
        
        switch (activeTab) {
            case 'stats': return <Stats allTickets={allTickets} sectorNames={sectorNames} />; 
            case 'history': return <TicketList tickets={scanHistory} sectorNames={sectorNames} />;
            case 'events': return (
                <div className="bg-gray-800 p-4 rounded">
                    <h3 className="text-lg font-bold mb-4">Gerenciar Eventos</h3>
                    <div className="space-y-4">
                        {events.map(e => (
                            <div key={e.id} className="flex justify-between bg-gray-700 p-2 rounded">
                                <span>{e.name}</span>
                                <span className="text-xs text-gray-400">{e.isHidden ? '(Oculto)' : ''}</span>
                            </div>
                        ))}
                    </div>
                </div>
            );
            case 'settings':
                if (!selectedEvent) return <NoEventSelectedMessage />;
                return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* LEFT COLUMN: Sectors & Validation Mode */}
                        <div className="space-y-6">
                            <div className="bg-gray-800 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold mb-3">Configurar Setores</h3>
                                <div className="space-y-2 mb-4">
                                    {editableSectorNames.map((name, index) => (
                                        <div key={index} className="flex gap-2">
                                            <input className="flex-1 bg-gray-700 p-2 rounded border border-gray-600" value={name} onChange={e => handleSectorNameChange(index, e.target.value)} />
                                            <button onClick={() => handleRemoveSector(index)} className="bg-red-600 px-3 rounded text-white">&times;</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleAddSector} className="flex-1 bg-gray-600 p-2 rounded hover:bg-gray-500">Add Setor</button>
                                    <button onClick={handleSaveSectorNames} className="flex-1 bg-orange-600 p-2 rounded hover:bg-orange-500 font-bold">Salvar</button>
                                </div>
                            </div>

                            <div className="bg-gray-800 p-4 rounded-lg border border-blue-500/30">
                                <h3 className="text-lg font-semibold mb-3 text-blue-400 flex items-center">
                                    <CogIcon className="w-5 h-5 mr-2" />
                                    Modo de Operação
                                </h3>
                                <div className="flex bg-gray-700 rounded p-1 mb-4">
                                    <button 
                                        onClick={() => setValidationMode('OFFLINE')}
                                        className={`flex-1 py-2 rounded transition-colors ${validationMode === 'OFFLINE' ? 'bg-blue-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        OFFLINE (Local)
                                    </button>
                                    <button 
                                        onClick={() => setValidationMode('ONLINE')}
                                        className={`flex-1 py-2 rounded transition-colors ${validationMode === 'ONLINE' ? 'bg-green-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        ONLINE (API)
                                    </button>
                                </div>
                                
                                {validationMode === 'ONLINE' && (
                                    <div className="space-y-3 animate-fade-in">
                                        <p className="text-xs text-gray-300 mb-2">Configure abaixo as APIs onde o sistema buscará os ingressos. Ele tentará na ordem da lista até encontrar.</p>
                                        
                                        {apiEndpoints.map((ep, idx) => (
                                            <div key={ep.id} className="p-3 bg-gray-700/50 border border-gray-600 rounded relative">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-xs font-bold text-blue-300">API #{idx + 1}</span>
                                                    <button onClick={() => handleRemoveEndpoint(ep.id)} className="text-xs text-red-400 hover:text-red-300">Remover</button>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 mb-2">
                                                     <input 
                                                        type="text" 
                                                        placeholder="Nome (ex: Sympla)"
                                                        value={ep.name}
                                                        onChange={e => handleEndpointChange(ep.id, 'name', e.target.value)}
                                                        className="w-full bg-gray-800 p-1.5 rounded border border-gray-600 text-xs"
                                                    />
                                                    <input 
                                                        type="text" 
                                                        placeholder="ID Evento (Numérico)"
                                                        value={ep.customEventId}
                                                        onChange={e => handleEndpointChange(ep.id, 'customEventId', e.target.value)}
                                                        className={`w-full bg-gray-800 p-1.5 rounded border text-xs ${!ep.customEventId ? 'border-red-500/50 bg-red-900/10' : 'border-gray-600'}`}
                                                    />
                                                </div>
                                                <input 
                                                    type="text" 
                                                    placeholder="URL (https://...)"
                                                    value={ep.url}
                                                    onChange={e => handleEndpointChange(ep.id, 'url', e.target.value)}
                                                    className="w-full bg-gray-800 p-1.5 rounded border border-gray-600 text-xs mb-2"
                                                />
                                                <div className="relative">
                                                    <input 
                                                        type={visibleTokens[ep.id] ? 'text' : 'password'}
                                                        placeholder="Token (Bearer)"
                                                        value={ep.token}
                                                        onChange={e => handleEndpointChange(ep.id, 'token', e.target.value)}
                                                        className="w-full bg-gray-800 p-1.5 rounded border border-gray-600 text-xs pr-8"
                                                    />
                                                    <button 
                                                        onClick={() => toggleTokenVisibility(ep.id)}
                                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white focus:outline-none"
                                                        tabIndex={-1}
                                                        title={visibleTokens[ep.id] ? "Ocultar senha" : "Mostrar senha"}
                                                    >
                                                        {visibleTokens[ep.id] ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                                                    </button>
                                                </div>
                                                {!ep.customEventId && <p className="text-[10px] text-red-400 mt-1">* ID do Evento é obrigatório para evitar erro 404</p>}
                                            </div>
                                        ))}

                                        <button 
                                            onClick={handleAddEndpoint}
                                            className="w-full py-2 border border-dashed border-gray-500 text-gray-400 text-sm rounded hover:border-gray-400 hover:text-white"
                                        >
                                            + Adicionar Outra API
                                        </button>
                                    </div>
                                )}
                                
                                <button 
                                    onClick={handleSaveValidationSettings}
                                    className="w-full mt-3 bg-blue-700 hover:bg-blue-600 py-2 rounded font-bold text-sm"
                                >
                                    Salvar Configuração de Validação
                                </button>
                            </div>
                        </div>
                        
                        {/* RIGHT COLUMN: Imports */}
                        <div className="space-y-6">
                             <div className="bg-gray-800 p-4 rounded-lg border border-orange-500/30">
                                <h3 className="text-lg font-semibold mb-3 text-orange-400 flex items-center">
                                    <CloudDownloadIcon className="w-5 h-5 mr-2" />
                                    Importar Dados
                                </h3>
                                
                                <div className="mb-4">
                                    <label className="text-xs text-gray-400 block mb-1">Método de Importação</label>
                                    <select value={importType} onChange={e => handleImportTypeChange(e.target.value as ImportType)} className="w-full bg-gray-700 p-2 rounded border border-gray-600 mb-2">
                                        <option value="tickets">API (Tickets)</option>
                                        <option value="checkins">API (Checkins)</option>
                                        <option value="google_sheets">Google Sheets (Link)</option>
                                        <option value="custom">Upload CSV Local</option>
                                    </select>
                                    
                                    {importType === 'custom' ? (
                                        <div className="text-center p-4 border-2 border-dashed border-gray-600 rounded-lg bg-gray-700/30">
                                            <input 
                                                type="file" 
                                                accept=".csv" 
                                                ref={fileInputRef} 
                                                style={{display: 'none'}} 
                                                onChange={handleFileUpload} 
                                            />
                                            <button 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-bold flex items-center justify-center mx-auto"
                                            >
                                                <TableCellsIcon className="w-5 h-5 mr-2"/>
                                                Selecionar Arquivo CSV
                                            </button>
                                            <p className="text-xs text-gray-400 mt-2">Colunas: code, sector, name</p>
                                        </div>
                                    ) : (
                                        <>
                                           <input 
                                                type="text" 
                                                value={apiUrl} 
                                                onChange={e => setApiUrl(e.target.value)} 
                                                placeholder={importType === 'google_sheets' ? "Cole o link público do CSV aqui" : "URL da API"}
                                                className="w-full bg-gray-700 p-2 rounded border border-gray-600 mb-2 text-sm"
                                           />
                                           {importType !== 'google_sheets' && (
                                               <div className="flex gap-2 mb-2">
                                                    <input type="password" value={apiToken} onChange={e => setApiToken(e.target.value)} placeholder="Token (opcional)" className="flex-1 bg-gray-700 p-2 rounded border border-gray-600 text-sm" />
                                                    <input type="text" value={apiEventId} onChange={e => setApiEventId(e.target.value)} placeholder="ID Evento (opc)" className="w-24 bg-gray-700 p-2 rounded border border-gray-600 text-sm" />
                                               </div>
                                           )}
                                           <button onClick={handleImportFromApi} disabled={isLoading} className="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded font-bold disabled:opacity-50">
                                               {isLoading ? loadingMessage : 'Iniciar Importação'}
                                           </button>
                                        </>
                                    )}
                                </div>
                             </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto">
            <div className="bg-gray-800 rounded-lg p-2 mb-6 flex overflow-x-auto space-x-2">
                {['stats', 'settings', 'history', 'events'].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-4 py-2 rounded font-bold capitalize ${activeTab === tab ? 'bg-orange-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>
                        {tab === 'stats' ? 'Dashboard' : tab === 'settings' ? 'Configurações' : tab === 'history' ? 'Histórico' : 'Eventos'}
                    </button>
                ))}
            </div>
            {renderContent()}
        </div>
    );
};

export default AdminView;


import React, { useState } from 'react';
import { ImportSource, ImportType, Event, Ticket } from '../../types';
import { Firestore, doc, setDoc, writeBatch, serverTimestamp, getDoc, addDoc, collection } from 'firebase/firestore';
import { CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, ClockIcon, AlertTriangleIcon, CheckCircleIcon, PlusCircleIcon, PauseIcon, PlayIcon } from '../Icons';
import Papa from 'papaparse';

interface SettingsModuleProps {
  db: Firestore;
  selectedEvent: Event;
  sectorNames: string[];
  hiddenSectors: string[];
  importSources: ImportSource[];
  onUpdateSectorNames: (names: string[], hidden: string[]) => Promise<void>;
  onUpdateImportSources: (sources: ImportSource[]) => Promise<void>;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  allTickets: Ticket[];
}

const SettingsModule: React.FC<SettingsModuleProps> = ({ db, selectedEvent, sectorNames, hiddenSectors, importSources, onUpdateSectorNames, onUpdateImportSources, isLoading, setIsLoading, allTickets }) => {
    const [importProgress, setImportProgress] = useState<string>('');
    const [importStats, setImportStats] = useState({ total: 0, new: 0, existing: 0, updated: 0 });
    
    const [editSource, setEditSource] = useState<Partial<ImportSource>>({ 
        name: '', 
        url: 'https://public-api.stingressos.com.br', 
        token: '', 
        type: 'tickets', 
        autoImport: false,
        externalEventId: '' 
    });

    const isEditing = !!editSource.id;

    const handleSaveSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha ao menos Nome e URL.");
        
        let updated: ImportSource[];
        if (isEditing) {
            updated = importSources.map(s => s.id === editSource.id ? (editSource as ImportSource) : s);
        } else {
            const newSource = { 
                ...editSource, 
                id: Math.random().toString(36).substr(2, 9),
                lastImportTime: 0 
            } as ImportSource;
            updated = [...importSources, newSource];
        }

        await onUpdateImportSources(updated);
        resetForm();
    };

    const toggleAutoImport = async (sourceId: string) => {
        const updated = importSources.map(s => 
            s.id === sourceId ? { ...s, autoImport: !s.autoImport } : s
        );
        await onUpdateImportSources(updated);
    };

    const resetForm = () => {
        setEditSource({ name: '', url: 'https://public-api.stingressos.com.br', token: '', type: 'tickets', autoImport: false, externalEventId: '' });
    };

    const startEditing = (source: ImportSource) => {
        setEditSource(source);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const runImport = async (source: ImportSource) => {
        setIsLoading(true);
        setImportProgress('Iniciando...');
        setImportStats({ total: 0, new: 0, existing: 0, updated: 0 });

        let totalItemsFoundInApi = 0;
        let newItemsAdded = 0;
        let alreadyExistingCount = 0;
        let updatedItems = 0;
        const sectorsAffected: Record<string, number> = {};

        try {
            const existingTicketsMap = new Map<string, Ticket>(allTickets.map(t => [String(t.id).trim(), t]));
            let allTicketsToSave: any[] = [];
            const discoveredSectors = new Set<string>(sectorNames);

            let fetchUrl = source.url.trim();
            const headers: HeadersInit = { 
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            };
            
            if (source.token) {
                const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;
                headers['Authorization'] = cleanToken;
            }

            if (source.type === 'google_sheets') {
                setImportProgress('Baixando planilha...');
                if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                const res = await fetch(fetchUrl);
                const csvText = await res.text();
                const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                
                rows.forEach(row => {
                    const code = String(row['code'] || row['codigo'] || row['id'] || '').trim();
                    if (!code) return;
                    totalItemsFoundInApi++;

                    const sector = String(row['sector'] || row['setor'] || 'Geral').trim();
                    const existing = existingTicketsMap.get(code);
                    if (!existing) {
                        discoveredSectors.add(sector);
                        sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                        allTicketsToSave.push({
                            id: code,
                            sector: sector,
                            status: 'AVAILABLE',
                            source: 'api_import',
                            details: { 
                                ownerName: String(row['name'] || row['nome'] || 'Importado'),
                                email: row['email'] || '',
                                phone: row['phone'] || row['telefone'] || '',
                                document: row['document'] || row['cpf'] || ''
                            }
                        });
                        newItemsAdded++;
                    } else {
                        alreadyExistingCount++;
                    }
                    setImportStats({ total: totalItemsFoundInApi, new: newItemsAdded, existing: alreadyExistingCount, updated: updatedItems });
                });
            } else {
                const endpoint = source.type === 'checkins' ? 'checkins' : 
                                source.type === 'participants' ? 'participants' :
                                source.type === 'buyers' ? 'buyers' : 'tickets';
                
                const baseUrl = fetchUrl.endsWith('/') ? fetchUrl.slice(0, -1) : fetchUrl;
                let currentPage = 1;
                let hasMorePages = true;

                while (hasMorePages) {
                    setImportProgress(`Processando página ${currentPage}...`);
                    const urlObj = new URL(`${baseUrl}/${endpoint}`, window.location.origin);
                    urlObj.searchParams.set('page', String(currentPage));
                    urlObj.searchParams.set('per_page', '100'); 
                    if (source.externalEventId) urlObj.searchParams.set('event_id', source.externalEventId);
                    
                    const res = await fetch(urlObj.toString(), { headers, mode: 'cors' });
                    if (!res.ok) {
                        hasMorePages = false;
                        break;
                    }
                    const json = await res.json();
                    const items = json.data || json.participants || json.tickets || json.checkins || json.buyers || (Array.isArray(json) ? json : []);
                    if (!items || items.length === 0) {
                        hasMorePages = false;
                        break;
                    }

                    items.forEach((item: any) => {
                        totalItemsFoundInApi++;
                        const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                        if (!code) return;

                        let rawSector = 'Geral';
                        if (item.sector_name) rawSector = item.sector_name;
                        else if (item.category?.name) rawSector = item.category.name;
                        else if (item.category) rawSector = item.category;
                        else if (item.sector) rawSector = item.sector;
                        else if (item.ticket_type?.name) rawSector = item.ticket_type.name;
                        
                        const sector = String(rawSector).trim() || 'Geral';
                        discoveredSectors.add(sector);

                        const existing = existingTicketsMap.get(code);
                        const isNew = !existing;
                        const shouldMarkUsed = source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at;

                        if (isNew) {
                            newItemsAdded++;
                            sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                            allTicketsToSave.push({
                                id: code,
                                sector: sector,
                                status: shouldMarkUsed ? 'USED' : 'AVAILABLE',
                                usedAt: shouldMarkUsed ? (item.validated_at || Date.now()) : null,
                                source: 'api_import',
                                details: { 
                                    ownerName: String(item.name || item.customer_name || item.buyer_name || (item.customer && item.customer.name) || 'Importado'),
                                    email: item.email || (item.customer && item.customer.email) || '',
                                    phone: item.phone || item.mobile || (item.customer && item.customer.phone) || '',
                                    document: item.document || item.cpf || (item.customer && item.customer.document) || '',
                                    originalId: item.id || null
                                }
                            });
                        } else {
                            alreadyExistingCount++;
                            if (shouldMarkUsed && existing.status !== 'USED') {
                                updatedItems++;
                                sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                                allTicketsToSave.push({
                                    ...existing,
                                    status: 'USED',
                                    usedAt: item.validated_at || Date.now()
                                });
                            }
                        }
                    });
                    
                    setImportStats({ total: totalItemsFoundInApi, new: newItemsAdded, existing: alreadyExistingCount, updated: updatedItems });
                    const lastPage = json.last_page || json.meta?.last_page || json.pagination?.total_pages || 0;
                    if (lastPage > 0 && currentPage >= lastPage) hasMorePages = false;
                    else currentPage++;
                    if (currentPage > 500) hasMorePages = false;
                }
            }

            setImportProgress('Finalizando...');
            const newSectorList = Array.from(discoveredSectors).sort();
            if (JSON.stringify(newSectorList) !== JSON.stringify(sectorNames)) {
                await onUpdateSectorNames(newSectorList, hiddenSectors);
            }

            if (allTicketsToSave.length > 0) {
                const BATCH_SIZE = 450;
                for (let i = 0; i < allTicketsToSave.length; i += BATCH_SIZE) {
                    setImportProgress(`Gravando lote ${Math.floor(i / BATCH_SIZE) + 1}...`);
                    const chunk = allTicketsToSave.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(t => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true });
                    });
                    await batch.commit();
                }
            }

            // --- GERA LOG DA IMPORTAÇÃO MANUAL ---
            await addDoc(collection(db, 'events', selectedEvent.id, 'import_logs'), {
                timestamp: Date.now(),
                sourceName: source.name,
                newCount: newItemsAdded,
                existingCount: alreadyExistingCount,
                updatedCount: updatedItems,
                sectorsAffected: sectorsAffected,
                status: 'success',
                type: 'local'
            });

            setImportProgress('');
            alert(
                `Sincronização Manual Finalizada!\n\n` +
                `• Total Lidos: ${totalItemsFoundInApi}\n` +
                `• Novos Ingressos: ${newItemsAdded}\n` +
                `• Já Existentes: ${alreadyExistingCount}\n` +
                `• Check-ins Sincronizados: ${updatedItems}`
            );

            const updatedSources = importSources.map(s => s.id === source.id ? { ...s, lastImportTime: Date.now() } : s);
            await onUpdateImportSources(updatedSources);

        } catch (e: any) {
            console.error("Erro na sincronização:", e);
            await addDoc(collection(db, 'events', selectedEvent.id, 'import_logs'), {
                timestamp: Date.now(),
                sourceName: source.name,
                status: 'error',
                errorMessage: e.message,
                type: 'local'
            });
            setImportProgress('');
            alert(`Erro: ${e.message}`);
        } finally {
            setIsLoading(false);
            setImportProgress('');
            setImportStats({ total: 0, new: 0, existing: 0, updated: 0 });
        }
    };

    return (
        <div className="space-y-8 pb-32 animate-fade-in relative">
            {isLoading && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md px-4">
                    <div className="bg-gray-800 border border-blue-500/30 p-8 rounded-[2.5rem] shadow-2xl flex flex-col items-center max-w-sm w-full text-center space-y-6">
                        <div className="relative">
                            <div className="w-20 h-20 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center text-xs font-black text-blue-400">
                                {importStats.total > 0 ? `${Math.min(100, Math.floor(((importStats.new + importStats.updated) / importStats.total) * 100))}%` : '...'}
                            </div>
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-1">Importando Dados</h3>
                            <p className="text-blue-400 font-mono text-xs animate-pulse tracking-widest uppercase">{importProgress}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 w-full">
                            <div className="bg-gray-900/50 p-3 rounded-2xl border border-gray-700">
                                <p className="text-[10px] text-gray-500 uppercase font-bold">Lidos</p>
                                <p className="text-lg font-black text-white">{importStats.total}</p>
                            </div>
                            <div className="bg-gray-900/50 p-3 rounded-2xl border border-gray-700">
                                <p className="text-[10px] text-gray-500 uppercase font-bold">Novos</p>
                                <p className="text-lg font-black text-green-400">+{importStats.new}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-2xl space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xl flex items-center text-blue-400">
                            <CloudUploadIcon className="w-6 h-6 mr-3" /> {isEditing ? 'Editar Integração' : 'Nova Integração ST Ingressos'}
                        </h3>
                        {isEditing && (
                            <button onClick={resetForm} className="text-[10px] text-gray-400 hover:text-white underline uppercase">Cancelar Edição</button>
                        )}
                    </div>
                    
                    <div className="space-y-4 bg-gray-900/50 p-5 rounded-2xl border border-gray-700">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">Nome da Fonte</label>
                                <input value={editSource.name} onChange={e => setEditSource({...editSource, name: e.target.value})} placeholder="Ex: API Principal" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">ID Evento Externo</label>
                                <input value={editSource.externalEventId} onChange={e => setEditSource({...editSource, externalEventId: e.target.value})} placeholder="Ex: 4377" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" />
                            </div>
                        </div>
                        <input value={editSource.url} onChange={e => setEditSource({...editSource, url: e.target.value})} placeholder="https://public-api.stingressos.com.br" className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" />
                        <input value={editSource.token} onChange={e => setEditSource({...editSource, token: e.target.value})} placeholder="Bearer Token..." className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none font-mono" />
                        <div className="flex gap-3">
                            <div className="flex-1 space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">Tipo de Recurso</label>
                                <select value={editSource.type} onChange={e => setEditSource({...editSource, type: e.target.value as any})} className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none">
                                    <option value="tickets">/tickets (Carga Total)</option>
                                    <option value="checkins">/checkins (Sincronizar Usados)</option>
                                    <option value="participants">/participants (Participantes)</option>
                                    <option value="google_sheets">Google Sheets (CSV)</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1 text-center block">Auto</label>
                                <label className="flex items-center justify-center bg-gray-800 h-[46px] w-[60px] rounded-xl border border-gray-700 cursor-pointer hover:border-blue-500 transition-all">
                                    <input type="checkbox" className="w-5 h-5 accent-blue-600" checked={editSource.autoImport} onChange={e => setEditSource({...editSource, autoImport: e.target.checked})}/>
                                </label>
                            </div>
                        </div>
                        <button onClick={handleSaveSource} className={`w-full ${isEditing ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} p-4 rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center`}><CheckCircleIcon className="w-5 h-5 mr-2" /> {isEditing ? 'Salvar Alterações' : 'Adicionar Integração'}</button>
                    </div>

                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                        {importSources.map(s => (
                            <div key={s.id} className="bg-gray-900/80 border border-gray-700 p-4 rounded-2xl flex justify-between items-center group hover:border-blue-500/50 transition-all">
                                <div className="space-y-1 flex-1">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-white">{s.name}</p>
                                        <span className="text-[8px] bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 uppercase">{s.type}</span>
                                    </div>
                                    {s.lastImportTime > 0 && (
                                        <p className="text-[9px] text-blue-400 font-bold flex items-center">
                                            <ClockIcon className="w-3 h-3 mr-1" />
                                            Última Sinc: {new Date(s.lastImportTime).toLocaleTimeString()}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-1">
                                    {/* BOTÃO DE ALTERNÂNCIA RÁPIDA DE AUTO-IMPORT */}
                                    <button 
                                        onClick={() => toggleAutoImport(s.id)}
                                        className={`p-2 rounded-xl transition-all border ${s.autoImport ? 'bg-green-600/10 border-green-500 text-green-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-white'}`}
                                        title={s.autoImport ? "Sincronização Automática Ativa" : "Ativar Sincronização Automática"}
                                    >
                                        {s.autoImport ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
                                    </button>
                                    <button onClick={() => runImport(s)} disabled={isLoading} className="bg-blue-600/10 hover:bg-blue-600 p-2 rounded-xl text-blue-400 hover:text-white transition-all disabled:opacity-50" title="Importar Manualmente Agora"><CloudUploadIcon className="w-5 h-5"/></button>
                                    <button onClick={() => startEditing(s)} className="bg-gray-800 hover:bg-orange-600 p-2 rounded-xl text-orange-400 hover:text-white transition-all" title="Editar"><PlusCircleIcon className="w-5 h-5 rotate-45"/></button>
                                    <button onClick={() => onUpdateImportSources(importSources.filter(x => x.id !== s.id))} className="bg-red-900/10 hover:bg-red-600 p-2 rounded-xl text-red-500 hover:text-white transition-all" title="Excluir"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl space-y-5">
                    <h3 className="font-bold text-xl flex items-center text-gray-300"><TableCellsIcon className="w-6 h-6 mr-3" /> Gestão de Setores</h3>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {sectorNames.map((name, i) => (
                            <div key={i} className="flex items-center justify-between bg-gray-900/50 p-4 rounded-2xl border border-gray-700 hover:border-gray-600 transition-all">
                                <span className="text-sm font-bold text-gray-200">{name}</span>
                                <div className="flex gap-2">
                                    <button onClick={() => onUpdateSectorNames(sectorNames, hiddenSectors.includes(name) ? hiddenSectors.filter(h => h !== name) : [...hiddenSectors, name])} className={`p-2.5 rounded-xl transition-all ${hiddenSectors.includes(name) ? 'bg-gray-700 text-gray-500' : 'bg-blue-600/10 text-blue-400'}`}>{hiddenSectors.includes(name) ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}</button>
                                    <button onClick={() => confirm(`Excluir setor "${name}"?`) && onUpdateSectorNames(sectorNames.filter((_, idx) => idx !== i), hiddenSectors)} className="p-2.5 bg-red-900/10 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all"><TrashIcon className="w-5 h-5"/></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModule;


import React, { useState } from 'react';
import { ImportSource, ImportType, Event, Ticket } from '../../types';
import { Firestore, doc, setDoc, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import { CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, ClockIcon, AlertTriangleIcon, CheckCircleIcon, PlusCircleIcon } from '../Icons';
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

    const resetForm = () => {
        setEditSource({ name: '', url: 'https://public-api.stingressos.com.br', token: '', type: 'tickets', autoImport: false, externalEventId: '' });
    };

    const startEditing = (source: ImportSource) => {
        setEditSource(source);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const runImport = async (source: ImportSource) => {
        setIsLoading(true);
        let totalItemsFoundInApi = 0;
        let newItemsAdded = 0;
        let existingItemsUpdated = 0;

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
                if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                const res = await fetch(fetchUrl);
                const csvText = await res.text();
                const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                
                rows.forEach(row => {
                    const code = String(row['code'] || row['codigo'] || row['id'] || '').trim();
                    if (!code) return;
                    totalItemsFoundInApi++;

                    if (!existingTicketsMap.has(code)) {
                        const sector = String(row['sector'] || row['setor'] || 'Geral').trim();
                        discoveredSectors.add(sector);
                        allTicketsToSave.push({
                            id: code,
                            sector: sector,
                            status: 'AVAILABLE',
                            source: 'api_import',
                            details: { ownerName: String(row['name'] || row['nome'] || 'Importado') }
                        });
                        newItemsAdded++;
                    }
                });
            } else {
                const endpoint = source.type === 'checkins' ? 'checkins' : 
                                source.type === 'participants' ? 'participants' :
                                source.type === 'buyers' ? 'buyers' : 'tickets';
                
                const baseUrl = fetchUrl.endsWith('/') ? fetchUrl.slice(0, -1) : fetchUrl;
                
                // Força per_page=100 para minimizar requisições e garantir carga maior
                let initialRequestUrl = `${baseUrl}/${endpoint}`;
                const urlObj = new URL(initialRequestUrl, window.location.origin);
                
                if (source.externalEventId) {
                    urlObj.searchParams.set('event_id', source.externalEventId);
                }
                urlObj.searchParams.set('per_page', '100');
                
                let nextUrl: string | null = urlObj.toString();
                let pageCount = 0;

                while (nextUrl) {
                    pageCount++;
                    console.log(`Buscando Página ${pageCount}: ${nextUrl}`);
                    
                    let res = await fetch(nextUrl, { headers, mode: 'cors' });
                    
                    // Fallback para ID no Path se o primeiro falhar com 404 (comum em algumas versões da API)
                    if (!res.ok && pageCount === 1 && source.externalEventId && res.status === 404) {
                        const fallbackPath = `${baseUrl}/${endpoint}/${source.externalEventId}?per_page=100`;
                        console.log("Tentando Fallback Path:", fallbackPath);
                        res = await fetch(fallbackPath, { headers, mode: 'cors' });
                    }

                    if (!res.ok) {
                        const err = await res.text();
                        throw new Error(`Erro na API (Pág ${pageCount}): ${err || res.statusText}`);
                    }

                    const json = await res.json();
                    const items = json.data || json.participants || json.tickets || json.checkins || (Array.isArray(json) ? json : []);
                    
                    if (!items || items.length === 0) break;

                    items.forEach((item: any) => {
                        totalItemsFoundInApi++;
                        const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                        if (!code) return;

                        // Mapeamento resiliente de setores (Trata se for objeto ou string)
                        let rawSector = 'Geral';
                        if (typeof item.sector_name === 'string') rawSector = item.sector_name;
                        else if (item.category && typeof item.category.name === 'string') rawSector = item.category.name;
                        else if (typeof item.category === 'string') rawSector = item.category;
                        else if (typeof item.sector === 'string') rawSector = item.sector;
                        else if (item.ticket_type && typeof item.ticket_type.name === 'string') rawSector = item.ticket_type.name;
                        
                        const sector = rawSector.trim() || 'Geral';
                        discoveredSectors.add(sector);

                        const existing = existingTicketsMap.get(code);
                        const isNew = !existing;
                        const shouldMarkUsed = source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at;

                        if (isNew) {
                            newItemsAdded++;
                            allTicketsToSave.push({
                                id: code,
                                sector: sector,
                                status: shouldMarkUsed ? 'USED' : 'AVAILABLE',
                                usedAt: shouldMarkUsed ? (item.validated_at || Date.now()) : null,
                                source: 'api_import',
                                details: { 
                                    ownerName: String(item.name || item.customer_name || item.buyer_name || (item.customer && item.customer.name) || 'Importado'),
                                    originalId: item.id ?? null // Garante que nunca seja undefined
                                }
                            });
                        } else if (shouldMarkUsed && existing && existing.status !== 'USED') {
                            existingItemsUpdated++;
                            allTicketsToSave.push({
                                ...existing,
                                status: 'USED',
                                usedAt: item.validated_at || Date.now()
                            });
                        }
                    });

                    // Lógica de Paginação Avançada
                    let foundNext = json.links?.next || json.next_page_url || json.pagination?.next_page_url || null;
                    
                    // Se o link de próxima página for um objeto em vez de string (erro comum de mapeamento)
                    if (foundNext && typeof foundNext !== 'string') {
                        foundNext = foundNext.url || null;
                    }

                    // Se não houver link direto, mas houver metadados, constrói a URL manualmente
                    if (!foundNext) {
                        const meta = json.meta || json.pagination || {};
                        const current = Number(meta.current_page || meta.page || 0);
                        const last = Number(meta.last_page || meta.total_pages || 0);
                        
                        if (current > 0 && last > 0 && current < last) {
                            const nextUrlObj = new URL(nextUrl, window.location.origin);
                            nextUrlObj.searchParams.set('page', (current + 1).toString());
                            foundNext = nextUrlObj.toString();
                        }
                    }

                    nextUrl = foundNext;
                    if (pageCount > 500) break; // Limite de segurança contra loops infinitos
                }
            }

            // Atualizar Setores no Firestore para garantir que apareçam no Dashboard
            const newSectorList = Array.from(discoveredSectors).sort();
            const sectorsChanged = JSON.stringify(newSectorList) !== JSON.stringify(sectorNames);
            if (sectorsChanged) {
                await onUpdateSectorNames(newSectorList, hiddenSectors);
            }

            // Salvar no Firestore em lotes de 450
            if (allTicketsToSave.length > 0) {
                const BATCH_SIZE = 450;
                for (let i = 0; i < allTicketsToSave.length; i += BATCH_SIZE) {
                    const chunk = allTicketsToSave.slice(i, i + BATCH_SIZE);
                    const batch = writeBatch(db);
                    chunk.forEach(t => {
                        batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true });
                    });
                    await batch.commit();
                }
            }

            // Feedback detalhado para o usuário
            alert(
                `Sincronização Finalizada!\n\n` +
                `• Localizados na API: ${totalItemsFoundInApi}\n` +
                `• Novos Ingressos: ${newItemsAdded}\n` +
                `• Atualizados para Usado: ${existingItemsUpdated}\n` +
                `• Total de Setores: ${discoveredSectors.size}`
            );

            const updatedSources = importSources.map(s => s.id === source.id ? { ...s, lastImportTime: Date.now() } : s);
            await onUpdateImportSources(updatedSources);

        } catch (e: any) {
            console.error("Erro na sincronização:", e);
            alert(`Falha na Sincronização:\n${e.message}\n\nVerifique se o Token é válido para o ID do evento informado.`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-8 pb-32 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* CONFIGURAÇÃO DE FONTES DE DADOS */}
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
                                <input 
                                    value={editSource.name} 
                                    onChange={e => setEditSource({...editSource, name: e.target.value})} 
                                    placeholder="Ex: API Principal" 
                                    className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" 
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">ID Evento Externo</label>
                                <input 
                                    value={editSource.externalEventId} 
                                    onChange={e => setEditSource({...editSource, externalEventId: e.target.value})} 
                                    placeholder="Ex: 3604" 
                                    className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" 
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">URL Base API</label>
                            <input 
                                value={editSource.url} 
                                onChange={e => setEditSource({...editSource, url: e.target.value})} 
                                placeholder="https://public-api.stingressos.com.br" 
                                className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none" 
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">Token de Autorização</label>
                            <input 
                                value={editSource.token} 
                                onChange={e => setEditSource({...editSource, token: e.target.value})} 
                                placeholder="Insira o Bearer Token..." 
                                className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none font-mono" 
                            />
                        </div>
                        
                        <div className="flex gap-3">
                            <div className="flex-1 space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1">Tipo de Recurso</label>
                                <select 
                                    value={editSource.type} 
                                    onChange={e => setEditSource({...editSource, type: e.target.value as any})}
                                    className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm focus:border-blue-500 outline-none"
                                >
                                    <option value="tickets">/tickets (Carga Total)</option>
                                    <option value="checkins">/checkins (Sincronizar Usados)</option>
                                    <option value="participants">/participants (Participantes)</option>
                                    <option value="buyers">/buyers (Compradores)</option>
                                    <option value="google_sheets">Google Sheets (CSV)</option>
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-bold ml-1 text-center block">Auto</label>
                                <label className="flex items-center justify-center bg-gray-800 h-[46px] w-[60px] rounded-xl border border-gray-700 cursor-pointer hover:border-blue-500 transition-all">
                                    <input 
                                        type="checkbox" 
                                        className="w-5 h-5 accent-blue-600"
                                        checked={editSource.autoImport} 
                                        onChange={e => setEditSource({...editSource, autoImport: e.target.checked})}
                                    />
                                </label>
                            </div>
                        </div>

                        <button 
                            onClick={handleSaveSource} 
                            className={`w-full ${isEditing ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} p-4 rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center justify-center`}
                        >
                            <CheckCircleIcon className="w-5 h-5 mr-2" /> {isEditing ? 'Salvar Alterações' : 'Adicionar Integração'}
                        </button>
                    </div>

                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {importSources.map(s => (
                            <div key={s.id} className="bg-gray-900/80 border border-gray-700 p-4 rounded-2xl flex justify-between items-center group hover:border-blue-500/50 transition-all">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-bold text-white">{s.name}</p>
                                        <span className="text-[8px] bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 uppercase">{s.type}</span>
                                        {s.autoImport && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>}
                                    </div>
                                    <p className="text-[10px] text-gray-500 truncate max-w-[150px]">{s.url}</p>
                                    {s.lastImportTime > 0 && (
                                        <p className="text-[9px] text-blue-400 font-bold flex items-center">
                                            <ClockIcon className="w-3 h-3 mr-1" />
                                            Última Sinc: {new Date(s.lastImportTime).toLocaleTimeString()}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-1">
                                    <button 
                                        onClick={() => runImport(s)}
                                        disabled={isLoading}
                                        className="bg-blue-600/10 hover:bg-blue-600 p-2 rounded-xl text-blue-400 hover:text-white transition-all disabled:opacity-50"
                                        title="Importar Agora"
                                    >
                                        <CloudUploadIcon className="w-5 h-5"/>
                                    </button>
                                    <button 
                                        onClick={() => startEditing(s)}
                                        className="bg-gray-800 hover:bg-orange-600 p-2 rounded-xl text-orange-400 hover:text-white transition-all"
                                        title="Editar"
                                    >
                                        <PlusCircleIcon className="w-5 h-5 rotate-45"/>
                                    </button>
                                    <button 
                                        onClick={() => onUpdateImportSources(importSources.filter(x => x.id !== s.id))}
                                        className="bg-red-900/10 hover:bg-red-600 p-2 rounded-xl text-red-500 hover:text-white transition-all"
                                        title="Excluir"
                                    >
                                        <TrashIcon className="w-5 h-5"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* GERENCIAR SETORES */}
                <div className="bg-gray-800 p-6 rounded-3xl border border-gray-700 shadow-xl space-y-5">
                    <h3 className="font-bold text-xl flex items-center text-gray-300">
                        <TableCellsIcon className="w-6 h-6 mr-3" /> Gestão de Setores
                    </h3>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        {sectorNames.map((name, i) => (
                            <div key={i} className="flex items-center justify-between bg-gray-900/50 p-4 rounded-2xl border border-gray-700 hover:border-gray-600 transition-all">
                                <span className="text-sm font-bold text-gray-200">{name}</span>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => {
                                            const isHidden = hiddenSectors.includes(name);
                                            const newHidden = isHidden ? hiddenSectors.filter(h => h !== name) : [...hiddenSectors, name];
                                            onUpdateSectorNames(sectorNames, newHidden);
                                        }} 
                                        className={`p-2.5 rounded-xl transition-all ${hiddenSectors.includes(name) ? 'bg-gray-700 text-gray-500' : 'bg-blue-600/10 text-blue-400'}`}
                                        title={hiddenSectors.includes(name) ? "Setor Oculto" : "Setor Visível"}
                                    >
                                        {hiddenSectors.includes(name) ? <EyeSlashIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}
                                    </button>
                                    <button 
                                        onClick={() => {
                                            if(confirm(`Excluir setor "${name}"? Os ingressos cadastrados continuarão no banco, mas não aparecerão no dashboard filtrado.`)) {
                                                onUpdateSectorNames(sectorNames.filter((_, idx) => idx !== i), hiddenSectors);
                                            }
                                        }} 
                                        className="p-2.5 bg-red-900/10 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all"
                                    >
                                        <TrashIcon className="w-5 h-5"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                        {sectorNames.length === 0 && (
                            <p className="text-center py-10 text-gray-500 text-sm italic">Nenhum setor cadastrado. Eles serão adicionados automaticamente ao sincronizar com a API.</p>
                        )}
                    </div>
                    <button 
                        onClick={() => { const n = prompt("Nome do novo setor:"); if(n) onUpdateSectorNames([...sectorNames, n], hiddenSectors); }} 
                        className="w-full mt-4 p-5 border-2 border-dashed border-gray-700 rounded-3xl text-gray-500 hover:text-white hover:border-orange-500/50 hover:bg-orange-500/5 transition-all font-bold flex items-center justify-center gap-2"
                    >
                        <PlusCircleIcon className="w-5 h-5" /> Adicionar Novo Setor
                    </button>
                </div>
            </div>

            <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl flex items-start space-x-5">
                <AlertTriangleIcon className="w-8 h-8 text-blue-500 flex-shrink-0" />
                <div className="text-xs space-y-2 text-gray-400">
                    <p className="font-bold text-blue-400 uppercase tracking-widest">Dica de Importação:</p>
                    <p>• O sistema percorre todas as páginas da API automaticamente.</p>
                    <p>• Ingressos sem setor explícito são agrupados em "Geral".</p>
                </div>
            </div>
        </div>
    );
};

export default SettingsModule;

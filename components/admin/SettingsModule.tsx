
import React, { useState } from 'react';
import { ImportSource, ImportType, Event, Ticket } from '../../types';
import { Firestore, doc, setDoc, writeBatch } from 'firebase/firestore';
import { CloudUploadIcon, TableCellsIcon, EyeIcon, EyeSlashIcon, TrashIcon, ClockIcon, AlertTriangleIcon } from '../Icons';
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
        url: '', 
        token: '', 
        type: 'tickets', 
        autoImport: false,
        eventId: '' 
    });

    const handleAddSource = async () => {
        if (!editSource.name || !editSource.url) return alert("Preencha ao menos Nome e URL.");
        const newSource = { 
            ...editSource, 
            id: Math.random().toString(36).substr(2, 9),
            lastImportTime: 0 
        } as ImportSource;
        const updated = [...importSources, newSource];
        await onUpdateImportSources(updated);
        setEditSource({ name: '', url: '', token: '', type: 'tickets', autoImport: false, eventId: '' });
    };

    const runImport = async (source: ImportSource) => {
        setIsLoading(true);
        try {
            const existingIds = new Set(allTickets.map(t => String(t.id).trim()));
            const ticketsToSave: any[] = [];

            if (source.type === 'google_sheets') {
                let fetchUrl = source.url.trim();
                if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                const res = await fetch(fetchUrl);
                const csvText = await res.text();
                const rows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data as any[];
                
                rows.forEach(row => {
                    const code = String(row['code'] || row['codigo'] || row['id']).trim();
                    if (code && !existingIds.has(code)) {
                        ticketsToSave.push({
                            id: code,
                            sector: String(row['sector'] || row['setor'] || 'Geral'),
                            status: 'AVAILABLE',
                            source: 'api_import',
                            details: { ownerName: row['name'] || row['nome'] || 'Importado' }
                        });
                    }
                });
            } else {
                // ST Ingressos ou API Genérica
                const headers: HeadersInit = { 'Accept': 'application/json' };
                if (source.token) headers['Authorization'] = `Bearer ${source.token}`;
                
                const res = await fetch(source.url, { headers });
                if (!res.ok) throw new Error("Erro na resposta da API");
                const json = await res.json();
                
                const items = json.data || json.participants || json.tickets || (Array.isArray(json) ? json : []);
                
                items.forEach((item: any) => {
                    const code = String(item.access_code || item.code || item.qr_code || item.id).trim();
                    if (code && !existingIds.has(code)) {
                        ticketsToSave.push({
                            id: code,
                            sector: String(item.sector_name || item.category || item.sector || 'Geral'),
                            status: item.used ? 'USED' : 'AVAILABLE',
                            source: 'api_import',
                            details: { ownerName: item.name || item.customer_name || 'Importado' }
                        });
                    }
                });
            }

            if (ticketsToSave.length > 0) {
                const batch = writeBatch(db);
                ticketsToSave.forEach(t => {
                    batch.set(doc(db, 'events', selectedEvent.id, 'tickets', t.id), t, { merge: true });
                });
                await batch.commit();
                alert(`Sucesso! ${ticketsToSave.length} novos ingressos importados.`);
            } else {
                alert("Nenhum ingresso novo encontrado para importar.");
            }

            // Atualizar timestamp da última importação
            const updated = importSources.map(s => s.id === source.id ? { ...s, lastImportTime: Date.now() } : s);
            await onUpdateImportSources(updated);

        } catch (e) {
            console.error(e);
            alert("Erro na importação. Verifique a URL e o Token.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-8 pb-32">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* CONFIGURAÇÃO DE FONTES DE DADOS */}
                <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl space-y-4">
                    <h3 className="font-bold text-lg flex items-center text-blue-400">
                        <CloudUploadIcon className="w-5 h-5 mr-2" /> Integrações e APIs
                    </h3>
                    
                    <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-700">
                        <input 
                            value={editSource.name} 
                            onChange={e => setEditSource({...editSource, name: e.target.value})} 
                            placeholder="Nome da Integração (ex: ST Ingressos)" 
                            className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm" 
                        />
                        <input 
                            value={editSource.url} 
                            onChange={e => setEditSource({...editSource, url: e.target.value})} 
                            placeholder="URL da API ou Link CSV Google Sheets" 
                            className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm" 
                        />
                        <input 
                            value={editSource.token} 
                            onChange={e => setEditSource({...editSource, token: e.target.value})} 
                            placeholder="Token de Acesso (Bearer / API Key)" 
                            className="w-full bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm" 
                        />
                        
                        <div className="flex gap-2">
                            <select 
                                value={editSource.type} 
                                onChange={e => setEditSource({...editSource, type: e.target.value as any})}
                                className="flex-1 bg-gray-800 border border-gray-700 p-3 rounded-xl text-sm"
                            >
                                <option value="tickets">Tipo: Ingressos (Carga)</option>
                                <option value="participants">Tipo: Participantes</option>
                                <option value="google_sheets">Tipo: Google Sheets (CSV)</option>
                            </select>
                            <label className="flex items-center gap-2 bg-gray-800 px-4 rounded-xl border border-gray-700 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={editSource.autoImport} 
                                    onChange={e => setEditSource({...editSource, autoImport: e.target.checked})}
                                />
                                <span className="text-[10px] font-bold uppercase">Auto</span>
                            </label>
                        </div>

                        <button 
                            onClick={handleAddSource} 
                            className="w-full bg-blue-600 hover:bg-blue-700 p-3 rounded-xl font-bold transition-all"
                        >
                            Adicionar Nova Fonte
                        </button>
                    </div>

                    <div className="space-y-3">
                        {importSources.map(s => (
                            <div key={s.id} className="bg-gray-900 border border-gray-700 p-4 rounded-xl flex justify-between items-center group">
                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-white flex items-center">
                                        {s.name}
                                        {s.autoImport && <span className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>}
                                    </p>
                                    <p className="text-[10px] text-gray-500 truncate max-w-[200px]">{s.url}</p>
                                    {s.lastImportTime > 0 && (
                                        <p className="text-[9px] text-blue-400 font-bold">Última sinc: {new Date(s.lastImportTime).toLocaleTimeString()}</p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => runImport(s)}
                                        disabled={isLoading}
                                        className="bg-gray-800 hover:bg-blue-600 p-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                                    >
                                        Importar Agora
                                    </button>
                                    <button 
                                        onClick={() => onUpdateImportSources(importSources.filter(x => x.id !== s.id))}
                                        className="bg-red-900/20 hover:bg-red-600 p-2 rounded-lg text-red-500 hover:text-white transition-all"
                                    >
                                        <TrashIcon className="w-4 h-4"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* GERENCIAR SETORES */}
                <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl space-y-4">
                    <h3 className="font-bold text-lg flex items-center text-gray-300">
                        <TableCellsIcon className="w-5 h-5 mr-2" /> Gestão de Setores
                    </h3>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto no-scrollbar">
                        {sectorNames.map((name, i) => (
                            <div key={i} className="flex items-center justify-between bg-gray-900/50 p-3 rounded-xl border border-gray-700">
                                <span className="text-sm font-medium">{name}</span>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => {
                                            const isHidden = hiddenSectors.includes(name);
                                            const newHidden = isHidden ? hiddenSectors.filter(h => h !== name) : [...hiddenSectors, name];
                                            onUpdateSectorNames(sectorNames, newHidden);
                                        }} 
                                        className={`p-2 rounded-lg transition-all ${hiddenSectors.includes(name) ? 'bg-gray-700 text-gray-500' : 'bg-blue-600/10 text-blue-400'}`}
                                        title={hiddenSectors.includes(name) ? "Setor Oculto" : "Setor Visível"}
                                    >
                                        {hiddenSectors.includes(name) ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                                    </button>
                                    <button 
                                        onClick={() => {
                                            if(confirm(`Excluir setor "${name}"? Isso não apaga os ingressos já salvos.`)) {
                                                onUpdateSectorNames(sectorNames.filter((_, idx) => idx !== i), hiddenSectors);
                                            }
                                        }} 
                                        className="p-2 bg-red-900/10 text-red-500 rounded-lg hover:bg-red-600 hover:text-white transition-all"
                                    >
                                        <TrashIcon className="w-4 h-4"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button 
                        onClick={() => { const n = prompt("Nome do novo setor:"); if(n) onUpdateSectorNames([...sectorNames, n], hiddenSectors); }} 
                        className="w-full mt-4 p-4 border-2 border-dashed border-gray-700 rounded-2xl text-gray-500 hover:text-white hover:border-orange-500/50 hover:bg-orange-500/5 transition-all font-bold"
                    >
                        + Adicionar Novo Setor
                    </button>
                </div>
            </div>

            <div className="bg-orange-600/10 border border-orange-500/20 p-6 rounded-2xl flex items-start space-x-4">
                <AlertTriangleIcon className="w-6 h-6 text-orange-500 flex-shrink-0" />
                <div className="text-xs space-y-2 text-gray-400">
                    <p className="font-bold text-orange-400 uppercase">Instruções de Importação:</p>
                    <p>• O sistema ignora automaticamente códigos de ingressos que já existam no banco de dados.</p>
                    <p>• <b>Google Sheets:</b> Use o link de compartilhamento "Qualquer pessoa com o link" e certifique-se que o cabeçalho contém 'code' ou 'codigo'.</p>
                    <p>• <b>Sincronização Automática:</b> Se marcada, o sistema tentará atualizar os dados a cada 5 minutos enquanto houver algum operador logado.</p>
                </div>
            </div>
        </div>
    );
};

export default SettingsModule;
